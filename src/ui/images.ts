/** Custom image handling: avatars, arenas from photos, backdrops. */
import { dominantColor } from '../visuals/palette.ts';

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => {
      res(img);
      if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    img.onerror = () => rej(new Error('Could not read that image'));
    img.src = url;
  });
}

function encode(c: HTMLCanvasElement, q = 0.85): string {
  const webp = c.toDataURL('image/webp', q);
  if (webp.startsWith('data:image/webp')) return webp;
  return c.toDataURL('image/jpeg', q);
}

/** Center-cropped square avatar (default 128 px). */
export async function avatarFromFile(file: Blob, size = 128): Promise<{ dataUrl: string; color: string }> {
  const img = await loadImage(file);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return { dataUrl: encode(c), color: dominantColor(c) };
}

/** Cover-fit an image into a W x H box (cropping the overflow). */
function coverDraw(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/** Small backdrop image matching the arena aspect ratio. */
export async function backdropFromFile(file: Blob, W: number, H: number): Promise<string> {
  const img = await loadImage(file);
  const s = Math.min(1, 384 / Math.max(W, H));
  const bw = Math.max(16, Math.round(W * s * 2)), bh = Math.max(16, Math.round(H * s * 2));
  const scale = Math.min(1, 512 / Math.max(bw, bh));
  return encode(coverDraw(img, Math.round(bw * scale), Math.round(bh * scale)), 0.8);
}

/**
 * Convert a photo into an arena mask at W x H.
 * 0 = floor, 1 = wall (dark / bright if inverted), 2 = hole (transparent).
 */
export async function maskFromImage(src: string, W: number, H: number, threshold: number, invert: boolean): Promise<Uint8Array> {
  const img = await loadImage(src);
  const c = coverDraw(img, W, H);
  const d = c.getContext('2d')!.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = d[i * 4 + 3];
    if (a < 100) {
      out[i] = 2;
      continue;
    }
    const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    const wall = invert ? lum > 1 - threshold : lum < threshold;
    out[i] = wall ? 1 : 0;
  }
  return out;
}
