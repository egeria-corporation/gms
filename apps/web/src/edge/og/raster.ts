// SPDX-License-Identifier: AGPL-3.0-only
// An RGB canvas that fills anti-aliased paths, for the share cards. Coverage is computed by
// signed-area accumulation (the method of font-rs): each edge adds its exact area to a row buffer
// and a running sum gives each pixel's coverage, with overlapping shapes clamped to full.
import type { Font } from "./font.ts";

export type Rgb = readonly [number, number, number];

/** "#29A79F" → [41, 167, 159]. */
export const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A path flattened to straight edges as it is built. */
export class Path {
  readonly edges: number[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;

  private add(x: number, y: number) {
    if (y !== this.y) this.edges.push(this.x, this.y, x, y);
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
    this.x = x;
    this.y = y;
  }

  moveTo(x: number, y: number) {
    this.close();
    this.x = this.startX = x;
    this.y = this.startY = y;
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  lineTo(x: number, y: number) {
    this.add(x, y);
  }

  quadTo(cx: number, cy: number, x: number, y: number) {
    const [x0, y0] = [this.x, this.y];
    const ddx = x0 - 2 * cx + x;
    const ddy = y0 - 2 * cy + y;
    const dev = ddx * ddx + ddy * ddy;
    const n = dev < 0.333 ? 1 : 1 + Math.floor(Math.sqrt(Math.sqrt(3 * dev)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      this.add(mt * mt * x0 + 2 * mt * t * cx + t * t * x, mt * mt * y0 + 2 * mt * t * cy + t * t * y);
    }
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const [x0, y0] = [this.x, this.y];
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      const [a, b, c, d] = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t];
      this.add(a * x0 + b * c1x + c * c2x + d * x, a * y0 + b * c1y + c * c2y + d * y);
    }
  }

  close() {
    if (this.x !== this.startX || this.y !== this.startY) this.add(this.startX, this.startY);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number) {
    const k = 0.5523 * r;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.cubicTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.cubicTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    this.lineTo(x, y + r);
    this.cubicTo(x, y + r - k, x + r - k, y, x + r, y);
    this.close();
  }
}

/** Adds one edge's signed area to the coverage buffer (rows of `stride` cells). */
function edge(a: Float32Array, stride: number, rows: number, x0: number, y0: number, x1: number, y1: number) {
  let dir = 1;
  if (y0 > y1) {
    dir = -1;
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  if (y0 < 0) x -= y0 * dxdy;
  const end = Math.min(rows, Math.ceil(y1));
  for (let y = Math.max(0, Math.floor(y0)); y < end; y++) {
    const row = y * stride;
    const dy = Math.min(y + 1, y1) - Math.max(y, y0);
    const xnext = x + dxdy * dy;
    const d = dy * dir;
    const lo = Math.min(x, xnext);
    const hi = Math.max(x, xnext);
    const loFloor = Math.floor(lo);
    const loI = loFloor;
    const hiCeil = Math.ceil(hi);
    const hiI = hiCeil;
    if (hiI <= loI + 1) {
      const xmf = 0.5 * (x + xnext) - loFloor;
      a[row + loI]! += d - d * xmf;
      a[row + loI + 1]! += d * xmf;
    } else {
      const s = 1 / (hi - lo);
      const x0f = lo - loFloor;
      const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
      const x1f = hi - hiCeil + 1;
      const am = 0.5 * s * x1f * x1f;
      a[row + loI]! += d * a0;
      if (hiI === loI + 2) {
        a[row + loI + 1]! += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - x0f);
        a[row + loI + 1]! += d * (a1 - a0);
        for (let xi = loI + 2; xi < hiI - 1; xi++) a[row + xi]! += d * s;
        const a2 = a1 + (hiI - loI - 3) * s;
        a[row + hiI - 1]! += d * (1 - a2 - am);
      }
      a[row + hiI]! += d * am;
    }
    x = xnext;
  }
}

export interface Rgba {
  width: number;
  height: number;
  /** Straight (not premultiplied) RGBA, 4 bytes a pixel. */
  pixels: Uint8Array;
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  /** RGB, 3 bytes a pixel, rows top to bottom. */
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  private blend(i: number, c: Rgb, alpha: number) {
    const d = this.data;
    d[i] = d[i]! + (c[0] - d[i]!) * alpha + 0.5;
    d[i + 1] = d[i + 1]! + (c[1] - d[i + 1]!) * alpha + 0.5;
    d[i + 2] = d[i + 2]! + (c[2] - d[i + 2]!) * alpha + 0.5;
  }

  /** Each row one colour, from `top` to `bottom`. */
  verticalGradient(top: Rgb, bottom: Rgb) {
    for (let y = 0; y < this.height; y++) {
      const t = this.height > 1 ? y / (this.height - 1) : 0;
      const c = [0, 1, 2].map((k) => Math.round(top[k]! + (bottom[k]! - top[k]!) * t));
      for (let x = 0, i = y * this.width * 3; x < this.width; x++, i += 3) {
        this.data[i] = c[0]!;
        this.data[i + 1] = c[1]!;
        this.data[i + 2] = c[2]!;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb) {
    const x0 = Math.max(0, Math.round(x));
    const x1 = Math.min(this.width, Math.round(x + w));
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.height, Math.round(y + h)); yy++) {
      for (let xx = x0, i = (yy * this.width + x0) * 3; xx < x1; xx++, i += 3) {
        this.data[i] = c[0];
        this.data[i + 1] = c[1];
        this.data[i + 2] = c[2];
      }
    }
  }

  /** Fills the path (non-zero winding, anti-aliased). */
  fill(path: Path, c: Rgb) {
    if (!path.edges.length) return;
    const left = Math.max(0, Math.floor(path.minX));
    const right = Math.min(this.width, Math.ceil(path.maxX) + 1);
    const top = Math.max(0, Math.floor(path.minY));
    const bottom = Math.min(this.height, Math.ceil(path.maxY) + 1);
    const w = right - left;
    const rows = bottom - top;
    if (w <= 0 || rows <= 0) return;
    const stride = w + 3;
    const cover = new Float32Array(stride * rows);
    const e = path.edges;
    const cx = (x: number) => Math.min(w, Math.max(0, x - left));
    for (let i = 0; i < e.length; i += 4) edge(cover, stride, rows, cx(e[i]!), e[i + 1]! - top, cx(e[i + 2]!), e[i + 3]! - top);
    for (let y = 0; y < rows; y++) {
      let acc = 0;
      const row = y * stride;
      let i = ((top + y) * this.width + left) * 3;
      for (let x = 0; x < w; x++, i += 3) {
        acc += cover[row + x]!;
        const alpha = Math.min(1, Math.abs(acc));
        if (alpha > 1 / 512) this.blend(i, c, alpha);
      }
    }
  }

  /** Draws an RGBA image scaled into the box, averaging the source pixels under each target pixel. */
  drawImage(img: Rgba, x: number, y: number, w: number, h: number) {
    const sx = img.width / w;
    const sy = img.height / h;
    for (let ty = 0; ty < h; ty++) {
      const py = Math.round(y) + ty;
      if (py < 0 || py >= this.height) continue;
      const y0 = Math.floor(ty * sy);
      const y1 = Math.max(y0 + 1, Math.ceil((ty + 1) * sy));
      for (let tx = 0; tx < w; tx++) {
        const px = Math.round(x) + tx;
        if (px < 0 || px >= this.width) continue;
        const x0 = Math.floor(tx * sx);
        const x1 = Math.max(x0 + 1, Math.ceil((tx + 1) * sx));
        let [r, g, b, a, n] = [0, 0, 0, 0, 0];
        for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
          for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
            const k = (yy * img.width + xx) * 4;
            const al = img.pixels[k + 3]!;
            r += img.pixels[k]! * al;
            g += img.pixels[k + 1]! * al;
            b += img.pixels[k + 2]! * al;
            a += al;
            n++;
          }
        }
        if (!a || !n) continue;
        this.blend((py * this.width + px) * 3, [r / a, g / a, b / a], a / n / 255);
      }
    }
  }
}

/** A run of text: each character from the first font that has it; characters none has are left out. */
export interface Run {
  glyphs: { font: Font; glyph: number; x: number }[];
  width: number;
}

// Control characters are exactly what this removes.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Text as it is drawn: composed, without control or invisible characters, single spaces. */
export const cleanText = (s: string) => s.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

export function layoutRun(fonts: Font[], text: string, size: number): Run {
  const glyphs: Run["glyphs"] = [];
  let x = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const font = fonts.find((f) => f.glyph(cp) !== 0);
    if (!font) continue;
    const glyph = font.glyph(cp);
    glyphs.push({ font, glyph, x });
    x += (font.advance(glyph) * size) / font.unitsPerEm;
  }
  return { glyphs, width: x };
}

/** Adds a run's outlines to a path, its origin at (x, baseline). */
export function runPath(run: Run, x: number, baseline: number, size: number, path = new Path()): Path {
  for (const g of run.glyphs) {
    const scale = size / g.font.unitsPerEm;
    const X = (px: number) => x + g.x + px * scale;
    const Y = (py: number) => baseline - py * scale;
    for (const pts of g.font.contours(g.glyph)) {
      const n = pts.length;
      if (n < 2) continue;
      const first = pts[0]!;
      const last = pts[n - 1]!;
      // Start on an on-curve point; between two off-curve points the on-curve point is implied.
      const start = first.on ? first : last.on ? last : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, on: true };
      const rest = first.on ? pts.slice(1) : last.on ? pts.slice(0, n - 1) : pts;
      path.moveTo(X(start.x), Y(start.y));
      let ctrl: { x: number; y: number } | null = null;
      for (const p of rest) {
        if (p.on) {
          if (ctrl) path.quadTo(X(ctrl.x), Y(ctrl.y), X(p.x), Y(p.y));
          else path.lineTo(X(p.x), Y(p.y));
          ctrl = null;
        } else {
          if (ctrl) path.quadTo(X(ctrl.x), Y(ctrl.y), X((ctrl.x + p.x) / 2), Y((ctrl.y + p.y) / 2));
          ctrl = p;
        }
      }
      if (ctrl) path.quadTo(X(ctrl.x), Y(ctrl.y), X(start.x), Y(start.y));
      path.close();
    }
  }
  return path;
}
