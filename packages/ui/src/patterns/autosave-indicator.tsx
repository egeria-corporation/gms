// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { CircleAlert, CircleCheck, CloudOff, LoaderCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { useNow } from './use-now';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface AutosaveIndicatorProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  status: AutosaveStatus;
  /** When the last successful save finished. */
  savedAt?: Date | string | null;
  /** Shown with the error state, e.g. a "Try again" button. */
  onRetry?: () => void;
  /** Error detail, e.g. "Your session expired." */
  errorMessage?: string;
}

/** "2s ago", "5m ago", then clock time. */
export function formatSavedAgo(savedAt: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - savedAt.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `at ${savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Tells people their work is safe. The status word is announced politely; the ticking
 * "2s ago" is visible only, so screen readers aren't interrupted every second.
 */
export function AutosaveIndicator({ status, savedAt, onRetry, errorMessage, className, ...props }: AutosaveIndicatorProps) {
  const now = useNow(status === 'saved' ? 1000 : 60_000);
  const saved = savedAt ? (typeof savedAt === 'string' ? new Date(savedAt) : savedAt) : null;
  const view = {
    idle: { icon: null, text: saved ? 'Saved' : '', cls: 'text-muted-foreground' },
    saving: { icon: LoaderCircle, text: 'Saving…', cls: 'text-muted-foreground' },
    saved: { icon: CircleCheck, text: 'Saved', cls: 'text-muted-foreground' },
    offline: { icon: CloudOff, text: 'Offline — retrying', cls: 'text-status-warning-fg' },
    error: { icon: CircleAlert, text: "Couldn't save", cls: 'text-status-danger-fg' },
  }[status];
  const Icon = view.icon;
  return (
    <div data-slot="autosave" data-status={status} className={cn('inline-flex min-h-6 items-center gap-1.5 text-xs', view.cls, className)} {...props}>
      {Icon ? (
        <Icon className={cn('size-3.5 shrink-0', status === 'saving' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      ) : null}
      <span aria-live="polite" aria-atomic="true">
        {view.text}
        {status === 'error' && errorMessage ? <span>. {errorMessage}</span> : null}
      </span>
      {(status === 'saved' || status === 'idle') && saved ? (
        <span className="tabular-nums" aria-hidden="true">
          · {formatSavedAgo(saved, now)}
        </span>
      ) : null}
      {status === 'error' && onRetry ? (
        <button type="button" onClick={onRetry} className="ml-1 min-h-6 rounded-sm font-medium underline underline-offset-2">
          Try again
        </button>
      ) : null}
    </div>
  );
}
