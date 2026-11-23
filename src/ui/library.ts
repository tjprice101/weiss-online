import { store } from '../store';
import type { CardMeta, Deck } from '../types';
import { clear, confirmDialog, h, modal, promptDialog, toast } from '../util/dom';
import { uuid } from '../util/misc';
import { getPrefs } from '../util/prefs';
import { cardImg, forgetUrl, showCardLarge } from './cardview';
import { dropZone, handleUploads, pickFiles } from './uploads';
import { navigate } from './router';

type Sort = 'name' | 'newest' | 'oldest';

export function renderLibrary(root: HTMLElement) {
  let query = '';
  let filter: 'all' | 'climax' | 'other' | 'unused' = 'all';
  let sort: Sort = 'name';
  let cards: CardMeta[] = [];
  let used = new Set<string>();
  let loading = true;
  let selecting = false;
  const selected = new Set<string>();
  let anchor: string | null = null;
  let shown: CardMeta[] = [];

  const grid = h('div', { class: 'card-grid', role: 'list', 'aria-label': 'Card library' });
  const countEl = h('span', { class: 'muted', 'aria-live': 'polite' });
  const search = h('input', { class: 'input', placeholder: 'Search by name…', type: 'search', 'aria-label': 'Search cards by name' }) as HTMLInputElement;
  search.oninput = () => ((query = search.value), draw());
  const filterSel = h(
    'select',
    { class: 'input narrow', 'aria-label': 'Filter cards' },
    h('option', { value: 'all' }, 'All cards'),
    h('option', { value: 'climax' }, 'Climax only'),
    h('option', { value: 'other' }, 'Non-climax'),
    h('option', { value: 'unused' }, 'Not in any deck'),
  ) as HTMLSelectElement;
  filterSel.onchange = () => ((filter = filterSel.value as typeof filter), draw());
  const sortSel = h(
    'select',
    { class: 'input narrow', 'aria-label': 'Sort cards' },
    h('option', { value: 'name' }, 'Sort: name'),
    h('option', { value: 'newest' }, 'Sort: newest'),
    h('option', { value: 'oldest' }, 'Sort: oldest'),
  ) as HTMLSelectElement;
  sortSel.onchange = () => ((sort = sortSel.value as Sort), draw());

  const selectBtn = h('button', { class: 'btn', onclick: () => setSelecting(!selecting), title: 'Select several cards to delete, tag or add to a deck (S)' }, '☑ Select');
  const bulkBar = h('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Selected cards' });

  async function load() {
    loading = true;
    draw();
    try {
      const s = store();
      const [c, decks] = await Promise.all([s.listCards(), s.listDecks()]);
      cards = c;
      used = new Set(decks.flatMap((d) => d.cards.map((e) => e.cardId)));
    } catch (e) {
      toast('Could not load cards: ' + (e as Error).message, 'error');
      cards = [];
    }
    for (const id of [...selected]) if (!cards.some((c) => c.id === id)) selected.delete(id);
    loading = false;
    draw();
  }

  function visible() {
    const q = query.trim().toLowerCase();
    const list = cards.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'unused' ? !used.has(c.id) : filter === 'climax' ? c.isClimax : !c.isClimax)),
    );
    const byName = (a: CardMeta, b: CardMeta) => a.name.localeCompare(b.name, undefined, { numeric: true });
    return list.sort(sort === 'name' ? byName : sort === 'newest' ? (a, b) => b.createdAt - a.createdAt : (a, b) => a.createdAt - b.createdAt);
  }

  function setSelecting(on: boolean) {
    selecting = on;
    if (!on) selected.clear();
    anchor = null;
    draw();
  }

  function draw() {
    clear(grid);
    shown = visible();
    countEl.textContent = loading ? 'Loading…' : `${shown.length} of ${cards.length} cards`;
    if (!loading && !cards.length) {
      grid.append(
        h(
          'div',
          { class: 'empty' },
          h('div', null, h('p', null, 'Your library is empty.'), h('p', { class: 'muted' }, 'Upload card images, or import a deck as a .zip of 50 images. You can also drag files anywhere onto this page.')),
        ),
      );
    }
    for (const c of shown) grid.append(tile(c));
    grid.classList.toggle('selecting', selecting);
    selectBtn.classList.toggle('on', selecting);
    selectBtn.textContent = selecting ? '✕ Done selecting' : '☑ Select';
    drawBulk();
  }

  function drawBulk() {
    clear(bulkBar);
    bulkBar.hidden = !selecting;
    if (!selecting) return;
    const n = selected.size;
    const none = n === 0;
    bulkBar.append(
      h('b', { 'aria-live': 'polite' }, `${n} selected`),
      h('button', { class: 'btn sm', onclick: () => (shown.forEach((c) => selected.add(c.id)), draw()), title: 'Select every card currently shown (Ctrl+A)' }, `Select all shown (${shown.length})`),
      h('button', { class: 'btn sm', disabled: none, onclick: () => (selected.clear(), draw()) }, 'Clear selection'),
      h('button', { class: 'btn sm', onclick: () => (shown.forEach((c) => (selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id))), draw()) }, 'Invert'),
      h('span', { class: 'bulk-sep' }),
      h('button', { class: 'btn sm', disabled: none, onclick: () => setClimax(true) }, 'Mark climax'),
      h('button', { class: 'btn sm', disabled: none, onclick: () => setClimax(false) }, 'Mark not climax'),
      h('button', { class: 'btn sm', disabled: none, onclick: addToDeck }, '＋ Add to deck…'),
      h('button', { class: 'btn sm danger', disabled: none, onclick: () => deleteMany([...selected], 'selected') }, `🗑 Delete selected${n ? ` (${n})` : ''}`),
    );
  }

  function toggle(c: CardMeta, range: boolean) {
    if (range && anchor) {
      const ids = shown.map((x) => x.id);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(c.id);
      if (a >= 0 && b >= 0) {
        const on = !selected.has(c.id) || selected.has(anchor);
        for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? selected.add(id) : selected.delete(id);
      }
    } else if (selected.has(c.id)) selected.delete(c.id);
    else selected.add(c.id);
    anchor = c.id;
    draw();
    (grid.querySelector(`[data-id="${CSS.escape(c.id)}"]`) as HTMLElement | null)?.focus();
  }

  function tile(c: CardMeta) {
    const isSel = selected.has(c.id);
    const actions = h(
      'div',
      { class: 'tile-actions' },
      h('button', { class: 'mini', title: 'Rename', 'aria-label': `Rename ${c.name}`, onclick: (e: Event) => (e.stopPropagation(), rename(c)) }, '✎'),
      h('button', { class: `mini ${c.isClimax ? 'on' : ''}`, title: 'Toggle climax', 'aria-label': `Toggle climax for ${c.name}`, onclick: (e: Event) => (e.stopPropagation(), toggleClimax(c)) }, 'CX'),
      h('button', { class: 'mini danger', title: 'Delete', 'aria-label': `Delete ${c.name}`, onclick: (e: Event) => (e.stopPropagation(), del(c)) }, '🗑'),
    );
    const activate = (e: MouseEvent | KeyboardEvent) => {
      if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
        if (!selecting) selecting = true;
        toggle(c, e.shiftKey);
      } else showCardLarge(c);
    };
    return h(
      'div',
      {
        class: `tile ${isSel ? 'selected' : ''}`,
        title: `${c.name}\nClick: view · Ctrl/Shift+click: select`,
        tabindex: 0,
        role: 'listitem',
        'data-id': c.id,
        'aria-label': c.name + (c.isClimax ? ', climax' : '') + (selecting ? (isSel ? ', selected' : ', not selected') : ''),
        onclick: activate,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(e);
          } else if (e.key === 'Delete' && !selecting) del(c);
        },
      },
      cardImg(c),
      selecting ? h('span', { class: `sel-check ${isSel ? 'on' : ''}`, 'aria-hidden': 'true' }, isSel ? '✓' : '') : null,
      c.isClimax ? h('span', { class: 'badge cx' }, 'CLIMAX') : null,
      !used.has(c.id) && !loading ? h('span', { class: 'badge unused', title: 'Not in any deck' }, 'unused') : null,
      h('div', { class: 'tile-name' }, c.name),
      selecting ? null : actions,
    );
  }

  async function rename(c: CardMeta) {
    const n = await promptDialog('Rename card', c.name, 'Save');
    if (!n || n === c.name) return;
    await store().updateCard(c.id, { name: n });
    c.name = n;
    draw();
  }
  async function toggleClimax(c: CardMeta) {
    c.isClimax = !c.isClimax;
    await store().updateCard(c.id, { isClimax: c.isClimax });
    draw();
  }
  async function setClimax(on: boolean) {
    const s = store();
    const targets = cards.filter((c) => selected.has(c.id) && c.isClimax !== on);
    await Promise.all(targets.map((c) => s.updateCard(c.id, { isClimax: on }).then(() => (c.isClimax = on))));
    toast(`${targets.length} card(s) marked ${on ? 'climax' : 'not climax'}`, 'ok');
    draw();
  }
  async function del(c: CardMeta) {
    if (getPrefs().confirmDeletes && !(await confirmDialog(`Delete "${c.name}" from your library? Decks using it will lose this card.`, 'Delete'))) return;
    await store().deleteCard(c.id);
    forgetUrl(c.id);
    cards = cards.filter((x) => x.id !== c.id);
    selected.delete(c.id);
    draw();
  }

  /** Delete many cards. Asks first, and for large or "all" deletes asks the user to type DELETE. */
  async function deleteMany(ids: string[], what: string) {
    if (!ids.length) return toast('Nothing to delete', 'info');
    const inDecks = ids.filter((id) => used.has(id)).length;
    const msg = `Delete ${ids.length} ${what} card(s) from your library?` + (inDecks ? ` ${inDecks} of them are in decks, which will lose those cards.` : '') + ' This cannot be undone.';
    if (ids.length >= 20 || what === 'all') {
      const typed = await promptDialog(`${msg}\n\nType DELETE to confirm.`, '', 'Delete');
      if (typed?.trim().toUpperCase() !== 'DELETE') return typed != null && toast('Not deleted: you must type DELETE', 'warn');
    } else if (!(await confirmDialog(msg, 'Delete'))) return;
    const s = store();
    const t = toast(`Deleting 0 / ${ids.length}…`, 'info', 120_000);
    let done = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        try {
          await s.deleteCard(id);
          forgetUrl(id);
        } catch {
          failed++;
        }
        if (++done % 10 === 0) t.textContent = `Deleting ${done} / ${ids.length}…`;
      }
    } finally {
      t.remove();
    }
    toast(failed ? `Deleted ${done - failed}, ${failed} failed` : `Deleted ${done} card(s)`, failed ? 'warn' : 'ok');
    selected.clear();
    await load();
  }

  async function addToDeck() {
    const s = store();
    const decks = await s.listDecks();
    const ids = [...selected];
    const copies = h('select', { class: 'input narrow', 'aria-label': 'Copies of each card' }, [1, 2, 3, 4].map((n) => h('option', { value: n }, `${n} cop${n === 1 ? 'y' : 'ies'} each`))) as HTMLSelectElement;
    const apply = async (deck: Deck | null) => {
      const n = Number(copies.value);
      const d: Deck = deck ?? { id: uuid(), name: (await promptDialog('New deck name', 'New Deck', 'Create')) || '', cards: [], updatedAt: Date.now() };
      if (!d.name) return;
      for (const id of ids) {
        const e = d.cards.find((x) => x.cardId === id);
        if (e) e.count += n;
        else d.cards.push({ cardId: id, count: n });
      }
      await s.saveDeck(d);
      m.close();
      toast(`Added ${ids.length} card(s) × ${n} to "${d.name}"`, 'ok', 5000);
      await load();
    };
    const m = modal({
      title: `Add ${ids.length} card(s) to a deck`,
      body: h(
        'div',
        { class: 'stack' },
        copies,
        ...decks.map((d) => h('button', { class: 'btn', onclick: () => apply(d) }, `${d.name} (${d.cards.reduce((a, e) => a + e.count, 0)})`)),
        h('button', { class: 'btn primary', onclick: () => apply(null) }, '＋ New deck'),
      ),
    });
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    const r = await handleUploads(files);
    if (r.cards.length) await load();
  }

  const moreMenu = () => {
    const unused = cards.filter((c) => !used.has(c.id)).map((c) => c.id);
    const m = modal({
      title: 'Clean up library',
      body: h(
        'div',
        { class: 'stack' },
        h('button', { class: 'btn', onclick: () => (m.close(), deleteMany(unused, 'unused')) }, `🧹 Delete cards not in any deck (${unused.length})`),
        h('button', { class: 'btn', disabled: !shown.length || shown.length === cards.length, onclick: () => (m.close(), deleteMany(shown.map((c) => c.id), 'shown')) }, `Delete cards matching the current search/filter (${shown.length})`),
        h('button', { class: 'btn danger', disabled: !cards.length, onclick: () => (m.close(), deleteMany(cards.map((c) => c.id), 'all')) }, `🗑 Delete ALL cards (${cards.length})`),
        h('p', { class: 'muted small' }, 'Tip: use ☑ Select (or Ctrl/Shift+click a card) to pick exactly which cards to delete, tag as climax, or add to a deck.'),
      ),
    });
  };

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('button', { class: 'btn primary', onclick: async () => upload(await pickFiles('image/*')) }, '⬆ Upload card images'),
    h('button', { class: 'btn', onclick: async () => upload(await pickFiles('.zip,application/zip')) }, '📦 Import deck (.zip)'),
    h('button', { class: 'btn', onclick: () => navigate('decks') }, '🃏 Deck builder'),
    selectBtn,
    h('button', { class: 'btn', onclick: moreMenu, title: 'Delete unused cards, delete all cards…' }, '🧹 Clean up…'),
    h('div', { class: 'spacer' }),
    search,
    filterSel,
    sortSel,
  );

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select') || document.querySelector('.modal-back')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selecting = true;
      shown.forEach((c) => selected.add(c.id));
      draw();
    } else if (e.key === 'Escape' && selecting) setSelecting(false);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selecting && selected.size) deleteMany([...selected], 'selected');
    else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) setSelecting(!selecting);
    else if (e.key === '/') {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  const page = h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Card Library'), countEl),
    h(
      'p',
      { class: 'muted' },
      'Every card you upload is kept here and can be reused in any deck. A .zip import adds its images here and also creates a deck. Landscape images are tagged as climax cards automatically; click CX to change that. Shortcuts: S select, Ctrl+A select all, Delete removes selected, / search.',
    ),
    toolbar,
    bulkBar,
    grid,
  );
  root.append(page);
  const undrop = dropZone(page, upload);
  load();
  return () => {
    undrop();
    document.removeEventListener('keydown', onKey);
  };
}
