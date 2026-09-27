// SPDX-License-Identifier: AGPL-3.0-only
// Builds the @gms/agents environment for this request: the tenant from the host, the shared runtime, and the
// request id / client IP assigned by the proxy.
import 'server-only';
import { getRuntime } from '@gms/actions';
import type { AgentEnv } from '@gms/agents';
import { requestMeta, requireTenant } from '../tenant';

export async function agentEnv(): Promise<AgentEnv> {
  const [tenant, meta] = await Promise.all([requireTenant(), requestMeta()]);
  return {
    workspace: { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone },
    origin: tenant.origin,
    brandName: tenant.brand.displayName || tenant.name,
    runtime: getRuntime(),
    requestId: meta.requestId,
    ip: meta.ip,
  };
}

/** Rebuilds the request with the public URL the client used (the proxy may have rewritten the path). */
export async function publicRequest(req: Request): Promise<Request> {
  const meta = await requestMeta();
  const url = new URL(req.url);
  const original = new URL(meta.pathname + url.search, url);
  if (original.pathname === url.pathname) return req;
  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers: req.headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }
  return new Request(original, init);
}
