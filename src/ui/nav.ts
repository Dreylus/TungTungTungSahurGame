import type { MatchConfig } from '../engine/types.ts';

/** Late-bound navigation so screens can open each other without import cycles. */
export const nav = {
  setup: (_cfg: MatchConfig): void => {},
  match: (_cfg: MatchConfig): void => {},
  saves: (): void => {},
  settings: (): void => {},
  fighters: (): void => {},
  builder: (): void => {},
};
