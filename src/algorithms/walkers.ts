/** Agent / line based fighters: Mycelium, Lightning, Virus, Swarm, Crystal, Fractal. */
import { Fighter } from '../engine/fighter.ts';
import { Ray } from '../engine/ray.ts';
import { EMPTY, EV_BOLT, WALL } from '../engine/types.ts';

const TAU = Math.PI * 2;

export class Tip {
  ray: Ray;
  life: number;
  steps = 0;
  tries = 0;
  tx = 0;
  ty = 0;
  len = 0;
  depth = 0;
  side = false;
  constructor(x: number, y: number, ang: number, life: number) {
    this.ray = new Ray(x, y, ang);
    this.life = life;
  }
  get ang(): number {
    return this.ray.ang;
  }
  turn(a: number): void {
    this.ray.aim(this.ray.cx, this.ray.cy, a);
  }
}

/**
 * Advance a tip one cell. Returns 1 = claimed a new cell, 2 = moved over
 * own territory, 0 = failed attack, -1 = blocked.
 */
export function advance(f: Fighter, t: Tip, bonus = 1): number {
  const s = f.sim;
  const px = t.ray.cx, py = t.ray.cy;
  t.ray.next();
  const idx = s.at(t.ray.cx, t.ray.cy);
  if (idx < 0) {
    t.ray.aim(px, py, t.ray.ang);
    return -1;
  }
  if (s.wrap) {
    t.ray.cx = idx % s.W;
    t.ray.cy = (idx - t.ray.cx) / s.W;
  }
  const o = s.owner[idx];
  if (o === f.id) return 2;
  if (o >= WALL) {
    t.ray.aim(px, py, t.ray.ang);
    return -1;
  }
  const r = s.claim(f, idx, bonus);
  if (r === 1) {
    f.expand(idx);
    return 1;
  }
  t.ray.aim(px, py, t.ray.ang);
  return r;
}

function cellXY(f: Fighter, idx: number): [number, number] {
  const W = f.sim.W;
  const x = idx % W;
  return [x, (idx - x) / W];
}

/** Direction from a border cell pointing away from own territory. */
function outwardAngle(f: Fighter, idx: number): number {
  const s = f.sim;
  let vx = 0, vy = 0;
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (let d = 0; d < 4; d++) {
    const n = s.nb(idx, d);
    if (n >= 0 && s.owner[n] !== f.id && s.owner[n] < WALL) {
      vx += dirs[d][0];
      vy += dirs[d][1];
    }
  }
  if (vx === 0 && vy === 0) return f.rng.next() * TAU;
  return Math.atan2(vy, vx) + f.rng.tri() * 0.9;
}

/** 2. Mycelium — branching threads with wandering, forking tips. */
export class Mycelium extends Fighter {
  tips: Tip[] = [];
  branchChance = 0.035;
  turnJitter = 0.42;
  /** Extra cost per thread pixel: long thin walls are not free. */
  threadCost = 0.55;
  private rr = 0;
  override onSeed(idx: number): void {
    const [x, y] = cellXY(this, idx);
    for (let k = 0; k < 4; k++) this.tips.push(new Tip(x, y, this.rng.next() * TAU, 400));
    this.expand(idx);
  }
  private maxTips(): number {
    return Math.min(160, 10 + Math.floor(this.owned / 120));
  }
  private respawn(): boolean {
    const c = this.frontierCell();
    if (c < 0) return false;
    const [x, y] = cellXY(this, c);
    this.tips.push(new Tip(x, y, outwardAngle(this, c), 200));
    return true;
  }
  step(): void {
    let guard = 64 + ((this.budget * 10) | 0);
    let respawns = 0;
    while (this.budget > 0 && guard-- > 0) {
      if (this.tips.length < 3 && respawns++ < 3) this.respawn();
      if (!this.tips.length) break;
      if (this.rr >= this.tips.length) this.rr = 0;
      const t = this.tips[this.rr++];
      if (++t.steps % 3 === 0) t.turn(t.ang + this.rng.tri() * this.turnJitter);
      const r = advance(this, t);
      if (r === 1) {
        this.budget -= this.threadCost;
        if (this.tips.length < this.maxTips() && this.rng.next() < this.branchChance) {
          const fork = new Tip(t.ray.cx, t.ray.cy, t.ang + (this.rng.next() < 0.5 ? 1 : -1) * this.rng.range(0.5, 1.2), 300);
          this.tips.push(fork);
        }
      } else if (r === 2) {
        this.budget -= 0.25;
        if (--t.life <= 0) t.life = -1;
      } else {
        t.turn(t.ang + this.rng.range(0.7, 1.8) * (this.rng.next() < 0.5 ? 1 : -1));
        if (++t.tries > 4) t.life = -1;
        this.budget -= 0.1;
      }
      if (r === 1) t.tries = 0;
      if (t.life < 0) {
        const i = this.tips.indexOf(t);
        if (i >= 0) this.tips.splice(i, 1);
      }
    }
    // Leftover budget: slowly thicken threads.
    if (this.budget > 0) this.growLoop();
  }
}

/** 10. Lightning — fast jagged bolts toward distant targets. */
export class Lightning extends Fighter {
  bolts: Tip[] = [];
  private rr = 0;
  override onSeed(idx: number): void {
    this.expand(idx);
    for (let k = 0; k < 3; k++) this.spawnBolt(idx);
  }
  private spawnBolt(from = -1): void {
    const s = this.sim;
    const c = from >= 0 ? from : this.frontierCell();
    if (c < 0) return;
    const [x, y] = cellXY(this, c);
    const size = Math.max(s.W, s.H);
    let dist = size * this.rng.range(0.18, 0.5);
    if (s.rules.fog) dist = Math.min(dist, s.fogR * 1.2);
    const ang = from >= 0 ? this.rng.next() * TAU : outwardAngle(this, c);
    const t = new Tip(x, y, ang, Math.ceil(dist * 1.8));
    t.tx = x + Math.cos(ang) * dist;
    t.ty = y + Math.sin(ang) * dist;
    this.bolts.push(t);
  }
  private strike(t: Tip): void {
    const s = this.sim;
    const r = 2;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const i = s.at(t.ray.cx + dx, t.ray.cy + dy);
        if (i >= 0 && s.owner[i] === EMPTY && this.touches(i)) {
          s.claim(this, i);
          this.expand(i);
        }
      }
    if (!t.side) s.pushEvent(EV_BOLT, s.at(t.ray.cx, t.ray.cy), this.id, 0);
  }
  step(): void {
    const boltBudget = this.budget * 0.82;
    const rest = this.budget - boltBudget;
    this.budget = boltBudget;
    let guard = 64 + ((boltBudget * 10) | 0);
    while (this.budget > 0 && guard-- > 0) {
      if (this.bolts.length === 0) {
        this.spawnBolt();
        if (this.bolts.length === 0) break;
      }
      if (this.rr >= this.bolts.length) this.rr = 0;
      const t = this.bolts[this.rr++];
      if (t.len <= 0) {
        // New zig-zag segment aimed (roughly) at the target.
        const base = t.side ? t.ang : Math.atan2(t.ty - t.ray.cy, t.tx - t.ray.cx);
        t.turn(base + this.rng.tri() * 1.5);
        t.len = 2 + this.rng.int(5);
      }
      const r = advance(this, t, 1.1);
      let dead = false;
      if (r === 1 || r === 2) {
        t.len--;
        t.life--;
        this.budget -= r === 2 ? 0.15 : 0.35;
        if (r === 1 && !t.side && this.rng.next() < 0.06 && this.bolts.length < 48) {
          const b = new Tip(t.ray.cx, t.ray.cy, t.ang + (this.rng.next() < 0.5 ? 1 : -1) * this.rng.range(0.5, 1.1), 6 + this.rng.int(20));
          b.side = true;
          this.bolts.push(b);
        }
        const dx = t.tx - t.ray.cx, dy = t.ty - t.ray.cy;
        if ((!t.side && dx * dx + dy * dy < 6) || t.life <= 0) {
          this.strike(t);
          dead = true;
        }
      } else {
        t.len = 0;
        if (++t.tries > 3) dead = true;
        this.budget -= 0.1;
      }
      if (dead) {
        const i = this.bolts.indexOf(t);
        if (i >= 0) this.bolts.splice(i, 1);
        if (!t.side && this.bolts.length < 4) this.spawnBolt();
      }
    }
    // Afterglow: thicken around the bolts with what is left.
    this.budget += rest;
    if (this.budget > 0) this.growLoop();
  }
}

/** 7. Virus — random-walking virions that infect on contact. */
export class Virus extends Fighter {
  private pos = new Int32Array(256);
  private life = new Int16Array(256);
  private n = 0;
  private rr = 0;
  seek = 0.4;
  private add(idx: number): void {
    if (this.n >= this.pos.length) return;
    this.pos[this.n] = idx;
    this.life[this.n] = 40 + this.rng.int(60);
    this.n++;
  }
  override onSeed(idx: number): void {
    for (let k = 0; k < 8; k++) this.add(idx);
    this.expand(idx);
  }
  step(): void {
    const s = this.sim;
    const want = Math.min(this.pos.length, 18 + Math.floor(this.owned / 220));
    while (this.n < want) {
      const c = this.frontierCell();
      if (c < 0) break;
      this.add(c);
    }
    if (this.n === 0) return this.growLoop();
    let guard = 64 + ((this.budget * 8) | 0);
    while (this.budget > 0 && guard-- > 0) {
      if (this.rr >= this.n) this.rr = 0;
      const w = this.rr++;
      let p = this.pos[w];
      if (s.owner[p] !== this.id || --this.life[w] <= 0) {
        const c = this.frontierCell();
        if (c < 0) {
          // Kill this walker.
          this.n--;
          this.pos[w] = this.pos[this.n];
          this.life[w] = this.life[this.n];
          continue;
        }
        this.pos[w] = p = c;
        this.life[w] = 40 + this.rng.int(60);
      }
      // Seek contact: usually step toward a non-own neighbour if there is one.
      let nIdx = s.nb(p, this.rng.int(4));
      if (this.rng.next() < this.seek) {
        const d0 = this.rng.int(4);
        for (let k = 0; k < 4; k++) {
          const m = s.nb(p, (d0 + k) & 3);
          if (m >= 0 && s.owner[m] !== this.id && s.owner[m] < WALL && (s.owner[m] === EMPTY || s.rules.attack)) {
            nIdx = m;
            break;
          }
        }
      }
      if (nIdx < 0) {
        this.budget -= 0.05;
        continue;
      }
      const o = s.owner[nIdx];
      if (o === this.id) {
        this.pos[w] = nIdx;
        this.budget -= 0.07;
      } else if (o === EMPTY) {
        if (this.rng.next() < 0.85) {
          s.claim(this, nIdx);
          this.expand(nIdx);
          this.pos[w] = nIdx;
        } else this.budget -= 0.2;
      } else if (o < WALL && s.rules.attack) {
        if (s.claim(this, nIdx, 1.25) === 1) {
          this.pos[w] = nIdx;
          this.expand(nIdx);
          if (this.rng.next() < 0.35) this.add(nIdx); // outbreak
        }
      } else this.budget -= 0.05;
    }
  }
}

/** 12. Swarm — many tiny agents wander and claim whatever they touch. */
export class Swarm extends Fighter {
  private pos = new Int32Array(360);
  private dir = new Uint8Array(360);
  private idle = new Uint8Array(360);
  private n = 0;
  private rr = 0;
  turnChance = 0.28;
  override onSeed(idx: number): void {
    for (let k = 0; k < 24 && this.n < this.pos.length; k++) {
      this.pos[this.n] = idx;
      this.dir[this.n] = this.rng.int(4);
      this.n++;
    }
    this.expand(idx);
  }
  step(): void {
    const s = this.sim;
    const want = Math.min(this.pos.length, 36 + Math.floor(this.owned / 180));
    while (this.n < want) {
      const c = this.frontierCell();
      if (c < 0) break;
      this.pos[this.n] = c;
      this.dir[this.n] = this.rng.int(4);
      this.idle[this.n] = 0;
      this.n++;
    }
    if (this.n === 0) return this.growLoop();
    let guard = 64 + ((this.budget * 8) | 0);
    while (this.budget > 0 && guard-- > 0) {
      if (this.rr >= this.n) this.rr = 0;
      const a = this.rr++;
      let p = this.pos[a];
      if (s.owner[p] !== this.id || this.idle[a] > 36) {
        const c = this.frontierCell();
        if (c < 0) {
          this.budget -= 0.2;
          continue;
        }
        this.pos[a] = p = c;
        this.idle[a] = 0;
      }
      if (this.rng.next() < this.turnChance) this.dir[a] = (this.dir[a] + (this.rng.next() < 0.5 ? 1 : 3)) & 3;
      const nIdx = s.nb(p, this.dir[a]);
      if (nIdx < 0) {
        this.dir[a] = this.rng.int(4);
        this.budget -= 0.05;
        continue;
      }
      const o = s.owner[nIdx];
      if (o === this.id) {
        this.pos[a] = nIdx;
        this.idle[a]++;
        this.budget -= 0.16;
      } else if (o < WALL && (o === EMPTY || s.rules.attack)) {
        const r = s.claim(this, nIdx);
        if (r === 1) {
          this.pos[a] = nIdx;
          this.idle[a] = 0;
          this.expand(nIdx);
        } else this.dir[a] = this.rng.int(4);
      } else {
        this.dir[a] = this.rng.int(4);
        this.budget -= 0.05;
      }
    }
  }
}

/** 5. Crystal — straight rays at fixed hexagonal angles, faceted filling. */
export class Crystal extends Fighter {
  rays: Tip[] = [];
  private rot = 0;
  private best!: Uint8Array;
  private rr = 0;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.best = new Uint8Array(sim.N).fill(255);
    this.rot = this.rng.next() * (Math.PI / 3);
  }
  private dirAngle(k: number): number {
    return this.rot + (((k % 6) + 6) % 6) * (Math.PI / 3);
  }
  override onSeed(idx: number): void {
    const [x, y] = cellXY(this, idx);
    for (let k = 0; k < 6; k++) {
      const t = new Tip(x, y, this.dirAngle(k), 1e9);
      t.depth = k;
      this.rays.push(t);
    }
    this.expand(idx);
  }
  private own8(idx: number): number {
    const s = this.sim, W = s.W;
    const x = idx % W, y = (idx - x) / W;
    let k = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = s.at(x + dx, y + dy);
        if (n >= 0 && s.owner[n] === this.id) k++;
      }
    return k;
  }
  /** Facet growth: cells with many crystal neighbours fill first. */
  override expand(idx: number): void {
    const s = this.sim, W = s.W;
    const x = idx % W, y = (idx - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = s.at(x + dx, y + dy);
        if (n < 0) continue;
        const o = s.owner[n];
        if (o >= WALL || o === this.id) continue;
        if (o !== EMPTY && !s.rules.attack) continue;
        const key = 8 - this.own8(n);
        if (key < this.best[n]) {
          this.best[n] = key;
          this.heap.push(key + this.rng.next() * 0.5, n);
        }
      }
  }
  override onFreed(idx: number): void {
    this.best[idx] = 255;
    const k = 8 - this.own8(idx);
    this.best[idx] = k;
    this.heap.push(k, idx);
  }
  private fillOnce(strict: boolean): boolean {
    const s = this.sim;
    if (this.heap.size === 0) {
      if (!this.refill()) return false;
    }
    const c = this.heap.pop();
    const key = Math.floor(this.heap.lastKey);
    if (key > this.best[c]) return true; // stale duplicate
    this.best[c] = 255;
    const o = s.owner[c];
    if (o === this.id || o >= WALL) return true;
    if (o !== EMPTY && !s.rules.attack) return true;
    if (!this.touches(c)) return true;
    const own = this.own8(c);
    if (strict && own < 3) return true; // leave gaps while rays still run
    if (s.claim(this, c) === 1) this.expand(c);
    return true;
  }
  override refill(): boolean {
    this.best.fill(255);
    return super.refill();
  }
  override push(idx: number, key: number): void {
    if (key < this.best[idx]) {
      this.best[idx] = Math.max(0, Math.min(254, Math.floor(key)));
      this.heap.push(key, idx);
    }
  }
  override keyFor(idx: number): number {
    return 8 - this.own8(idx);
  }
  private newRay(): void {
    const s = this.sim;
    const c = this.frontierCell();
    if (c < 0) return;
    const [x, y] = cellXY(this, c);
    let bestK = 0, bestOpen = -1;
    for (let k = 0; k < 6; k++) {
      const r = new Ray(x, y, this.dirAngle(k));
      let open = 0;
      for (let i = 0; i < 8; i++) {
        r.next();
        const n = s.at(r.cx, r.cy);
        if (n < 0 || s.owner[n] !== EMPTY) break;
        open++;
      }
      if (open > bestOpen) {
        bestOpen = open;
        bestK = k;
      }
    }
    if (bestOpen < 2) return;
    const t = new Tip(x, y, this.dirAngle(bestK), 60 + this.rng.int(80));
    t.depth = bestK;
    this.rays.push(t);
  }
  step(): void {
    if (this.rays.length < 3) this.newRay();
    const rayBudget = this.rays.length ? this.budget * 0.7 : 0;
    const fillBudget = this.budget - rayBudget;
    this.budget = rayBudget;
    let guard = 32 + ((rayBudget * 8) | 0);
    while (this.budget > 0 && this.rays.length && guard-- > 0) {
      if (this.rr >= this.rays.length) this.rr = 0;
      const t = this.rays[this.rr++];
      const r = advance(this, t, 1.3);
      let dead = false;
      if (r === 1 || r === 2) {
        t.steps++;
        this.budget -= r === 2 ? 0.2 : 0.4;
        if (--t.life <= 0) dead = true;
        if (t.steps % 7 === 0 && this.rays.length < 90 && this.rng.next() < 0.6) {
          const side = this.rng.next() < 0.5 ? 1 : -1;
          const life = Math.min(t.life, 6 + this.rng.int(Math.max(4, t.steps / 2)));
          const b = new Tip(t.ray.cx, t.ray.cy, this.dirAngle(t.depth + side), life);
          b.depth = t.depth + side;
          this.rays.push(b);
        }
      } else dead = true;
      if (dead) {
        const i = this.rays.indexOf(t);
        if (i >= 0) this.rays.splice(i, 1);
      }
    }
    this.budget += fillBudget;
    let g2 = 64 + ((this.budget * 10) | 0);
    const strict = this.rays.length > 0;
    while (this.budget > 0 && g2-- > 0) {
      if (!this.fillOnce(strict)) break;
    }
  }
}

/** 14. Fractal — recursive branching trees, then thickening. */
export class Fractal extends Fighter {
  private queue: Tip[] = [];
  private active: Tip[] = [];
  private rr = 0;
  spread = 0.52;
  ratio = 0.72;
  private trunkLen(): number {
    const s = this.sim;
    return Math.max(6, Math.min(140, Math.max(s.W, s.H) * 0.1));
  }
  override onSeed(idx: number): void {
    const [x, y] = cellXY(this, idx);
    const rot = this.rng.next() * TAU;
    const L = this.trunkLen();
    for (let k = 0; k < 4; k++) {
      const t = new Tip(x, y, rot + (k * TAU) / 4, L);
      t.len = L;
      this.queue.push(t);
    }
    this.expand(idx);
  }
  private newTree(): void {
    const c = this.frontierCell();
    if (c < 0) return;
    const [x, y] = cellXY(this, c);
    const L = this.trunkLen() * this.rng.range(0.4, 0.8);
    const t = new Tip(x, y, outwardAngle(this, c), L);
    t.len = L;
    this.queue.push(t);
  }
  step(): void {
    while (this.active.length < 32 && this.queue.length) this.active.push(this.queue.shift()!);
    if (!this.active.length && this.rng.next() < 0.25) this.newTree();
    const treeBudget = this.active.length ? this.budget * 0.72 : 0;
    const rest = this.budget - treeBudget;
    this.budget = treeBudget;
    let guard = 32 + ((treeBudget * 8) | 0);
    while (this.budget > 0 && this.active.length && guard-- > 0) {
      if (this.rr >= this.active.length) this.rr = 0;
      const t = this.active[this.rr++];
      const r = advance(this, t);
      let done = false;
      if (r === 1 || r === 2) {
        this.budget -= r === 2 ? 0.2 : 0.25;
        if (--t.life <= 0) {
          done = true;
          const nl = t.len * this.ratio;
          if (nl >= 2.5) {
            for (const sgn of [-1, 1]) {
              const c = new Tip(t.ray.cx, t.ray.cy, t.ang + sgn * (this.spread + this.rng.tri() * 0.12), nl);
              c.len = nl;
              c.depth = t.depth + 1;
              this.queue.push(c);
            }
          }
        }
      } else done = true; // blocked: this branch stops (needs room)
      if (done) {
        const i = this.active.indexOf(t);
        if (i >= 0) this.active.splice(i, 1);
        if (this.queue.length) this.active.push(this.queue.shift()!);
      }
    }
    this.budget += rest;
    if (this.budget > 0) this.growLoop();
  }
}
