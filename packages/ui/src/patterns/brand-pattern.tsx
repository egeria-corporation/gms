// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { cn } from '../lib/utils';
import { brandPatternDataUri, type BrandPatternOptions } from '../theme/pattern';

export interface BrandPatternProps extends Omit<React.ComponentProps<'div'>, 'children'>, BrandPatternOptions {
  /** Brand color (hex) the pattern is derived from. */
  color: string;
  /** Any stable value (workspace slug, opportunity id) so each page gets its own arrangement. */
  seed?: string | number;
}

/** Default imagery: a geometric pattern in the brand's colors. Decorative, so hidden from screen readers. */
export function BrandPattern({ color, seed = 0, columns, rows, tile, className, style, ...props }: BrandPatternProps) {
  const uri = brandPatternDataUri(color, seed, { columns, rows, tile });
  return (
    <div
      data-slot="brand-pattern"
      aria-hidden="true"
      className={cn('bg-cover bg-center', className)}
      style={{ backgroundImage: `url("${uri}")`, ...style }}
      {...props}
    />
  );
}
