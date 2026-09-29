// SPDX-License-Identifier: AGPL-3.0-or-later
// Branding engine: turns a workspace's brand colors into CSS variables that always meet WCAG AA.
import {
  adjustForContrast,
  bestForeground,
  contrastRatio,
  generateScale,
  isHexColor,
  normalizeHex,
  SCALE_STEPS,
  type ColorScale,
} from './color';
import { headingFont, type HeadingFont } from './fonts';
import { DEFAULT_BRAND_COLORS, INK, SURFACES, WHITE } from './neutrals';

export interface BrandInput {
  primary?: string | null;
  accent?: string | null;
  headingFont?: string | null;
}

export type ContrastWarningCode = 'primary-too-light' | 'accent-low-contrast' | 'invalid-color';

export interface ContrastWarning {
  code: ContrastWarningCode;
  /** Which brand input the warning is about. */
  field: 'primary' | 'accent';
  original: string;
  adjusted: string;
  /** Contrast before/after against the surface that failed (absent for invalid-color). */
  ratioBefore?: number;
  ratioAfter?: number;
  /** Plain-language explanation for the admin who picked the color. */
  message: string;
}

export interface ResolvedBrand {
  /** Every variable for branded (applicant, public, reviewer, board) surfaces. Light only. */
  tokens: Record<string, string>;
  /** The small subset the staff console accepts (accent colors and focus ring), light theme. */
  consoleTokens: Record<string, string>;
  /** Console subset for the dark theme. */
  consoleDarkTokens: Record<string, string>;
  warnings: ContrastWarning[];
  /** Colors actually used for text-bearing fills (buttons, links). */
  adjusted: { primary: string; accent: string };
  /** The colors the workspace picked (normalized), or the neutral defaults. */
  original: { primary: string; accent: string };
  scales: { brand: ColorScale; accent: ColorScale };
  headingFont: HeadingFont;
}

/** WCAG 2.2 AA thresholds. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

/** Tokens tenants can never override: status colors must mean the same thing everywhere. */
export const PROTECTED_TOKEN_PREFIXES = ['--status-'] as const;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickColor(
  field: 'primary' | 'accent',
  value: string | null | undefined,
  fallback: string,
  warnings: ContrastWarning[],
): string {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  if (isHexColor(value)) return normalizeHex(value);
  warnings.push({
    code: 'invalid-color',
    field,
    original: value,
    adjusted: fallback,
    message: `"${value}" isn't a color code like #0F5E5A, so we used ${fallback} for your ${field} color instead.`,
  });
  return fallback;
}

function scaleTokens(prefix: string, scale: ColorScale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of SCALE_STEPS) out[`--${prefix}-${step}`] = scale[step];
  return out;
}

export function resolveBrand(input: BrandInput = {}): ResolvedBrand {
  const warnings: ContrastWarning[] = [];
  const primary = pickColor('primary', input.primary, DEFAULT_BRAND_COLORS.primary, warnings);
  const accent = pickColor('accent', input.accent, DEFAULT_BRAND_COLORS.accent, warnings);
  const font = headingFont(input.headingFont);
  const light = SURFACES.light;
  const dark = SURFACES.dark;

  // Primary carries white button text and is used for links on page and card backgrounds.
  const primarySurfaces = [WHITE, light.background, light.card];
  const primaryAdjusted = adjustForContrast(primary, primarySurfaces, AA_TEXT, 'darken');
  if (primaryAdjusted !== primary) {
    warnings.push({
      code: 'primary-too-light',
      field: 'primary',
      original: primary,
      adjusted: primaryAdjusted,
      ratioBefore: r2(Math.min(...primarySurfaces.map((s) => contrastRatio(primary, s)))),
      ratioAfter: r2(Math.min(...primarySurfaces.map((s) => contrastRatio(primaryAdjusted, s)))),
      message: `Your primary color ${primary} was too light for readable button text, so we darkened it to ${primaryAdjusted} for buttons and links.`,
    });
  }

  // Accent is a fill (badges, highlights) with whichever text color reads best on it.
  let accentAdjusted = accent;
  let accentForeground = bestForeground(accent, [WHITE, INK]);
  if (contrastRatio(accentForeground, accent) < AA_TEXT) {
    accentAdjusted = adjustForContrast(accent, [WHITE], AA_TEXT, 'darken');
    accentForeground = WHITE;
    warnings.push({
      code: 'accent-low-contrast',
      field: 'accent',
      original: accent,
      adjusted: accentAdjusted,
      ratioBefore: r2(contrastRatio(bestForeground(accent, [WHITE, INK]), accent)),
      ratioAfter: r2(contrastRatio(WHITE, accentAdjusted)),
      message: `Your accent color ${accent} didn't leave enough contrast for text on top of it, so we adjusted it to ${accentAdjusted} wherever it sits behind text.`,
    });
  }

  const brandScale = generateScale(primary);
  const accentScale = generateScale(accent);

  // Focus ring: at least 3:1 against every background it can appear on.
  const ringLight = adjustForContrast(primary, [WHITE, light.background, light.sidebar, light.muted], AA_NON_TEXT, 'darken');
  const ringDark = adjustForContrast(primary, [dark.background, dark.card, dark.sidebar, dark.muted], AA_NON_TEXT, 'lighten');

  // Subtle hover/selected fill tinted with the brand.
  const subtle = brandScale[50];
  const subtleForeground = adjustForContrast(brandScale[900], [subtle], AA_TEXT, 'darken');

  const chart = [
    primaryAdjusted,
    adjustForContrast(accent, [WHITE, light.background], AA_NON_TEXT, 'darken'),
    adjustForContrast(brandScale[400], [WHITE, light.background], AA_NON_TEXT, 'darken'),
    adjustForContrast(accentScale[700], [WHITE, light.background], AA_NON_TEXT, 'darken'),
    adjustForContrast(DEFAULT_BRAND_COLORS.accent, [WHITE, light.background], AA_NON_TEXT, 'darken'),
  ];

  const shared: Record<string, string> = {
    ...scaleTokens('brand', brandScale),
    ...scaleTokens('accent', accentScale),
    '--brand-primary': primary,
    '--brand-accent': accentAdjusted,
    '--brand-accent-foreground': accentForeground,
  };

  const tokens: Record<string, string> = {
    ...shared,
    '--primary': primaryAdjusted,
    '--primary-foreground': WHITE,
    '--link': primaryAdjusted,
    '--ring': ringLight,
    '--accent': subtle,
    '--accent-foreground': subtleForeground,
    '--font-heading': font.family,
    '--chart-1': chart[0]!,
    '--chart-2': chart[1]!,
    '--chart-3': chart[2]!,
    '--chart-4': chart[3]!,
    '--chart-5': chart[4]!,
  };

  const consoleTokens: Record<string, string> = {
    ...shared,
    '--ring': ringLight,
    '--sidebar-ring': ringLight,
    '--console-accent': ringLight,
  };
  const consoleDarkTokens: Record<string, string> = {
    '--ring': ringDark,
    '--sidebar-ring': ringDark,
    '--console-accent': ringDark,
  };

  return {
    tokens,
    consoleTokens,
    consoleDarkTokens,
    warnings,
    adjusted: { primary: primaryAdjusted, accent: accentAdjusted },
    original: { primary, accent },
    scales: { brand: brandScale, accent: accentScale },
    headingFont: font,
  };
}

const TOKEN_NAME_RE = /^--[a-z0-9-]+$/;
const UNSAFE_VALUE_RE = /[;{}<>\\]|\/\*|\*\//;

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .filter(
      ([k, v]) =>
        TOKEN_NAME_RE.test(k) &&
        !PROTECTED_TOKEN_PREFIXES.some((p) => k.startsWith(p)) &&
        typeof v === 'string' &&
        !UNSAFE_VALUE_RE.test(v),
    )
    .map(([k, v]) => `${k}:${v};`)
    .join('');
}

export interface BrandCssOptions {
  /** 'branded' emits every brand token; 'console' only accent colors and the focus ring. */
  scope: 'branded' | 'console';
  /** CSS selector to scope the variables to. Default ":root". */
  selector?: string;
}

/**
 * CSS text to inject server-side (e.g. in a <style> tag in the layout).
 * Status tokens are never emitted, so tenants can't change what a status color means.
 */
export function brandCss(resolved: ResolvedBrand, opts: BrandCssOptions): string {
  const selector = (opts.selector ?? ':root').trim();
  if (UNSAFE_VALUE_RE.test(selector)) throw new RangeError('unsafe selector');
  if (opts.scope === 'branded') return `${selector}{${declarations(resolved.tokens)}}`;
  const darkSelector = selector === ':root' ? ':root.dark,.dark' : `.dark ${selector},${selector}.dark`;
  return `${selector}{${declarations(resolved.consoleTokens)}}${darkSelector}{${declarations(resolved.consoleDarkTokens)}}`;
}
