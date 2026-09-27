// SPDX-License-Identifier: AGPL-3.0-only
// Who is calling a machine endpoint: a bearer token (agent / API key / OAuth) or the browser session.
import 'server-only';
import type { ActionContext } from '@gms/actions';
import type { Tenant } from '../tenant';
import { humanContext } from './act';

export type Principal = { kind: 'ok'; ctx: ActionContext; via: 'session' | 'token' | 'anon' } | { kind: 'error'; response: Response };

export async function principalFor(req: Request, _tenant: Tenant): Promise<Principal> {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    // Bearer tokens are resolved by the agent layer (@gms/agents) once it is mounted.
    return {
      kind: 'error',
      response: Response.json(
        { type: 'https://gms.dev/problems/unauthenticated', title: 'Sign in required', status: 401, detail: 'Bearer tokens are not accepted on this endpoint yet.', code: 'unauthenticated' },
        { status: 401, headers: { 'content-type': 'application/problem+json' } },
      ),
    };
  }
  const ctx = await humanContext();
  return { kind: 'ok', ctx, via: ctx.claims.sub ? 'session' : 'anon' };
}
