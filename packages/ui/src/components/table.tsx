// SPDX-License-Identifier: AGPL-3.0-only
import * as React from 'react';
import { cn } from '../lib/utils';

/** Scroll container + table. Give the container a label when it scrolls (tabIndex makes it keyboard-scrollable). */
export function Table({
  className,
  containerClassName,
  containerLabel,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string; containerLabel?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full overflow-auto', containerClassName)}
      {...(containerLabel ? { role: 'region', 'aria-label': containerLabel, tabIndex: 0 } : {})}
    >
      <table data-slot="table" className={cn('w-full caption-bottom border-collapse text-sm tabular-nums', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('border-t bg-muted/60 font-medium [&>tr]:last:border-b-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-accent', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-9 bg-muted/60 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
        '[&:has([role=checkbox])]:w-10 [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('mt-3 text-sm text-muted-foreground', className)} {...props} />;
}
