// SPDX-License-Identifier: AGPL-3.0-only
// A small TrueType reader for the share cards: the character map, advance widths and glyph
// outlines (simple and composite) of the bundled Ubuntu and Lato fonts. No hinting, kerning or
// shaping: Latin text set large on a 1200x627 card does not need them.

export interface Point {
  x: number;
  y: number;
  on: boolean;
}
export type Contour = Point[];

interface Table {
  offset: number;
  length: number;
}

export class Font {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  private readonly view: DataView;
  private readonly tables = new Map<string, Table>();
  private readonly numGlyphs: number;
  private readonly numHMetrics: number;
  private readonly longLoca: boolean;
  private readonly cmapLookup: (cp: number) => number;
  private readonly glyphs = new Map<number, number>();
  private readonly outlines = new Map<number, Contour[]>();

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = this.view;
    const version = v.getUint32(0);
    if (version !== 0x00010000 && version !== 0x74727565) throw new Error("Not a TrueType font");
    const count = v.getUint16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
      this.tables.set(tag, { offset: v.getUint32(at + 8), length: v.getUint32(at + 12) });
    }
    const head = this.table("head");
    this.unitsPerEm = v.getUint16(head + 18);
    this.longLoca = v.getInt16(head + 50) === 1;
    this.numGlyphs = v.getUint16(this.table("maxp") + 4);
    const hhea = this.table("hhea");
    this.ascender = v.getInt16(hhea + 4);
    this.descender = v.getInt16(hhea + 6);
    this.numHMetrics = v.getUint16(hhea + 34);
    this.table("glyf");
    this.table("loca");
    this.table("hmtx");
    this.cmapLookup = this.readCmap();
  }

  private table(tag: string): number {
    const t = this.tables.get(tag);
    if (!t) throw new Error(`The font has no ${tag} table`);
    return t.offset;
  }

  /** The glyph for a code point; 0 (the missing glyph) when the font has none. */
  glyph(codePoint: number): number {
    let g = this.glyphs.get(codePoint);
    if (g === undefined) {
      g = this.cmapLookup(codePoint);
      if (g >= this.numGlyphs) g = 0;
      this.glyphs.set(codePoint, g);
    }
    return g;
  }

  /** Advance width in font units. */
  advance(glyph: number): number {
    const i = Math.min(glyph, this.numHMetrics - 1);
    return this.view.getUint16(this.table("hmtx") + i * 4);
  }

  /** The glyph's contours in font units, y up. */
  contours(glyph: number): Contour[] {
    let c = this.outlines.get(glyph);
    if (!c) {
      c = this.readGlyph(glyph, 0);
      this.outlines.set(glyph, c);
    }
    return c;
  }

  private readCmap(): (cp: number) => number {
    const v = this.view;
    const cmap = this.table("cmap");
    const n = v.getUint16(cmap + 2);
    const subtables: { platform: number; encoding: number; at: number; format: number }[] = [];
    for (let i = 0; i < n; i++) {
      const rec = cmap + 4 + i * 8;
      const at = cmap + v.getUint32(rec + 4);
      subtables.push({ platform: v.getUint16(rec), encoding: v.getUint16(rec + 2), at, format: v.getUint16(at) });
    }
    const unicode = (s: { platform: number; encoding: number }) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
    const f12 = subtables.find((s) => unicode(s) && s.format === 12);
    if (f12) {
      const groups = v.getUint32(f12.at + 12);
      return (cp) => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = f12.at + 16 + mid * 12;
          if (cp < v.getUint32(g)) hi = mid - 1;
          else if (cp > v.getUint32(g + 4)) lo = mid + 1;
          else return v.getUint32(g + 8) + (cp - v.getUint32(g));
        }
        return 0;
      };
    }
    const f4 = subtables.find((s) => unicode(s) && s.format === 4);
    if (!f4) throw new Error("The font has no Unicode character map");
    const segX2 = v.getUint16(f4.at + 6);
    const ends = f4.at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2; i += 2) {
        if (v.getUint16(ends + i) < cp) continue;
        const start = v.getUint16(starts + i);
        if (start > cp) return 0;
        const delta = v.getInt16(deltas + i);
        const range = v.getUint16(ranges + i);
        if (range === 0) return (cp + delta) & 0xffff;
        const g = v.getUint16(ranges + i + range + 2 * (cp - start));
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    };
  }

  private location(glyph: number): { at: number; length: number } {
    const v = this.view;
    const loca = this.table("loca");
    const off = (i: number) => (this.longLoca ? v.getUint32(loca + i * 4) : v.getUint16(loca + i * 2) * 2);
    const start = off(glyph);
    return { at: this.table("glyf") + start, length: off(glyph + 1) - start };
  }

  private readGlyph(glyph: number, depth: number): Contour[] {
    if (glyph >= this.numGlyphs || depth > 8) return [];
    const { at, length } = this.location(glyph);
    if (length <= 0) return [];
    const v = this.view;
    const contours = v.getInt16(at);
    if (contours >= 0) return this.simpleGlyph(at, contours);

    // Composite: components placed by an x/y offset and an optional 2x2 transform.
    const out: Contour[] = [];
    let p = at + 10;
    for (;;) {
      const flags = v.getUint16(p);
      const component = v.getUint16(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flags & 0x1) {
        dx = v.getInt16(p);
        dy = v.getInt16(p + 2);
        p += 4;
      } else {
        dx = v.getInt8(p);
        dy = v.getInt8(p + 1);
        p += 2;
      }
      const f2 = (o: number) => v.getInt16(o) / 16384;
      let [a, b, c, d] = [1, 0, 0, 1];
      if (flags & 0x8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        [a, b, c, d] = [f2(p), f2(p + 2), f2(p + 4), f2(p + 6)];
        p += 8;
      }
      // Components aligned by matching points are not used by these fonts' Latin glyphs.
      if (!(flags & 0x2)) dx = dy = 0;
      for (const contour of this.readGlyph(component, depth + 1)) out.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  private simpleGlyph(at: number, contours: number): Contour[] {
    const v = this.view;
    const ends: number[] = [];
    for (let i = 0; i < contours; i++) ends.push(v.getUint16(at + 10 + i * 2));
    const total = contours ? ends[contours - 1]! + 1 : 0;
    let p = at + 10 + contours * 2;
    p += 2 + v.getUint16(p);
    const flags: number[] = [];
    while (flags.length < total) {
      const f = v.getUint8(p++);
      flags.push(f);
      if (f & 0x8) {
        let repeat = v.getUint8(p++);
        while (repeat-- > 0 && flags.length < total) flags.push(f);
      }
    }
    const coords = (short: number, same: number): number[] => {
      const out: number[] = [];
      let value = 0;
      for (const f of flags) {
        if (f & short) {
          const d = v.getUint8(p++);
          value += f & same ? d : -d;
        } else if (!(f & same)) {
          value += v.getInt16(p);
          p += 2;
        }
        out.push(value);
      }
      return out;
    };
    const xs = coords(0x2, 0x10);
    const ys = coords(0x4, 0x20);
    const out: Contour[] = [];
    let start = 0;
    for (const end of ends) {
      const contour: Contour = [];
      for (let i = start; i <= end; i++) contour.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 0x1) === 1 });
      out.push(contour);
      start = end + 1;
    }
    return out;
  }
}
