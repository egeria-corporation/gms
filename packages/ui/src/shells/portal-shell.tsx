// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Menu } from 'lucide-react';
import * as React from 'react';
import { Button } from '../components/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/sheet';
import { SkipLink } from '../components/skip-link';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';
import { PoweredByFooter, type PoweredByFooterProps } from '../patterns/powered-by-footer';
import { BrandMark, isNavActive, type NavItem, type ShellBrand } from './shared';

export interface PortalShellProps {
  brand: ShellBrand;
  /** Applicant navigation: e.g. My applications, Reports, Organization. */
  nav?: NavItem[];
  currentPath?: string;
  linkComponent?: LinkComponent;
  /** Account menu (name, organization switcher, sign out). */
  accountMenu?: React.ReactNode;
  /** A banner under the header (e.g. "Applications close Friday at 5 PM"). */
  notice?: React.ReactNode;
  poweredBy: PoweredByFooterProps;
  /** Footer help text, e.g. "Questions? Email grants@halcyon.example". */
  help?: React.ReactNode;
  /** Content width: 'narrow' for forms, 'wide' for dashboards. */
  width?: 'narrow' | 'wide';
  children: React.ReactNode;
  className?: string;
}

/** Applicant portal: branded, spacious, large touch targets, calm. */
export function PortalShell({
  brand,
  nav = [],
  currentPath,
  linkComponent,
  accountMenu,
  notice,
  poweredBy,
  help,
  width = 'wide',
  children,
  className,
}: PortalShellProps) {
  const [open, setOpen] = React.useState(false);
  const link = (item: NavItem, mobile: boolean) => {
    const active = isNavActive(item, currentPath);
    return (
      <AppLink
        href={item.href}
        linkComponent={linkComponent}
        aria-current={active ? 'page' : undefined}
        onClick={mobile ? () => setOpen(false) : undefined}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-medium transition-colors duration-150',
          mobile ? 'w-full text-base' : 'text-sm',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {item.icon ? <span aria-hidden="true" className="[&>svg]:size-4">{item.icon}</span> : null}
        {item.label}
        {item.badge !== undefined ? <span className="ml-auto rounded-full bg-muted px-2 text-xs tabular-nums">{item.badge}</span> : null}
      </AppLink>
    );
  };
  return (
    <div data-surface="portal" className={cn('flex min-h-dvh flex-col bg-background text-base text-foreground', className)}>
      <SkipLink />
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <BrandMark brand={brand} linkComponent={linkComponent} />
          {nav.length > 0 ? (
            <nav aria-label="Portal" className="ml-4 hidden md:block">
              <ul className="flex items-center gap-1">
                {nav.map((item) => (
                  <li key={item.href}>{link(item, false)}</li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {accountMenu}
            {nav.length > 0 ? (
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="Open menu">
                    <Menu aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>{brand.name}</SheetTitle>
                    <SheetDescription className="sr-only">Portal navigation</SheetDescription>
                  </SheetHeader>
                  <SheetBody>
                    <nav aria-label="Portal">
                      <ul className="grid gap-1">
                        {nav.map((item) => (
                          <li key={item.href}>{link(item, true)}</li>
                        ))}
                      </ul>
                    </nav>
                  </SheetBody>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        </div>
      </header>
      {notice ? <div className="border-b bg-accent text-accent-foreground">{<div className="mx-auto max-w-5xl px-4 py-3 text-sm sm:px-6">{notice}</div>}</div> : null}
      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto w-full flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12', width === 'narrow' ? 'max-w-3xl' : 'max-w-5xl')}
      >
        {children}
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-5xl gap-4 px-4 py-8 text-center sm:px-6">
          {help ? <div className="text-sm text-muted-foreground">{help}</div> : null}
          <PoweredByFooter {...poweredBy} />
        </div>
      </footer>
    </div>
  );
}
