/** Fighter Lab: build a custom algorithm from parameters, with a live preview. */
import { DEFAULT_CUSTOM } from '../algorithms/registry.ts';
import { randomSeed } from '../engine/rng.ts';
import { applyPreset, defaultConfig, SLOT_COLORS } from '../engine/setup.ts';
import type { CustomParams, CustomPattern, MatchConfig } from '../engine/types.ts';
import { haptic } from '../native/haptics.ts';
import { getLibrary, setLibrary, type CustomFighterDef } from '../saves/store.ts';
import { topbar } from './common.ts';
import { avatarStyle, button, chips, clear, h, pickFile, section, slider, toast } from './dom.ts';
import { avatarFromFile } from './images.ts';
import { animate, MiniSim } from './minisim.ts';
import { pop, push } from './router.ts';

const PATTERNS: { id: CustomPattern; label: string; desc: string }[] = [
  { id: 'flood', label: '🌊 Flood', desc: 'Even blob; randomness makes it ragged' },
  { id: 'branch', label: '🌿 Branch', desc: 'Wandering threads that fork' },
  { id: 'walkers', label: '🐜 Walkers', desc: 'Many tiny agents' },
  { id: 'rays', label: '💎 Rays', desc: 'Straight hexagonal lines' },
  { id: 'spiral', label: '🌀 Spiral', desc: 'Winds outward' },
  { id: 'pulse', label: '📡 Pulse', desc: 'Rings with rests in between' },
];

export function openBuilder(existing: CustomFighterDef | null, onSaved?: (def: CustomFighterDef) => void): void {
  const def: CustomFighterDef = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: `c${Date.now().toString(36)}`, name: 'My Fighter', color: SLOT_COLORS[Math.floor(Math.random() * SLOT_COLORS.length)], params: { ...DEFAULT_CUSTOM } };
  const p: CustomParams = def.params;
  const preview = h('canvas', { class: 'preview', style: 'aspect-ratio:1;max-height:36vh;object-fit:contain' }) as HTMLCanvasElement;
  let seed = randomSeed();
  const makeCfg = (): MatchConfig => {
    let cfg = applyPreset(defaultConfig(), 'war');
    cfg.fighters = [
      { algo: 'custom', color: def.color, name: def.name, custom: { ...p } },
      { algo: 'flood', color: '#5a6280' },
    ];
    cfg.arena = { ...cfg.arena, shape: 'circle', size: 96, aspect: '1:1', spawnLayout: 'symmetric', obstacles: 'none' };
    cfg.rules.matchLength = 30;
    cfg.seed = seed;
    return cfg;
  };
  const mini = new MiniSim(preview, makeCfg, 2);
  let restartTimer = 0;
  const restart = () => {
    clearTimeout(restartTimer);
    restartTimer = window.setTimeout(() => {
      seed = randomSeed();
      mini.restart();
    }, 160);
  };

  const head = h('div');
  const renderHead = () => {
    clear(head);
    const nameIn = h('input', { type: 'text', maxlength: '18' }) as HTMLInputElement;
    nameIn.value = def.name;
    nameIn.addEventListener('input', () => (def.name = nameIn.value || 'My Fighter'));
    const sw = h('div', { class: 'swatches', style: 'margin-top:10px' });
    for (const c of SLOT_COLORS)
      sw.appendChild(h('div', { class: `swatch ${c === def.color ? 'on' : ''}`, style: `background:${c}`, onclick: () => ((def.color = c), haptic('select'), renderHead(), restart()) }));
    head.append(
      h('div', { class: 'row' },
        h('div', { style: { ...avatarStyle(def.color, def.image), width: '58px', height: '58px', borderRadius: '16px', flex: 'none', backgroundSize: 'cover', backgroundPosition: 'center' } as Partial<CSSStyleDeclaration> }),
        h('div', { class: 'grow' }, nameIn),
        button('🖼', async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          try {
            const { dataUrl, color } = await avatarFromFile(f);
            def.image = dataUrl;
            def.color = color;
            renderHead();
            restart();
          } catch {
            toast('Could not read that image');
          }
        }, 'icon'),
      ),
      sw,
    );
  };
  renderHead();

  const body = h('div', { class: 'scroll' },
    section('Preview vs Flood', preview, h('p', { class: 'hint' }, 'Classic War on a small circle. The preview restarts when you change a parameter.')),
    section('Identity', head),
    section('Spread pattern', chips(PATTERNS.map((x) => ({ id: x.id, label: x.label })), p.pattern, (v) => ((p.pattern = v), restart()))),
    section('Parameters',
      slider('Speed', 0.5, 1.5, 0.05, p.speed, (v) => `${v.toFixed(2)}×`, (v) => ((p.speed = v), restart()), { desc: 'Faster costs toughness and bite' }),
      slider('Aggression', 0, 1, 0.05, p.aggression, (v) => `${Math.round(v * 100)}%`, (v) => ((p.aggression = v), restart()), { desc: 'Attack power vs. armor' }),
      slider('Branching', 0, 1, 0.05, p.branching, (v) => `${Math.round(v * 100)}%`, (v) => ((p.branching = v), restart()), { desc: 'Forks (branch), ring thickness (pulse)' }),
      slider('Retreat', 0, 1, 0.05, p.retreat, (v) => `${Math.round(v * 100)}%`, (v) => ((p.retreat = v), restart()), { desc: 'Gives ground back each tick' }),
      slider('Randomness', 0, 1, 0.05, p.randomness, (v) => `${Math.round(v * 100)}%`, (v) => ((p.randomness = v), restart()), { desc: 'Wobble and unpredictability' }),
    ),
  );
  const saveBtn = button(existing ? 'Save changes' : 'Save fighter', () => {
    const lib = getLibrary();
    const i = lib.findIndex((x) => x.id === def.id);
    if (i >= 0) lib[i] = def;
    else lib.push(def);
    if (!setLibrary(lib)) return toast('Storage is full');
    haptic('success');
    toast(`${def.name} saved — find it in the fighter picker`);
    onSaved?.(def);
    pop();
  }, 'primary grow');
  const el = h('div', { class: 'screen' }, topbar('Fighter lab'), body, h('div', { class: 'footer' }, saveBtn));
  let stop: (() => void) | null = null;
  push({
    el,
    onShow: () => (stop = animate(mini)),
    onHide: () => stop?.(),
  });
}
