/**
 * Bridge to the Android shell (android/app/.../NativeBridge.java).
 * Everything degrades gracefully in a normal browser.
 */

interface NativeApi {
  haptic(name: string, strength: number): void;
  hapticPattern(json: string): void;
  hasRichHaptics(): boolean;
  shareText(text: string, title: string): void;
  shareFile(base64: string, mime: string, filename: string, text: string): void;
  saveToGallery(base64: string, mime: string, filename: string): boolean;
  copyText(text: string): void;
  readClipboard(): string;
  keepAwake(on: boolean): void;
  setImmersive(on: boolean): void;
  setHighRefresh(on: boolean): void;
  exitApp(): void;
  appVersion(): string;
}

declare global {
  interface Window {
    PixelWarsNative?: NativeApi;
    /** Called by the native shell on system back. Return true if handled. */
    __pwBack?: () => boolean;
    /** Called by the native shell with safe-area insets in CSS px. */
    __pwInsets?: (t: number, r: number, b: number, l: number) => void;
    __pwPause?: () => void;
  }
}

export const native: NativeApi | null = typeof window !== 'undefined' ? (window.PixelWarsNative ?? null) : null;
export const isNativeApp = !!native;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function setInsets(t: number, r: number, b: number, l: number): void {
  const s = document.documentElement.style;
  s.setProperty('--sat', `${t}px`);
  s.setProperty('--sar', `${r}px`);
  s.setProperty('--sab', `${b}px`);
  s.setProperty('--sal', `${l}px`);
}

export function installNativeHooks(onBack: () => boolean, onPause: () => void): void {
  window.__pwBack = onBack;
  window.__pwInsets = setInsets;
  window.__pwPause = onPause;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onPause();
  });
  // Browser fallback: treat the history back gesture as "back".
  if (!native) {
    history.pushState({ pw: 1 }, '');
    window.addEventListener('popstate', () => {
      onBack();
      history.pushState({ pw: 1 }, '');
    });
  }
}

export function keepAwake(on: boolean): void {
  if (native) safe(() => native.keepAwake(on), undefined);
  else if (on && 'wakeLock' in navigator) {
    (navigator as Navigator & { wakeLock: { request(t: string): Promise<unknown> } }).wakeLock.request('screen').catch(() => {});
  }
}

export function setImmersive(on: boolean): void {
  if (native) safe(() => native.setImmersive(on), undefined);
}

export function setHighRefresh(on: boolean): void {
  if (native) safe(() => native.setHighRefresh(on), undefined);
}

export function exitApp(): void {
  if (native) safe(() => native.exitApp(), undefined);
}

export function appVersion(): string {
  return native ? safe(() => native.appVersion(), 'android') : 'web';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Share (or download) a file such as a screenshot or GIF. */
export async function shareFile(blob: Blob, filename: string, text = ''): Promise<void> {
  if (native) {
    const b64 = await blobToBase64(blob);
    safe(() => native.shareFile(b64, blob.type, filename, text), undefined);
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return;
    } catch {
      /* fall through to download */
    }
  }
  download(blob, filename);
}

/** Save a file to the phone gallery (Pictures/PixelWars) or download it. */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  if (native) {
    const b64 = await blobToBase64(blob);
    return safe(() => native.saveToGallery(b64, blob.type, filename), false);
  }
  download(blob, filename);
  return true;
}

export async function shareText(text: string, title: string): Promise<void> {
  if (native) return safe(() => native.shareText(text, title), undefined);
  if (navigator.share) {
    try {
      await navigator.share({ text, title });
      return;
    } catch {
      /* ignore */
    }
  }
  await copyText(text);
}

export async function copyText(text: string): Promise<boolean> {
  if (native) {
    safe(() => native.copyText(text), undefined);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string> {
  if (native) return safe(() => native.readClipboard(), '');
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

export function nativeHaptic(name: string, strength: number): boolean {
  if (!native) return false;
  safe(() => native.haptic(name, strength), undefined);
  return true;
}

export function hasRichHaptics(): boolean {
  return native ? safe(() => native.hasRichHaptics(), false) : false;
}
