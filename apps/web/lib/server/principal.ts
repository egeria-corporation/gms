// SPDX-License-Identifier: AGPL-3.0-or-later
// Who is calling a machine endpoint: a bearer token (agent / API key / OAuth, resolved by @gms/agents) or the
// browser session.
import 'server-only';
import type { ActionContext } from '@gms/actions';
import { commonGrantsAgentContext, errorResponse } from '@gms/agents';
import type { Tenant } from '../tenant';
import { humanContext } from './act';
import { agentEnv } from './agent-env';

export type Principal = { kind: 'ok'; ctx: ActionContext; via: 'session' | 'token' | 'anon' } | { kind: 'error'; response: Response };

export async function principalFor(req: Request, _tenant: Tenant): Promise<Principal> {
  if (req.headers.get('authorization')) {
    try {
      const agent = await commonGrantsAgentContext(req, await agentEnv());
      if (agent) return { kind: 'ok', ctx: agent.actionContext, via: 'token' };
    } catch (err) {
      return { kind: 'error', response: errorResponse(err, new URL(req.url).pathname) };
    }
  }
  const ctx = await humanContext();
  return { kind: 'ok', ctx, via: ctx.claims.sub ? 'session' : 'anon' };
}
