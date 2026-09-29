// SPDX-License-Identifier: AGPL-3.0-or-later
// CommonGrants API (https://commongrants.org) for this tenant.
import { getRuntime } from '@gms/actions';
import { handleCommonGrants } from '@gms/commongrants';
import { principalFor } from '@/lib/server/principal';
import { requireTenant } from '@/lib/tenant';

async function handle(req: Request): Promise<Response> {
  const tenant = await requireTenant();
  const rt = getRuntime();
  const p = await principalFor(req, tenant);
  if (p.kind === 'error') return p.response;
  return handleCommonGrants(req, {
    workspace: { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone },
    origin: tenant.origin,
    db: rt.db,
    claims: p.ctx.claims,
    executor: { execute: (actionId, input, ctx) => rt.executor.execute(actionId, input, ctx as never) },
    actionContext: { ...p.ctx, channel: 'cg' },
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as HEAD };
