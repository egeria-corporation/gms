// SPDX-License-Identifier: AGPL-3.0-or-later
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

export interface PublicShellProps {
  brand: ShellBrand;
  nav?: NavItem[];
  currentPath?: string;
  linkComponent?: LinkComponent;
  /** Right side of the header, e.g. a "Sign in" button. */
  headerActions?: React.ReactNode;
  /** Extra footer content (contact, address, policies) above the Powered by line. */
  footer?: React.ReactNode;
  poweredBy: PoweredByFooterProps;
  /** Full-width content above the main container (e.g. a hero with BrandPattern). */
  hero?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Branded public site: header with logo and nav, mobile menu in a sheet, footer with "Powered by GMS". */
export function PublicShell({
  brand,
  nav = [],
  currentPath,
  linkComponent,
  headerActions,
  footer,
  poweredBy,
  hero,
  children,
  className,
}: PublicShellProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <div data-surface="branded" className={cn('flex min-h-dvh flex-col bg-background text-foreground', className)}>
      <SkipLink />
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <BrandMark brand={brand} linkComponent={linkComponent} />
          {nav.length > 0 ? (
            <nav aria-label="Main" className="ml-6 hidden md:block">
              <ul className="flex items-center gap-1">
                {nav.map((item) => {
                  const active = isNavActive(item, currentPath);
                  return (
                    <li key={item.href}>
                      <AppLink
                        href={item.href}
                        linkComponent={linkComponent}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150',
                          active ? 'text-foreground underline decoration-primary decoration-2 underline-offset-8' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {item.label}
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {headerActions}
            {nav.length > 0 ? (
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="Open menu">
                    <Menu aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>{brand.name}</SheetTitle>
                    <SheetDescription className="sr-only">Site navigation</SheetDescription>
                  </SheetHeader>
                  <SheetBody>
                    <nav aria-label="Main">
                      <ul className="grid gap-1">
                        {nav.map((item) => {
                          const active = isNavActive(item, currentPath);
                          return (
                            <li key={item.href}>
                              <AppLink
                                href={item.href}
                                linkComponent={linkComponent}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => setMenuOpen(false)}
                                className={cn(
                                  'flex min-h-11 items-center rounded-md px-3 text-base font-medium',
                                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                                )}
                              >
                                {item.label}
                              </AppLink>
                            </li>
                          );
                        })}
                      </ul>
                    </nav>
                  </SheetBody>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        </div>
      </header>
      {hero}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12">
        {children}
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6">
          {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
          <PoweredByFooter {...poweredBy} />
        </div>
      </footer>
    </div>
  );
}
