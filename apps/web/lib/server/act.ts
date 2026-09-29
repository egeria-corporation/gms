// SPDX-License-Identifier: AGPL-3.0-or-later
// The single way UI server actions mutate data: build the human ActionContext for this request and run the
// action through the executor (validation, roles, RLS, audit, outbox).
import 'server-only';
import { getRuntime, type ActionContext, type ExecuteResult } from '@gms/actions';
import { DomainError, isDomainError, toProblem, type ProblemDetails } from '@gms/domain';
import { getViewer } from '../auth';
import { getTenant, requestMeta } from '../tenant';
import { kickOutbox } from './outbox';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; problem: ProblemDetails };

export async function humanContext(opts: { idempotencyKey?: string | null } = {}): Promise<ActionContext> {
  const [viewer, tenant, meta] = await Promise.all([getViewer(), getTenant(), requestMeta()]);
  return {
    workspace: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone } : null,
    actor: viewer ? { type: 'human', id: viewer.userId, name: viewer.name } : { type: 'human', id: null, name: 'Visitor' },
    roles: viewer?.roles ?? [],
    scopes: '*',
    claims: viewer ? viewer.session.claims : { role: 'anon' },
    aal: viewer?.session.aal ?? 'aal1',
    stepUpAt: viewer?.session.mfaAt ?? null,
    requestId: meta.requestId,
    channel: 'ui',
    ip: meta.ip,
    userAgent: meta.userAgent,
    idempotencyKey: opts.idempotencyKey ?? null,
  };
}

export async function act<T = unknown>(actionId: string, input: unknown, opts: { idempotencyKey?: string | null } = {}): Promise<ActionResult<T>> {
  try {
    const ctx = await humanContext(opts);
    const r: ExecuteResult<T> = await getRuntime().executor.execute<T>(actionId, input, ctx);
    kickOutbox();
    if (r.status === 'approval_required') {
      return { ok: false, problem: toProblem(new DomainError('approval_required', 'A person needs to confirm this.', { approvalRequestId: r.approvalRequestId, confirmUrl: r.confirmUrl })) };
    }
    return { ok: true, data: r.output };
  } catch (err) {
    if (!isDomainError(err)) console.error(`[act] ${actionId} failed`, err);
    return { ok: false, problem: toProblem(err) };
  }
}

/** Throws a DomainError-shaped error for use inside Server Components / route handlers. */
export async function actOrThrow<T = unknown>(actionId: string, input: unknown): Promise<T> {
  const r = await act<T>(actionId, input);
  if (!r.ok) throw Object.assign(new Error(r.problem.detail), { problem: r.problem });
  return r.data;
}
