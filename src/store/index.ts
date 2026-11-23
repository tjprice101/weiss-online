import type { Store } from '../types';
import { deleteDatabase } from '../util/idb';
import { lsGet, lsSet, uid } from '../util/misc';
import { LocalStore } from './local';

/**
 * Browser-local profiles. Each profile has its own IndexedDB database (library + decks)
 * and its own per-profile settings. Passwords are hashed with PBKDF2 and only keep
 * other people using the same browser out of your profile; they are not encryption.
 */
export interface Profile {
  id: string;
  name: string;
  db: string;
  salt?: string;
  hash?: string;
  createdAt: number;
}

const PROFILES_KEY = 'wom-profiles';
const LEGACY_DB = 'weiss-online-mat';
const SESSION_KEY = 'wom-session';

let current: Profile | null = null;
let currentStore: LocalStore = new LocalStore(LEGACY_DB);
const listeners = new Set<() => void>();

export const listProfiles = (): Profile[] => lsGet<Profile[]>(PROFILES_KEY, []);
const saveProfiles = (p: Profile[]) => lsSet(PROFILES_KEY, p);

export const store = (): Store => currentStore;
export const currentProfile = () => current;
export const displayName = () => current?.name ?? '';
export const hasPassword = (p: Profile) => !!p.hash;

export function onProfileChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** localStorage key scoped to the signed-in profile. */
export function profileKey(key: string) {
  return current ? `${key}:${current.id}` : key;
}

async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' }, key, 256);
  const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
  return { salt: b64(salt), hash: b64(new Uint8Array(bits)) };
}

function activate(p: Profile | null) {
  current = p;
  // In-flight work (e.g. an import) keeps its own store, bound to the old profile's database.
  currentStore.dispose();
  currentStore = new LocalStore(p?.db ?? LEGACY_DB);
  listeners.forEach((f) => f());
}

function setSession(id: string | null, remember: boolean) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  if (id) (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, id);
}

/** Restore the remembered profile on page load. */
export function restoreSession() {
  const id = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  const p = listProfiles().find((x) => x.id === id) ?? null;
  if (p) activate(p);
}

export async function createProfile(name: string, password: string, remember: boolean): Promise<Profile> {
  name = name.trim();
  if (!name) throw new Error('Enter a name');
  const all = listProfiles();
  if (all.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A profile with that name already exists in this browser');
  const id = uid(12);
  // The first profile adopts the database used before profiles existed, so no data is lost.
  const db = all.length === 0 ? LEGACY_DB : `${LEGACY_DB}:${id}`;
  const p: Profile = { id, name, db, createdAt: Date.now(), ...(password ? await hashPassword(password) : {}) };
  saveProfiles([...all, p]);
  setSession(id, remember);
  activate(p);
  return p;
}

export async function signIn(id: string, password: string, remember: boolean) {
  const p = listProfiles().find((x) => x.id === id);
  if (!p) throw new Error('Profile not found');
  if (p.hash) {
    const { hash } = await hashPassword(password, p.salt);
    if (hash !== p.hash) throw new Error('Wrong password');
  }
  setSession(id, remember);
  activate(p);
}

export function signOut() {
  setSession(null, false);
  activate(null);
}

function updateCurrent(patch: Partial<Profile>) {
  if (!current) throw new Error('Not signed in');
  const next = { ...current, ...patch };
  for (const k of Object.keys(patch) as (keyof Profile)[]) if (patch[k] === undefined) delete next[k];
  saveProfiles(listProfiles().map((p) => (p.id === next.id ? next : p)));
  current = next;
  listeners.forEach((f) => f());
}

export function renameProfile(name: string) {
  name = name.trim();
  if (!name) throw new Error('Enter a name');
  if (listProfiles().some((p) => p.id !== current?.id && p.name.toLowerCase() === name.toLowerCase())) throw new Error('Another profile already uses that name');
  updateCurrent({ name });
}

export async function changePassword(oldPassword: string, newPassword: string) {
  if (!current) throw new Error('Not signed in');
  if (current.hash) {
    const { hash } = await hashPassword(oldPassword, current.salt);
    if (hash !== current.hash) throw new Error('Current password is wrong');
  }
  updateCurrent(newPassword ? await hashPassword(newPassword) : { salt: undefined, hash: undefined });
}

export async function deleteCurrentProfile() {
  if (!current) return;
  const p = current;
  saveProfiles(listProfiles().filter((x) => x.id !== p.id));
  for (const k of Object.keys(localStorage)) if (k.endsWith(':' + p.id)) localStorage.removeItem(k);
  signOut();
  await deleteDatabase(p.db);
}
