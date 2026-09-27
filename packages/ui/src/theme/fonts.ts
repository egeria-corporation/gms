// SPDX-License-Identifier: AGPL-3.0-only
// Curated heading fonts. All are self-hosted via Fontsource (imported in styles.css); no font CDN.

export interface HeadingFont {
  id: HeadingFontId;
  label: string;
  /** CSS font-family stack. */
  family: string;
  description: string;
}

export type HeadingFontId = 'inter' | 'source-serif-4' | 'atkinson-hyperlegible' | 'figtree';

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF_FALLBACK = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

export const HEADING_FONTS: readonly HeadingFont[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: `"Inter Variable", Inter, ${SANS_FALLBACK}`,
    description: 'Neutral and modern. Matches the rest of the interface.',
  },
  {
    id: 'source-serif-4',
    label: 'Source Serif 4',
    family: `"Source Serif 4 Variable", "Source Serif 4", ${SERIF_FALLBACK}`,
    description: 'A classic serif with an institutional, editorial feel.',
  },
  {
    id: 'atkinson-hyperlegible',
    label: 'Atkinson Hyperlegible',
    family: `"Atkinson Hyperlegible", ${SANS_FALLBACK}`,
    description: 'Designed for low-vision readers; very distinct letterforms.',
  },
  {
    id: 'figtree',
    label: 'Figtree',
    family: `"Figtree Variable", Figtree, ${SANS_FALLBACK}`,
    description: 'Friendly and geometric, with a warm community tone.',
  },
] as const;

export const DEFAULT_HEADING_FONT: HeadingFontId = 'inter';

export function headingFont(id: string | null | undefined): HeadingFont {
  return HEADING_FONTS.find((f) => f.id === id) ?? (HEADING_FONTS[0] as HeadingFont);
}

export function isHeadingFontId(id: unknown): id is HeadingFontId {
  return typeof id === 'string' && HEADING_FONTS.some((f) => f.id === id);
}
