export type Screen = 'play' | 'library' | 'decks' | 'account';
type Renderer = (root: HTMLElement, arg?: unknown) => void | (() => void);

const renderers: Partial<Record<Screen, Renderer>> = {};
let cleanup: (() => void) | void;
let content: HTMLElement;
let current: Screen = 'play';
const navListeners = new Set<(s: Screen) => void>();

export function setContentRoot(el: HTMLElement) {
  content = el;
}
export function register(s: Screen, fn: Renderer) {
  renderers[s] = fn;
}
export function onNavigate(fn: (s: Screen) => void) {
  navListeners.add(fn);
}
export const currentScreen = () => current;

export function navigate(s: Screen, arg?: unknown) {
  if (typeof cleanup === 'function') cleanup();
  current = s;
  content.innerHTML = '';
  cleanup = renderers[s]?.(content, arg);
  navListeners.forEach((f) => f(s));
}

export function refresh() {
  navigate(current);
}
