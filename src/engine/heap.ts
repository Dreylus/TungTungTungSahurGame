/** Binary min-heap of (float key, int value) pairs backed by typed arrays. */
export class MinHeap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  lastKey = 0;
  constructor(cap = 256) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  clear(): void {
    this.size = 0;
  }
  private grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    k.set(this.keys);
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }
  push(key: number, val: number): void {
    if (this.size === this.keys.length) this.grow();
    const keys = this.keys, vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  peekKey(): number {
    return this.size ? this.keys[0] : Infinity;
  }
  /** Removes the minimum; returns its value and stores its key in lastKey. */
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n], val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

/** Growable int queue (FIFO) with amortised compaction. */
export class IntQueue {
  buf: Int32Array;
  head = 0;
  tail = 0;
  constructor(cap = 256) {
    this.buf = new Int32Array(cap);
  }
  get length(): number {
    return this.tail - this.head;
  }
  clear(): void {
    this.head = this.tail = 0;
  }
  push(v: number): void {
    if (this.tail === this.buf.length) {
      const live = this.tail - this.head;
      if (this.head > live) {
        this.buf.copyWithin(0, this.head, this.tail);
      } else {
        const nb = new Int32Array(this.buf.length * 2);
        nb.set(this.buf.subarray(this.head, this.tail));
        this.buf = nb;
      }
      this.head = 0;
      this.tail = live;
    }
    this.buf[this.tail++] = v;
  }
  shift(): number {
    return this.buf[this.head++];
  }
}
