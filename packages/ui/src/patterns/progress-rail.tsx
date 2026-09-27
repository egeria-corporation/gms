// SPDX-License-Identifier: AGPL-3.0-only
import { Circle, CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import * as React from 'react';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';

export type RailPageStatus = 'not_started' | 'in_progress' | 'complete' | 'error';

export interface RailPage {
  id: string;
  title: string;
  status: RailPageStatus;
  /** 0–1 share of required questions answered (shown as a percent for in-progress pages). */
  completion?: number;
  href?: string;
}

export interface ProgressRailProps extends Omit<React.ComponentProps<'nav'>, 'onSelect'> {
  pages: RailPage[];
  currentId: string;
  linkComponent?: LinkComponent;
  /** Button mode when pages have no href. */
  onSelect?: (id: string) => void;
  label?: string;
}

const STATUS = {
  complete: { icon: CircleCheck, text: 'Complete', cls: 'text-status-success-fg' },
  in_progress: { icon: CircleDashed, text: 'In progress', cls: 'text-status-progress-fg' },
  error: { icon: CircleAlert, text: 'Needs attention', cls: 'text-status-danger-fg' },
  not_started: { icon: Circle, text: 'Not started', cls: 'text-muted-foreground' },
} as const;

/** Multi-page form progress: each page's completion and where you are now. */
export function ProgressRail({ pages, currentId, linkComponent, onSelect, label = 'Form sections', className, ...props }: ProgressRailProps) {
  const done = pages.filter((p) => p.status === 'complete').length;
  return (
    <nav aria-label={label} data-slot="progress-rail" className={cn('grid gap-3', className)} {...props}>
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">
          {done} of {pages.length} sections complete
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${pages.length ? (done / pages.length) * 100 : 0}%` }} />
        </div>
      </div>
      <ol className="grid gap-0.5">
        {pages.map((p, i) => {
          const s = STATUS[p.status];
          const current = p.id === currentId;
          const pct = p.status === 'in_progress' && p.completion !== undefined ? Math.round(p.completion * 100) : null;
          const inner = (
            <>
              <s.icon className={cn('mt-0.5 size-4.5 shrink-0', s.cls)} aria-hidden="true" />
              <span className="grid min-w-0 flex-1 gap-0.5 text-left">
                <span className={cn('leading-snug', current ? 'font-semibold text-foreground' : 'text-foreground/90')}>
                  <span className="sr-only">Section {i + 1}: </span>
                  {p.title}
                </span>
                <span className={cn('text-xs', s.cls)}>
                  {s.text}
                  {pct !== null ? ` · ${pct}%` : ''}
                </span>
              </span>
            </>
          );
          const cls = cn(
            'flex min-h-11 w-full items-start gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors duration-150',
            current ? 'border-primary bg-accent' : 'border-transparent hover:bg-muted',
          );
          return (
            <li key={p.id}>
              {p.href ? (
                <AppLink href={p.href} linkComponent={linkComponent} className={cls} aria-current={current ? 'step' : undefined}>
                  {inner}
                </AppLink>
              ) : onSelect ? (
                <button type="button" className={cls} aria-current={current ? 'step' : undefined} onClick={() => onSelect(p.id)}>
                  {inner}
                </button>
              ) : (
                <div className={cls} aria-current={current ? 'step' : undefined}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
