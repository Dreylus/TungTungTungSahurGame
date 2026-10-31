/** Shared types for the simulation, setup screens and save system. */

export const EMPTY = 0;
export const WALL = 254;
export const VOID = 255;
export const MAX_FIGHTERS = 16;
export const MIN_FIGHTERS = 2;
/** Simulation ticks per simulated second at 1x speed. */
export const TPS = 30;

export type AlgoId =
  | 'flood'
  | 'mycelium'
  | 'encircler'
  | 'spiral'
  | 'crystal'
  | 'slime'
  | 'virus'
  | 'wave'
  | 'hive'
  | 'lightning'
  | 'glacier'
  | 'swarm'
  | 'parasite'
  | 'fractal'
  | 'tide'
  | 'mind'
  | 'custom';

export type WinCondition = 'area' | 'last' | 'timer';
export type ConflictRule = 'random' | 'speed' | 'strength';
export type ObstacleMode = 'none' | 'random' | 'custom';
export type SpawnLayout = 'symmetric' | 'random' | 'corners' | 'center' | 'manual';
export type ArenaShape =
  | 'square'
  | 'circle'
  | 'hexagon'
  | 'ring'
  | 'cross'
  | 'spiral'
  | 'islands'
  | 'maze'
  | 'random'
  | 'custom'
  | 'image';
export type Aspect = '1:1' | '4:5' | '9:16';
export type PresetId = 'race' | 'war' | 'domination' | 'survival' | 'chaos' | 'sandbox';

export interface Rules {
  attack: boolean;
  consume: boolean;
  decay: boolean;
  fog: boolean;
  win: WinCondition;
  /** Simulated seconds; 0 = unlimited. */
  matchLength: number;
  /** Global simulation speed multiplier (0.25 – 10). */
  speed: number;
  conflict: ConflictRule;
  /** Chaos-mode random events (meteors, floods). */
  events: boolean;
}

export type CustomPattern = 'flood' | 'branch' | 'walkers' | 'rays' | 'spiral' | 'pulse';

export interface CustomParams {
  pattern: CustomPattern;
  /** 0.5 – 1.5 */
  speed: number;
  /** 0 – 1 */
  aggression: number;
  /** 0 – 1 */
  branching: number;
  /** 0 – 1 */
  retreat: number;
  /** 0 – 1 */
  randomness: number;
}

export interface FighterSlot {
  algo: AlgoId;
  color: string;
  /** Display name override (custom fighters, renamed slots). */
  name?: string;
  /** Square avatar image as a data URL (custom image). */
  image?: string;
  /** Parameters for custom fighters. */
  custom?: CustomParams;
  /** Manual spawn position in arena cell coordinates. */
  spawn?: [number, number];
}

export interface ArenaConfig {
  shape: ArenaShape;
  /** Long side in cells (64 – 1024). */
  size: number;
  aspect: Aspect;
  wrap: boolean;
  obstacles: ObstacleMode;
  spawnLayout: SpawnLayout;
  /** Painted overlay (walls/holes/floor) encoded with encodeMask. */
  paint?: string;
  /** Paint overlay dimensions so it can be rescaled when size changes. */
  paintW?: number;
  paintH?: number;
  /** Image-derived arena: encoded mask (1 = wall) at imageW x imageH. */
  imageMask?: string;
  imageW?: number;
  imageH?: number;
  /** Small data URL of the source photo, shown as a faint backdrop. */
  imageBackdrop?: string;
  /** Photo arena luminance threshold (0–1) and inversion. */
  imageThreshold?: number;
  imageInvert?: boolean;
}

export interface MatchConfig {
  version: 1;
  name: string;
  mode: PresetId;
  fighters: FighterSlot[];
  arena: ArenaConfig;
  rules: Rules;
  seed: number;
}

/** Event types emitted by the sim for visuals, audio and haptics. */
export const EV_ATTACK = 1;
export const EV_CAPTURE = 2;
export const EV_ELIM = 3;
export const EV_PULSE = 4;
export const EV_BOLT = 5;
export const EV_SPAWN = 6;
export const EV_METEOR = 7;
export const EV_EBB = 8;

export interface MatchResult {
  winner: number; // fighter id (1-based), 0 = draw
  reason: 'full' | 'settled' | 'timer' | 'last' | 'domination';
  /** Fighter ids ordered from best to worst. */
  ranking: number[];
  tick: number;
}
