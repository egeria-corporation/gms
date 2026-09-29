// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { cn } from '../lib/utils';

/** Loading placeholder. Hidden from assistive tech; pair with a live "Loading…" message on the region. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('animate-shimmer rounded-md bg-muted', className)} {...props} />;
}
