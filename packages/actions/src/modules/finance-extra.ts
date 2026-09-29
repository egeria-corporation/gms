// SPDX-License-Identifier: AGPL-3.0-or-later
// Finance extras: inbound bank webhooks. The route handler never touches tables; it hands the raw body and the
// signature header to this system action, which finds the workspace whose signing secret verifies the body,
// stores the event once (de-duplicated by provider + event id) and returns its id for processing.
import type { PaymentRail } from '@gms/adapters/types';
import { DomainError } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { json } from './lib';

/** 256 KiB: Mercury events are a few KiB; anything larger is not a Mercury event. */
export const MAX_WEBHOOK_BYTES = 262_144;

export const ingestRailWebhook = defineAction({
  id: 'system.ingest_rail_webhook',
  title: 'Receive a bank webhook',
  description:
    'System task: verifies a Mercury webhook (Mercury-Signature: t=…,v1=… HMAC-SHA256, 5-minute window) against the signing secret of each connected workspace (or only the hinted one), then stores the event once, de-duplicated by provider + event id. Invalid signatures are rejected and nothing is stored. Returns the stored event id so system.process_rail_event can apply it.',
  input: z.object({
    rawBody: z.string().min(2).max(MAX_WEBHOOK_BYTES),
    signature: z.string().max(2000).nullable(),
    /** Workspace slug from `?ws=`; the request's tenant (ctx.workspace) takes precedence. */
    workspaceHint: z
      .string()
      .regex(/^[a-z0-9-]{2,60}$/)
      .nullable()
      .optional(),
  }),
  output: z.object({ railEventId: z.string().uuid(), workspaceId: z.string().uuid(), duplicate: z.boolean(), eventType: z.string() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: false,
  requiresWorkspace: false,
  async run(input, ctx) {
    if (!input.signature) throw new DomainError('unauthenticated', 'The webhook is not signed.');
    let q = ctx.db
      .selectFrom('bank_connections as c')
      .innerJoin('workspaces as w', 'w.id', 'c.workspace_id')
      .select(['c.id', 'c.workspace_id', 'c.webhook_secret_ref'])
      .where('c.provider', '=', 'mercury')
      .where('c.status', '=', 'connected')
      .where('c.webhook_secret_ref', 'is not', null)
      .where('w.status', '=', 'active');
    if (ctx.workspace) q = q.where('c.workspace_id', '=', ctx.workspace.id);
    else if (input.workspaceHint) q = q.where('w.slug', '=', input.workspaceHint);
    const candidates = await q.orderBy('c.created_at', 'desc').limit(50).execute();

    const headers = { 'mercury-signature': input.signature };
    let matched: { workspaceId: string; rail: PaymentRail } | null = null;
    for (const c of candidates) {
      const secret = c.webhook_secret_ref ? await ctx.deps.secrets.get(c.webhook_secret_ref) : null;
      if (!secret) continue;
      const rail = await ctx.deps.paymentRail(c.workspace_id, ctx.db);
      if (rail.verifyWebhook(input.rawBody, headers, secret)) {
        matched = { workspaceId: c.workspace_id, rail };
        break;
      }
    }
    if (!matched) throw new DomainError('unauthenticated', 'The webhook signature is not valid.');

    let event;
    try {
      event = matched.rail.parseWebhook(input.rawBody);
    } catch (e) {
      throw new DomainError('validation_failed', `The webhook body is not a Mercury event (${(e as Error).message}).`);
    }
    const payload = { id: event.id, type: event.type, resourceType: event.resourceType, resourceId: event.resourceId, occurredAt: event.occurredAt, mergePatch: event.mergePatch };
    const inserted = await ctx.db
      .insertInto('rail_events')
      .values({ workspace_id: matched.workspaceId, provider: 'mercury', event_id: event.id, event_type: event.type, payload: json(payload), signature_valid: true })
      .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    const row =
      inserted ??
      (await ctx.db.selectFrom('rail_events').select('id').where('provider', '=', 'mercury').where('event_id', '=', event.id).executeTakeFirstOrThrow());
    const duplicate = !inserted;
    // Explicit audit entry so the executor never records the raw body.
    ctx.audit({
      entityType: 'rail_event',
      entityId: row.id,
      action: duplicate ? 'system.ingest_rail_webhook.duplicate' : 'system.ingest_rail_webhook',
      after: { provider: 'mercury', eventId: event.id, eventType: event.type, workspaceId: matched.workspaceId },
    });
    return { railEventId: row.id, workspaceId: matched.workspaceId, duplicate, eventType: event.type };
  },
});
