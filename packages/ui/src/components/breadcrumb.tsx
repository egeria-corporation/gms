// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';

export interface BreadcrumbItem {
  label: React.ReactNode;
  /** Omit for the current page (last item). */
  href?: string;
}

export interface BreadcrumbProps extends React.ComponentProps<'nav'> {
  items: BreadcrumbItem[];
  linkComponent?: LinkComponent;
}

export function Breadcrumb({ items, linkComponent, className, ...props }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumb" className={className} {...props}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="inline-flex items-center gap-1">
              {item.href && !last ? (
                <AppLink
                  href={item.href}
                  linkComponent={linkComponent}
                  className="rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {item.label}
                </AppLink>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-medium text-foreground')}>
                  {item.label}
                </span>
              )}
              {last ? null : <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
