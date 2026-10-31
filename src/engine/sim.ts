import type { Fighter } from './fighter.ts';
import { IntQueue } from './heap.ts';
import { runConsume, runDecay, RegionScratch } from './regions.ts';
import { RNG } from './rng.ts';
import {
  EMPTY,
  EV_ATTACK,
  EV_ELIM,
  EV_METEOR,
  EV_SPAWN,
  TPS,
  VOID,
  WALL,
  type MatchResult,
  type Rules,
} from './types.ts';

export interface SimSetup {
  W: number;
  H: number;
  /** EMPTY = playable, WALL / VOID = blocked. */
  mask: Uint8Array;
  wrap: boolean;
  rules: Rules;
  seed: number;
  fighters: Fighter[];
  spawns: number[];
}

const ROUNDS = 3;
/** Ticks a pure race should roughly take to fill the arena. */
const TARGET_TICKS = 22 * TPS;

export class Sim {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  readonly wrap: boolean;
  rules: Rules;
  readonly owner: Uint8Array;
  readonly edgeDist: Uint16Array;
  readonly fighters: Fighter[];
  readonly rng: RNG;
  tick = 0;
  playable = 0;
  basePerTick = 1;
  fogR = 16;
  lastChangeTick = 0;
  result: MatchResult | null = null;

  /** Packed change log: idx * 256 + owner. */
  private changeBuf = new Uint32Array(4096);
  private changeLen = 0;
  /** Flat event log: [type, idx, a, b] per event. */
  events: number[] = [];
  private attackEvents = 0;
  freed: number[] = [];
  private regionScratch: RegionScratch;
  readonly scratchQ = new IntQueue(1024);
  private surgeFighter = -1;
  private surgeUntil = 0;
  private nextEventTick = 0;

  constructor(setup: SimSetup) {
    this.W = setup.W;
    this.H = setup.H;
    this.N = setup.W * setup.H;
    this.wrap = setup.wrap;
    this.rules = { ...setup.rules };
    this.owner = new Uint8Array(setup.mask);
    this.rng = new RNG(setup.seed ^ 0x51a7);
    for (let i = 0; i < this.N; i++) if (this.owner[i] < WALL) this.playable++;
    this.edgeDist = computeEdgeDist(this.owner, this.W, this.H, this.wrap);
    this.fighters = setup.fighters;
    const n = Math.max(1, this.fighters.length);
    this.basePerTick = Math.max(1, Math.min(2500, this.playable / (TARGET_TICKS * n)));
    this.fogR = Math.max(8, Math.round(0.12 * Math.max(this.W, this.H)));
    this.regionScratch = new RegionScratch(this.N);
    this.nextEventTick = 6 * TPS;
    for (const f of this.fighters) f.attach(this);
    this.fighters.forEach((f, i) => {
      const sp = setup.spawns[i];
      if (sp >= 0 && this.owner[sp] < WALL) {
        f.init(sp);
        this.pushEvent(EV_SPAWN, sp, f.id, 0);
      } else f.alive = false;
    });
  }

  // ---------------------------------------------------------------------
  // Grid helpers
  // ---------------------------------------------------------------------

  /** 4-neighbour of idx: d = 0 right, 1 down, 2 left, 3 up. -1 if off-grid. */
  nb(i: number, d: number): number {
    const W = this.W;
    switch (d) {
      case 0: {
        const x = i % W;
        return x + 1 < W ? i + 1 : this.wrap ? i - x : -1;
      }
      case 1: {
        const j = i + W;
        return j < this.N ? j : this.wrap ? j - this.N : -1;
      }
      case 2: {
        const x = i % W;
        return x > 0 ? i - 1 : this.wrap ? i + W - 1 : -1;
      }
      default: {
        const j = i - W;
        return j >= 0 ? j : this.wrap ? j + this.N : -1;
      }
    }
  }

  /** Cell index for (x, y) honouring wrap; -1 when outside. */
  at(x: number, y: number): number {
    const W = this.W, H = this.H;
    if (x < 0 || y < 0 || x >= W || y >= H) {
      if (!this.wrap) return -1;
      x = ((x % W) + W) % W;
      y = ((y % H) + H) % H;
    }
    return y * W + x;
  }

  passable(i: number): boolean {
    return this.owner[i] < WALL;
  }

  /** Own cell with at least one passable non-own neighbour. */
  isBorder(i: number, id: number): boolean {
    for (let d = 0; d < 4; d++) {
      const n = this.nb(i, d);
      if (n >= 0) {
        const o = this.owner[n];
        if (o !== id && o < WALL) return true;
      }
    }
    return false;
  }

  scanBorder(id: number, cb: (n: number, from: number) => void): void {
    const owner = this.owner, N = this.N;
    for (let i = 0; i < N; i++) {
      if (owner[i] !== id) continue;
      for (let d = 0; d < 4; d++) {
        const n = this.nb(i, d);
        if (n >= 0) {
          const o = owner[n];
          if (o !== id && o < WALL) cb(n, i);
        }
      }
    }
  }

  randomOwnedBorder(f: Fighter): number {
    if (f.owned === 0) return -1;
    const owner = this.owner, N = this.N;
    for (let t = 0; t < 64; t++) {
      const i = f.rng.int(N);
      if (owner[i] === f.id && this.isBorder(i, f.id)) return i;
    }
    const start = f.rng.int(N);
    for (let k = 0; k < N; k++) {
      const i = (start + k) % N;
      if (owner[i] === f.id && this.isBorder(i, f.id)) return i;
    }
    return -1;
  }

  countN(i: number, id: number): number {
    let k = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.nb(i, d);
      if (n >= 0 && this.owner[n] === id) k++;
    }
    return k;
  }

  /**
   * Multi-source BFS distance from every cell owned by an enemy of `id`.
   * 0 on enemy cells, 65535 where unknown (beyond maxDepth).
   */
  enemyDistance(id: number, out: Uint16Array, maxDepth = 65534): void {
    const owner = this.owner, N = this.N, q = this.scratchQ;
    out.fill(65535);
    q.clear();
    for (let i = 0; i < N; i++) {
      const o = owner[i];
      if (o !== EMPTY && o !== id && o < WALL) {
        out[i] = 0;
        q.push(i);
      }
    }
    while (q.length) {
      const c = q.shift();
      const dc = out[c] + 1;
      if (dc > maxDepth) continue;
      for (let d = 0; d < 4; d++) {
        const n = this.nb(c, d);
        if (n >= 0 && out[n] > dc && owner[n] < WALL) {
          out[n] = dc;
          q.push(n);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Ownership changes
  // ---------------------------------------------------------------------

  private logChange(idx: number, o: number): void {
    if (this.changeLen === this.changeBuf.length) {
      const nb = new Uint32Array(this.changeBuf.length * 2);
      nb.set(this.changeBuf);
      this.changeBuf = nb;
    }
    this.changeBuf[this.changeLen++] = idx * 256 + o;
  }

  /** Returns and clears the change log since the last call. */
  drainChanges(): Uint32Array {
    const out = this.changeBuf.slice(0, this.changeLen);
    this.changeLen = 0;
    if (this.changeBuf.length > 1 << 20) this.changeBuf = new Uint32Array(4096);
    return out;
  }

  get pendingChanges(): number {
    return this.changeLen;
  }

  pushEvent(type: number, idx: number, a: number, b: number): void {
    if (this.events.length < 4000) this.events.push(type, idx, a, b);
  }

  /** Give cell idx to fighter f, whatever was there (caller checks rules). */
  take(f: Fighter, idx: number): void {
    const prev = this.owner[idx];
    const W = this.W;
    const x = idx % W, y = (idx - x) / W;
    if (prev !== EMPTY && prev < WALL) {
      const v = this.fighters[prev - 1];
      v.owned--;
      v.sumX -= x;
      v.sumY -= y;
    }
    this.owner[idx] = f.id;
    f.owned++;
    f.sumX += x;
    f.sumY += y;
    f.gained++;
    if (f.owned > f.peak) f.peak = f.owned;
    this.logChange(idx, f.id);
    f.noteClaim(idx);
    this.lastChangeTick = this.tick;
  }

  /** Fighter gives up one of its cells. */
  release(f: Fighter, idx: number): void {
    if (this.owner[idx] !== f.id) return;
    const W = this.W;
    const x = idx % W, y = (idx - x) / W;
    this.owner[idx] = EMPTY;
    f.owned--;
    f.sumX -= x;
    f.sumY -= y;
    this.logChange(idx, EMPTY);
    this.freed.push(idx);
    this.lastChangeTick = this.tick;
  }

  /**
   * Try to claim a cell under the current rules, paying from f.budget.
   * Returns 1 on success, 0 on a failed attempt (budget spent), -1 when
   * the cell is not claimable at all (no cost).
   */
  claim(f: Fighter, idx: number, attackBonus = 1): number {
    const o = this.owner[idx];
    if (o === f.id || o >= WALL) return -1;
    if (o === EMPTY) {
      f.budget -= f.costFor(idx);
      this.take(f, idx);
      return 1;
    }
    if (!this.rules.attack) return -1;
    const v = this.fighters[o - 1];
    f.budget -= f.attackCost;
    if (v.armor >= 1) return 0;
    let p: number;
    switch (this.rules.conflict) {
      case 'random':
        p = 0.5;
        break;
      case 'speed':
        p = f.speed / (f.speed + v.speed);
        break;
      default: {
        const a = this.countN(idx, f.id), dd = this.countN(idx, o);
        p = (a + 0.5) / (a + dd + 1);
      }
    }
    p *= f.attackMul * attackBonus * (1 - v.armor);
    if (p > 0.97) p = 0.97;
    if (this.rng.next() >= p) return 0;
    this.take(f, idx);
    f.stolen++;
    v.onLost(idx, f.id);
    if (this.attackEvents < 48 && (this.attackEvents < 8 || this.rng.next() < 0.25)) {
      this.attackEvents++;
      this.pushEvent(EV_ATTACK, idx, f.id, o);
    }
    return 1;
  }

  /** Force a cell value (painting walls, meteors, consume). */
  setCell(idx: number, val: number, by = 0): void {
    const prev = this.owner[idx];
    if (prev === val) return;
    if (val !== EMPTY && val < WALL) {
      const f = this.fighters[val - 1];
      this.take(f, idx);
      if (prev !== EMPTY && prev < WALL) this.fighters[prev - 1].onLost(idx, val);
      return;
    }
    if (prev !== EMPTY && prev < WALL) {
      const v = this.fighters[prev - 1];
      const W = this.W;
      const x = idx % W, y = (idx - x) / W;
      v.owned--;
      v.sumX -= x;
      v.sumY -= y;
      v.onLost(idx, by);
    }
    if (prev >= WALL && val < WALL) this.playable++;
    if (prev < WALL && val >= WALL) this.playable--;
    this.owner[idx] = val;
    this.logChange(idx, val);
    if (val === EMPTY) this.freed.push(idx);
    this.lastChangeTick = this.tick;
  }

  /** Recompute edge distances after the arena is edited. */
  refreshArena(): void {
    this.edgeDist.set(computeEdgeDist(this.owner, this.W, this.H, this.wrap));
  }

  // ---------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------

  step(): void {
    if (this.result) return;
    this.tick++;
    this.attackEvents = 0;
    const fs = this.fighters;
    const order: Fighter[] = [];
    for (const f of fs) {
      if (!f.alive || f.owned === 0) {
        f.pool = 0;
        continue;
      }
      let mul = f.speed * f.ramp();
      if (this.surgeFighter === f.id && this.tick < this.surgeUntil) mul *= 2.5;
      f.pool += this.basePerTick * mul;
      f.onTick();
      order.push(f);
    }
    for (let r = 0; r < ROUNDS; r++) {
      this.rng.shuffle(order);
      for (const f of order) {
        if (f.owned === 0) continue;
        const slice = f.pool / (ROUNDS - r);
        if (slice <= 0) continue;
        f.budget = slice;
        f.step();
        f.pool -= slice - f.budget;
      }
    }
    for (const f of order) {
      // Allow a little carry-over (and debt) between ticks, not hoarding.
      const cap = this.basePerTick * f.speed;
      if (f.pool > cap) f.pool = cap;
      if (f.pool < -cap * 3) f.pool = -cap * 3;
      if (f.retreat > 0) this.retreatStep(f);
    }

    if (this.rules.consume && this.tick % 10 === 0) runConsume(this, this.regionScratch);
    if (this.rules.decay && this.tick % 12 === 6) runDecay(this, this.regionScratch);
    if (this.rules.events) this.chaosEvents();
    this.dispatchFreed();

    for (const f of fs) {
      if (f.alive && f.owned === 0 && this.tick > 1) {
        f.alive = false;
        f.elimTick = this.tick;
        this.pushEvent(EV_ELIM, f.spawn, f.id, 0);
      }
    }
    this.checkEnd();
  }

  private retreatStep(f: Fighter): void {
    const n = Math.floor(this.basePerTick * f.retreat * 0.5 + f.rng.next());
    for (let k = 0; k < n; k++) {
      const c = f.frontierCell();
      if (c >= 0 && f.owned > 4) this.release(f, c);
    }
  }

  private dispatchFreed(): void {
    const fr = this.freed;
    if (!fr.length) return;
    const owner = this.owner;
    for (let k = 0; k < fr.length; k++) {
      const c = fr[k];
      if (owner[c] !== EMPTY) continue;
      let seen = 0;
      for (let d = 0; d < 4; d++) {
        const n = this.nb(c, d);
        if (n < 0) continue;
        const o = owner[n];
        if (o === EMPTY || o >= WALL) continue;
        const bit = 1 << (o - 1);
        if (seen & bit) continue;
        seen |= bit;
        this.fighters[o - 1].onFreed(c);
      }
    }
    this.freed = [];
  }

  private chaosEvents(): void {
    if (this.tick < this.nextEventTick) return;
    this.nextEventTick = this.tick + Math.round((7 + this.rng.next() * 9) * TPS);
    if (this.rng.next() < 0.6) {
      // Meteor strike: blast a crater clean.
      let c = -1;
      for (let t = 0; t < 200 && c < 0; t++) {
        const i = this.rng.int(this.N);
        if (this.owner[i] !== EMPTY && this.owner[i] < WALL) c = i;
      }
      if (c < 0) return;
      const r = Math.max(3, Math.round(Math.max(this.W, this.H) * (0.04 + this.rng.next() * 0.04)));
      const cx = c % this.W, cy = (c / this.W) | 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          const i = this.at(cx + dx, cy + dy);
          if (i < 0 || this.owner[i] >= WALL) continue;
          this.setCell(i, EMPTY);
        }
      }
      this.pushEvent(EV_METEOR, c, r, 0);
    } else {
      // Growth surge: a random living fighter grows 2.5x for 4 seconds.
      const alive = this.fighters.filter((f) => f.alive);
      if (!alive.length) return;
      const f = this.rng.pick(alive);
      this.surgeFighter = f.id;
      this.surgeUntil = this.tick + 4 * TPS;
      const [x, y] = f.centroid();
      this.pushEvent(EV_METEOR, this.at(Math.round(x), Math.round(y)), 0, f.id);
    }
  }

  // ---------------------------------------------------------------------
  // End of match
  // ---------------------------------------------------------------------

  ranking(): number[] {
    return [...this.fighters]
      .sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        if (!a.alive && !b.alive && a.elimTick !== b.elimTick) return b.elimTick - a.elimTick;
        return b.owned - a.owned || b.peak - a.peak;
      })
      .map((f) => f.id);
  }

  private checkEnd(): void {
    const r = this.rules;
    const alive = this.fighters.filter((f) => f.alive).length;
    const limit = r.matchLength > 0 ? r.matchLength : r.win === 'timer' ? 60 : 0;
    let reason: MatchResult['reason'] | null = null;
    if (limit > 0 && this.tick >= limit * TPS) reason = 'timer';
    else if (alive <= 1 && this.fighters.length > 1 && r.win !== 'timer') reason = 'last';
    else if (alive === 0) reason = 'last';
    else if (this.tick - this.lastChangeTick > 2 * TPS && r.win !== 'timer') {
      reason = this.hasEmptyNextToFighter() ? 'settled' : 'full';
    } else if (this.tick - this.lastChangeTick > 4 * TPS) reason = 'settled';
    if (!reason) return;
    const ranking = this.ranking();
    const top = this.fighters[ranking[0] - 1];
    const second = ranking.length > 1 ? this.fighters[ranking[1] - 1] : null;
    const draw = !!second && second.alive === top.alive && second.owned === top.owned && r.win !== 'last';
    this.result = { winner: draw ? 0 : top.id, reason, ranking, tick: this.tick };
  }

  private hasEmptyNextToFighter(): boolean {
    const owner = this.owner;
    for (let i = 0; i < this.N; i++) {
      if (owner[i] !== EMPTY) continue;
      for (let d = 0; d < 4; d++) {
        const n = this.nb(i, d);
        if (n >= 0 && owner[n] !== EMPTY && owner[n] < WALL) return true;
      }
    }
    return false;
  }

  /** Total cells owned by fighters / playable. */
  claimedFraction(): number {
    let s = 0;
    for (const f of this.fighters) s += f.owned;
    return this.playable ? s / this.playable : 0;
  }
}

/** Chamfer (3-4) distance from every playable cell to the nearest blocked
 *  cell or arena border, in whole cells. */
export function computeEdgeDist(owner: Uint8Array, W: number, H: number, wrap: boolean): Uint16Array {
  const N = W * H;
  const d = new Uint32Array(N);
  const BIG = 1 << 30;
  for (let i = 0; i < N; i++) d[i] = owner[i] >= WALL ? 0 : BIG;
  const get = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) {
      if (!wrap) return 0;
      x = (x + W) % W;
      y = (y + H) % H;
    }
    return d[y * W + x];
  };
  for (let pass = 0; pass < (wrap ? 2 : 1); pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (d[i] === 0) continue;
        let v = d[i];
        v = Math.min(v, get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
        d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (d[i] === 0) continue;
        let v = d[i];
        v = Math.min(v, get(x + 1, y) + 3, get(x, y + 1) + 3, get(x + 1, y + 1) + 4, get(x - 1, y + 1) + 4);
        d[i] = v;
      }
    }
  }
  const out = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const v = d[i] >= BIG ? 65000 : Math.round(d[i] / 3);
    out[i] = owner[i] >= WALL ? 0 : Math.min(65000, v);
  }
  return out;
}

export { EMPTY, WALL, VOID };
