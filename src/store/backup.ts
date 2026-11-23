import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { CardMeta, Deck } from '../types';
import { store } from './index';

const MANIFEST = 'weiss-mat-backup.json';

interface Manifest {
  app: 'weiss-online-mat';
  version: 1;
  profile: string;
  exportedAt: number;
  cards: (CardMeta & { file: string })[];
  decks: Deck[];
}

const extFor = (type: string) => (type.includes('png') ? 'png' : type.includes('jpeg') ? 'jpg' : 'webp');

/** Zip the signed-in profile's whole library + decks. */
export async function exportBackup(profileName: string, progress?: (msg: string) => void): Promise<Blob> {
  const s = store();
  const cards = await s.listCards();
  const files: Record<string, Uint8Array> = {};
  const entries: Manifest['cards'] = [];
  let i = 0;
  for (const c of cards) {
    progress?.(`Packing card ${++i}/${cards.length}…`);
    const blob = await s.getImageBlob(c.id);
    const file = `cards/${c.id}.${extFor(blob.type)}`;
    files[file] = new Uint8Array(await blob.arrayBuffer());
    entries.push({ ...c, file });
  }
  const manifest: Manifest = { app: 'weiss-online-mat', version: 1, profile: profileName, exportedAt: Date.now(), cards: entries, decks: await s.listDecks() };
  files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 1));
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

/** Merge a backup zip into the signed-in profile. Existing cards are kept; decks with the same id are replaced. */
export async function importBackup(file: File, progress?: (msg: string) => void) {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = zip[MANIFEST];
  if (!raw) throw new Error('This is not a Weiss Online Mat backup (no ' + MANIFEST + ' inside)');
  const m = JSON.parse(strFromU8(raw)) as Manifest;
  if (m.app !== 'weiss-online-mat') throw new Error('Unrecognised backup file');
  const s = store();
  const idMap = new Map<string, string>();
  let i = 0;
  for (const c of m.cards) {
    progress?.(`Importing card ${++i}/${m.cards.length}…`);
    const data = zip[c.file];
    if (!data) continue;
    const type = c.file.endsWith('.png') ? 'image/png' : c.file.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
    const meta = await s.addCard({ blob: new Blob([data as BlobPart], { type }), name: c.name, hash: c.hash, landscape: c.landscape, isClimax: c.isClimax, folder: c.folder });
    idMap.set(c.id, meta.id);
  }
  for (const d of m.decks) {
    progress?.(`Importing deck "${d.name}"…`);
    await s.saveDeck({ ...d, cards: d.cards.filter((e) => idMap.has(e.cardId)).map((e) => ({ cardId: idMap.get(e.cardId)!, count: e.count })) });
  }
  return { cards: idMap.size, decks: m.decks.length, profile: m.profile };
}
