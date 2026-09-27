// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatInZone, relativeTime, type Tone } from '@gms/domain';
import { AlarmClock, CalendarClock, ClockAlert } from 'lucide-react';
import * as React from 'react';
import { toneClasses } from '../components/badge';
import { cn } from '../lib/utils';
import { useNow } from './use-now';

export const DEADLINE_WARNING_HOURS = 72;

export type DeadlineState = 'upcoming' | 'soon' | 'past';

export function deadlineTone(at: Date, now: Date, warningHours = DEADLINE_WARNING_HOURS): { state: DeadlineState; tone: Tone } {
  const ms = at.getTime() - now.getTime();
  if (ms < 0) return { state: 'past', tone: 'danger' };
  if (ms < warningHours * 3_600_000) return { state: 'soon', tone: 'warning' };
  return { state: 'upcoming', tone: 'neutral' };
}

export interface DeadlineChipProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** ISO timestamp of the deadline. */
  at: string | Date;
  /** Workspace IANA timezone, e.g. "America/Los_Angeles". */
  timeZone: string;
  /** Verb before the relative time. Default "Due" → "Due in 2 days". */
  label?: string;
  /** Verb once passed. Default "Closed" → "Closed 3 hours ago". */
  pastLabel?: string;
  /** Hide the exact time (it stays in the tooltip and for screen readers). */
  hideExact?: boolean;
  /** Server "now" for the first render. */
  now?: Date;
  warningHours?: number;
  size?: 'sm' | 'default';
}

/** Relative time + exact time in the workspace timezone. Warning under 72 hours, danger once past. */
export function DeadlineChip({
  at,
  timeZone,
  label = 'Due',
  pastLabel = 'Closed',
  hideExact = false,
  now: initialNow,
  warningHours,
  size = 'default',
  className,
  ...props
}: DeadlineChipProps) {
  const now = useNow(30_000, initialNow);
  const date = typeof at === 'string' ? new Date(at) : at;
  const { state, tone } = deadlineTone(date, now, warningHours);
  const Icon = state === 'past' ? AlarmClock : state === 'soon' ? ClockAlert : CalendarClock;
  const rel = relativeTime(date, now);
  const exact = formatInZone(date, timeZone);
  const text = `${state === 'past' ? pastLabel : label} ${rel}`;
  return (
    <span
      data-slot="deadline-chip"
      data-state={state}
      title={exact}
      className={cn(
        'inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border font-medium',
        size === 'sm' ? 'px-1.5 py-px text-[11px] [&>svg]:size-3' : 'px-2 py-0.5 text-xs [&>svg]:size-3.5',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      <span suppressHydrationWarning>{text}</span>
      <time dateTime={date.toISOString()} className={cn('font-normal tabular-nums opacity-90', hideExact && 'sr-only')}>
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, </span>
        {exact}
      </time>
    </span>
  );
}
