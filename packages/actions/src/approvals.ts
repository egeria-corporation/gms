// SPDX-License-Identifier: AGPL-3.0-only
// Confirming or rejecting an agent's R2 request. Confirmation always happens inside GMS, by a person.
import { createHash } from 'node:crypto';
import { sql, withRls, withService, type Database } from '@gms/db';
import { DomainError, type Actor } from '@gms/domain';
import type { ActionContext } from './define';
import type { Executor, ExecuteResult } from './executor';

export interface ApprovalDecisionInput {
  approvalRequestId: string;
  decision: 'confirm' | 'reject';
  /** Signed email-link token, when the person arrived from the confirmation email. */
  token?: string | null;
  note?: string | null;
}

export async function decideApproval(
  executor: Executor,
  database: Database,
  input: ApprovalDecisionInput,
  humanCtx: ActionContext,
): Promise<{ status: 'confirmed' | 'rejected' | 'failed'; result?: ExecuteResult<unknown>; error?: string }> {
  if (humanCtx.actor.type !== 'human' || !humanCtx.claims.sub) {
    throw new DomainError('human_only', 'Only a person can confirm or reject an agent request.');
  }
  const uid = humanCtx.claims.sub;
  const req = await withRls(
    humanCtx.claims,
    (trx) => trx.selectFrom('approval_requests').selectAll().where('id', '=', input.approvalRequestId).executeTakeFirst(),
    database,
  );
  if (!req) throw new DomainError('not_found', 'This request was not found or you cannot see it.');
  const isStaffDecider =
    req.audience === 'staff' && humanCtx.workspace?.id === req.workspace_id && humanCtx.roles.some((r) => r === 'owner' || r === 'admin');
  if (req.on_behalf_of !== uid && !isStaffDecider) {
    throw new DomainError('forbidden', 'Only the person this agent acts for can confirm this request.');
  }
  if (input.token) {
    const hash = createHash('sha256').update(input.token).digest('hex');
    if (hash !== req.token_hash) throw new DomainError('forbidden', 'This confirmation link is not valid.');
  }
  if (req.status !== 'awaiting_confirmation') {
    throw new DomainError('conflict', `This request is already ${req.status.replace(/_/g, ' ')}.`);
  }
  if (new Date(req.expires_at) < executor.deps.clock()) {
    await markApproval(database, req.id, 'expired', uid, null);
    throw new DomainError('conflict', 'This request expired. Ask the agent to try again.');
  }

  const auditDecision = async (status: string, extra: Record<string, unknown> = {}) => {
    await withService(async (trx) => {
      await sql`select gms_private.append_audit(${JSON.stringify({
        workspace_id: req.workspace_id,
        actor_type: 'human',
        actor_id: uid,
        actor_name: humanCtx.actor.name,
        action: `approval.${status}`,
        entity_type: 'approval_request',
        entity_id: req.id,
        after: { actionId: req.action_id, ...extra },
        risk_tier: 'R2',
        approval_request_id: req.id,
        ip: humanCtx.ip ?? null,
        user_agent: humanCtx.userAgent ?? null,
        request_id: humanCtx.requestId,
      })}::jsonb)`.execute(trx);
    }, database);
  };

  if (input.decision === 'reject') {
    await markApproval(database, req.id, 'rejected', uid, { note: input.note ?? null });
    await auditDecision('rejected', { note: input.note ?? null });
    return { status: 'rejected' };
  }

  // Load the requesting agent's identity so the audit log reads "<agent>, acting for <person>".
  const client = req.requested_by_client_id
    ? await database.selectFrom('agent_clients').select(['id', 'name']).where('id', '=', req.requested_by_client_id).executeTakeFirst()
    : null;
  const onBehalf = await database.selectFrom('profiles').select(['id', 'full_name', 'email']).where('id', '=', req.on_behalf_of).executeTakeFirst();
  const agentActor: Actor = {
    type: 'agent',
    id: client?.id ?? null,
    name: client?.name ?? req.requester_name,
    agentClientId: client?.id ?? null,
    onBehalfOf: req.on_behalf_of,
    onBehalfOfName: onBehalf?.full_name ?? onBehalf?.email ?? null,
  };
  const onBehalfClaims =
    req.on_behalf_of === uid
      ? humanCtx.claims
      : { role: 'authenticated' as const, sub: req.on_behalf_of, email: onBehalf?.email ?? undefined, aal: 'aal1' as const };
  await auditDecision('confirmed');
  try {
    const result = await executor.execute(req.action_id, req.input, {
      ...humanCtx,
      actor: agentActor,
      claims: onBehalfClaims,
      scopes: '*',
      approvalRequestId: req.id,
      idempotencyKey: `approval:${req.id}`,
    });
    await markApproval(database, req.id, 'confirmed', uid, result.status === 'ok' ? (result.output as object) : null);
    return { status: 'confirmed', result };
  } catch (err) {
    const message = (err as Error).message;
    await markApproval(database, req.id, 'failed', uid, { error: message });
    return { status: 'failed', error: message };
  }
}

async function markApproval(database: Database, id: string, status: string, decidedBy: string, result: object | null) {
  await withService(
    (trx) =>
      trx
        .updateTable('approval_requests')
        .set({ status, decided_by: decidedBy, decided_at: new Date().toISOString(), result: result ? JSON.stringify(result) : null })
        .where('id', '=', id)
        .execute(),
    database,
  );
}

/** Worker task: expire stale approval requests. */
export async function expireApprovals(database: Database, now = new Date()): Promise<number> {
  const r = await database
    .updateTable('approval_requests')
    .set({ status: 'expired' })
    .where('status', '=', 'awaiting_confirmation')
    .where('expires_at', '<', now.toISOString())
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}
