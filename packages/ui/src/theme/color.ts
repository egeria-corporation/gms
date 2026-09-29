// SPDX-License-Identifier: AGPL-3.0-or-later
// Color math for the branding engine: OKLCH scales and WCAG contrast. Pure TS, runs in Node and the browser.
import { clampChroma, converter, formatHex, parse, wcagContrast, type Oklch } from 'culori';

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ScaleStep = (typeof SCALE_STEPS)[number];
export type ColorScale = Record<ScaleStep, string>;

/** Target OKLCH lightness per step. Evenly perceptual, light to dark. */
const STEP_LIGHTNESS: Record<ScaleStep, number> = {
  50: 0.975,
  100: 0.945,
  200: 0.89,
  300: 0.815,
  400: 0.72,
  500: 0.63,
  600: 0.54,
  700: 0.46,
  800: 0.38,
  900: 0.3,
  950: 0.22,
};

/** Chroma multiplier per step: tints and shades carry less color than the middle of the scale. */
const STEP_CHROMA: Record<ScaleStep, number> = {
  50: 0.14,
  100: 0.26,
  200: 0.45,
  300: 0.68,
  400: 0.88,
  500: 1,
  600: 1,
  700: 0.92,
  800: 0.8,
  900: 0.66,
  950: 0.5,
};

const toOklch = converter('oklch');
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for "#abc" / "#aabbcc" (with or without the leading #). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** Normalizes to uppercase "#RRGGBB". Throws on invalid input. */
export function normalizeHex(value: string): string {
  const v = value.trim();
  if (!HEX_RE.test(v)) throw new RangeError(`not a hex color: ${value}`);
  const parsed = parse(v.startsWith('#') ? v : `#${v}`);
  if (!parsed) throw new RangeError(`not a hex color: ${value}`);
  return formatHex(parsed).toUpperCase();
}

export function hexToOklch(hex: string): Oklch {
  const c = toOklch(parse(normalizeHex(hex)));
  if (!c) throw new RangeError(`cannot convert ${hex}`);
  return { mode: 'oklch', l: c.l, c: c.c ?? 0, h: c.h ?? 0 };
}

export function oklchToHex(c: Oklch): string {
  const inGamut = clampChroma({ mode: 'oklch', l: clamp01(c.l), c: Math.max(0, c.c), h: c.h ?? 0 }, 'oklch');
  return formatHex(inGamut).toUpperCase();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** WCAG 2.x contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  return wcagContrast(normalizeHex(a), normalizeHex(b));
}

/** OKLCH lightness (0–1) of a hex color. */
export function lightnessOf(hex: string): number {
  return hexToOklch(hex).l;
}

/**
 * 11-step OKLCH scale (50–950) that keeps the input's hue. The input color itself is placed
 * at the step whose lightness is closest, so a brand color always appears verbatim in its scale.
 */
export function generateScale(hex: string): ColorScale {
  const base = hexToOklch(hex);
  const baseHex = normalizeHex(hex);
  // Near-grays keep a trace of chroma so the scale stays warm/cool like the input.
  const chroma = base.c;
  let anchor: ScaleStep = 500;
  let best = Infinity;
  for (const step of SCALE_STEPS) {
    const d = Math.abs(STEP_LIGHTNESS[step] - base.l);
    if (d < best) {
      best = d;
      anchor = step;
    }
  }
  const out = {} as ColorScale;
  for (const step of SCALE_STEPS) {
    out[step] =
      step === anchor
        ? baseHex
        : oklchToHex({ mode: 'oklch', l: STEP_LIGHTNESS[step], c: chroma * STEP_CHROMA[step], h: base.h ?? 0 });
  }
  return out;
}

/**
 * Returns the color closest to `hex` (same hue, OKLCH lightness moved as little as possible)
 * whose contrast against every color in `against` is at least `min`.
 * `direction` 'darken' searches lower lightness, 'lighten' higher.
 */
export function adjustForContrast(
  hex: string,
  against: readonly string[],
  min: number,
  direction: 'darken' | 'lighten',
): string {
  const ok = (h: string) => against.every((b) => contrastRatio(h, b) >= min);
  const normalized = normalizeHex(hex);
  if (ok(normalized)) return normalized;
  const base = hexToOklch(normalized);
  const at = (l: number) => oklchToHex({ ...base, l });
  // Binary search for the lightness nearest the original that satisfies the constraint.
  let lo = direction === 'darken' ? 0 : base.l;
  let hi = direction === 'darken' ? base.l : 1;
  const extreme = direction === 'darken' ? at(0) : at(1);
  if (!ok(extreme)) return extreme;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const passes = ok(at(mid));
    if (direction === 'darken') {
      if (passes) lo = mid;
      else hi = mid;
    } else if (passes) hi = mid;
    else lo = mid;
  }
  const result = at(direction === 'darken' ? lo : hi);
  // Hex rounding can land a hair under the threshold; nudge until it passes.
  let l = direction === 'darken' ? lo : hi;
  let candidate = result;
  for (let i = 0; i < 20 && !ok(candidate); i++) {
    l = direction === 'darken' ? l - 0.002 : l + 0.002;
    candidate = at(l);
  }
  return candidate;
}

/** Picks whichever of `options` has the highest contrast against `bg`. */
export function bestForeground(bg: string, options: readonly string[]): string {
  let best = options[0] ?? '#FFFFFF';
  let bestRatio = -1;
  for (const o of options) {
    const r = contrastRatio(o, bg);
    if (r > bestRatio) {
      bestRatio = r;
      best = o;
    }
  }
  return normalizeHex(best);
}
