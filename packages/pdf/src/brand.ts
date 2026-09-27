// SPDX-License-Identifier: AGPL-3.0-only
// Brand input for PDFs. Structurally compatible with @gms/email's Brand, so callers can pass the same object.

export interface Brand {
  displayName: string;
  /** https URL or a data:image/png|jpeg;base64 URI. Anything else is ignored. */
  logoUrl?: string | null;
  primaryColor: string;
  accentColor?: string;
  sourceUrl?: string;
}

export interface ResolvedBrand {
  displayName: string;
  logo: string | null;
  primary: string;
  /** Very light tint of the primary color for table headers and panels. */
  tint: string;
  accent: string;
}

function parseHex(input: string | undefined | null): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? '').trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

function safeLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^data:image\/(png|jpe?g);base64,[a-z0-9+/=\s]+$/i.test(u)) return u;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function resolveBrand(brand: Brand): ResolvedBrand {
  const primary = parseHex(brand.primaryColor) ?? [31, 78, 121];
  const accent = parseHex(brand.accentColor) ?? primary;
  return {
    displayName: brand.displayName.trim() || 'Foundation',
    logo: safeLogo(brand.logoUrl),
    primary: toHex(primary),
    tint: toHex(primary.map((c) => c + (255 - c) * 0.9)),
    accent: toHex(accent),
  };
}
