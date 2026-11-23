import { h } from '../util/dom';
import { lsGet, lsSet } from '../util/misc';

export interface MenuItem {
  label: string;
  run: (x: number) => void;
  /** Label contains "X" which is replaced with the current X value. */
  x?: boolean;
  danger?: boolean;
  primary?: boolean;
  title?: string;
  disabled?: boolean;
}
export interface MenuSection {
  title?: string;
  items: MenuItem[];
  /** Render as a compact row of small buttons. */
  compact?: boolean;
}
export interface MenuSpec {
  title: string;
  subtitle?: string;
  useX?: boolean;
  sections: MenuSection[];
}
export type MenuFn = () => MenuSpec | null;

export type MenuTrigger = 'hover' | 'click';
let trigger: MenuTrigger = lsGet<MenuTrigger>('wom-menu-trigger', 'hover');
export const getMenuTrigger = () => trigger;
export function setMenuTrigger(t: MenuTrigger) {
  trigger = t;
  lsSet('wom-menu-trigger', t);
}

let xValue = 1;
const registry = new WeakMap<Element, MenuFn>();
let current: { anchor: Element; box: HTMLElement; pinned: boolean } | null = null;
let openTimer: number | undefined;
let closeTimer: number | undefined;
let dragging = false;
let installed = false;

export function setDragging(d: boolean) {
  dragging = d;
  if (d) closeMenu();
}

export function attachMenu(el: Element, fn: MenuFn) {
  registry.set(el, fn);
  el.classList.add('has-menu');
}

function anchorFor(t: Element | null): Element | null {
  let el: Element | null = t;
  while (el) {
    if (registry.has(el)) return el;
    el = el.parentElement;
  }
  return null;
}

export function closeMenu() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (current) {
    current.anchor.classList.remove('menu-open');
    current.box.remove();
    current = null;
  }
}

function scheduleClose() {
  if (!current || current.pinned) return;
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(closeMenu, 260);
}

function openMenu(anchor: Element, pinned: boolean) {
  const fn = registry.get(anchor);
  if (!fn || !anchor.isConnected) return;
  const spec = fn();
  closeMenu();
  if (!spec) return;
  const box = renderMenu(spec);
  document.body.append(box);
  current = { anchor, box, pinned };
  anchor.classList.add('menu-open');
  position(anchor, box);
}

function position(anchor: Element, box: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer to the right of the anchor, overlapping slightly so the mouse can travel into it.
  let left = r.right - 6;
  if (left + b.width > vw - 6) left = r.left - b.width + 6;
  if (left < 6) left = Math.max(6, Math.min(vw - b.width - 6, r.left));
  let top = r.top;
  if (top + b.height > vh - 6) top = Math.max(6, vh - b.height - 6);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

function renderMenu(spec: MenuSpec): HTMLElement {
  const labelEls: { el: HTMLElement; item: MenuItem }[] = [];
  const xLabel = h('b', { class: 'x-val' }, String(xValue));
  const refreshLabels = () => {
    xLabel.textContent = String(xValue);
    for (const { el, item } of labelEls) el.textContent = item.label.replace(/\bX\b/g, String(xValue));
  };
  const setX = (v: number) => {
    xValue = Math.max(1, Math.min(50, v));
    refreshLabels();
  };
  const head = h(
    'div',
    { class: 'menu-head' },
    h('div', { class: 'menu-title' }, spec.title, spec.subtitle ? h('span', { class: 'menu-sub' }, spec.subtitle) : null),
    spec.useX
      ? h(
          'div',
          { class: 'x-stepper', title: 'X: how many cards. Number keys 1-9 also set it.' },
          h('button', { class: 'mini', onclick: () => setX(xValue - 1) }, '−'),
          h('span', null, 'X = '),
          xLabel,
          h('button', { class: 'mini', onclick: () => setX(xValue + 1) }, '+'),
        )
      : null,
  );
  const body = h('div', { class: 'menu-body' });
  for (const sec of spec.sections) {
    if (!sec.items.length) continue;
    const wrap = h('div', { class: `menu-sec ${sec.compact ? 'compact' : ''}` });
    if (sec.title) wrap.append(h('div', { class: 'menu-sec-title' }, sec.title));
    const items = h('div', { class: 'menu-items' });
    for (const it of sec.items) {
      const lbl = h('span', null, it.x ? it.label.replace(/\bX\b/g, String(xValue)) : it.label);
      if (it.x) labelEls.push({ el: lbl, item: it });
      items.append(
        h(
          'button',
          {
            class: `menu-btn ${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''}`,
            title: it.title ?? '',
            disabled: !!it.disabled,
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              const x = xValue;
              closeMenu();
              it.run(x);
            },
          },
          lbl,
        ),
      );
    }
    wrap.append(items);
    body.append(wrap);
  }
  const box = h('div', { class: 'hover-menu' }, head, body);
  box.addEventListener('wheel', (e) => {
    if (!spec.useX) return;
    e.preventDefault();
    setX(xValue + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  (box as any)._setX = setX;
  return box;
}

/** Install global listeners once. */
export function installMenus() {
  if (installed) return;
  installed = true;

  document.addEventListener('mouseover', (e) => {
    if (dragging) return;
    const t = e.target as Element;
    if (current && current.box.contains(t)) {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      return;
    }
    if (trigger !== 'hover') return;
    if (document.querySelector('.modal-back')) {
      // Menus inside modals are not hover-driven
      if (!t.closest('.modal-back')) return;
    }
    const anchor = anchorFor(t);
    if (current && anchor === current.anchor) {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      return;
    }
    clearTimeout(openTimer);
    if (!anchor) {
      scheduleClose();
      return;
    }
    if (current && !current.pinned) scheduleClose();
    if (current?.pinned) return;
    openTimer = window.setTimeout(() => openMenu(anchor, false), current ? 380 : 260);
  });

  document.addEventListener('contextmenu', (e) => {
    const anchor = anchorFor(e.target as Element);
    if (!anchor) return;
    e.preventDefault();
    openMenu(anchor, true);
  });

  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (current && current.box.contains(t)) return;
    if (trigger === 'click') {
      const anchor = anchorFor(t);
      if (anchor && !(t as HTMLElement).closest('button, input, select')) {
        if (current?.anchor === anchor) closeMenu();
        else openMenu(anchor, true);
        return;
      }
    }
    if (current) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') closeMenu();
    else if (/^[1-9]$/.test(e.key) && !(e.target as HTMLElement).closest('input, textarea')) {
      (current.box as any)._setX?.(Number(e.key));
      e.preventDefault();
    }
  });

  // The dragged element is often re-rendered away on drop, so its own dragend may never fire.
  const endDrag = () => (dragging = false);
  document.addEventListener('drop', endDrag, true);
  document.addEventListener('dragend', endDrag, true);
  document.addEventListener('mousemove', (e) => {
    if (dragging && e.buttons === 0) dragging = false;
  });

  window.addEventListener('blur', () => current && !current.pinned && closeMenu());
  window.addEventListener('resize', closeMenu);
}
