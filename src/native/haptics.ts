/**
 * Semantic haptics. On the Android app these map to VibrationEffect
 * composition primitives (Pixel phones have a great actuator); in a mobile
 * browser they fall back to navigator.vibrate patterns.
 */
import { settings } from '../saves/store.ts';
import { nativeHaptic } from './bridge.ts';

export type HapticName =
  | 'tap'
  | 'select'
  | 'toggle'
  | 'tick'
  | 'start'
  | 'pause'
  | 'resume'
  | 'capture'
  | 'bigCapture'
  | 'elim'
  | 'victory'
  | 'defeat'
  | 'pulse'
  | 'bolt'
  | 'meteor'
  | 'clash'
  | 'spawn'
  | 'paint'
  | 'error'
  | 'success'
  | 'countdown'
  | 'go';

const BATTLE: ReadonlySet<HapticName> = new Set(['clash', 'pulse', 'bolt', 'capture', 'bigCapture', 'elim', 'meteor']);

/** Minimum ms between two haptics of the same kind. */
const MIN_GAP: Partial<Record<HapticName, number>> = {
  tick: 35,
  clash: 140,
  pulse: 220,
  bolt: 160,
  capture: 180,
  paint: 70,
  spawn: 80,
};

const FALLBACK: Record<HapticName, number | number[]> = {
  tap: 8,
  select: 12,
  toggle: 14,
  tick: 5,
  start: [20, 40, 30],
  pause: 18,
  resume: 12,
  capture: 22,
  bigCapture: [40, 30, 60],
  elim: [30, 40, 30, 40, 50],
  victory: [30, 60, 30, 60, 90],
  defeat: [60, 80, 120],
  pulse: 6,
  bolt: 10,
  meteor: [80, 40, 40],
  clash: 4,
  spawn: 14,
  paint: 4,
  error: [30, 50, 30],
  success: [15, 40, 25],
  countdown: 16,
  go: [25, 20, 45],
};

const last = new Map<HapticName, number>();
let globalLast = 0;

export function haptic(name: HapticName, strength = 1): void {
  if (!settings.haptics) return;
  if (BATTLE.has(name) && !settings.battleHaptics) return;
  const now = performance.now();
  const gap = MIN_GAP[name] ?? 0;
  if (gap && now - (last.get(name) ?? -1e9) < gap) return;
  // Keep minor battle buzz from stacking on top of a big moment.
  if (BATTLE.has(name) && name !== 'bigCapture' && name !== 'elim' && now - globalLast < 45) return;
  last.set(name, now);
  globalLast = now;
  const s = Math.max(0.05, Math.min(1, strength * settings.hapticStrength));
  if (nativeHaptic(name, s)) return;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if ('vibrate' in navigator && (!ua || ua.hasBeenActive)) {
    const p = FALLBACK[name];
    try {
      navigator.vibrate(Array.isArray(p) ? p.map((v, i) => (i % 2 ? v : Math.round(v * s))) : Math.max(1, Math.round(p * s)));
    } catch {
      /* not allowed before a user gesture */
    }
  }
}
