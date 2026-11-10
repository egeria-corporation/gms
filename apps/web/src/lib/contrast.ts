// SPDX-License-Identifier: AGPL-3.0-only
// WCAG 2.x contrast math for tenant brand colors (build spec §10.12). Text on the accent must
// meet AA (4.5:1); a pair that fails falls back to the system accent with a warning.

export const SYSTEM_BRAND = { accent: "#1F6F8B", onAccent: "#FFFFFF" } as const;
export const AA_TEXT = 4.5;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHexColor = (value: string): boolean => HEX.test(value.trim());

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, 0 (black) to 1 (white). Null for anything that is not a hex color. */
export function luminance(hex: string): number | null {
  const rgb = channels(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors, 1 to 21. Null when either is not a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface BrandCheck {
  ratio: number | null;
  passes: boolean;
  /** The pair to use: the one given when it passes, otherwise the system brand. */
  effective: { accent: string; onAccent: string };
  warning: string | null;
}

export function checkBrand(accent: string, onAccent: string): BrandCheck {
  const ratio = contrastRatio(accent, onAccent);
  if (ratio === null) {
    return { ratio, passes: false, effective: { ...SYSTEM_BRAND }, warning: "Enter colors as hex values such as #1F6F8B. The OpenGrants accent is used until then." };
  }
  if (ratio >= AA_TEXT) return { ratio, passes: true, effective: { accent, onAccent }, warning: null };
  return {
    ratio,
    passes: false,
    effective: { ...SYSTEM_BRAND },
    warning: `Text on this accent has a contrast of ${ratio.toFixed(1)}:1; WCAG AA needs 4.5:1. The OpenGrants accent is used on your pages until the pair passes.`,
  };
}

/** White or near-black, whichever reads better on the accent. */
export function suggestOnAccent(accent: string): string {
  const white = contrastRatio(accent, "#FFFFFF") ?? 0;
  const dark = contrastRatio(accent, "#0D2A43") ?? 0;
  return white >= dark ? "#FFFFFF" : "#0D2A43";
}
