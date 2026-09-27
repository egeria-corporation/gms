// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  brandCss,
  brandPatternSvg,
  contrastRatio,
  DESIGN_TOKENS,
  generateScale,
  HEADING_FONTS,
  lightnessOf,
  resolveBrand,
  SCALE_STEPS,
  SURFACES,
} from '../src/theme';

function expectMonotonic(hex: string) {
  const scale = generateScale(hex);
  const steps = Object.keys(scale);
  expect(steps).toHaveLength(11);
  expect(steps.map(Number)).toEqual([...SCALE_STEPS]);
  const ls = SCALE_STEPS.map((s) => lightnessOf(scale[s]));
  for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeLessThan(ls[i - 1]!);
}

describe('generateScale', () => {
  it.each(['#0F5E5A', '#E0A526', '#F2D74B', '#B4532A', '#3F5B8C', '#000000', '#FFFFFF', '#777'])(
    '%s has 11 steps, monotonic in lightness',
    (hex) => expectMonotonic(hex),
  );

  it('places the input color verbatim at its nearest step', () => {
    expect(Object.values(generateScale('#0F5E5A'))).toContain('#0F5E5A');
  });
});

describe('contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resolveBrand', () => {
  it('Halcyon: teal + marigold pass with the teal unchanged', () => {
    const r = resolveBrand({ primary: '#0F5E5A', accent: '#E0A526', headingFont: 'source-serif-4' });
    expect(r.adjusted.primary).toBe('#0F5E5A');
    expect(r.tokens['--primary']).toBe('#0F5E5A');
    expect(r.adjusted.accent).toBe('#E0A526');
    expect(r.warnings).toEqual([]);
    expect(contrastRatio(r.tokens['--primary-foreground']!, r.tokens['--primary']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(r.tokens['--brand-accent-foreground']!, r.tokens['--brand-accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(r.tokens['--font-heading']).toContain('Source Serif 4');
  });

  it('auto-fixes a too-light primary to >= 4.5:1 and explains why', () => {
    const r = resolveBrand({ primary: '#F2D74B', accent: '#3F5B8C' });
    const p = r.tokens['--primary']!;
    expect(p).not.toBe('#F2D74B');
    expect(contrastRatio('#FFFFFF', p)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SURFACES.light.background, p)).toBeGreaterThanOrEqual(4.5);
    const w = r.warnings.find((x) => x.code === 'primary-too-light');
    expect(w).toBeDefined();
    expect(w!.message).toMatch(
      /^Your primary color #F2D74B was too light for readable button text, so we darkened it to #[0-9A-F]{6} for buttons and links\.$/,
    );
    expect(w!.ratioAfter!).toBeGreaterThanOrEqual(4.5);
    // Only lightness moved: the fix stays close to the original's lightness floor, not black.
    expect(lightnessOf(p)).toBeGreaterThan(0.4);
  });

  it('Marigold Street: rust + slate blue meet AA everywhere', () => {
    const r = resolveBrand({ primary: '#B4532A', accent: '#3F5B8C', headingFont: 'figtree' });
    expect(contrastRatio('#FFFFFF', r.tokens['--primary']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(r.tokens['--accent-foreground']!, r.tokens['--accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(r.tokens['--brand-accent-foreground']!, r.tokens['--brand-accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(r.headingFont.id).toBe('figtree');
  });

  it('focus rings are >= 3:1 against light and dark backgrounds', () => {
    for (const primary of ['#0F5E5A', '#F2D74B', '#B4532A', '#3F5B8C', '#111111', '#FAFAFA']) {
      const r = resolveBrand({ primary });
      expect(contrastRatio(r.tokens['--ring']!, SURFACES.light.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.consoleTokens['--ring']!, SURFACES.light.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.consoleDarkTokens['--ring']!, SURFACES.dark.background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('falls back to neutral defaults and warns on invalid input', () => {
    const r = resolveBrand({ primary: 'blue' });
    expect(r.warnings[0]?.code).toBe('invalid-color');
    expect(r.tokens['--primary']).toMatch(/^#[0-9A-F]{6}$/);
    expect(resolveBrand().warnings).toEqual([]);
  });
});

describe('brandCss', () => {
  const r = resolveBrand({ primary: '#0F5E5A', accent: '#E0A526' });

  it('branded scope emits a :root block with primary and fonts', () => {
    const css = brandCss(r, { scope: 'branded' });
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--primary:#0F5E5A;');
    expect(css).toContain('--font-heading:');
    expect(css).not.toContain('--status-');
  });

  it('console scope only carries accent colors and ring', () => {
    const css = brandCss(r, { scope: 'console', selector: '[data-workspace]' });
    expect(css).not.toMatch(/--primary:/);
    expect(css).not.toMatch(/--background:/);
    expect(css).not.toMatch(/--font-heading:/);
    expect(css).toContain('--ring:');
    expect(css).toContain('.dark [data-workspace]');
  });

  it('never lets tenants override status tokens or inject CSS', () => {
    const tampered = { ...r, tokens: { ...r.tokens, '--status-danger-fg': '#00FF00', '--x': 'red;}body{' } };
    const css = brandCss(tampered, { scope: 'branded' });
    expect(css).not.toContain('--status-danger-fg');
    expect(css).not.toContain('body{');
  });
});

describe('HEADING_FONTS', () => {
  it('lists the four curated fonts with stacks', () => {
    expect(HEADING_FONTS.map((f) => f.label)).toEqual(['Inter', 'Source Serif 4', 'Atkinson Hyperlegible', 'Figtree']);
    for (const f of HEADING_FONTS) expect(f.family).toMatch(/(sans-serif|serif)$/);
  });
});

describe('brandPatternSvg', () => {
  it('is deterministic per (color, seed) and varies by seed', () => {
    const a = brandPatternSvg('#0F5E5A', 'halcyon');
    expect(a).toBe(brandPatternSvg('#0F5E5A', 'halcyon'));
    expect(a).not.toBe(brandPatternSvg('#0F5E5A', 'other'));
    expect(a.startsWith('<svg')).toBe(true);
    expect(a).toContain('aria-hidden="true"');
    expect(a).toMatch(/<(circle|path)/);
  });
});

describe('DESIGN_TOKENS', () => {
  it('documents status tokens as protected', () => {
    const status = DESIGN_TOKENS.groups.find((g) => g.id === 'status');
    expect(status?.tenantOverridable).toBe(false);
    expect(status?.tokens.length).toBeGreaterThanOrEqual(24);
  });
});
