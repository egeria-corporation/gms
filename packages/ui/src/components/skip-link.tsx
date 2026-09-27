// SPDX-License-Identifier: AGPL-3.0-only
import * as React from 'react';
import { cn } from '../lib/utils';

/** First focusable element on every page. The target should be `<main id="main" tabIndex={-1}>`. */
export function SkipLink({ href = '#main', children = 'Skip to main content', className, ...props }: React.ComponentProps<'a'>) {
  return (
    <a
      href={href}
      className={cn(
        'sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-popover focus:px-4 focus:py-2.5',
        'focus:text-sm focus:font-medium focus:text-foreground focus:shadow-overlay focus:outline-2 focus:outline-ring',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
