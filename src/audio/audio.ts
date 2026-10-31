/**
 * Generative Web Audio sound engine — no audio files. Every fighter has its
 * own instrument and register; territory gains play soft notes in A minor
 * pentatonic, attacks and captures add sharper hits, and a slow pad keeps an
 * ambient bed going underneath.
 */
import { settings } from '../saves/store.ts';

interface Voice {
  type: OscillatorType;
  oct: number;
  attack: number;
  decay: number;
  cutoff: number;
  q?: number;
  fm?: number;
  fmDepth?: number;
  detune?: number;
  gain?: number;
}

const V = (type: OscillatorType, oct: number, attack: number, decay: number, cutoff: number, extra: Partial<Voice> = {}): Voice => ({
  type, oct, attack, decay, cutoff, ...extra,
});

const INSTR: Record<string, Voice> = {
  flood: V('sine', 1, 0.005, 0.5, 4000, { fm: 2, fmDepth: 60 }),
  mycelium: V('triangle', 2, 0.002, 0.25, 3500),
  encircler: V('square', 0, 0.01, 0.4, 900, { q: 4, gain: 0.5 }),
  spiral: V('sine', 1, 0.02, 0.7, 3000, { detune: 7 }),
  crystal: V('sine', 3, 0.001, 0.9, 9000, { fm: 3.5, fmDepth: 400 }),
  slime: V('sawtooth', 0, 0.01, 0.35, 700, { q: 8, gain: 0.5 }),
  virus: V('square', 2, 0.001, 0.12, 2400, { gain: 0.35 }),
  wave: V('sine', 0, 0.08, 1.1, 2000, { detune: 5 }),
  hive: V('triangle', 1, 0.001, 0.3, 5000, { fm: 4, fmDepth: 120 }),
  lightning: V('sawtooth', 2, 0.001, 0.18, 6000, { gain: 0.35 }),
  glacier: V('sine', -1, 0.05, 1.6, 2500, { fm: 1.5, fmDepth: 30 }),
  swarm: V('square', 3, 0.001, 0.06, 4000, { gain: 0.25 }),
  parasite: V('sawtooth', 0, 0.005, 0.3, 1200, { detune: 18, q: 3, gain: 0.45 }),
  fractal: V('triangle', 2, 0.002, 0.4, 4500, { fm: 2.01, fmDepth: 200 }),
  tide: V('sine', 0, 0.12, 1.4, 1800, { detune: 9 }),
  mind: V('sine', 1, 0.003, 0.8, 5000, { fm: 7, fmDepth: 150 }),
  custom: V('triangle', 1, 0.004, 0.45, 3200, { fm: 3, fmDepth: 90 }),
};

const SCALE = [0, 3, 5, 7, 10];
const ROOT = 220;
const CHORDS = [
  [0, 3, 7, 12],
  [-4, 0, 3, 8],
  [3, 7, 10, 15],
  [-2, 2, 5, 10],
];

function freq(degree: number, oct: number): number {
  const d = ((degree % 5) + 5) % 5;
  const o = oct + Math.floor(degree / 5);
  return ROOT * Math.pow(2, (SCALE[d] + 12 * o) / 12);
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  private lastNote = new Map<number, number>();
  private ambientTimer = 0;
  private chordIdx = 0;
  private ambientLevel = 0.5;
  private padNodes: { stop(t: number): void }[] = [];
  private voicesThisFrame = 0;
  private frameStamp = 0;

  /** Must be called from a user gesture the first time. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master = ctx.createGain();
      this.music = ctx.createGain();
      this.sfx = ctx.createGain();
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.impulse(2.6);
      this.verbSend = ctx.createGain();
      this.verbSend.gain.value = 0.35;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.music.connect(this.verbSend);
      this.sfx.connect(this.verbSend);
      this.verbSend.connect(this.verb);
      this.verb.connect(this.master);
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.noise = this.makeNoise();
      this.apply();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master * 0.9, t, 0.05);
    this.music.gain.setTargetAtTime(settings.music * 0.6, t, 0.05);
    this.sfx.gain.setTargetAtTime(settings.sfx, t, 0.05);
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => {});
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Cap simultaneous voice creation so huge battles do not choke audio. */
  private allow(): boolean {
    const now = performance.now();
    if (now - this.frameStamp > 50) {
      this.frameStamp = now;
      this.voicesThisFrame = 0;
    }
    return ++this.voicesThisFrame <= 6;
  }

  private tone(f: number, v: Voice, vel: number, when = 0, bus?: AudioNode, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow()) return;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    const peak = 0.22 * vel * (v.gain ?? 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + v.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.attack + v.decay);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = v.cutoff;
    filt.Q.value = v.q ?? 0.7;
    const osc = ctx.createOscillator();
    osc.type = v.type;
    f = Math.min(9000, f);
    osc.frequency.value = f;
    const end = t + v.attack + v.decay + 0.05;
    if (v.fm) {
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      mod.frequency.value = Math.min(16000, f * v.fm);
      mg.gain.setValueAtTime(v.fmDepth ?? 50, t);
      mg.gain.exponentialRampToValueAtTime(1, end);
      mod.connect(mg).connect(osc.frequency);
      mod.start(t);
      mod.stop(end);
    }
    let out: AudioNode = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      out = p;
    }
    osc.connect(filt).connect(g);
    out.connect(bus ?? this.sfx);
    osc.start(t);
    osc.stop(end);
    if (v.detune) {
      const o2 = ctx.createOscillator();
      o2.type = v.type;
      o2.frequency.value = f;
      o2.detune.value = v.detune;
      o2.connect(filt);
      o2.start(t);
      o2.stop(end);
    }
  }

  private noiseHit(dur: number, cutoff: number, vel: number, type: BiquadFilterType = 'bandpass', when = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private muted(algo: string): boolean {
    return settings.mutedAlgos.includes(algo);
  }

  /** Territory gain: soft note in the fighter's register. */
  gain(slot: number, algo: string, share: number, amount: number, pan = 0): void {
    if (!this.ctx || this.muted(algo)) return;
    const now = performance.now();
    const gap = 140 + slot * 7;
    if (now - (this.lastNote.get(slot) ?? 0) < gap) return;
    this.lastNote.set(slot, now);
    const v = INSTR[algo] ?? INSTR.custom;
    const degree = Math.floor(share * 9) + ((Math.random() * 3) | 0);
    const vel = Math.min(1, 0.25 + amount * 0.02) * 0.8;
    this.tone(freq(degree, v.oct), v, vel, 0, this.sfx, pan);
  }

  /** Attack / capture of a single pixel: short percussive hit. */
  hit(algo: string, pan = 0): void {
    if (!this.ctx || this.muted(algo)) return;
    const now = performance.now();
    if (now - (this.lastNote.get(-1) ?? 0) < 70) return;
    this.lastNote.set(-1, now);
    this.noiseHit(0.06, 2500 + Math.random() * 2500, 0.5);
    const v = INSTR[algo] ?? INSTR.custom;
    this.tone(freq(4 + ((Math.random() * 4) | 0), v.oct + 1), { ...v, decay: 0.08, attack: 0.001 }, 0.45, 0, this.sfx, pan);
  }

  capture(algo: string, size: number): void {
    if (!this.ctx || this.muted(algo)) return;
    const big = Math.min(1, size / 2000);
    this.noiseHit(0.5 + big * 0.6, 180, 0.7 + big * 0.3, 'lowpass');
    this.tone(55, V('sine', 0, 0.005, 0.6 + big, 400), 0.9);
    const v = INSTR[algo] ?? INSTR.custom;
    [0, 2, 4].forEach((d, i) => this.tone(freq(d, v.oct), v, 0.6, i * 0.06));
  }

  elim(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.8);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.frequency.value = 1200;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1);
    this.noiseHit(0.4, 300, 0.6, 'lowpass');
  }

  pulse(algo: string): void {
    if (!this.ctx || this.muted(algo)) return;
    this.tone(freq(0, -1), V('sine', -1, 0.04, 0.6, 600), 0.6);
  }

  bolt(algo: string): void {
    if (!this.ctx || this.muted(algo)) return;
    this.noiseHit(0.18, 5000, 0.5, 'highpass');
    this.tone(freq(4, 3), V('sawtooth', 3, 0.001, 0.1, 7000), 0.3);
  }

  meteor(): void {
    if (!this.ctx) return;
    this.noiseHit(1.4, 140, 1, 'lowpass');
    this.tone(41, V('sine', 0, 0.01, 1.2, 300), 1);
  }

  jingleStart(): void {
    if (!this.ctx) return;
    const v = V('triangle', 1, 0.004, 0.35, 5000, { fm: 2, fmDepth: 80 });
    [0, 2, 4, 5].forEach((d, i) => this.tone(freq(d, 1), v, 0.7, i * 0.11));
    this.noiseHit(0.3, 200, 0.5, 'lowpass', 0.44);
  }

  countdown(n: number): void {
    if (!this.ctx) return;
    this.tone(n > 0 ? freq(2, 2) : freq(5, 2), V('square', 2, 0.002, n > 0 ? 0.12 : 0.4, 3000, { gain: 0.5 }), 0.6);
  }

  victory(algo: string): void {
    if (!this.ctx) return;
    const v = INSTR[algo] ?? INSTR.custom;
    const seq = [0, 2, 4, 5, 7, 9, 10];
    seq.forEach((d, i) => this.tone(freq(d, Math.max(0, v.oct)), { ...v, decay: 0.6 }, 0.75, i * 0.09));
    const chord = V('sawtooth', 1, 0.05, 2.2, 2200, { detune: 10, gain: 0.35 });
    [0, 2, 4].forEach((d) => this.tone(freq(d + 5, 0), chord, 0.6, seq.length * 0.09));
    this.noiseHit(1.2, 6000, 0.25, 'highpass', seq.length * 0.09);
  }

  endJingle(): void {
    if (!this.ctx) return;
    const v = V('triangle', 1, 0.004, 0.5, 4000);
    [7, 4, 2, 0].forEach((d, i) => this.tone(freq(d, 1), v, 0.6, i * 0.13));
  }

  ui(kind: 'tap' | 'toggle' | 'back' | 'error' = 'tap'): void {
    if (!this.ctx) return;
    const f = kind === 'back' ? 330 : kind === 'error' ? 160 : kind === 'toggle' ? 660 : 880;
    this.tone(f, V('sine', 2, 0.001, kind === 'error' ? 0.25 : 0.06, 6000, { gain: 0.5 }), 0.35, 0, this.sfx);
  }

  /** Slow ambient pad. level 0..1 (menu ~0.4, match ~0.7). */
  startAmbient(level = 0.5): void {
    this.ambientLevel = level;
    if (!this.ctx || this.ambientTimer) return;
    const playChord = () => {
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const chord = CHORDS[this.chordIdx++ % CHORDS.length];
      for (const p of this.padNodes) p.stop(t + 2.5);
      this.padNodes = [];
      const lvl = 0.05 * this.ambientLevel;
      for (const semi of chord) {
        const f = ROOT * 0.5 * Math.pow(2, semi / 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl, t + 2.5);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 700;
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 0.07 + Math.random() * 0.05;
        lg.gain.value = 350;
        lfo.connect(lg).connect(filt.frequency);
        const oscs = [-6, 6].map((det) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          o.connect(filt);
          o.start(t);
          return o;
        });
        filt.connect(g).connect(this.music);
        lfo.start(t);
        this.padNodes.push({
          stop: (when: number) => {
            g.gain.cancelScheduledValues(when - 2.5);
            g.gain.setValueAtTime(g.gain.value, when - 2.5);
            g.gain.linearRampToValueAtTime(0, when);
            for (const o of oscs) o.stop(when + 0.1);
            lfo.stop(when + 0.1);
          },
        });
      }
      // Soft heartbeat under matches.
      if (this.ambientLevel > 0.6) {
        for (let b = 0; b < 4; b++) this.tone(55, V('sine', 0, 0.005, 0.35, 300, { gain: 0.6 }), 0.35 * this.ambientLevel, b * 2, this.music);
      }
    };
    playChord();
    this.ambientTimer = window.setInterval(playChord, 8000);
  }

  setAmbientLevel(level: number): void {
    this.ambientLevel = level;
  }

  stopAmbient(): void {
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    this.ambientTimer = 0;
    const t = this.ctx?.currentTime ?? 0;
    for (const p of this.padNodes) p.stop(t + 2.5);
    this.padNodes = [];
  }
}

export const audio = new AudioEngine();
