import type { PaletteMode } from '../saves/store.ts';

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** Okabe–Ito (colour-blind safe) then a second ring that relies on patterns. */
const COLORBLIND = [
  '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#ffffff',
  '#a36b00', '#2a7aa8', '#00664b', '#b5ab1f', '#004c78', '#913f00', '#8f4c74', '#9a9a9a',
];
const CONTRAST = [
  '#ffffff', '#ffde00', '#00e5ff', '#ff3b30', '#34c759', '#ff9500', '#bf5af2', '#ff2d95',
  '#7dd3fc', '#bef264', '#fda4af', '#fcd34d', '#c4b5fd', '#5eead4', '#f0abfc', '#a3a3a3',
];

/** Display colour of a fighter slot under the chosen accessibility palette. */
export function slotColor(color: string, slot: number, mode: PaletteMode): string {
  if (mode === 'colorblind') return COLORBLIND[slot % COLORBLIND.length];
  if (mode === 'contrast') return CONTRAST[slot % CONTRAST.length];
  return color;
}

/** Most saturated / common colour of an image (for "use image colour"). */
export function dominantColor(img: CanvasImageSource): string {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number; sat: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const key = ((r >> 5) << 6) | ((gg >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    e.n++;
    e.r += r;
    e.g += gg;
    e.b += b;
    e.sat += sat;
    buckets.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number; sat: number } | null = null;
  let bestScore = -1;
  for (const e of buckets.values()) {
    const score = e.n * (0.35 + e.sat / e.n);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (!best) return '#ffffff';
  let r = best.r / best.n, g2 = best.g / best.n, b = best.b / best.n;
  // Lift very dark colours so they read on the dark board.
  const l = 0.299 * r + 0.587 * g2 + 0.114 * b;
  if (l < 90) {
    const k = 90 / Math.max(1, l);
    r *= k;
    g2 *= k;
    b *= k;
  }
  return rgbToHex(r, g2, b);
}
