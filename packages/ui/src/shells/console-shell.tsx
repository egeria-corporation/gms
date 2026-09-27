// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Inbox, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import * as React from 'react';
import { Button } from '../components/button';
import { isMacLike, openCommandPalette } from '../components/command';
import { Kbd } from '../components/kbd';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../components/sheet';
import { SkipLink } from '../components/skip-link';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip';
import { AppLink, type LinkComponent } from '../lib/link';
import { cn } from '../lib/utils';
import { PoweredByFooter, type PoweredByFooterProps } from '../patterns/powered-by-footer';
import { BrandMark, isNavActive, type NavGroup, type NavItem, type ShellBrand } from './shared';

export interface ConsoleShellProps {
  /** Workspace name/logo (the console only takes logo, accent and ring from the brand). */
  workspace: ShellBrand;
  nav: NavGroup[];
  currentPath?: string;
  linkComponent?: LinkComponent;
  /** Replaces the workspace mark at the top of the sidebar (e.g. a switcher dropdown). */
  workspaceSwitcher?: React.ReactNode;
  userMenu?: React.ReactNode;
  notifications?: React.ReactNode;
  /** Light/dark toggle (the app owns theme state, e.g. next-themes). */
  themeToggle?: React.ReactNode;
  /** Approval inbox link with a count of requests waiting for this person. */
  approvalInbox?: { href: string; count: number };
  /** Mount a <CommandPalette/> here; the search button and ⌘K open it. */
  commandPalette?: React.ReactNode;
  searchLabel?: string;
  /** Sidebar collapse state (uncontrolled when omitted; remembered in this browser). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  poweredBy?: PoweredByFooterProps;
  children: React.ReactNode;
  className?: string;
}

const STORAGE_KEY = 'gms:sidebar-collapsed';

function SidebarNav({
  nav,
  currentPath,
  linkComponent,
  collapsed,
  onNavigate,
}: {
  nav: NavGroup[];
  currentPath?: string | undefined;
  linkComponent?: LinkComponent | undefined;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const baseId = React.useId();
  const renderItem = (item: NavItem) => {
    const active = isNavActive(item, currentPath);
    const link = (
      <AppLink
        href={item.href}
        linkComponent={linkComponent}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'relative flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors duration-150',
          '[&_svg]:size-4 [&_svg]:shrink-0',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-0.5 before:rounded-full before:bg-console-accent'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        {item.icon ? <span aria-hidden="true" className="grid place-items-center">{item.icon}</span> : null}
        <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
        {item.badge !== undefined && item.badge !== null ? (
          collapsed ? (
            <span aria-hidden="true" className="absolute top-1 right-1.5 size-1.5 rounded-full bg-console-accent" />
          ) : (
            <span className="ml-auto rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{item.badge}</span>
          )
        ) : null}
        {collapsed && item.badge !== undefined && item.badge !== null ? <span className="sr-only">({item.badge})</span> : null}
      </AppLink>
    );
    return (
      <li key={item.href}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        )}
      </li>
    );
  };
  return (
    <nav aria-label="Console" className="grid gap-4">
      {nav.map((group, gi) => {
        const labelId = `${baseId}-g${gi}`;
        return (
          <div key={group.label ?? gi} className="grid gap-1">
            {group.label ? (
              <p id={labelId} className={cn('px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase', collapsed && 'sr-only')}>
                {group.label}
              </p>
            ) : null}
            <ul className="grid gap-0.5" aria-labelledby={group.label ? labelId : undefined}>
              {group.items.map(renderItem)}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Staff console: dense, collapsible sidebar grouped by module, top bar with search (⌘K),
 * approval inbox, notifications, theme and user menus. Mobile: the sidebar opens in a sheet.
 */
export function ConsoleShell({
  workspace,
  nav,
  currentPath,
  linkComponent,
  workspaceSwitcher,
  userMenu,
  notifications,
  themeToggle,
  approvalInbox,
  commandPalette,
  searchLabel = 'Search',
  collapsed: collapsedProp,
  onCollapsedChange,
  poweredBy,
  children,
  className,
}: ConsoleShellProps) {
  const [inner, setInner] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => {
    setMac(isMacLike());
    if (collapsedProp !== undefined) return;
    try {
      setInner(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* storage unavailable: keep default */
    }
  }, [collapsedProp]);
  const collapsed = collapsedProp ?? inner;
  const setCollapsed = (next: boolean) => {
    if (collapsedProp === undefined) {
      setInner(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    }
    onCollapsedChange?.(next);
  };
  const sidebarId = React.useId();

  return (
    <TooltipProvider>
      <div data-surface="console" className={cn('flex min-h-dvh bg-background text-sm text-foreground', className)}>
        <SkipLink />
        <aside
          id={sidebarId}
          aria-label="Sidebar"
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <div className={cn('flex h-12 items-center border-b border-sidebar-border px-3', collapsed && 'justify-center px-0')}>
            {workspaceSwitcher && !collapsed ? workspaceSwitcher : <BrandMark brand={workspace} linkComponent={linkComponent} size="sm" className={cn(collapsed && '[&>span:last-child]:sr-only')} />}
          </div>
          <div className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5' : 'px-3')}>
            <SidebarNav nav={nav} currentPath={currentPath} linkComponent={linkComponent} collapsed={collapsed} />
          </div>
          <div className={cn('grid gap-2 border-t border-sidebar-border p-2', collapsed && 'justify-center')}>
            <Button
              variant="ghost"
              size="sm"
              className={cn('justify-start text-muted-foreground', collapsed && 'size-8 justify-center px-0')}
              aria-expanded={!collapsed}
              aria-controls={sidebarId}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              <span className={cn(collapsed && 'sr-only')}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </Button>
            {poweredBy && !collapsed ? <PoweredByFooter {...poweredBy} className="justify-start px-2 text-[11px]" /> : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SheetDescription className="sr-only">Console sections</SheetDescription>
                <div className="flex h-12 items-center border-b border-sidebar-border px-3">
                  {workspaceSwitcher ?? <BrandMark brand={workspace} linkComponent={linkComponent} size="sm" />}
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <SidebarNav nav={nav} currentPath={currentPath} linkComponent={linkComponent} collapsed={false} onNavigate={() => setMobileOpen(false)} />
                </div>
                {poweredBy ? (
                  <div className="border-t border-sidebar-border p-3">
                    <PoweredByFooter {...poweredBy} className="justify-start" />
                  </div>
                ) : null}
              </SheetContent>
            </Sheet>

            <button
              type="button"
              onClick={openCommandPalette}
              className={cn(
                'inline-flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-[13px] text-muted-foreground shadow-soft',
                'transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              )}
              aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
            >
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{searchLabel}</span>
              <span className="hidden items-center gap-0.5 sm:inline-flex" aria-hidden="true">
                <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>

            <div className="ml-auto flex items-center gap-1">
              {approvalInbox ? (
                <AppLink
                  href={approvalInbox.href}
                  linkComponent={linkComponent}
                  aria-label={`Approval inbox, ${approvalInbox.count} waiting`}
                  className="relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Inbox className="size-4" aria-hidden="true" />
                  <span className="hidden lg:inline">Approvals</span>
                  {approvalInbox.count > 0 ? (
                    <span className="min-w-5 rounded-full bg-status-warning-bg px-1.5 text-center text-[11px] font-semibold tabular-nums text-status-warning-fg ring-1 ring-status-warning-border">
                      {approvalInbox.count > 99 ? '99+' : approvalInbox.count}
                    </span>
                  ) : null}
                </AppLink>
              ) : null}
              {notifications}
              {themeToggle}
              {userMenu}
            </div>
          </header>
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 outline-none sm:px-6">
            {children}
          </main>
        </div>
        {commandPalette}
      </div>
    </TooltipProvider>
  );
}
