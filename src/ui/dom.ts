/** Tiny DOM toolkit: element builder, controls, sheets, toasts. */
import { audio } from '../audio/audio.ts';
import { haptic } from '../native/haptics.ts';

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

/** Append children, skipping null / false. */
export function add(el: Node, ...children: Child[]): void {
  append(el, children);
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function app(): HTMLElement {
  return document.getElementById('app')!;
}

/** Feedback for every tap: haptic tick + tiny click. */
export function tap(kind: 'tap' | 'toggle' | 'back' = 'tap'): void {
  haptic(kind === 'toggle' ? 'toggle' : 'tap');
  audio.ui(kind);
}

export function button(label: Child, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', {
    class: `btn ${cls}`,
    onclick: (e: MouseEvent) => {
      tap();
      onClick(e);
    },
  }, label);
}

export function toggleRow(label: string, desc: string | null, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const sw = h('div', { class: `switch ${value ? 'on' : ''}`, role: 'switch' });
  const row = h('div', { class: 'toggle-row' }, h('div', { class: 'lbl' }, label, desc ? h('small', null, desc) : null), sw);
  row.addEventListener('click', () => {
    value = !value;
    sw.classList.toggle('on', value);
    tap('toggle');
    onChange(value);
  });
  return row;
}

export function setRangeFill(input: HTMLInputElement): void {
  const min = Number(input.min), max = Number(input.max), v = Number(input.value);
  input.style.setProperty('--p', `${((v - min) / (max - min || 1)) * 100}%`);
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
  opts: { stack?: boolean; desc?: string } = {},
): HTMLElement {
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  input.value = String(value);
  setRangeFill(input);
  let lastDetent = Math.round(value / step);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = fmt(v);
    setRangeFill(input);
    const det = Math.round(v / step);
    if (det !== lastDetent) {
      lastDetent = det;
      haptic('tick', 0.5);
    }
    onInput(v);
  });
  return h(
    'div',
    { class: `slider-row ${opts.stack ? 'stack' : ''}` },
    h('div', { class: 'lbl' }, label, opts.desc ? h('small', null, opts.desc) : null),
    val,
    input,
  );
}

export function chips<T extends string>(opts: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'chips' });
  const render = () => {
    clear(wrap);
    for (const o of opts) {
      wrap.appendChild(
        h('button', {
          class: `chip ${o.id === value ? 'on' : ''}`,
          onclick: () => {
            if (value === o.id) return;
            value = o.id;
            haptic('select');
            audio.ui('toggle');
            render();
            onChange(o.id);
          },
        }, o.label),
      );
    }
  };
  render();
  return wrap;
}

export function section(title: Child, ...children: Child[]): HTMLElement {
  return h('div', { class: 'section' }, h('h2', null, title), ...children);
}

let toastTimer = 0;
export function toast(msg: string, ms = 2200): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  app().appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------------------
// Overlays (bottom sheets / dialogs) with a back-button stack
// ---------------------------------------------------------------------------

const overlays: (() => void)[] = [];

/** Close the top-most overlay; returns false when there is none. */
export function closeTopOverlay(): boolean {
  const c = overlays.pop();
  if (!c) return false;
  c();
  return true;
}

export interface SheetHandle {
  close(): void;
  body: HTMLElement;
  el: HTMLElement;
}

export function sheet(title: string, body: Child, actions: Child[] = [], onClose?: () => void): SheetHandle {
  const bd = h('div', { class: 'backdrop' });
  const bodyEl = h('div', { class: 'body' }, body);
  const el = h('div', { class: 'sheet' }, h('div', { class: 'grip' }), title ? h('h3', null, title) : null, bodyEl, actions.length ? h('div', { class: 'actions' }, ...actions) : null);
  let closed = false;
  const doClose = () => {
    if (closed) return;
    closed = true;
    el.classList.add('closing');
    bd.style.opacity = '0';
    bd.style.transition = 'opacity .2s';
    setTimeout(() => {
      el.remove();
      bd.remove();
    }, 200);
    onClose?.();
  };
  const handle: SheetHandle = {
    el,
    body: bodyEl,
    close: () => {
      const i = overlays.indexOf(doClose);
      if (i >= 0) overlays.splice(i, 1);
      doClose();
    },
  };
  bd.addEventListener('click', () => {
    tap('back');
    handle.close();
  });
  // Swipe the grip down to dismiss.
  let y0 = -1;
  el.querySelector('.grip')!.addEventListener('pointerdown', (e) => (y0 = (e as PointerEvent).clientY));
  el.addEventListener('pointerup', (e) => {
    if (y0 >= 0 && e.clientY - y0 > 60) handle.close();
    y0 = -1;
  });
  overlays.push(doClose);
  app().append(bd, el);
  haptic('select');
  return handle;
}

export function confirmDialog(title: string, msg: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((res) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      res(v);
      s.close();
    };
    const s = sheet(title, h('p', { class: 'hint', style: 'font-size:15px' }, msg), [
      button('Cancel', () => finish(false)),
      button(okLabel, () => finish(true), danger ? 'danger' : 'primary'),
    ], () => {
      if (!done) {
        done = true;
        res(false);
      }
    });
  });
}

export function promptDialog(title: string, value: string, okLabel = 'Save', multiline = false, placeholder = ''): Promise<string | null> {
  return new Promise((res) => {
    let done = false;
    const input = (multiline ? h('textarea', { placeholder }) : h('input', { type: 'text', placeholder, maxlength: '40' })) as HTMLInputElement;
    input.value = value;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      res(v);
      s.close();
    };
    const s = sheet(title, input, [button('Cancel', () => finish(null)), button(okLabel, () => finish(input.value), 'primary')], () => {
      if (!done) {
        done = true;
        res(null);
      }
    });
    if (!multiline) setTimeout(() => input.focus(), 250);
  });
}

/** Square avatar style (image or colour with initial). */
export function avatarStyle(color: string, image?: string): Partial<CSSStyleDeclaration> {
  return image
    ? { backgroundImage: `url(${image})`, backgroundColor: color, ['--glow' as string]: color } as Partial<CSSStyleDeclaration>
    : { background: color, ['--glow' as string]: color + '66' } as Partial<CSSStyleDeclaration>;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return '∞';
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      res(input.files?.[0] ?? null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
    // If the picker is dismissed we never hear back; that is fine.
  });
}
