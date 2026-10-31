import { button, h } from './dom.ts';
import { back } from './router.ts';

export function topbar(title: string, ...right: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'topbar' }, button('←', () => back(), 'icon ghost'), h('h1', null, title), ...right);
}
