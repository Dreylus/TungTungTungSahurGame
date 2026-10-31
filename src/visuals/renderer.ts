/** Board renderer: WebGL2 with a post-processing chain, Canvas2D fallback. */
import { EMPTY, VOID, WALL } from '../engine/types.ts';
import type { ShaderStyle } from '../saves/store.ts';
import { hexToRgb } from './palette.ts';
import { BLUR, BRIGHT, COMPOSITE, SCENE, VERT } from './shaders.ts';

export interface View {
  /** Screen position (device px) of the grid's top-left corner. */
  offX: number;
  offY: number;
  /** Device px per cell. */
  scale: number;
}

export interface RenderOpts {
  time: number;
  tick: number;
  style: ShaderStyle;
  masterpiece: boolean;
  trails: boolean;
  heat: boolean;
  pulse: boolean;
  patterns: boolean;
  ageGradient: boolean;
  backdrop: boolean;
  wrap: boolean;
  bloom: number;
  slow: number;
  flash: number;
}

const STYLE_ID: Record<ShaderStyle, number> = { none: 0, crt: 1, neon: 2, watercolor: 3, ink: 4 };

export interface BoardRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  setGrid(W: number, H: number): void;
  uploadOwner(owner: Uint8Array): void;
  uploadAge(age: Uint16Array): void;
  uploadHeat(data: Uint8Array, bw: number, bh: number): void;
  setPalette(colors: string[]): void;
  setBackdrop(img: HTMLImageElement | HTMLCanvasElement | null): void;
  resize(w: number, h: number, dpr: number): void;
  render(view: View, o: RenderOpts): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): BoardRenderer {
  try {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (gl) return new GLRenderer(canvas, gl);
  } catch {
    /* fall back */
  }
  return new Canvas2DRenderer(canvas);
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

class GLRenderer implements BoardRenderer {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private scene: WebGLProgram;
  private bright: WebGLProgram;
  private blur: WebGLProgram;
  private comp: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texOwner: WebGLTexture;
  private texAge: WebGLTexture;
  private texPal: WebGLTexture;
  private texHeat: WebGLTexture;
  private texBack: WebGLTexture;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private hasBack = false;
  private targets: { scene?: Target; a?: Target; b?: Target } = {};
  private uni = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private lost = false;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.scene = this.program(VERT, SCENE);
    this.bright = this.program(VERT, BRIGHT);
    this.blur = this.program(VERT, BLUR);
    this.comp = this.program(VERT, COMPOSITE);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.scene, this.bright, this.blur, this.comp]) {
      const loc = gl.getAttribLocation(p, 'aPos');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    this.vao = vao;
    this.texOwner = this.tex(gl.NEAREST);
    this.texAge = this.tex(gl.NEAREST);
    this.texPal = this.tex(gl.NEAREST);
    this.texHeat = this.tex(gl.LINEAR);
    this.texBack = this.tex(gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texHeat);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    gl.bindTexture(gl.TEXTURE_2D, this.texBack);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.setPalette([]);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uni.get(p);
    if (!m) this.uni.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private tex(filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setGrid(W: number, H: number): void {
    const gl = this.gl;
    this.W = W;
    this.H = H;
    gl.bindTexture(gl.TEXTURE_2D, this.texOwner);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, W, H, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(W * H));
    gl.bindTexture(gl.TEXTURE_2D, this.texAge);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, W, H, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(W * H));
  }

  uploadOwner(owner: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texOwner);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, owner);
  }

  uploadAge(age: Uint16Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texAge);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RED_INTEGER, gl.UNSIGNED_SHORT, age);
  }

  uploadHeat(data: Uint8Array, bw: number, bh: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texHeat);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bw, bh, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  setPalette(colors: string[]): void {
    const gl = this.gl;
    const d = new Uint8Array(256 * 4);
    for (let i = 1; i <= 16; i++) {
      const [r, g, b] = hexToRgb(colors[i - 1] ?? '#ffffff');
      d.set([r, g, b, 255], i * 4);
    }
    d.set([13, 15, 24, 255], EMPTY * 4);
    d.set([38, 41, 51, 255], WALL * 4);
    d.set([4, 5, 9, 255], VOID * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.texPal);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  }

  setBackdrop(img: HTMLImageElement | HTMLCanvasElement | null): void {
    const gl = this.gl;
    this.hasBack = !!img;
    if (!img) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texBack);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.freeTargets();
    }
  }

  private freeTargets(): void {
    const gl = this.gl;
    for (const t of Object.values(this.targets)) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.targets = {};
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  private bindTex(unit: number, t: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }

  render(view: View, o: RenderOpts): void {
    if (this.lost) return;
    const gl = this.gl;
    const cw = this.canvas.width, ch = this.canvas.height;
    const post = o.masterpiece || o.style === 'crt';
    if (post && !this.targets.scene) {
      this.targets.scene = this.target(cw, ch);
      const bw = Math.max(1, cw >> 2), bh = Math.max(1, ch >> 2);
      this.targets.a = this.target(bw, bh);
      this.targets.b = this.target(bw, bh);
    }
    gl.bindVertexArray(this.vao);
    // --- scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? this.targets.scene!.fb : null);
    gl.viewport(0, 0, cw, ch);
    const p = this.scene;
    gl.useProgram(p);
    this.bindTex(0, this.texOwner);
    this.bindTex(1, this.texAge);
    this.bindTex(2, this.texPal);
    this.bindTex(3, this.texHeat);
    this.bindTex(4, this.texBack);
    gl.uniform1i(this.u(p, 'uOwner'), 0);
    gl.uniform1i(this.u(p, 'uAge'), 1);
    gl.uniform1i(this.u(p, 'uPal'), 2);
    gl.uniform1i(this.u(p, 'uHeat'), 3);
    gl.uniform1i(this.u(p, 'uBack'), 4);
    gl.uniform2f(this.u(p, 'uGrid'), this.W, this.H);
    gl.uniform2f(this.u(p, 'uRes'), cw, ch);
    gl.uniform2f(this.u(p, 'uOff'), view.offX, view.offY);
    gl.uniform1f(this.u(p, 'uScale'), view.scale);
    gl.uniform1f(this.u(p, 'uTime'), o.time);
    gl.uniform1f(this.u(p, 'uTick'), o.tick & 0xffff);
    gl.uniform1f(this.u(p, 'uDpr'), this.dpr);
    gl.uniform1i(this.u(p, 'uStyle'), STYLE_ID[o.style]);
    let flags = 0;
    if (o.masterpiece) {
      flags |= 1;
      if (o.trails) flags |= 2;
      if (o.pulse) flags |= 8;
      if (o.ageGradient) flags |= 64;
    }
    if (o.heat) flags |= 4;
    if (o.patterns) flags |= 16;
    if (o.backdrop && this.hasBack) flags |= 32;
    if (o.wrap) flags |= 128;
    gl.uniform1i(this.u(p, 'uFlags'), flags);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!post) return;
    const { scene, a, b } = this.targets as Required<typeof this.targets>;
    // --- bloom: bright pass (downsample) + 2x separable blur
    gl.viewport(0, 0, a.w, a.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
    gl.useProgram(this.bright);
    this.bindTex(0, scene.tex);
    gl.uniform1i(this.u(this.bright, 'uSrc'), 0);
    gl.uniform2f(this.u(this.bright, 'uTexel'), 1.5 / cw, 1.5 / ch);
    gl.uniform1f(this.u(this.bright, 'uThreshold'), o.style === 'neon' ? 0.05 : 0.2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blur);
    gl.uniform1i(this.u(this.blur, 'uSrc'), 0);
    for (let k = 0; k < 2; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      this.bindTex(0, a.tex);
      gl.uniform2f(this.u(this.blur, 'uDir'), (1 + k) / a.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
      this.bindTex(0, b.tex);
      gl.uniform2f(this.u(this.blur, 'uDir'), 0, (1 + k) / a.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // --- composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    const c = this.comp;
    gl.useProgram(c);
    this.bindTex(0, scene.tex);
    this.bindTex(1, a.tex);
    gl.uniform1i(this.u(c, 'uScene'), 0);
    gl.uniform1i(this.u(c, 'uBloom'), 1);
    const bloom = o.masterpiece ? o.bloom * (o.style === 'neon' ? 2.2 : o.style === 'ink' || o.style === 'watercolor' ? 0.25 : 1.3) : 0;
    gl.uniform1f(this.u(c, 'uBloomAmt'), bloom);
    gl.uniform1i(this.u(c, 'uStyle'), STYLE_ID[o.style]);
    gl.uniform1f(this.u(c, 'uTime'), o.time);
    gl.uniform2f(this.u(c, 'uRes'), cw, ch);
    gl.uniform1f(this.u(c, 'uSlow'), o.slow);
    gl.uniform1f(this.u(c, 'uVig'), o.masterpiece ? 0.9 : 0.4);
    gl.uniform1f(this.u(c, 'uFlash'), o.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.freeTargets();
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

/** Simple fallback for devices without WebGL2. */
class Canvas2DRenderer implements BoardRenderer {
  readonly kind = 'canvas2d' as const;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement('canvas');
  private octx = this.off.getContext('2d')!;
  private img: ImageData | null = null;
  private pal = new Uint32Array(256);
  private W = 1;
  private H = 1;
  private owner: Uint8Array | null = null;
  private dirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.setPalette([]);
  }
  setGrid(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.off.width = W;
    this.off.height = H;
    this.img = this.octx.createImageData(W, H);
  }
  uploadOwner(owner: Uint8Array): void {
    this.owner = owner;
    this.dirty = true;
  }
  uploadAge(): void {}
  uploadHeat(): void {}
  setPalette(colors: string[]): void {
    const set = (i: number, hex: string) => {
      const [r, g, b] = hexToRgb(hex);
      this.pal[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    };
    for (let i = 0; i < 256; i++) set(i, '#04050a');
    set(EMPTY, '#0d0f18');
    set(WALL, '#262933');
    for (let i = 1; i <= 16; i++) set(i, colors[i - 1] ?? '#ffffff');
    this.dirty = true;
  }
  setBackdrop(): void {}
  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
  render(view: View): void {
    const ctx = this.ctx;
    if (this.dirty && this.owner && this.img) {
      const px = new Uint32Array(this.img.data.buffer);
      const o = this.owner;
      for (let i = 0; i < o.length; i++) px[i] = this.pal[o[i]];
      this.octx.putImageData(this.img, 0, 0);
      this.dirty = false;
    }
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, view.offX, view.offY, this.W * view.scale, this.H * view.scale);
  }
  dispose(): void {}
}
