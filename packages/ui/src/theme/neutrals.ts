// SPDX-License-Identifier: AGPL-3.0-only
// Neutral surface colors, mirrored from styles.css so contrast checks use the real backgrounds.
import { oklchToHex } from './color';

const warm = (l: number, c = 0.003, h = 80) => oklchToHex({ mode: 'oklch', l, c, h });

export const SURFACES = {
  light: {
    background: warm(0.988, 0.002),
    card: '#FFFFFF',
    muted: warm(0.965, 0.004),
    sidebar: warm(0.975, 0.003),
    foreground: warm(0.22, 0.006, 60),
  },
  dark: {
    background: warm(0.175, 0.004, 60),
    card: warm(0.205, 0.004, 60),
    muted: warm(0.25, 0.005, 60),
    sidebar: warm(0.195, 0.004, 60),
    foreground: warm(0.96, 0.003),
  },
} as const;

export const WHITE = '#FFFFFF';
/** Near-black ink used as dark text on light brand fills. */
export const INK = SURFACES.light.foreground;

/** Neutral defaults used when a workspace has not set brand colors. */
export const DEFAULT_BRAND_COLORS = {
  primary: '#44403C',
  accent: '#78716C',
} as const;
