import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Store } from '../types';
import { LocalStore } from './local';
import { CloudStore } from './cloud';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const cloudEnabled = !!supabase;

export const localStore = new LocalStore();
let current: Store = localStore;
let user: User | null = null;
const listeners = new Set<() => void>();

export const store = () => current;
export const currentUser = () => user;
export function onAuthChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(u: User | null) {
  const changed = (u?.id ?? null) !== (user?.id ?? null);
  user = u;
  if (changed) {
    current = u && supabase ? new CloudStore(supabase, u.id) : localStore;
    listeners.forEach((f) => f());
  }
}

export async function initAuth() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  apply(data.session?.user ?? null);
  supabase.auth.onAuthStateChange((_e, session) => apply(session?.user ?? null));
}

export function displayName(): string {
  const n = user?.user_metadata?.display_name as string | undefined;
  return n || localStorage.getItem('wom-name') || '';
}

/** Copy every local card + deck into the signed-in cloud account, remapping card ids. */
export async function migrateLocalToCloud(progress: (msg: string) => void) {
  if (current.kind !== 'cloud') throw new Error('Sign in first');
  const cloud = current;
  const cards = await localStore.listCards();
  const map = new Map<string, string>();
  let i = 0;
  for (const c of cards) {
    progress(`Uploading card ${++i}/${cards.length}…`);
    const blob = await localStore.getImageBlob(c.id);
    const m = await cloud.addCard({ blob, name: c.name, hash: c.hash, landscape: c.landscape, isClimax: c.isClimax });
    map.set(c.id, m.id);
  }
  const decks = await localStore.listDecks();
  for (const d of decks) {
    progress(`Saving deck "${d.name}"…`);
    await cloud.saveDeck({
      id: crypto.randomUUID(),
      name: d.name,
      updatedAt: Date.now(),
      cards: d.cards.filter((e) => map.has(e.cardId)).map((e) => ({ cardId: map.get(e.cardId)!, count: e.count })),
    });
  }
  return { cards: cards.length, decks: decks.length };
}
