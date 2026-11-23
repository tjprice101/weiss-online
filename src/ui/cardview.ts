import type { CardMeta } from '../types';
import { store } from '../store';
import { h, modal } from '../util/dom';

const urlCache = new Map<string, string>();

/** Async-loading <img> for a library card. */
export function cardImg(meta: Pick<CardMeta, 'id' | 'name' | 'landscape'>, cls = ''): HTMLElement {
  const img = h('img', { alt: meta.name, draggable: false, loading: 'lazy' }) as HTMLImageElement;
  const frame = h('div', { class: `cframe ${meta.landscape ? 'landscape' : ''} ${cls}` }, img);
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
  store().getImageUrl(meta.id).then((u) => (img.src = u));
  modal({ title: meta.name + (meta.isClimax ? ' (Climax)' : ''), body: h('div', { class: 'center' }, img), wide: true });
}
