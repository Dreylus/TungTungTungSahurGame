/** Arena shapes, obstacles, spawn layouts and mask encoding. */
import { fbm, hash32, RNG } from '../engine/rng.ts';
import { EMPTY, VOID, WALL, type ArenaConfig, type ArenaShape, type Aspect, type FighterSlot, type SpawnLayout } from '../engine/types.ts';

export const ARENA_SHAPES: { id: ArenaShape; name: string }[] = [
  { id: 'square', name: 'Square' },
  { id: 'circle', name: 'Circle' },
  { id: 'hexagon', name: 'Hexagon' },
  { id: 'ring', name: 'Ring' },
  { id: 'cross', name: 'Cross' },
  { id: 'spiral', name: 'Spiral' },
  { id: 'islands', name: 'Islands' },
  { id: 'maze', name: 'Maze' },
  { id: 'random', name: 'Random' },
  { id: 'custom', name: 'Custom' },
  { id: 'image', name: 'Photo' },
];

export const ARENA_SIZES = [64, 96, 128, 160, 192, 256, 320, 384, 512, 640, 768, 1024];

/** Paint overlay values. */
export const P_NONE = 0, P_WALL = 1, P_HOLE = 2, P_FLOOR = 3;

export function arenaDims(size: number, aspect: Aspect): [number, number] {
  const s = Math.max(32, Math.min(1024, Math.round(size)));
  if (aspect === '4:5') return [Math.round((s * 4) / 5), s];
  if (aspect === '9:16') return [Math.round((s * 9) / 16), s];
  return [s, s];
}

export interface BuiltArena {
  W: number;
  H: number;
  mask: Uint8Array;
}

/** Build the playable mask for a config. Deterministic for (config, seed). */
export function buildArena(cfg: ArenaConfig, seed: number): BuiltArena {
  const [W, H] = arenaDims(cfg.size, cfg.aspect);
  const mask = shapeMask(cfg.shape, W, H, seed, cfg);
  if (cfg.obstacles === 'random') addRandomObstacles(mask, W, H, hash32(seed, 77));
  if ((cfg.obstacles === 'custom' || cfg.shape === 'custom') && cfg.paint && cfg.paintW && cfg.paintH) {
    const paint = scaleMask(decodeMask(cfg.paint, cfg.paintW * cfg.paintH), cfg.paintW, cfg.paintH, W, H);
    applyPaint(mask, paint);
  }
  // Never leave an arena with no floor.
  let floor = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === EMPTY) floor++;
  if (floor < 16) mask.fill(EMPTY);
  return { W, H, mask };
}

export function applyPaint(mask: Uint8Array, paint: Uint8Array): void {
  for (let i = 0; i < mask.length; i++) {
    const p = paint[i];
    if (p === P_WALL) mask[i] = WALL;
    else if (p === P_HOLE) mask[i] = VOID;
    else if (p === P_FLOOR) mask[i] = EMPTY;
  }
}

export function shapeMask(shape: ArenaShape, W: number, H: number, seed: number, cfg?: ArenaConfig): Uint8Array {
  const m = new Uint8Array(W * H);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const R = Math.min(W, H) / 2 - 0.5;
  const each = (fn: (x: number, y: number, dx: number, dy: number) => number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = fn(x, y, x - cx, y - cy);
  };
  switch (shape) {
    case 'circle': {
      // Ellipse that fills the arena box.
      const rx = W / 2 - 0.5, ry = H / 2 - 0.5;
      each((_x, _y, dx, dy) => ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1 ? EMPTY : VOID));
      break;
    }
    case 'hexagon': {
      const Rh = Math.min(H / 2 - 0.5, (W / 2 - 0.5) / (Math.sqrt(3) / 2));
      const half = (Math.sqrt(3) / 2) * Rh;
      const sy = H / 2 / Rh; // stretch tall arenas a little
      each((_x, _y, dx, dy) => {
        const ax = Math.abs(dx), ay = Math.abs(dy) / Math.max(1, sy * 0.9);
        return ax <= half && ay <= Rh - ax / Math.sqrt(3) ? EMPTY : VOID;
      });
      break;
    }
    case 'ring': {
      const rx = W / 2 - 0.5, ry = H / 2 - 0.5;
      each((_x, _y, dx, dy) => ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1 ? EMPTY : VOID));
      // Inner hole: 40% radius.
      for (let i = 0; i < m.length; i++) {
        const x = i % W, y = (i - x) / W;
        const dx = (x - cx) / (W / 2), dy = (y - cy) / (H / 2);
        if (dx * dx + dy * dy < 0.4 * 0.4) m[i] = VOID;
      }
      break;
    }
    case 'cross': {
      const arm = Math.min(W, H) * 0.19;
      each((_x, _y, dx, dy) => (Math.abs(dx) <= arm || Math.abs(dy) <= arm ? EMPTY : VOID));
      break;
    }
    case 'spiral': {
      const rx = W / 2 - 0.5, ry = H / 2 - 0.5;
      const turns = 3.2;
      const pitch = 1 / turns;
      const thick = Math.max(0.035, 2.2 / Math.min(W, H));
      each((_x, _y, dx, dy) => {
        const nx = dx / rx, ny = dy / ry;
        const r = Math.sqrt(nx * nx + ny * ny);
        if (r > 1) return VOID;
        if (r < pitch * 0.55) return EMPTY;
        let th = Math.atan2(ny, nx) / (Math.PI * 2);
        if (th < 0) th += 1;
        const u = (r / pitch - th) % 1;
        const uu = u < 0 ? u + 1 : u;
        return uu < thick / pitch ? WALL : EMPTY;
      });
      break;
    }
    case 'islands':
      islands(m, W, H, seed);
      break;
    case 'maze':
      maze(m, W, H, seed);
      break;
    case 'random':
      randomArena(m, W, H, seed);
      break;
    case 'image': {
      if (cfg?.imageMask && cfg.imageW && cfg.imageH) {
        const src = decodeMask(cfg.imageMask, cfg.imageW * cfg.imageH);
        const sc = scaleMask(src, cfg.imageW, cfg.imageH, W, H);
        for (let i = 0; i < m.length; i++) m[i] = sc[i] === 1 ? WALL : sc[i] === 2 ? VOID : EMPTY;
      }
      break;
    }
    default:
      break; // square & custom start as open floor
  }
  return m;
}

function disc(m: Uint8Array, W: number, H: number, cx: number, cy: number, rx: number, ry: number, val: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) m[y * W + x] = val;
    }
}

function thickLine(m: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, r: number, val: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(m, W, H, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, val);
  }
}

function islands(m: Uint8Array, W: number, H: number, seed: number): void {
  const rng = new RNG(hash32(seed, 11));
  m.fill(VOID);
  const cx = W / 2, cy = H / 2;
  const S = Math.min(W, H);
  const k = 4 + rng.int(3);
  const ringR = S * 0.33;
  const pts: [number, number, number][] = [[cx, cy, S * 0.16]];
  const rot = rng.next() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * Math.PI * 2 + rng.tri() * 0.25;
    const rr = ringR * (1 + rng.tri() * 0.12);
    const px = cx + Math.cos(a) * rr * (W / S);
    const py = cy + Math.sin(a) * rr * (H / S);
    pts.push([px, py, S * (0.1 + rng.next() * 0.04)]);
  }
  const bridge = Math.max(1.2, S * 0.018);
  for (let i = 1; i < pts.length; i++) {
    thickLine(m, W, H, pts[0][0], pts[0][1], pts[i][0], pts[i][1], bridge, EMPTY);
    const j = i === pts.length - 1 ? 1 : i + 1;
    if (rng.next() < 0.6) thickLine(m, W, H, pts[i][0], pts[i][1], pts[j][0], pts[j][1], bridge, EMPTY);
  }
  for (const [x, y, r] of pts) {
    // Lumpy islands: a few overlapping discs.
    disc(m, W, H, x, y, r, r, EMPTY);
    for (let t = 0; t < 3; t++) {
      const a = rng.next() * Math.PI * 2;
      disc(m, W, H, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.65, r * 0.65, EMPTY);
    }
  }
}

function maze(m: Uint8Array, W: number, H: number, seed: number): void {
  const rng = new RNG(hash32(seed, 23));
  const cs = Math.max(6, Math.round(Math.min(W, H) / 9));
  const wt = Math.max(1, Math.round(cs * 0.28));
  const cw = Math.max(2, Math.floor(W / cs)), ch = Math.max(2, Math.floor(H / cs));
  const ox = Math.floor((W - cw * cs) / 2), oy = Math.floor((H - ch * cs) / 2);
  m.fill(WALL);
  const seen = new Uint8Array(cw * ch);
  const carveCell = (c: number) => {
    const gx = c % cw, gy = (c - gx) / cw;
    for (let y = 0; y < cs - wt; y++)
      for (let x = 0; x < cs - wt; x++) {
        const px = ox + gx * cs + x + Math.ceil(wt / 2), py = oy + gy * cs + y + Math.ceil(wt / 2);
        if (px < W && py < H) m[py * W + px] = EMPTY;
      }
  };
  const carveLink = (a: number, b: number) => {
    const ax = a % cw, ay = (a - ax) / cw, bx = b % cw, by = (b - bx) / cw;
    const x0 = Math.min(ax, bx), y0 = Math.min(ay, by), x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
    const sx = ox + x0 * cs + Math.ceil(wt / 2), sy = oy + y0 * cs + Math.ceil(wt / 2);
    const ex = ox + x1 * cs + cs - wt + Math.ceil(wt / 2), ey = oy + y1 * cs + cs - wt + Math.ceil(wt / 2);
    for (let y = sy; y < ey && y < H; y++) for (let x = sx; x < ex && x < W; x++) m[y * W + x] = EMPTY;
  };
  const stack = [rng.int(cw * ch)];
  seen[stack[0]] = 1;
  carveCell(stack[0]);
  while (stack.length) {
    const c = stack[stack.length - 1];
    const gx = c % cw, gy = (c - gx) / cw;
    const opts: number[] = [];
    if (gx > 0 && !seen[c - 1]) opts.push(c - 1);
    if (gx < cw - 1 && !seen[c + 1]) opts.push(c + 1);
    if (gy > 0 && !seen[c - cw]) opts.push(c - cw);
    if (gy < ch - 1 && !seen[c + cw]) opts.push(c + cw);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const n = rng.pick(opts);
    seen[n] = 1;
    carveCell(n);
    carveLink(c, n);
    stack.push(n);
  }
  // Knock out extra walls so the maze has loops (better battles).
  const extra = Math.round(cw * ch * 0.18);
  for (let i = 0; i < extra; i++) {
    const c = rng.int(cw * ch);
    const gx = c % cw;
    const n = rng.next() < 0.5 ? (gx < cw - 1 ? c + 1 : c - 1) : c + cw < cw * ch ? c + cw : c - cw;
    carveLink(c, n);
  }
}

function randomArena(m: Uint8Array, W: number, H: number, seed: number): void {
  const rng = new RNG(hash32(seed, 31));
  const style = rng.int(3);
  const sc = 4 / Math.min(W, H);
  const ns = hash32(seed, 5);
  if (style === 0) {
    // Caves.
    const th = 0.5 + rng.range(-0.04, 0.05);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = fbm(ns, x * sc, y * sc, 4);
        const ex = Math.min(x, W - 1 - x, y, H - 1 - y) / (Math.min(W, H) * 0.08);
        m[y * W + x] = v + (1 - Math.min(1, ex)) * 0.25 > th + 0.12 ? WALL : EMPTY;
      }
  } else if (style === 1) {
    // Blob continent.
    m.fill(VOID);
    const n = 6 + rng.int(8);
    for (let i = 0; i < n; i++) {
      const r = Math.min(W, H) * rng.range(0.12, 0.28);
      disc(m, W, H, rng.range(r, W - r), rng.range(r, H - r), r * rng.range(0.8, 1.3), r, EMPTY);
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (m[y * W + x] === EMPTY && fbm(ns, x * sc * 2, y * sc * 2, 3) > 0.68) m[y * W + x] = WALL;
  } else {
    // Mirror-symmetric fortress.
    const half = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x <= W / 2; x++) {
        const v = fbm(ns, x * sc * 1.4, y * sc * 1.4, 3);
        half[y * W + x] = v > 0.62 ? WALL : EMPTY;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = x <= W / 2 ? x : W - 1 - x;
        m[y * W + x] = half[y * W + sx];
      }
  }
  keepLargest(m, W, H);
}

/** Turn every floor region except the largest into wall. */
export function keepLargest(m: Uint8Array, W: number, H: number): void {
  const N = W * H;
  const lab = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let best = -1, bestSize = 0, count = 0;
  for (let i = 0; i < N; i++) {
    if (m[i] !== EMPTY || lab[i] >= 0) continue;
    let sp = 0, size = 0;
    stack[sp++] = i;
    lab[i] = count;
    while (sp) {
      const c = stack[--sp];
      size++;
      const x = c % W;
      const ns = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W];
      for (const n of ns) {
        if (n < 0 || n >= N || m[n] !== EMPTY || lab[n] >= 0) continue;
        lab[n] = count;
        stack[sp++] = n;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = count;
    }
    count++;
  }
  for (let i = 0; i < N; i++) if (m[i] === EMPTY && lab[i] !== best) m[i] = WALL;
}

function addRandomObstacles(m: Uint8Array, W: number, H: number, seed: number): void {
  const rng = new RNG(seed);
  const S = Math.min(W, H);
  const count = Math.max(4, Math.min(40, Math.round((W * H) / 2600)));
  for (let i = 0; i < count; i++) {
    const x = rng.next() * W, y = rng.next() * H;
    if (rng.next() < 0.55) {
      const r = S * rng.range(0.015, 0.05);
      disc(m, W, H, x, y, r, r * rng.range(0.6, 1.4), WALL);
    } else {
      const a = rng.next() * Math.PI;
      const len = S * rng.range(0.06, 0.18);
      thickLine(m, W, H, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, Math.max(0.6, S * 0.008), WALL);
    }
  }
  // Keep the outer shape intact; only floor cells became walls.
}

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------

export function computeSpawns(
  mask: Uint8Array,
  W: number,
  H: number,
  slots: FighterSlot[],
  layout: SpawnLayout,
  seed: number,
): number[] {
  const n = slots.length;
  const rng = new RNG(hash32(seed, 101));
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  let pts: [number, number][] = [];
  switch (layout) {
    case 'corners': {
      const ix = W * 0.1, iy = H * 0.1;
      const rect: [number, number][] = [
        [ix, iy],
        [W - 1 - ix, H - 1 - iy],
        [W - 1 - ix, iy],
        [ix, H - 1 - iy],
        [cx, iy],
        [cx, H - 1 - iy],
        [ix, cy],
        [W - 1 - ix, cy],
      ];
      for (let i = 0; i < n; i++) {
        if (i < rect.length) pts.push(rect[i]);
        else {
          const t = (i - rect.length + 0.5) / Math.max(1, n - rect.length);
          const a = t * Math.PI * 2 + Math.PI / 8;
          pts.push([cx + Math.cos(a) * W * 0.4, cy + Math.sin(a) * H * 0.4]);
        }
      }
      break;
    }
    case 'center': {
      const r = Math.max(2, Math.min(W, H) * 0.07);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      break;
    }
    case 'random': {
      for (let i = 0; i < n; i++) {
        let best: [number, number] = [cx, cy], bestD = -1;
        for (let t = 0; t < 40; t++) {
          const x = rng.int(W), y = rng.int(H);
          if (mask[y * W + x] !== EMPTY) continue;
          let d = Infinity;
          for (const p of pts) d = Math.min(d, (p[0] - x) ** 2 + (p[1] - y) ** 2);
          if (d > bestD) {
            bestD = d;
            best = [x, y];
          }
        }
        pts.push(best);
      }
      break;
    }
    default: {
      // symmetric (and the base for manual)
      const rx = W * 0.33, ry = H * 0.33;
      const rot = -Math.PI / 2 + (n === 4 ? Math.PI / 4 : 0);
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
    }
  }
  if (layout === 'manual') {
    pts = pts.map((p, i) => (slots[i].spawn ? [slots[i].spawn![0], slots[i].spawn![1]] : p));
  }
  const used = new Set<number>();
  return pts.map(([x, y]) => {
    const idx = nearestFloor(mask, W, H, Math.round(x), Math.round(y), used);
    if (idx >= 0) used.add(idx);
    return idx;
  });
}

export function nearestFloor(mask: Uint8Array, W: number, H: number, x: number, y: number, used?: Set<number>): number {
  x = Math.max(0, Math.min(W - 1, x));
  y = Math.max(0, Math.min(H - 1, y));
  const ok = (i: number) => mask[i] === EMPTY && !used?.has(i);
  if (ok(y * W + x)) return y * W + x;
  const maxR = Math.max(W, H);
  for (let r = 1; r < maxR; r++) {
    let best = -1, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = py * W + px;
        if (!ok(i)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Mask encoding (run-length + base64) and scaling
// ---------------------------------------------------------------------------

export function encodeMask(a: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let run = 1;
    while (i + run < a.length && a[i + run] === v) run++;
    out.push(v);
    let r = run;
    while (r >= 0x80) {
      out.push((r & 0x7f) | 0x80);
      r >>>= 7;
    }
    out.push(r);
    i += run;
  }
  let bin = '';
  const bytes = new Uint8Array(out);
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(bin);
}

export function decodeMask(s: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  try {
    const bin = atob(s);
    let i = 0, p = 0;
    while (i < bin.length && p < n) {
      const v = bin.charCodeAt(i++);
      let run = 0, shift = 0, b: number;
      do {
        b = bin.charCodeAt(i++);
        run |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80 && i < bin.length);
      out.fill(v, p, Math.min(n, p + run));
      p += run;
    }
  } catch {
    /* corrupt mask: leave empty */
  }
  return out;
}

export function scaleMask(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}
