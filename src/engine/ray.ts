/**
 * 4-connected grid ray (Amanatides & Woo traversal). Each call to next()
 * moves exactly one cell horizontally or vertically, so the lines drawn by
 * line-based fighters are always 4-connected territory.
 */
export class Ray {
  cx = 0;
  cy = 0;
  ang = 0;
  private stepX = 0;
  private stepY = 0;
  private tMaxX = 0;
  private tMaxY = 0;
  private tDX = 0;
  private tDY = 0;

  constructor(cx = 0, cy = 0, ang = 0) {
    this.aim(cx, cy, ang);
  }

  /** Restart the ray from the centre of cell (cx, cy) heading `ang` radians. */
  aim(cx: number, cy: number, ang: number): this {
    this.cx = cx;
    this.cy = cy;
    this.ang = ang;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    this.stepX = dx > 0 ? 1 : -1;
    this.stepY = dy > 0 ? 1 : -1;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    this.tDX = adx < 1e-9 ? Infinity : 1 / adx;
    this.tDY = ady < 1e-9 ? Infinity : 1 / ady;
    this.tMaxX = this.tDX * 0.5;
    this.tMaxY = this.tDY * 0.5;
    return this;
  }

  /** Advance one cell. Coordinates are not wrapped or bounds-checked. */
  next(): void {
    if (this.tMaxX < this.tMaxY) {
      this.tMaxX += this.tDX;
      this.cx += this.stepX;
    } else {
      this.tMaxY += this.tDY;
      this.cy += this.stepY;
    }
  }
}
