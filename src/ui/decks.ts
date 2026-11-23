import { zipSync } from 'fflate';
import { store } from '../store';
import { DECK_SIZE, MAX_CLIMAX, MAX_COPIES, deckTotal, type CardMeta, type Deck } from '../types';
import { clear, confirmDialog, h, promptDialog, toast } from '../util/dom';
import { debounce, uuid } from '../util/misc';
import { cardImg, showCardLarge } from './cardview';
import { dropZone, handleUploads, pickFiles } from './uploads';

export function deckWarnings(deck: Deck, metas: Map<string, CardMeta>): string[] {
  const w: string[] = [];
  const total = deckTotal(deck);
  if (total !== DECK_SIZE) w.push(`Deck has ${total} cards; it must have exactly ${DECK_SIZE}.`);
  const cx = deck.cards.reduce((n, e) => n + (metas.get(e.cardId)?.isClimax ? e.count : 0), 0);
  if (cx > MAX_CLIMAX) w.push(`${cx} climax cards (the maximum is ${MAX_CLIMAX}).`);
  const byName = new Map<string, number>();
  for (const e of deck.cards) {
    const n = metas.get(e.cardId)?.name ?? e.cardId;
    byName.set(n, (byName.get(n) ?? 0) + e.count);
  }
  for (const [n, c] of byName) if (c > MAX_COPIES) w.push(`${c} copies of "${n}" (the maximum is ${MAX_COPIES}).`);
  const missing = deck.cards.filter((e) => !metas.has(e.cardId)).length;
  if (missing) w.push(`${missing} card(s) are missing from the library.`);
  return w;
}

export function renderDecks(root: HTMLElement, arg?: unknown) {
  let decks: Deck[] = [];
  let library: CardMeta[] = [];
  const metas = new Map<string, CardMeta>();
  let selected: Deck | null = null;
  let pickerQuery = '';
  let pickerFilter: 'all' | 'climax' | 'other' = 'all';

  const list = h('div', { class: 'deck-list' });
  const editor = h('div', { class: 'deck-editor' });

  // One debounced save per deck, so switching decks quickly never drops a pending edit.
  const s0 = store();
  const pending = new Map<string, ReturnType<typeof debounce<(d: Deck) => void>>>();
  const inflight = new Set<Promise<unknown>>();
  const saveSoon = Object.assign(
    (d: Deck) => {
      let fn = pending.get(d.id);
      if (!fn) {
        fn = debounce((deck: Deck) => {
          pending.delete(deck.id);
          const p = s0
            .saveDeck(deck)
            .then((saved) => {
              deck.updatedAt = saved.updatedAt;
              drawList();
            })
            .catch((e) => toast('Save failed: ' + (e as Error).message, 'error'))
            .finally(() => inflight.delete(p));
          inflight.add(p);
        }, 400);
        pending.set(d.id, fn);
      }
      fn(d);
    },
    {
      flush: () => [...pending.values()].forEach((f) => f.flush()),
      cancel: (id: string) => pending.delete(id),
    },
  );

  async function load(selectId?: string) {
    saveSoon.flush();
    await Promise.all(inflight);
    const s = store();
    [decks, library] = await Promise.all([s.listDecks(), s.listCards()]);
    for (const m of library) metas.set(m.id, m);
    const ids = decks.flatMap((d) => d.cards.map((e) => e.cardId)).filter((id) => !metas.has(id));
    if (ids.length) for (const m of await s.getCardsByIds(ids)) metas.set(m.id, m);
    selected = decks.find((d) => d.id === (selectId ?? selected?.id)) ?? decks[0] ?? null;
    drawList();
    drawEditor();
  }

  function drawList() {
    clear(list);
    list.append(
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary grow', onclick: newDeck }, '＋ New deck'),
        h('button', { class: 'btn', title: 'Import a .zip of card images as a deck', onclick: importZip }, '📦'),
      ),
    );
    if (!decks.length) list.append(h('p', { class: 'muted' }, 'No decks yet.'));
    for (const d of decks) {
      const n = deckTotal(d);
      const warn = deckWarnings(d, metas).length > 0;
      list.append(
        h(
          'button',
          { class: `deck-item ${selected?.id === d.id ? 'active' : ''}`, onclick: () => ((selected = d), drawList(), drawEditor()) },
          h('span', { class: 'deck-item-name' }, d.name),
          h('span', { class: `count-pill ${n === DECK_SIZE && !warn ? 'good' : 'bad'}` }, `${n}`),
        ),
      );
    }
  }

  async function newDeck() {
    const name = await promptDialog('New deck name', 'New Deck', 'Create');
    if (!name) return;
    const d = await store().saveDeck({ id: uuid(), name, cards: [], updatedAt: Date.now() });
    await load(d.id);
  }

  async function importZip() {
    const files = await pickFiles('.zip,application/zip');
    if (!files.length) return;
    const r = await handleUploads(files);
    await load(r.decks[0]?.id);
  }

  function setCount(cardId: string, count: number) {
    if (!selected) return;
    const e = selected.cards.find((x) => x.cardId === cardId);
    if (count <= 0) selected.cards = selected.cards.filter((x) => x.cardId !== cardId);
    else if (e) e.count = count;
    else selected.cards.push({ cardId, count });
    saveSoon(selected);
    drawEditor();
  }
  const countOf = (id: string) => selected?.cards.find((e) => e.cardId === id)?.count ?? 0;

  function drawEditor() {
    clear(editor);
    if (!selected) {
      editor.append(h('div', { class: 'empty' }, 'Create or select a deck.'));
      return;
    }
    const d = selected;
    const total = deckTotal(d);
    const cx = d.cards.reduce((n, e) => n + (metas.get(e.cardId)?.isClimax ? e.count : 0), 0);
    const warnings = deckWarnings(d, metas);

    const nameInput = h('input', { class: 'input title-input', value: d.name }) as HTMLInputElement;
    nameInput.onchange = () => {
      d.name = nameInput.value.trim() || 'Untitled';
      saveSoon(d);
    };

    const head = h(
      'div',
      { class: 'editor-head' },
      nameInput,
      h('span', { class: `count-pill big ${total === DECK_SIZE ? 'good' : 'bad'}` }, `${total} / ${DECK_SIZE}`),
      h('span', { class: `count-pill ${cx <= MAX_CLIMAX ? '' : 'bad'}` }, `CX ${cx} / ${MAX_CLIMAX}`),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => exportZip(d) }, '⬇ Export .zip'),
      h('button', { class: 'btn', onclick: duplicate }, '⧉ Duplicate'),
      h('button', { class: 'btn danger', onclick: delDeck }, '🗑 Delete'),
    );

    const warnBox = warnings.length
      ? h('div', { class: 'warn-box' }, warnings.map((w) => h('div', null, '⚠ ' + w)))
      : h('div', { class: 'ok-box' }, '✓ Deck is legal and ready to play');

    // Deck contents
    const contents = h('div', { class: 'deck-contents' });
    const entries = [...d.cards].sort((a, b) => {
      const ma = metas.get(a.cardId);
      const mb = metas.get(b.cardId);
      return Number(!!ma?.isClimax) - Number(!!mb?.isClimax) || (ma?.name ?? '').localeCompare(mb?.name ?? '');
    });
    if (!entries.length) contents.append(h('p', { class: 'muted' }, 'Click cards in the library below to add them. Right-click a card to remove one copy.'));
    for (const e of entries) {
      const m = metas.get(e.cardId) ?? { id: e.cardId, name: '(missing card)', landscape: false, isClimax: false, hash: '', createdAt: 0 };
      contents.append(
        h(
          'div',
          { class: 'deck-card', title: m.name },
          h('div', { onclick: () => showCardLarge(m as CardMeta) }, cardImg(m)),
          h('div', { class: 'qty' },
            h('button', { class: 'mini', onclick: () => setCount(e.cardId, e.count - 1) }, '−'),
            h('b', null, e.count),
            h('button', { class: 'mini', onclick: () => setCount(e.cardId, e.count + 1) }, '+'),
          ),
          h('div', { class: 'tile-name' }, m.name),
        ),
      );
    }

    // Library picker
    const pickerGrid = h('div', { class: 'card-grid small' });
    const search = h('input', { class: 'input', placeholder: 'Search library…', type: 'search', value: pickerQuery }) as HTMLInputElement;
    const drawPicker = () => {
      clear(pickerGrid);
      const src = library;
      const q = pickerQuery.trim().toLowerCase();
      const shown = src.filter(
        (c) =>
          (!q || c.name.toLowerCase().includes(q)) &&
          (pickerFilter === 'all' || (pickerFilter === 'climax' ? c.isClimax : !c.isClimax)),
      );
      if (!shown.length) pickerGrid.append(h('p', { class: 'muted' }, 'No cards. Upload some images first.'));
      for (const c of shown) {
        const n = countOf(c.id);
        const t = h(
          'div',
          {
            class: `tile pick ${n ? 'in-deck' : ''}`,
            title: `${c.name}\nClick: add a copy · Right-click: remove a copy`,
            onclick: () => setCount(c.id, n + 1),
            oncontextmenu: (ev: Event) => (ev.preventDefault(), n && setCount(c.id, n - 1)),
          },
          cardImg(c),
          n ? h('span', { class: 'badge qty-badge' }, `×${n}`) : null,
          c.isClimax ? h('span', { class: 'badge cx' }, 'CX') : null,
          h('div', { class: 'tile-name' }, c.name),
        );
        pickerGrid.append(t);
      }
    };
    search.oninput = () => ((pickerQuery = search.value), drawPicker());
    const filterSel = h(
      'select',
      { class: 'input narrow' },
      h('option', { value: 'all' }, 'All'),
      h('option', { value: 'climax' }, 'Climax'),
      h('option', { value: 'other' }, 'Non-climax'),
    ) as HTMLSelectElement;
    filterSel.value = pickerFilter;
    filterSel.onchange = () => ((pickerFilter = filterSel.value as typeof pickerFilter), drawPicker());

    const pickerTabs = h(
      'div',
      { class: 'tabs' },
      h('span', { class: 'tab active' }, 'My Library'),
      h('div', { class: 'spacer' }),
      search,
      filterSel,
      h('button', {
        class: 'btn',
        title: 'Upload card images into your library',
        onclick: async () => {
          const f = await pickFiles('image/*');
          if (f.length) {
            await handleUploads(f);
            library = await store().listCards();
            for (const m of library) metas.set(m.id, m);
            drawEditor();
          }
        },
      }, '⬆ Add images'),
    );
    drawPicker();

    editor.append(
      head,
      warnBox,
      h('h3', null, 'Deck'),
      contents,
      h('h3', null, 'Add cards'),
      pickerTabs,
      pickerGrid,
    );
  }

  async function duplicate() {
    if (!selected) return;
    const d = await store().saveDeck({ ...selected, id: uuid(), name: selected.name + ' (copy)', cards: selected.cards.map((e) => ({ ...e })) });
    await load(d.id);
  }

  async function delDeck() {
    if (!selected) return;
    if (!(await confirmDialog(`Delete deck "${selected.name}"? Cards stay in your library.`, 'Delete'))) return;
    saveSoon.cancel(selected.id);
    await store().deleteDeck(selected.id);
    selected = null;
    await load();
  }

  async function exportZip(d: Deck) {
    const t = toast('Building zip…', 'info', 120_000);
    try {
      const files: Record<string, Uint8Array> = {};
      let i = 0;
      for (const e of d.cards) {
        const m = metas.get(e.cardId);
        if (!m) continue;
        const blob = await store().getImageBlob(e.cardId);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const safe = m.name.replace(/[\\/:*?"<>|]+/g, '_');
        for (let k = 0; k < e.count; k++) files[`${String(++i).padStart(2, '0')} ${safe}.${ext}`] = bytes;
      }
      const zipped = zipSync(files, { level: 0 });
      const a = h('a', { href: URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' })), download: `${d.name}.zip` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast('Export failed: ' + (e as Error).message, 'error');
    } finally {
      t.remove();
    }
  }

  const page = h(
    'div',
    { class: 'page deck-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Deck Builder')),
    h('div', { class: 'deck-layout' }, list, editor),
  );
  root.append(page);
  const undrop = dropZone(page, async (files) => {
    const r = await handleUploads(files);
    await load(r.decks[0]?.id);
  });
  load(typeof arg === 'string' ? arg : undefined);
  return () => {
    saveSoon.flush();
    undrop();
  };
}
