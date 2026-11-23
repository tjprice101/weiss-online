import { clear, h, promptDialog } from '../util/dom';
import type { CardInfo, Game } from './game';
import { PHASES } from './game';
import { attachMenu, setDragging, type MenuItem, type MenuSection, type MenuSpec } from './menu';
import {
  OWNER_HIDDEN_ZONES, STAGE_SHORT, STAGE_ZONES, ZONE_LABEL, isCenter, isStage,
  type Inst, type Pos, type PubInst, type Zone,
} from './state';
import { openDamage, openLevelUp, openMulligan, openOppViewer, openZoneViewer } from './modals';

export type Side = 'me' | 'opp';
export interface BoardCtx {
  game: Game;
  preview: (info: CardInfo | null, note?: string) => void;
}

const DRAG_TYPE = 'text/wom-iid';

export interface Dest {
  label: string;
  zone: Zone;
  pos?: Pos;
  faceDown?: boolean;
}
export const DESTS: Dest[] = [
  { label: 'Hand', zone: 'hand' },
  { label: 'Waiting Room', zone: 'waiting' },
  { label: 'Stock', zone: 'stock' },
  { label: 'Clock', zone: 'clock' },
  { label: 'Level', zone: 'level' },
  { label: 'Memory', zone: 'memory' },
  { label: 'Memory (face-down)', zone: 'memory', faceDown: true },
  { label: 'Resolution', zone: 'resolution' },
  { label: 'Climax', zone: 'climax' },
  { label: 'Deck top', zone: 'deck', pos: 'top' },
  { label: 'Deck bottom', zone: 'deck', pos: 'bottom' },
];

function destItems(game: Game, iids: () => string[], exclude: Zone[] = []): MenuItem[] {
  return DESTS.filter((d) => !exclude.includes(d.zone) || d.zone === 'deck' || d.faceDown).map((d) => ({
    label: d.label,
    run: () => game.moveCards(iids(), d.zone, d.pos ?? 'top', !!d.faceDown),
  }));
}

function stageItems(game: Game, iid: string, except?: Zone): MenuItem[] {
  return STAGE_ZONES.filter((z) => z !== except).map((z) => {
    const occ = game.me.zones[z][0];
    return {
      label: STAGE_SHORT[z],
      title: `${ZONE_LABEL[z]}${occ ? ` (occupied by “${game.cardName(occ.cardId)}”)` : ''}`,
      run: () => game.move(iid, z),
    };
  });
}

// ─────────────────────────────── card element ───────────────────────────────

export function cardInfoFor(game: Game, side: Side, cardId: string | null): CardInfo | undefined {
  if (!cardId) return undefined;
  return side === 'me' ? game.myCards.get(cardId) : game.oppCards.get(cardId);
}

export function faceVisible(side: Side, zone: Zone, c: Inst | PubInst): boolean {
  if (side === 'opp') return c.cardId != null && (!c.faceDown || c.revealed);
  if (c.revealed) return true;
  if (c.faceDown) return false;
  return !OWNER_HIDDEN_ZONES.includes(zone);
}

/** Basic visual card (no interactivity). */
export function cardVisual(info: CardInfo | undefined, faceUp: boolean, extraClass = ''): HTMLElement {
  const el = h('div', { class: `card ${faceUp ? '' : 'back'} ${faceUp && info?.landscape ? 'landscape' : ''} ${extraClass}` });
  if (faceUp && info?.url) el.append(h('img', { src: info.url, draggable: false, alt: info.name }));
  else if (faceUp) el.append(h('div', { class: 'card-fallback' }, info?.name ?? 'Loading…'));
  else el.append(h('div', { class: 'card-back-art' }));
  return el;
}

function cardEl(ctx: BoardCtx, side: Side, c: Inst | PubInst, zone: Zone, withMenu = true): HTMLElement {
  const { game } = ctx;
  const info = cardInfoFor(game, side, c.cardId);
  const faceUp = faceVisible(side, zone, c);
  const el = cardVisual(info, faceUp, `${c.state} ${c.revealed ? 'revealed' : ''}`);
  el.dataset.iid = c.iid;
  el.dataset.zone = zone;
  if (c.power) el.append(h('span', { class: 'pbadge' }, `${c.power > 0 ? '+' : ''}${c.power}`));
  if (c.note) el.append(h('span', { class: 'nbadge', title: c.note }, c.note));
  if (c.revealed && (zone === 'hand' || zone === 'deck' || zone === 'stock')) el.append(h('span', { class: 'rbadge' }, 'REVEALED'));

  el.addEventListener('mouseenter', () => {
    if (faceUp) ctx.preview(info ?? null, c.note || undefined);
    else if (side === 'me' && !OWNER_HIDDEN_ZONES.includes(zone)) ctx.preview(info ?? null, 'Face-down (only you can see this)');
  });

  if (side === 'me') {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData(DRAG_TYPE, c.iid);
      e.dataTransfer!.effectAllowed = 'move';
      setDragging(true);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      setDragging(false);
      el.classList.remove('dragging');
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (isStage(zone)) game.setState(c.iid, c.state === 'stand' ? 'rest' : 'stand');
      else if (zone === 'resolution') game.move(c.iid, 'stock');
    });
    if (withMenu) attachMenu(el, () => myCardMenu(ctx, c as Inst, zone));
  } else if (withMenu) {
    attachMenu(el, () => oppCardMenu(ctx, c as PubInst, zone));
  }
  return el;
}

// ─────────────────────────────── menus: my side ───────────────────────────────

function myCardMenu(ctx: BoardCtx, c: Inst, zone: Zone): MenuSpec | null {
  const { game } = ctx;
  const name = game.cardName(c.cardId);
  const id = () => [c.iid];
  const secs: MenuSection[] = [];

  if (zone === 'hand') {
    secs.push({ title: 'Play to stage', compact: true, items: stageItems(game, c.iid) });
    secs.push({
      items: [
        { label: '→ Climax Zone', run: () => game.move(c.iid, 'climax') },
        { label: '→ Resolution (event / counter)', run: () => game.move(c.iid, 'resolution') },
        { label: 'Clock & draw 2 (clock phase)', run: () => game.clockAndDraw(c.iid) },
        c.revealed
          ? { label: 'Hide (un-reveal)', run: () => game.setRevealed([c.iid], false) }
          : { label: 'Reveal to opponent', run: () => game.setRevealed([c.iid], true) },
      ],
    });
    secs.push({ title: 'Move to', compact: true, items: destItems(game, id, ['hand', 'climax', 'resolution']) });
  } else if (isStage(zone)) {
    secs.push({
      title: 'State',
      compact: true,
      items: [
        { label: 'Stand', run: () => game.setState(c.iid, 'stand'), primary: c.state === 'stand' },
        { label: 'Rest', run: () => game.setState(c.iid, 'rest'), primary: c.state === 'rest' },
        { label: 'Reverse', run: () => game.setState(c.iid, 'reverse'), primary: c.state === 'reverse' },
      ],
    });
    if (isCenter(zone))
      secs.push({
        title: 'Attack (rests + trigger check)',
        compact: true,
        items: [
          { label: 'Front', run: () => game.attack(c.iid, 'Front') },
          { label: 'Side', run: () => game.attack(c.iid, 'Side') },
          { label: 'Direct', run: () => game.attack(c.iid, 'Direct') },
        ],
      });
    secs.push({
      title: 'Power / notes',
      compact: true,
      items: [
        { label: '+500', run: () => game.addPower(c.iid, 500) },
        { label: '+1000', run: () => game.addPower(c.iid, 1000) },
        { label: '+X×500', x: true, run: (x) => game.addPower(c.iid, 500 * x) },
        { label: '−500', run: () => game.addPower(c.iid, -500) },
        { label: '−1000', run: () => game.addPower(c.iid, -1000) },
        { label: 'Reset', run: () => game.addPower(c.iid, -c.power), disabled: !c.power },
        {
          label: 'Note…',
          run: async () => {
            const n = await promptDialog('Note on card (e.g. "Soul +1", "can\'t be frontal attacked")', c.note, 'Save');
            if (n !== null) game.setNote(c.iid, n.trim());
          },
        },
      ],
    });
    secs.push({
      title: 'Encore / markers',
      items: [
        { label: 'Encore: pay 3 stock → rested', run: () => game.encore(c.iid, 3) },
        { label: 'Encore: pay X stock', x: true, run: (x) => game.encore(c.iid, x) },
        { label: 'Encore: free (rested)', run: () => game.encore(c.iid, 0) },
        { label: 'Top of deck → marker (face-down)', run: () => game.markerFromTop(c.iid, true) },
        { label: 'Top of deck → marker (face-up)', run: () => game.markerFromTop(c.iid, false) },
        { label: `View markers (${c.markers.length})`, run: () => openZoneViewer(ctx, { zone, markerHost: c.iid, title: `Markers under “${name}”` }), disabled: !c.markers.length },
      ],
    });
    secs.push({ title: 'Move to stage slot', compact: true, items: stageItems(game, c.iid, zone) });
    secs.push({ title: 'Move to', compact: true, items: destItems(game, id) });
  } else if (zone === 'resolution') {
    secs.push({
      items: [
        { label: '→ Stock (trigger done)', primary: true, run: () => game.move(c.iid, 'stock') },
        { label: '→ Waiting Room', run: () => game.move(c.iid, 'waiting') },
        { label: '→ Hand', run: () => game.move(c.iid, 'hand') },
        { label: '→ Clock', run: () => game.move(c.iid, 'clock') },
      ],
    });
    secs.push({ title: 'Play to stage', compact: true, items: stageItems(game, c.iid) });
    secs.push({ title: 'Move to', compact: true, items: destItems(game, id, ['resolution', 'waiting', 'hand', 'clock', 'stock']) });
  } else if (zone === 'clock') {
    const idx = game.me.zones.clock.findIndex((x) => x.iid === c.iid);
    const items: MenuItem[] = [];
    if (game.me.zones.clock.length >= 7 && idx < 7) items.push({ label: '★ Level up with this card', primary: true, run: () => game.levelUp(c.iid) });
    items.push({ label: '→ Waiting Room (heal)', run: () => game.move(c.iid, 'waiting') });
    secs.push({ items });
    secs.push({ title: 'Play to stage', compact: true, items: stageItems(game, c.iid) });
    secs.push({ title: 'Move to', compact: true, items: destItems(game, id, ['clock']) });
  } else {
    // level, climax, memory (spread)
    if (zone === 'memory' || c.faceDown)
      secs.push({ items: [{ label: c.faceDown ? 'Turn face-up' : 'Turn face-down', run: () => game.flipFaceDown(c.iid) }] });
    secs.push({ title: 'Play to stage', compact: true, items: stageItems(game, c.iid) });
    secs.push({ title: 'Move to', compact: true, items: destItems(game, id, [zone]) });
  }
  return { title: name, subtitle: isStage(zone) ? `${ZONE_LABEL[zone]} · ${c.state}` : ZONE_LABEL[zone], useX: isStage(zone), sections: secs };
}

function zoneMenu(ctx: BoardCtx, zone: Zone): MenuSpec | null {
  const { game } = ctx;
  const z = game.me.zones;
  const n = z[zone].length;
  const title = `${ZONE_LABEL[zone]} (${n})`;
  switch (zone) {
    case 'deck': {
      const top = z.deck[0];
      return {
        title,
        useX: true,
        sections: [
          {
            title: 'Draw',
            compact: true,
            items: [
              { label: 'Draw 1', primary: true, run: () => game.draw(1) },
              { label: 'Draw X', x: true, run: (x) => game.draw(x) },
            ],
          },
          {
            title: 'Look / search',
            items: [
              { label: 'Look at top X', x: true, run: (x) => lookTop(ctx, x) },
              { label: 'Search whole deck', run: () => searchDeck(ctx) },
              top?.revealed
                ? { label: 'Hide top card', run: () => game.setRevealed([top.iid], false) }
                : { label: 'Reveal top card', run: () => top && game.setRevealed([top.iid], true), disabled: !top },
            ],
          },
          {
            title: 'Resolution zone',
            items: [
              { label: 'Trigger check (top → Resolution)', primary: true, run: () => game.triggerCheck() },
              { label: 'Top X → Resolution', x: true, run: (x) => game.moveTop('resolution', x) },
              { label: 'Bottom card → Resolution', run: () => game.moveBottom('resolution', 1) },
              { label: 'Bottom X → Resolution', x: true, run: (x) => game.moveBottom('resolution', x) },
            ],
          },
          {
            title: 'Send top X to…',
            compact: true,
            items: [
              { label: 'Waiting Room', run: (x) => game.moveTop('waiting', x, { label: `Mill ${x}` }) },
              { label: 'Stock', run: (x) => game.moveTop('stock', x) },
              { label: 'Clock', run: (x) => game.moveTop('clock', x) },
              { label: 'Memory', run: (x) => game.moveTop('memory', x) },
              { label: 'Memory (face-down)', run: (x) => game.moveTop('memory', x, { faceDown: true }) },
              { label: 'Level', run: (x) => game.moveTop('level', x) },
              { label: 'Bottom of deck', run: (x) => game.moveTop('deck', x, { pos: 'bottom', label: `Top ${x} to bottom` }) },
            ],
          },
          {
            title: 'Other',
            items: [
              { label: 'Take X damage…', x: true, run: (x) => openDamage(ctx, x, false) },
              { label: 'Shuffle deck', run: () => game.shuffle() },
              { label: 'Refresh (Waiting Room → deck, +1 clock)', run: () => game.refresh(), primary: n === 0 },
            ],
          },
        ],
      };
    }
    case 'hand':
      return {
        title,
        useX: true,
        sections: [
          {
            items: [
              { label: 'Draw 1', primary: true, run: () => game.draw(1) },
              { label: 'Draw X', x: true, run: (x) => game.draw(x) },
              { label: 'Mulligan…', run: () => openMulligan(ctx) },
              { label: 'View / select from hand…', run: () => openZoneViewer(ctx, { zone: 'hand' }) },
              { label: 'Reveal whole hand', run: () => game.setRevealed(z.hand.map((c) => c.iid), true), disabled: !n },
              { label: 'Hide revealed cards', run: () => game.hideAllRevealed() },
            ],
          },
        ],
      };
    case 'waiting':
      return {
        title,
        useX: true,
        sections: [
          {
            items: [
              { label: 'View / search Waiting Room', primary: true, run: () => openZoneViewer(ctx, { zone: 'waiting' }), disabled: !n },
              { label: 'Top card → Hand', run: () => n && game.move(z.waiting[n - 1].iid, 'hand'), disabled: !n },
              { label: 'Top X → Stock', x: true, run: (x) => game.moveCards(z.waiting.slice(-x).map((c) => c.iid), 'stock'), disabled: !n },
              { label: 'Top X → Clock', x: true, run: (x) => game.moveCards(z.waiting.slice(-x).map((c) => c.iid), 'clock'), disabled: !n },
              { label: 'Refresh (shuffle into deck, +1 clock)', run: () => game.refresh(), disabled: !n },
            ],
          },
        ],
      };
    case 'stock':
      return {
        title,
        useX: true,
        sections: [
          {
            title: 'Pay cost (top of stock → Waiting Room)',
            compact: true,
            items: [
              { label: 'Pay 1', primary: true, run: () => game.payStock(1) },
              { label: 'Pay 2', run: () => game.payStock(2) },
              { label: 'Pay 3', run: () => game.payStock(3) },
              { label: 'Pay X', x: true, run: (x) => game.payStock(x) },
            ],
          },
          {
            items: [
              { label: 'Top of stock → Hand', run: () => n && game.move(z.stock[n - 1].iid, 'hand'), disabled: !n },
              { label: 'Top X of stock → Clock', x: true, run: (x) => game.moveCards(z.stock.slice(-x).reverse().map((c) => c.iid), 'clock'), disabled: !n },
              { label: 'Bottom of stock → Waiting Room', run: () => n && game.move(z.stock[0].iid, 'waiting'), disabled: !n },
              { label: 'Look at stock…', run: () => openZoneViewer(ctx, { zone: 'stock' }), disabled: !n },
            ],
          },
        ],
      };
    case 'clock':
      return {
        title,
        useX: true,
        sections: [
          {
            items: [
              { label: '★ Level up…', primary: n >= 7, run: () => openLevelUp(ctx), disabled: n < 7 },
              { label: 'Heal 1 (top of clock → Waiting Room)', run: () => game.heal(1), disabled: !n },
              { label: 'Heal X', x: true, run: (x) => game.heal(x), disabled: !n },
              { label: 'View clock', run: () => openZoneViewer(ctx, { zone: 'clock' }), disabled: !n },
            ],
          },
        ],
      };
    case 'resolution':
      return {
        title,
        sections: [
          {
            title: 'Move all resolution cards',
            items: [
              { label: 'All → Stock', primary: true, run: () => game.moveCards(z.resolution.map((c) => c.iid), 'stock'), disabled: !n },
              { label: 'All → Waiting Room', run: () => game.moveCards(z.resolution.map((c) => c.iid), 'waiting'), disabled: !n },
              { label: 'All → Clock (damage)', run: () => game.moveCards(z.resolution.map((c) => c.iid), 'clock'), disabled: !n },
              { label: 'All → Hand', run: () => game.moveCards(z.resolution.map((c) => c.iid), 'hand'), disabled: !n },
              { label: 'All → Deck bottom', run: () => game.moveCards(z.resolution.map((c) => c.iid), 'deck', 'bottom'), disabled: !n },
              { label: 'View / select…', run: () => openZoneViewer(ctx, { zone: 'resolution' }), disabled: !n },
            ],
          },
        ],
      };
    case 'climax':
      return n
        ? { title, sections: [{ items: [{ label: 'Climax → Waiting Room', primary: true, run: () => game.moveCards(z.climax.map((c) => c.iid), 'waiting') }] }] }
        : null;
    case 'level':
    case 'memory':
      return {
        title,
        sections: [{ items: [{ label: `View ${ZONE_LABEL[zone]}`, run: () => openZoneViewer(ctx, { zone }), disabled: !n }] }],
      };
    default:
      return null;
  }
}

function lookTop(ctx: BoardCtx, x: number) {
  const ids = ctx.game.me.zones.deck.slice(0, x).map((c) => c.iid);
  if (!ids.length) return;
  ctx.game.addLog('me', `Looked at the top ${ids.length} card(s) of deck`);
  openZoneViewer(ctx, { zone: 'deck', iids: ids, lookTop: true, title: `Top ${ids.length} of deck` });
}
function searchDeck(ctx: BoardCtx) {
  ctx.game.addLog('me', 'Searching deck…');
  openZoneViewer(ctx, { zone: 'deck', search: true, title: 'Search deck' });
}

// ─────────────────────────────── menus: opponent ───────────────────────────────

function oppCardMenu(ctx: BoardCtx, c: PubInst, zone: Zone): MenuSpec | null {
  const { game } = ctx;
  if (game.mode === 'solo') return null;
  const name = c.cardId ? game.cardName(c.cardId) : 'Face-down card';
  const mv = (to: Zone, pos?: 'top' | 'bottom'): MenuItem => ({
    label: ZONE_LABEL[to] + (pos === 'bottom' ? ' (bottom)' : to === 'deck' ? ' (top)' : ''),
    run: () => game.remote({ kind: 'move', iid: c.iid, to, pos }),
  });
  const secs: MenuSection[] = [];
  if (isStage(zone))
    secs.push({
      title: 'Opponent card state',
      compact: true,
      items: (['stand', 'rest', 'reverse'] as const).map((s) => ({
        label: s[0].toUpperCase() + s.slice(1),
        primary: c.state === s,
        run: () => game.remote({ kind: 'state', iid: c.iid, state: s }),
      })),
    });
  secs.push({
    title: 'Send opponent card to…',
    compact: true,
    items: [mv('waiting'), mv('hand'), mv('stock'), mv('clock'), mv('memory'), mv('deck', 'top'), mv('deck', 'bottom')].filter(
      (i) => !i.label.startsWith(ZONE_LABEL[zone]),
    ),
  });
  return { title: name, subtitle: `${game.oppName} · ${ZONE_LABEL[zone]}`, sections: secs };
}

function oppZoneMenu(ctx: BoardCtx, zone: Zone): MenuSpec | null {
  const { game } = ctx;
  const n = game.opp?.zones[zone].length ?? 0;
  const title = `${game.oppName}: ${ZONE_LABEL[zone]} (${n})`;
  const view: MenuItem = { label: `View ${ZONE_LABEL[zone]}`, run: () => openOppViewer(ctx, zone), disabled: !n };
  if (zone === 'deck')
    return {
      title,
      useX: true,
      sections: [
        { items: [
          { label: 'Deal X damage (they flip cards)', x: true, primary: true, run: (x) => game.remote({ kind: 'damage', n: x }), disabled: game.mode === 'solo' },
        ] },
      ],
    };
  if (['waiting', 'clock', 'memory', 'level', 'resolution', 'stock'].includes(zone)) return { title, sections: [{ items: [view] }] };
  return null;
}

// ─────────────────────────────── zone rendering ───────────────────────────────

function dropTarget(ctx: BoardCtx, el: HTMLElement, zone: Zone) {
  const { game } = ctx;
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node)) el.classList.remove('drop-over');
  });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-over');
    const iid = e.dataTransfer?.getData(DRAG_TYPE);
    if (!iid) return;
    e.preventDefault();
    e.stopPropagation();
    const f = game.find(iid);
    if (!f) return;
    if (isStage(zone)) {
      const occ = game.me.zones[zone][0];
      if (e.shiftKey && occ && occ.iid !== iid) game.addMarker(iid, occ.iid, !e.altKey);
      else game.move(iid, zone);
      return;
    }
    // Reorder within the same spread zone when dropped on another card.
    const overCard = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (overCard && f.zone === zone && !f.host && overCard.dataset.iid && overCard.dataset.iid !== iid) {
      game.reorder(iid, overCard.dataset.iid);
      return;
    }
    if (f.zone === zone && !f.host) return;
    game.move(iid, zone, zone === 'deck' && e.shiftKey ? 'bottom' : 'top', zone === 'memory' && e.altKey);
  });
}

function zoneLabel(text: string, count?: number) {
  return h('div', { class: 'zlabel' }, text, count !== undefined ? h('span', { class: 'zcount' }, count) : null);
}

function pile(ctx: BoardCtx, side: Side, zone: Zone): HTMLElement {
  const { game } = ctx;
  const cards = side === 'me' ? game.me.zones[zone] : game.opp?.zones[zone] ?? [];
  const n = cards.length;
  const el = h('div', { class: `zone pile z-${zone}` }, zoneLabel(ZONE_LABEL[zone], n));
  const stack = h('div', { class: 'pile-stack' });
  if (n) {
    // deck: index 0 is top; others: last is top
    const top = zone === 'deck' ? cards[0] : cards[n - 1];
    if (n > 1) stack.append(h('div', { class: 'pile-depth', style: { '--depth': String(Math.min(6, Math.ceil(n / 6))) } }));
    stack.append(cardEl(ctx, side, top, zone, false));
  } else stack.append(h('div', { class: 'slot-empty' }));
  el.append(stack);
  // Piles use the zone menu rather than the top card's menu.
  if (side === 'me') {
    attachMenu(el, () => zoneMenu(ctx, zone));
    dropTarget(ctx, el, zone);
    if (zone === 'deck') el.addEventListener('dblclick', () => game.draw(1));
  } else attachMenu(el, () => oppZoneMenu(ctx, zone));
  if (zone === 'deck' && side === 'me' && n === 0) el.classList.add('alert');
  return el;
}

function spread(ctx: BoardCtx, side: Side, zone: Zone, opts: { label?: boolean; slots?: number } = {}): HTMLElement {
  const { game } = ctx;
  const cards = side === 'me' ? game.me.zones[zone] : game.opp?.zones[zone] ?? [];
  const el = h('div', { class: `zone spread z-${zone}` });
  if (opts.label !== false) el.append(zoneLabel(ZONE_LABEL[zone], cards.length));
  const row = h('div', { class: 'spread-row' });
  cards.forEach((c, i) => {
    const ce = cardEl(ctx, side, c, zone);
    ce.style.setProperty('--i', String(i));
    row.append(ce);
  });
  if (opts.slots) for (let i = cards.length; i < opts.slots; i++) row.append(h('div', { class: 'slot-empty ghost' }));
  if (!cards.length && !opts.slots) row.append(h('div', { class: 'slot-empty ghost' }));
  el.append(row);
  if (side === 'me') {
    attachMenu(el, () => zoneMenu(ctx, zone));
    dropTarget(ctx, el, zone);
  } else attachMenu(el, () => oppZoneMenu(ctx, zone));
  return el;
}

function stageSlot(ctx: BoardCtx, side: Side, zone: Zone): HTMLElement {
  const { game } = ctx;
  const cards = side === 'me' ? game.me.zones[zone] : game.opp?.zones[zone] ?? [];
  const c = cards[0];
  const el = h('div', { class: `zone stage-slot ${isCenter(zone) ? 'center' : 'back'}` }, h('div', { class: 'slot-label' }, STAGE_SHORT[zone]));
  if (c) {
    const ce = cardEl(ctx, side, c, zone);
    el.append(ce);
    if (c.markers.length) {
      const mk = h('div', { class: 'markers', title: `${c.markers.length} marker(s)` }, `▤ ${c.markers.length}`);
      if (side === 'me') mk.onclick = (e) => (e.stopPropagation(), openZoneViewer(ctx, { zone, markerHost: c.iid, title: `Markers under “${game.cardName(c.cardId)}”` }));
      else mk.onclick = (e) => (e.stopPropagation(), openOppViewer(ctx, zone, c.iid));
      el.append(mk);
    }
  } else el.append(h('div', { class: 'slot-empty' }));
  if (side === 'me') dropTarget(ctx, el, zone);
  return el;
}

function sideEl(ctx: BoardCtx, side: Side): HTMLElement {
  const front = h('div', { class: 'stage-row front' }, ...(['stage0', 'stage1', 'stage2'] as Zone[]).map((z) => stageSlot(ctx, side, z)));
  const back = h('div', { class: 'stage-row back' }, ...(['stage3', 'stage4'] as Zone[]).map((z) => stageSlot(ctx, side, z)));
  return h(
    'div',
    { class: `side ${side}` },
    h('div', { class: 'area a-climax' }, spread(ctx, side, 'climax')),
    h('div', { class: 'area a-front' }, front),
    h('div', { class: 'area a-deck' }, pile(ctx, side, 'deck')),
    h('div', { class: 'area a-stock' }, pile(ctx, side, 'stock')),
    h('div', { class: 'area a-back' }, back),
    h('div', { class: 'area a-waiting' }, pile(ctx, side, 'waiting')),
    h('div', { class: 'area a-level' }, spread(ctx, side, 'level')),
    h('div', { class: 'area a-clock' }, spread(ctx, side, 'clock', { slots: 7 })),
    h('div', { class: 'area a-memory' }, pile(ctx, side, 'memory')),
  );
}

function revealedStrip(ctx: BoardCtx, side: Side): HTMLElement | null {
  const { game } = ctx;
  const zones = side === 'me' ? game.me.zones : game.opp?.zones;
  if (!zones) return null;
  const rev = (['deck', 'hand', 'stock'] as Zone[]).flatMap((z) => zones[z].filter((c) => c.revealed).map((c) => ({ c, z })));
  if (!rev.length) return null;
  return h(
    'div',
    { class: 'revealed-strip' },
    h('span', { class: 'muted' }, side === 'me' ? 'You reveal:' : `${game.oppName} reveals:`),
    rev.map(({ c, z }) => cardEl(ctx, side, c, z)),
  );
}

function middleStrip(ctx: BoardCtx): HTMLElement {
  const { game } = ctx;
  const phases = h(
    'div',
    { class: 'phases' },
    PHASES.map((p, i) =>
      h('button', { class: `phase ${game.meta.phase === i ? 'active' : ''}`, onclick: () => game.setPhase(i) }, p),
    ),
  );
  const turnName = game.myTurn ? 'Your turn' : `${game.mode === 'solo' ? 'Opponent' : game.oppName}'s turn`;
  const center = h(
    'div',
    { class: 'turn-box' },
    h('div', { class: `turn-label ${game.myTurn ? 'mine' : 'theirs'}` }, `Turn ${game.meta.turnNo} · ${turnName}`),
    phases,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn sm', onclick: () => game.nextPhase() }, 'Next phase ▶'),
      h('button', { class: 'btn sm', onclick: () => game.endTurn() }, 'End turn ⏭'),
      h('button', { class: 'btn sm', onclick: () => game.standAll(), title: 'Stand all your characters' }, 'Stand all'),
      h('button', { class: 'btn sm', onclick: () => game.reversedToWaiting(), title: 'Encore step: send reversed characters to the waiting room' }, 'Reversed → WR'),
    ),
  );
  const oppRes = game.mode !== 'solo' ? h('div', { class: 'res-wrap opp' }, spread(ctx, 'opp', 'resolution')) : h('div', { class: 'res-wrap opp' });
  const myRes = h('div', { class: 'res-wrap me' }, spread(ctx, 'me', 'resolution'));
  return h('div', { class: 'strip' }, oppRes, center, myRes);
}

function oppHand(ctx: BoardCtx): HTMLElement {
  const { game } = ctx;
  const hand = game.opp?.zones.hand ?? [];
  return h(
    'div',
    { class: 'opp-hand' },
    h('span', { class: 'opp-name' }, game.mode === 'solo' ? 'Solo practice' : game.opp ? game.oppName : 'Waiting for opponent…'),
    game.opp ? h('span', { class: 'muted' }, `Hand: ${hand.length}`) : null,
    h('div', { class: 'opp-hand-cards' }, hand.map((c) => cardEl(ctx, 'opp', c, 'hand'))),
  );
}

function myHand(ctx: BoardCtx): HTMLElement {
  const el = spread(ctx, 'me', 'hand');
  el.classList.add('my-hand');
  el.style.setProperty('--n', String(ctx.game.me.zones.hand.length));
  return el;
}

export function renderBoard(root: HTMLElement, ctx: BoardCtx) {
  const { game } = ctx;
  clear(root);
  const oppSide = game.mode === 'solo' || !game.opp ? h('div', { class: 'side opp placeholder' }, h('div', { class: 'placeholder-msg' }, game.mode === 'solo' ? 'Solo practice: no opponent' : statusText(game))) : sideEl(ctx, 'opp');
  root.append(
    oppHand(ctx),
    revealedStrip(ctx, 'opp') ?? '',
    oppSide,
    middleStrip(ctx),
    sideEl(ctx, 'me'),
    revealedStrip(ctx, 'me') ?? '',
    myHand(ctx),
  );
}

export function statusText(game: Game): string {
  switch (game.netStatus) {
    case 'waiting': return game.netDetail || `Waiting for opponent. Share room code ${game.net?.code}`;
    case 'connecting': return 'Connecting…';
    case 'connected': return game.opp ? 'Connected' : 'Connected, loading opponent board…';
    case 'disconnected': return 'Disconnected from opponent';
    case 'error': return 'Connection error: ' + game.netDetail;
    default: return '';
  }
}
