import type { MatchConfig, MatchResult, Rules } from '../engine/types.ts';

export type ToWorker =
  | { type: 'init'; cfg: MatchConfig }
  | { type: 'run'; running: boolean }
  | { type: 'speed'; value: number }
  | { type: 'step'; n: number }
  | { type: 'paint'; cells: Int32Array; value: number }
  | { type: 'spawn'; fighter: number; idx: number }
  | { type: 'ack' };

export interface ReadyMsg {
  type: 'ready';
  W: number;
  H: number;
  mask: Uint8Array;
  owner: Uint8Array;
  spawns: number[];
  rules: Rules;
  playable: number;
}

export interface FrameMsg {
  type: 'frame';
  tick: number;
  /** Packed idx * 256 + owner. */
  changes: Uint32Array;
  /** Full grid snapshot instead of changes (after big edits / backlog). */
  full?: Uint8Array;
  /** Per fighter: owned, alive, cx, cy. */
  stats: Float64Array;
  events: Float64Array;
  result: MatchResult | null;
  playable: number;
  tps: number;
}

export type FromWorker = ReadyMsg | FrameMsg | { type: 'error'; message: string };

export const STAT_STRIDE = 4;
