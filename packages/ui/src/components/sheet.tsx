// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { X } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';
import { overlayClasses } from './dialog';

/** Side drawer: mobile navigation, filters, record previews. */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: 'right' | 'left' | 'bottom';
  hideClose?: boolean;
}

export function SheetContent({ className, children, side = 'right', hideClose = false, ...props }: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className={overlayClasses} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-popover text-popover-foreground shadow-overlay',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-[min(100%-3rem,26rem)] border-l data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-[min(100%-3rem,20rem)] border-r data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left',
          side === 'bottom' &&
            'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <SheetPrimitive.Close
            className={cn(
              'absolute top-3 right-3 grid size-10 place-items-center rounded-md text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('grid gap-1 border-b p-4 pr-14', className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('flex-1 overflow-y-auto px-4', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex gap-2 border-t p-4', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('font-heading text-base font-semibold', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
