import { toast } from '../util/dom';
import { profileKey } from '../store';
import { debounce, lsSet, randomPick, shuffleInPlace } from '../util/misc';
import { Net, type NetStatus } from './net';
import {
  ALL_ZONES, STAGE_ZONES, ZONE_LABEL, buildState, reIdDeck, find, hiddenToOpp, isStage, put, take, toPub,
  type CardState, type Found, type PState, type Pos, type PubState, type Zone,
} from './state';

export interface CardInfo {
  id: string;
  name: string;
  landscape: boolean;
  isClimax: boolean;
  url: string;
}

export type Role = 'host' | 'guest';
export interface Meta {
  turn: Role;
  phase: number;
  turnNo: number;
  /** Change counter + who made the change, so simultaneous edits converge (host wins ties). */
  rev?: number;
  by?: Role;
}
export const PHASES = ['Stand', 'Draw', 'Clock', 'Main', 'Climax', 'Attack', 'Encore', 'End'];

export interface LogEntry {
  who: 'me' | 'opp' | 'sys';
  text: string;
  t: number;
  chat?: boolean;
}

export type RemoteOp =
  | { kind: 'move'; iid: string; to: Zone; pos?: 'top' | 'bottom' }
  | { kind: 'state'; iid: string; state: CardState }
  | { kind: 'damage'; n: number }
  | { kind: 'mod'; iid: string; stat: 'power' | 'soul' | 'level'; delta: number }
  | { kind: 'note'; iid: string; note: string }
  | { kind: 'revealTop'; n: number };

interface MoveRec {
  from: string;
  to: string;
  name: string | null;
  extra?: string;
}

export interface SavedGame {
  deckName: string;
  deckCardIds: string[];
  me: PState;
  meta: Meta;
  log: LogEntry[];
  savedAt: number;
}
export const autosaveKey = () => profileKey('wom-autosave');

export class Game {
  mode: 'solo' | 'host' | 'guest';
  role: Role;
  me: PState;
  opp: PubState | null = null;
  myName: string;
  oppName = 'Opponent';
  myCards: Map<string, CardInfo>;
  oppCards = new Map<string, CardInfo>();
  deckCardIds: string[];
  deckName: string;
  meta: Meta = { turn: 'host', phase: 0, turnNo: 1 };
  log: LogEntry[] = [];
  history: { state: PState; desc: string }[] = [];
  net: Net | null = null;
  netStatus: NetStatus = 'idle';
  netDetail = '';
  ui: { openDamage?(n: number, fromOpp: boolean): void; openLevelUp?(): void } = {};
  private listeners = new Set<() => void>();
  private levelUpDismissedAt = -1;

  constructor(opts: {
    mode: 'solo' | 'host' | 'guest';
    myName: string;
    deckName: string;
    deckCardIds: string[];
    myCards: Map<string, CardInfo>;
    restored?: SavedGame;
  }) {
    this.mode = opts.mode;
    this.role = opts.mode === 'guest' ? 'guest' : 'host';
    this.myName = opts.myName || 'Player';
    this.deckName = opts.deckName;
    this.deckCardIds = opts.deckCardIds;
    this.myCards = opts.myCards;
    if (opts.restored) {
      this.me = opts.restored.me;
      this.meta = opts.restored.meta;
      this.log = opts.restored.log ?? [];
      this.sys('Game resumed');
    } else {
      this.me = buildState(this.deckCardIds);
      this.drawOpening();
      if (this.mode === 'solo') this.autosave();
    }
  }

  // ───────────────────────── plumbing ─────────────────────────

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        this.listeners.forEach((f) => f());
      });
    };
  })();

  private autosave = debounce(() => {
    // Only solo games can be resumed, so don't let online games overwrite the solo save.
    if (this.mode !== 'solo') return;
    const save: SavedGame = {
      deckName: this.deckName,
      deckCardIds: this.deckCardIds,
      me: this.me,
      meta: this.meta,
      log: this.log.slice(-150),
      savedAt: Date.now(),
    };
    lsSet(autosaveKey(), save);
  }, 800);

  private changed() {
    this.net?.send({ t: 'state', pub: toPub(this.me) });
    this.autosave();
    this.emit();
    const clock = this.me.zones.clock.length;
    if (clock >= 7 && this.levelUpDismissedAt !== clock) {
      this.levelUpDismissedAt = clock;
      setTimeout(() => this.ui.openLevelUp?.(), 50);
    }
    if (clock < 7) this.levelUpDismissedAt = -1;
  }

  /** Run a mutation of my state with undo + log + sync. Return false to abort (state is restored). */
  act(fn: (s: PState) => string | null | undefined | false): boolean {
    const snap = structuredClone(this.me);
    let desc: string | null | undefined | false;
    try {
      desc = fn(this.me);
    } catch (e) {
      console.error(e);
      this.me = snap;
      return false;
    }
    if (desc === false) {
      this.me = snap;
      return false;
    }
    this.history.push({ state: snap, desc: desc || 'change' });
    if (this.history.length > 100) this.history.shift();
    if (desc) this.addLog('me', desc);
    this.changed();
    return true;
  }

  undo() {
    const h = this.history.pop();
    if (!h) return toast('Nothing to undo', 'warn');
    this.me = h.state;
    this.addLog('me', `↶ Undo: ${h.desc}`);
    this.changed();
  }

  addLog(who: LogEntry['who'], text: string, opts: { send?: boolean; chat?: boolean } = {}) {
    const e: LogEntry = { who, text, t: Date.now(), chat: opts.chat };
    this.log.push(e);
    if (this.log.length > 500) this.log.shift();
    if (opts.send !== false && who !== 'opp') this.net?.send({ t: 'log', text, chat: opts.chat, sys: who === 'sys' });
    this.emit();
  }
  private sys(text: string) {
    this.log.push({ who: 'sys', text, t: Date.now() });
  }

  chat(text: string) {
    if (text.trim()) this.addLog('me', text.trim(), { chat: true });
  }

  cardName(id: string | null | undefined): string {
    if (!id) return 'card';
    return this.myCards.get(id)?.name ?? this.oppCards.get(id)?.name ?? 'card';
  }
  find(iid: string): Found | null {
    return find(this.me, iid);
  }

  // ───────────────────────── core moves ─────────────────────────

  private fmt(recs: (MoveRec | null)[]): string {
    const groups = new Map<string, { names: string[]; hidden: number }>();
    for (const r of recs) {
      if (!r) continue;
      const k = `${r.from} → ${r.to}`;
      const g = groups.get(k) ?? { names: [], hidden: 0 };
      if (r.name) g.names.push(`“${r.name}”${r.extra ?? ''}`);
      else g.hidden++;
      groups.set(k, g);
    }
    return [...groups]
      .map(([k, g]) => {
        const parts = [...g.names];
        if (g.hidden) parts.push(`${g.hidden} card${g.hidden > 1 ? 's' : ''}`);
        return `${k}: ${parts.join(', ')}`;
      })
      .join(' · ');
  }

  private moveRaw(s: PState, iid: string, to: Zone, pos: Pos = 'top', faceDown = false): MoveRec | null {
    const f = find(s, iid);
    if (!f) return null;
    if (isStage(to)) return this.stageRaw(s, f, to);
    const wasHidden = f.host ? f.inst.faceDown && !f.inst.revealed : hiddenToOpp(f.zone, f.inst);
    const from = f.host ? `Marker (${ZONE_LABEL[f.zone]})` : ZONE_LABEL[f.zone];
    const t = take(s, iid)!;
    put(s, t.inst, to, pos, faceDown);
    const nowHidden = hiddenToOpp(to, t.inst);
    return {
      from,
      to: ZONE_LABEL[to] + (pos === 'bottom' ? ' (bottom)' : '') + (faceDown ? ' face-down' : ''),
      name: wasHidden && nowHidden ? null : this.cardName(t.inst.cardId),
      extra: t.spilled ? ` (+${t.spilled} marker${t.spilled > 1 ? 's' : ''} → Waiting Room)` : undefined,
    };
  }

  private stageRaw(s: PState, f: Found, slot: Zone): MoveRec | null {
    const occ = s.zones[slot][0];
    if (occ?.iid === f.inst.iid) return null;
    const name = this.cardName(f.inst.cardId);
    const from = f.host ? `Marker (${ZONE_LABEL[f.zone]})` : ZONE_LABEL[f.zone];
    if (isStage(f.zone) && !f.host) {
      s.zones[f.zone] = occ ? [occ] : [];
      s.zones[slot] = [f.inst];
      return { from, to: ZONE_LABEL[slot], name, extra: occ ? ` (swapped with “${this.cardName(occ.cardId)}”)` : undefined };
    }
    let extra: string | undefined;
    if (occ) {
      const t = take(s, occ.iid)!;
      put(s, t.inst, 'waiting');
      extra = ` (replaced “${this.cardName(occ.cardId)}” → Waiting Room)`;
    }
    const t = take(s, f.inst.iid)!;
    t.inst.state = 'stand';
    t.inst.faceDown = false;
    t.inst.revealed = false;
    put(s, t.inst, slot);
    return { from, to: ZONE_LABEL[slot], name, extra };
  }

  moveCards(iids: string[], to: Zone, pos: Pos = 'top', faceDown = false, label?: string) {
    if (!iids.length) return;
    if (isStage(to) && iids.length > 1) iids = iids.slice(0, 1);
    this.act((s) => {
      const recs = iids.map((id) => this.moveRaw(s, id, to, pos, faceDown));
      if (!recs.some(Boolean)) return false;
      return (label ? label + ' — ' : '') + this.fmt(recs);
    });
  }
  move(iid: string, to: Zone, pos: Pos = 'top', faceDown = false) {
    this.moveCards([iid], to, pos, faceDown);
  }

  moveTop(to: Zone, n: number, opts: { faceDown?: boolean; label?: string; pos?: Pos } = {}) {
    this.act((s) => {
      const ids = s.zones.deck.slice(0, n).map((c) => c.iid);
      if (!ids.length) {
        toast('Your deck is empty. Refresh it from the deck menu.', 'warn');
        return false;
      }
      const recs = ids.map((id) => this.moveRaw(s, id, to, opts.pos ?? 'top', opts.faceDown));
      return (opts.label ? opts.label + ' — ' : '') + this.fmt(recs) + (ids.length < n ? ` (deck only had ${ids.length})` : '');
    });
  }
  moveBottom(to: Zone, n: number, opts: { faceDown?: boolean; label?: string } = {}) {
    this.act((s) => {
      const ids = s.zones.deck.slice(-n).reverse().map((c) => c.iid);
      if (!ids.length) {
        toast('Your deck is empty.', 'warn');
        return false;
      }
      const recs = ids.map((id) => this.moveRaw(s, id, to, 'top', opts.faceDown));
      return (opts.label ? opts.label + ' — ' : '') + 'from bottom of deck — ' + this.fmt(recs);
    });
  }

  reorder(iid: string, beforeIid: string | null) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f) return false;
      const arr = f.host ? f.host.markers : s.zones[f.zone];
      const target = beforeIid ? arr.findIndex((x) => x.iid === beforeIid) : -1;
      const [c] = arr.splice(f.index, 1);
      if (target < 0) arr.push(c);
      // Dragging rightwards drops the card after the target, leftwards before it.
      else arr.splice(target, 0, c);
      return null;
    });
  }

  // ───────────────────────── game helpers ─────────────────────────

  private drawOpening() {
    const s = this.me;
    for (let i = 0; i < 5 && s.zones.deck.length; i++) put(s, take(s, s.zones.deck[0].iid)!.inst, 'hand');
    this.sys(`New game with “${this.deckName}”: deck shuffled, drew 5 cards`);
  }

  newGame() {
    this.act(() => {
      this.me = buildState(this.deckCardIds);
      const s = this.me;
      for (let i = 0; i < 5 && s.zones.deck.length; i++) put(s, take(s, s.zones.deck[0].iid)!.inst, 'hand');
      return `New game: deck shuffled (${this.deckCardIds.length} cards), drew 5`;
    });
    // act() mutated `this.me` by replacement, so the snapshot holds the old game for undo.
  }

  draw(n = 1) {
    this.moveTop('hand', n, { label: `Draw ${n}` });
  }

  shuffle() {
    this.act((s) => {
      shuffleInPlace(s.zones.deck);
      reIdDeck(s);
      return `Shuffled deck (${s.zones.deck.length} cards)`;
    });
  }

  triggerCheck() {
    this.moveTop('resolution', 1, { label: 'Trigger check' });
  }

  refresh() {
    this.act((s) => {
      const wr = s.zones.waiting.splice(0);
      if (!wr.length && !s.zones.deck.length) {
        toast('Deck and waiting room are both empty', 'warn');
        return false;
      }
      wr.forEach((c) => ((c.state = 'stand'), (c.revealed = false), (c.faceDown = false)));
      s.zones.deck.push(...shuffleInPlace(wr));
      reIdDeck(s);
      const top = s.zones.deck[0];
      let pt = '';
      if (top) {
        put(s, take(s, top.iid)!.inst, 'clock');
        pt = ` · Refresh point: “${this.cardName(top.cardId)}” → Clock`;
      }
      return `Refresh: shuffled ${wr.length} cards from the Waiting Room into the deck${pt}`;
    });
  }

  levelUp(iid: string) {
    this.act((s) => {
      const seven = s.zones.clock.slice(0, 7);
      const chosen = seven.find((c) => c.iid === iid);
      if (!chosen) return false;
      put(s, take(s, iid)!.inst, 'level');
      const rest = seven.filter((c) => c.iid !== iid);
      for (const c of rest) put(s, take(s, c.iid)!.inst, 'waiting');
      return `LEVEL UP → Level ${s.zones.level.length}: “${this.cardName(chosen.cardId)}” → Level; ${rest.length} clock cards → Waiting Room`;
    });
  }
  dismissLevelUp() {
    this.levelUpDismissedAt = this.me.zones.clock.length;
  }

  heal(n = 1) {
    const ids = this.me.zones.clock.slice(-n).reverse().map((c) => c.iid);
    if (!ids.length) return toast('Clock is empty', 'warn');
    this.moveCards(ids, 'waiting', 'top', false, `Heal ${ids.length}`);
  }

  payStock(n: number) {
    const ids = this.me.zones.stock.slice(-n).reverse().map((c) => c.iid);
    if (ids.length < n) toast(`Only ${ids.length} card(s) in stock`, 'warn');
    if (!ids.length) return;
    this.moveCards(ids, 'waiting', 'top', false, `Pay ${ids.length} stock`);
  }

  standAll() {
    this.act((s) => {
      let n = 0;
      for (const z of STAGE_ZONES) for (const c of s.zones[z]) if (c.state !== 'stand') ((c.state = 'stand'), n++);
      return n ? `Stood ${n} character${n > 1 ? 's' : ''}` : false;
    });
  }

  setState(iid: string, st: CardState) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f || f.inst.state === st) return false;
      f.inst.state = st;
      const verb = st === 'stand' ? 'Stood' : st === 'rest' ? 'Rested' : 'Reversed';
      return `${verb} “${this.cardName(f.inst.cardId)}”`;
    });
  }

  attack(iid: string, kind: 'Front' | 'Side' | 'Direct', withTrigger = true) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f) return false;
      f.inst.state = 'rest';
      let msg = `⚔ ${kind} attack with “${this.cardName(f.inst.cardId)}”`;
      if (withTrigger) {
        const top = s.zones.deck[0];
        if (top) {
          put(s, take(s, top.iid)!.inst, 'resolution');
          msg += ` · Trigger check: “${this.cardName(top.cardId)}”`;
        } else msg += ' · (deck empty, no trigger check)';
      }
      return msg;
    });
  }

  encore(iid: string, cost: number) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f || !isStage(f.zone)) return false;
      if (s.zones.stock.length < cost) {
        toast(`Not enough stock (need ${cost})`, 'warn');
        return false;
      }
      for (let i = 0; i < cost; i++) put(s, take(s, s.zones.stock[s.zones.stock.length - 1].iid)!.inst, 'waiting');
      const markers = f.inst.markers.splice(0);
      for (const m of markers) put(s, m, 'waiting');
      Object.assign(f.inst, { state: 'rest', note: '', power: 0, revealed: false });
      return `Encore “${this.cardName(f.inst.cardId)}”${cost ? ` (paid ${cost} stock)` : ''} → returns rested`;
    });
  }

  reversedToWaiting() {
    const ids = STAGE_ZONES.flatMap((z) => this.me.zones[z]).filter((c) => c.state === 'reverse').map((c) => c.iid);
    if (!ids.length) return toast('No reversed characters', 'info');
    this.moveCards(ids, 'waiting', 'top', false, 'Encore step');
  }

  clockAndDraw(iid: string) {
    this.act((s) => {
      const r = this.moveRaw(s, iid, 'clock');
      if (!r) return false;
      const drawn = s.zones.deck.slice(0, 2).map((c) => c.iid);
      drawn.forEach((id) => this.moveRaw(s, id, 'hand'));
      return `Clock phase — ${this.fmt([r])} · drew ${drawn.length}`;
    });
  }

  mulligan(iids: string[]) {
    this.act((s) => {
      const recs = iids.map((id) => this.moveRaw(s, id, 'waiting'));
      const n = recs.filter(Boolean).length;
      const drawn = s.zones.deck.slice(0, n).map((c) => c.iid);
      drawn.forEach((id) => this.moveRaw(s, id, 'hand'));
      return n ? `Mulligan — ${this.fmt(recs)} · drew ${drawn.length}` : 'Mulligan — kept hand';
    });
  }

  setRevealed(iids: string[], on: boolean) {
    this.act((s) => {
      const names: string[] = [];
      for (const id of iids) {
        const f = find(s, id);
        if (!f || f.inst.revealed === on) continue;
        f.inst.revealed = on;
        names.push(`“${this.cardName(f.inst.cardId)}”`);
      }
      if (!names.length) return false;
      return on ? `Revealed ${names.join(', ')}` : null;
    });
  }
  hideAllRevealed() {
    this.act((s) => {
      let n = 0;
      for (const z of ['deck', 'hand', 'stock'] as Zone[]) for (const c of s.zones[z]) if (c.revealed) ((c.revealed = false), n++);
      return n ? null : false;
    });
  }

  flipFaceDown(iid: string) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f) return false;
      f.inst.faceDown = !f.inst.faceDown;
      return f.inst.faceDown ? `Turned a card face-down (${ZONE_LABEL[f.zone]})` : `Turned “${this.cardName(f.inst.cardId)}” face-up`;
    });
  }

  setNote(iid: string, note: string) {
    this.act((s) => {
      const f = find(s, iid);
      if (!f) return false;
      f.inst.note = note;
      return note ? `Note on “${this.cardName(f.inst.cardId)}”: ${note}` : null;
    });
  }
  addPower(iid: string, delta: number) {
    this.addMod(iid, 'power', delta);
  }
  /** Change a power / soul / level modifier. `by` prefixes the log when the opponent did it. */
  addMod(iid: string, stat: 'power' | 'soul' | 'level', delta: number, by = '') {
    if (!delta) return;
    this.act((s) => {
      const f = find(s, iid);
      if (!f) return false;
      const v = (f.inst[stat] ?? 0) + delta;
      f.inst[stat] = v;
      const sign = (n: number) => (n > 0 ? '+' : '') + n;
      return `${by}“${this.cardName(f.inst.cardId)}” ${stat} ${sign(delta)} (now ${sign(v)})`;
    });
  }

  /** Brainstorm: flip the top X into the Resolution zone and log how many are climaxes. */
  brainstorm(x: number) {
    const ids = this.me.zones.deck.slice(0, x).map((c) => c.iid);
    if (!ids.length) return toast('Your deck is empty. Refresh it from the deck menu.', 'warn');
    const cx = ids.filter((id) => this.myCards.get(find(this.me, id)!.inst.cardId)?.isClimax).length;
    this.moveCards(ids, 'resolution', 'top', false, `Brainstorm ${x}: ${cx} climax${cx === 1 ? '' : 'es'}`);
  }

  addMarker(iid: string, hostIid: string, faceDown = true) {
    if (iid === hostIid) return;
    this.act((s) => {
      const f = find(s, iid);
      const hostF = find(s, hostIid);
      if (!f || !hostF || !isStage(hostF.zone) || hostF.host) return false;
      const wasHidden = hiddenToOpp(f.zone, f.inst);
      const from = ZONE_LABEL[f.zone];
      const t = take(s, iid)!;
      Object.assign(t.inst, { state: 'stand', note: '', power: 0, soul: 0, level: 0, revealed: false, faceDown });
      const host = find(s, hostIid)!.inst;
      host.markers.push(t.inst);
      const nm = wasHidden && faceDown ? 'a card' : `“${this.cardName(t.inst.cardId)}”`;
      return `${from} → marker under “${this.cardName(host.cardId)}”${faceDown ? ' (face-down)' : ''}: ${nm}`;
    });
  }
  markerFromTop(hostIid: string, faceDown = true) {
    const top = this.me.zones.deck[0];
    if (!top) return toast('Deck is empty', 'warn');
    this.addMarker(top.iid, hostIid, faceDown);
  }

  // ───────────────────────── damage ─────────────────────────

  damageFlip(): string | null {
    let iid: string | null = null;
    this.act((s) => {
      const top = s.zones.deck[0];
      if (!top) {
        toast('Deck is empty. Refresh, then keep flipping.', 'warn');
        return false;
      }
      iid = top.iid;
      put(s, take(s, top.iid)!.inst, 'resolution');
      const cx = this.myCards.get(top.cardId)?.isClimax;
      return `Damage: revealed “${this.cardName(top.cardId)}”${cx ? ' (CLIMAX)' : ''}`;
    });
    return iid;
  }

  damageFinish(iids: string[], cancelled: boolean) {
    const live = iids.filter((id) => this.find(id)?.zone === 'resolution');
    if (!live.length) return;
    this.moveCards(live, cancelled ? 'waiting' : 'clock', 'top', false, cancelled ? `Damage CANCELLED (${live.length})` : `Took ${live.length} damage`);
  }

  // ───────────────────────── turn / meta ─────────────────────────

  get myTurn() {
    return this.meta.turn === this.role;
  }

  setMeta(patch: Partial<Meta>, log?: string) {
    this.meta = { ...this.meta, ...patch, rev: (this.meta.rev ?? 0) + 1, by: this.role };
    this.net?.send({ t: 'meta', meta: this.meta });
    if (log) this.addLog('sys', log);
    this.autosave();
    this.emit();
  }
  setPhase(i: number) {
    this.setMeta({ phase: i });
  }
  nextPhase() {
    if (this.meta.phase >= PHASES.length - 1) this.endTurn();
    else this.setPhase(this.meta.phase + 1);
  }
  endTurn() {
    const next: Role = this.meta.turn === 'host' ? 'guest' : 'host';
    const nextName = next === this.role ? this.myName : this.mode === 'solo' ? 'Opponent' : this.oppName;
    this.setMeta({ turn: next, phase: 0, turnNo: this.meta.turnNo + 1 }, `── Turn ${this.meta.turnNo + 1}: ${nextName} ──`);
  }

  flipCoin() {
    this.addLog('sys', `🪙 ${this.myName} flipped a coin: ${randomPick(['Heads', 'Tails'])}`);
  }
  rollDie() {
    this.addLog('sys', `🎲 ${this.myName} rolled a d6: ${randomPick([1, 2, 3, 4, 5, 6])}`);
  }

  // ───────────────────────── networking ─────────────────────────

  remote(op: RemoteOp) {
    if (!this.net?.connected) return toast('Opponent is not connected', 'warn');
    this.net.send({ t: 'remote', op });
  }

  private handleRemote(op: RemoteOp) {
    const by = `(${this.oppName}) `;
    if (!op || typeof op !== 'object') return;
    if (op.kind === 'move') {
      if (!ALL_ZONES.includes(op.to) || (op.pos != null && op.pos !== 'top' && op.pos !== 'bottom')) return;
      this.act((s) => {
        const r = this.moveRaw(s, op.iid, op.to, op.pos ?? 'top');
        return r ? by + this.fmt([r]) : false;
      });
    } else if (op.kind === 'state') {
      if (!['stand', 'rest', 'reverse'].includes(op.state)) return;
      this.act((s) => {
        const f = find(s, op.iid);
        if (!f) return false;
        f.inst.state = op.state;
        return `${by}set “${this.cardName(f.inst.cardId)}” to ${op.state}`;
      });
    } else if (op.kind === 'damage') {
      if (!(op.n >= 1 && op.n <= 50)) return;
      toast(`${this.oppName} deals you ${op.n} damage`, 'warn');
      this.ui.openDamage?.(op.n, true);
    } else if (op.kind === 'mod') {
      if (!['power', 'soul', 'level'].includes(op.stat) || !Number.isFinite(op.delta)) return;
      this.addMod(op.iid, op.stat, op.delta, by);
    } else if (op.kind === 'note') {
      this.act((s) => {
        const f = find(s, op.iid);
        if (!f) return false;
        f.inst.note = String(op.note ?? '').slice(0, 200);
        return f.inst.note ? `${by}note on “${this.cardName(f.inst.cardId)}”: ${f.inst.note}` : `${by}cleared the note on “${this.cardName(f.inst.cardId)}”`;
      });
    } else if (op.kind === 'revealTop') {
      const n = Math.max(0, Math.min(50, Math.floor(op.n) || 0));
      this.act((s) => {
        if (!n) {
          let k = 0;
          for (const c of s.zones.deck) if (c.peek) ((c.peek = false), k++);
          return k ? `${by}finished looking at your deck` : false;
        }
        const top = s.zones.deck.slice(0, n);
        if (!top.length) return false;
        for (const c of top) c.peek = true;
        return `${by}looks at the top ${top.length} card(s) of your deck`;
      });
    }
  }

  attachNet(net: Net) {
    this.net = net;
    net.onStatus = (st, detail) => {
      this.netStatus = st;
      this.netDetail = detail ?? '';
      if (st === 'connected') this.addLog('sys', 'Connected to opponent', { send: false });
      if (st === 'disconnected' || (st === 'waiting' && detail)) {
        this.addLog('sys', detail || 'Disconnected from opponent', { send: false });
        this.opp = null;
      }
      this.emit();
    };
    net.onOpen = () => this.sendIntro();
    net.onMessage = (m) => this.onMessage(m);
  }

  private async sendIntro() {
    const net = this.net!;
    net.send({ t: 'hello', name: this.myName, deckName: this.deckName });
    net.send({
      t: 'manifest',
      cards: [...this.myCards.values()].map(({ id, name, landscape, isClimax }) => ({ id, name, landscape, isClimax })),
    });
    net.send({ t: 'state', pub: toPub(this.me) });
    if (this.role === 'host') net.send({ t: 'meta', meta: this.meta, force: true });
    for (const c of this.myCards.values()) {
      try {
        const blob = await (await fetch(c.url)).blob();
        net.send({ t: 'img', id: c.id, mime: blob.type, data: await blob.arrayBuffer() });
      } catch (e) {
        console.warn('Failed to send image', c.id, e);
      }
    }
  }

  private imgRender = debounce(() => this.emit(), 120);

  private onMessage(m: any) {
    switch (m?.t) {
      case 'hello':
        this.oppName = String(m.name || 'Opponent').slice(0, 40);
        this.addLog('sys', `${this.oppName} joined with “${m.deckName ?? 'a deck'}”`, { send: false });
        break;
      case 'manifest':
        for (const c of m.cards ?? []) {
          const prev = this.oppCards.get(c.id);
          this.oppCards.set(c.id, { ...c, url: prev?.url ?? '' });
        }
        this.emit();
        break;
      case 'img': {
        const prev = this.oppCards.get(m.id);
        const url = URL.createObjectURL(new Blob([m.data], { type: m.mime || 'image/webp' }));
        if (prev?.url) URL.revokeObjectURL(prev.url);
        this.oppCards.set(m.id, { ...(prev ?? { id: m.id, name: 'card', landscape: false, isClimax: false }), url });
        this.imgRender();
        break;
      }
      case 'state':
        this.opp = m.pub;
        this.emit();
        break;
      case 'meta': {
        const mine = this.meta.rev ?? 0;
        const theirs = m.meta?.rev ?? 0;
        if (m.force || theirs > mine || (theirs === mine && m.meta?.by === 'host')) {
          this.meta = m.meta;
          this.autosave();
          this.emit();
        } else if (this.role === 'host') {
          // We won the race: re-send ours so the guest converges.
          this.net?.send({ t: 'meta', meta: this.meta });
        }
        break;
      }
      case 'log':
        this.log.push({ who: m.sys ? 'sys' : 'opp', text: String(m.text), t: Date.now(), chat: !!m.chat });
        this.emit();
        break;
      case 'remote':
        this.handleRemote(m.op);
        break;
      case 'busy':
        toast('That room already has two players.', 'error');
        break;
    }
  }

  destroy() {
    this.autosave.flush();
    this.net?.destroy();
    this.listeners.clear();
    for (const c of this.oppCards.values()) if (c.url) URL.revokeObjectURL(c.url);
  }
}
