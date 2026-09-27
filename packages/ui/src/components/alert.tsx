// SPDX-License-Identifier: AGPL-3.0-only
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { toneClasses } from './badge';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const ICONS: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const PREFIX: Record<AlertVariant, string> = {
  info: 'Information',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error',
};

export interface AlertProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  variant?: AlertVariant;
  title?: React.ReactNode;
  /** Replace the default icon. */
  icon?: React.ReactNode;
  /** Actions (buttons/links) shown under the text. */
  actions?: React.ReactNode;
}

/**
 * Inline message with icon + text + color. Static by default; pass role="alert" (assertive) or
 * role="status" (polite) when it appears in response to an action.
 */
export function Alert({ variant = 'info', title, icon, actions, className, children, ...props }: AlertProps) {
  const Icon = ICONS[variant];
  return (
    <div data-slot="alert" data-variant={variant} className={cn('flex gap-3 rounded-lg border p-4 text-sm', toneClasses[variant], className)} {...props}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-4.5" aria-hidden="true">
        {icon ?? <Icon />}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="sr-only">{PREFIX[variant]}: </span>
        {title ? <p className="font-semibold leading-snug">{title}</p> : null}
        {children ? <div className="leading-relaxed text-foreground/90 [&_a]:font-medium [&_a]:underline">{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
