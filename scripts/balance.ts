/**
 * Headless balance runner: plays many seeded matches per preset mode and
 * reports win rates per fighter.  Usage:
 *   npm run balance -- [matchesPerMode=40] [size=128] [fighters=4]
 */
import { ALGOS } from '../src/algorithms/registry.ts';
import { ARENA_SHAPES } from '../src/arenas/arenas.ts';
import { RNG } from '../src/engine/rng.ts';
import { applyPreset, createSim, defaultConfig, randomLineup } from '../src/engine/setup.ts';
import type { ArenaShape, MatchConfig, PresetId } from '../src/engine/types.ts';

declare const process: { argv: string[] };
const per = Number(process.argv[2] ?? 40);
const size = Number(process.argv[3] ?? 128);
const nf = Number(process.argv[4] ?? 4);
const modes: PresetId[] = (process.argv[5]?.split(',') as PresetId[]) ?? ['race', 'war', 'domination', 'survival'];
const shapes = ARENA_SHAPES.map((s) => s.id).filter((s) => s !== 'custom' && s !== 'image') as ArenaShape[];

const total: Record<string, { wins: number; apps: number; share: number }> = {};
for (const a of ALGOS) total[a.id] = { wins: 0, apps: 0, share: 0 };

for (const mode of modes) {
  const stats: Record<string, { wins: number; apps: number; share: number }> = {};
  for (const a of ALGOS) stats[a.id] = { wins: 0, apps: 0, share: 0 };
  const rng = new RNG(1234 + mode.length * 77);
  let ticks = 0;
  const t0 = performance.now();
  for (let m = 0; m < per; m++) {
    let cfg: MatchConfig = defaultConfig();
    cfg = applyPreset(cfg, mode);
    cfg.seed = rng.int(1 << 30);
    cfg.fighters = randomLineup(rng, nf);
    cfg.arena = { ...cfg.arena, shape: rng.pick(shapes), size, obstacles: rng.next() < 0.3 ? 'random' : 'none' };
    cfg.rules.matchLength = Math.min(cfg.rules.matchLength || 90, 90);
    const { sim } = createSim(cfg);
    let guard = 30 * 200;
    while (!sim.result && guard-- > 0) sim.step();
    ticks += sim.tick;
    const ranking = sim.result?.ranking ?? sim.ranking();
    const winner = sim.result?.winner ?? ranking[0];
    for (let i = 0; i < cfg.fighters.length; i++) {
      const id = cfg.fighters[i].algo;
      stats[id].apps++;
      stats[id].share += sim.fighters[i].owned / Math.max(1, sim.playable);
    }
    if (winner > 0) stats[cfg.fighters[winner - 1].algo].wins++;
  }
  const dt = performance.now() - t0;
  console.log(`\n== ${mode}: ${per} matches, avg ${(ticks / per / 30).toFixed(1)}s sim, ${(dt / per).toFixed(0)}ms/match`);
  const rows = ALGOS.map((a) => ({ a, ...stats[a.id] })).sort((x, y) => y.wins / Math.max(1, y.apps) - x.wins / Math.max(1, x.apps));
  for (const r of rows) {
    const wr = r.apps ? (100 * r.wins) / r.apps : 0;
    const sh = r.apps ? (100 * r.share) / r.apps : 0;
    console.log(`${r.a.name.padEnd(11)} win ${wr.toFixed(0).padStart(3)}%  (${r.wins}/${r.apps})  avg area ${sh.toFixed(1)}%`);
    total[r.a.id].wins += r.wins;
    total[r.a.id].apps += r.apps;
    total[r.a.id].share += r.share;
  }
}
console.log('\n== overall (fair per-appearance win rate = ' + (100 / nf).toFixed(0) + '%)');
const allWins = Object.values(total).reduce((s, v) => s + v.wins, 0);
for (const a of ALGOS) {
  const r = total[a.id];
  console.log(`${a.name.padEnd(11)} win ${(r.apps ? (100 * r.wins) / r.apps : 0).toFixed(0).padStart(3)}%  share of all wins ${((100 * r.wins) / Math.max(1, allWins)).toFixed(1)}%`);
}
