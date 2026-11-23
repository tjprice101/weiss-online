import { clear, confirmDialog, h, modal, toast } from '../util/dom';
import { lsGet, lsSet } from '../util/misc';
import { renderBoard, statusText, type BoardCtx } from './board';
import type { CardInfo, Game } from './game';
import { closeMenu, getMenuTrigger, installMenus, setMenuTrigger } from './menu';
import { openDamage, openLevelUp } from './modals';

export function applyScale() {
  document.documentElement.style.setProperty('--scale', String(lsGet('wom-scale', 1)));
}

export function mountGame(app: HTMLElement, game: Game, onLeave: () => void): () => void {
  installMenus();
  applyScale();

  // ── preview
  const pImg = h('img', { alt: '' }) as HTMLImageElement;
  const pCap = h('div', { class: 'preview-cap' }, 'Hover over a card to zoom in');
  const pNote = h('div', { class: 'preview-note' });
  const previewBox = h('div', { class: 'preview' }, h('div', { class: 'preview-img' }, pImg), pCap, pNote);
  const preview = (info: CardInfo | null, note?: string) => {
    if (!info) return;
    if (info.url) pImg.src = info.url;
    pImg.classList.toggle('landscape', !!info.landscape);
    pCap.textContent = info.name + (info.isClimax ? ' · Climax' : '');
    pNote.textContent = note ?? '';
  };
  const ctx: BoardCtx = { game, preview };
  game.ui.openDamage = (n, fromOpp) => openDamage(ctx, n, fromOpp);
  game.ui.openLevelUp = () => openLevelUp(ctx);

  // ── log + chat
  const logEl = h('div', { class: 'log' });
  const chatIn = h('input', { class: 'input', placeholder: game.mode === 'solo' ? 'Add a note to the log…' : 'Chat with opponent…', maxlength: 300 }) as HTMLInputElement;
  chatIn.onkeydown = (e) => {
    if (e.key === 'Enter') {
      game.chat(chatIn.value);
      chatIn.value = '';
    }
  };
  let lastLogLen = -1;
  const renderLog = () => {
    if (game.log.length === lastLogLen) return;
    lastLogLen = game.log.length;
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    clear(logEl);
    for (const e of game.log.slice(-250)) {
      const who = e.who === 'me' ? game.myName : e.who === 'opp' ? game.oppName : '';
      logEl.append(
        h(
          'div',
          { class: `log-row ${e.who} ${e.chat ? 'chat' : ''}` },
          h('span', { class: 'log-time' }, new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          who ? h('b', null, who + (e.chat ? ': ' : ' ')) : null,
          e.text,
        ),
      );
    }
    if (atBottom || lastLogLen < 5) logEl.scrollTop = logEl.scrollHeight;
  };

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    previewBox,
    h('div', { class: 'log-wrap' }, h('div', { class: 'side-title' }, 'Game log'), logEl, chatIn),
  );

  // ── top bar
  const topInfo = h('div', { class: 'top-info' });
  const renderTop = () => {
    clear(topInfo);
    const dot = game.mode === 'solo' ? 'solo' : game.netStatus;
    topInfo.append(
      h('span', { class: `status-dot ${dot}` }),
      game.mode === 'solo'
        ? h('span', null, 'Solo practice')
        : h('span', null, statusText(game)),
      game.net?.code
        ? h('button', {
            class: 'btn sm',
            title: 'Copy an invite link',
            onclick: () => {
              const url = `${location.origin}${location.pathname}?room=${game.net!.code}`;
              navigator.clipboard.writeText(url).then(() => toast('Invite link copied', 'ok'), () => toast(url, 'info', 10000));
            },
          }, `Room ${game.net.code} 📋`)
        : '',
      game.mode === 'guest' && (game.netStatus === 'disconnected' || game.netStatus === 'error')
        ? h('button', {
            class: 'btn sm primary',
            onclick: () => game.net?.rejoin().catch((e: Error) => toast(e.message, 'error')),
          }, '↻ Reconnect')
        : '',
      h('span', { class: 'muted' }, `Deck: ${game.deckName}`),
    );
  };

  const topbar = h(
    'header',
    { class: 'game-top' },
    h('div', { class: 'brand' }, 'Weiss Online Mat'),
    topInfo,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn sm', title: 'Undo (Ctrl+Z)', onclick: () => game.undo() }, '↶ Undo'),
    h('button', { class: 'btn sm', onclick: () => game.flipCoin() }, '🪙 Coin'),
    h('button', { class: 'btn sm', onclick: () => game.rollDie() }, '🎲 d6'),
    h('button', {
      class: 'btn sm',
      onclick: async () => (await confirmDialog('Start a new game? Your board resets, your deck is shuffled, and you draw 5. You can undo this.', 'New game')) && game.newGame(),
    }, '⟲ New game'),
    h('button', { class: 'btn sm', onclick: openSettings }, '⚙'),
    h('button', { class: 'btn sm', onclick: openHelp }, '?'),
    h('button', {
      class: 'btn sm danger',
      onclick: async () => (await confirmDialog('Leave this game? Solo games are autosaved so you can resume them.', 'Leave')) && onLeave(),
    }, 'Leave'),
  );

  const boardEl = h('main', { class: 'board' });
  const root = h('div', { class: 'game-root' }, topbar, h('div', { class: 'table' }, boardEl, sidebar));
  clear(app);
  app.append(root);

  const render = () => {
    renderBoard(boardEl, ctx);
    renderLog();
    renderTop();
  };
  const unsub = game.subscribe(render);
  render();
  // Handy for debugging from devtools (all of this state is already visible there).
  (window as unknown as { womGame?: Game }).womGame = game;

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select') || document.querySelector('.modal-back')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      game.undo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'd' || e.key === 'D') game.draw(1);
      else if (e.key === 't' || e.key === 'T') game.triggerCheck();
      else if (e.key === 'n' || e.key === 'N') game.nextPhase();
    }
  };
  document.addEventListener('keydown', onKey);
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (game.mode !== 'solo') e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  return () => {
    unsub();
    closeMenu();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    game.destroy();
  };
}

function openSettings() {
  const trig = h(
    'select',
    { class: 'input' },
    h('option', { value: 'hover' }, 'Hover over a zone or card (right-click pins it)'),
    h('option', { value: 'click' }, 'Click a zone or card'),
  ) as HTMLSelectElement;
  trig.value = getMenuTrigger();
  trig.onchange = () => setMenuTrigger(trig.value as 'hover' | 'click');
  const scale = h('input', { type: 'range', min: '0.6', max: '1.4', step: '0.05', value: String(lsGet('wom-scale', 1)) }) as HTMLInputElement;
  scale.oninput = () => {
    lsSet('wom-scale', Number(scale.value));
    applyScale();
  };
  modal({
    title: 'Settings',
    body: h(
      'div',
      { class: 'stack' },
      h('label', null, 'Open action menus by'),
      trig,
      h('label', null, 'Card size'),
      scale,
    ),
  });
}

function openHelp() {
  const li = (k: string, v: string) => h('li', null, h('b', null, k), ' — ', v);
  modal({
    title: 'How to use the mat',
    wide: true,
    body: h(
      'div',
      { class: 'help' },
      h('p', null, 'This mat assumes both players know the rules and their own cards. It moves cards around; it does not enforce rules.'),
      h('h3', null, 'Actions'),
      h('ul', null,
        li('Hover', 'over any zone (Deck, Clock, Stock, Waiting Room, Resolution…) or card to open its action menu. Right-click pins the menu open.'),
        li('X', 'Menus with "X" have a counter at the top. Use −/+, the mouse wheel, or the number keys 1-9 to set it.'),
        li('Drag & drop', 'any of your cards to any zone or stage slot. Dropping on an occupied stage slot from another zone sends the old character to the Waiting Room; dropping from one stage slot to another swaps them.'),
        li('Shift + drop', 'onto a character adds the card as a face-down marker (Shift+Alt for face-up). Shift + drop on the deck puts the card on the bottom.'),
        li('Double-click', 'deck: draw 1 · stage card: stand/rest · resolution card: send to stock.'),
        li('Look at top X', 'opens a viewer: select cards (the order you click is kept), send them anywhere, drag to reorder, then choose where the rest go.'),
        li('Damage', 'Deck menu → "Take X damage", or your opponent sends it from their side. Cards flip one at a time into the Resolution zone and stop at a climax if your library tags it as one.'),
        li('Opponent cards', 'Hover an opponent card to reverse it, rest it, or send it to another zone. Their client applies the change and logs it.'),
      ),
      h('h3', null, 'Keyboard'),
      h('ul', null, li('Ctrl+Z', 'undo'), li('D', 'draw 1'), li('T', 'trigger check'), li('N', 'next phase'), li('Esc', 'close menu / dialog')),
    ),
  });
}
