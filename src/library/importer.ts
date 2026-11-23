import { unzipSync } from 'fflate';
import type { CardMeta, Deck, PreparedCard, Store } from '../types';
import { naturalCompare, sha256, uuid } from '../util/misc';
import { mimeFromName, processImage } from '../util/image';

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export interface RawImage {
  name: string;
  data: Uint8Array;
}

export function cleanName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Card';
}

export function isZip(f: File) {
  return /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
}
export function isImage(f: File) {
  return f.type.startsWith('image/') || IMG_RE.test(f.name);
}

export async function readZip(file: File): Promise<RawImage[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf, {
    filter: (f) => IMG_RE.test(f.name) && !f.name.includes('__MACOSX') && !f.name.split('/').pop()!.startsWith('.'),
  });
  return Object.entries(files)
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([name, data]) => ({ name, data }));
}

export async function prepare(img: RawImage): Promise<PreparedCard> {
  const hash = await sha256(img.data);
  const src = new Blob([img.data as BlobPart], { type: mimeFromName(img.name) });
  const { blob, width, height } = await processImage(src);
  const landscape = width > height;
  // Climax cards are printed landscape, so landscape images default to climax.
  return { blob, name: cleanName(img.name), hash, landscape, isClimax: landscape };
}

/** Import images into the store. Returns one CardMeta per input image (duplicates map to the same card). */
export async function importImages(
  store: Store,
  images: RawImage[],
  onProgress?: (done: number, total: number) => void,
): Promise<CardMeta[]> {
  const out: CardMeta[] = [];
  const byHash = new Map<string, CardMeta>();
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i, images.length);
    const hash = await sha256(images[i].data);
    let meta = byHash.get(hash);
    if (!meta) {
      meta = await store.addCard(await prepare(images[i]));
      byHash.set(hash, meta);
    }
    out.push(meta);
  }
  onProgress?.(images.length, images.length);
  return out;
}

export async function filesToRaw(files: File[]): Promise<RawImage[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

export function deckFromMetas(name: string, metas: CardMeta[]): Deck {
  const counts = new Map<string, number>();
  for (const m of metas) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  return {
    id: uuid(),
    name,
    updatedAt: Date.now(),
    cards: [...counts].map(([cardId, count]) => ({ cardId, count })),
  };
}
