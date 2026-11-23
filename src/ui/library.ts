import { store, cloudEnabled } from '../store';
import type { CardMeta } from '../types';
import { clear, confirmDialog, h, promptDialog, toast } from '../util/dom';
import { cardImg, showCardLarge } from './cardview';
import { dropZone, handleUploads, pickFiles } from './uploads';
import { navigate } from './router';

export function renderLibrary(root: HTMLElement) {
  let tab: 'mine' | 'community' = 'mine';
  let query = '';
  let filter: 'all' | 'climax' | 'other' = 'all';
  let cards: CardMeta[] = [];
  let loading = true;

  const grid = h('div', { class: 'card-grid' });
  const countEl = h('span', { class: 'muted' });
  const search = h('input', { class: 'input', placeholder: 'Search by name…', type: 'search' }) as HTMLInputElement;
  search.oninput = () => ((query = search.value), draw());
  const filterSel = h(
    'select',
    { class: 'input narrow' },
    h('option', { value: 'all' }, 'All cards'),
    h('option', { value: 'climax' }, 'Climax only'),
    h('option', { value: 'other' }, 'Non-climax'),
  ) as HTMLSelectElement;
  filterSel.onchange = () => ((filter = filterSel.value as typeof filter), draw());

  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => {
    clear(tabs);
    tabs.append(
      h('button', { class: `tab ${tab === 'mine' ? 'active' : ''}`, onclick: () => ((tab = 'mine'), load()) }, 'My Library'),
      cloudEnabled && store().kind === 'cloud'
        ? h('button', { class: `tab ${tab === 'community' ? 'active' : ''}`, onclick: () => ((tab = 'community'), load()) }, 'Community')
        : '',
    );
  };

  async function load() {
    drawTabs();
    loading = true;
    draw();
    try {
      const s = store();
      cards = tab === 'mine' ? await s.listCards() : (await s.listCommunityCards?.(query)) ?? [];
    } catch (e) {
      toast('Could not load cards: ' + (e as Error).message, 'error');
      cards = [];
    }
    loading = false;
    draw();
  }

  function draw() {
    clear(grid);
    const q = query.trim().toLowerCase();
    const shown = cards.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'climax' ? c.isClimax : !c.isClimax)),
    );
    countEl.textContent = loading ? 'Loading…' : `${shown.length} of ${cards.length} cards`;
    if (!loading && !cards.length) {
      grid.append(
        h(
          'div',
          { class: 'empty' },
          tab === 'mine'
            ? h('div', null, h('p', null, 'Your library is empty.'), h('p', { class: 'muted' }, 'Upload card images, or import a deck as a .zip of 50 images. You can also drag files anywhere onto this page.'))
            : 'No community cards yet.',
        ),
      );
    }
    for (const c of shown) grid.append(tile(c));
  }

  function tile(c: CardMeta) {
    const mine = tab === 'mine';
    const actions = mine
      ? h(
          'div',
          { class: 'tile-actions' },
          h('button', { class: 'mini', title: 'Rename', onclick: (e: Event) => (e.stopPropagation(), rename(c)) }, '✎'),
          h('button', { class: `mini ${c.isClimax ? 'on' : ''}`, title: 'Toggle climax', onclick: (e: Event) => (e.stopPropagation(), toggleClimax(c)) }, 'CX'),
          h('button', { class: 'mini danger', title: 'Delete', onclick: (e: Event) => (e.stopPropagation(), del(c)) }, '🗑'),
        )
      : null;
    return h(
      'div',
      { class: 'tile', onclick: () => showCardLarge(c), title: c.name },
      cardImg(c),
      c.isClimax ? h('span', { class: 'badge cx' }, 'CLIMAX') : null,
      h('div', { class: 'tile-name' }, c.name),
      actions,
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
  async function del(c: CardMeta) {
    if (!(await confirmDialog(`Delete "${c.name}" from your library? Decks using it will lose this card.`, 'Delete'))) return;
    await store().deleteCard(c.id);
    cards = cards.filter((x) => x.id !== c.id);
    draw();
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    const r = await handleUploads(files);
    if (r.cards.length) {
      tab = 'mine';
      await load();
    }
  }

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('button', { class: 'btn primary', onclick: async () => upload(await pickFiles('image/*')) }, '⬆ Upload card images'),
    h('button', { class: 'btn', onclick: async () => upload(await pickFiles('.zip,application/zip')) }, '📦 Import deck (.zip)'),
    h('button', { class: 'btn', onclick: () => navigate('decks') }, '🃏 Deck builder'),
    h('div', { class: 'spacer' }),
    search,
    filterSel,
  );

  const page = h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Card Library'), countEl),
    h(
      'p',
      { class: 'muted' },
      'Every card you upload is kept here and can be reused in any deck. A .zip import adds its images here and also creates a deck. Landscape images are tagged as climax cards automatically; click CX to change that.',
    ),
    tabs,
    toolbar,
    grid,
  );
  root.append(page);
  const undrop = dropZone(page, upload);
  search.addEventListener('keydown', (e) => e.key === 'Enter' && tab === 'community' && load());
  load();
  return () => undrop();
}
