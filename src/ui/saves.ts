/** Saved setups: 10+ slots, built-in templates, export / import. */
import { algoName } from '../algorithms/registry.ts';
import { ARENA_SHAPES, buildArena, computeSpawns } from '../arenas/arenas.ts';
import { applyPreset, PRESET_BY_ID, PRESETS } from '../engine/setup.ts';
import type { MatchConfig } from '../engine/types.ts';
import { copyText, readClipboard, shareText } from '../native/bridge.ts';
import { haptic } from '../native/haptics.ts';
import { addSlot, exportConfig, getLastConfig, getSlots, importConfig, settings, writeSlot, type SaveSlot } from '../saves/store.ts';
import { maskCanvas } from '../visuals/thumbs.ts';
import { button, clear, confirmDialog, h, pickFile, promptDialog, sheet, toast } from './dom.ts';
import { topbar } from './common.ts';
import { nav } from './nav.ts';
import { push, type Screen } from './router.ts';


/** Arena + spawn preview thumbnail for a config. */
export function configThumb(cfg: MatchConfig, size = 160): string {
  try {
    const a = buildArena({ ...cfg.arena, size: Math.min(cfg.arena.size, 192) }, cfg.seed);
    const sp = computeSpawns(a.mask, a.W, a.H, cfg.fighters, cfg.arena.spawnLayout, cfg.seed);
    return maskCanvas(a.mask, a.W, a.H, size, sp, cfg.fighters.map((f) => f.color)).toDataURL('image/png');
  } catch {
    return '';
  }
}

export function summary(cfg: MatchConfig): string {
  const shape = ARENA_SHAPES.find((s) => s.id === cfg.arena.shape)?.name ?? cfg.arena.shape;
  const p = PRESET_BY_ID[cfg.mode];
  return `${cfg.fighters.length} fighters · ${shape} ${cfg.arena.size} · ${p?.name ?? 'Sandbox'}`;
}

function dateStr(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function slotCard(i: number, slot: SaveSlot | null, onClick: () => void): HTMLElement {
  const th = h('div', { class: 'th', style: slot?.thumb ? `background-image:url(${slot.thumb})` : '' }, slot ? '' : '＋');
  return h('div', { class: `save ${slot ? '' : 'empty'}`, onclick: () => (haptic('tap'), onClick()) },
    h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
    th,
    h('div', { class: 'meta' }, h('b', null, slot ? slot.name : 'Empty slot'), h('span', null, slot ? dateStr(slot.savedAt) : 'Tap to save here')),
  );
}

/** Pick a slot and save cfg there (used by setup and end-of-match). */
export async function saveToSlotDialog(cfg: MatchConfig, thumb?: string): Promise<void> {
  const slots = getSlots();
  const grid = h('div', { class: 'slots' });
  const s = sheet('Save setup to…', grid, [button('＋ More slots', () => {
    addSlot();
    s.close();
    void saveToSlotDialog(cfg, thumb);
  })]);
  slots.forEach((slot, i) => {
    grid.appendChild(
      slotCard(i, slot, async () => {
        if (slot && !(await confirmDialog('Overwrite slot?', `“${slot.name}” will be replaced.`, 'Overwrite', true))) return;
        const name = await promptDialog('Name this setup', slot?.name ?? cfg.name ?? `Setup ${i + 1}`);
        if (name === null) return;
        const ok = writeSlot(i, { name: name.trim() || `Setup ${i + 1}`, savedAt: Date.now(), config: { ...cfg, name: name.trim() || cfg.name }, thumb: thumb || configThumb(cfg) });
        s.close();
        haptic(ok ? 'success' : 'error');
        toast(ok ? `Saved to slot ${i + 1}` : 'Storage is full — delete a slot or remove images');
      }),
    );
  });
}

export async function importDialog(onDone: (cfg: MatchConfig) => void): Promise<void> {
  const ta = h('textarea', { placeholder: 'Paste a PW1:… share code or setup JSON' }) as HTMLTextAreaElement;
  const s = sheet('Import setup', [
    ta,
    h('div', { class: 'row', style: 'margin-top:8px' },
      button('📋 Paste', async () => {
        ta.value = await readClipboard();
        if (!ta.value) toast('Clipboard is empty — long-press the box to paste');
      }, 'small'),
      button('📁 From file', async () => {
        const f = await pickFile('.json,.txt,application/json,text/plain');
        if (f) ta.value = await f.text();
      }, 'small'),
    ),
  ], [
    button('Cancel', () => s.close()),
    button('Import', async () => {
      try {
        const cfg = await importConfig(ta.value);
        s.close();
        haptic('success');
        onDone(cfg);
      } catch (e) {
        haptic('error');
        toast('That code could not be read');
        console.warn(e);
      }
    }, 'primary'),
  ]);
}

export async function exportDialog(cfg: MatchConfig): Promise<void> {
  const withImg = await exportConfig(cfg, { images: true });
  const noImg = await exportConfig(cfg, { images: false });
  const big = withImg.length > 12000;
  let code = big ? noImg : withImg;
  const ta = h('textarea', { readonly: true }) as HTMLTextAreaElement;
  ta.value = code;
  const info = h('p', { class: 'hint' }, big ? `Custom images left out to keep the code short (${(withImg.length / 1024).toFixed(0)} KB with images).` : `${code.length} characters.`);
  const s = sheet('Share setup', [
    ta,
    info,
    big
      ? button('Include images anyway', () => {
          code = withImg;
          ta.value = code;
          info.textContent = `${(code.length / 1024).toFixed(0)} KB with images.`;
        }, 'small')
      : null,
  ], [
    button('Copy', async () => {
      await copyText(code);
      haptic('success');
      toast('Copied — send it to a friend');
    }),
    button('Share', () => {
      void shareText(code, `PIXEL WARS setup: ${cfg.name}`);
      s.close();
    }, 'primary'),
  ]);
}

export function savesScreen(): Screen {
  const body = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' },
    topbar('Saved setups', button('Import', () => void importDialog((cfg) => nav.setup(cfg)), 'small')),
    body,
  );
  const render = () => {
    clear(body);
    // Templates.
    const tgrid = h('div', { class: 'slots' });
    for (const p of PRESETS) {
      const cfg = applyPreset({ ...getLastConfig(), name: p.name }, p.id);
      tgrid.appendChild(
        h('div', { class: 'save template', onclick: () => (haptic('tap'), templateSheet(cfg, p.name, p.desc)) },
          h('span', { class: 'num' }, 'PRESET'),
          h('div', { class: 'th', style: 'font-size:46px' }, p.icon),
          h('div', { class: 'meta' }, h('b', null, p.name), h('span', null, p.desc)),
        ),
      );
    }
    body.appendChild(h('div', { class: 'section' }, h('h2', null, 'Templates', h('span', { class: 'grow' }), h('span', { class: 'kbd' }, 'built-in')), tgrid));
    // Slots.
    const slots = getSlots();
    const grid = h('div', { class: 'slots' });
    slots.forEach((slot, i) => grid.appendChild(slotCard(i, slot, () => (slot ? slotSheet(i, slot, render) : saveCurrent(i, render)))));
    body.appendChild(
      h('div', { class: 'section' },
        h('h2', null, `Slots (${slots.filter(Boolean).length}/${slots.length})`, h('span', { class: 'grow' }), button('＋ Add slots', () => {
          addSlot();
          render();
        }, 'small')),
        grid,
        h('p', { class: 'hint' }, 'Each slot keeps the arena, fighters, spawns, rules, speed, seed and images. Visual and audio settings are global.'),
      ),
    );
  };
  render();
  return { el, onShow: render };
}

function templateSheet(cfg: MatchConfig, name: string, desc: string): void {
  const s = sheet(name, h('p', { class: 'hint', style: 'font-size:15px' }, desc + ' Uses your current fighters and arena.'), [
    button('Edit', () => {
      s.close();
      nav.setup(cfg);
    }),
    button('▶ Play', () => {
      s.close();
      nav.match(cfg);
    }, 'primary'),
  ]);
}

async function saveCurrent(i: number, rerender: () => void): Promise<void> {
  const cfg = getLastConfig();
  const name = await promptDialog(`Save current setup to slot ${i + 1}`, cfg.name || `Setup ${i + 1}`);
  if (name === null) return;
  const ok = writeSlot(i, { name: name || `Setup ${i + 1}`, savedAt: Date.now(), config: { ...cfg, name }, thumb: configThumb(cfg) });
  haptic(ok ? 'success' : 'error');
  toast(ok ? 'Saved' : 'Storage is full');
  rerender();
}

function slotSheet(i: number, slot: SaveSlot, rerender: () => void): void {
  const cfg = slot.config;
  const list = h('div', { class: 'hint', style: 'margin-bottom:8px' }, summary(cfg), h('br'), cfg.fighters.map((f) => algoName(f)).join(' · '), h('br'), `Seed ${cfg.seed}`);
  const act = (label: string, fn: () => void, cls = '') =>
    button(label, () => {
      s.close();
      fn();
    }, `${cls}`);
  const s = sheet(slot.name, [
    slot.thumb ? h('img', { src: slot.thumb, style: 'width:120px;border-radius:12px;image-rendering:pixelated;float:right;margin-left:10px' }) : null,
    list,
    h('div', { style: 'clear:both' }),
    h('div', { class: 'row wrap' },
      act('✏️ Edit', () => nav.setup(cfg)),
      act('📝 Overwrite', async () => {
        if (!(await confirmDialog('Overwrite with current setup?', 'The setup you last played or edited will replace this slot.', 'Overwrite', true))) return;
        const cur = getLastConfig();
        writeSlot(i, { ...slot, savedAt: Date.now(), config: { ...cur, name: slot.name }, thumb: configThumb(cur) });
        toast('Overwritten');
        rerender();
      }),
      act('🏷 Rename', async () => {
        const n = await promptDialog('Rename', slot.name);
        if (n === null) return;
        writeSlot(i, { ...slot, name: n || slot.name, config: { ...cfg, name: n || slot.name } });
        rerender();
      }),
      act('⧉ Duplicate', () => {
        const slots = getSlots();
        let j = slots.findIndex((x, k) => !x && k !== i);
        if (j < 0) {
          addSlot();
          j = slots.length;
        }
        writeSlot(j, { ...slot, name: `${slot.name} copy`, savedAt: Date.now() });
        toast(`Duplicated to slot ${j + 1}`);
        rerender();
      }),
      act('📤 Export', () => void exportDialog(cfg)),
      act('🗑 Delete', async () => {
        if (!(await confirmDialog('Delete this setup?', `“${slot.name}” will be removed.`, 'Delete', true))) return;
        writeSlot(i, null);
        haptic('success');
        rerender();
      }, 'danger'),
    ),
  ], [act('▶ Play', () => nav.match(cfg), 'primary')]);
  void settings;
}

export function openSaves(): void {
  push(savesScreen());
}
