/** Fighter encyclopedia with live demos, plus the custom fighter library. */
import { ALGOS, type AlgoMeta } from '../algorithms/registry.ts';
import { applyPreset, defaultConfig, makeSlot } from '../engine/setup.ts';
import type { MatchConfig } from '../engine/types.ts';
import { haptic } from '../native/haptics.ts';
import { getLibrary, setLibrary } from '../saves/store.ts';
import { openBuilder } from './builder.ts';
import { topbar } from './common.ts';
import { avatarStyle, button, clear, confirmDialog, h, section } from './dom.ts';
import { animate, MiniSim } from './minisim.ts';
import { push } from './router.ts';

function demoConfig(a: AlgoMeta, seed: number): MatchConfig {
  let cfg = defaultConfig();
  const duel = a.id === 'parasite' || a.id === 'virus' || a.id === 'encircler';
  cfg = applyPreset(cfg, duel ? 'domination' : 'race');
  cfg.fighters = [{ ...makeSlot(a.id, []), color: a.color }];
  if (duel) cfg.fighters.push({ algo: 'flood', color: '#3a4060' });
  cfg.arena = { ...cfg.arena, shape: a.id === 'encircler' ? 'circle' : 'square', size: 72, aspect: '1:1', obstacles: 'none', spawnLayout: duel ? 'symmetric' : 'center' };
  cfg.rules.matchLength = 40;
  cfg.seed = seed;
  return cfg;
}

export function openFighters(): void {
  const body = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, topbar('Fighters', button('🧪 New', () => openBuilder(null, () => renderLib()), 'small')), body);
  const stops: (() => void)[] = [];
  const sims: MiniSim[] = [];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const m = sims.find((s) => s.canvas === e.target);
      if (m) m.visible = e.isIntersecting;
    }
  });
  const gallery = h('div', { class: 'gallery' });
  for (const a of ALGOS) {
    const c = h('canvas') as HTMLCanvasElement;
    let seed = 1000 + a.num;
    const m = new MiniSim(c, () => demoConfig(a, seed++), 2);
    sims.push(m);
    io.observe(c);
    gallery.appendChild(
      h('div', { class: 'gcard' },
        c,
        h('div', { class: 'info' },
          h('b', null, h('i', { style: `background:${a.color}` }), `${a.num}. ${a.name}`),
          h('div', { class: 'm' }, a.method),
          h('div', { class: 'pros' }, '✅ ' + a.strength),
          h('div', { class: 'cons' }, '⚠️ ' + a.weakness),
        ),
      ),
    );
  }
  const lib = h('div');
  const renderLib = () => {
    clear(lib);
    const items = getLibrary();
    if (!items.length) lib.appendChild(h('p', { class: 'hint' }, 'No custom fighters yet. Mix a spread pattern, speed, aggression, branching, retreat and randomness in the Fighter Lab.'));
    const grid = h('div', { class: 'picker' });
    for (const f of items) {
      grid.appendChild(
        h('div', { class: 'fcard', onclick: () => (haptic('tap'), openBuilder(f, () => renderLib())) },
          h('div', { class: 'sw', style: avatarStyle(f.color, f.image) }, f.image ? '' : '★'),
          h('div', { class: 'grow' }, h('b', null, f.name), h('span', null, `${f.params.pattern} · speed ${f.params.speed.toFixed(2)}`)),
          button('🗑', async (e) => {
            e.stopPropagation();
            if (!(await confirmDialog('Delete fighter?', `“${f.name}” will be removed from your lab.`, 'Delete', true))) return;
            setLibrary(getLibrary().filter((x) => x.id !== f.id));
            renderLib();
          }, 'icon small ghost'),
        ),
      );
    }
    lib.appendChild(grid);
  };
  renderLib();
  body.append(section('Your custom fighters', lib), section('The 16 fighters', gallery));
  push({
    el,
    onShow: () => {
      stops.push(...sims.map((s) => animate(s)));
      renderLib();
    },
    onHide: () => {
      stops.forEach((s) => s());
      stops.length = 0;
    },
    onDestroy: () => io.disconnect(),
  });
}
