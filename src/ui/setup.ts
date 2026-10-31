/** Custom match setup: mode, fighters, arena, spawns and rules. */
import { ALGO_BY_ID, ALGOS, algoName, DEFAULT_CUSTOM } from '../algorithms/registry.ts';
import { ARENA_SHAPES, arenaDims, buildArena, computeSpawns, encodeMask, shapeMask } from '../arenas/arenas.ts';
import { randomSeed, RNG } from '../engine/rng.ts';
import { applyPreset, makeSlot, PRESET_BY_ID, PRESETS, randomLineup, SLOT_COLORS } from '../engine/setup.ts';
import {
  MAX_FIGHTERS,
  MIN_FIGHTERS,
  type Aspect,
  type ArenaShape,
  type ConflictRule,
  type FighterSlot,
  type MatchConfig,
  type ObstacleMode,
  type SpawnLayout,
  type WinCondition,
} from '../engine/types.ts';
import { haptic } from '../native/haptics.ts';
import { getLibrary, setLastConfig, settings } from '../saves/store.ts';
import { slotColor } from '../visuals/palette.ts';
import { maskCanvas } from '../visuals/thumbs.ts';
import { openBuilder } from './builder.ts';
import { topbar } from './common.ts';
import { add, avatarStyle, button, chips, clear, fmtTime, h, pickFile, section, sheet, slider, tap, toast, toggleRow } from './dom.ts';
import { openEditor } from './editor.ts';
import { avatarFromFile, backdropFromFile, maskFromImage } from './images.ts';
import { openMatch } from './match.ts';
import { push, type Screen } from './router.ts';
import { saveToSlotDialog } from './saves.ts';

const SIZES = [64, 96, 128, 192, 256, 384, 512, 768, 1024];
const LENGTHS = [30, 45, 60, 90, 120, 180, 300, 600, 0];
const speedFromPos = (p: number) => 0.25 * Math.pow(40, p);
const posFromSpeed = (s: number) => Math.log(s / 0.25) / Math.log(40);

const shapeThumbCache = new Map<string, HTMLCanvasElement>();
function shapeThumb(shape: ArenaShape, cfg: MatchConfig): HTMLCanvasElement {
  const key = shape;
  let c = shapeThumbCache.get(key);
  if (!c || shape === 'custom' || shape === 'image' || shape === 'random') {
    const a = shape === 'custom' || shape === 'image' ? buildArena({ ...cfg.arena, shape, size: 72, aspect: '1:1', obstacles: shape === 'custom' ? 'custom' : 'none' }, cfg.seed) : null;
    const m = a ? a.mask : shapeMask(shape, 72, 72, shape === 'random' ? cfg.seed : 7);
    c = maskCanvas(m, 72, 72, 72);
    shapeThumbCache.set(key, c);
  }
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d')!.drawImage(c, 0, 0);
  return copy;
}

export function openSetup(cfg: MatchConfig): void {
  push(setupScreen(cfg));
}

function setupScreen(initial: MatchConfig): Screen {
  let cfg: MatchConfig = JSON.parse(JSON.stringify(initial));
  const body = h('div', { class: 'scroll' });
  const save = button('💾', () => void saveToSlotDialog(cfg), 'icon');
  const fight = button('FIGHT ▶', () => {
    if (cfg.fighters.length < MIN_FIGHTERS) return toast('Pick at least 2 fighters');
    haptic('start');
    setLastConfig(cfg);
    openMatch(cfg);
  }, 'primary grow');
  const dice = button('🎲', () => randomizeAll(), 'icon small');
  const el = h('div', { class: 'screen' }, topbar('Custom match', dice), body, h('div', { class: 'footer' }, save, fight));

  let commitTimer = 0;
  const commit = () => {
    clearTimeout(commitTimer);
    commitTimer = window.setTimeout(() => setLastConfig(cfg), 300);
    drawPreview();
  };

  // ---------------- mode ----------------
  const modeBox = h('div');
  const renderMode = () => {
    clear(modeBox);
    const p = PRESET_BY_ID[cfg.mode];
    add(modeBox, 
      chips(PRESETS.map((x) => ({ id: x.id, label: `${x.icon} ${x.name}` })), cfg.mode, (id) => {
        cfg = applyPreset(cfg, id);
        renderMode();
        renderRules();
        commit();
      }),
      h('p', { class: 'hint' }, p?.desc ?? ''),
    );
  };

  // ---------------- fighters ----------------
  const fightersBox = h('div');
  const fightersTitle = h('span', null, 'Fighters');
  const renderFighters = () => {
    clear(fightersBox);
    fightersTitle.textContent = `Fighters (${cfg.fighters.length}/${MAX_FIGHTERS})`;
    const grid = h('div', { class: 'lineup' });
    cfg.fighters.forEach((f, i) => {
      const col = slotColor(f.color, i, settings.palette);
      const meta = ALGO_BY_ID[f.algo];
      grid.appendChild(
        h('div', { class: 'slot', onclick: () => (tap(), slotSheet(i)) },
          h('div', { class: 'av', style: avatarStyle(col, f.image) }, f.image ? '' : meta ? String(meta.num) : '★'),
          h('div', { class: 'nm' }, algoName(f)),
        ),
      );
    });
    if (cfg.fighters.length < MAX_FIGHTERS) grid.appendChild(h('div', { class: 'slot add', onclick: () => (tap(), addSheet()) }, '＋'));
    add(fightersBox, 
      grid,
      h('div', { class: 'row wrap', style: 'margin-top:10px' },
        button('🎲 Random lineup', () => {
          cfg.fighters = randomLineup(new RNG(randomSeed()), cfg.fighters.length);
          renderFighters();
          commit();
        }, 'small'),
        button('All 16', () => {
          cfg.fighters = [];
          for (const a of ALGOS) cfg.fighters.push(makeSlot(a.id, cfg.fighters.map((x) => x.color)));
          renderFighters();
          commit();
        }, 'small'),
        button('＋ Custom fighter', () => openBuilder(null, () => renderFighters()), 'small'),
      ),
    );
  };

  const fighterPicker = (current: string | null, onPick: (slot: FighterSlot) => void): HTMLElement => {
    const grid = h('div', { class: 'picker' });
    for (const a of ALGOS) {
      grid.appendChild(
        h('div', { class: `fcard ${current === a.id ? 'on' : ''}`, onclick: () => (tap(), onPick(makeSlot(a.id, cfg.fighters.map((x) => x.color)))) },
          h('div', { class: 'sw', style: `background:${a.color}` }, String(a.num)),
          h('div', null, h('b', null, a.name), h('span', null, a.tag)),
        ),
      );
    }
    for (const c of getLibrary()) {
      grid.appendChild(
        h('div', { class: 'fcard', onclick: () => (tap(), onPick({ algo: 'custom', name: c.name, color: c.color, image: c.image, custom: { ...c.params } })) },
          h('div', { class: 'sw', style: avatarStyle(c.color, c.image) }, c.image ? '' : '★'),
          h('div', null, h('b', null, c.name), h('span', null, `Custom · ${c.params.pattern}`)),
        ),
      );
    }
    return grid;
  };

  const addSheet = () => {
    const s = sheet('Add a fighter', fighterPicker(null, (slot) => {
      cfg.fighters.push(slot);
      s.close();
      renderFighters();
      commit();
    }));
  };

  const slotSheet = (i: number) => {
    const f = cfg.fighters[i];
    const content = h('div');
    const s = sheet(algoName(f), content, [
      button('Remove', () => {
        if (cfg.fighters.length <= MIN_FIGHTERS) return toast('At least 2 fighters');
        cfg.fighters.splice(i, 1);
        s.close();
        renderFighters();
        commit();
      }, 'danger'),
      button('Duplicate', () => {
        if (cfg.fighters.length >= MAX_FIGHTERS) return toast('16 fighters max');
        const copy: FighterSlot = { ...JSON.parse(JSON.stringify(f)), spawn: undefined };
        copy.color = makeSlot(f.algo, cfg.fighters.map((x) => x.color)).color;
        cfg.fighters.splice(i + 1, 0, copy);
        s.close();
        renderFighters();
        commit();
      }),
      button('Done', () => s.close(), 'primary'),
    ], () => {
      renderFighters();
      commit();
    });
    const render = () => {
      clear(content);
      const meta = ALGO_BY_ID[f.algo];
      const nameIn = h('input', { type: 'text', placeholder: meta?.name ?? 'Custom', maxlength: '18' }) as HTMLInputElement;
      nameIn.value = f.name ?? '';
      nameIn.addEventListener('input', () => (f.name = nameIn.value.trim() || undefined));
      const sw = h('div', { class: 'swatches' });
      const palette = [...new Set([f.color, ...(meta ? [meta.color] : []), ...SLOT_COLORS])];
      for (const c of palette) {
        sw.appendChild(h('div', { class: `swatch ${c === f.color ? 'on' : ''}`, style: `background:${c}`, onclick: () => (haptic('select'), (f.color = c), render()) }));
      }
      const picker = h('input', { type: 'color', style: 'width:34px;height:34px;padding:0;border-radius:50%;border:none;background:none' }) as HTMLInputElement;
      picker.value = f.color.length === 7 ? f.color : '#ffffff';
      picker.addEventListener('change', () => {
        f.color = picker.value;
        render();
      });
      sw.appendChild(picker);
      add(content, 
        h('div', { class: 'row', style: 'margin-bottom:12px' },
          h('div', { class: 'sw', style: { ...avatarStyle(f.color, f.image), width: '64px', height: '64px', borderRadius: '18px', flex: 'none', backgroundSize: 'cover', backgroundPosition: 'center' } as Partial<CSSStyleDeclaration> }),
          h('div', { class: 'grow' },
            h('div', { class: 'hint', style: 'margin:0 0 6px' }, meta ? `${meta.method}. ✅ ${meta.strength} · ⚠️ ${meta.weakness}` : 'Custom fighter'),
            h('div', { class: 'row' },
              button(f.image ? '🖼 Change image' : '🖼 Custom image', async () => {
                const file = await pickFile('image/*');
                if (!file) return;
                try {
                  const { dataUrl, color } = await avatarFromFile(file);
                  f.image = dataUrl;
                  f.color = color;
                  haptic('success');
                  render();
                } catch {
                  toast('Could not read that image');
                }
              }, 'small'),
              f.image ? button('✕', () => ((f.image = undefined), render()), 'small icon') : null,
            ),
          ),
        ),
        h('div', { class: 'lbl', style: 'margin:4px 0 6px' }, 'Name'),
        nameIn,
        h('div', { class: 'lbl', style: 'margin:12px 0 6px' }, 'Color'),
        sw,
        h('div', { class: 'lbl', style: 'margin:14px 0 6px' }, 'Algorithm'),
        fighterPicker(f.algo === 'custom' ? null : f.algo, (slot) => {
          f.algo = slot.algo;
          f.custom = slot.custom ?? (slot.algo === 'custom' ? { ...DEFAULT_CUSTOM } : undefined);
          if (slot.algo === 'custom') {
            f.name = slot.name;
            if (slot.image) f.image = slot.image;
          }
          if (!f.image) f.color = slot.color;
          render();
        }),
      );
    };
    render();
  };

  // ---------------- arena ----------------
  const preview = h('canvas', { class: 'preview' }) as HTMLCanvasElement;
  const arenaBox = h('div');
  const drawPreview = () => {
    try {
      const a = buildArena({ ...cfg.arena, size: Math.min(cfg.arena.size, 256) }, cfg.seed);
      const sp = computeSpawns(a.mask, a.W, a.H, cfg.fighters, cfg.arena.spawnLayout, cfg.seed);
      maskCanvas(a.mask, a.W, a.H, 256, sp, cfg.fighters.map((f, i) => slotColor(f.color, i, settings.palette)), preview);
      preview.style.aspectRatio = `${a.W} / ${a.H}`;
      preview.style.maxHeight = '42vh';
      preview.style.objectFit = 'contain';
    } catch (e) {
      console.warn(e);
    }
  };
  const recomputeImageMask = async () => {
    const a = cfg.arena;
    if (!a.imageBackdrop) return;
    const [W, H] = arenaDims(Math.min(a.size, 512), a.aspect);
    const m = await maskFromImage(a.imageBackdrop, W, H, a.imageThreshold ?? 0.35, !!a.imageInvert);
    a.imageMask = encodeMask(m);
    a.imageW = W;
    a.imageH = H;
    commit();
    renderArena();
  };
  const pickPhoto = async () => {
    const file = await pickFile('image/*');
    if (!file) return false;
    try {
      const [W, H] = arenaDims(512, cfg.arena.aspect);
      cfg.arena.imageBackdrop = await backdropFromFile(file, W, H);
      cfg.arena.shape = 'image';
      cfg.arena.imageThreshold ??= 0.35;
      await recomputeImageMask();
      haptic('success');
      return true;
    } catch {
      toast('Could not read that image');
      return false;
    }
  };
  const renderArena = () => {
    clear(arenaBox);
    const a = cfg.arena;
    const grid = h('div', { class: 'arenas' });
    for (const s of ARENA_SHAPES) {
      grid.appendChild(
        h('div', {
          class: `arena ${a.shape === s.id ? 'on' : ''}`,
          onclick: async () => {
            haptic('select');
            if (s.id === 'image' && !a.imageBackdrop) {
              if (!(await pickPhoto())) return;
            } else a.shape = s.id;
            if (s.id === 'custom' && !a.paint) {
              openEditor(cfg, 'paint', (c) => {
                cfg = c;
                renderArena();
                commit();
              });
            }
            renderArena();
            commit();
          },
        }, shapeThumb(s.id, cfg), s.name),
      );
    }
    const [W, H] = arenaDims(a.size, a.aspect);
    add(arenaBox, 
      preview,
      grid,
      h('div', { class: 'lbl', style: 'margin:14px 0 6px' }, `Size · ${W}×${H}`),
      chips(SIZES.map((s) => ({ id: String(s), label: String(s) })), String(a.size), (v) => {
        a.size = Number(v);
        if (a.shape === 'image') void recomputeImageMask();
        renderArena();
        commit();
      }),
      a.size >= 768 ? h('p', { class: 'hint' }, '⚠️ Huge arenas are heavy — great for 8 or fewer fighters on a Pixel.') : null,
      h('div', { class: 'lbl', style: 'margin:14px 0 6px' }, 'Shape of the board'),
      chips<Aspect>([{ id: '1:1', label: 'Square 1:1' }, { id: '4:5', label: 'Tall 4:5' }, { id: '9:16', label: 'Phone 9:16' }], a.aspect, (v) => {
        a.aspect = v;
        if (a.shape === 'image') void recomputeImageMask();
        renderArena();
        commit();
      }),
      h('div', { class: 'lbl', style: 'margin:14px 0 6px' }, 'Obstacles'),
      chips<ObstacleMode>([{ id: 'none', label: 'None' }, { id: 'random', label: 'Random' }, { id: 'custom', label: 'Custom paint' }], a.obstacles, (v) => {
        a.obstacles = v;
        if (v === 'custom' && !a.paint) {
          openEditor(cfg, 'paint', (c) => {
            cfg = c;
            renderArena();
            commit();
          });
        }
        commit();
      }),
      h('div', { class: 'row wrap', style: 'margin-top:12px' },
        button('🖌 Paint arena', () => openEditor(cfg, 'paint', (c) => {
          cfg = c;
          if (cfg.arena.shape !== 'custom' && cfg.arena.obstacles !== 'custom') cfg.arena.obstacles = 'custom';
          renderArena();
          commit();
        }), 'small'),
        button('📷 Arena from photo', () => void pickPhoto(), 'small'),
      ),
      a.shape === 'image' && a.imageBackdrop
        ? h('div', { style: 'margin-top:8px' },
            slider('Photo threshold', 0.05, 0.95, 0.01, a.imageThreshold ?? 0.35, (v) => `${Math.round(v * 100)}%`, (v) => {
              a.imageThreshold = v;
              clearTimeout(thrTimer);
              thrTimer = window.setTimeout(() => void recomputeImageMask(), 180);
            }, { desc: 'Darker than this becomes wall' }),
            toggleRow('Invert photo', 'Bright areas become walls instead', !!a.imageInvert, (v) => {
              a.imageInvert = v;
              void recomputeImageMask();
            }),
          )
        : null,
      toggleRow('Wrap-around edges', 'Leaving one side enters the other', a.wrap, (v) => {
        a.wrap = v;
        commit();
      }),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'lbl grow' }, 'Seed', h('small', null, 'Same seed = same match, every time')),
        seedInput(),
        button('🎲', () => {
          cfg.seed = randomSeed();
          renderArena();
          commit();
        }, 'icon small'),
      ),
    );
    drawPreview();
  };
  let thrTimer = 0;
  const seedInput = () => {
    const i = h('input', { type: 'number', style: 'width:130px', inputmode: 'numeric' }) as HTMLInputElement;
    i.value = String(cfg.seed);
    i.addEventListener('change', () => {
      cfg.seed = (Number(i.value) >>> 0) || 1;
      commit();
    });
    return i;
  };

  // ---------------- spawns ----------------
  const spawnBox = h('div');
  const renderSpawns = () => {
    clear(spawnBox);
    add(spawnBox, 
      chips<SpawnLayout>(
        [
          { id: 'symmetric', label: 'Symmetric' },
          { id: 'random', label: 'Random' },
          { id: 'corners', label: 'Corners' },
          { id: 'center', label: 'Center' },
          { id: 'manual', label: 'Manual' },
        ],
        cfg.arena.spawnLayout,
        (v) => {
          cfg.arena.spawnLayout = v;
          if (v === 'manual') openEditor(cfg, 'spawns', (c) => ((cfg = c), renderSpawns(), commit()));
          commit();
        },
      ),
      cfg.arena.spawnLayout === 'manual'
        ? h('div', { style: 'margin-top:10px' }, button('📍 Place spawns', () => openEditor(cfg, 'spawns', (c) => ((cfg = c), renderSpawns(), commit())), 'small'))
        : null,
    );
  };

  // ---------------- rules ----------------
  const rulesBox = h('div');
  const toSandbox = () => {
    if (cfg.mode !== 'sandbox' && cfg.mode !== 'chaos') {
      cfg.mode = 'sandbox';
      renderMode();
    }
  };
  const renderRules = () => {
    clear(rulesBox);
    const r = cfg.rules;
    const chaos = cfg.mode === 'chaos';
    const lenIdx = Math.max(0, LENGTHS.indexOf(r.matchLength));
    add(rulesBox, 
      chaos ? h('p', { class: 'hint', style: 'margin:0 0 8px' }, '🎲 Chaos rolls attack, consume, decay, fog, win condition and conflict rule from the seed each match.') : null,
      toggleRow('Attack', 'Overwrite enemy pixels', r.attack, (v) => ((r.attack = v), toSandbox(), commit())),
      toggleRow('Consume', 'Absorb surrounded enemy regions', r.consume, (v) => ((r.consume = v), toSandbox(), commit())),
      toggleRow('Territory decay', 'Unconnected pixels slowly die', r.decay, (v) => ((r.decay = v), toSandbox(), commit())),
      toggleRow('Fog of war', 'Fighters only sense nearby pixels', r.fog, (v) => ((r.fog = v), toSandbox(), commit())),
      toggleRow('Chaos events', 'Meteors and growth surges', r.events, (v) => ((r.events = v), toSandbox(), commit())),
      h('div', { class: 'lbl', style: 'margin:12px 0 6px' }, 'Win condition'),
      chips<WinCondition>([{ id: 'area', label: 'Most area' }, { id: 'last', label: 'Last alive' }, { id: 'timer', label: 'Timer' }], r.win, (v) => ((r.win = v), toSandbox(), commit())),
      slider('Match length', 0, LENGTHS.length - 1, 1, lenIdx, (v) => (LENGTHS[v] ? fmtTime(LENGTHS[v]) : '∞'), (v) => {
        r.matchLength = LENGTHS[v];
        toSandbox();
        commit();
      }),
      slider('Expansion speed', 0, 1, 0.01, posFromSpeed(r.speed || 1), (v) => `${speedFromPos(v).toFixed(speedFromPos(v) < 1 ? 2 : 1)}×`, (v) => {
        r.speed = Math.round(speedFromPos(v) * 100) / 100;
        commit();
      }),
      h('div', { class: 'lbl', style: 'margin:12px 0 6px' }, 'Conflict rule', h('small', null, 'Who wins a contested pixel')),
      chips<ConflictRule>([{ id: 'random', label: 'Random' }, { id: 'speed', label: 'Speed-based' }, { id: 'strength', label: 'Strength-based' }], r.conflict, (v) => ((r.conflict = v), toSandbox(), commit())),
    );
  };

  const randomizeAll = () => {
    const rng = new RNG(randomSeed());
    const p = rng.pick(PRESETS.filter((x) => x.id !== 'sandbox'));
    cfg = applyPreset(cfg, p.id);
    cfg.fighters = randomLineup(rng, 2 + rng.int(7));
    const shapes = ARENA_SHAPES.filter((s) => s.id !== 'custom' && s.id !== 'image');
    cfg.arena = { ...cfg.arena, shape: rng.pick(shapes).id, size: rng.pick([128, 192, 256, 384]), obstacles: rng.next() < 0.35 ? 'random' : 'none', spawnLayout: rng.pick<SpawnLayout>(['symmetric', 'symmetric', 'random', 'corners']) };
    cfg.seed = randomSeed();
    haptic('success');
    renderAll();
    commit();
  };

  const renderAll = () => {
    renderMode();
    renderFighters();
    renderArena();
    renderSpawns();
    renderRules();
  };

  const nameIn = h('input', { type: 'text', maxlength: '40', placeholder: 'Setup name' }) as HTMLInputElement;
  nameIn.value = cfg.name;
  nameIn.addEventListener('input', () => ((cfg.name = nameIn.value), commit()));

  add(body, 
    section('Mode', modeBox),
    section(fightersTitle, fightersBox),
    section('Arena', arenaBox),
    section('Spawns', spawnBox),
    section('Rules', rulesBox),
    section('Name', nameIn),
  );
  renderAll();
  return {
    el,
    kind: 'setup',
    onShow: () => {
      renderFighters();
      drawPreview();
    },
    onHide: () => setLastConfig(cfg),
  };
}
