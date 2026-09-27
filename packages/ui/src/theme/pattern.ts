// SPDX-License-Identifier: AGPL-3.0-only
// Default imagery: deterministic geometric SVG patterns derived from the brand color (no stock photos).
import { generateScale, isHexColor } from './color';
import { DEFAULT_BRAND_COLORS } from './neutrals';

export interface BrandPatternOptions {
  /** Columns in the tile grid. Default 8. */
  columns?: number;
  /** Rows in the tile grid. Default 5. */
  rows?: number;
  /** Tile size in SVG units. Default 100. */
  tile?: number;
}

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns an SVG document string of circles, arcs and triangles in shades of `hex`.
 * The same (hex, seed) always yields the same SVG. Decorative: aria-hidden, no text.
 */
export function brandPatternSvg(hex: string, seed: string | number = 0, opts: BrandPatternOptions = {}): string {
  const base = isHexColor(hex) ? hex : DEFAULT_BRAND_COLORS.primary;
  const scale = generateScale(base);
  const cols = Math.max(1, Math.min(24, Math.floor(opts.columns ?? 8)));
  const rows = Math.max(1, Math.min(24, Math.floor(opts.rows ?? 5)));
  const t = Math.max(10, Math.min(400, Math.floor(opts.tile ?? 100)));
  const rand = prng(hashSeed(`${base.toUpperCase()}|${seed}`));
  const palette = [scale[100], scale[200], scale[300], scale[400], scale[500], scale[700], scale[800]];
  const pick = () => palette[Math.floor(rand() * palette.length)]!;
  const w = cols * t;
  const h = rows * t;
  const parts: string[] = [`<rect width="${w}" height="${h}" fill="${scale[50]}"/>`];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * t;
      const y = r * t;
      const bg = pick();
      const fg = pick();
      const rot = Math.floor(rand() * 4) * 90;
      const cx = x + t / 2;
      const cy = y + t / 2;
      const kind = Math.floor(rand() * 6);
      const g: string[] = [];
      if (rand() < 0.55) g.push(`<rect x="${x}" y="${y}" width="${t}" height="${t}" fill="${bg}"/>`);
      switch (kind) {
        case 0: // full circle
          g.push(`<circle cx="${cx}" cy="${cy}" r="${t * 0.38}" fill="${fg}"/>`);
          break;
        case 1: // quarter circle anchored in a corner
          g.push(`<path d="M${x} ${y}h${t}a${t} ${t} 0 0 1 -${t} ${t}z" fill="${fg}" transform="rotate(${rot} ${cx} ${cy})"/>`);
          break;
        case 2: // half circle
          g.push(`<path d="M${x} ${cy}a${t / 2} ${t / 2} 0 0 1 ${t} 0z" fill="${fg}" transform="rotate(${rot} ${cx} ${cy})"/>`);
          break;
        case 3: // right triangle
          g.push(`<path d="M${x} ${y}h${t}v${t}z" fill="${fg}" transform="rotate(${rot} ${cx} ${cy})"/>`);
          break;
        case 4: // concentric arcs
          g.push(
            `<path d="M${x} ${y + t}a${t} ${t} 0 0 1 ${t} -${t}" fill="none" stroke="${fg}" stroke-width="${t * 0.12}" transform="rotate(${rot} ${cx} ${cy})"/>`,
            `<path d="M${x} ${y + t}a${t * 0.55} ${t * 0.55} 0 0 1 ${t * 0.55} -${t * 0.55}" fill="none" stroke="${fg}" stroke-width="${t * 0.12}" transform="rotate(${rot} ${cx} ${cy})"/>`,
          );
          break;
        default: // small dot
          g.push(`<circle cx="${cx}" cy="${cy}" r="${t * 0.14}" fill="${fg}"/>`);
      }
      parts.push(...g);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

/** The pattern as a data: URI for CSS backgrounds or <img src>. */
export function brandPatternDataUri(hex: string, seed: string | number = 0, opts: BrandPatternOptions = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandPatternSvg(hex, seed, opts))}`;
}
