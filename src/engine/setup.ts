import { ALGOS, createFighter } from '../algorithms/registry.ts';
import { buildArena, computeSpawns } from '../arenas/arenas.ts';
import { hash32, RNG } from './rng.ts';
import { Sim } from './sim.ts';
import type { AlgoId, ArenaConfig, ConflictRule, FighterSlot, MatchConfig, PresetId, Rules, WinCondition } from './types.ts';

export interface Preset {
  id: PresetId;
  name: string;
  desc: string;
  icon: string;
  rules: Partial<Rules>;
}

export const BASE_RULES: Rules = {
  attack: false,
  consume: false,
  decay: false,
  fog: false,
  win: 'area',
  matchLength: 0,
  speed: 1,
  conflict: 'strength',
  events: false,
};

export const PRESETS: Preset[] = [
  {
    id: 'race', name: 'Pure Race', icon: '🏁',
    desc: 'No attacks, no consuming. Who fills the most space first?',
    rules: { attack: false, consume: false, decay: false, fog: false, win: 'area', matchLength: 0, events: false },
  },
  {
    id: 'war', name: 'Classic War', icon: '⚔️',
    desc: 'Attack on. Fronts push against each other.',
    rules: { attack: true, consume: false, decay: false, fog: false, win: 'area', matchLength: 90, events: false },
  },
  {
    id: 'domination', name: 'Total Domination', icon: '👑',
    desc: 'Attack + consume. Encirclement wins.',
    rules: { attack: true, consume: true, decay: false, fog: false, win: 'area', matchLength: 120, events: false },
  },
  {
    id: 'survival', name: 'Survival', icon: '🧊',
    desc: 'Decay on, last alive wins. Only stable growth lasts.',
    rules: { attack: true, consume: false, decay: true, fog: false, win: 'last', matchLength: 150, events: false },
  },
  {
    id: 'chaos', name: 'Chaos', icon: '🎲',
    desc: 'Random rules every match, plus meteors and growth surges.',
    rules: { events: true, matchLength: 120 },
  },
  {
    id: 'sandbox', name: 'Sandbox', icon: '🧪',
    desc: 'Everything manual. Your rules.',
    rules: {},
  },
];

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Final rules for a match (chaos mode rolls its toggles from the seed). */
export function resolveRules(cfg: MatchConfig): Rules {
  const r: Rules = { ...BASE_RULES, ...cfg.rules };
  if (cfg.mode === 'chaos') {
    const rng = new RNG(hash32(cfg.seed, 4242));
    r.attack = rng.next() < 0.75;
    r.consume = r.attack && rng.next() < 0.5;
    r.decay = rng.next() < 0.35;
    r.fog = rng.next() < 0.3;
    r.win = rng.pick<WinCondition>(['area', 'area', 'last', 'timer']);
    r.conflict = rng.pick<ConflictRule>(['random', 'speed', 'strength']);
    r.events = true;
    if (!r.matchLength) r.matchLength = 120;
  }
  return r;
}

export const SLOT_COLORS = [
  '#3d7bff', '#ff2d55', '#6bff3a', '#ff8c1a', '#a259ff', '#4df3ff', '#f5e132', '#ff4fd8',
  '#19d3a2', '#e9d8a6', '#c4852f', '#8fb8e8', '#b0245f', '#ff7a6b', '#ffb3e6', '#f4f7ff',
];

/** Pick a color for a new slot, preferring the algorithm color when free. */
export function pickColor(algo: AlgoId, taken: string[]): string {
  const meta = ALGOS.find((a) => a.id === algo);
  const lower = taken.map((c) => c.toLowerCase());
  if (meta && !lower.includes(meta.color)) return meta.color;
  for (const c of SLOT_COLORS) if (!lower.includes(c)) return c;
  return SLOT_COLORS[taken.length % SLOT_COLORS.length];
}

export function makeSlot(algo: AlgoId, taken: string[]): FighterSlot {
  return { algo, color: pickColor(algo, taken) };
}

export const DEFAULT_ARENA: ArenaConfig = {
  shape: 'circle',
  size: 256,
  aspect: '1:1',
  wrap: false,
  obstacles: 'none',
  spawnLayout: 'symmetric',
};

export function defaultConfig(): MatchConfig {
  const algos: AlgoId[] = ['flood', 'mycelium', 'crystal', 'virus'];
  const fighters: FighterSlot[] = [];
  for (const a of algos) fighters.push(makeSlot(a, fighters.map((f) => f.color)));
  return {
    version: 1,
    name: 'My Battle',
    mode: 'war',
    fighters,
    arena: { ...DEFAULT_ARENA },
    rules: { ...BASE_RULES, ...PRESET_BY_ID.war.rules },
    seed: 12345,
  };
}

export function applyPreset(cfg: MatchConfig, id: PresetId): MatchConfig {
  const p = PRESET_BY_ID[id];
  return { ...cfg, mode: id, rules: { ...cfg.rules, ...p.rules } };
}

export function randomLineup(rng: RNG, count: number): FighterSlot[] {
  const pool = ALGOS.map((a) => a.id);
  rng.shuffle(pool);
  const out: FighterSlot[] = [];
  for (let i = 0; i < count; i++) out.push(makeSlot(pool[i % pool.length], out.map((f) => f.color)));
  return out;
}

export interface SimBundle {
  sim: Sim;
  W: number;
  H: number;
  mask: Uint8Array;
  spawns: number[];
  rules: Rules;
}

export function createSim(cfg: MatchConfig): SimBundle {
  const { W, H, mask } = buildArena(cfg.arena, cfg.seed);
  const rules = resolveRules(cfg);
  const spawns = computeSpawns(mask, W, H, cfg.fighters, cfg.arena.spawnLayout, cfg.seed);
  const fighters = cfg.fighters.map((slot, i) => createFighter(slot, i + 1, new RNG(hash32(cfg.seed, i, 999))));
  const sim = new Sim({ W, H, mask, wrap: cfg.arena.wrap, rules, seed: cfg.seed, fighters, spawns });
  return { sim, W, H, mask, spawns, rules };
}
