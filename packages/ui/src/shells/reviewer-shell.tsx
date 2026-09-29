// SPDX-License-Identifier: AGPL-3.0-or-later
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { SkipLink } from '../components/skip-link';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';
import { PoweredByFooter, type PoweredByFooterProps } from '../patterns/powered-by-footer';
import { BrandMark, type ShellBrand } from './shared';

export interface FocusedShellProps {
  brand: ShellBrand;
  linkComponent?: LinkComponent;
  /** What the person is working on, e.g. "Community Health Fund 2027 · Round 1". */
  context?: React.ReactNode;
  /** Progress summary, e.g. "4 of 12 reviewed". */
  progress?: React.ReactNode;
  /** Back/exit link, e.g. { href: '/review', label: 'All assignments' }. */
  exit?: { href: string; label: string };
  accountMenu?: React.ReactNode;
  /** Section navigation (board packets) shown above the content on narrow screens and as a left rail on wide ones. */
  sectionNav?: React.ReactNode;
  /** Side panel (rubric, scoring, notes). Sits beside the content from 1024px. */
  aside?: React.ReactNode;
  asideLabel?: string;
  poweredBy: PoweredByFooterProps;
  children: React.ReactNode;
  className?: string;
  surface?: 'reviewer' | 'board';
}

/** Shared layout for the focused, branded reviewer and board surfaces. Works from 1024px with a side panel. */
function FocusedShell({
  brand,
  linkComponent,
  context,
  progress,
  exit,
  accountMenu,
  sectionNav,
  aside,
  asideLabel = 'Scoring',
  poweredBy,
  children,
  className,
  surface = 'reviewer',
}: FocusedShellProps) {
  return (
    <div data-surface={surface} className={cn('flex min-h-dvh flex-col bg-background text-base text-foreground', className)}>
      <SkipLink />
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          {exit ? (
            <AppLink
              href={exit.href}
              linkComponent={linkComponent}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md pr-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {exit.label}
            </AppLink>
          ) : (
            <BrandMark brand={brand} linkComponent={linkComponent} size="sm" />
          )}
          {context ? <div className="min-w-0 truncate text-sm text-muted-foreground">{context}</div> : null}
          <div className="ml-auto flex items-center gap-3">
            {progress ? <div className="text-sm font-medium tabular-nums">{progress}</div> : null}
            {accountMenu}
          </div>
        </div>
      </header>
      <div
        className={cn(
          'mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:py-8',
          sectionNav && aside && 'lg:grid-cols-[13rem_minmax(0,1fr)_20rem] xl:grid-cols-[14rem_minmax(0,1fr)_22rem]',
          sectionNav && !aside && 'lg:grid-cols-[14rem_minmax(0,1fr)]',
          !sectionNav && aside && 'lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]',
        )}
      >
        {sectionNav ? <div className="lg:sticky lg:top-24 lg:self-start">{sectionNav}</div> : null}
        <main id="main" tabIndex={-1} className="min-w-0 outline-none">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
        {aside ? (
          <aside aria-label={asideLabel} className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
            {aside}
          </aside>
        ) : null}
      </div>
      <footer className="border-t bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <PoweredByFooter {...poweredBy} />
        </div>
      </footer>
    </div>
  );
}

export type ReviewerShellProps = Omit<FocusedShellProps, 'surface'>;

/** Reviewer workspace: focused and spacious, application on the left, rubric in the side panel. */
export function ReviewerShell(props: ReviewerShellProps) {
  return <FocusedShell {...props} surface="reviewer" />;
}

export type BoardShellProps = Omit<FocusedShellProps, 'surface'>;

/** Board member portal: same focused layout as reviewers, typically with packet section nav. */
export function BoardShell({ asideLabel = 'Notes and votes', ...props }: BoardShellProps) {
  return <FocusedShell {...props} asideLabel={asideLabel} surface="board" />;
}
