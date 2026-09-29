// SPDX-License-Identifier: AGPL-3.0-or-later
import { ensureContrast, parseHex, readableTextOn, toHex } from './color';
import { safeUrl } from './escape';

/** A foundation's email branding. Colors are hex strings ("#1f6f5c"). */
export interface Brand {
  displayName: string;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  /** A font family name, e.g. "Fraunces". Always rendered with safe fallbacks. */
  headingFont?: string;
  replyTo?: string | null;
  /** Link to this deployment's source code (AGPL §13). Always shown in the footer. */
  sourceUrl: string;
}

export const DEFAULT_SOURCE_URL = 'https://github.com/egeria-corporation/gms';

/** Neutral palette used for text and surfaces (brand colors are only used where contrast is guaranteed). */
export const PALETTE = {
  pageBg: '#f4f4f5',
  cardBg: '#ffffff',
  border: '#e4e4e7',
  text: '#18181b',
  muted: '#52525b',
  subtle: '#f4f4f5',
  darkPageBg: '#111113',
  darkCardBg: '#1c1c1f',
  darkBorder: '#34343a',
  darkText: '#ececef',
  darkMuted: '#a1a1aa',
  darkSubtle: '#26262b',
} as const;

const SANS_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF_FONTS =
  /serif|garamond|georgia|times|merriweather|playfair|fraunces|lora|libre baskerville|source serif|crimson|spectral/i;

export interface ResolvedBrand {
  displayName: string;
  logoUrl: string | null;
  primary: string;
  accent: string;
  /** Primary text-safe on white (links, eyebrow text). */
  linkLight: string;
  /** Primary text-safe on the dark card (links in dark mode). */
  linkDark: string;
  buttonBg: string;
  buttonText: string;
  headingFontStack: string;
  bodyFontStack: string;
  replyTo: string | null;
  sourceUrl: string;
}

function sanitizeFontName(name: string | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .trim()
    .slice(0, 64);
  return cleaned || null;
}

/** Validates and derives everything the layout needs from a Brand. Invalid colors fall back to neutral defaults. */
export function resolveBrand(brand: Brand): ResolvedBrand {
  const primary = parseHex(brand.primaryColor) ?? parseHex('#1f4e79')!;
  const accent = parseHex(brand.accentColor) ?? primary;
  const white = parseHex(PALETTE.cardBg)!;
  const darkCard = parseHex(PALETTE.darkCardBg)!;
  const font = sanitizeFontName(brand.headingFont);
  const fallback = font && SERIF_FONTS.test(font) ? "Georgia, 'Times New Roman', Times, serif" : SANS_STACK;
  const displayName = brand.displayName.trim() || 'Your foundation';
  return {
    displayName,
    logoUrl: safeUrl(brand.logoUrl) && /^https?:/i.test(brand.logoUrl ?? '') ? safeUrl(brand.logoUrl) : null,
    primary: toHex(primary),
    accent: toHex(accent),
    linkLight: toHex(ensureContrast(primary, white, 4.5)),
    linkDark: toHex(ensureContrast(primary, darkCard, 4.5)),
    buttonBg: toHex(primary),
    buttonText: readableTextOn(primary),
    headingFontStack: font ? `'${font}', ${fallback}` : SANS_STACK,
    bodyFontStack: SANS_STACK,
    replyTo: brand.replyTo?.trim() || null,
    sourceUrl: safeUrl(brand.sourceUrl) ?? DEFAULT_SOURCE_URL,
  };
}
