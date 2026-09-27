// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Progress as ProgressPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface ProgressProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  /** Accessible name, e.g. "Application progress". Required unless aria-labelledby is set. */
  label?: string;
  indicatorClassName?: string;
}

export function Progress({ className, value, max = 100, label, indicatorClassName, ...props }: ProgressProps) {
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      aria-label={label}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full flex-1 rounded-full bg-primary transition-transform duration-200 ease-out', indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
