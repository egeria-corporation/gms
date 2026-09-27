// SPDX-License-Identifier: AGPL-3.0-only
// The single path for every mutation: UI server actions, /api/v1, MCP, A2A, CommonGrants apply routes, workers.
import { createHash, randomBytes } from 'node:crypto';
import { getDb, sql, withRls, withService, type Database, type Tx } from '@gms/db';
import {
  DomainError,
  fromPgError,
  isDomainError,
  maxTier,
  TIER_ORDER,
  type FieldIssue,
  type RiskTier,
  type Scope,
  type WorkspaceRole,
} from '@gms/domain';
import { z } from 'zod';
import type { ActionContext, AnyAction, ApprovalPreview, AuditEntry, RunContext } from './define';
import { getAction } from './define';
import type { ActionDeps } from './deps';

export type ExecuteResult<O> =
  | { status: 'ok'; output: O; replayed?: boolean }
  | { status: 'approval_required'; approvalRequestId: string; confirmUrl: string; expiresAt: string; preview: ApprovalPreview };

export interface Executor {
  execute<O = unknown>(actionId: string, input: unknown, ctx: ActionContext): Promise<ExecuteResult<O>>;
  /** Convenience for callers that expect a direct result (throws on approval_required). */
  run<O = unknown>(actionId: string, input: unknown, ctx: ActionContext): Promise<O>;
  /** Effective tier after workspace overrides (raise-only; R3 is never lowered). */
  effectiveTier(action: AnyAction, ctx: Pick<ActionContext, 'workspace'>, db?: Database): Promise<RiskTier>;
  deps: ActionDeps;
}

export function zodIssues(err: z.ZodError): FieldIssue[] {
  return err.issues.map((i) => ({
    pointer: '/' + i.path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'),
    message: i.message,
  }));
}

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
}

function roleAllowed(action: AnyAction, ctx: ActionContext): boolean {
  if (ctx.actor.type === 'system') return true;
  const roles = action.roles;
  if (roles.includes('public')) return true;
  const signedIn = ctx.claims.role === 'authenticated' && Boolean(ctx.claims.sub);
  if (roles.includes('authenticated') && signedIn) return true;
  return ctx.roles.some((r) => roles.includes(r));
}

function missingScopes(action: AnyAction, ctx: ActionContext): Scope[] {
  if (ctx.scopes === '*' || ctx.actor.type === 'system') return [];
  const granted = new Set(ctx.scopes);
  return action.scopes.filter((s) => !granted.has(s));
}

export function createExecutor(deps: ActionDeps, opts: { db?: Database } = {}): Executor {
  const db = () => opts.db ?? getDb();
  const tierCache = new Map<string, { at: number; overrides: Record<string, RiskTier> }>();

  async function overridesFor(workspaceId: string, database: Database): Promise<Record<string, RiskTier>> {
    const cached = tierCache.get(workspaceId);
    if (cached && Date.now() - cached.at < 30_000) return cached.overrides;
    const row = await database
      .selectFrom('workspace_settings')
      .select('action_tier_overrides')
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    const overrides = (row?.action_tier_overrides ?? {}) as Record<string, RiskTier>;
    tierCache.set(workspaceId, { at: Date.now(), overrides });
    return overrides;
  }

  async function effectiveTier(action: AnyAction, ctx: Pick<ActionContext, 'workspace'>, database = db()): Promise<RiskTier> {
    if (!ctx.workspace) return action.riskTier;
    const override = (await overridesFor(ctx.workspace.id, database))[action.id];
    if (!override || !(override in TIER_ORDER)) return action.riskTier;
    // Raise-only. R3 can never be lowered (maxTier guarantees this).
    return maxTier(action.riskTier, override);
  }

  async function execute<O>(actionId: string, rawInput: unknown, ctx: ActionContext): Promise<ExecuteResult<O>> {
    const action = getAction(actionId);
    if (!action) throw new DomainError('not_found', `Unknown action "${actionId}".`);
    const database = db();

    // 1. Validate input.
    const parsed = action.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new DomainError('validation_failed', 'The input is not valid.', { action: actionId }, zodIssues(parsed.error));
    }
    const input = parsed.data;

    if (action.requiresWorkspace !== false && !ctx.workspace) {
      throw new DomainError('precondition_failed', `"${actionId}" needs a workspace context.`);
    }
    if (action.roles.length === 1 && action.roles[0] === 'system' && ctx.actor.type !== 'system') {
      throw new DomainError('forbidden', `"${action.title}" is run by the system only.`);
    }

    // 2. Authentication, roles and scopes.
    if (!action.roles.includes('public') && ctx.actor.type !== 'system' && !ctx.claims.sub) {
      throw new DomainError('unauthenticated', 'Sign in to do this.');
    }
    if (!roleAllowed(action, ctx)) {
      throw new DomainError('forbidden', `Your role cannot "${action.title.toLowerCase()}".`, {
        requiredRoles: action.roles,
      });
    }
    const missing = missingScopes(action, ctx);
    if (missing.length) {
      throw new DomainError('insufficient_scope', `This token is missing scope(s): ${action.scopes.join(' ')}.`, {
        requiredScopes: action.scopes,
        missingScopes: missing,
      });
    }

    // 3. Risk tier: agents never run R3; R2 needs a person's confirmation.
    const tier = await effectiveTier(action, ctx, database);
    if (ctx.actor.type === 'agent' && tier === 'R3') {
      throw new DomainError('human_only', `"${action.title}" can only be done by a person in GMS. Agents cannot be granted this.`, {
        riskTier: 'R3',
      });
    }
    if (action.stepUp && ctx.actor.type === 'human' && ctx.aal !== 'aal2') {
      throw new DomainError('step_up_required', 'Confirm with your authenticator app to continue.', { requiredAal: 'aal2' });
    }

    // 4. Idempotency replay.
    const idemKey = action.idempotent ? ctx.idempotencyKey : null;
    const reqHash = idemKey ? hashInput(input) : '';
    if (idemKey) {
      const prior = await database
        .selectFrom('idempotency_keys')
        .select(['request_hash', 'response'])
        .where('action_id', '=', actionId)
        .where('key', '=', idemKey)
        .executeTakeFirst();
      if (prior) {
        if (prior.request_hash !== reqHash) {
          throw new DomainError('idempotency_mismatch', 'This idempotency key was already used with different input.');
        }
        return { ...(prior.response as unknown as ExecuteResult<O>), replayed: true } as ExecuteResult<O>;
      }
    }

    const needsApproval = ctx.actor.type === 'agent' && tier === 'R2' && !ctx.approvalRequestId;

    const txn = async (trx: Tx): Promise<ExecuteResult<O>> => {
      const audits: AuditEntry[] = [];
      const events: { eventType: string; entity: { type: string; id: string | null }; payload?: Record<string, unknown> }[] = [];
      const rc: RunContext = {
        ...ctx,
        db: trx,
        deps,
        audit: (e) => audits.push(e),
        emit: (eventType, entity, payload) => events.push({ eventType, entity, payload }),
        now: () => deps.clock(),
      };

      let result: ExecuteResult<O>;
      if (needsApproval) {
        result = (await createApprovalRequest(action, input, rc, tier)) as ExecuteResult<O>;
      } else {
        const out = await action.run(input, rc);
        const checked = action.output.safeParse(out);
        if (!checked.success) {
          throw new DomainError('internal', `Action ${actionId} produced invalid output.`, { issues: zodIssues(checked.error) });
        }
        result = { status: 'ok', output: checked.data as O };
      }

      // 5. Audit (every non-read action) + outbox, in the same transaction.
      if (tier !== 'R0' || audits.length) {
        const entries = audits.length ? audits : [{ entityType: 'action', entityId: null, after: summarize(input) }];
        for (const e of entries) {
          await sql`select gms_private.append_audit(${JSON.stringify({
            workspace_id: ctx.workspace?.id ?? null,
            actor_type: ctx.actor.type,
            actor_id: ctx.actor.type === 'human' ? ctx.actor.id : ctx.actor.type === 'agent' ? ctx.actor.agentClientId : null,
            actor_name: ctx.actor.name,
            agent_client_id: ctx.actor.agentClientId ?? null,
            on_behalf_of: ctx.actor.onBehalfOf ?? null,
            on_behalf_of_name: ctx.actor.onBehalfOfName ?? null,
            action: e.action ?? (needsApproval ? `${actionId}.requested` : actionId),
            entity_type: e.entityType,
            entity_id: e.entityId,
            before: e.before ?? null,
            after: e.after ?? null,
            risk_tier: tier,
            approval_request_id:
              ctx.approvalRequestId ?? (result.status === 'approval_required' ? result.approvalRequestId : null),
            ip: ctx.ip ?? null,
            user_agent: ctx.userAgent ?? null,
            request_id: ctx.requestId,
          })}::jsonb)`.execute(trx);
        }
      }
      for (const ev of events) {
        await sql`select gms_private.enqueue_event(${ctx.workspace?.id ?? null}::uuid, ${ev.eventType}, ${ev.entity.type}, ${ev.entity.id}::uuid, ${JSON.stringify(
          { ...(ev.payload ?? {}), actor: { type: ctx.actor.type, name: ctx.actor.name, onBehalfOf: ctx.actor.onBehalfOf ?? null } },
        )}::jsonb)`.execute(trx);
      }
      if (idemKey) {
        await sql`select gms_private.store_idempotency(${idemKey}, ${actionId}, ${ctx.workspace?.id ?? null}::uuid, ${
          ctx.claims.sub ?? null
        }::uuid, ${reqHash}, ${JSON.stringify(result)}::jsonb)`.execute(trx);
      }
      return result;
    };

    try {
      if (ctx.actor.type === 'system') return await withService(txn, database);
      return await withRls(ctx.claims, txn, database);
    } catch (err) {
      if (isDomainError(err)) throw err;
      const mapped = fromPgError(err);
      if (mapped) throw mapped;
      throw err;
    }
  }

  async function createApprovalRequest(action: AnyAction, input: unknown, rc: RunContext, tier: RiskTier) {
    if (!rc.workspace) throw new DomainError('precondition_failed', 'Approvals need a workspace.');
    const onBehalfOf = rc.actor.onBehalfOf ?? rc.claims.sub;
    if (!onBehalfOf) throw new DomainError('forbidden', 'Agent actions must act for a person.');
    const preview: ApprovalPreview = action.preview
      ? await action.preview(input, rc)
      : { title: action.title, summary: action.description.split('\n')[0] ?? action.title, fields: [] };
    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(rc.now().getTime() + 72 * 3600_000).toISOString();
    const audience = rc.roles.some((r) => r !== 'reviewer' && r !== 'board') ? 'staff' : 'applicant';
    const row = await rc.db
      .insertInto('approval_requests')
      .values({
        workspace_id: rc.workspace.id,
        action_id: action.id,
        input: JSON.stringify(input),
        preview: JSON.stringify(preview),
        risk_tier: tier as 'R2',
        requested_by_client_id: rc.actor.agentClientId ?? null,
        requester_name: rc.actor.name,
        on_behalf_of: onBehalfOf,
        audience,
        status: 'awaiting_confirmation',
        entity_type: preview.entity?.type ?? null,
        entity_id: preview.entity?.id ?? null,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const base = rc.deps.origin(rc.workspace.slug);
    const confirmUrl =
      audience === 'staff' ? `${base}/console/approvals/${row.id}` : `${base}/portal/confirm/${row.id}?t=${token}`;
    rc.audit({ entityType: 'approval_request', entityId: row.id, after: { action: action.id, preview: preview.title } });
    rc.emit('approval.requested', { type: 'approval_request', id: row.id }, { actionId: action.id, confirmUrl, audience });
    return { status: 'approval_required' as const, approvalRequestId: row.id, confirmUrl, expiresAt, preview };
  }

  return {
    deps,
    execute,
    effectiveTier,
    async run<O>(actionId: string, input: unknown, ctx: ActionContext): Promise<O> {
      const r = await execute<O>(actionId, input, ctx);
      if (r.status === 'approval_required') {
        throw new DomainError('approval_required', 'A person needs to confirm this in GMS.', {
          approvalRequestId: r.approvalRequestId,
          confirmUrl: r.confirmUrl,
        });
      }
      return r.output;
    },
  };
}

function summarize(input: unknown): unknown {
  const s = JSON.stringify(input ?? null);
  return s.length > 4000 ? { truncated: true, size: s.length } : input;
}

/** Roles lookup used by channel adapters to build an ActionContext. */
export async function loadRoles(database: Database, workspaceId: string | null, userId: string | null): Promise<WorkspaceRole[]> {
  if (!workspaceId || !userId) return [];
  const rows = await database
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  return rows.map((r) => r.role as WorkspaceRole);
}
