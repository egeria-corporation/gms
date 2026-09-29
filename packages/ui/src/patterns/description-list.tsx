// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { cn } from '../lib/utils';

export interface DescriptionItem {
  term: React.ReactNode;
  detail: React.ReactNode;
  /** Mark numeric details for right alignment in 'table' layout. */
  numeric?: boolean;
  /** Span both columns in 'grid' layout. */
  wide?: boolean;
}

export interface DescriptionListProps extends React.ComponentProps<'dl'> {
  items: DescriptionItem[];
  /** 'rows': term left, detail right (record summaries). 'grid': 2–3 columns of stacked pairs. 'stacked': one column. */
  layout?: 'rows' | 'grid' | 'stacked';
  columns?: 2 | 3;
}

/** Key–value pairs for record summaries. Empty details show an em dash. */
export function DescriptionList({ items, layout = 'rows', columns = 2, className, ...props }: DescriptionListProps) {
  const empty = (d: React.ReactNode) =>
    d === null || d === undefined || d === '' ? (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">Not provided</span>
      </>
    ) : (
      d
    );
  if (layout === 'rows') {
    return (
      <dl data-slot="description-list" className={cn('divide-y text-sm', className)} {...props}>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[minmax(8rem,14rem)_1fr] sm:gap-4">
            <dt className="text-muted-foreground">{it.term}</dt>
            <dd className={cn('min-w-0 break-words', it.numeric && 'tabular-nums')}>{empty(it.detail)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      data-slot="description-list"
      className={cn(
        'grid gap-x-6 gap-y-4 text-sm',
        layout === 'grid' && (columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'),
        className,
      )}
      {...props}
    >
      {items.map((it, i) => (
        <div key={i} className={cn('grid gap-0.5', it.wide && 'sm:col-span-full')}>
          <dt className="text-xs font-medium text-muted-foreground">{it.term}</dt>
          <dd className={cn('min-w-0 break-words', it.numeric && 'tabular-nums')}>{empty(it.detail)}</dd>
        </div>
      ))}
    </dl>
  );
}
