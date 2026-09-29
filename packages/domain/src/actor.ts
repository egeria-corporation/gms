// SPDX-License-Identifier: AGPL-3.0-or-later
export type ActorType = 'human' | 'agent' | 'system';

export interface Actor {
  type: ActorType;
  /** Profile id for humans; agent_clients.id for agents; null for system. */
  id: string | null;
  name: string;
  /** For agents: the OAuth/agent client id (agent_clients.id). */
  agentClientId?: string | null;
  /** For agents acting for a person: that person's profile id. */
  onBehalfOf?: string | null;
  onBehalfOfName?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null, name: 'GMS' };

export function describeActor(a: Pick<Actor, 'type' | 'name' | 'onBehalfOfName'>): string {
  if (a.type === 'agent') return a.onBehalfOfName ? `${a.name}, acting for ${a.onBehalfOfName}` : `${a.name} (agent)`;
  if (a.type === 'system') return 'GMS (system)';
  return a.name;
}
