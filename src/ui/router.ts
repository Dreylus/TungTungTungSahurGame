import { app, closeTopOverlay, tap } from './dom.ts';

export interface Screen {
  el: HTMLElement;
  kind?: string;
  /** Return true to swallow a back press. */
  onBack?(): boolean;
  onShow?(): void;
  onHide?(): void;
  onDestroy?(): void;
}

const stack: Screen[] = [];

function show(s: Screen): void {
  app().appendChild(s.el);
  s.onShow?.();
}

function hide(s: Screen, destroy: boolean): void {
  s.onHide?.();
  if (destroy) s.onDestroy?.();
  const el = s.el;
  el.classList.add('leaving');
  setTimeout(() => {
    el.classList.remove('leaving');
    el.remove();
  }, 190);
}

export function push(s: Screen): void {
  const top = stack[stack.length - 1];
  if (top) hide(top, false);
  stack.push(s);
  show(s);
}

export function replace(s: Screen): void {
  const top = stack.pop();
  if (top) hide(top, true);
  stack.push(s);
  show(s);
}

export function pop(): void {
  if (stack.length <= 1) return;
  const top = stack.pop()!;
  hide(top, true);
  const next = stack[stack.length - 1];
  if (next) show(next);
}

/** Pop back to the root screen. */
export function popToRoot(): void {
  while (stack.length > 1) {
    const top = stack.pop()!;
    hide(top, true);
  }
  const root = stack[0];
  if (root && !root.el.isConnected) show(root);
}

export function current(): Screen | undefined {
  return stack[stack.length - 1];
}

/** System back: overlays, then the screen's own handler, then pop. */
export function back(): boolean {
  if (closeTopOverlay()) return true;
  const top = stack[stack.length - 1];
  if (top?.onBack?.()) return true;
  if (stack.length > 1) {
    tap('back');
    pop();
    return true;
  }
  return false;
}
