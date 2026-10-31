/** Persistent settings, save slots, custom fighters, export / import. */
import { BASE_RULES, defaultConfig, PRESET_BY_ID } from '../engine/setup.ts';
import { MAX_FIGHTERS, type CustomParams, type MatchConfig } from '../engine/types.ts';

export type ShaderStyle = 'none' | 'crt' | 'neon' | 'watercolor' | 'ink';
export type PaletteMode = 'vivid' | 'colorblind' | 'contrast';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  mutedAlgos: string[];
  haptics: boolean;
  hapticStrength: number;
  battleHaptics: boolean;
  masterpiece: boolean;
  style: ShaderStyle;
  bloom: number;
  trails: boolean;
  heat: boolean;
  particles: boolean;
  cinematic: boolean;
  slowmo: boolean;
  ageGradient: boolean;
  pulse: boolean;
  palette: PaletteMode;
  reducedMotion: boolean;
  patterns: boolean;
  showFps: boolean;
  highRefresh: boolean;
  keepAwake: boolean;
  avatars: boolean;
  slotCount: number;
  firstRun: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.55,
  sfx: 0.75,
  mutedAlgos: [],
  haptics: true,
  hapticStrength: 0.85,
  battleHaptics: true,
  masterpiece: true,
  style: 'none',
  bloom: 0.7,
  trails: true,
  heat: false,
  particles: true,
  cinematic: false,
  slowmo: true,
  ageGradient: true,
  pulse: true,
  palette: 'vivid',
  reducedMotion: false,
  patterns: false,
  showFps: false,
  highRefresh: true,
  keepAwake: true,
  avatars: true,
  slotCount: 10,
  firstRun: true,
};

export interface SaveSlot {
  name: string;
  savedAt: number;
  config: MatchConfig;
  thumb?: string;
}

export interface CustomFighterDef {
  id: string;
  name: string;
  color: string;
  image?: string;
  params: CustomParams;
}

const K_SETTINGS = 'pw.settings.v1';
const K_SLOTS = 'pw.slots.v1';
const K_LAST = 'pw.last.v1';
const K_LIB = 'pw.fighters.v1';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

export const settings: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K_SETTINGS, {}) };

export function saveSettings(patch: Partial<Settings> = {}): void {
  Object.assign(settings, patch);
  store(K_SETTINGS, settings);
  for (const l of listeners) l();
}

export function onSettings(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------------------
// Save slots
// ---------------------------------------------------------------------------

export function getSlots(): (SaveSlot | null)[] {
  const raw = load<(SaveSlot | null)[]>(K_SLOTS, []);
  const n = Math.max(settings.slotCount, raw.length, 10);
  const out: (SaveSlot | null)[] = [];
  for (let i = 0; i < n; i++) out.push(raw[i] ? { ...raw[i]!, config: sanitizeConfig(raw[i]!.config) } : null);
  return out;
}

export function setSlots(slots: (SaveSlot | null)[]): boolean {
  return store(K_SLOTS, slots);
}

export function writeSlot(i: number, slot: SaveSlot | null): boolean {
  const slots = getSlots();
  while (slots.length <= i) slots.push(null);
  slots[i] = slot;
  return setSlots(slots);
}

export function addSlot(): void {
  saveSettings({ slotCount: settings.slotCount + 5 });
}

export function getLastConfig(): MatchConfig {
  const c = load<MatchConfig | null>(K_LAST, null);
  return c ? sanitizeConfig(c) : defaultConfig();
}

export function setLastConfig(c: MatchConfig): void {
  store(K_LAST, c);
}

// ---------------------------------------------------------------------------
// Custom fighter library
// ---------------------------------------------------------------------------

export function getLibrary(): CustomFighterDef[] {
  return load<CustomFighterDef[]>(K_LIB, []);
}

export function setLibrary(lib: CustomFighterDef[]): boolean {
  return store(K_LIB, lib);
}

// ---------------------------------------------------------------------------
// Validation, export & import
// ---------------------------------------------------------------------------

const clamp = (v: unknown, a: number, b: number, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d;
};

/** Make any loaded / imported config safe to use. */
export function sanitizeConfig(c: Partial<MatchConfig> | null | undefined): MatchConfig {
  const d = defaultConfig();
  if (!c || typeof c !== 'object') return d;
  const fighters = Array.isArray(c.fighters) ? c.fighters.filter((f) => f && typeof f.algo === 'string').slice(0, MAX_FIGHTERS) : d.fighters;
  const mode = c.mode && PRESET_BY_ID[c.mode] ? c.mode : 'sandbox';
  const arena = { ...d.arena, ...(c.arena ?? {}) };
  arena.size = clamp(arena.size, 32, 1024, 256);
  const rules = { ...BASE_RULES, ...(c.rules ?? {}) };
  rules.speed = clamp(rules.speed, 0.25, 10, 1);
  rules.matchLength = clamp(rules.matchLength, 0, 3600, 0);
  return {
    version: 1,
    name: typeof c.name === 'string' ? c.name.slice(0, 40) : d.name,
    mode,
    fighters: fighters.length >= 2 ? fighters.map((f) => ({ ...f, color: typeof f.color === 'string' ? f.color : '#ffffff' })) : d.fighters,
    arena,
    rules,
    seed: clamp(c.seed, 0, 0xffffffff, d.seed) >>> 0,
  };
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Export a setup as a share code (compressed) — falls back to plain JSON. */
export async function exportConfig(c: MatchConfig, opts: { images: boolean } = { images: true }): Promise<string> {
  const copy: MatchConfig = JSON.parse(JSON.stringify(c));
  if (!opts.images) {
    copy.fighters.forEach((f) => delete f.image);
    delete copy.arena.imageBackdrop;
  }
  const json = JSON.stringify({ pixelwars: 1, config: copy });
  if (typeof CompressionStream === 'undefined') return json;
  try {
    const z = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
    return 'PW1:' + toB64Url(z);
  } catch {
    return json;
  }
}

export async function importConfig(text: string): Promise<MatchConfig> {
  const t = text.trim();
  let json: string;
  if (t.startsWith('PW1:')) {
    const bytes = fromB64Url(t.slice(4).replace(/\s+/g, ''));
    const raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
    json = new TextDecoder().decode(raw);
  } else json = t;
  const obj = JSON.parse(json);
  const cfg = obj && obj.config ? obj.config : obj;
  if (!cfg || !Array.isArray(cfg.fighters)) throw new Error('Not a Pixel Wars setup');
  return sanitizeConfig(cfg);
}
