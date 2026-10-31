/** Settings: audio, haptics, visuals, accessibility, performance, data. */
import { ALGOS } from '../algorithms/registry.ts';
import { audio } from '../audio/audio.ts';
import { appVersion, hasRichHaptics, isNativeApp } from '../native/bridge.ts';
import { haptic, type HapticName } from '../native/haptics.ts';
import { DEFAULT_SETTINGS, saveSettings, setSlots, settings, type ShaderStyle } from '../saves/store.ts';
import { topbar } from './common.ts';
import { button, chips, clear, confirmDialog, h, section, slider, toast, toggleRow } from './dom.ts';
import { push } from './router.ts';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function openSettings(): void {
  const body = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, topbar('Settings'), body);
  const render = () => {
    clear(body);
    const s = settings;
    const mutes = h('div', { class: 'chips' });
    for (const a of ALGOS) {
      const on = !s.mutedAlgos.includes(a.id);
      mutes.appendChild(
        h('button', {
          class: `chip ${on ? 'on' : ''}`,
          style: on ? `background:${a.color};border-color:${a.color}` : '',
          onclick: () => {
            const list = on ? [...s.mutedAlgos, a.id] : s.mutedAlgos.filter((x) => x !== a.id);
            saveSettings({ mutedAlgos: list });
            haptic('select');
            render();
          },
        }, `${on ? '🔊' : '🔇'} ${a.name}`),
      );
    }
    const feel: { id: HapticName; label: string }[] = [
      { id: 'tap', label: 'Tap' },
      { id: 'clash', label: 'Clash' },
      { id: 'pulse', label: 'Pulse' },
      { id: 'capture', label: 'Capture' },
      { id: 'bigCapture', label: 'Encircle' },
      { id: 'bolt', label: 'Bolt' },
      { id: 'meteor', label: 'Meteor' },
      { id: 'elim', label: 'Elimination' },
      { id: 'victory', label: 'Victory' },
    ];
    const feelRow = h('div', { class: 'chips' });
    for (const f of feel) feelRow.appendChild(h('button', { class: 'chip', onclick: () => haptic(f.id, 1) }, f.label));
    body.append(
      section('Sound',
        slider('Master volume', 0, 1, 0.01, s.master, pct, (v) => (saveSettings({ master: v }), audio.apply())),
        slider('Music', 0, 1, 0.01, s.music, pct, (v) => (saveSettings({ music: v }), audio.apply())),
        slider('Effects', 0, 1, 0.01, s.sfx, pct, (v) => (saveSettings({ sfx: v }), audio.apply())),
        h('div', { class: 'lbl', style: 'margin:10px 0 8px' }, 'Per-fighter sound', h('small', null, 'Each fighter has its own instrument')),
        mutes,
      ),
      section('Haptics',
        toggleRow('Haptics', isNativeApp ? (hasRichHaptics() ? 'Rich haptics: Pixel composition primitives ✓' : 'Basic vibration on this device') : 'Uses the browser vibration API', s.haptics, (v) => saveSettings({ haptics: v })),
        slider('Strength', 0.1, 1, 0.05, s.hapticStrength, pct, (v) => saveSettings({ hapticStrength: v })),
        toggleRow('Battle haptics', 'Feel clashes, pulses, captures and meteors', s.battleHaptics, (v) => saveSettings({ battleHaptics: v })),
        h('div', { class: 'lbl', style: 'margin:10px 0 8px' }, 'Try them'),
        feelRow,
      ),
      section('Visuals',
        toggleRow('Visual Masterpiece mode', 'Glowing frontiers, bloom, trails, particles', s.masterpiece, (v) => saveSettings({ masterpiece: v })),
        h('div', { class: 'lbl', style: 'margin:10px 0 8px' }, 'Shader style'),
        chips<ShaderStyle>([{ id: 'none', label: 'Clean' }, { id: 'neon', label: 'Neon' }, { id: 'crt', label: 'CRT' }, { id: 'watercolor', label: 'Watercolor' }, { id: 'ink', label: 'Ink' }], s.style, (v) => saveSettings({ style: v })),
        slider('Bloom', 0, 1.5, 0.05, s.bloom, pct, (v) => saveSettings({ bloom: v })),
        toggleRow('Growth trails', 'Fresh pixels glow, then cool down', s.trails, (v) => saveSettings({ trails: v })),
        toggleRow('Age gradient', 'Older territory gets deeper', s.ageGradient, (v) => saveSettings({ ageGradient: v })),
        toggleRow('Pulsing shading', null, s.pulse, (v) => saveSettings({ pulse: v })),
        toggleRow('Particles & sparks', 'At conflict lines and captures', s.particles, (v) => saveSettings({ particles: v })),
        toggleRow('Heat map overlay', 'Shows growth speed', s.heat, (v) => saveSettings({ heat: v })),
        toggleRow('Slow motion on big captures', null, s.slowmo, (v) => saveSettings({ slowmo: v })),
        toggleRow('Fighter badges', 'Avatars follow each territory', s.avatars, (v) => saveSettings({ avatars: v })),
      ),
      section('Accessibility',
        h('div', { class: 'lbl', style: 'margin:0 0 8px' }, 'Palette'),
        chips([{ id: 'vivid', label: 'Vivid' }, { id: 'colorblind', label: 'Colorblind-safe' }, { id: 'contrast', label: 'High contrast' }], s.palette, (v) => saveSettings({ palette: v as typeof s.palette })),
        toggleRow('Pattern overlays', 'Stripes, dots and checks per fighter, not only color', s.patterns, (v) => saveSettings({ patterns: v })),
        toggleRow('Reduced motion', 'No shake, slow-mo, pulsing or auto camera', s.reducedMotion, (v) => saveSettings({ reducedMotion: v })),
      ),
      section('Performance',
        toggleRow('High refresh rate', 'Run at your Pixel’s full 90/120 Hz', s.highRefresh, (v) => saveSettings({ highRefresh: v })),
        toggleRow('Keep screen on during matches', null, s.keepAwake, (v) => saveSettings({ keepAwake: v })),
        toggleRow('Show FPS', null, s.showFps, (v) => saveSettings({ showFps: v })),
      ),
      section('Data',
        h('div', { class: 'row wrap' },
          button('Reset settings', async () => {
            if (!(await confirmDialog('Reset settings?', 'Sound, haptics and visual settings go back to defaults.', 'Reset'))) return;
            saveSettings({ ...DEFAULT_SETTINGS, firstRun: false });
            audio.apply();
            render();
          }, 'small'),
          button('Delete all saves', async () => {
            if (!(await confirmDialog('Delete all saved setups?', 'All 10+ slots will be cleared. Templates stay.', 'Delete all', true))) return;
            setSlots([]);
            toast('All slots cleared');
          }, 'small danger'),
        ),
      ),
      section('About',
        h('p', { class: 'hint', style: 'margin:0' }, `PIXEL WARS: Algorithm Battlegrounds · ${appVersion()}`),
        h('p', { class: 'hint' }, 'Every match is seeded: the same seed and setup always replay the same battle. Made for Google Pixel — runs anywhere.'),
      ),
    );
  };
  render();
  push({ el });
}
