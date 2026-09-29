// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { Breadcrumb, type BreadcrumbItem } from '../components/breadcrumb';
import type { LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';

export interface PageHeaderProps extends Omit<React.ComponentProps<'header'>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  linkComponent?: LinkComponent;
  /** Buttons on the right (primary action last). */
  actions?: React.ReactNode;
  /** Chips next to the title (status, deadline). */
  meta?: React.ReactNode;
  /** 'spacious' for applicant/reviewer pages. */
  density?: 'compact' | 'spacious';
}

/** Page title block. Renders the page's single <h1>. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  linkComponent,
  actions,
  meta,
  density = 'compact',
  className,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn('grid gap-3', density === 'spacious' ? 'pb-8' : 'pb-5', className)} {...props}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} linkComponent={linkComponent} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1
              className={cn(
                'font-heading font-semibold tracking-tight text-foreground',
                density === 'spacious' ? 'text-3xl leading-tight' : 'text-2xl leading-tight',
              )}
            >
              {title}
            </h1>
            {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
          </div>
          {description ? (
            <p className={cn('max-w-3xl text-muted-foreground', density === 'spacious' ? 'text-base' : 'text-sm')}>{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
