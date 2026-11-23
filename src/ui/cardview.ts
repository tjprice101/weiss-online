import type { CardMeta } from '../types';
import { store } from '../store';
import { h, modal } from '../util/dom';
import { getPrefs } from '../util/prefs';
import { translationBox } from '../util/translate';

const urlCache = new Map<string, string>();

/** Enlarged card shown at the side of the screen while hovering a card (opposite side from the cursor). */
const hover = (() => {
  let el: HTMLElement | null = null;
  let img: HTMLImageElement;
  let cap: HTMLElement;
  let tr: ReturnType<typeof translationBox>;
  let owner: HTMLElement | null = null;
  let timer = 0;
  const hide = () => {
    owner = null;
    clearInterval(timer);
    el?.classList.remove('show');
  };
  const show = (frame: HTMLElement, src: string, name: string, landscape: boolean, x: number, id: string) => {
    if (!getPrefs().hoverPreview || !matchMedia('(hover: hover) and (min-width: 900px)').matches) return;
    if (!el) {
      img = h('img', { alt: '' }) as HTMLImageElement;
      cap = h('div', { class: 'hover-cap' });
      tr = translationBox('hover-tr');
      el = h('div', { class: 'hover-preview', 'aria-hidden': 'true' }, img, cap, tr.el);
      document.body.append(el);
    }
    owner = frame;
    img.src = src;
    img.alt = cap.textContent = name;
    el.classList.toggle('landscape', landscape);
    el.classList.toggle('left', x > innerWidth / 2);
    el.classList.add('show');
    tr.show(id, src, landscape);
    // The card may be removed (page change, re-render) without a mouseleave.
    clearInterval(timer);
    timer = window.setInterval(() => owner && !owner.isConnected && hide(), 300);
  };
  return { show, hide };
})();

/** Async-loading <img> for a library card. */
export function cardImg(meta: Pick<CardMeta, 'id' | 'name' | 'landscape'>, cls = ''): HTMLElement {
  const img = h('img', { alt: meta.name, draggable: false, loading: 'lazy' }) as HTMLImageElement;
  const frame = h('div', { class: `cframe ${meta.landscape ? 'landscape' : ''} ${cls}` }, img);
  frame.addEventListener('mouseenter', (e) => img.src && hover.show(frame, img.src, meta.name, !!meta.landscape, e.clientX, meta.id));
  frame.addEventListener('mouseleave', () => hover.hide());
  const cached = urlCache.get(meta.id);
  if (cached) img.src = cached;
  else
    store()
      .getImageUrl(meta.id)
      .then((u) => {
        urlCache.set(meta.id, u);
        img.src = u;
      })
      .catch(() => frame.classList.add('broken'));
  return frame;
}

export function clearUrlCache() {
  urlCache.clear();
}
export function forgetUrl(id: string) {
  urlCache.delete(id);
}

export function showCardLarge(meta: CardMeta) {
  const img = h('img', { alt: meta.name, class: 'large-img' }) as HTMLImageElement;
  const tr = translationBox('large-tr');
  store()
    .getImageUrl(meta.id)
    .then((u) => ((img.src = u), tr.show(meta.id, u, !!meta.landscape)));
  modal({ title: meta.name + (meta.isClimax ? ' (Climax)' : ''), body: h('div', { class: 'large-view' }, h('div', { class: 'center' }, img), tr.el), wide: true });
}
