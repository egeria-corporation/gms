// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const overlayClasses =
  'fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out dark:bg-black/60';

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn(overlayClasses, className)} {...props} />;
}

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Hide the corner close button (e.g. when the footer has an explicit Cancel). */
  hideClose?: boolean;
  size?: 'sm' | 'default' | 'lg' | 'xl';
}

export function DialogContent({ className, children, hideClose = false, size = 'default', ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto',
          'rounded-lg border bg-popover p-6 text-popover-foreground shadow-overlay',
          'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          size === 'sm' && 'max-w-sm',
          size === 'default' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
          size === 'xl' && 'max-w-4xl',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-3 right-3 grid size-8 place-items-center rounded-md text-muted-foreground',
              'transition-colors duration-150 hover:bg-accent hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('grid gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
