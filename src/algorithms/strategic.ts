/** Planning fighters: Wave, Hive, Slime Mold, Mind. */
import { Fighter } from '../engine/fighter.ts';
import { MinHeap } from '../engine/heap.ts';
import { EMPTY, EV_PULSE, WALL } from '../engine/types.ts';
import { advance, Tip } from './walkers.ts';

const TAU = Math.PI * 2;
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 8. Wave — pulses outward in rings; every ring is thicker than the last. */
export class Wave extends Fighter {
  private layer: number[] = [];
  private next: number[] = [];
  private lp = 0;
  private stamp!: Uint32Array;
  private gen = 1;
  private bank = 0;
  private resting = true;
  private restLeft = 6;
  private layersLeft = 0;
  private pulses = 0;
  restTicks = 12;
  maxThickness = 9;
  private nextScan = 0;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.stamp = new Uint32Array(sim.N);
  }
  private queueCell(n: number, toNext: boolean): void {
    if (this.stamp[n] === this.gen) return;
    const s = this.sim, o = s.owner[n];
    if (o >= WALL || o === this.id) return;
    if (o !== EMPTY && !s.rules.attack) return;
    this.stamp[n] = this.gen;
    (toNext ? this.next : this.layer).push(n);
  }
  private around(idx: number, toNext: boolean): void {
    const s = this.sim;
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n >= 0) this.queueCell(n, toNext);
    }
    // Every other ring also takes diagonals: octagonal (rounder) waves.
    if (this.gen & 1) {
      const W = s.W, x = idx % W, y = (idx - x) / W;
      for (const [dx, dy] of DIAG) {
        const n = s.at(x + dx, y + dy);
        if (n >= 0 && (s.owner[s.at(x + dx, y)] === this.id || s.owner[s.at(x, y + dy)] === this.id)) this.queueCell(n, toNext);
      }
    }
  }
  override onSeed(idx: number): void {
    this.around(idx, false);
  }
  override onFreed(idx: number): void {
    this.queueCell(idx, false);
  }
  override onLost(idx: number): void {
    if (this.sim.rules.attack) this.queueCell(idx, false);
  }
  override onTick(): void {
    if (this.resting && --this.restLeft <= 0) {
      this.resting = false;
      this.pulses++;
      this.layersLeft = Math.min(this.maxThickness, 1 + Math.floor(this.pulses / 2));
      const [x, y] = this.centroid();
      if (x >= 0) this.sim.pushEvent(EV_PULSE, this.sim.at(Math.round(x), Math.round(y)), this.id, this.layersLeft);
    }
  }
  private nextLayer(): void {
    this.layer = this.next;
    this.next = [];
    this.lp = 0;
    this.gen++;
    // Re-stamp the new layer so duplicates are filtered in this generation.
    for (const c of this.layer) this.stamp[c] = this.gen;
  }
  step(): void {
    const s = this.sim;
    if (this.resting) {
      this.bank += this.budget;
      const cap = s.basePerTick * this.speed * 18;
      if (this.bank > cap) this.bank = cap;
      this.budget = 0;
      return;
    }
    const extra = this.bank * 0.35;
    this.bank -= extra;
    this.budget += extra;
    let guard = 64 + ((this.budget * 6) | 0);
    let scanned = false;
    while (this.budget > 0 && guard-- > 0) {
      if (this.lp >= this.layer.length) {
        if (this.next.length === 0) {
          // Nothing queued: rebuild the frontier from our border (rarely).
          if (scanned || s.tick < this.nextScan) {
            this.resting = true;
            this.restLeft = this.restTicks;
            break;
          }
          scanned = true;
          this.nextScan = s.tick + 8;
          this.gen++;
          this.layer = [];
          this.lp = 0;
          s.scanBorder(this.id, (n) => this.queueCell(n, false));
          continue;
        }
        this.nextLayer();
        if (--this.layersLeft <= 0) {
          this.resting = true;
          this.restLeft = this.restTicks;
          break;
        }
        continue;
      }
      const c = this.layer[this.lp++];
      const o = s.owner[c];
      if (o === this.id || o >= WALL || !this.touches(c)) continue;
      const r = s.claim(this, c, 1.08);
      if (r === 1) this.around(c, true);
      else if (r === 0) {
        this.stamp[c] = 0;
        this.queueCell(c, true);
      }
    }
  }
}

interface Colony {
  x: number;
  y: number;
  size: number;
  target: number;
  launched: boolean;
}

/** 9. Hive — builds a dense cluster, then launches scouts that found colonies. */
export class Hive extends Fighter {
  colonies: Colony[] = [];
  colonyOf!: Uint8Array;
  scouts: Tip[] = [];
  private rr = 0;
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.colonyOf = new Uint8Array(sim.N);
  }
  private matureSize(): number {
    const s = this.sim;
    return Math.max(40, Math.min(6000, (s.playable / Math.max(2, s.fighters.length)) * 0.07));
  }
  private found(x: number, y: number): number {
    if (this.colonies.length >= 255) return this.colonies.length - 1;
    this.colonies.push({ x, y, size: 0, target: this.matureSize() * (this.colonies.length ? 0.6 : 1), launched: false });
    return this.colonies.length - 1;
  }
  override onSeed(idx: number): void {
    const W = this.sim.W;
    const x = idx % W, y = (idx - x) / W;
    const c = this.found(x, y);
    this.colonyOf[idx] = c;
    this.colonies[c].size++;
    this.expand(idx);
  }
  private curColony = -1;
  override expand(idx: number): void {
    const s = this.sim;
    if (this.curColony >= 0) this.colonyOf[idx] = this.curColony;
    const col = this.colonyOf[idx];
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n < 0 || this.inQ[n]) continue;
      const o = s.owner[n];
      if (o >= WALL || o === this.id) continue;
      if (o !== EMPTY && !s.rules.attack) continue;
      this.colonyOf[n] = col;
      this.inQ[n] = 1;
      this.heap.push(this.keyFor(n, idx), n);
    }
  }
  override keyFor(idx: number, from: number): number {
    const s = this.sim, W = s.W;
    const col = this.colonies[this.colonyOf[from >= 0 ? from : idx]] ?? this.colonies[0];
    if (!col) return 0;
    const dx = (idx % W) - col.x, dy = Math.floor(idx / W) - col.y;
    return Math.sqrt(dx * dx + dy * dy) + this.rng.next() * 0.8;
  }
  override onGrow(idx: number, from: number): void {
    const c = this.colonies[this.colonyOf[idx]];
    if (c) {
      c.size++;
      if (!c.launched && c.size >= c.target) {
        c.launched = true;
        this.launch(c);
      }
    }
    super.onGrow(idx, from);
  }
  private launch(c: Colony): void {
    const s = this.sim;
    const k = 3 + this.rng.int(3);
    const rot = this.rng.next() * TAU;
    const r = Math.sqrt(c.size / Math.PI);
    for (let i = 0; i < k; i++) {
      const a = rot + (i * TAU) / k + this.rng.tri() * 0.3;
      const t = new Tip(Math.round(c.x), Math.round(c.y), a, 0);
      let range = Math.max(s.W, s.H) * this.rng.range(0.1, 0.2) + r;
      if (s.rules.fog) range = Math.min(range, s.fogR + r);
      t.life = Math.ceil(range);
      t.len = Math.ceil(r * 0.8);
      t.depth = this.colonies.indexOf(c);
      this.scouts.push(t);
    }
  }
  step(): void {
    const s = this.sim;
    const scoutBudget = this.scouts.length ? this.budget * 0.3 : 0;
    const rest = this.budget - scoutBudget;
    this.budget = scoutBudget;
    let guard = 32 + ((scoutBudget * 8) | 0);
    while (this.budget > 0 && this.scouts.length && guard-- > 0) {
      if (this.rr >= this.scouts.length) this.rr = 0;
      const t = this.scouts[this.rr++];
      if (t.steps % 5 === 4) t.turn(t.ang + this.rng.tri() * 0.25);
      this.curColony = t.depth;
      const r = advance(this, t, 1.1);
      this.curColony = -1;
      t.steps++;
      let done = false;
      if (r === 1 || r === 2) {
        if (r === 2) this.budget -= 0.12;
        if (--t.life <= 0) done = true;
      } else done = true;
      if (done) {
        if (t.steps > t.len + 4) {
          const idx = s.at(t.ray.cx, t.ray.cy);
          if (idx >= 0 && s.owner[idx] === this.id) {
            const c = this.found(t.ray.cx, t.ray.cy);
            this.colonyOf[idx] = c;
            // Re-queue the neighbours with keys for the new colony.
            for (let d = 0; d < 4; d++) {
              const n = s.nb(idx, d);
              if (n < 0 || s.owner[n] >= WALL || s.owner[n] === this.id) continue;
              this.colonyOf[n] = c;
              this.inQ[n] = 1;
              this.heap.push(this.keyFor(n, idx), n);
            }
          }
        }
        const i = this.scouts.indexOf(t);
        if (i >= 0) this.scouts.splice(i, 1);
      }
    }
    this.budget += rest;
    this.growLoop();
  }
}

/** 6. Slime Mold — scouts for open food, builds an efficient tube to it, feeds. */
export class Slime extends Fighter {
  private path: number[] = [];
  private pp = 0;
  private feedHeap = new MinHeap(256);
  private feedLeft = 0;
  private fx = 0;
  private fy = 0;
  private cool = 0;
  private parents = new Map<number, number>();
  private openness(idx: number): number {
    const s = this.sim, W = s.W;
    const x = idx % W, y = (idx - x) / W;
    let k = 0;
    for (let dy = -6; dy <= 6; dy += 3)
      for (let dx = -6; dx <= 6; dx += 3) {
        const n = s.at(x + dx, y + dy);
        if (n >= 0 && s.owner[n] === EMPTY) k++;
      }
    return k;
  }
  /** Pick a food target and plan the shortest tube to it. Costs budget. */
  private explore(): void {
    const s = this.sim, W = s.W;
    const origin = this.frontierCell();
    if (origin < 0) return;
    const ox = origin % W, oy = (origin - ox) / W;
    const R = s.rules.fog ? s.fogR : Math.max(s.W, s.H) * 0.35;
    let best = -1, bestScore = -1;
    for (let t = 0; t < 10; t++) {
      const a = this.rng.next() * TAU, r = this.rng.range(6, R);
      const n = s.at(Math.round(ox + Math.cos(a) * r), Math.round(oy + Math.sin(a) * r));
      if (n < 0 || s.owner[n] !== EMPTY) continue;
      const sc = this.openness(n) / (1 + r * 0.02);
      if (sc > bestScore) {
        bestScore = sc;
        best = n;
      }
    }
    this.budget -= 2;
    if (best < 0) return;
    // BFS from the food back to our territory.
    const par = this.parents;
    par.clear();
    par.set(best, -1);
    const q: number[] = [best];
    let qi = 0, hit = -1;
    const maxVisit = 9000;
    while (qi < q.length && qi < maxVisit) {
      const c = q[qi++];
      for (let d = 0; d < 4; d++) {
        const n = s.nb(c, d);
        if (n < 0 || par.has(n)) continue;
        const o = s.owner[n];
        if (o === this.id) {
          hit = c;
          break;
        }
        if (o >= WALL || (o !== EMPTY && !s.rules.attack)) continue;
        par.set(n, c);
        q.push(n);
      }
      if (hit >= 0) break;
    }
    this.budget -= qi / 70; // exploring is not free
    if (hit < 0) return;
    const path: number[] = [];
    for (let c = hit; c >= 0; c = par.get(c) ?? -1) path.push(c);
    this.path = path;
    this.pp = 0;
    this.fx = best % W;
    this.fy = (best - this.fx) / W;
  }
  private feedPush(n: number): void {
    const W = this.sim.W;
    const dx = (n % W) - this.fx, dy = Math.floor(n / W) - this.fy;
    this.feedHeap.push(dx * dx + dy * dy + this.rng.next() * 2, n);
  }
  step(): void {
    const s = this.sim;
    const general = this.budget * 0.25;
    this.budget -= general;
    let guard = 64 + ((this.budget * 8) | 0);
    while (this.budget > 0 && guard-- > 0) {
      if (this.feedLeft > 0) {
        if (!this.feedHeap.size) {
          this.feedLeft = 0;
          continue;
        }
        const c = this.feedHeap.pop();
        const o = s.owner[c];
        if (o === this.id || o >= WALL || !this.touches(c)) continue;
        if (s.claim(this, c) === 1) {
          this.feedLeft--;
          this.expand(c);
          for (let d = 0; d < 4; d++) {
            const n = s.nb(c, d);
            if (n >= 0 && s.owner[n] !== this.id && s.owner[n] < WALL) this.feedPush(n);
          }
        }
        continue;
      }
      if (this.pp < this.path.length) {
        const c = this.path[this.pp++];
        if (s.owner[c] === this.id) continue;
        if (!this.touches(c) || s.claim(this, c, 1.1) !== 1) {
          this.path = [];
          continue;
        }
        this.expand(c);
        if (this.pp >= this.path.length) {
          // Arrived: feed around the food source.
          this.feedHeap.clear();
          this.feedLeft = Math.round(s.basePerTick * 14 + 30);
          for (let d = 0; d < 4; d++) {
            const n = s.nb(c, d);
            if (n >= 0) this.feedPush(n);
          }
        }
        continue;
      }
      if (this.cool > 0) {
        this.cool--;
        this.growLoop();
        break;
      }
      this.explore();
      if (this.pp >= this.path.length) this.cool = 2;
    }
    this.budget += general;
    if (this.budget > 0) this.growLoop();
  }
}

/** 16. Mind — scores candidate pixels each tick (greedy + lookahead). */
export class Mind extends Fighter {
  private front = new Int32Array(1024);
  private fn = 0;
  private fpos!: Int32Array;
  private field!: Uint16Array;
  private nextField = 0;
  private density!: Float32Array;
  private bw = 1;
  private nextDensity = 0;
  private cand: number[] = [];
  private scores: number[] = [];
  override attach(sim: Fighter['sim']): void {
    super.attach(sim);
    this.fpos = new Int32Array(sim.N).fill(-1);
    this.field = new Uint16Array(sim.N).fill(65535);
    this.bw = Math.ceil(sim.W / 8);
    this.density = new Float32Array(this.bw * Math.ceil(sim.H / 8));
  }
  private addFront(c: number): void {
    if (this.fpos[c] >= 0) return;
    const o = this.sim.owner[c];
    if (o >= WALL || o === this.id) return;
    if (o !== EMPTY && !this.sim.rules.attack) return;
    if (this.fn === this.front.length) {
      const nf = new Int32Array(this.front.length * 2);
      nf.set(this.front);
      this.front = nf;
    }
    this.fpos[c] = this.fn;
    this.front[this.fn++] = c;
  }
  private removeFront(c: number): void {
    const p = this.fpos[c];
    if (p < 0) return;
    const last = this.front[--this.fn];
    this.front[p] = last;
    this.fpos[last] = p;
    this.fpos[c] = -1;
  }
  override expand(idx: number): void {
    const s = this.sim;
    for (let d = 0; d < 4; d++) {
      const n = s.nb(idx, d);
      if (n >= 0) this.addFront(n);
    }
  }
  override onFreed(idx: number): void {
    this.addFront(idx);
  }
  override onLost(idx: number): void {
    if (this.sim.rules.attack) this.addFront(idx);
  }
  override onTick(): void {
    const s = this.sim;
    if (s.tick >= this.nextField) {
      s.enemyDistance(this.id, this.field, s.rules.fog ? s.fogR : 96);
      this.nextField = s.tick + 20;
    }
    if (s.tick >= this.nextDensity) {
      // Coarse map of where the empty land is (8x8 blocks).
      const W = s.W, H = s.H, bw = this.bw;
      const cnt = this.density;
      cnt.fill(0);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (s.owner[y * W + x] === EMPTY) cnt[(y >> 3) * bw + (x >> 3)] += 1 / 64;
      this.nextDensity = s.tick + 30;
    }
  }
  private score(c: number): number {
    const s = this.sim, W = s.W;
    const o = s.owner[c];
    const own = this.ownNeighbors(c);
    const x = c % W, y = (c - x) / W;
    let open = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const n = s.at(x + dx, y + dy);
        if (n >= 0 && s.owner[n] === EMPTY) open++;
      }
    const dens = this.density[(y >> 3) * this.bw + (x >> 3)] || 0;
    const ed = this.field[c];
    const contested = ed === 65535 ? 0 : Math.max(0, 14 - ed);
    let sc = own * 1.1 + open * 0.1 + contested * 0.5 + dens * 2.2;
    if (o !== EMPTY) {
      const support = s.countN(c, o);
      sc = 2.5 + (own - support) * 1.4 + (support <= 1 ? 2 : 0);
    }
    if (s.rules.consume) {
      // Bridging cells close loops around enemy pockets.
      const r = s.nb(c, 0), l = s.nb(c, 2), u = s.nb(c, 3), dn = s.nb(c, 1);
      const id = this.id;
      if ((r >= 0 && l >= 0 && s.owner[r] === id && s.owner[l] === id) || (u >= 0 && dn >= 0 && s.owner[u] === id && s.owner[dn] === id))
        sc += 1.6 + contested * 0.2;
    }
    return sc + this.rng.next() * 0.3;
  }
  step(): void {
    const s = this.sim;
    if (this.fn === 0) {
      if (!this.refill()) return;
    }
    let rounds = 0;
    while (this.budget > 0 && rounds++ < 6) {
      if (this.fn === 0) break;
      const want = Math.max(1, Math.ceil(this.budget));
      const S = Math.min(this.fn, want * 4 + 24);
      const cand = this.cand, scores = this.scores;
      cand.length = 0;
      scores.length = 0;
      for (let k = 0; k < S && this.fn > 0; k++) {
        const c = this.front[this.rng.int(this.fn)];
        const o = s.owner[c];
        if (o === this.id || o >= WALL || (o !== EMPTY && !s.rules.attack) || !this.touches(c)) {
          this.removeFront(c);
          continue;
        }
        cand.push(c);
        scores.push(this.score(c));
      }
      // Thinking is expensive: pay for the candidates evaluated.
      this.budget -= cand.length * 0.012;
      const idx = cand.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
      for (let k = 0; k < idx.length && this.budget > 0; k++) {
        const c = cand[idx[k]];
        const o = s.owner[c];
        if (o === this.id || o >= WALL || !this.touches(c)) continue;
        const r = s.claim(this, c, 1.05);
        if (r === 1) {
          this.removeFront(c);
          this.expand(c);
        } else if (r < 0) this.removeFront(c);
      }
    }
  }
  private nextRefill = 0;
  override refill(): boolean {
    const s = this.sim;
    if (s.tick < this.nextRefill) return this.fn > 0;
    s.scanBorder(this.id, (n) => this.addFront(n));
    this.nextRefill = s.tick + (this.fn > 0 ? 4 : 60);
    return this.fn > 0;
  }
}
