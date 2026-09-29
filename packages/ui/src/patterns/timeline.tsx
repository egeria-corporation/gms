// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatInZone, relativeTime, type Actor, type Tone } from '@gms/domain';
import * as React from 'react';
import { cn } from '../lib/utils';
import { ActorBadge } from './actor-badge';

export interface TimelineEvent {
  id: string;
  actor: Pick<Actor, 'type' | 'name' | 'onBehalfOfName'>;
  /** What happened, e.g. "moved the application to Under review". */
  action: React.ReactNode;
  /** ISO timestamp. */
  at: string;
  /** Extra content: a diff, a quote, a comment. */
  detail?: React.ReactNode;
  /** Optional icon element for the rail dot. */
  icon?: React.ReactNode;
  tone?: Tone;
}

export interface TimelineProps extends Omit<React.ComponentProps<'ol'>, 'children'> {
  events: TimelineEvent[];
  /** Workspace timezone for exact times. */
  timeZone: string;
  /** Reference time for relative labels (pass from the server). */
  now?: Date;
}

const DOT: Record<Tone, string> = {
  success: 'bg-status-success-fg',
  warning: 'bg-status-warning-fg',
  danger: 'bg-status-danger-fg',
  info: 'bg-status-info-fg',
  progress: 'bg-status-progress-fg',
  neutral: 'bg-status-neutral-fg',
  muted: 'bg-border',
  agent: 'bg-status-agent-fg',
};

/** Chronological activity with who did it (person, agent acting for a person, or system). */
export function Timeline({ events, timeZone, now, className, ...props }: TimelineProps) {
  return (
    <ol data-slot="timeline" className={cn('relative grid gap-5', className)} {...props}>
      {events.map((e, i) => (
        <li key={e.id} className="relative grid grid-cols-[1.25rem_1fr] gap-3">
          {i < events.length - 1 ? <span aria-hidden="true" className="absolute top-5 bottom-[-1.25rem] left-[0.5625rem] w-px bg-border" /> : null}
          <span aria-hidden="true" className="relative z-[1] mt-1 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground [&>svg]:size-3">
            {e.icon ?? <span className={cn('size-2 rounded-full', DOT[e.tone ?? 'muted'])} />}
          </span>
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <ActorBadge actor={e.actor} size="sm" />
              <span className="text-foreground">{e.action}</span>
            </div>
            <time dateTime={e.at} className="text-xs text-muted-foreground tabular-nums" title={formatInZone(e.at, timeZone)}>
              {now ? `${relativeTime(e.at, now)} · ` : ''}
              {formatInZone(e.at, timeZone)}
            </time>
            {e.detail ? <div className="text-sm">{e.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
