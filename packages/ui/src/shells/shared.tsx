// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn, initials } from '../lib/utils';

export interface NavItem {
  label: string;
  href: string;
  /** Rendered icon element, e.g. <Inbox />. (An element, not a component, so it can cross the server/client boundary.) */
  icon?: React.ReactNode;
  /** Count or small badge after the label. */
  badge?: React.ReactNode;
  /** Force active state; otherwise derived from currentPath. */
  active?: boolean;
  /** Only active on an exact path match (e.g. "/"). */
  exact?: boolean;
}

export interface NavGroup {
  /** Module name, e.g. "Grantmaking". Omit for an unlabeled first group. */
  label?: string;
  items: NavItem[];
}

export interface ShellBrand {
  name: string;
  logoUrl?: string | null;
  /** Home link. Default "/". */
  href?: string;
}

export function isNavActive(item: NavItem, currentPath: string | undefined): boolean {
  if (item.active !== undefined) return item.active;
  if (!currentPath) return false;
  const path = currentPath.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  const href = item.href.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (item.exact || href === '/') return path === href;
  return path === href || path.startsWith(`${href}/`);
}

/** Logo (with the org name as alt text) or the name set in the heading font. */
export function BrandMark({
  brand,
  linkComponent,
  className,
  size = 'default',
}: {
  brand: ShellBrand;
  linkComponent?: LinkComponent | undefined;
  className?: string;
  size?: 'sm' | 'default' | 'lg';
}) {
  const h = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-10' : 'h-8';
  return (
    <AppLink
      href={brand.href ?? '/'}
      linkComponent={linkComponent}
      className={cn('inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-md', className)}
    >
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt={brand.name} className={cn(h, 'w-auto max-w-48 object-contain')} />
      ) : (
        <>
          <span aria-hidden="true" className={cn(h, 'grid aspect-square place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground')}>
            {initials(brand.name)}
          </span>
          <span className="truncate font-heading text-base font-semibold">{brand.name}</span>
        </>
      )}
    </AppLink>
  );
}
