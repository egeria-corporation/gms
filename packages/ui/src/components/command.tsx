// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Kbd } from './kbd';

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground', className)}
      {...props}
    />
  );
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-12 items-center gap-2 border-b px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn('flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50', className)}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn('max-h-[min(60dvh,26rem)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1', className)} {...props} />;
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-8 text-center text-sm text-muted-foreground" {...props} />;
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn('-mx-1 h-px bg-border', className)} {...props} />;
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-9 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />;
}

export interface CommandPaletteItem {
  id: string;
  label: string;
  /** Rendered icon element, e.g. <FileText />. */
  icon?: React.ReactNode;
  /** Secondary text (record type, program name…). */
  hint?: string;
  keywords?: string[];
  shortcut?: string;
  href?: string;
  onSelect?: () => void;
}

export interface CommandPaletteGroup {
  heading: string;
  items: CommandPaletteItem[];
}

const OPEN_EVENT = 'gms:open-command-palette';

/** Opens the mounted CommandPalette from anywhere (e.g. a search button in the top bar). */
export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

export function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

export interface CommandPaletteProps {
  groups: CommandPaletteGroup[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called for items with an href (pass your router's push). Defaults to a full page load. */
  onNavigate?: (href: string) => void;
  /** For server-side search: called as the query changes. Disables client filtering when set. */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
  /** Listen for ⌘K / Ctrl+K. Default true. */
  shortcut?: boolean;
  title?: string;
}

/** Global command palette in a dialog. Opens with ⌘K / Ctrl+K or openCommandPalette(). */
export function CommandPalette({
  groups,
  open: openProp,
  onOpenChange,
  onNavigate,
  onQueryChange,
  loading = false,
  placeholder = 'Search or jump to…',
  emptyText = 'No matches. Try a name, ID or page.',
  shortcut = true,
  title = 'Command palette',
}: CommandPaletteProps) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcut && e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [shortcut, open, setOpen]);

  const run = (item: CommandPaletteItem) => {
    setOpen(false);
    if (item.onSelect) item.onSelect();
    else if (item.href) (onNavigate ?? ((h: string) => window.location.assign(h)))(item.href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-[15dvh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Type to search records and pages. Use arrow keys to choose, Enter to open.</DialogDescription>
        <Command shouldFilter={!onQueryChange} loop>
          <CommandInput placeholder={placeholder} aria-label="Search" onValueChange={onQueryChange} />
          <CommandList>
            {loading ? (
              <CommandPrimitive.Loading>
                <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
              </CommandPrimitive.Loading>
            ) : null}
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.items.map((item) => (
                  <CommandItem key={item.id} value={`${item.label} ${item.id}`} keywords={item.keywords} onSelect={() => run(item)}>
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.hint ? <span className="truncate text-xs text-muted-foreground">{item.hint}</span> : null}
                    {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to choose
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Enter</Kbd> to open
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd> to close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
