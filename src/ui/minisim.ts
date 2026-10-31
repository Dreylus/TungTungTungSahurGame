/** Small main-thread simulations for the menu, fighter gallery and builder. */
import { createSim } from '../engine/setup.ts';
import type { Sim } from '../engine/sim.ts';
import { EMPTY, VOID, WALL, type MatchConfig } from '../engine/types.ts';
import { hexToRgb } from '../visuals/palette.ts';
import { createRenderer, type BoardRenderer } from '../visuals/renderer.ts';
import { settings } from '../saves/store.ts';

const u32 = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return (255 << 24) | (b << 16) | (g << 8) | r;
};

/** Pixel-exact 2D mini sim drawn at grid resolution (CSS scales it up). */
export class MiniSim {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private sim: Sim | null = null;
  private img: ImageData | null = null;
  private px: Uint32Array | null = null;
  private lut = new Uint32Array(256);
  private make: () => MatchConfig;
  private holdUntil = 0;
  ticksPerFrame: number;
  visible = true;

  constructor(canvas: HTMLCanvasElement, make: () => MatchConfig, ticksPerFrame = 1) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.make = make;
    this.ticksPerFrame = ticksPerFrame;
    this.restart();
  }

  restart(): void {
    const cfg = this.make();
    const b = createSim(cfg);
    this.sim = b.sim;
    this.canvas.width = b.W;
    this.canvas.height = b.H;
    this.img = this.g.createImageData(b.W, b.H);
    this.px = new Uint32Array(this.img.data.buffer);
    this.lut.fill(u32('#04050a'));
    this.lut[EMPTY] = u32('#0e1120');
    this.lut[WALL] = u32('#2b2f3d');
    this.lut[VOID] = u32('#04050a');
    cfg.fighters.forEach((f, i) => (this.lut[i + 1] = u32(f.color)));
    const o = b.sim.owner;
    for (let i = 0; i < o.length; i++) this.px[i] = this.lut[o[i]];
    b.sim.drainChanges();
    this.g.putImageData(this.img, 0, 0);
    this.holdUntil = 0;
  }

  frame(now: number): void {
    const s = this.sim;
    if (!s || !this.visible) return;
    if (s.result) {
      if (!this.holdUntil) this.holdUntil = now + 1500;
      else if (now > this.holdUntil) this.restart();
      return;
    }
    for (let k = 0; k < this.ticksPerFrame && !s.result; k++) s.step();
    const ch = s.drainChanges();
    const px = this.px!, lut = this.lut;
    for (let k = 0; k < ch.length; k++) px[ch[k] >>> 8] = lut[ch[k] & 255];
    if (ch.length) this.g.putImageData(this.img!, 0, 0);
  }
}

const active = new Set<{ frame(now: number): void }>();
let raf = 0;
function loop(now: number): void {
  raf = active.size ? requestAnimationFrame(loop) : 0;
  for (const m of active) m.frame(now);
}
export function animate(m: { frame(now: number): void }): () => void {
  active.add(m);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => active.delete(m);
}

/** Full-screen glowing background battle for the main menu (WebGL when available). */
export class MenuBattle {
  canvas: HTMLCanvasElement;
  private r: BoardRenderer;
  private sim: Sim | null = null;
  private age = new Uint16Array(0);
  private make: (W: number, H: number) => MatchConfig;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private holdUntil = 0;
  private acc = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, make: (W: number, H: number) => MatchConfig) {
    this.canvas = canvas;
    this.make = make;
    this.r = createRenderer(canvas);
  }

  restart(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cw = Math.max(80, rect.width), ch = Math.max(120, rect.height);
    const cell = 5;
    const W = Math.round(cw / cell), H = Math.round(ch / cell);
    const cfg = this.make(W, H);
    const b = createSim(cfg);
    this.sim = b.sim;
    this.W = b.W;
    this.H = b.H;
    this.age = new Uint16Array(b.W * b.H);
    this.r.setGrid(b.W, b.H);
    this.r.setPalette(cfg.fighters.map((f) => f.color));
    this.r.uploadOwner(b.sim.owner);
    b.sim.drainChanges();
    this.holdUntil = 0;
  }

  frame(now: number): void {
    if (!this.sim) this.restart();
    const s = this.sim!;
    const dt = Math.min(100, now - (this.last || now));
    this.last = now;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * this.dpr), hh = Math.round(rect.height * this.dpr);
    this.r.resize(w, hh, this.dpr);
    if (s.result) {
      if (!this.holdUntil) this.holdUntil = now + 2500;
      else if (now > this.holdUntil) this.restart();
    } else {
      this.acc += dt / 1000 * 40;
      let n = 0;
      while (this.acc >= 1 && n++ < 3) {
        s.step();
        this.acc -= 1;
      }
      const ch = s.drainChanges();
      const t16 = s.tick & 0xffff;
      for (let k = 0; k < ch.length; k++) this.age[ch[k] >>> 8] = t16;
      if (ch.length) {
        this.r.uploadOwner(s.owner);
        this.r.uploadAge(this.age);
      }
    }
    const scale = Math.max(w / this.W, hh / this.H);
    this.r.render(
      { offX: (w - this.W * scale) / 2, offY: (hh - this.H * scale) / 2, scale },
      {
        time: now / 1000, tick: s.tick, style: settings.style === 'ink' || settings.style === 'watercolor' ? 'none' : settings.style,
        masterpiece: true, trails: true, heat: false, pulse: !settings.reducedMotion, patterns: false, ageGradient: true,
        backdrop: false, wrap: false, bloom: 0.9, slow: 0, flash: 0,
      },
    );
  }

  dispose(): void {
    this.r.dispose();
  }
}
