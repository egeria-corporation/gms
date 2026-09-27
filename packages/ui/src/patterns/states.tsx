// SPDX-License-Identifier: AGPL-3.0-only
import { CircleAlert, FileQuestion, Inbox, Lock, WifiOff, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface StateMessageProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  title: React.ReactNode;
  /** Plain explanation of what happened and why. */
  description?: React.ReactNode;
  /** The next step: a button or link. */
  action?: React.ReactNode;
  /** Secondary action (e.g. "Contact support"). */
  secondaryAction?: React.ReactNode;
  /** Replace the default icon. */
  icon?: LucideIcon;
  /** Heading level for the title (default 2). */
  level?: 2 | 3;
  /** 'page' fills a page body; 'inline' sits inside a card or table. */
  variant?: 'page' | 'inline';
}

function StateMessage({
  title,
  description,
  action,
  secondaryAction,
  icon: Icon = Inbox,
  level = 2,
  variant = 'inline',
  tone = 'muted',
  className,
  ...props
}: StateMessageProps & { tone?: 'muted' | 'danger' | 'warning' }) {
  const Heading = `h${level}` as const;
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center text-center',
        variant === 'page' ? 'gap-3 py-16' : 'gap-2 py-10',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mb-1 grid size-11 place-items-center rounded-full border',
          tone === 'muted' && 'bg-muted text-muted-foreground',
          tone === 'danger' && 'border-status-danger-border bg-status-danger-bg text-status-danger-fg',
          tone === 'warning' && 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
        )}
      >
        <Icon className="size-5" />
      </span>
      <Heading className={cn('font-heading font-semibold text-foreground', variant === 'page' ? 'text-xl' : 'text-base')}>{title}</Heading>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/** Nothing here yet. Say what will appear and how to add the first one. */
export function EmptyState(props: StateMessageProps) {
  return <StateMessage data-slot="empty-state" icon={Inbox} {...props} />;
}

/** Something failed. Say what, reassure about data, and offer "Try again". Announced to screen readers. */
export function ErrorState({ title = 'Something went wrong', ...props }: Partial<StateMessageProps>) {
  return <StateMessage data-slot="error-state" role="alert" tone="danger" icon={CircleAlert} title={title} {...props} />;
}

/** The person lacks permission. Say who can grant access. */
export function DeniedState({ title = "You don't have access to this page", ...props }: Partial<StateMessageProps>) {
  return <StateMessage data-slot="denied-state" tone="warning" icon={Lock} title={title} {...props} />;
}

/** The record or page doesn't exist (or was removed). */
export function NotFoundState({ title = "We couldn't find that page", ...props }: Partial<StateMessageProps>) {
  return <StateMessage data-slot="not-found-state" icon={FileQuestion} title={title} {...props} />;
}

/** No connection. Reassure that work is saved locally where true, and that GMS will retry. */
export function OfflineState({ title = "You're offline", ...props }: Partial<StateMessageProps>) {
  return <StateMessage data-slot="offline-state" role="status" tone="warning" icon={WifiOff} title={title} {...props} />;
}
