import { shuffleInPlace, uid } from '../util/misc';

export type Zone =
  | 'deck' | 'hand' | 'waiting' | 'clock' | 'level' | 'stock' | 'memory' | 'climax' | 'resolution'
  | 'stage0' | 'stage1' | 'stage2' | 'stage3' | 'stage4';

/** stage0-2 = center stage (left, middle, right), stage3-4 = back stage (left, right). */
export const STAGE_ZONES = ['stage0', 'stage1', 'stage2', 'stage3', 'stage4'] as const;
export const CENTER_ZONES = ['stage0', 'stage1', 'stage2'] as const;
export const ALL_ZONES: Zone[] = ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'climax', 'resolution', ...STAGE_ZONES];

export const ZONE_LABEL: Record<Zone, string> = {
  deck: 'Deck', hand: 'Hand', waiting: 'Waiting Room', clock: 'Clock', level: 'Level', stock: 'Stock',
  memory: 'Memory', climax: 'Climax Zone', resolution: 'Resolution Zone',
  stage0: 'Center Stage (L)', stage1: 'Center Stage (M)', stage2: 'Center Stage (R)', stage3: 'Back Stage (L)', stage4: 'Back Stage (R)',
};
export const STAGE_SHORT: Record<string, string> = { stage0: 'CL', stage1: 'CM', stage2: 'CR', stage3: 'BL', stage4: 'BR' };

export const isStage = (z: Zone) => z.startsWith('stage');
export const isCenter = (z: Zone) => (CENTER_ZONES as readonly string[]).includes(z);

export type CardState = 'stand' | 'rest' | 'reverse';

export interface Inst {
  iid: string;
  cardId: string;
  state: CardState;
  faceDown: boolean;
  revealed: boolean;
  note: string;
  power: number;
  /** Soul and level modifiers (older saves may lack them; treat undefined as 0). */
  soul?: number;
  level?: number;
  /** Deck card the opponent is currently allowed to look at (still hidden from the owner). */
  peek?: boolean;
  markers: Inst[];
}

export interface PState {
  zones: Record<Zone, Inst[]>;
}

/** What the opponent receives: hidden cards have cardId === null. */
export interface PubInst extends Omit<Inst, 'cardId' | 'markers'> {
  cardId: string | null;
  markers: PubInst[];
}
export interface PubState {
  zones: Record<Zone, PubInst[]>;
}

export function emptyZones<T>(): Record<Zone, T[]> {
  const z = {} as Record<Zone, T[]>;
  for (const k of ALL_ZONES) z[k] = [];
  return z;
}

export const newInst = (cardId: string): Inst => ({
  iid: uid(), cardId, state: 'stand', faceDown: false, revealed: false, note: '', power: 0, soul: 0, level: 0, markers: [],
});

export function buildState(cardIds: string[]): PState {
  const s: PState = { zones: emptyZones<Inst>() };
  s.zones.deck = shuffleInPlace(cardIds.map(newInst));
  return s;
}

/**
 * Give every deck card a fresh instance id. Call after any shuffle: otherwise the opponent
 * could follow known cards (e.g. from the Waiting Room) by iid into their new deck positions.
 */
export function reIdDeck(s: PState) {
  for (const c of s.zones.deck) {
    c.iid = uid();
    c.revealed = false;
    c.peek = false;
  }
}

/** Zones whose contents are hidden from the opponent. */
export const HIDDEN_ZONES: Zone[] = ['deck', 'hand', 'stock'];
/** Zones whose contents are face-down to the owner as well. */
export const OWNER_HIDDEN_ZONES: Zone[] = ['deck', 'stock'];

export const hiddenToOpp = (zone: Zone, c: { faceDown: boolean; revealed: boolean; peek?: boolean }) =>
  (HIDDEN_ZONES.includes(zone) || c.faceDown) && !c.revealed && !c.peek;

function pubInst(c: Inst, hidden: boolean): PubInst {
  return {
    ...c,
    cardId: hidden ? null : c.cardId,
    markers: c.markers.map((m) => pubInst(m, m.faceDown && !m.revealed)),
  };
}

export function toPub(s: PState): PubState {
  const zones = emptyZones<PubInst>();
  for (const z of ALL_ZONES) zones[z] = s.zones[z].map((c) => pubInst(c, hiddenToOpp(z, c)));
  return { zones };
}

export interface Found {
  inst: Inst;
  zone: Zone;
  index: number;
  host?: Inst;
}

export function find(s: PState, iid: string): Found | null {
  for (const z of ALL_ZONES) {
    const arr = s.zones[z];
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.iid === iid) return { inst: c, zone: z, index: i };
      const mi = c.markers.findIndex((m) => m.iid === iid);
      if (mi >= 0) return { inst: c.markers[mi], zone: z, index: mi, host: c };
    }
  }
  return null;
}

function resetForZone(c: Inst) {
  c.state = 'stand';
  c.note = '';
  c.power = 0;
  c.soul = 0;
  c.level = 0;
  c.revealed = false;
}

/** Remove a card from wherever it is. Characters leaving the stage drop their markers into the waiting room. */
export function take(s: PState, iid: string, keepMarkers = false): (Found & { spilled: number }) | null {
  const f = find(s, iid);
  if (!f) return null;
  if (f.host) {
    f.host.markers.splice(f.index, 1);
    return { ...f, spilled: 0 };
  }
  s.zones[f.zone].splice(f.index, 1);
  let spilled = 0;
  if (isStage(f.zone) && !keepMarkers && f.inst.markers.length) {
    for (const m of f.inst.markers) {
      resetForZone(m);
      m.faceDown = false;
      s.zones.waiting.push(m);
    }
    spilled = f.inst.markers.length;
    f.inst.markers = [];
  }
  return { ...f, spilled };
}

export type Pos = 'top' | 'bottom' | number;

/**
 * Place a card into a zone.
 * deck: index 0 is the top. Every other zone: the last element is the "top" (most recently placed).
 */
export function put(s: PState, c: Inst, to: Zone, pos: Pos = 'top', faceDown = false) {
  c.revealed = false;
  c.peek = false;
  c.faceDown = faceDown;
  if (!isStage(to)) resetForZone(c);
  const arr = s.zones[to];
  if (isStage(to)) {
    arr.length = 0;
    arr.push(c);
  } else if (typeof pos === 'number') arr.splice(Math.max(0, Math.min(pos, arr.length)), 0, c);
  else if (to === 'deck') pos === 'top' ? arr.unshift(c) : arr.push(c);
  else pos === 'top' ? arr.push(c) : arr.unshift(c);
}
