/** 5x7 pixel font for titles, drawn onto a small canvas and scaled up. */
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12], '!': [4, 4, 4, 4, 4, 0, 4], ':': [0, 4, 4, 0, 4, 4, 0],
  '-': [0, 0, 0, 31, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0, 4],
};

const STOPS = ['#4df3ff', '#7c8bff', '#a259ff', '#ff4fd8'];

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function pixelText(text: string, opts: { lines?: boolean; stops?: string[] } = {}): HTMLCanvasElement {
  const stops = opts.stops ?? STOPS;
  const lines = text.toUpperCase().split('\n');
  const cols = Math.max(...lines.map((l) => l.length)) * 6 - 1;
  const rows = lines.length * 9 - 2;
  const c = document.createElement('canvas');
  c.width = cols + 2;
  c.height = rows + 2;
  const g = c.getContext('2d')!;
  const color = (x: number) => {
    const t = x / Math.max(1, cols - 1);
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    return lerpHex(stops[seg], stops[seg + 1], t * (stops.length - 1) - seg);
  };
  lines.forEach((line, li) => {
    const ox = Math.floor((cols - (line.length * 6 - 1)) / 2);
    for (let k = 0; k < line.length; k++) {
      const glyph = FONT[line[k]] ?? FONT[' '];
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 5; x++) {
          if (!(glyph[y] & (16 >> x))) continue;
          const px = ox + k * 6 + x, py = li * 9 + y;
          g.fillStyle = 'rgba(20,10,40,0.9)';
          g.fillRect(px + 1, py + 1, 1, 1);
          g.fillStyle = color(px);
          g.fillRect(px, py, 1, 1);
        }
    }
  });
  return c;
}
