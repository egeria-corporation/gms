// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';

/**
 * Toasts confirm what just happened ("Saved", "Invitation sent"). They are announced politely.
 * Never use a toast as the only place an error is shown; put errors inline too.
 */
export function Toaster({ theme = 'system', ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      duration={5000}
      icons={{
        success: <CircleCheck className="size-4 text-status-success-fg" aria-hidden="true" />,
        info: <Info className="size-4 text-status-info-fg" aria-hidden="true" />,
        warning: <TriangleAlert className="size-4 text-status-warning-fg" aria-hidden="true" />,
        error: <CircleAlert className="size-4 text-status-danger-fg" aria-hidden="true" />,
        loading: <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'group rounded-lg! border! border-border! bg-popover! text-popover-foreground! shadow-overlay! font-sans! text-sm!',
          description: 'text-muted-foreground!',
          actionButton: 'bg-primary! text-primary-foreground!',
          cancelButton: 'bg-muted! text-foreground!',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { toast };
