// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';
import { buttonVariants } from './button';

/** Page numbers to show, with 'gap' for ellipses: 1 … 4 5 6 … 20. */
export function pageWindow(page: number, pageCount: number, siblings = 1): Array<number | 'gap'> {
  if (pageCount <= 0) return [];
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - siblings; p <= page + siblings; p++) if (p >= 1 && p <= pageCount) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push('gap');
    out.push(p);
  }
  return out;
}

export interface PaginationProps extends Omit<React.ComponentProps<'nav'>, 'onChange'> {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  /** Link mode: URL for each page (preferred; works without JavaScript). */
  getHref?: (page: number) => string;
  linkComponent?: LinkComponent;
  /** Button mode: called with the new page. */
  onPageChange?: (page: number) => void;
  /** Show "1–25 of 312" when both are given. */
  total?: number;
  pageSize?: number;
  /** Noun for the summary, e.g. "applications". */
  itemLabel?: string;
}

/** Numbered pagination (GMS never uses infinite scroll). */
export function Pagination({
  page,
  pageCount,
  getHref,
  linkComponent,
  onPageChange,
  total,
  pageSize,
  itemLabel = 'results',
  className,
  ...props
}: PaginationProps) {
  const pages = pageWindow(page, pageCount);
  const item = (p: number, label: React.ReactNode, opts: { current?: boolean; ariaLabel: string; disabled?: boolean }) => {
    const cls = cn(
      buttonVariants({ variant: opts.current ? 'outline' : 'ghost', size: 'sm' }),
      'min-w-8 px-2 tabular-nums',
      opts.current && 'pointer-events-none border-primary font-semibold',
      opts.disabled && 'pointer-events-none opacity-40',
    );
    if (opts.disabled) {
      return (
        <span className={cls} aria-disabled="true" aria-label={opts.ariaLabel}>
          {label}
        </span>
      );
    }
    if (getHref) {
      return (
        <AppLink href={getHref(p)} linkComponent={linkComponent} className={cls} aria-label={opts.ariaLabel} aria-current={opts.current ? 'page' : undefined}>
          {label}
        </AppLink>
      );
    }
    return (
      <button type="button" className={cls} aria-label={opts.ariaLabel} aria-current={opts.current ? 'page' : undefined} onClick={() => onPageChange?.(p)}>
        {label}
      </button>
    );
  };

  const summary =
    total !== undefined && pageSize !== undefined && total > 0
      ? `${((page - 1) * pageSize + 1).toLocaleString('en-US')}–${Math.min(page * pageSize, total).toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${itemLabel}`
      : null;

  return (
    <nav aria-label="Pagination" data-slot="pagination" className={cn('flex flex-wrap items-center justify-between gap-3', className)} {...props}>
      {summary ? <p className="text-sm tabular-nums text-muted-foreground">{summary}</p> : <span />}
      {pageCount > 1 ? (
        <ul className="flex items-center gap-1">
          <li>
            {item(page - 1, (
              <>
                <ChevronLeft aria-hidden="true" />
                <span className="hidden sm:inline">Previous</span>
              </>
            ), { ariaLabel: 'Previous page', disabled: page <= 1 })}
          </li>
          {pages.map((p, i) => (
            <li key={p === 'gap' ? `gap-${i}` : p}>
              {p === 'gap' ? (
                <span className="px-1 text-muted-foreground" aria-hidden="true">
                  …
                </span>
              ) : (
                item(p, p, { current: p === page, ariaLabel: p === page ? `Page ${p}, current page` : `Page ${p}` })
              )}
            </li>
          ))}
          <li>
            {item(page + 1, (
              <>
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden="true" />
              </>
            ), { ariaLabel: 'Next page', disabled: page >= pageCount })}
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
