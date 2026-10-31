import { EMPTY, VOID, WALL } from '../engine/types.ts';
import { hexToRgb } from './palette.ts';

/** Render an arena mask (and optional spawn dots) into a small canvas. */
export function maskCanvas(
  mask: Uint8Array,
  W: number,
  H: number,
  max = 128,
  spawns: number[] = [],
  colors: string[] = [],
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(W, H));
  const cw = Math.max(1, Math.round(W * s)), ch = Math.max(1, Math.round(H * s));
  const c = canvas ?? document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  const img = g.createImageData(cw, ch);
  const px = new Uint32Array(img.data.buffer);
  const col = (o: number): number => {
    if (o === EMPTY) return 0xff2a1e18;
    if (o === WALL) return 0xff5a4f4a;
    if (o === VOID) return 0xff0a0604;
    const [r, gg, b] = hexToRgb(colors[o - 1] ?? '#ffffff');
    return (255 << 24) | (b << 16) | (gg << 8) | r;
  };
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(H - 1, Math.floor((y + 0.5) / s));
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(W - 1, Math.floor((x + 0.5) / s));
      px[y * cw + x] = col(mask[sy * W + sx]);
    }
  }
  g.putImageData(img, 0, 0);
  spawns.forEach((sp, i) => {
    if (sp < 0) return;
    const x = (sp % W) * s, y = Math.floor(sp / W) * s;
    const r = Math.max(2, cw / 28);
    g.fillStyle = colors[i] ?? '#fff';
    g.shadowColor = colors[i] ?? '#fff';
    g.shadowBlur = r * 2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#000';
    g.lineWidth = Math.max(1, r / 3);
    g.stroke();
  });
  return c;
}

/** Render a full owner grid (match result) to a small canvas. */
export function ownerCanvas(owner: Uint8Array, W: number, H: number, colors: string[], max = 160): HTMLCanvasElement {
  return maskCanvas(owner, W, H, max, [], colors);
}
