import { displayName, profileKey, renameProfile, store } from '../store';
import { deckTotal, DECK_SIZE, type CardMeta, type Deck } from '../types';
import { clear, confirmDialog, h, toast } from '../util/dom';
import { lsGet } from '../util/misc';
import { autosaveKey, Game, type CardInfo, type SavedGame } from '../game/game';
import { Net, randomRoomCode } from '../game/net';
import { deckWarnings } from './decks';
import { navigate } from './router';

export type StartGame = (game: Game) => void;
let startGameImpl: StartGame = () => {};
export function setStartGame(fn: StartGame) {
  startGameImpl = fn;
}

async function loadCards(cardIds: string[]): Promise<Map<string, CardInfo>> {
  const s = store();
  const metas = await s.getCardsByIds(cardIds);
  const map = new Map<string, CardInfo>();
  for (const m of metas) {
    map.set(m.id, { id: m.id, name: m.name, landscape: m.landscape, isClimax: m.isClimax, url: await s.getImageUrl(m.id) });
  }
  return map;
}

function expand(deck: Deck): string[] {
  return deck.cards.flatMap((e) => Array.from({ length: e.count }, () => e.cardId));
}

export function renderPlay(root: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room')?.toUpperCase() ?? '';

  let decks: Deck[] = [];
  const metas = new Map<string, CardMeta>();
  const nameIn = h('input', { class: 'input', value: displayName(), placeholder: 'Your name', maxlength: 40 }) as HTMLInputElement;
  nameIn.onchange = () => {
    try {
      renameProfile(nameIn.value);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };
  const deckSel = h('select', { class: 'input' }) as HTMLSelectElement;
  const deckInfo = h('div', { class: 'deck-info' });
  const codeIn = h('input', { class: 'input code-input', placeholder: 'ROOM CODE', value: roomParam, maxlength: 6 }) as HTMLInputElement;
  codeIn.oninput = () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const resumeBox = h('div');

  const selectedDeck = () => decks.find((d) => d.id === deckSel.value) ?? null;

  const drawDeckInfo = () => {
    clear(deckInfo);
    const d = selectedDeck();
    if (!d) {
      deckInfo.append(h('p', { class: 'warn-text' }, 'You have no decks yet. ', h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), navigate('library')) }, 'Upload cards or import a deck .zip'), ' first.'));
      return;
    }
    const w = deckWarnings(d, metas);
    deckInfo.append(
      h('span', { class: `count-pill ${deckTotal(d) === DECK_SIZE ? 'good' : 'bad'}` }, `${deckTotal(d)} cards`),
      w.length ? h('div', { class: 'warn-text' }, w.map((x) => h('div', null, '⚠ ' + x)), h('div', { class: 'muted' }, 'You can still play with this deck.')) : h('span', { class: 'ok-text' }, ' ✓ legal'),
    );
  };
  deckSel.onchange = () => {
    localStorage.setItem(profileKey('wom-last-deck'), deckSel.value);
    drawDeckInfo();
  };

  const busy = (b: boolean) => root.querySelectorAll<HTMLButtonElement>('.play-btn').forEach((x) => (x.disabled = b));

  async function prepare(): Promise<{ deck: Deck; cards: Map<string, CardInfo>; ids: string[]; name: string } | null> {
    const deck = selectedDeck();
    if (!deck) {
      toast('Choose a deck first', 'warn');
      return null;
    }
    const ids = expand(deck);
    if (!ids.length) {
      toast('That deck is empty', 'warn');
      return null;
    }
    const name = nameIn.value.trim() || 'Player';
    const cards = await loadCards(ids);
    const playable = ids.filter((id) => cards.has(id));
    if (playable.length < ids.length) toast(`${ids.length - playable.length} card(s) are missing from the library and were skipped`, 'warn');
    return { deck, cards, ids: playable, name };
  }

  async function start(mode: 'solo' | 'host' | 'guest') {
    if (mode === 'guest' && codeIn.value.trim().length < 4) return toast('Enter the room code', 'warn');
    busy(true);
    let game: Game | null = null;
    let started = false;
    try {
      const p = await prepare();
      if (!p) return;
      game = new Game({ mode, myName: p.name, deckName: p.deck.name, deckCardIds: p.ids, myCards: p.cards });
      if (mode === 'solo') {
        started = true;
        return startGameImpl(game);
      }
      const net = new Net();
      game.attachNet(net);
      if (mode === 'host') {
        for (let tries = 0; ; tries++) {
          try {
            await net.host(randomRoomCode());
            break;
          } catch (e) {
            if (tries > 3) throw e;
            net.destroy();
          }
        }
        game.addLog('sys', `Room created. Share code ${net.code} with your opponent.`, { send: false });
      } else {
        const code = codeIn.value.trim();
        toast('Connecting…', 'info', 2000);
        await net.join(code);
      }
      started = true;
      startGameImpl(game);
    } catch (e) {
      console.error(e);
      toast((e as Error).message || 'Could not start the game', 'error', 7000);
    } finally {
      if (!started) game?.destroy();
      busy(false);
    }
  }

  async function resume(save: SavedGame) {
    busy(true);
    try {
      const cards = await loadCards(save.deckCardIds);
      const game = new Game({
        mode: 'solo',
        myName: nameIn.value.trim() || 'Player',
        deckName: save.deckName,
        deckCardIds: save.deckCardIds,
        myCards: cards,
        restored: save,
      });
      startGameImpl(game);
    } catch (e) {
      toast('Could not resume: ' + (e as Error).message, 'error');
    } finally {
      busy(false);
    }
  }

  const save = lsGet<SavedGame | null>(autosaveKey(), null);
  if (save?.me) {
    const z = save.me.zones;
    const summary = `Turn ${save.meta?.turnNo ?? 1} · Level ${z.level?.length ?? 0} · Clock ${z.clock?.length ?? 0} · Deck ${z.deck?.length ?? 0}`;
    const endGame = async () => {
      if (!(await confirmDialog(`End your solo game with "${save.deckName}"? The saved board is deleted and can't be resumed.`, 'End game'))) return;
      localStorage.removeItem(autosaveKey());
      clear(resumeBox);
      toast('Game ended', 'ok');
    };
    resumeBox.append(
      h('div', { class: 'card-panel resume' },
        h('div', { class: 'grow' },
          h('b', null, 'Ongoing game'),
          h('div', { class: 'muted' }, `Solo · ${save.deckName} · ${summary}`),
          h('div', { class: 'muted small' }, `Saved ${new Date(save.savedAt).toLocaleString()}`),
        ),
        h('button', { class: 'btn primary play-btn', onclick: () => resume(save) }, '▶ Resume'),
        h('button', { class: 'btn danger', title: 'End this game and delete its save', 'aria-label': 'End this game', onclick: endGame }, '✕ End game'),
      ),
    );
  }

  const page = h(
    'div',
    { class: 'page play-page' },
    h('div', { class: 'hero' },
      h('h1', null, 'Weiss Online Mat'),
      h('p', { class: 'muted' }, 'A digital playmat for players who know their cards. Upload a deck of card images, open a room, and play. Every zone has hover actions for drawing, milling, looking at the top X, triggers, damage, and the rest.'),
    ),
    h('div', { class: 'play-grid' },
      h('div', { class: 'card-panel stack' },
        h('h3', null, '1. You'),
        h('label', null, 'Display name'),
        nameIn,
        h('label', null, 'Deck'),
        deckSel,
        deckInfo,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => navigate('decks', deckSel.value) }, '✎ Edit deck'),
          h('button', { class: 'btn sm', onclick: () => navigate('library') }, '⬆ Import deck'),
        ),
      ),
      h('div', { class: 'card-panel stack' },
        h('h3', null, '2. Play'),
        h('button', { class: 'btn primary big play-btn', onclick: () => start('host') }, '🌐 Host online game'),
        h('p', { class: 'muted small' }, 'Creates a room code. Send it (or the invite link) to a friend.'),
        h('div', { class: 'row' }, codeIn, h('button', { class: 'btn primary play-btn', onclick: () => start('guest') }, 'Join')),
        h('div', { class: 'divider' }, 'or'),
        h('button', { class: 'btn big play-btn', onclick: () => start('solo') }, '🃏 Solo practice / goldfish'),
      ),
    ),
    resumeBox,
  );
  root.append(page);

  (async () => {
    try {
      const s = store();
      decks = await s.listDecks();
      const ids = decks.flatMap((d) => d.cards.map((e) => e.cardId));
      for (const m of await s.getCardsByIds(ids)) metas.set(m.id, m);
    } catch (e) {
      toast('Could not load decks: ' + (e as Error).message, 'error');
    }
    clear(deckSel);
    for (const d of decks) deckSel.append(h('option', { value: d.id }, `${d.name} (${deckTotal(d)})`));
    const last = localStorage.getItem(profileKey('wom-last-deck'));
    if (last && decks.some((d) => d.id === last)) deckSel.value = last;
    drawDeckInfo();
  })();
}
