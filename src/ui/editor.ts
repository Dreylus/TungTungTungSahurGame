/** Arena paint tool (walls / holes / floor with symmetry) and manual spawn placement. */
import { algoName } from '../algorithms/registry.ts';
import { arenaDims, buildArena, computeSpawns, decodeMask, encodeMask, P_FLOOR, P_HOLE, P_NONE, P_WALL, scaleMask } from '../arenas/arenas.ts';
import { EMPTY, VOID, WALL, type MatchConfig } from '../engine/types.ts';
import { haptic } from '../native/haptics.ts';
import { settings } from '../saves/store.ts';
import { hexToRgb, slotColor } from '../visuals/palette.ts';
import { topbar } from './common.ts';
import { avatarStyle, button, chips, clear, h, slider } from './dom.ts';
import { pop, push } from './router.ts';

type PaintTool = 'wall' | 'hole' | 'floor' | 'erase';
type Sym = 'none' | 'x' | 'y' | 'quad' | 'rot';

export function openEditor(cfgIn: MatchConfig, mode: 'paint' | 'spawns', onDone: (cfg: MatchConfig) => void): void {
  const cfg: MatchConfig = JSON.parse(JSON.stringify(cfgIn));
  const [W, H] = arenaDims(cfg.arena.size, cfg.arena.aspect);
  const N = W * H;
  let paint: Uint8Array = new Uint8Array(N);
  if (cfg.arena.paint && cfg.arena.paintW && cfg.arena.paintH) {
    paint = new Uint8Array(scaleMask(decodeMask(cfg.arena.paint, cfg.arena.paintW * cfg.arena.paintH), cfg.arena.paintW, cfg.arena.paintH, W, H));
  }
  const base = buildArena({ ...cfg.arena, obstacles: cfg.arena.obstacles === 'random' ? 'random' : 'none', paint: undefined }, cfg.seed).mask;
  const colors = cfg.fighters.map((f, i) => slotColor(f.color, i, settings.palette));
  let tool: PaintTool = 'wall';
  let sym: Sym = 'none';
  let brush = Math.max(1, Math.round(Math.max(W, H) / 64));
  let slot = 0;
  const undo: Uint8Array[] = [];

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const og = off.getContext('2d')!;
  const img = og.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  const u32 = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  };
  const C_FLOOR = u32('#1c2133'), C_WALL = u32('#6b6476'), C_VOID = u32('#05060a');
  const cellVal = (i: number) => {
    const p = paint[i];
    if (p === P_WALL) return WALL;
    if (p === P_HOLE) return VOID;
    if (p === P_FLOOR) return EMPTY;
    return base[i];
  };
  const redraw = (x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const v = cellVal(i);
        px[i] = v === WALL ? C_WALL : v === VOID ? C_VOID : C_FLOOR;
      }
    og.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    present();
  };

  const canvas = h('canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const stage = h('div', { class: 'stage' }, canvas);
  let dpr = 1, scale = 1;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const s = Math.min((r.width - 28) / W, (r.height - 12) / H);
    canvas.style.width = `${Math.floor(W * s)}px`;
    canvas.style.height = `${Math.floor(H * s)}px`;
    canvas.width = Math.floor(W * s * dpr);
    canvas.height = Math.floor(H * s * dpr);
    scale = canvas.width / W;
    present();
  };
  const spawnsNow = () => {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = cellVal(i);
    return computeSpawns(mask, W, H, cfg.fighters, mode === 'spawns' ? 'manual' : cfg.arena.spawnLayout, cfg.seed);
  };
  const present = () => {
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(off, 0, 0, canvas.width, canvas.height);
    const sp = spawnsNow();
    sp.forEach((s, i) => {
      if (s < 0) return;
      const x = ((s % W) + 0.5) * scale, y = (Math.floor(s / W) + 0.5) * scale;
      const r = Math.max(7 * dpr, scale * 1.5);
      const manual = !!cfg.fighters[i].spawn;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = colors[i];
      g.globalAlpha = mode === 'spawns' && !manual ? 0.45 : 1;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2 * dpr;
      g.strokeStyle = i === slot && mode === 'spawns' ? '#fff' : '#000';
      g.stroke();
      g.fillStyle = '#07080f';
      g.font = `900 ${Math.round(r)}px system-ui`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), x, y + 1);
    });
  };

  const mirror = (x: number, y: number): [number, number][] => {
    const out: [number, number][] = [[x, y]];
    const mx = W - 1 - x, my = H - 1 - y;
    if (sym === 'x' || sym === 'quad') out.push([mx, y]);
    if (sym === 'y' || sym === 'quad') out.push([x, my]);
    if (sym === 'quad') out.push([mx, my]);
    if (sym === 'rot') {
      const cx = (W - 1) / 2, cy = (H - 1) / 2, dx = x - cx, dy = y - cy;
      const k = H / W;
      out.push([Math.round(cx - dy / k), Math.round(cy + dx * k)], [mx, my], [Math.round(cx + dy / k), Math.round(cy - dx * k)]);
    }
    return out;
  };
  const value = () => (tool === 'wall' ? P_WALL : tool === 'hole' ? P_HOLE : tool === 'floor' ? P_FLOOR : P_NONE);
  const dab = (gx: number, gy: number) => {
    const r = brush - 0.5, v = value();
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const [cx, cy] of mirror(Math.floor(gx), Math.floor(gy))) {
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          paint[y * W + x] = v;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    }
    if (x1 >= 0) redraw(x0, y0, x1, y1);
  };
  const toGrid = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  let painting = false, lastG: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [gx, gy] = toGrid(e);
    if (mode === 'spawns') {
      const x = Math.floor(gx), y = Math.floor(gy);
      if (x < 0 || y < 0 || x >= W || y >= H || cellVal(y * W + x) !== EMPTY) {
        haptic('error');
        return;
      }
      cfg.fighters[slot].spawn = [x, y];
      haptic('spawn');
      slot = (slot + 1) % cfg.fighters.length;
      renderPanel();
      present();
      return;
    }
    undo.push(paint.slice());
    if (undo.length > 25) undo.shift();
    painting = true;
    lastG = [gx, gy];
    dab(gx, gy);
    haptic('paint');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const [gx, gy] = toGrid(e);
    // Interpolate so fast strokes stay continuous.
    const [lx, ly] = lastG ?? [gx, gy];
    const steps = Math.max(1, Math.ceil(Math.hypot(gx - lx, gy - ly) / Math.max(0.5, brush * 0.5)));
    for (let k = 1; k <= steps; k++) dab(lx + ((gx - lx) * k) / steps, ly + ((gy - ly) * k) / steps);
    lastG = [gx, gy];
    haptic('paint', 0.3);
  });
  const end = () => {
    painting = false;
    lastG = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const panel = h('div', { class: 'panel' });
  const renderPanel = () => {
    clear(panel);
    if (mode === 'paint') {
      panel.append(
        chips<PaintTool>([{ id: 'wall', label: '🧱 Wall' }, { id: 'hole', label: '🕳 Hole' }, { id: 'floor', label: '⬜ Floor' }, { id: 'erase', label: '🧽 Erase' }], tool, (t) => (tool = t)),
        chips<Sym>([{ id: 'none', label: 'No mirror' }, { id: 'x', label: '↔ Mirror' }, { id: 'y', label: '↕ Mirror' }, { id: 'quad', label: '✚ Quad' }, { id: 'rot', label: '⟳ Rotate' }], sym, (s) => (sym = s)),
        slider('Brush', 1, Math.max(8, Math.round(Math.max(W, H) / 12)), 1, brush, (v) => `${v}`, (v) => (brush = v)),
        h('div', { class: 'row' },
          button('↶ Undo', () => {
            const u = undo.pop();
            if (u) {
              paint = u;
              redraw();
            }
          }, 'small'),
          button('Clear', () => {
            undo.push(paint.slice());
            paint.fill(0);
            redraw();
          }, 'small'),
          button('Fill walls', () => {
            undo.push(paint.slice());
            paint.fill(P_WALL);
            redraw();
          }, 'small'),
          h('div', { class: 'grow' }),
          button('Done', done, 'primary'),
        ),
      );
    } else {
      const row = h('div', { class: 'tools', style: 'background:none;border:none;padding:0' });
      cfg.fighters.forEach((f, i) => {
        const d = h('div', { class: `dotc ${i === slot ? 'on' : ''}`, style: avatarStyle(colors[i], f.image), title: algoName(f) });
        d.addEventListener('click', () => {
          slot = i;
          haptic('select');
          renderPanel();
          present();
        });
        row.appendChild(d);
      });
      panel.append(
        h('div', { class: 'hint', style: 'margin:0' }, `Tap the arena to place ${algoName(cfg.fighters[slot])} (#${slot + 1}).`),
        row,
        h('div', { class: 'row' },
          button('Reset all', () => {
            cfg.fighters.forEach((f) => delete f.spawn);
            present();
          }, 'small'),
          h('div', { class: 'grow' }),
          button('Done', done, 'primary'),
        ),
      );
    }
  };
  function done(): void {
    if (mode === 'paint') {
      const any = paint.some((v) => v !== 0);
      cfg.arena.paint = any ? encodeMask(paint) : undefined;
      cfg.arena.paintW = any ? W : undefined;
      cfg.arena.paintH = any ? H : undefined;
    } else cfg.arena.spawnLayout = 'manual';
    haptic('success');
    onDone(cfg);
    pop();
  }
  renderPanel();
  const el = h('div', { class: 'screen editor' }, topbar(mode === 'paint' ? 'Paint arena' : 'Place spawns'), stage, panel);
  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  push({
    el,
    onShow: () => {
      redraw();
      fit();
    },
    onDestroy: () => ro.disconnect(),
  });
}
