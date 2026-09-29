// SPDX-License-Identifier: AGPL-3.0-or-later
// Small WCAG color helpers so tenant brand colors stay readable in light and dark mode.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses #rgb / #rrggbb (with or without '#'). Returns null for anything else. */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = Number.parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Nudges `fg` toward black or white until it reaches `ratio` against `bg`. */
export function ensureContrast(fg: Rgb, bg: Rgb, ratio = 4.5): Rgb {
  if (contrastRatio(fg, bg) >= ratio) return fg;
  const target = luminance(bg) > 0.5 ? BLACK : WHITE;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrastRatio(c, bg) >= ratio) return c;
  }
  return target;
}

/** Best text color (near-black or white) to put on top of `bg`. */
export function readableTextOn(bg: Rgb): string {
  return contrastRatio(WHITE, bg) >= contrastRatio({ r: 17, g: 24, b: 39 }, bg) ? '#ffffff' : '#111827';
}
