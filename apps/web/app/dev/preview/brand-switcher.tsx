// SPDX-License-Identifier: AGPL-3.0-or-later
import { cn } from '@gms/ui';
import Link from 'next/link';
import { BRAND_PRESETS, type BrandChoice, type BrandPresetKey } from './preview-brand';

/** Link-based brand toggle for preview pages (works without JavaScript). */
export function BrandSwitcher({
  current,
  hasWorkspace,
  hrefFor,
}: {
  current: BrandChoice;
  hasWorkspace: boolean;
  hrefFor: (choice: BrandChoice) => string;
}) {
  const options: { key: BrandChoice; label: string }[] = [
    ...(hasWorkspace ? [{ key: 'workspace' as const, label: 'This workspace' }] : []),
    ...(Object.keys(BRAND_PRESETS) as BrandPresetKey[]).map((k) => ({
      key: k,
      label: BRAND_PRESETS[k].label,
    })),
  ];
  return (
    <nav aria-label="Preview brand" className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-muted-foreground">Brand:</span>
      {options.map((o) => (
        <Link
          key={o.key}
          href={hrefFor(o.key)}
          aria-current={o.key === current ? 'true' : undefined}
          className={cn(
            'rounded-md border px-2 py-1 hover:bg-muted',
            o.key === current && 'border-primary bg-accent font-medium text-accent-foreground',
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
