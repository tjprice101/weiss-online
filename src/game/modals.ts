import { clear, h, modal, toast } from '../util/dom';
import { cardInfoFor, cardVisual, DESTS, faceVisible, type BoardCtx } from './board';
import { find, STAGE_SHORT, STAGE_ZONES, ZONE_LABEL, type Inst, type PubInst, type Zone } from './state';

const REORDERABLE: Zone[] = ['deck', 'hand', 'clock', 'resolution', 'memory', 'level'];
const TOP_LAST: Zone[] = ['waiting', 'stock'];

function zoomPanel() {
  const img = h('img', { alt: '' }) as HTMLImageElement;
  const cap = h('div', { class: 'zoom-cap' });
  const el = h('div', { class: 'zoom-panel' }, img, cap);
  return {
    el,
    show(url: string | undefined, name: string) {
      if (url) img.src = url;
      img.style.visibility = url ? 'visible' : 'hidden';
      cap.textContent = name;
    },
  };
}

// ─────────────────────────────── zone viewer ───────────────────────────────

export function openZoneViewer(
  ctx: BoardCtx,
  opts: { zone: Zone; iids?: string[]; markerHost?: string; lookTop?: boolean; search?: boolean; title?: string },
) {
  const { game } = ctx;
  const selected = new Set<string>();
  const restrict = opts.iids ? new Set(opts.iids) : null;
  let revealOn = false;
  const zoom = zoomPanel();
  const grid = h('div', { class: 'viewer-grid' });
  const info = h('div', { class: 'viewer-info' });
  const foot = h('div', { class: 'viewer-foot' });
  const reorderable = !opts.markerHost ? REORDERABLE.includes(opts.zone) : true;

  const cards = (): Inst[] => {
    if (opts.markerHost) {
      const f = find(game.me, opts.markerHost);
      return f && !f.host ? [...f.inst.markers] : [];
    }
    let arr = game.me.zones[opts.zone];
    if (restrict) arr = arr.filter((c) => restrict.has(c.iid));
    return TOP_LAST.includes(opts.zone) ? [...arr].reverse() : [...arr];
  };

  const selIds = () => {
    const live = new Set(cards().map((c) => c.iid));
    return [...selected].filter((id) => live.has(id));
  };

  const moveSel = (to: Zone, pos: 'top' | 'bottom' = 'top', faceDown = false) => {
    let ids = selIds();
    if (!ids.length) return flash();
    // So the first selected card ends up on top of the deck.
    if (to === 'deck' && pos === 'top') ids = ids.reverse();
    game.moveCards(ids, to, pos, faceDown);
    selected.clear();
  };
  const addMarkers = (hostIid: string, faceDown: boolean) => {
    const ids = selIds();
    if (!ids.length) return flash();
    for (const id of ids) game.addMarker(id, hostIid, faceDown);
    selected.clear();
  };
  const flash = () => {
    info.classList.remove('flash');
    void info.offsetWidth;
    info.classList.add('flash');
  };

  function render() {
    const list = cards();
    for (const id of [...selected]) if (!list.some((c) => c.iid === id)) selected.delete(id);
    clear(grid);
    if (!list.length) grid.append(h('div', { class: 'empty' }, 'No cards here.'));
    list.forEach((c, i) => {
      const inf = cardInfoFor(game, 'me', c.cardId);
      const tile = h(
        'div',
        { class: `viewer-tile ${selected.has(c.iid) ? 'sel' : ''}`, draggable: reorderable },
        cardVisual(inf, true),
        h('div', { class: 'tile-idx' }, opts.zone === 'deck' && !opts.markerHost ? (i === 0 ? 'Top' : `#${i + 1}`) : TOP_LAST.includes(opts.zone) && i === 0 ? 'Top' : ''),
        selected.has(c.iid) ? h('div', { class: 'sel-order' }, String([...selected].indexOf(c.iid) + 1)) : null,
        c.faceDown ? h('div', { class: 'tile-fd' }, 'face-down') : null,
      );
      tile.onclick = () => {
        selected.has(c.iid) ? selected.delete(c.iid) : selected.add(c.iid);
        render();
      };
      tile.ondblclick = () => {
        selected.delete(c.iid);
        game.move(c.iid, 'hand');
      };
      tile.onmouseenter = () => zoom.show(inf?.url, inf?.name ?? '');
      if (reorderable) {
        tile.ondragstart = (e) => e.dataTransfer!.setData('text/wom-reorder', c.iid);
        tile.ondragover = (e) => {
          if (e.dataTransfer?.types.includes('text/wom-reorder')) (e.preventDefault(), tile.classList.add('drop-over'));
        };
        tile.ondragleave = () => tile.classList.remove('drop-over');
        tile.ondrop = (e) => {
          tile.classList.remove('drop-over');
          const src = e.dataTransfer?.getData('text/wom-reorder');
          if (src && src !== c.iid) game.reorder(src, c.iid);
        };
      }
      grid.append(tile);
    });
    const n = selIds().length;
    info.textContent = `${list.length} card(s) · ${n} selected${reorderable ? ' · drag cards to reorder' : ''} · click a card to select it · double-click sends it to Hand`;
    renderFoot(list.length);
  }

  function renderFoot(count: number) {
    clear(foot);
    const destRow = h(
      'div',
      { class: 'btn-row' },
      h('span', { class: 'muted' }, 'Selected →'),
      DESTS.filter((d) => !(d.zone === opts.zone && !d.faceDown && d.zone !== 'deck') || opts.markerHost).map((d) =>
        h('button', { class: 'btn sm', onclick: () => moveSel(d.zone, (d.pos as 'top' | 'bottom') ?? 'top', !!d.faceDown) }, d.label),
      ),
      STAGE_ZONES.map((z) =>
        h('button', { class: 'btn sm', title: ZONE_LABEL[z], onclick: () => { const ids = selIds(); if (!ids.length) return flash(); game.move(ids[0], z); selected.delete(ids[0]); } }, STAGE_SHORT[z]),
      ),
    );
    const hosts = STAGE_ZONES.map((z) => ({ z, host: game.me.zones[z][0] })).filter((x) => x.host && x.host.iid !== opts.markerHost);
    const markerRow = hosts.length
      ? h(
          'div',
          { class: 'btn-row' },
          h('span', { class: 'muted' }, 'Selected → marker under'),
          hosts.flatMap(({ z, host }) => [
            h('button', { class: 'btn sm', title: `Face-down marker under ${ZONE_LABEL[z]}`, onclick: () => addMarkers(host.iid, true) }, STAGE_SHORT[z]),
            h('button', { class: 'btn sm', title: `Face-up marker under ${ZONE_LABEL[z]}`, onclick: () => addMarkers(host.iid, false) }, `${STAGE_SHORT[z]} (face-up)`),
          ]),
        )
      : null;
    const selRow = h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn sm', onclick: () => (cards().forEach((c) => selected.add(c.iid)), render()) }, 'Select all'),
      h('button', { class: 'btn sm', onclick: () => (selected.clear(), render()) }, 'Select none'),
      opts.lookTop || opts.search
        ? h('label', { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: revealOn,
              onchange: (e: Event) => {
                revealOn = (e.target as HTMLInputElement).checked;
                game.setRevealed((selIds().length ? selIds() : cards().map((c) => c.iid)), revealOn);
              },
            }),
            ' Reveal to opponent (selected cards, or all if none are selected)')
        : null,
    );
    const extra = h('div', { class: 'btn-row' });
    if (opts.lookTop && count) {
      const rest = () => cards().map((c) => c.iid);
      extra.append(
        h('span', { class: 'muted' }, 'Remaining cards →'),
        h('button', { class: 'btn sm', onclick: () => m.close() }, 'Leave on top (in this order)'),
        h('button', { class: 'btn sm', onclick: () => (game.moveCards(rest(), 'deck', 'bottom'), m.close()) }, 'Bottom of deck'),
        h('button', { class: 'btn sm', onclick: () => (game.moveCards(rest(), 'waiting'), m.close()) }, 'Waiting Room'),
        h('button', { class: 'btn sm', onclick: () => (game.moveCards(rest(), 'stock'), m.close()) }, 'Stock'),
        h('button', { class: 'btn sm', onclick: () => (game.moveCards(rest(), 'clock'), m.close()) }, 'Clock'),
        h('button', { class: 'btn sm', onclick: () => (game.shuffle(), m.close()) }, 'Shuffle deck'),
      );
    }
    if (opts.search) extra.append(h('button', { class: 'btn primary sm', onclick: () => (game.shuffle(), m.close()) }, 'Shuffle deck & close'));
    extra.append(h('div', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => m.close() }, 'Close'));
    foot.append(destRow, markerRow ?? '', selRow, extra);
  }

  const body = h('div', { class: 'viewer' }, h('div', { class: 'viewer-main' }, info, grid), zoom.el);
  const m = modal({
    title: opts.title ?? ZONE_LABEL[opts.zone],
    body,
    footer: foot,
    wide: true,
    onClose: () => {
      unsub();
      if (revealOn) game.setRevealed(game.me.zones.deck.filter((c) => c.revealed).map((c) => c.iid), false);
    },
  });
  const unsub = game.subscribe(render);
  render();
}

// ─────────────────────────────── opponent viewer ───────────────────────────────

export function openOppViewer(ctx: BoardCtx, zone: Zone, markerHost?: string, peekOnly = false) {
  const { game } = ctx;
  const zoom = zoomPanel();
  const grid = h('div', { class: 'viewer-grid' });
  const render = () => {
    clear(grid);
    let list: PubInst[] = game.opp?.zones[zone] ?? [];
    if (markerHost) list = list.find((c) => c.iid === markerHost)?.markers ?? [];
    if (TOP_LAST.includes(zone)) list = [...list].reverse();
    if (peekOnly) list = list.filter((c) => c.peek);
    if (!list.length) grid.append(h('div', { class: 'empty' }, peekOnly ? 'Not looking at any cards. Waiting for your opponent’s client…' : 'No cards.'));
    list.forEach((c, i) => {
      const inf = cardInfoFor(game, 'opp', c.cardId);
      const vis = faceVisible('opp', zone, c);
      const t = h('div', { class: 'viewer-tile' }, cardVisual(inf, vis));
      if (peekOnly) {
        t.append(h('div', { class: 'tile-idx' }, i === 0 ? 'Top' : `#${i + 1}`));
        const send = (to: Zone, pos?: 'top' | 'bottom') => game.remote({ kind: 'move', iid: c.iid, to, pos });
        t.append(
          h('div', { class: 'tile-actions show' },
            h('button', { class: 'mini', title: 'Put into their Waiting Room', onclick: () => send('waiting') }, 'WR'),
            h('button', { class: 'mini', title: 'Put on the bottom of their deck', onclick: () => send('deck', 'bottom') }, 'Btm'),
            h('button', { class: 'mini', title: 'Put into their Clock', onclick: () => send('clock') }, 'Clk'),
            h('button', { class: 'mini', title: 'Put into their Stock', onclick: () => send('stock') }, 'Stk'),
          ),
        );
      }
      t.onmouseenter = () => vis && zoom.show(inf?.url, inf?.name ?? '');
      grid.append(t);
    });
  };
  const m = modal({
    title: `${game.oppName}: ${markerHost ? 'Markers' : peekOnly ? 'Top of deck (only you can see these)' : ZONE_LABEL[zone]}`,
    body: h('div', { class: 'viewer' }, h('div', { class: 'viewer-main' }, grid), zoom.el),
    wide: true,
    onClose: () => unsub(),
  });
  const unsub = game.subscribe(() => (m.root.isConnected ? render() : unsub()));
  render();
}

// ─────────────────────────────── damage ───────────────────────────────

let damageOpen = false;
/** Damage that arrived while a damage dialog was open. Each instance is resolved separately (its own cancel check). */
const damageQueue: { n: number; fromOpp: boolean }[] = [];
export function openDamage(ctx: BoardCtx, n: number, fromOpp: boolean) {
  const { game } = ctx;
  if (damageOpen) {
    damageQueue.push({ n, fromOpp });
    toast(`Queued: ${n} more damage after this one`, 'info');
    return;
  }
  damageOpen = true;
  let total = Math.max(1, n);
  const flipped: string[] = [];
  let climaxHit = false;
  let auto = false;

  const status = h('div', { class: 'dmg-status' });
  const row = h('div', { class: 'dmg-row' });
  const totalEl = h('b', null, String(total));
  const controls = h('div', { class: 'btn-row' });

  const isCx = (iid: string) => {
    const f = game.find(iid);
    return !!(f && game.myCards.get(f.inst.cardId)?.isClimax);
  };

  function flipOne(): boolean {
    if (climaxHit || flipped.length >= total) return false;
    const iid = game.damageFlip();
    if (!iid) return false;
    flipped.push(iid);
    if (isCx(iid)) climaxHit = true;
    return true;
  }
  async function flipAll() {
    auto = true;
    while (auto && flipOne()) await new Promise((r) => setTimeout(r, 380));
    auto = false;
    render();
  }

  function render() {
    clear(row);
    for (const id of flipped) {
      const f = game.find(id);
      if (!f) continue;
      const inf = game.myCards.get(f.inst.cardId);
      const el = cardVisual(inf, true, isCx(id) ? 'cx-hit' : '');
      el.onmouseenter = () => ctx.preview(inf ?? null);
      // allow manual "this was a climax" marking by clicking
      row.append(el);
    }
    for (let i = flipped.length; i < total; i++) row.append(h('div', { class: 'slot-empty ghost' }));
    totalEl.textContent = String(total);
    const done = flipped.length >= total;
    status.className = `dmg-status ${climaxHit ? 'cancel' : done ? 'take' : ''}`;
    status.textContent = climaxHit
      ? 'A CLIMAX was revealed, so the damage is cancelled. Send the revealed cards to the Waiting Room.'
      : done
        ? `All ${total} damage revealed with no climax. Put the cards into the Clock.`
        : flipped.length
          ? `${flipped.length} of ${total} revealed. Keep flipping, or cancel if one is a climax that isn't tagged.`
          : `Take ${total} damage: flip cards one at a time from the top of the deck.`;
    clear(controls);
    const deckEmpty = !game.me.zones.deck.length;
    controls.append(
      h('button', { class: 'btn primary', disabled: done || climaxHit || deckEmpty, onclick: () => (flipOne(), render()) }, `Flip next (${Math.min(flipped.length + 1, total)}/${total})`),
      h('button', { class: 'btn', disabled: done || climaxHit || deckEmpty || auto, onclick: flipAll }, 'Flip all (stops at a tagged climax)'),
      deckEmpty && !done && !climaxHit ? h('button', { class: 'btn warn', onclick: () => game.refresh() }, 'Deck empty: Refresh') : '',
      h('div', { class: 'spacer' }),
      h('button', { class: `btn ${climaxHit ? 'primary' : ''}`, disabled: !flipped.length, onclick: () => (game.damageFinish(flipped, true), m.close()) }, 'Cancelled → Waiting Room'),
      h('button', { class: `btn ${done && !climaxHit ? 'primary' : ''}`, disabled: !flipped.length, onclick: () => (game.damageFinish(flipped, false), m.close()) }, 'Take damage → Clock'),
    );
  }

  const stepper = h(
    'div',
    { class: 'x-stepper big' },
    h('span', null, 'Damage: '),
    h('button', { class: 'mini', onclick: () => ((total = Math.max(flipped.length || 1, total - 1)), render()) }, '−'),
    totalEl,
    h('button', { class: 'mini', onclick: () => ((total = Math.min(30, total + 1)), render()) }, '+'),
  );
  const m = modal({
    title: fromOpp ? `${game.oppName} deals you ${n} damage` : 'Take damage',
    body: h('div', { class: 'stack' }, stepper, status, row),
    footer: controls,
    wide: true,
    dismissable: false,
    onClose: () => {
      auto = false;
      damageOpen = false;
      unsub();
      const next = damageQueue.shift();
      if (next) setTimeout(() => openDamage(ctx, next.n, next.fromOpp), 150);
    },
  });
  const unsub = game.subscribe(render);
  render();
}

// ─────────────────────────────── level up ───────────────────────────────

let levelOpen = false;
export function openLevelUp(ctx: BoardCtx) {
  const { game } = ctx;
  if (levelOpen || game.me.zones.clock.length < 7) return;
  levelOpen = true;
  const row = h('div', { class: 'dmg-row' });
  const render = () => {
    clear(row);
    const seven = game.me.zones.clock.slice(0, 7);
    if (seven.length < 7) return m.close();
    for (const c of seven) {
      const inf = game.myCards.get(c.cardId);
      const el = cardVisual(inf, true, 'pickable');
      el.title = 'Put this card into your Level zone';
      el.onmouseenter = () => ctx.preview(inf ?? null);
      el.onclick = () => (game.levelUp(c.iid), m.close());
      row.append(el);
    }
  };
  const m = modal({
    title: `★ Level up! (to Level ${game.me.zones.level.length + 1})`,
    body: h('div', { class: 'stack' }, h('p', null, 'Choose 1 of the 7 clock cards to put into your Level zone. The other 6 go to the Waiting Room.'), row),
    footer: h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => (game.dismissLevelUp(), m.close()) }, 'Later')),
    wide: true,
    onClose: () => {
      levelOpen = false;
      game.dismissLevelUp();
      unsub();
    },
  });
  const unsub = game.subscribe(render);
  render();
}

// ─────────────────────────────── mulligan ───────────────────────────────

export function openMulligan(ctx: BoardCtx) {
  const { game } = ctx;
  const sel = new Set<string>();
  const row = h('div', { class: 'dmg-row wrap' });
  const btn = h('button', { class: 'btn primary' }) as HTMLButtonElement;
  const render = () => {
    clear(row);
    for (const c of game.me.zones.hand) {
      const inf = game.myCards.get(c.cardId);
      const el = cardVisual(inf, true, `pickable ${sel.has(c.iid) ? 'sel' : ''}`);
      el.onmouseenter = () => ctx.preview(inf ?? null);
      el.onclick = () => (sel.has(c.iid) ? sel.delete(c.iid) : sel.add(c.iid), render());
      row.append(el);
    }
    btn.textContent = sel.size ? `Discard ${sel.size} & draw ${sel.size}` : 'Keep hand';
  };
  btn.onclick = () => (game.mulligan([...sel]), m.close());
  const m = modal({
    title: 'Mulligan',
    body: h('div', { class: 'stack' }, h('p', null, 'Select any number of cards to discard to the Waiting Room. You draw the same number.'), row),
    footer: h('div', { class: 'row end' }, btn),
    wide: true,
  });
  render();
}
