// SPDX-License-Identifier: AGPL-3.0-only
// Communications: email templates with merge fields, bulk messages to segments (count confirmation),
// notification rules.
import { sql } from '@gms/db';
import { DomainError } from '@gms/domain';
import { z } from 'zod';
import { defineAction, type RunContext } from '../define';
import { found, IdOut, json, Ok, uid, uuid, ws } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

export const saveTemplate = defineAction({
  id: 'comms.save_template',
  title: 'Save an email template',
  description: 'Creates or updates an email template (subject + markdown body with {{merge.fields}}).',
  input: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60), name: z.string().trim().min(1).max(200), subject: z.string().trim().min(1).max(300), bodyMd: z.string().min(1).max(50000), mergeFields: z.array(z.string().max(80)).max(50).default([]) }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('email_templates')
      .values({ workspace_id: w.id, key: input.key, name: input.name, subject: input.subject, body_md: input.bodyMd, merge_fields: input.mergeFields, updated_by: uid(ctx) })
      .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({ name: input.name, subject: input.subject, body_md: input.bodyMd, merge_fields: input.mergeFields, updated_by: uid(ctx) }))
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'email_template', entityId: r.id, after: { key: input.key, subject: input.subject } });
    return { id: r.id };
  },
});

const Segment = z.object({
  opportunityId: uuid.optional(),
  competitionId: uuid.optional(),
  applicationStatuses: z.array(z.string()).max(10).optional(),
  awardStatuses: z.array(z.string()).max(5).optional(),
  programId: uuid.optional(),
  reportOverdue: z.boolean().optional(),
  applicationIds: z.array(uuid).max(5000).optional(),
});

/** Resolves a segment to distinct recipients (application primary contacts / grantee org admins). */
export async function resolveSegment(ctx: RunContext, seg: z.infer<typeof Segment>) {
  const w = ws(ctx);
  if (seg.awardStatuses?.length || seg.reportOverdue || (seg.programId && !seg.opportunityId && !seg.applicationStatuses)) {
    let q = ctx.db
      .selectFrom('awards as a')
      .innerJoin('applicant_org_members as m', (j) => j.onRef('m.org_id', '=', 'a.applicant_org_id').on('m.role', '=', 'org_admin'))
      .innerJoin('profiles as p', 'p.id', 'm.user_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .select(['p.id as user_id', 'p.email', 'p.full_name', 'o.legal_name', 'a.id as award_id', 'a.reference'])
      .where('a.workspace_id', '=', w.id)
      .where('a.kind', '=', 'original');
    if (seg.awardStatuses?.length) q = q.where('a.status', 'in', seg.awardStatuses);
    if (seg.programId) q = q.where('a.program_id', '=', seg.programId);
    if (seg.reportOverdue) q = q.where('a.report_overdue', '=', true);
    const rows = await q.execute();
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true))).map((r) => ({ userId: r.user_id, email: r.email, name: r.full_name, orgName: r.legal_name, applicationId: null as string | null, reference: r.reference }));
  }
  let q = ctx.db
    .selectFrom('applications as a')
    .innerJoin('profiles as p', 'p.id', 'a.applicant_user_id')
    .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
    .select(['p.id as user_id', 'p.email', 'p.full_name', 'o.legal_name', 'a.id as application_id', 'a.reference_number'])
    .where('a.workspace_id', '=', w.id);
  if (seg.opportunityId) q = q.where('a.opportunity_id', '=', seg.opportunityId);
  if (seg.competitionId) q = q.where('a.competition_id', '=', seg.competitionId);
  if (seg.applicationStatuses?.length) q = q.where('a.status', 'in', seg.applicationStatuses);
  if (seg.applicationIds?.length) q = q.where('a.id', 'in', seg.applicationIds);
  const rows = await q.execute();
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true))).map((r) => ({ userId: r.user_id, email: r.email, name: r.full_name, orgName: r.legal_name, applicationId: r.application_id, reference: r.reference_number }));
}

export const draftBulkMessage = defineAction({
  id: 'comms.draft_bulk_message',
  title: 'Draft a bulk message',
  description: 'Drafts a message to a segment of applicants or grantees and returns how many people it would reach. Nothing is sent until comms.send_bulk_message.',
  input: z.object({ bulkMessageId: uuid.optional(), subject: z.string().trim().min(1).max(300), bodyMd: z.string().min(1).max(50000), segment: Segment, templateKey: z.string().max(60).optional() }),
  output: z.object({ id: z.string().uuid(), recipientCount: z.number() }),
  scopes: ['messages:send'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const recipients = await resolveSegment(ctx, input.segment);
    const values = { subject: input.subject, body_md: input.bodyMd, segment: json(input.segment), recipient_count: recipients.length, template_key: input.templateKey ?? null };
    if (input.bulkMessageId) {
      const r = await ctx.db.updateTable('bulk_messages').set(values).where('id', '=', input.bulkMessageId).where('status', '=', 'draft').executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new DomainError('conflict', 'This message was already sent.');
      return { id: input.bulkMessageId, recipientCount: recipients.length };
    }
    const r = await ctx.db
      .insertInto('bulk_messages')
      .values({ ...values, workspace_id: w.id, status: 'draft', created_by: uid(ctx), created_by_agent_client_id: ctx.actor.type === 'agent' ? (ctx.actor.agentClientId ?? null) : null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'bulk_message', entityId: r.id, after: { subject: input.subject, recipients: recipients.length } });
    return { id: r.id, recipientCount: recipients.length };
  },
});

export const sendBulkMessage = defineAction({
  id: 'comms.send_bulk_message',
  title: 'Send a bulk message',
  description: 'Sends a drafted bulk message. You must confirm the exact recipient count. Consequential: agents get a confirmation request.',
  input: z.object({ bulkMessageId: uuid, confirmRecipientCount: z.number().int().min(1) }),
  output: z.object({ queued: z.number() }),
  scopes: ['messages:send'],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async preview(input, ctx) {
    const m = found(await ctx.db.selectFrom('bulk_messages').selectAll().where('id', '=', input.bulkMessageId).executeTakeFirst(), 'message');
    return {
      title: `Send “${m.subject}” to ${m.recipient_count} people`,
      summary: 'This emails every recipient in the segment. It cannot be unsent.',
      fields: [
        { label: 'Subject', value: m.subject },
        { label: 'Recipients', value: String(m.recipient_count) },
      ],
      quotedContent: [{ label: 'Message', text: m.body_md.slice(0, 2000) }],
      entity: { type: 'bulk_message', id: m.id },
    };
  },
  async run(input, ctx) {
    const m = found(await ctx.db.selectFrom('bulk_messages').selectAll().where('id', '=', input.bulkMessageId).executeTakeFirst(), 'message');
    if (m.status !== 'draft') throw new DomainError('conflict', 'This message was already sent.');
    const recipients = await resolveSegment(ctx, m.segment as z.infer<typeof Segment>);
    if (recipients.length !== input.confirmRecipientCount) {
      throw new DomainError('precondition_failed', `The segment now has ${recipients.length} recipients, not ${input.confirmRecipientCount}. Review and confirm again.`, { recipientCount: recipients.length });
    }
    await ctx.db.updateTable('bulk_messages').set({ status: 'sending', recipient_count: recipients.length }).where('id', '=', m.id).execute();
    for (const r of recipients) {
      await ctx.db
        .insertInto('email_deliveries')
        .values({ workspace_id: m.workspace_id, bulk_message_id: m.id, template_key: 'bulk_message', to_email: r.email, subject: m.subject, provider: 'pending', status: 'queued' })
        .execute();
    }
    ctx.audit({ entityType: 'bulk_message', entityId: m.id, before: { status: 'draft' }, after: { status: 'sending', recipients: recipients.length } });
    ctx.emit('comms.bulk_send', { type: 'bulk_message', id: m.id }, { recipients: recipients.length });
    return { queued: recipients.length };
  },
});

export const saveNotificationRule = defineAction({
  id: 'comms.save_rule',
  title: 'Save a notification rule',
  description: 'Turns an automatic notification on or off for an event, audience and channel (email or in-app), with an optional offset in days (for reminders).',
  input: z.object({ ruleId: uuid.optional(), eventType: z.string().max(80), channel: z.enum(['email', 'in_app']), audience: z.enum(['applicant', 'program_officer', 'finance', 'admins', 'reviewers', 'board']), templateKey: z.string().max(60).nullable().optional(), offsetDays: z.number().int().min(-60).max(60).nullable().optional(), enabled: z.boolean() }),
  output: IdOut,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const values = { event_type: input.eventType, channel: input.channel, audience: input.audience, template_key: input.templateKey ?? null, offset_days: input.offsetDays ?? null, enabled: input.enabled };
    if (input.ruleId) {
      await ctx.db.updateTable('notification_rules').set(values).where('id', '=', input.ruleId).execute();
      return { id: input.ruleId };
    }
    const r = await ctx.db.insertInto('notification_rules').values({ ...values, workspace_id: w.id }).returning('id').executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'notification_rule', entityId: r.id, after: values });
    return { id: r.id };
  },
});

export const recordEmailEvent = defineAction({
  id: 'system.record_email_event',
  title: 'Record an email delivery event',
  description: 'System task: records a verified delivery/bounce/complaint event from the email provider webhook.',
  input: z.object({ provider: z.string(), providerEventId: z.string(), providerMessageId: z.string().nullable(), event: z.enum(['sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed']), recipient: z.string().nullable(), payload: z.record(z.string(), z.unknown()) }),
  output: Ok,
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const delivery = input.providerMessageId
      ? await ctx.db.selectFrom('email_deliveries').select(['id', 'workspace_id']).where('provider_message_id', '=', input.providerMessageId).executeTakeFirst()
      : undefined;
    await ctx.db
      .insertInto('email_events')
      .values({ workspace_id: delivery?.workspace_id ?? null, delivery_id: delivery?.id ?? null, provider: input.provider, provider_event_id: input.providerEventId, event: input.event, recipient: input.recipient, payload: json(input.payload) })
      .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
      .execute();
    if (delivery && ['delivered', 'bounced', 'complained', 'failed'].includes(input.event)) {
      await ctx.db.updateTable('email_deliveries').set({ status: input.event }).where('id', '=', delivery.id).execute();
    }
    if (delivery && input.event === 'bounced') {
      await sql`update public.email_deliveries set error = 'Bounced' where id = ${delivery.id}::uuid`.execute(ctx.db);
    }
    return { ok: true as const };
  },
});
