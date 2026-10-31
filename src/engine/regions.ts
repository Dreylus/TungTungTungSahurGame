import type { Sim } from './sim.ts';
import { EMPTY, EV_CAPTURE, WALL } from './types.ts';

/** Reusable buffers for connected-region analysis. */
export class RegionScratch {
  labels: Int32Array;
  stack: Int32Array;
  regOwner = new Uint8Array(1024);
  regSize = new Int32Array(1024);
  regSumX = new Float64Array(1024);
  regSumY = new Float64Array(1024);
  count = 0;
  pairs: number[] = [];
  parent = new Int32Array(1024);
  constructor(N: number) {
    this.labels = new Int32Array(N);
    this.stack = new Int32Array(N);
  }
  ensure(n: number): void {
    if (n <= this.regOwner.length) return;
    let cap = this.regOwner.length;
    while (cap < n) cap *= 2;
    const o = new Uint8Array(cap);
    o.set(this.regOwner);
    this.regOwner = o;
    const s = new Int32Array(cap);
    s.set(this.regSize);
    this.regSize = s;
    const sx = new Float64Array(cap);
    sx.set(this.regSumX);
    this.regSumX = sx;
    const sy = new Float64Array(cap);
    sy.set(this.regSumY);
    this.regSumY = sy;
    this.parent = new Int32Array(cap);
  }
}

/**
 * Label 4-connected regions of equal owner (empty space included) and
 * collect the adjacency pairs between different regions.
 */
export function labelRegions(sim: Sim, sc: RegionScratch, wantPairs: boolean): void {
  const { N, W, owner } = sim;
  const labels = sc.labels, stack = sc.stack;
  labels.fill(-1);
  sc.count = 0;
  const pairSet = wantPairs ? new Set<number>() : null;
  for (let i = 0; i < N; i++) {
    if (labels[i] >= 0) continue;
    const o = owner[i];
    if (o >= WALL) continue;
    const lab = sc.count++;
    sc.ensure(sc.count);
    sc.regOwner[lab] = o;
    let size = 0, sx = 0, sy = 0;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = lab;
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const x = c % W;
      sx += x;
      sy += (c - x) / W;
      for (let d = 0; d < 4; d++) {
        const n = sim.nb(c, d);
        if (n < 0) continue;
        const on = owner[n];
        if (on >= WALL) continue;
        if (on === o) {
          if (labels[n] < 0) {
            labels[n] = lab;
            stack[sp++] = n;
          }
        } else if (pairSet && labels[n] >= 0) {
          const other = labels[n];
          pairSet.add(other < lab ? other * 2097152 + lab : lab * 2097152 + other);
        }
      }
    }
    sc.regSize[lab] = size;
    sc.regSumX[lab] = sx;
    sc.regSumY[lab] = sy;
  }
  sc.pairs = pairSet ? Array.from(pairSet) : [];
}

function find(p: Int32Array, a: number): number {
  while (p[a] !== a) {
    p[a] = p[p[a]];
    a = p[a];
  }
  return a;
}

/**
 * Consume rule: any pocket of non-X space (enemies and empty pixels) that is
 * enclosed only by fighter X (plus walls / arena border) and that is small
 * relative to X gets absorbed by X.
 */
export function runConsume(sim: Sim, sc: RegionScratch): void {
  const alive = sim.fighters.filter((f) => f.alive && f.owned > 0);
  if (alive.length < 2) return;
  labelRegions(sim, sc, true);
  const R = sc.count;
  const parent = sc.parent;
  const pairs = sc.pairs;
  const order = sim.rng.shuffle(alive.slice());
  for (const X of order) {
    const id = X.id;
    for (let r = 0; r < R; r++) parent[r] = r;
    // Union every pair of adjacent non-X regions.
    for (let k = 0; k < pairs.length; k++) {
      const key = pairs[k];
      const a = Math.floor(key / 2097152), b = key - a * 2097152;
      if (sc.regOwner[a] === id || sc.regOwner[b] === id) continue;
      const ra = find(parent, a), rb = find(parent, b);
      if (ra !== rb) parent[ra] = rb;
    }
    // Aggregate per component.
    const compSize = new Map<number, number>();
    const compEnemy = new Map<number, number>();
    const touchX = new Set<number>();
    for (let r = 0; r < R; r++) {
      if (sc.regOwner[r] === id) continue;
      const root = find(parent, r);
      compSize.set(root, (compSize.get(root) ?? 0) + sc.regSize[r]);
      if (sc.regOwner[r] !== EMPTY) compEnemy.set(root, (compEnemy.get(root) ?? 0) + sc.regSize[r]);
    }
    for (let k = 0; k < pairs.length; k++) {
      const key = pairs[k];
      const a = Math.floor(key / 2097152), b = key - a * 2097152;
      const ax = sc.regOwner[a] === id, bx = sc.regOwner[b] === id;
      if (ax === bx) continue;
      touchX.add(find(parent, ax ? b : a));
    }
    const limit = Math.max(24, X.owned * 0.45);
    const capture = new Set<number>();
    for (const [root, size] of compSize) {
      if (!touchX.has(root)) continue;
      const enemy = compEnemy.get(root) ?? 0;
      if (enemy === 0 || size > limit) continue;
      capture.add(root);
    }
    if (!capture.size) continue;
    // Absorb the pockets.
    const { N, owner } = sim;
    const labels = sc.labels;
    let total = 0, sx = 0, sy = 0;
    for (let i = 0; i < N; i++) {
      const lab = labels[i];
      if (lab < 0 || sc.regOwner[lab] === id) continue;
      if (!capture.has(find(parent, lab))) continue;
      if (owner[i] >= WALL || owner[i] === id) continue;
      sim.setCell(i, id, id);
      total++;
      const x = i % sim.W;
      sx += x;
      sy += (i - x) / sim.W;
    }
    if (total > 0) {
      const cx = Math.round(sx / total), cy = Math.round(sy / total);
      sim.pushEvent(EV_CAPTURE, sim.at(cx, cy), id, total);
      // Let the capturer keep growing from its new border.
      X.refillSoon();
    }
    // Labels are stale now; other fighters wait for the next check.
    return;
  }
}

/** Decay rule: pixels not connected to a fighter's main body slowly die. */
export function runDecay(sim: Sim, sc: RegionScratch): void {
  labelRegions(sim, sc, false);
  const R = sc.count;
  const best = new Int32Array(sim.fighters.length + 1).fill(-1);
  for (let r = 0; r < R; r++) {
    const o = sc.regOwner[r];
    if (o === EMPTY) continue;
    if (best[o] < 0 || sc.regSize[r] > sc.regSize[best[o]]) best[o] = r;
  }
  const { N, owner, labels } = { N: sim.N, owner: sim.owner, labels: sc.labels };
  const rng = sim.rng;
  for (let i = 0; i < N; i++) {
    const o = owner[i];
    if (o === EMPTY || o >= WALL) continue;
    const lab = labels[i];
    if (lab === best[o]) continue;
    const f = sim.fighters[o - 1];
    const p = f.armor >= 1 ? 0.05 : f.armor < 0 ? 0.3 : 0.16;
    if (rng.next() < p) sim.release(f, i);
  }
}
