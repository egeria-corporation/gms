// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Actor } from '@gms/domain';
import { Bot, Cog } from 'lucide-react';
import * as React from 'react';
import { PersonAvatar } from '../components/avatar';
import { cn } from '../lib/utils';

export interface ActorBadgeProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  actor: Pick<Actor, 'type' | 'name' | 'onBehalfOfName'>;
  avatarUrl?: string | null;
  size?: 'sm' | 'default';
  /** Hide the "acting for …" line for agents (e.g. in dense tables where it's a column). */
  hideOnBehalfOf?: boolean;
}

/**
 * Who did something. Humans: avatar + name. Agents: bot glyph + name + "Agent" pill + "acting for {person}".
 * System: gear + "GMS (system)". People can always tell a person from software.
 */
export function ActorBadge({ actor, avatarUrl, size = 'default', hideOnBehalfOf = false, className, ...props }: ActorBadgeProps) {
  const glyph = size === 'sm' ? 'size-5' : 'size-6';
  const text = size === 'sm' ? 'text-xs' : 'text-sm';
  if (actor.type === 'human') {
    return (
      <span data-slot="actor-badge" data-actor="human" className={cn('inline-flex min-w-0 items-center gap-2', text, className)} {...props}>
        <PersonAvatar name={actor.name} src={avatarUrl} decorative className={cn(glyph, 'text-[10px]')} />
        <span className="truncate font-medium">{actor.name}</span>
      </span>
    );
  }
  if (actor.type === 'system') {
    return (
      <span data-slot="actor-badge" data-actor="system" className={cn('inline-flex items-center gap-2', text, className)} {...props}>
        <span className={cn('grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground', glyph)} aria-hidden="true">
          <Cog className="size-3.5" />
        </span>
        <span className="font-medium">GMS (system)</span>
      </span>
    );
  }
  return (
    <span data-slot="actor-badge" data-actor="agent" className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5', text, className)} {...props}>
      <span
        className={cn('grid shrink-0 place-items-center rounded-md border border-status-agent-border bg-status-agent-bg text-status-agent-fg', glyph)}
        aria-hidden="true"
      >
        <Bot className="size-3.5" />
      </span>
      <span className="truncate font-medium">{actor.name}</span>
      <span className="rounded-sm border border-status-agent-border bg-status-agent-bg px-1 text-[10px] leading-4 font-semibold tracking-wide text-status-agent-fg uppercase">
        Agent
      </span>
      {actor.onBehalfOfName && !hideOnBehalfOf ? (
        <span className="truncate text-muted-foreground">acting for {actor.onBehalfOfName}</span>
      ) : null}
    </span>
  );
}
