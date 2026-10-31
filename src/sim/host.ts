/**
 * Main-thread side of the simulation: owns the mirror of the grid used for
 * rendering, plus history (graph), heat map and timelapse snapshots.
 */
import type { MatchConfig, MatchResult, Rules } from '../engine/types.ts';
import type { FrameMsg, FromWorker, ReadyMsg, ToWorker } from './protocol.ts';
import { STAT_STRIDE } from './protocol.ts';
import { Runner } from './runner.ts';
import SimWorker from './worker.ts?worker&inline';

export interface Snapshot {
  tick: number;
  data: Uint8Array;
}

export class SimHost {
  W = 0;
  H = 0;
  N = 0;
  owner: Uint8Array = new Uint8Array(0);
  age: Uint16Array = new Uint16Array(0);
  mask: Uint8Array = new Uint8Array(0);
  spawns: number[] = [];
  rules!: Rules;
  playable = 1;
  tick = 0;
  tps = 0;
  result: MatchResult | null = null;
  nf = 0;
  stats: Float64Array = new Float64Array(0);
  /** Share history: one row per sample, one column per fighter. */
  history: Float32Array[] = [];
  historyEvery = 10;
  private nextHistory = 0;
  // Heat map (8x8 blocks).
  heatW = 1;
  heatH = 1;
  heat = new Float32Array(1);
  heatBytes = new Uint8Array(1);
  // Timelapse.
  snaps: Snapshot[] = [];
  snapW = 1;
  snapH = 1;
  private snapDiv = 1;
  private snapEvery = 6;
  private nextSnap = 0;
  dirty = true;
  ageDirty = true;
  usingWorker = false;
  private worker: Worker | null = null;
  private local: Runner | null = null;
  private readyResolve: ((r: ReadyMsg) => void) | null = null;
  onFrame: ((events: Float64Array, msg: FrameMsg) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor(preferWorker = true) {
    if (preferWorker) {
      try {
        this.worker = new SimWorker();
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
        this.worker.onerror = () => this.fallback();
        this.usingWorker = true;
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) this.makeLocal();
  }

  private makeLocal(): void {
    this.usingWorker = false;
    this.local = new Runner((m) => queueMicrotask(() => this.receive(m)));
    this.local.sliceMs = 7;
    this.local.start();
  }

  private lastInit: MatchConfig | null = null;
  private fallback(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.makeLocal();
    if (this.lastInit) this.send({ type: 'init', cfg: this.lastInit });
  }

  send(m: ToWorker, transfer: Transferable[] = []): void {
    if (this.worker) this.worker.postMessage(m, transfer);
    else this.local?.handle(m);
  }

  init(cfg: MatchConfig): Promise<ReadyMsg> {
    this.lastInit = cfg;
    this.result = null;
    const p = new Promise<ReadyMsg>((res) => (this.readyResolve = res));
    this.send({ type: 'init', cfg });
    if (this.worker) {
      // If the worker never answers (blocked environment), run locally.
      const w = this.worker;
      setTimeout(() => {
        if (this.readyResolve && this.worker === w) this.fallback();
      }, 4000);
    }
    return p;
  }

  setRunning(on: boolean): void {
    this.send({ type: 'run', running: on });
  }
  setSpeed(v: number): void {
    this.send({ type: 'speed', value: v });
  }
  step(n = 1): void {
    this.send({ type: 'step', n });
  }
  paint(cells: number[], value: number): void {
    const a = new Int32Array(cells);
    this.send({ type: 'paint', cells: a, value }, [a.buffer]);
  }
  spawn(fighter: number, idx: number): void {
    this.send({ type: 'spawn', fighter, idx });
  }

  owned(i: number): number {
    return this.stats[i * STAT_STRIDE] ?? 0;
  }
  alive(i: number): boolean {
    return (this.stats[i * STAT_STRIDE + 1] ?? 0) > 0;
  }
  centroid(i: number): [number, number] {
    return [this.stats[i * STAT_STRIDE + 2] ?? -1, this.stats[i * STAT_STRIDE + 3] ?? -1];
  }

  private receive(m: FromWorker): void {
    if (m.type === 'error') {
      this.onError?.(m.message);
      return;
    }
    if (m.type === 'ready') {
      this.W = m.W;
      this.H = m.H;
      this.N = m.W * m.H;
      this.owner = m.owner;
      this.mask = m.mask;
      this.age = new Uint16Array(this.N);
      this.spawns = m.spawns;
      this.rules = m.rules;
      this.playable = m.playable;
      this.tick = 0;
      this.nf = m.spawns.length;
      this.stats = new Float64Array(this.nf * STAT_STRIDE);
      this.history = [];
      this.historyEvery = 10;
      this.nextHistory = 0;
      this.heatW = Math.ceil(m.W / 8);
      this.heatH = Math.ceil(m.H / 8);
      this.heat = new Float32Array(this.heatW * this.heatH);
      this.heatBytes = new Uint8Array(this.heatW * this.heatH);
      this.snapDiv = Math.max(1, Math.ceil(Math.max(m.W, m.H) / 240));
      this.snapW = Math.ceil(m.W / this.snapDiv);
      this.snapH = Math.ceil(m.H / this.snapDiv);
      this.snaps = [];
      this.snapEvery = 6;
      this.nextSnap = 0;
      this.dirty = this.ageDirty = true;
      this.takeSnapshot();
      const r = this.readyResolve;
      this.readyResolve = null;
      r?.(m);
      return;
    }
    this.applyFrame(m);
    this.send({ type: 'ack' });
  }

  private applyFrame(m: FrameMsg): void {
    const t16 = m.tick & 0xffff;
    const W = this.W, hw = this.heatW;
    if (m.full) {
      const o = this.owner;
      for (let i = 0; i < o.length; i++) {
        if (o[i] !== m.full[i]) {
          this.age[i] = t16;
          const x = i % W, y = (i - x) / W;
          this.heat[(y >> 3) * hw + (x >> 3)] += 1;
        }
      }
      this.owner.set(m.full);
    } else {
      const ch = m.changes, o = this.owner, age = this.age, heat = this.heat;
      for (let k = 0; k < ch.length; k++) {
        const v = ch[k];
        const i = v >>> 8;
        o[i] = v & 255;
        age[i] = t16;
        const x = i % W, y = (i - x) / W;
        heat[(y >> 3) * hw + (x >> 3)] += 1;
      }
    }
    if (m.full || m.changes.length) this.dirty = this.ageDirty = true;
    this.tick = m.tick;
    this.tps = m.tps;
    this.stats = m.stats;
    this.playable = m.playable;
    this.result = m.result;
    if (this.tick >= this.nextHistory) {
      const row = new Float32Array(this.nf);
      for (let i = 0; i < this.nf; i++) row[i] = this.owned(i) / Math.max(1, this.playable);
      this.history.push(row);
      if (this.history.length > 600) {
        this.history = this.history.filter((_, i) => i % 2 === 0);
        this.historyEvery *= 2;
      }
      this.nextHistory = this.tick + this.historyEvery;
    }
    if (this.tick >= this.nextSnap || m.result) this.takeSnapshot();
    this.onFrame?.(m.events, m);
  }

  /** Decay heat and produce the byte texture (call once per render). */
  heatTexture(decay: number): Uint8Array {
    const h = this.heat, b = this.heatBytes;
    for (let i = 0; i < h.length; i++) {
      const v = h[i] * decay;
      h[i] = v;
      b[i] = Math.min(255, v * 4) | 0;
    }
    return b;
  }

  private takeSnapshot(): void {
    const d = this.snapDiv, sw = this.snapW, sh = this.snapH, W = this.W;
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      const sy = Math.min(this.H - 1, y * d + (d >> 1));
      for (let x = 0; x < sw; x++) out[y * sw + x] = this.owner[sy * W + Math.min(W - 1, x * d + (d >> 1))];
    }
    this.snaps.push({ tick: this.tick, data: out });
    if (this.snaps.length > 360) {
      this.snaps = this.snaps.filter((_, i) => i % 2 === 0 || i === this.snaps.length - 1);
      this.snapEvery *= 2;
    }
    this.nextSnap = this.tick + this.snapEvery;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.local?.stop();
    this.local = null;
    this.onFrame = null;
  }
}
