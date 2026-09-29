// SPDX-License-Identifier: AGPL-3.0-or-later
// Brand used by the email and PDF preview routes: the current workspace's brand, or a fictional preset.
import 'server-only';
import { sourceLink } from '@/lib/config';
import { getTenant } from '@/lib/tenant';

export interface PreviewBrand {
  displayName: string;
  logoUrl: null;
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  sourceUrl: string;
}

export const BRAND_PRESETS = {
  neutral: {
    label: 'Neutral',
    displayName: 'Juniper Valley Community Fund',
    primaryColor: '#44403C',
    accentColor: '#78716C',
    headingFont: 'Inter',
  },
  teal: {
    label: 'Teal & gold',
    displayName: 'Halcyon Ridge Foundation',
    primaryColor: '#1F6F5C',
    accentColor: '#E0A526',
    headingFont: 'Source Serif 4',
  },
  violet: {
    label: 'Violet',
    displayName: 'Larkspur Arts Trust',
    primaryColor: '#5B3F9E',
    accentColor: '#D9467A',
    headingFont: 'Figtree',
  },
  'low-contrast': {
    label: 'Low contrast (auto-fixed)',
    displayName: 'Sunfield Neighbors Fund',
    primaryColor: '#F2D74B',
    accentColor: '#F7E9A0',
    headingFont: 'Atkinson Hyperlegible',
  },
} as const;

export type BrandPresetKey = keyof typeof BRAND_PRESETS;
export type BrandChoice = 'workspace' | BrandPresetKey;

export function isPreset(v: string | undefined): v is BrandPresetKey {
  return v !== undefined && Object.hasOwn(BRAND_PRESETS, v);
}

/** Resolves `?brand=`: a preset key, otherwise the workspace brand when there is one, otherwise neutral. */
export async function previewBrand(
  choice: string | undefined,
): Promise<{ brand: PreviewBrand; choice: BrandChoice; hasWorkspace: boolean }> {
  const tenant = await getTenant();
  const sourceUrl = sourceLink();
  if (isPreset(choice) || !tenant) {
    const key: BrandPresetKey = isPreset(choice) ? choice : 'neutral';
    const p = BRAND_PRESETS[key];
    return {
      brand: {
        displayName: p.displayName,
        logoUrl: null,
        primaryColor: p.primaryColor,
        accentColor: p.accentColor,
        headingFont: p.headingFont,
        sourceUrl,
      },
      choice: key,
      hasWorkspace: Boolean(tenant),
    };
  }
  return {
    brand: {
      displayName: tenant.brand.displayName,
      // Logos are served from the workspace host; previews stay offline-safe without them.
      logoUrl: null,
      primaryColor: tenant.brand.primaryColor,
      accentColor: tenant.brand.accentColor,
      headingFont: tenant.brand.headingFont,
      sourceUrl,
    },
    choice: 'workspace',
    hasWorkspace: true,
  };
}
