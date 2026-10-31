/** Heap-driven fighters: Flood, Glacier, Encircler, Spiral, Tide, Parasite. */
import { Fighter } from '../engine/fighter.ts';
import { valueNoise } from '../engine/rng.ts';
import { EMPTY, EV_EBB, WALL } from '../engine/types.ts';

const SQRT2 = Math.SQRT2;

/** Octile (chamfer) distance grower: round, geodesic blobs. */
export abstract class ChamferFighter extends Fighter {
  dist!: Float32Array;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.dist = new Float32Array(sim.N).fill(1e9);
  }
  override onSeed(idx: number): void {
    this.dist[idx] = 0;
    this.expand(idx);
  }
  /** Distance estimate for a cell from its owned 8-neighbours. */
  chamfer(idx: number): number {
    const s = this.sim, W = s.W;
    const x = idx % W, y = (idx - x) / W;
    let best = 1e9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = s.at(x + dx, y + dy);
        if (n < 0 || s.owner[n] !== this.id) continue;
        const v = this.dist[n] + (dx && dy ? SQRT2 : 1);
        if (v < best) best = v;
      }
    }
    return best > 1e8 ? 0 : best;
  }
  override onGrow(idx: number, from: number): void {
    this.dist[idx] = this.chamfer(idx);
    super.onGrow(idx, from);
  }
  override keyFor(idx: number, _from: number): number {
    return this.chamfer(idx) + this.rng.next() * 0.35;
  }
}

/** 1. Flood — breadth-first, uniform in all directions. */
export class Flood extends ChamferFighter {
  step(): void {
    this.growLoop();
  }
}

/** 11. Glacier — slow, lobed growth that cannot be overwritten. */
export class Glacier extends ChamferFighter {
  private nseed = 0;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.nseed = this.rng.int(1 << 30);
  }
  override keyFor(idx: number, _from: number): number {
    const W = this.sim.W;
    const x = idx % W, y = (idx - x) / W;
    return this.chamfer(idx) + valueNoise(this.nseed, x * 0.08, y * 0.08) * 14;
  }
  step(): void {
    this.growLoop(0.8);
  }
}

/**
 * 3. Encircler — rushes along the steepest path to the arena edge, then
 * builds a wall along the boundary and finally fills inward ring by ring.
 */
export class Encircler extends Fighter {
  private runner = -1;
  private onEdge = false;
  override ramp(): number {
    const t = this.sim.tick;
    return t < 60 ? 0.75 : 1;
  }
  override onSeed(idx: number): void {
    if (this.runner < 0 && !this.onEdge) this.runner = idx;
    this.expand(idx);
  }
  override keyFor(idx: number, _from: number): number {
    return this.sim.edgeDist[idx] + this.seq++ * 1e-8;
  }
  /** Walls are cheap to raise in small arenas and costly in huge ones. */
  override costFor(idx: number): number {
    if (this.sim.edgeDist[idx] > 2) return this.emptyCost;
    const size = Math.max(this.sim.W, this.sim.H);
    return 0.6 + Math.min(1, size / 1024) * 0.9;
  }
  step(): void {
    const s = this.sim;
    // Phase 1: thin run to the nearest edge (gradient descent on edgeDist).
    let guard = 400;
    while (this.runner >= 0 && this.budget > 0 && guard-- > 0) {
      const ed = s.edgeDist;
      if (ed[this.runner] <= 1) {
        this.runner = -1;
        this.onEdge = true;
        break;
      }
      let best = -1, bd = ed[this.runner];
      for (let d = 0; d < 4; d++) {
        const n = s.nb(this.runner, d);
        if (n < 0 || s.owner[n] >= WALL) continue;
        const v = ed[n] + this.rng.next() * 0.5;
        if (v < bd && (s.owner[n] === EMPTY || s.owner[n] === this.id || s.rules.attack)) {
          bd = v;
          best = n;
        }
      }
      if (best < 0) {
        this.runner = -1;
        break;
      }
      if (s.owner[best] !== this.id) {
        const r = s.claim(this, best, 1.4);
        if (r !== 1) {
          if (r < 0) this.runner = -1;
          continue;
        }
        this.expand(best);
      }
      this.runner = best;
    }
    // Phase 2/3: edge-first priority growth (wall, then rings inward).
    this.growLoop(1.1);
  }
}

/** 4. Spiral — winds outward from its spawn point along a spiral arm. */
export class Spiral extends Fighter {
  private cx = 0;
  private cy = 0;
  private pitch = 3;
  private dir = 1;
  override init(spawn: number): void {
    const W = this.sim.W;
    this.cx = spawn % W;
    this.cy = (spawn - this.cx) / W;
    this.dir = this.rng.next() < 0.5 ? 1 : -1;
    super.init(spawn);
  }
  override keyFor(idx: number, _from: number): number {
    const s = this.sim, W = s.W;
    let dx = (idx % W) - this.cx, dy = Math.floor(idx / W) - this.cy;
    if (s.wrap) {
      if (dx > W / 2) dx -= W;
      if (dx < -W / 2) dx += W;
      if (dy > s.H / 2) dy -= s.H;
      if (dy < -s.H / 2) dy += s.H;
    }
    const r = Math.sqrt(dx * dx + dy * dy);
    let th = Math.atan2(dy, dx) * this.dir;
    if (th < 0) th += Math.PI * 2;
    const frac = th / (Math.PI * 2);
    // Unwrapped angle: whole turns + fraction of the current turn.
    const turn = Math.floor(r / this.pitch - frac);
    return turn + frac + this.rng.next() * 0.002;
  }
  step(): void {
    this.growLoop(1.05);
  }
}

/**
 * 15. Tide — floods hard, then ebbs and gives back part of the gain,
 * keeping a net profit each cycle. Lost ground is retaken first.
 */
export class Tide extends ChamferFighter {
  private phase: 'flow' | 'ebb' = 'flow';
  private phaseLeft = 40;
  private cycle: number[] = [];
  private ebbQuota = 0;
  override onTick(): void {
    if (--this.phaseLeft > 0) return;
    if (this.phase === 'flow') {
      this.phase = 'ebb';
      this.phaseLeft = 14;
      this.ebbQuota = Math.floor(this.cycle.length * 0.32);
      const [x, y] = this.centroid();
      if (x >= 0) this.sim.pushEvent(EV_EBB, this.sim.at(Math.round(x), Math.round(y)), this.id, 0);
    } else {
      this.phase = 'flow';
      this.phaseLeft = 40;
      this.cycle = [];
    }
  }
  override ramp(): number {
    return this.phase === 'flow' ? 1.3 : 0.2;
  }
  override onGrow(idx: number, from: number): void {
    if (this.phase === 'flow') this.cycle.push(idx);
    super.onGrow(idx, from);
  }
  override onLost(idx: number, _by: number): void {
    // Resilient: lost ground goes to the front of the queue.
    if (this.sim.rules.attack) this.push(idx, -5 + this.rng.next());
  }
  step(): void {
    if (this.phase === 'ebb' && this.ebbQuota > 0) {
      const per = Math.ceil(this.ebbQuota / Math.max(1, this.phaseLeft));
      let k = 0;
      while (k < per && this.cycle.length && this.ebbQuota > 0) {
        const c = this.cycle.pop()!;
        if (this.sim.owner[c] === this.id && this.owned > 8) {
          this.sim.release(this, c);
          k++;
        }
        this.ebbQuota--;
      }
    }
    this.growLoop(1.2);
  }
}

/**
 * 13. Parasite — hunts enemy borders and grows along them, leeching budget
 * from every pixel it steals.
 */
export class Parasite extends Fighter {
  field!: Uint16Array;
  private version = 0;
  private nextField = 0;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.field = new Uint16Array(sim.N).fill(65535);
  }
  override onTick(): void {
    const s = this.sim;
    // A leech with nothing to leech on is slow.
    this.emptyCost = s.rules.attack ? 1.2 : 2.1;
    if (s.tick >= this.nextField) {
      s.enemyDistance(this.id, this.field, s.rules.fog ? s.fogR : 65534);
      this.version++;
      this.nextField = s.tick + 15;
    }
  }
  override keyFor(idx: number, _from: number): number {
    // Without attacks there is no host to hunt: it just oozes outward.
    if (!this.sim.rules.attack) return this.seq++;
    const f = this.field[idx];
    const base = f === 65535 ? 900 : f;
    return base * 4 + this.rng.next() * 3;
  }
  override onLost(idx: number, _by: number): void {
    if (this.sim.rules.attack) this.push(idx, this.rng.next());
  }
  step(): void {
    const before = this.stolen;
    this.growLoop(1.1);
    // Leech: stolen pixels refund part of their cost.
    const leech = this.stolen - before;
    if (leech > 0) this.budget += leech * 0.2;
    if (this.budget > 0) this.growLoop(1.1);
  }
}
