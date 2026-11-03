// Helper DOM tối giản: h('div.cls', {onclick}, ...children)
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}` | `${K}#${string}`, props?: Props | Child, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = sel.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props as Child);
  } else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function mount(parent: Element, ...children: Child[]) {
  parent.replaceChildren();
  append(parent, children);
}

export const ui = () => document.getElementById('ui')!;

export function toast(msg: string, ms = 2600) {
  let box = document.querySelector('.toasts');
  if (!box) ui().appendChild((box = h('div.toasts')));
  const t = h('div.toast', msg);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtHours = (sec: number) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60 ? `${m % 60} phút` : ''}`.trim();
};

export const isTouch = () => matchMedia('(hover: none)').matches || 'ontouchstart' in window;

/** Overlay dạng modal, trả về hàm đóng */
export function openModal(content: HTMLElement, opts: { full?: boolean; onClose?: () => void; dismissable?: boolean } = {}) {
  const overlay = h('div.overlay', h(`div.modal${opts.full ? '.full' : ''}`, content));
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && opts.dismissable !== false && close();
  if (opts.dismissable !== false) overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
  document.addEventListener('keydown', onKey);
  ui().appendChild(overlay);
  return close;
}

export function lightbox(src: string) {
  const lb = h('div.lightbox', { onclick: () => lb.remove() }, h('img', { src, alt: '' }));
  ui().appendChild(lb);
}
