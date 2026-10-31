import type { Fighter, FighterTraits } from '../engine/fighter.ts';
import type { RNG } from '../engine/rng.ts';
import type { AlgoId, CustomParams, FighterSlot } from '../engine/types.ts';
import { ChamferFighter, Encircler, Flood, Glacier, Parasite, Spiral, Tide } from './basic.ts';
import { Hive, Mind, Slime, Wave } from './strategic.ts';
import { Crystal, Fractal, Lightning, Mycelium, Swarm, Virus } from './walkers.ts';

export interface AlgoMeta {
  id: AlgoId;
  num: number;
  name: string;
  color: string;
  method: string;
  strength: string;
  weakness: string;
  /** Short tagline for compact cards. */
  tag: string;
  traits: FighterTraits;
  make: (id: number, rng: RNG) => Fighter;
}

const T = (speed: number, armor: number, attackMul: number, attackCost = 1.5, emptyCost = 1): FighterTraits => ({
  speed,
  armor,
  attackMul,
  attackCost,
  emptyCost,
});

export const ALGOS: AlgoMeta[] = [
  {
    id: 'flood', num: 1, name: 'Flood', color: '#3d7bff', tag: 'Steady breadth-first fill',
    method: 'Breadth-first fill, uniform in all directions', strength: 'Fast, steady', weakness: 'Predictable, no tactics',
    traits: T(1, 0, 1), make: (id, r) => new Flood(id, r),
  },
  {
    id: 'mycelium', num: 2, name: 'Mycelium', color: '#e9d8a6', tag: 'Forking fungal threads',
    method: 'Branching threads with random tips that fork', strength: 'Reaches far places', weakness: 'Thin, easy to cut',
    traits: T(1.05, -0.08, 1.0), make: (id, r) => new Mycelium(id, r),
  },
  {
    id: 'encircler', num: 3, name: 'Encircler', color: '#a259ff', tag: 'Walls the edge, fills inward',
    method: 'Rushes to the arena edge, builds a wall, then fills inward', strength: 'Traps enemies', weakness: 'Slow start',
    traits: T(1.06, 0.08, 1.05), make: (id, r) => new Encircler(id, r),
  },
  {
    id: 'spiral', num: 4, name: 'Spiral', color: '#ff8c1a', tag: 'Winds outward, no gaps',
    method: 'Winds outward from its spawn point', strength: 'Dense, no gaps', weakness: 'Slow reach',
    traits: T(1.0, 0.15, 1), make: (id, r) => new Spiral(id, r),
  },
  {
    id: 'crystal', num: 5, name: 'Crystal', color: '#4df3ff', tag: 'Hexagonal rays & facets',
    method: 'Grows in straight lines at fixed angles', strength: 'Strong straight fronts', weakness: 'Leaves gaps',
    traits: T(1, 0.1, 1), make: (id, r) => new Crystal(id, r),
  },
  {
    id: 'slime', num: 6, name: 'Slime Mold', color: '#f5e132', tag: 'Tubes to the best food',
    method: 'Seeks nearest empty space and builds efficient paths', strength: 'Adaptive', weakness: 'Wastes time exploring',
    traits: T(1.06, 0, 0.95), make: (id, r) => new Slime(id, r),
  },
  {
    id: 'virus', num: 7, name: 'Virus', color: '#ff2d55', tag: 'Infects on contact',
    method: 'Random-walk spread with high infection chance on contact', strength: 'Great at attacking', weakness: 'Unstable core',
    traits: T(1.0, -0.2, 1.6, 1.0), make: (id, r) => new Virus(id, r),
  },
  {
    id: 'wave', num: 8, name: 'Wave', color: '#19d3a2', tag: 'Pulses in growing rings',
    method: 'Pulses outward in rings, each ring thicker', strength: 'Strong frontline', weakness: 'Pulse gaps',
    traits: T(0.98, 0, 0.98), make: (id, r) => new Wave(id, r),
  },
  {
    id: 'hive', num: 9, name: 'Hive', color: '#c4852f', tag: 'Cluster, then scouts',
    method: 'Builds a dense cluster, then launches scouts', strength: 'Balanced', weakness: 'Complex',
    traits: T(1, 0.05, 1), make: (id, r) => new Hive(id, r),
  },
  {
    id: 'lightning', num: 10, name: 'Lightning', color: '#f4f7ff', tag: 'Jagged bolts, huge reach',
    method: 'Fast jagged branches (diffusion-limited aggregation)', strength: 'Very fast reach', weakness: 'Fragile',
    traits: T(1.25, -0.25, 0.9), make: (id, r) => new Lightning(id, r),
  },
  {
    id: 'glacier', num: 11, name: 'Glacier', color: '#8fb8e8', tag: 'Slow, unbreakable ice',
    method: 'Slow growth that cannot be overwritten', strength: 'Hard to attack', weakness: 'Slowest speed',
    traits: T(0.78, 1, 0.75, 1.8), make: (id, r) => new Glacier(id, r),
  },
  {
    id: 'swarm', num: 12, name: 'Swarm', color: '#6bff3a', tag: 'Hundreds of tiny agents',
    method: 'Many tiny agents wander and claim pixels', strength: 'Hard to predict', weakness: 'Chaotic, inefficient',
    traits: T(1.16, -0.1, 0.95), make: (id, r) => new Swarm(id, r),
  },
  {
    id: 'parasite', num: 13, name: 'Parasite', color: '#b0245f', tag: 'Leeches enemy borders',
    method: 'Targets enemy borders and grows along them', strength: 'Strong in attack mode', weakness: 'Useless in Pure Race',
    traits: T(0.92, 0, 1.08, 1.3, 1.35), make: (id, r) => new Parasite(id, r),
  },
  {
    id: 'fractal', num: 14, name: 'Fractal', color: '#ff4fd8', tag: 'Recursive branching trees',
    method: 'Recursive branching (tree/Koch-style)', strength: 'Scales well', weakness: 'Needs room',
    traits: T(1.06, -0.1, 0.95), make: (id, r) => new Fractal(id, r),
  },
  {
    id: 'tide', num: 15, name: 'Tide', color: '#ff7a6b', tag: 'Flows, ebbs, nets gains',
    method: 'Expands and retreats in cycles, claiming net gains', strength: 'Resilient', weakness: 'Slow net progress',
    traits: T(1, 0.1, 1.0), make: (id, r) => new Tide(id, r),
  },
  {
    id: 'mind', num: 16, name: 'Mind', color: '#ffb3e6', tag: 'Greedy scoring + lookahead',
    method: 'Scores options each tick (greedy plus lookahead)', strength: 'Smartest', weakness: 'Costly to compute',
    traits: T(0.9, 0.05, 1.05), make: (id, r) => new Mind(id, r),
  },
];

export const ALGO_BY_ID: Record<string, AlgoMeta> = Object.fromEntries(ALGOS.map((a) => [a.id, a]));

export const DEFAULT_CUSTOM: CustomParams = {
  pattern: 'branch',
  speed: 1,
  aggression: 0.5,
  branching: 0.4,
  retreat: 0,
  randomness: 0.5,
};

class JitterFlood extends ChamferFighter {
  jitter = 0;
  override keyFor(idx: number, from: number): number {
    return super.keyFor(idx, from) + this.rng.next() * this.jitter;
  }
  step(): void {
    this.growLoop();
  }
}

/** Build a fighter from builder parameters. */
export function makeCustom(id: number, rng: RNG, p: CustomParams): Fighter {
  let f: Fighter;
  switch (p.pattern) {
    case 'branch': {
      const m = new Mycelium(id, rng);
      m.branchChance = 0.008 + p.branching * 0.12;
      m.turnJitter = 0.1 + p.randomness * 0.9;
      f = m;
      break;
    }
    case 'walkers': {
      const s = new Swarm(id, rng);
      s.turnChance = 0.06 + p.randomness * 0.5;
      f = s;
      break;
    }
    case 'rays':
      f = new Crystal(id, rng);
      break;
    case 'spiral':
      f = new Spiral(id, rng);
      break;
    case 'pulse': {
      const w = new Wave(id, rng);
      w.restTicks = Math.round(4 + (1 - p.branching) * 18);
      w.maxThickness = Math.round(3 + p.branching * 10);
      f = w;
      break;
    }
    default: {
      const jf = new JitterFlood(id, rng);
      jf.jitter = p.randomness * 12;
      f = jf;
    }
  }
  // Point-buy balance: extra speed costs toughness and bite.
  const speed = Math.max(0.5, Math.min(1.5, p.speed));
  const over = speed - 1;
  f.applyTraits({
    speed,
    attackMul: (0.55 + p.aggression * 1.1) * (1 - over * 0.45),
    armor: 0.2 - p.aggression * 0.35 - over * 0.5,
    attackCost: 1.7 - p.aggression * 0.6,
  });
  f.retreat = p.retreat * 0.25;
  return f;
}

export function createFighter(slot: FighterSlot, id: number, rng: RNG): Fighter {
  if (slot.algo === 'custom') return makeCustom(id, rng, slot.custom ?? DEFAULT_CUSTOM);
  const meta = ALGO_BY_ID[slot.algo] ?? ALGOS[0];
  const f = meta.make(id, rng);
  f.applyTraits(meta.traits);
  return f;
}

export function algoName(slot: FighterSlot): string {
  if (slot.name) return slot.name;
  if (slot.algo === 'custom') return 'Custom';
  return ALGO_BY_ID[slot.algo]?.name ?? slot.algo;
}
