/** The battle screen: board, HUD, controls, tools, effects, end card. */
import { algoName } from '../algorithms/registry.ts';
import { audio } from '../audio/audio.ts';
import { PRESET_BY_ID } from '../engine/setup.ts';
import { randomSeed } from '../engine/rng.ts';
import {
  EMPTY,
  EV_ATTACK,
  EV_BOLT,
  EV_CAPTURE,
  EV_EBB,
  EV_ELIM,
  EV_METEOR,
  EV_PULSE,
  EV_SPAWN,
  TPS,
  VOID,
  WALL,
  type MatchConfig,
} from '../engine/types.ts';
import { keepAwake, saveFile, setImmersive, shareFile } from '../native/bridge.ts';
import { haptic } from '../native/haptics.ts';
import { saveSettings, setLastConfig, settings } from '../saves/store.ts';
import { SimHost } from '../sim/host.ts';
import { Camera, Fx } from '../visuals/fx.ts';
import { encodeGif } from '../visuals/gif.ts';
import { hexToRgb, slotColor } from '../visuals/palette.ts';
import { createRenderer, type BoardRenderer } from '../visuals/renderer.ts';
import { ownerCanvas } from '../visuals/thumbs.ts';
import { avatarStyle, button, chips, clear, confirmDialog, fmtTime, h, sheet, slider, tap, toast, toggleRow } from './dom.ts';
import { nav } from './nav.ts';
import { current, pop, popToRoot, push, type Screen } from './router.ts';
import { saveToSlotDialog } from './saves.ts';
import { pixelText } from './title.ts';

type Tool = 'pan' | 'spawn' | 'wall' | 'hole' | 'erase';

const REASON: Record<string, string> = {
  full: 'The arena is full',
  settled: 'The dust has settled',
  timer: "Time's up",
  last: 'Last one standing',
  domination: 'Total domination',
};

const speedFromPos = (p: number) => 0.25 * Math.pow(40, p);
const posFromSpeed = (s: number) => Math.log(s / 0.25) / Math.log(40);

export function openMatch(cfg: MatchConfig): void {
  push(new MatchScreen(cfg));
}

class MatchScreen implements Screen {
  el: HTMLElement;
  private cfg: MatchConfig;
  private host = new SimHost(true);
  private renderer: BoardRenderer;
  private fx = new Fx();
  private cam = new Camera();
  private board: HTMLCanvasElement;
  private fxc: HTMLCanvasElement;
  private fxg: CanvasRenderingContext2D;
  private dpr = 1;
  private running = false;
  private started = false;
  private ended = false;
  private speed: number;
  private slowUntil = 0;
  private slowAmt = 0;
  private flash = 0;
  private colors: string[] = [];
  private avatars: (HTMLImageElement | null)[] = [];
  private badge: { x: number; y: number }[] = [];
  private lastOwned: number[] = [];
  private raf = 0;
  private lastT = 0;
  private lastHud = 0;
  private fpsN = 0;
  private fpsT = 0;
  private fpsVal = 0;
  private tool: Tool = 'pan';
  private toolSlot = 0;
  private brush = 3;
  private cinematic = false;
  private nextCine = 0;
  private punchUntil = 0;
  private gen = 0;
  // HUD elements
  private shareBar = h('div', { class: 'sharebar' });
  private clock = h('div', { class: 'clock' }, '0:00');
  private modeTag = h('div', { class: 'mode-tag' });
  private score = h('div', { class: 'score collapsed' });
  private playBtn!: HTMLButtonElement;
  private speedLabel = h('span', null, '1.0×');
  private speedInput!: HTMLInputElement;
  private toolsBar = h('div', { class: 'tools hidden' });
  private graph = h('canvas', { class: 'graph hidden' }) as HTMLCanvasElement;
  private fpsEl = h('div', { class: 'fps hidden' });
  private toolBtn!: HTMLButtonElement;
  private graphBtn!: HTMLButtonElement;
  private cineBtn!: HTMLButtonElement;
  private endEl: HTMLElement | null = null;
  private ro: ResizeObserver;
  private pending = new Set<number>();
  private paintTimer = 0;

  constructor(cfg: MatchConfig) {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.speed = cfg.rules.speed || 1;
    this.board = h('canvas', { class: 'board' }) as HTMLCanvasElement;
    this.fxc = h('canvas', { class: 'fx' }) as HTMLCanvasElement;
    this.fxg = this.fxc.getContext('2d')!;
    this.renderer = createRenderer(this.board);
    this.el = h('div', { class: 'screen match' }, this.board, this.fxc, this.buildTop(), this.score, this.buildBottom(), this.fpsEl);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.bindGestures();
    this.score.addEventListener('click', () => {
      tap();
      this.score.classList.toggle('collapsed');
    });
    this.host.onFrame = (ev) => this.onEvents(ev);
    this.host.onError = (m) => toast('Simulation error: ' + m, 4000);
    void this.start();
  }

  // -------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------

  private buildTop(): HTMLElement {
    const quit = button('✕', () => this.confirmQuit(), 'icon small');
    this.cineBtn = button('🎥', () => this.toggleCinematic(), 'icon small');
    const shot = button('📷', () => void this.screenshot(), 'icon small');
    const preset = PRESET_BY_ID[this.cfg.mode];
    this.modeTag.textContent = `${preset?.icon ?? ''} ${preset?.name ?? 'Sandbox'}`;
    return h('div', { class: 'hud-top' }, this.shareBar, h('div', { class: 'hud-row' }, quit, this.clock, this.modeTag, h('div', { class: 'grow' }), this.cineBtn, shot));
  }

  private buildBottom(): HTMLElement {
    this.playBtn = button('▶', () => this.togglePlay(), 'play');
    const restart = button('⟲', () => void this.start(false), '');
    const stepBtn = button('⏭', () => this.stepOnce(), '');
    this.speedInput = h('input', { type: 'range', min: '0', max: '1', step: '0.001' }) as HTMLInputElement;
    this.speedInput.value = String(posFromSpeed(this.speed));
    this.speedInput.style.setProperty('--p', `${posFromSpeed(this.speed) * 100}%`);
    let lastDet = -1;
    this.speedInput.addEventListener('input', () => {
      const p = Number(this.speedInput.value);
      let s = speedFromPos(p);
      // Snap to friendly values.
      for (const snap of [0.25, 0.5, 1, 2, 3, 5, 10]) if (Math.abs(posFromSpeed(snap) - p) < 0.025) s = snap;
      this.speed = Math.round(s * 100) / 100;
      this.speedInput.style.setProperty('--p', `${p * 100}%`);
      this.speedLabel.textContent = `${this.speed < 1 ? this.speed.toFixed(2) : this.speed.toFixed(1)}×`;
      const det = Math.round(p * 20);
      if (det !== lastDet) {
        lastDet = det;
        haptic('tick', 0.5);
      }
      this.applySpeed();
    });
    this.speedLabel.textContent = `${this.speed.toFixed(1)}×`;
    this.toolBtn = button('🛠', () => this.toggleTools(), '');
    this.graphBtn = button('📈', () => this.toggleGraph(), '');
    const more = button('⋯', () => this.moreSheet(), '');
    const dock = h('div', { class: 'dock' }, restart, this.playBtn, stepBtn, h('div', { class: 'speed' }, this.speedInput, this.speedLabel), this.toolBtn, this.graphBtn, more);
    return h('div', { class: 'hud-bottom' }, this.graph, this.toolsBar, dock);
  }

  private resize(): void {
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(rect.width * this.dpr), hh = Math.round(rect.height * this.dpr);
    this.renderer.resize(w, hh, this.dpr);
    if (this.fxc.width !== w || this.fxc.height !== hh) {
      this.fxc.width = w;
      this.fxc.height = hh;
    }
    const cs = getComputedStyle(document.documentElement);
    const sat = parseFloat(cs.getPropertyValue('--sat')) || 0;
    const sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
    const wasFit = Math.abs(this.cam.zoom - this.cam.fit) < 1e-6;
    this.cam.resize(w, hh, (sat + 64) * this.dpr, (sab + 76) * this.dpr);
    if (wasFit || !this.started) this.cam.reset();
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  onShow(): void {
    if (settings.keepAwake) keepAwake(true);
    setImmersive(true);
    audio.ensure();
    audio.setAmbientLevel(0.8);
    audio.startAmbient(0.8);
    window.__pwPause = () => {
      if (this.running) this.togglePlay();
      audio.suspend();
    };
    this.lastT = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  onHide(): void {
    cancelAnimationFrame(this.raf);
    keepAwake(false);
    setImmersive(false);
    window.__pwPause = undefined;
  }

  onDestroy(): void {
    this.ro.disconnect();
    this.host.dispose();
    this.renderer.dispose();
    audio.setAmbientLevel(0.45);
  }

  onBack(): boolean {
    if (!this.toolsBar.classList.contains('hidden')) {
      this.toggleTools();
      return true;
    }
    if (this.ended) return false;
    this.confirmQuit();
    return true;
  }

  private async confirmQuit(): Promise<void> {
    if (this.ended) {
      pop();
      return;
    }
    const was = this.running;
    if (was) this.togglePlay();
    if (await confirmDialog('Leave the battle?', 'The current match will be lost.', 'Leave', true)) pop();
    else if (was) this.togglePlay();
  }

  private async start(reroll = false): Promise<void> {
    const gen = ++this.gen;
    if (reroll) this.cfg.seed = randomSeed();
    setLastConfig(this.cfg);
    this.ended = false;
    this.started = false;
    this.endEl?.remove();
    this.endEl = null;
    this.fx.clear();
    this.setRunning(false);
    this.colors = this.cfg.fighters.map((f, i) => slotColor(f.color, i, settings.palette));
    this.avatars = this.cfg.fighters.map((f) => {
      if (!f.image) return null;
      const img = new Image();
      img.src = f.image;
      return img;
    });
    const ready = await this.host.init(this.cfg);
    if (gen !== this.gen) return;
    this.renderer.setGrid(ready.W, ready.H);
    this.renderer.setPalette(this.colors);
    this.host.dirty = this.host.ageDirty = true;
    if (this.cfg.arena.imageBackdrop && this.cfg.arena.shape === 'image') {
      const img = new Image();
      img.onload = () => this.renderer.setBackdrop(img);
      img.src = this.cfg.arena.imageBackdrop;
    } else this.renderer.setBackdrop(null);
    this.cam.setGrid(ready.W, ready.H);
    this.started = true;
    this.resize();
    this.cam.reset();
    this.lastOwned = new Array(this.cfg.fighters.length).fill(0);
    this.badge = this.cfg.fighters.map((_, i) => {
      const sp = ready.spawns[i];
      return { x: sp >= 0 ? sp % ready.W : -1, y: sp >= 0 ? Math.floor(sp / ready.W) : -1 };
    });
    ready.spawns.forEach((sp, i) => {
      if (sp >= 0) this.fx.ring(sp % ready.W, Math.floor(sp / ready.W), this.colors[i], Math.max(ready.W, ready.H) * 0.25, 1.2, 3);
    });
    this.updateHud(true);
    this.applySpeed();
    await this.countdown(gen);
    if (gen !== this.gen) return;
    this.setRunning(true);
    audio.jingleStart();
  }

  private async countdown(gen: number): Promise<void> {
    const show = (txt: string) => {
      const b = h('div', { class: 'banner' }, txt);
      this.el.appendChild(b);
      setTimeout(() => b.remove(), 720);
    };
    for (const n of [3, 2, 1]) {
      if (gen !== this.gen) return;
      show(String(n));
      haptic('countdown');
      audio.countdown(n);
      await new Promise((r) => setTimeout(r, 520));
    }
    if (gen !== this.gen) return;
    show('FIGHT!');
    haptic('go');
    audio.countdown(0);
  }

  private setRunning(on: boolean): void {
    this.running = on;
    this.host.setRunning(on);
    if (this.playBtn) this.playBtn.textContent = on ? '⏸' : '▶';
  }

  private togglePlay(): void {
    if (this.ended || !this.started) return;
    this.setRunning(!this.running);
    haptic(this.running ? 'resume' : 'pause');
    if (this.running && this.tool !== 'pan') this.setTool('pan');
  }

  private stepOnce(): void {
    if (this.ended || !this.started) return;
    if (this.running) this.setRunning(false);
    this.host.step(1);
    haptic('tick');
  }

  private applySpeed(): void {
    const slow = performance.now() < this.slowUntil ? 0.25 : 1;
    this.host.setSpeed(this.speed * slow);
  }

  // -------------------------------------------------------------------
  // Events → effects, audio, haptics
  // -------------------------------------------------------------------

  private onEvents(ev: Float64Array): void {
    const W = this.host.W;
    const rm = settings.reducedMotion;
    const parts = settings.particles && !rm;
    for (let k = 0; k + 3 < ev.length; k += 4) {
      const type = ev[k], idx = ev[k + 1], a = ev[k + 2], b = ev[k + 3];
      const x = idx % W, y = Math.floor(idx / W);
      const pan = W ? (x / W) * 2 - 1 : 0;
      switch (type) {
        case EV_ATTACK: {
          if (parts) this.fx.spark(x, y, this.colors[a - 1], 4, 10 + Math.random() * 10);
          audio.hit(this.algo(a), pan);
          haptic('clash', 0.35);
          break;
        }
        case EV_CAPTURE: {
          const col = this.colors[a - 1];
          const big = b >= Math.max(300, this.host.playable * 0.03);
          this.fx.ring(x, y, col, Math.sqrt(b) * 1.6, 1.1, big ? 6 : 3);
          this.fx.flash(x, y, Math.sqrt(b) * 0.9, col, 0.6);
          this.fx.text(x, y, `+${b}`, col);
          if (parts) this.fx.spark(x, y, col, big ? 40 : 14, 30);
          audio.capture(this.algo(a), b);
          haptic(big ? 'bigCapture' : 'capture', big ? 1 : 0.6);
          if (big) this.bigMoment(x, y, `${this.name(a)} encircled ${b.toLocaleString()} px!`, col);
          break;
        }
        case EV_ELIM: {
          const col = this.colors[a - 1];
          this.callout(`💀 ${this.name(a)} eliminated`, col);
          audio.elim();
          haptic('elim');
          if (!rm) this.fx.shake = 0.6;
          if (x >= 0) this.fx.ring(x, y, col, 40, 1.4, 5);
          break;
        }
        case EV_PULSE:
          if (!rm) this.fx.ring(x, y, this.colors[a - 1], 30 + b * 6, 0.9, 2);
          audio.pulse(this.algo(a));
          haptic('pulse', 0.3);
          break;
        case EV_BOLT:
          this.fx.flash(x, y, 6, '#ffffff', 0.25);
          if (parts) this.fx.spark(x, y, this.colors[a - 1], 10, 26);
          audio.bolt(this.algo(a));
          haptic('bolt', 0.45);
          break;
        case EV_EBB:
          if (!rm) this.fx.ring(x, y, this.colors[a - 1], -12, 0.8, 2);
          break;
        case EV_SPAWN:
          this.fx.ring(x, y, this.colors[a - 1], 18, 0.8, 3);
          break;
        case EV_METEOR: {
          if (b > 0) {
            this.callout(`⚡ Growth surge: ${this.name(b)}`, this.colors[b - 1]);
            haptic('success');
          } else {
            this.fx.flash(x, y, a * 2.2, '#ffb347', 0.9);
            this.fx.ring(x, y, '#ffcf6b', a * 2.5, 0.9, 6);
            if (parts) this.fx.spark(x, y, '#ffb347', 50, a * 2);
            if (!rm) this.fx.shake = 1;
            this.flash = 1;
            this.callout('☄️ Meteor strike!', '#ffcf6b');
            audio.meteor();
            haptic('meteor');
          }
          break;
        }
      }
    }
    // Territory gain notes.
    const nf = this.cfg.fighters.length;
    for (let i = 0; i < nf; i++) {
      const o = this.host.owned(i);
      const d = o - (this.lastOwned[i] ?? 0);
      this.lastOwned[i] = o;
      if (d > 2 && this.running) {
        const [cx] = this.host.centroid(i);
        audio.gain(i, this.cfg.fighters[i].algo, o / Math.max(1, this.host.playable), d, cx >= 0 ? (cx / this.host.W) * 2 - 1 : 0);
      }
    }
    if (this.host.result && !this.ended) this.finish();
  }

  private algo(id: number): string {
    return this.cfg.fighters[id - 1]?.algo ?? 'custom';
  }
  private name(id: number): string {
    const f = this.cfg.fighters[id - 1];
    return f ? algoName(f) : '?';
  }

  private callout(text: string, color: string): void {
    const c = h('div', { class: 'callout', style: `border-color:${color};box-shadow:0 0 24px ${color}55` }, text);
    this.el.querySelectorAll('.callout').forEach((e) => e.remove());
    this.el.appendChild(c);
    setTimeout(() => c.remove(), 2200);
  }

  private bigMoment(x: number, y: number, text: string, color: string): void {
    this.callout(text, color);
    if (!settings.slowmo || settings.reducedMotion || this.ended) return;
    this.slowUntil = performance.now() + 1700;
    this.applySpeed();
    setTimeout(() => this.applySpeed(), 1750);
    this.punchUntil = performance.now() + 1700;
    this.cam.target = { cx: x, cy: y, zoom: Math.max(this.cam.zoom, this.cam.fit * 2.4) };
  }

  // -------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------

  private frame(t: number): void {
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    if (!this.started) return;
    const now = performance.now();
    this.slowAmt += ((now < this.slowUntil ? 1 : 0) - this.slowAmt) * Math.min(1, dt * 6);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.punchUntil && now > this.punchUntil) {
      this.punchUntil = 0;
      if (!this.cinematic) this.cam.target = { cx: this.cam.W / 2, cy: this.cam.H / 2, zoom: this.cam.fit };
    }
    if (this.cinematic && now > this.nextCine && !this.punchUntil) {
      this.nextCine = now + 900;
      this.cineTarget();
    }
    this.cam.update(dt);
    if (this.cam.target && !this.cinematic && !this.punchUntil) {
      const tg = this.cam.target;
      if (Math.abs(tg.zoom - this.cam.zoom) < tg.zoom * 0.01 && Math.abs(tg.cx - this.cam.cx) < 0.5) this.cam.target = null;
    }
    const host = this.host;
    const mp = settings.masterpiece;
    if (host.dirty) {
      this.renderer.uploadOwner(host.owner);
      host.dirty = false;
    }
    if (mp && host.ageDirty) {
      this.renderer.uploadAge(host.age);
      host.ageDirty = false;
    }
    const heatBytes = host.heatTexture(Math.pow(0.93, dt * 60));
    if (settings.heat) this.renderer.uploadHeat(heatBytes, host.heatW, host.heatH);
    const sh = this.fx.shake * 6 * this.dpr;
    const view = this.cam.view(sh ? (Math.random() - 0.5) * sh : 0, sh ? (Math.random() - 0.5) * sh : 0);
    this.renderer.render(view, {
      time: t / 1000,
      tick: host.tick,
      style: settings.style,
      masterpiece: mp,
      trails: settings.trails,
      heat: settings.heat,
      pulse: settings.pulse && !settings.reducedMotion,
      patterns: settings.patterns || (settings.palette === 'colorblind' && this.cfg.fighters.length > 8),
      ageGradient: settings.ageGradient,
      backdrop: true,
      wrap: this.cfg.arena.wrap,
      bloom: settings.bloom,
      slow: this.slowAmt,
      flash: this.flash,
    });
    this.fx.update(dt);
    const g = this.fxg;
    g.clearRect(0, 0, this.fxc.width, this.fxc.height);
    if (mp || settings.particles) this.fx.draw(g, view, this.dpr);
    if (settings.avatars) this.drawBadges(g, view, dt);
    if (now - this.lastHud > 120) {
      this.lastHud = now;
      this.updateHud(false);
    }
    this.fpsN++;
    if (now - this.fpsT > 500) {
      this.fpsVal = (this.fpsN * 1000) / (now - this.fpsT);
      this.fpsN = 0;
      this.fpsT = now;
      if (settings.showFps) {
        this.fpsEl.classList.remove('hidden');
        this.fpsEl.textContent = `${this.fpsVal.toFixed(0)} fps · ${host.tps.toFixed(0)} tps · ${host.W}×${host.H} · ${this.renderer.kind}${host.usingWorker ? ' · worker' : ''}`;
      } else this.fpsEl.classList.add('hidden');
    }
  }

  private drawBadges(g: CanvasRenderingContext2D, view: { offX: number; offY: number; scale: number }, dt: number): void {
    const host = this.host;
    const r = 11 * this.dpr;
    const k = 1 - Math.exp(-dt * 5);
    for (let i = 0; i < this.cfg.fighters.length; i++) {
      if (!host.alive(i) || host.owned(i) < 1) continue;
      const [cx, cy] = host.centroid(i);
      if (cx < 0) continue;
      const b = this.badge[i];
      if (b.x < 0) {
        b.x = cx;
        b.y = cy;
      }
      b.x += (cx - b.x) * k;
      b.y += (cy - b.y) * k;
      const x = view.offX + b.x * view.scale, y = view.offY + b.y * view.scale;
      const img = this.avatars[i];
      g.save();
      g.shadowColor = this.colors[i];
      g.shadowBlur = 10 * this.dpr;
      g.beginPath();
      g.arc(x, y, r + 2 * this.dpr, 0, Math.PI * 2);
      g.fillStyle = 'rgba(5,6,12,0.85)';
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.closePath();
      if (img && img.complete && img.naturalWidth) {
        g.clip();
        g.drawImage(img, x - r, y - r, r * 2, r * 2);
      } else {
        g.fillStyle = this.colors[i];
        g.fill();
        g.fillStyle = '#07080f';
        g.font = `900 ${Math.round(11 * this.dpr)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(this.name(i + 1).slice(0, 1), x, y + 0.5);
      }
      g.restore();
      g.strokeStyle = this.colors[i];
      g.lineWidth = 2 * this.dpr;
      g.beginPath();
      g.arc(x, y, r + 1 * this.dpr, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private cineTarget(): void {
    const host = this.host;
    let best = -1, bv = 0;
    for (let i = 0; i < host.heat.length; i++) {
      if (host.heat[i] > bv) {
        bv = host.heat[i];
        best = i;
      }
    }
    if (best < 0 || bv < 1) {
      this.cam.target = { cx: host.W / 2, cy: host.H / 2, zoom: this.cam.fit };
      return;
    }
    const bx = (best % host.heatW) * 8 + 4, by = Math.floor(best / host.heatW) * 8 + 4;
    this.cam.target = { cx: bx, cy: by, zoom: this.cam.fit * 2.3 };
  }

  private toggleCinematic(): void {
    this.cinematic = !this.cinematic;
    this.cineBtn.classList.toggle('on', this.cinematic);
    if (!this.cinematic) this.cam.target = { cx: this.cam.W / 2, cy: this.cam.H / 2, zoom: this.cam.fit };
    toast(this.cinematic ? '🎥 Cinematic camera on' : 'Cinematic camera off');
  }

  private updateHud(force: boolean): void {
    const host = this.host;
    const nf = this.cfg.fighters.length;
    const play = Math.max(1, host.playable);
    // Share bar.
    if (force || this.shareBar.childElementCount !== nf + 1) {
      clear(this.shareBar);
      for (let i = 0; i < nf; i++) this.shareBar.appendChild(h('i', { style: `background:${this.colors[i]}` }));
      this.shareBar.appendChild(h('i', { style: 'flex:1;background:transparent' }));
    }
    for (let i = 0; i < nf; i++) (this.shareBar.children[i] as HTMLElement).style.width = `${(host.owned(i) / play) * 100}%`;
    // Clock.
    const sec = host.tick / TPS;
    const lim = this.cfg.rules.matchLength || (host.rules?.win === 'timer' ? 60 : 0);
    this.clock.textContent = lim ? `${fmtTime(sec)} / ${fmtTime(lim)}` : fmtTime(sec);
    // Scoreboard.
    const order = [...Array(nf).keys()].sort((a, b) => host.owned(b) - host.owned(a));
    const maxRows = Math.min(nf, window.innerHeight < 700 ? 8 : 10);
    if (force || this.score.childElementCount !== maxRows) {
      clear(this.score);
      for (let k = 0; k < maxRows; k++) this.score.appendChild(h('div', { class: 'it' }, h('div', { class: 'd' }), h('div', { class: 'nm' }), h('div', { class: 'pc' })));
    }
    for (let k = 0; k < maxRows; k++) {
      const i = order[k];
      const row = this.score.children[k] as HTMLElement;
      const f = this.cfg.fighters[i];
      const d = row.children[0] as HTMLElement;
      const want = f.image ? `url("${f.image}")` : '';
      if (d.dataset.i !== String(i)) {
        d.dataset.i = String(i);
        d.style.backgroundImage = want;
        d.style.backgroundColor = this.colors[i];
        (row.children[1] as HTMLElement).textContent = algoName(f);
      }
      (row.children[2] as HTMLElement).textContent = `${((host.owned(i) / play) * 100).toFixed(1)}%`;
      row.classList.toggle('dead', !host.alive(i) && host.tick > 2);
    }
    if (!this.graph.classList.contains('hidden')) this.drawGraph();
  }

  private drawGraph(): void {
    const c = this.graph;
    const dpr = this.dpr;
    const w = Math.round(c.clientWidth * dpr), hh = Math.round(c.clientHeight * dpr);
    if (!w || !hh) return;
    if (c.width !== w || c.height !== hh) {
      c.width = w;
      c.height = hh;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, hh);
    const hist = this.host.history;
    if (hist.length < 2) return;
    let max = 0.05;
    for (const row of hist) for (const v of row) max = Math.max(max, v);
    const pad = 10 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const y = pad + ((hh - 2 * pad) * k) / 4;
      g.beginPath();
      g.moveTo(pad, y);
      g.lineTo(w - pad, y);
      g.stroke();
    }
    g.lineWidth = 2 * dpr;
    g.lineJoin = 'round';
    for (let i = 0; i < this.cfg.fighters.length; i++) {
      g.strokeStyle = this.colors[i];
      g.beginPath();
      hist.forEach((row, k) => {
        const x = pad + ((w - 2 * pad) * k) / (hist.length - 1);
        const y = hh - pad - ((hh - 2 * pad) * row[i]) / max;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = `${11 * dpr}px system-ui`;
    g.fillText(`${(max * 100).toFixed(0)}%`, pad, pad + 10 * dpr);
  }

  private toggleGraph(): void {
    this.graph.classList.toggle('hidden');
    this.graphBtn.classList.toggle('on', !this.graph.classList.contains('hidden'));
    this.drawGraph();
  }

  // -------------------------------------------------------------------
  // Tools: click-to-spawn and paint obstacles
  // -------------------------------------------------------------------

  private toggleTools(): void {
    const show = this.toolsBar.classList.contains('hidden');
    this.toolsBar.classList.toggle('hidden', !show);
    this.toolBtn.classList.toggle('on', show);
    if (show) {
      if (this.running) this.togglePlay();
      this.renderTools();
      toast('Paused — tap the board to spawn or paint');
    } else this.setTool('pan');
  }

  private setTool(t: Tool): void {
    this.tool = t;
    if (!this.toolsBar.classList.contains('hidden')) this.renderTools();
  }

  private renderTools(): void {
    const bar = this.toolsBar;
    clear(bar);
    bar.appendChild(
      chips<Tool>(
        [
          { id: 'pan', label: '✋ Pan' },
          { id: 'spawn', label: '🌱 Spawn' },
          { id: 'wall', label: '🧱 Wall' },
          { id: 'hole', label: '🕳 Hole' },
          { id: 'erase', label: '🧽 Erase' },
        ],
        this.tool,
        (t) => {
          this.setTool(t);
          if (t !== 'pan' && this.running) this.togglePlay();
        },
      ),
    );
    if (this.tool === 'spawn') {
      this.cfg.fighters.forEach((f, i) => {
        const d = h('div', { class: `dotc ${i === this.toolSlot ? 'on' : ''}`, style: avatarStyle(this.colors[i], f.image) });
        d.addEventListener('click', () => {
          this.toolSlot = i;
          haptic('select');
          this.renderTools();
        });
        bar.appendChild(d);
      });
    } else if (this.tool !== 'pan') {
      bar.appendChild(slider('Brush', 1, 16, 1, this.brush, (v) => `${v}`, (v) => (this.brush = v)));
    }
  }

  private paintAt(px: number, py: number): void {
    const [gx, gy] = this.cam.toGrid(px, py);
    const W = this.host.W, H = this.host.H;
    const r = this.brush - 0.5;
    const value = this.tool === 'wall' ? WALL : this.tool === 'hole' ? VOID : EMPTY;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = Math.floor(gx + dx), y = Math.floor(gy + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (this.host.owner[i] === value) continue;
        // Erase never removes the arena's own outer void.
        if (value === EMPTY && this.host.mask[i] === VOID && this.host.owner[i] === VOID) continue;
        this.pending.add(i);
      }
    if (!this.paintTimer) {
      this.paintTimer = window.setTimeout(() => {
        this.paintTimer = 0;
        if (this.pending.size) {
          this.host.paint([...this.pending], value);
          this.pending.clear();
          haptic('paint', 0.4);
        }
      }, 30);
    }
  }

  private bindGestures(): void {
    const c = this.board;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; mx: number; my: number } | null = null;
    let downT = 0, downX = 0, downY = 0, moved = false, lastTap = 0;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
    };
    const userMoved = () => {
      this.cam.target = null;
      this.punchUntil = 0;
      if (this.cinematic) this.toggleCinematic();
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        downT = performance.now();
        downX = p.x;
        downY = p.y;
        moved = false;
        if (this.tool === 'wall' || this.tool === 'hole' || this.tool === 'erase') this.paintAt(p.x, p.y);
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (Math.hypot(p.x - downX, p.y - downY) > 10 * this.dpr) moved = true;
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        userMoved();
        this.cam.zoomAt(mx, my, d / Math.max(1, pinch.d));
        this.cam.pan(mx - pinch.mx, my - pinch.my);
        pinch = { d, mx, my };
        return;
      }
      if (this.tool === 'wall' || this.tool === 'hole' || this.tool === 'erase') {
        this.paintAt(p.x, p.y);
        return;
      }
      if (this.tool === 'spawn') return;
      if (moved) {
        userMoved();
        this.cam.pan(p.x - prev.x, p.y - prev.y);
      }
    });
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size > 0) return;
      const now = performance.now();
      if (!moved && now - downT < 350) {
        if (this.tool === 'spawn') {
          const [gx, gy] = this.cam.toGrid(downX, downY);
          const x = Math.floor(gx), y = Math.floor(gy);
          if (x >= 0 && y >= 0 && x < this.host.W && y < this.host.H) {
            const i = y * this.host.W + x;
            if (this.host.owner[i] < WALL) {
              this.host.spawn(this.toolSlot + 1, i);
              haptic('spawn');
              audio.ui('toggle');
            } else haptic('error');
          }
        } else if (this.tool === 'pan') {
          if (now - lastTap < 300) {
            // Double tap: zoom in / back to fit.
            userMoved();
            if (this.cam.zoom > this.cam.fit * 1.3) this.cam.target = { cx: this.cam.W / 2, cy: this.cam.H / 2, zoom: this.cam.fit };
            else {
              const [gx, gy] = this.cam.toGrid(downX, downY);
              this.cam.target = { cx: gx, cy: gy, zoom: this.cam.fit * 3 };
            }
            haptic('select');
            lastTap = 0;
          } else lastTap = now;
        }
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        this.cam.target = null;
        this.cam.zoomAt((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  // -------------------------------------------------------------------
  // Extra actions
  // -------------------------------------------------------------------

  private moreSheet(): void {
    const s = sheet('Match options', [
      toggleRow('Visual Masterpiece', 'Glow, bloom, trails, particles', settings.masterpiece, (v) => saveSettings({ masterpiece: v })),
      h('div', { class: 'spacer' }),
      h('div', { class: 'lbl' }, 'Shader style'),
      h('div', { class: 'spacer', style: 'height:6px' }),
      chips(
        [
          { id: 'none', label: 'Clean' },
          { id: 'neon', label: 'Neon' },
          { id: 'crt', label: 'CRT' },
          { id: 'watercolor', label: 'Watercolor' },
          { id: 'ink', label: 'Ink' },
        ],
        settings.style,
        (v) => saveSettings({ style: v }),
      ),
      h('div', { class: 'spacer' }),
      toggleRow('Heat map', 'Where growth is happening right now', settings.heat, (v) => saveSettings({ heat: v })),
      toggleRow('Fighter badges', 'Avatars that follow each territory', settings.avatars, (v) => saveSettings({ avatars: v })),
      toggleRow('Battle haptics', 'Feel clashes, captures and pulses', settings.battleHaptics, (v) => saveSettings({ battleHaptics: v })),
    ], [
      button('🎲 New seed', () => {
        s.close();
        void this.start(true);
      }),
      button('💾 Save setup', () => {
        s.close();
        void saveToSlotDialog(this.cfg, this.thumb());
      }),
    ]);
  }

  private thumb(): string {
    const host = this.host;
    if (!host.N) return '';
    return ownerCanvas(host.owner, host.W, host.H, this.colors, 160).toDataURL('image/png');
  }

  private async composeShot(): Promise<Blob | null> {
    const view = this.cam.view();
    this.renderer.render(view, {
      time: performance.now() / 1000, tick: this.host.tick, style: settings.style, masterpiece: settings.masterpiece,
      trails: settings.trails, heat: settings.heat, pulse: false, patterns: settings.patterns, ageGradient: settings.ageGradient,
      backdrop: true, wrap: this.cfg.arena.wrap, bloom: settings.bloom, slow: 0, flash: 0,
    });
    const w = this.board.width, hh = this.board.height;
    const out = document.createElement('canvas');
    const foot = Math.round(120 * this.dpr);
    out.width = w;
    out.height = hh + foot;
    const g = out.getContext('2d')!;
    g.fillStyle = '#05060b';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(this.board, 0, 0);
    g.drawImage(this.fxc, 0, 0);
    const title = pixelText('PIXEL WARS');
    g.imageSmoothingEnabled = false;
    const tw = Math.min(w * 0.5, title.width * 6 * this.dpr);
    g.drawImage(title, 16 * this.dpr, hh + 18 * this.dpr, tw, (tw * title.height) / title.width);
    const order = [...Array(this.cfg.fighters.length).keys()].sort((a, b) => this.host.owned(b) - this.host.owned(a));
    g.font = `700 ${13 * this.dpr}px system-ui, sans-serif`;
    let x = 16 * this.dpr;
    const y = hh + 86 * this.dpr;
    for (const i of order.slice(0, 6)) {
      const txt = `${algoName(this.cfg.fighters[i])} ${((this.host.owned(i) / Math.max(1, this.host.playable)) * 100).toFixed(0)}%`;
      g.fillStyle = this.colors[i];
      g.fillRect(x, y - 9 * this.dpr, 12 * this.dpr, 12 * this.dpr);
      g.fillStyle = '#eef1ff';
      g.fillText(txt, x + 17 * this.dpr, y + 2 * this.dpr);
      x += g.measureText(txt).width + 34 * this.dpr;
      if (x > w - 60 * this.dpr) break;
    }
    return new Promise((res) => out.toBlob((b) => res(b), 'image/png'));
  }

  private async screenshot(): Promise<void> {
    haptic('success');
    const blob = await this.composeShot();
    if (!blob) return toast('Could not capture the screen');
    const name = `pixelwars-${Date.now()}.png`;
    const s = sheet('Screenshot', h('img', { src: URL.createObjectURL(blob), style: 'width:100%;border-radius:14px' }), [
      button('Save', async () => {
        s.close();
        toast((await saveFile(blob, name)) ? 'Saved to Pictures/PixelWars' : 'Could not save');
      }),
      button('Share', () => {
        s.close();
        void shareFile(blob, name, 'PIXEL WARS: Algorithm Battlegrounds');
      }, 'primary'),
    ]);
  }

  // -------------------------------------------------------------------
  // End of match
  // -------------------------------------------------------------------

  private finish(): void {
    this.ended = true;
    this.running = false;
    this.playBtn.textContent = '▶';
    const res = this.host.result!;
    setTimeout(() => this.showEnd(), 900);
    audio.endJingle();
    haptic(res.winner ? 'victory' : 'defeat');
    if (res.winner) setTimeout(() => audio.victory(this.algo(res.winner)), 700);
    this.cam.target = { cx: this.cam.W / 2, cy: this.cam.H / 2, zoom: this.cam.fit };
  }

  private showEnd(): void {
    if (!this.ended) return;
    const res = this.host.result!;
    const nf = this.cfg.fighters.length;
    const play = Math.max(1, this.host.playable);
    const w = res.winner;
    const wf = w ? this.cfg.fighters[w - 1] : null;
    const winnerEl = h(
      'div',
      { class: 'winner' },
      h('div', { class: 'crown' }, w ? '👑' : '🤝'),
      wf ? h('div', { class: 'av', style: avatarStyle(this.colors[w - 1], wf.image) }, wf.image ? '' : algoName(wf).slice(0, 1)) : null,
      h('h2', { style: wf ? `color:${this.colors[w - 1]};text-shadow:0 0 24px ${this.colors[w - 1]}88` : '' }, wf ? `${algoName(wf)} wins!` : 'Draw!'),
      h('p', null, `${REASON[res.reason] ?? ''} · ${fmtTime(res.tick / TPS)}`),
    );
    const ranks = h('div', { class: 'ranks' });
    res.ranking.forEach((id, k) => {
      const f = this.cfg.fighters[id - 1];
      const i = id - 1;
      ranks.appendChild(
        h('div', { class: 'r' },
          h('span', { class: 'n' }, `${k + 1}`),
          h('span', { class: 'd', style: avatarStyle(this.colors[i], f.image) }),
          h('span', null, algoName(f)),
          !this.host.alive(i) ? h('span', { class: 'kbd' }, '💀') : null,
          h('span', { class: 'pc' }, `${((this.host.owned(i) / play) * 100).toFixed(1)}%`),
        ),
      );
    });
    void nf;
    const ico = (i: string, l: string) => [h('span', { class: 'ico' }, i), l];
    const grid = h('div', { class: 'endgrid' },
      button(ico('⟲', 'Rematch'), () => void this.start(false), 'primary'),
      button(ico('🎲', 'New seed'), () => void this.start(true)),
      button(ico('🎞', 'Timelapse'), () => this.timelapse()),
      button(ico('📷', 'Share'), () => void this.screenshot()),
      button(ico('💾', 'Save setup'), () => void saveToSlotDialog(this.cfg, this.thumb())),
      button(ico('🛠', 'Edit setup'), () => {
        const cfg = this.cfg;
        pop();
        if (current()?.kind !== 'setup') nav.setup(cfg);
      }),
      button(ico('🏠', 'Menu'), () => popToRoot()),
    );
    this.endEl = h('div', { class: 'endcard' }, winnerEl, ranks, grid);
    this.el.appendChild(this.endEl);
  }

  private timelapse(): void {
    const snaps = this.host.snaps;
    if (snaps.length < 2) return toast('Nothing recorded yet');
    const sw = this.host.snapW, shh = this.host.snapH;
    const c = h('canvas', { style: 'width:100%;border-radius:14px;image-rendering:pixelated;background:#04050a' }) as HTMLCanvasElement;
    c.width = sw;
    c.height = shh;
    const g = c.getContext('2d')!;
    const img = g.createImageData(sw, shh);
    const px = new Uint32Array(img.data.buffer);
    const lut = new Uint32Array(256);
    const toU = (hex: string) => {
      const [r, gg, b] = hexToRgb(hex);
      return (255 << 24) | (b << 16) | (gg << 8) | r;
    };
    lut.fill(toU('#04050a'));
    lut[EMPTY] = toU('#0d0f18');
    lut[WALL] = toU('#262933');
    this.colors.forEach((col, i) => (lut[i + 1] = toU(col)));
    let f = 0, playing = true;
    const scrub = h('input', { type: 'range', min: '0', max: String(snaps.length - 1), step: '1' }) as HTMLInputElement;
    const draw = () => {
      const d = snaps[f].data;
      for (let i = 0; i < d.length; i++) px[i] = lut[d[i]];
      g.putImageData(img, 0, 0);
      scrub.value = String(f);
      scrub.style.setProperty('--p', `${(f / (snaps.length - 1)) * 100}%`);
    };
    scrub.addEventListener('input', () => {
      playing = false;
      f = Number(scrub.value);
      draw();
    });
    let raf = 0, acc = 0, last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      acc += t - last;
      last = t;
      if (!playing || acc < 33) return;
      acc = 0;
      f = (f + 1) % snaps.length;
      draw();
    };
    raf = requestAnimationFrame(loop);
    draw();
    const s = sheet('Timelapse', [c, h('div', { class: 'row', style: 'margin-top:8px' }, button('⏯', () => (playing = !playing), 'icon small'), scrub)], [
      button('Export GIF', async () => {
        toast('Encoding GIF…');
        await new Promise((r) => setTimeout(r, 30));
        const blob = this.makeGif();
        s.close();
        const name = `pixelwars-timelapse-${Date.now()}.gif`;
        const s2 = sheet('Timelapse GIF', h('img', { src: URL.createObjectURL(blob), style: 'width:100%;border-radius:14px;image-rendering:pixelated' }), [
          button('Save', async () => {
            s2.close();
            toast((await saveFile(blob, name)) ? 'Saved to Pictures/PixelWars' : 'Could not save');
          }),
          button('Share', () => {
            s2.close();
            void shareFile(blob, name, 'PIXEL WARS timelapse');
          }, 'primary'),
        ]);
      }, 'primary'),
    ], () => cancelAnimationFrame(raf));
  }

  private makeGif(): Blob {
    const snaps = this.host.snaps;
    const sw = this.host.snapW, shh = this.host.snapH;
    const scale = Math.max(1, Math.floor(320 / Math.max(sw, shh)));
    const gw = sw * scale, gh = shh * scale;
    const pal: [number, number, number][] = [hexToRgb('#0d0f18')];
    this.colors.forEach((c) => pal.push(hexToRgb(c)));
    const iWall = pal.length;
    pal.push(hexToRgb('#262933'));
    const iVoid = pal.length;
    pal.push(hexToRgb('#04050a'));
    const map = new Uint8Array(256).fill(iVoid);
    map[EMPTY] = 0;
    map[WALL] = iWall;
    for (let i = 1; i <= this.colors.length; i++) map[i] = i;
    // Keep the GIF a reasonable size: at most ~120 frames.
    const stride = Math.max(1, Math.ceil(snaps.length / 120));
    const frames: Uint8Array[] = [];
    for (let k = 0; k < snaps.length; k += stride) {
      const d = snaps[k].data;
      const fr = new Uint8Array(gw * gh);
      for (let y = 0; y < gh; y++) {
        const sy = Math.floor(y / scale) * sw;
        for (let x = 0; x < gw; x++) fr[y * gw + x] = map[d[sy + Math.floor(x / scale)]];
      }
      frames.push(fr);
    }
    const bytes = encodeGif(frames, gw, gh, pal, 5, 200);
    return new Blob([bytes as BlobPart], { type: 'image/gif' });
  }
}
