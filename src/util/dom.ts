export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'warn' | 'error' | 'ok' = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
  return t;
}

const modalStack: HTMLElement[] = [];

/** Generic modal. Returns a close function. */
export function modal(opts: {
  title: string;
  body: HTMLElement;
  footer?: HTMLElement;
  wide?: boolean;
  onClose?: () => void;
  dismissable?: boolean;
}): { close: () => void; root: HTMLElement; setTitle: (t: string) => void } {
  const titleEl = h('h2', null, opts.title);
  const closeBtn = h('button', { class: 'icon-btn', title: 'Close (Esc)' }, '✕');
  const box = h(
    'div',
    { class: `modal ${opts.wide ? 'wide' : ''}` },
    h('div', { class: 'modal-head' }, titleEl, closeBtn),
    h('div', { class: 'modal-body' }, opts.body),
    opts.footer ? h('div', { class: 'modal-foot' }, opts.footer) : null,
  );
  const back = h('div', { class: 'modal-back' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    modalStack.splice(modalStack.indexOf(back), 1);
    back.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false && back === modalStack[modalStack.length - 1]) close();
  };
  closeBtn.onclick = close;
  if (opts.dismissable !== false) back.addEventListener('mousedown', (e) => e.target === back && close());
  document.addEventListener('keydown', onKey);
  modalStack.push(back);
  document.body.append(back);
  return { close, root: box, setTitle: (t) => (titleEl.textContent = t) };
}

export function confirmDialog(message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: 'btn primary' }, okLabel);
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    const m = modal({
      title: 'Confirm',
      body: h('p', null, message),
      footer: h('div', { class: 'row end' }, cancel, ok),
      onClose: () => resolve(result),
    });
    ok.onclick = () => ((result = true), m.close());
    cancel.onclick = () => m.close();
    ok.focus();
  });
}

export function promptDialog(message: string, initial = '', okLabel = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h('input', { class: 'input', value: initial }) as HTMLInputElement;
    const ok = h('button', { class: 'btn primary' }, okLabel);
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    const m = modal({
      title: message.includes('\n') ? 'Confirm' : message,
      body: message.includes('\n') ? h('div', { class: 'stack' }, h('p', { class: 'pre-line' }, message), input) : input,
      footer: h('div', { class: 'row end' }, cancel, ok),
      onClose: () => resolve(result),
    });
    const submit = () => ((result = input.value), m.close());
    ok.onclick = submit;
    input.onkeydown = (e) => e.key === 'Enter' && submit();
    cancel.onclick = () => m.close();
    setTimeout(() => (input.focus(), input.select()), 0);
  });
}
