import { store } from '../store';
import { DECK_SIZE, deckTotal, type CardMeta, type Deck, type Store } from '../types';
import { h, modal, toast } from '../util/dom';
import { deckFromMetas, filesToRaw, importImages, isImage, isZip, readZip } from '../library/importer';

export interface UploadResult {
  cards: CardMeta[];
  decks: Deck[];
}

/**
 * Handle any mix of dropped/selected files:
 *  - image files → added to the library as individual cards
 *  - .zip files  → every image added to the library AND a deck is created from the zip
 */
/**
 * Import images and deck zips. Loose images go into `opts.folder` (if any); each zip's cards go into
 * a folder named after the zip, unless they were already filed somewhere.
 */
export async function handleUploads(files: File[], opts: { zipAsDeck?: boolean; folder?: string } = {}): Promise<UploadResult> {
  const zipAsDeck = opts.zipAsDeck ?? true;
  const images = files.filter(isImage);
  const zips = files.filter(isZip);
  const result: UploadResult = { cards: [], decks: [] };
  if (!images.length && !zips.length) {
    toast('No images or .zip files found', 'warn');
    return result;
  }
  const status = toast('Importing…', 'info', 600_000);
  const s = store();
  try {
    if (images.length) {
      const metas = await importImages(s, await filesToRaw(images), (d, t) => (status.textContent = `Importing images ${d}/${t}…`));
      if (opts.folder) await fileInto(s, metas, opts.folder);
      result.cards.push(...metas);
    }
    for (const z of zips) {
      status.textContent = `Reading ${z.name}…`;
      const raw = await readZip(z);
      if (!raw.length) {
        toast(`${z.name} has no images`, 'warn');
        continue;
      }
      const metas = await importImages(s, raw, (d, t) => (status.textContent = `${z.name}: ${d}/${t}…`));
      await fileInto(s, metas, opts.folder || z.name.replace(/\.zip$/i, '').trim());
      result.cards.push(...metas);
      if (zipAsDeck) {
        const deck = await s.saveDeck(deckFromMetas(z.name.replace(/\.zip$/i, ''), metas));
        result.decks.push(deck);
      }
    }
  } catch (e) {
    console.error(e);
    toast('Import failed: ' + (e as Error).message, 'error', 8000);
  } finally {
    status.remove();
  }
  if (result.cards.length) {
    const unique = new Set(result.cards.map((c) => c.id)).size;
    toast(`Imported ${result.cards.length} image(s) — ${unique} unique card(s)`, 'ok');
  }
  if (result.decks.length) showDeckImportSummary(result.decks);
  return result;
}

/** Put cards that aren't in a folder yet into `folder`. */
async function fileInto(s: Store, metas: CardMeta[], folder: string) {
  if (!folder) return;
  for (const m of metas) {
    if (m.folder) continue;
    await s.updateCard(m.id, { folder });
    m.folder = folder;
  }
}

function showDeckImportSummary(decks: Deck[]) {
  const body = h(
    'div',
    { class: 'stack' },
    decks.map((d) => {
      const n = deckTotal(d);
      return h(
        'div',
        { class: `import-row ${n === DECK_SIZE ? 'good' : 'bad'}` },
        h('b', null, d.name),
        ` — ${n} cards`,
        n !== DECK_SIZE
          ? h('div', { class: 'warn-text' }, `⚠ A Weiss deck must have exactly ${DECK_SIZE} cards (this has ${n > DECK_SIZE ? n - DECK_SIZE + ' too many' : DECK_SIZE - n + ' too few'}). You can still edit it in the deck builder.`)
          : h('div', { class: 'ok-text' }, '✓ 50 cards — ready to play'),
      );
    }),
  );
  modal({ title: decks.length > 1 ? 'Decks imported' : 'Deck imported', body });
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple }) as HTMLInputElement;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

/** Make an element (or the whole window) accept dropped files. */
export function dropZone(el: HTMLElement, onFiles: (files: File[]) => void) {
  let depth = 0;
  const has = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  const enter = (e: DragEvent) => {
    if (!has(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('file-over');
  };
  const leave = (e: DragEvent) => {
    if (!has(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('file-over');
  };
  const over = (e: DragEvent) => has(e) && e.preventDefault();
  const drop = (e: DragEvent) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove('file-over');
    onFiles([...(e.dataTransfer?.files ?? [])]);
  };
  el.addEventListener('dragenter', enter);
  el.addEventListener('dragleave', leave);
  el.addEventListener('dragover', over);
  el.addEventListener('drop', drop);
  return () => {
    el.removeEventListener('dragenter', enter);
    el.removeEventListener('dragleave', leave);
    el.removeEventListener('dragover', over);
    el.removeEventListener('drop', drop);
  };
}
