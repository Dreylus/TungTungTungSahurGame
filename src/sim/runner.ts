/** Simulation runner shared by the Web Worker and the main-thread fallback. */
import { createSim } from '../engine/setup.ts';
import type { Sim } from '../engine/sim.ts';
import { TPS, WALL } from '../engine/types.ts';
import { STAT_STRIDE, type FrameMsg, type FromWorker, type ToWorker } from './protocol.ts';

export class Runner {
  sim: Sim | null = null;
  private running = false;
  private speed = 1;
  private acc = 0;
  private last = 0;
  private awaitingAck = false;
  private forceFull = false;
  private stepRequests = 0;
  private dirty = false;
  private tpsTicks = 0;
  private tpsT0 = 0;
  private tps = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private post: (m: FromWorker, transfer?: Transferable[]) => void;
  /** Hard cap on work per slice so messages stay responsive. */
  sliceMs = 12;

  constructor(post: (m: FromWorker, transfer?: Transferable[]) => void) {
    this.post = post;
  }

  handle(m: ToWorker): void {
    switch (m.type) {
      case 'init': {
        try {
          const b = createSim(m.cfg);
          this.sim = b.sim;
          this.acc = 0;
          this.awaitingAck = false;
          this.forceFull = false;
          this.sim.drainChanges();
          this.sim.events = [];
          const owner = new Uint8Array(b.sim.owner);
          const mask = new Uint8Array(b.mask);
          this.post(
            { type: 'ready', W: b.W, H: b.H, mask, owner, spawns: b.spawns, rules: b.rules, playable: b.sim.playable },
            [mask.buffer, owner.buffer],
          );
          this.dirty = true;
        } catch (e) {
          this.post({ type: 'error', message: String((e as Error)?.message ?? e) });
        }
        break;
      }
      case 'run':
        this.running = m.running;
        this.last = performance.now();
        break;
      case 'speed':
        this.speed = Math.max(0.05, Math.min(20, m.value));
        break;
      case 'step':
        this.stepRequests += m.n;
        break;
      case 'paint': {
        const s = this.sim;
        if (!s) break;
        let arena = false;
        for (let k = 0; k < m.cells.length; k++) {
          const i = m.cells[k];
          if (i < 0 || i >= s.N) continue;
          const prev = s.owner[i];
          if (prev === m.value) continue;
          if (prev >= WALL || m.value >= WALL) arena = true;
          s.setCell(i, m.value);
        }
        if (arena) s.refreshArena();
        this.dirty = true;
        break;
      }
      case 'spawn': {
        const s = this.sim;
        if (!s) break;
        const f = s.fighters[m.fighter - 1];
        if (f && m.idx >= 0 && m.idx < s.N && s.owner[m.idx] < WALL) {
          if (s.owner[m.idx] !== f.id) s.setCell(m.idx, f.id);
          f.seed(m.idx);
          if (!f.alive) f.alive = true;
          s.pushEvent(6, m.idx, f.id, 0);
        }
        this.dirty = true;
        break;
      }
      case 'ack':
        this.awaitingAck = false;
        break;
    }
  }

  start(): void {
    const loop = () => {
      this.timer = setTimeout(loop, this.running ? 2 : 16);
      this.tick();
    };
    loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const s = this.sim;
    if (!s) return;
    const now = performance.now();
    const t0 = now;
    if (this.running && !s.result) {
      const dt = Math.min(250, now - this.last);
      this.last = now;
      this.acc += (dt / 1000) * TPS * this.speed;
      const maxDebt = Math.max(2, TPS * this.speed * 0.25);
      while (this.acc >= 1 && !s.result) {
        s.step();
        this.acc -= 1;
        this.tpsTicks++;
        this.dirty = true;
        if (performance.now() - t0 > this.sliceMs) break;
      }
      if (this.acc > maxDebt) this.acc = maxDebt;
    } else this.last = now;
    while (this.stepRequests > 0 && !s.result) {
      s.step();
      this.stepRequests--;
      this.dirty = true;
    }
    this.stepRequests = 0;
    if (now - this.tpsT0 > 500) {
      this.tps = (this.tpsTicks * 1000) / (now - this.tpsT0);
      this.tpsT0 = now;
      this.tpsTicks = 0;
    }
    if (this.dirty && !this.awaitingAck) this.flush();
  }

  private flush(): void {
    const s = this.sim!;
    const nf = s.fighters.length;
    const stats = new Float64Array(nf * STAT_STRIDE);
    s.fighters.forEach((f, i) => {
      stats[i * STAT_STRIDE] = f.owned;
      stats[i * STAT_STRIDE + 1] = f.alive ? 1 : 0;
      const [cx, cy] = f.centroid();
      stats[i * STAT_STRIDE + 2] = cx;
      stats[i * STAT_STRIDE + 3] = cy;
    });
    const events = new Float64Array(s.events);
    s.events = [];
    let msg: FrameMsg;
    const transfer: Transferable[] = [stats.buffer, events.buffer];
    if (this.forceFull || s.pendingChanges > s.N / 3) {
      s.drainChanges();
      const full = new Uint8Array(s.owner);
      msg = { type: 'frame', tick: s.tick, changes: new Uint32Array(0), full, stats, events, result: s.result, playable: s.playable, tps: this.tps };
      transfer.push(full.buffer);
      this.forceFull = false;
    } else {
      const changes = s.drainChanges();
      msg = { type: 'frame', tick: s.tick, changes, stats, events, result: s.result, playable: s.playable, tps: this.tps };
      transfer.push(changes.buffer);
    }
    this.awaitingAck = true;
    this.dirty = false;
    this.post(msg, transfer);
  }
}
