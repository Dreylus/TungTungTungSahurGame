import { MinHeap } from './heap.ts';
import type { RNG } from './rng.ts';
import type { Sim } from './sim.ts';
import { EMPTY, WALL } from './types.ts';

export interface FighterTraits {
  /** Pixels per tick multiplier. */
  speed: number;
  /** 0 = normal, 1 = cannot be overwritten, negative = easier to take. */
  armor: number;
  /** Attack success multiplier. */
  attackMul: number;
  /** Budget spent per attack attempt. */
  attackCost: number;
  /** Budget spent per empty pixel claimed. */
  emptyCost: number;
}

/**
 * Base class for every expansion algorithm. The sim gives each fighter a
 * pixel budget per tick and calls step(); the fighter spends it through
 * sim.claim(). Cells can be lost at any time (attacks, consume, decay) so
 * fighters validate their own bookkeeping lazily.
 */
export abstract class Fighter implements FighterTraits {
  readonly id: number;
  sim!: Sim;
  rng: RNG;
  speed = 1;
  armor = 0;
  attackMul = 1;
  attackCost = 1.5;
  emptyCost = 1;
  /** Fraction of budget to release each tick (custom "retreat"). */
  retreat = 0;

  budget = 0;
  pool = 0;
  owned = 0;
  peak = 0;
  alive = true;
  elimTick = -1;
  sumX = 0;
  sumY = 0;
  spawn = -1;
  gained = 0;
  stolen = 0;

  // Recently claimed cells: cheap source of frontier-ish locations.
  recent = new Int32Array(512);
  recentN = 0;
  recentPos = 0;

  // Heap-driven growth shared by many algorithms.
  heap = new MinHeap(512);
  inQ!: Uint8Array;
  private nextRescan = 0;
  private noBorderUntil = 0;
  private rescanBackoff = 12;
  protected seq = 0;

  constructor(id: number, rng: RNG) {
    this.id = id;
    this.rng = rng;
  }

  attach(sim: Sim): void {
    this.sim = sim;
    this.inQ = new Uint8Array(sim.N);
  }

  applyTraits(t: Partial<FighterTraits>): void {
    Object.assign(this, t);
  }

  /** Budget cost of claiming the empty cell idx. */
  costFor(_idx: number): number {
    return this.emptyCost;
  }

  /** Budget multiplier at the current tick (lets fighters ramp up). */
  ramp(): number {
    return 1;
  }

  /** Called once with the spawn cell after attach(). */
  init(spawn: number): void {
    this.spawn = spawn;
    this.seed(spawn);
  }

  /** Claim a seed pixel (spawn or click-to-spawn) and start growing from it. */
  seed(idx: number): void {
    const s = this.sim;
    if (s.owner[idx] >= WALL) return;
    if (s.owner[idx] !== this.id) s.take(this, idx);
    this.alive = true;
    this.onSeed(idx);
  }

  /** Hook for fighters that keep extra state about seeds. */
  onSeed(idx: number): void {
    this.expand(idx);
  }

  onTick(): void {}
  abstract step(): void;
  onLost(_idx: number, _by: number): void {}
  onFreed(idx: number): void {
    // Default: a freed cell next to us is a free frontier cell again.
    this.push(idx, this.keyFor(idx, -1));
  }

  noteClaim(idx: number): void {
    this.recent[this.recentPos] = idx;
    this.recentPos = (this.recentPos + 1) & 511;
    if (this.recentN < 512) this.recentN++;
  }

  // ---------------------------------------------------------------------
  // Heap growth helpers
  // ---------------------------------------------------------------------

  /** Priority of a frontier cell (lower = claimed sooner). */
  keyFor(_idx: number, _from: number): number {
    return this.seq++;
  }

  push(idx: number, key: number): void {
    if (this.inQ[idx]) return;
    const o = this.sim.owner[idx];
    if (o >= WALL || o === this.id) return;
    this.inQ[idx] = 1;
    this.heap.push(key, idx);
  }

  /** Push all claimable 4-neighbours of a freshly owned cell. */
  expand(idx: number): void {
    const s = this.sim;
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n < 0 || this.inQ[n]) continue;
      const o = s.owner[n];
      if (o >= WALL || o === this.id) continue;
      if (o !== EMPTY && !s.rules.attack) continue;
      this.inQ[n] = 1;
      this.heap.push(this.keyFor(n, idx), n);
    }
  }

  /** Called after a successful claim made through growOnce(). */
  onGrow(idx: number, _from: number): void {
    this.expand(idx);
  }

  /**
   * Pop the best frontier cell and try to claim it.
   * Returns false when there is nothing left to try.
   */
  growOnce(attackBonus = 1): boolean {
    const s = this.sim;
    if (this.heap.size === 0 && !this.refill()) return false;
    const c = this.heap.pop();
    const key = this.heap.lastKey;
    this.inQ[c] = 0;
    const o = s.owner[c];
    if (o === this.id || o >= WALL) return true;
    if (o !== EMPTY && !s.rules.attack) return true;
    if (!this.touches(c)) return true; // we lost the cell that bordered it
    const r = s.claim(this, c, attackBonus);
    if (r === 1) this.onGrow(c, -1);
    else if (r === 0 && s.owner[c] !== this.id && s.owner[c] !== EMPTY) {
      // Failed attack: try again later, once the front comes back round.
      this.inQ[c] = 1;
      this.heap.push(key + 2 + this.rng.next() * 4, c);
    }
    return true;
  }

  /** True when one of the 4-neighbours of idx is ours. */
  touches(idx: number): boolean {
    const s = this.sim;
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n >= 0 && s.owner[n] === this.id) return true;
    }
    return false;
  }

  ownNeighbors(idx: number): number {
    const s = this.sim;
    let k = 0;
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n >= 0 && s.owner[n] === this.id) k++;
    }
    return k;
  }

  /** Rebuild the heap from a full scan of our border (rate-limited). */
  refill(): boolean {
    const s = this.sim;
    if (this.owned === 0 || s.tick < this.nextRescan) return false;
    const before = this.heap.size;
    s.scanBorder(this.id, (n, from) => this.push(n, this.keyFor(n, from)));
    const found = this.heap.size > before;
    this.rescanBackoff = found ? 12 : Math.min(240, this.rescanBackoff * 2);
    this.nextRescan = s.tick + this.rescanBackoff;
    return this.heap.size > 0;
  }

  refillSoon(): void {
    this.nextRescan = 0;
    this.rescanBackoff = 12;
  }

  /** Spend budget on heap growth until it runs out. */
  growLoop(attackBonus = 1): void {
    let guard = 64 + ((this.budget * 12) | 0);
    while (this.budget > 0 && guard-- > 0) {
      if (!this.growOnce(attackBonus)) break;
    }
  }

  /** A random cell we own that borders unclaimed or enemy space, or -1. */
  frontierCell(): number {
    const s = this.sim;
    if (this.owned === 0) return -1;
    for (let t = 0; t < 24 && this.recentN > 0; t++) {
      const c = this.recent[this.rng.int(this.recentN)];
      if (s.owner[c] === this.id && s.isBorder(c, this.id)) return c;
    }
    // Fall back to frontier entries in the heap.
    for (let t = 0; t < 16 && this.heap.size > 0; t++) {
      const n = this.heap.vals[this.rng.int(this.heap.size)];
      for (let d = 0; d < 4; d++) {
        const m = s.nb(n, d);
        if (m >= 0 && s.owner[m] === this.id) return m;
      }
    }
    if (s.tick < this.noBorderUntil) return -1;
    const c = s.randomOwnedBorder(this);
    if (c < 0) this.noBorderUntil = s.tick + 30;
    return c;
  }

  centroid(): [number, number] {
    if (this.owned === 0) return [-1, -1];
    return [this.sumX / this.owned, this.sumY / this.owned];
  }
}
