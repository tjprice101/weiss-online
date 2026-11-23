import { lsGet, lsSet } from './misc';

/** Per-browser display and accessibility preferences. */
export interface Prefs {
  /** Turn off animations and transitions. */
  reduceMotion: boolean;
  /** Bigger text and buttons on the Library, Decks, Play and Account pages. */
  largeUi: boolean;
  /** Stronger outlines and text contrast. */
  highContrast: boolean;
  /** Enlarged card at the side of the screen when hovering cards in the Library / Deck Builder. */
  hoverPreview: boolean;
  /** Ask before deleting a single card or deck. Bulk deletes always ask. */
  confirmDeletes: boolean;
}

const KEY = 'wom-prefs';
const DEFAULTS: Prefs = {
  reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  largeUi: false,
  highContrast: false,
  hoverPreview: true,
  confirmDeletes: true,
};

export function getPrefs(): Prefs {
  return { ...DEFAULTS, ...lsGet<Partial<Prefs>>(KEY, {}) };
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  lsSet(KEY, { ...getPrefs(), [key]: value });
  applyPrefs();
}

export function applyPrefs() {
  const p = getPrefs();
  const c = document.documentElement.classList;
  c.toggle('reduce-motion', p.reduceMotion);
  c.toggle('large-ui', p.largeUi);
  c.toggle('high-contrast', p.highContrast);
}
