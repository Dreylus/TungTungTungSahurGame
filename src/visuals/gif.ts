/** Minimal animated GIF89a encoder for indexed frames (timelapse export). */

class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;
  push(b: number): void {
    if (this.len === this.buf.length) {
      const n = new Uint8Array(this.buf.length * 2);
      n.set(this.buf);
      this.buf = n;
    }
    this.buf[this.len++] = b;
  }
  word(w: number): void {
    this.push(w & 255);
    this.push((w >> 8) & 255);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i));
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function lzw(out: Bytes, idx: Uint8Array, minCode: number): void {
  out.push(minCode);
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  let block: number[] = [];
  let acc = 0, bits = 0;
  const flushBlock = () => {
    out.push(block.length);
    for (const b of block) out.push(b);
    block = [];
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block.push(acc & 255);
      if (block.length === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let cur = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = cur * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      cur = hit;
      continue;
    }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      codeSize = minCode + 1;
      dict = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits > 0) {
    block.push(acc & 255);
    if (block.length === 255) flushBlock();
  }
  if (block.length) flushBlock();
  out.push(0);
}

/**
 * frames: palette indices (w*h each). palette: RGB triplets (<= 256).
 * delayCs: per-frame delay in 1/100 s.
 */
export function encodeGif(frames: Uint8Array[], w: number, h: number, palette: [number, number, number][], delayCs = 6, lastDelayCs = 150): Uint8Array {
  let bitsPal = 1;
  while (1 << bitsPal < palette.length) bitsPal++;
  const size = 1 << bitsPal;
  const out = new Bytes();
  out.str('GIF89a');
  out.word(w);
  out.word(h);
  out.push(0x80 | ((bitsPal - 1) << 4) | (bitsPal - 1));
  out.push(0);
  out.push(0);
  for (let i = 0; i < size; i++) {
    const c = palette[i] ?? [0, 0, 0];
    out.push(c[0]);
    out.push(c[1]);
    out.push(c[2]);
  }
  // Loop forever.
  out.push(0x21);
  out.push(0xff);
  out.push(11);
  out.str('NETSCAPE2.0');
  out.push(3);
  out.push(1);
  out.word(0);
  out.push(0);
  const minCode = Math.max(2, bitsPal);
  frames.forEach((f, i) => {
    out.push(0x21);
    out.push(0xf9);
    out.push(4);
    out.push(0);
    out.word(i === frames.length - 1 ? lastDelayCs : delayCs);
    out.push(0);
    out.push(0);
    out.push(0x2c);
    out.word(0);
    out.word(0);
    out.word(w);
    out.word(h);
    out.push(0);
    lzw(out, f, minCode);
  });
  out.push(0x3b);
  return out.out();
}
