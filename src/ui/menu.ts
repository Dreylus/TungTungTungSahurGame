/** Main menu with a live battle running behind the title. */
import { audio } from '../audio/audio.ts';
import { ARENA_SHAPES } from '../arenas/arenas.ts';
import { randomSeed, RNG } from '../engine/rng.ts';
import { applyPreset, defaultConfig, randomLineup } from '../engine/setup.ts';
import type { ArenaShape, MatchConfig, PresetId } from '../engine/types.ts';
import { appVersion } from '../native/bridge.ts';
import { haptic } from '../native/haptics.ts';
import { getLastConfig, saveSettings, settings } from '../saves/store.ts';
import { button, h, sheet } from './dom.ts';
import { animate, MenuBattle } from './minisim.ts';
import { nav } from './nav.ts';
import type { Screen } from './router.ts';
import { pixelText } from './title.ts';

const BG_SHAPES: ArenaShape[] = ['square', 'circle', 'hexagon', 'ring', 'islands', 'random', 'cross'];

function bgConfig(W: number, H: number): MatchConfig {
  const rng = new RNG(randomSeed());
  let cfg = defaultConfig();
  cfg = applyPreset(cfg, rng.pick<PresetId>(['war', 'domination', 'race']));
  cfg.fighters = randomLineup(rng, 5 + rng.int(5));
  cfg.seed = randomSeed();
  cfg.rules.matchLength = 60;
  cfg.rules.speed = 1;
  // Square cells: pick the closest aspect, the renderer covers the screen.
  const portrait = H > W * 1.3;
  cfg.arena = { ...cfg.arena, shape: rng.pick(BG_SHAPES), size: Math.max(W, H), aspect: portrait ? '9:16' : '1:1', spawnLayout: rng.next() < 0.7 ? 'symmetric' : 'random', obstacles: rng.next() < 0.3 ? 'random' : 'none' };
  return cfg;
}

export function quickPlayConfig(): MatchConfig {
  const rng = new RNG(randomSeed());
  const base = getLastConfig();
  let cfg = applyPreset(base, rng.pick<PresetId>(['race', 'war', 'war', 'domination', 'survival', 'chaos']));
  cfg.fighters = randomLineup(rng, 4 + rng.int(3));
  const shapes = ARENA_SHAPES.filter((s) => s.id !== 'custom' && s.id !== 'image');
  const portrait = window.innerHeight > window.innerWidth * 1.3;
  cfg.arena = {
    ...cfg.arena,
    shape: rng.pick(shapes).id,
    size: 320,
    aspect: portrait ? '9:16' : '1:1',
    wrap: false,
    obstacles: rng.next() < 0.3 ? 'random' : 'none',
    spawnLayout: 'symmetric',
    paint: undefined,
  };
  cfg.seed = randomSeed();
  cfg.name = 'Quick Play';
  return cfg;
}

function welcome(): void {
  const s = sheet('Welcome to PIXEL WARS', [
    h('p', { class: 'hint', style: 'font-size:15px' }, '16 autonomous algorithms fight for territory on a pixel grid. You pick the fighters, shape the arena, flip the rules — then watch it play out.'),
    h('p', { class: 'hint', style: 'font-size:15px' }, '📳 Haptics are tuned for Pixel phones: you feel clashes, captures, pulses and the final victory.'),
    h('p', { class: 'hint', style: 'font-size:15px' }, '🖼 Use your own photos as fighter avatars or turn a picture into an arena.'),
    h('p', { class: 'hint', style: 'font-size:15px' }, '🤏 In a match: pinch to zoom, drag to pan, double-tap to zoom in. Pause and use 🛠 to spawn fighters or paint walls.'),
  ], [button("Let's go", () => s.close(), 'primary')]);
  saveSettings({ firstRun: false });
}

export function menuScreen(): Screen {
  const bg = h('canvas', { class: 'menu-bg' }) as HTMLCanvasElement;
  const battle = new MenuBattle(bg, bgConfig);
  const title = pixelText('PIXEL\nWARS');
  const ico = (i: string, l: string) => [h('span', { class: 'ico' }, i), l];
  const el = h('div', { class: 'screen menu' },
    bg,
    h('div', { class: 'menu-shade' }),
    h('div', { class: 'menu-title' }, title, h('div', { class: 'sub' }, 'Algorithm Battlegrounds')),
    h('div', { class: 'menu-buttons' },
      button(ico('⚡', 'QUICK PLAY'), () => {
        haptic('start');
        nav.match(quickPlayConfig());
      }, 'primary'),
      button(ico('🛠', 'Custom match'), () => nav.setup(getLastConfig())),
      button(ico('💾', 'Saved setups'), () => nav.saves()),
      button(ico('🧬', 'Fighters'), () => nav.fighters()),
      button(ico('🧪', 'Fighter lab'), () => nav.builder()),
      button(ico('⚙️', 'Settings'), () => nav.settings(), ''),
      button(ico('🎲', 'Random setup'), () => {
        const c = quickPlayConfig();
        nav.setup(c);
      }),
      h('div', { class: 'version' }, `v1.0 · ${appVersion()}`),
    ),
  );
  let stop: (() => void) | null = null;
  return {
    el,
    kind: 'menu',
    onShow: () => {
      // The battle sizes itself to the screen on its first frame.
      stop = animate(battle);
      audio.setAmbientLevel(0.45);
      if (settings.firstRun) setTimeout(welcome, 600);
    },
    onHide: () => {
      stop?.();
      stop = null;
    },
  };
}
