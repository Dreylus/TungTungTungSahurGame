/** Overlay effects drawn on a 2D canvas above the board. */
import type { View } from './renderer.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  max: number;
  color: string;
  width: number;
}
interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
}
interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

export class Fx {
  parts: Particle[] = [];
  rings: Ring[] = [];
  texts: FloatText[] = [];
  flashes: Flash[] = [];
  shake = 0;

  spark(x: number, y: number, color: string, n = 6, speed = 18): void {
    for (let i = 0; i < n && this.parts.length < 700; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      this.parts.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.45, color, size: 1 + Math.random() * 1.8 });
    }
  }

  ring(x: number, y: number, color: string, speed: number, life = 0.9, width = 3): void {
    if (this.rings.length > 60) this.rings.shift();
    this.rings.push({ x: x + 0.5, y: y + 0.5, r: 1, vr: speed, life: 0, max: life, color, width });
  }

  flash(x: number, y: number, r: number, color: string, life = 0.35): void {
    if (this.flashes.length > 30) this.flashes.shift();
    this.flashes.push({ x: x + 0.5, y: y + 0.5, r, life: 0, max: life, color });
  }

  text(x: number, y: number, text: string, color: string): void {
    if (this.texts.length > 12) this.texts.shift();
    this.texts.push({ x, y, text, life: 0, max: 1.6, color });
  }

  clear(): void {
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.flashes = [];
    this.shake = 0;
  }

  update(dt: number): void {
    const step = <T extends { life: number; max: number }>(arr: T[]) => {
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.life += dt;
        if (p.life < p.max) arr[w++] = p;
      }
      arr.length = w;
    };
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    for (const r of this.rings) r.r += r.vr * dt;
    for (const t of this.texts) t.y -= dt * 6;
    step(this.parts);
    step(this.rings);
    step(this.texts);
    step(this.flashes);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  draw(g: CanvasRenderingContext2D, view: View, dpr: number): void {
    const sx = (x: number) => view.offX + x * view.scale;
    const sy = (y: number) => view.offY + y * view.scale;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const t = f.life / f.max;
      const r = Math.max(4 * dpr, f.r * view.scale * (0.6 + t * 0.8));
      const grd = g.createRadialGradient(sx(f.x), sy(f.y), 0, sx(f.x), sy(f.y), r);
      grd.addColorStop(0, f.color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = (1 - t) * 0.85;
      g.fillStyle = grd;
      g.fillRect(sx(f.x) - r, sy(f.y) - r, r * 2, r * 2);
    }
    for (const r of this.rings) {
      const t = r.life / r.max;
      g.globalAlpha = (1 - t) * 0.9;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * dpr * (1 - t * 0.6);
      g.beginPath();
      g.arc(sx(r.x), sy(r.y), Math.max(1, r.r * view.scale), 0, Math.PI * 2);
      g.stroke();
    }
    for (const p of this.parts) {
      const t = p.life / p.max;
      g.globalAlpha = 1 - t;
      g.fillStyle = p.color;
      const s = Math.max(1.5 * dpr, p.size * Math.min(view.scale, 4 * dpr) * (1 - t * 0.5));
      g.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
    }
    g.globalCompositeOperation = 'source-over';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      g.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      g.font = `900 ${Math.round(18 * dpr * (1 + (k < 0.15 ? (0.15 - k) * 3 : 0)))}px system-ui, sans-serif`;
      g.lineWidth = 4 * dpr;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(t.text, sx(t.x), sy(t.y));
      g.fillStyle = t.color;
      g.fillText(t.text, sx(t.x), sy(t.y));
    }
    g.restore();
  }
}

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  fit = 1;
  W = 1;
  H = 1;
  cw = 1;
  ch = 1;
  /** Extra space reserved for HUD (device px). */
  padTop = 0;
  padBottom = 0;
  target: { cx: number; cy: number; zoom: number } | null = null;

  setGrid(W: number, H: number): void {
    this.W = W;
    this.H = H;
  }

  resize(cw: number, ch: number, padTop: number, padBottom: number): void {
    this.cw = cw;
    this.ch = ch;
    this.padTop = padTop;
    this.padBottom = padBottom;
    const availH = Math.max(50, ch - padTop - padBottom);
    this.fit = Math.min((cw * 0.97) / this.W, (availH * 0.98) / this.H);
  }

  reset(): void {
    this.zoom = this.fit;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.target = null;
  }

  view(shakeX = 0, shakeY = 0): View {
    const midY = this.padTop + (this.ch - this.padTop - this.padBottom) / 2;
    return { offX: this.cw / 2 - this.cx * this.zoom + shakeX, offY: midY - this.cy * this.zoom + shakeY, scale: this.zoom };
  }

  toGrid(px: number, py: number): [number, number] {
    const v = this.view();
    return [(px - v.offX) / v.scale, (py - v.offY) / v.scale];
  }

  /** Zoom by factor k keeping the grid point under (px, py) fixed. */
  zoomAt(px: number, py: number, k: number): void {
    const [gx, gy] = this.toGrid(px, py);
    this.zoom = Math.max(this.fit * 0.6, Math.min(Math.max(this.fit * 24, 48), this.zoom * k));
    const v = this.view();
    const nx = (px - v.offX) / v.scale, ny = (py - v.offY) / v.scale;
    this.cx += gx - nx;
    this.cy += gy - ny;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.clamp();
  }

  clamp(): void {
    const mx = this.W * 0.5, my = this.H * 0.5;
    this.cx = Math.max(-mx * 0.2, Math.min(this.W + mx * 0.2, this.cx));
    this.cy = Math.max(-my * 0.2, Math.min(this.H + my * 0.2, this.cy));
  }

  /** Ease toward target (cinematic camera / capture punch-in). */
  update(dt: number): void {
    if (!this.target) return;
    const k = 1 - Math.exp(-dt * 2.2);
    this.cx += (this.target.cx - this.cx) * k;
    this.cy += (this.target.cy - this.cy) * k;
    this.zoom += (this.target.zoom - this.zoom) * k;
  }
}
