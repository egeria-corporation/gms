// SPDX-License-Identifier: AGPL-3.0-only
// Transactional outbox fan-out: notifications, emails, outbound webhooks, and follow-on system actions.
import { createHmac, randomUUID } from 'node:crypto';
import { systemContext, WEBHOOK_EVENTS_LIST, type Runtime } from '@gms/actions';
import { sql, type Outbox } from '@gms/db';
import type { Selectable } from 'kysely';
import { applicationRecipients, notifyInApp, orgAdmins, sendTemplate, staffWith, workspaceInfo, type WorkspaceInfo } from './notify';

type OutboxRow = Selectable<Outbox>;
type Payload = Record<string, unknown>;

const WEBHOOK_EVENTS = new Set<string>(WEBHOOK_EVENTS_LIST);

async function ref(rt: Runtime, ws: WorkspaceInfo) {
  return { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone };
}

async function runSystem(rt: Runtime, ws: WorkspaceInfo | null, actionId: string, input: unknown): Promise<unknown> {
  return rt.executor.run(actionId, input, systemContext(ws ? await ref(rt, ws) : null));
}

type Handler = (rt: Runtime, ev: OutboxRow, ws: WorkspaceInfo | null, p: Payload) => Promise<void>;

const handlers: Record<string, Handler> = {
  async 'application.submitted'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const app = await rt.db
      .selectFrom('applications as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .innerJoin('opportunities as op', 'op.id', 'a.opportunity_id')
      .select(['a.id', 'a.title', 'a.reference_number', 'a.submitted_at', 'o.legal_name', 'op.title as opp_title', 'op.decision_expected_on', 'op.program_id'])
      .where('a.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!app) return;
    for (const r of await applicationRecipients(rt.db, app.id)) {
      await sendTemplate(rt, ws, r.email, 'submission_receipt', {
        recipientName: r.name,
        organizationName: app.legal_name ?? r.name ?? 'Your organization',
        applicationTitle: app.title ?? 'Your application',
        opportunityName: app.opp_title,
        referenceNumber: String(p.receiptNumber ?? app.reference_number),
        submittedAt: app.submitted_at ?? new Date().toISOString(),
        timeZone: ws.timezone,
        decisionsExpectedBy: app.decision_expected_on,
        applicationUrl: `${ws.origin}/portal/applications/${app.id}`,
      });
    }
    const staff = await staffWith(rt.db, ws.id, ['program_officer']);
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: staff.map((s) => s.id), kind: 'application.submitted', title: `New submission: ${app.title ?? app.reference_number}`, body: `${app.legal_name ?? 'An applicant'} submitted ${app.reference_number}${p.viaAgent ? ' through an AI agent (confirmed by the applicant)' : ''}.`, link: `/console/applications/${app.id}` });
  },

  async 'application.status_changed'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const to = String(p.to);
    if (!['invited_to_next_stage', 'awarded', 'declined', 'ineligible', 'under_review'].includes(to)) return;
    if (to === 'under_review' && p.from !== 'submitted') return;
    const app = await rt.db
      .selectFrom('applications as a')
      .innerJoin('opportunities as op', 'op.id', 'a.opportunity_id')
      .select(['a.id', 'a.title', 'a.reference_number', 'op.title as opp_title'])
      .where('a.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!app) return;
    const decision = to === 'declined' ? await rt.db.selectFrom('decisions').select(['letter_sent_at']).where('application_id', '=', app.id).where('is_final', '=', true).orderBy('recorded_at', 'desc').executeTakeFirst() : null;
    if (to === 'declined' && decision && !decision.letter_sent_at) return; // staff chose not to send a letter
    for (const r of await applicationRecipients(rt.db, app.id)) {
      await sendTemplate(rt, ws, r.email, 'status_change', {
        recipientName: r.name,
        applicationTitle: app.title ?? 'Your application',
        opportunityName: app.opp_title,
        referenceNumber: app.reference_number,
        status: to as 'awarded',
        note: (p.reason as string | null) ?? null,
        timeZone: ws.timezone,
        applicationUrl: `${ws.origin}/portal/applications/${app.id}`,
      });
    }
  },

  async 'application.info_requested'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const app = await rt.db.selectFrom('applications as a').innerJoin('opportunities as op', 'op.id', 'a.opportunity_id').select(['a.id', 'a.title', 'a.reference_number', 'op.title as opp_title']).where('a.id', '=', ev.entity_id).executeTakeFirst();
    if (!app) return;
    for (const r of await applicationRecipients(rt.db, app.id)) {
      await sendTemplate(rt, ws, r.email, 'status_change', {
        recipientName: r.name,
        applicationTitle: app.title ?? 'Your application',
        opportunityName: app.opp_title,
        referenceNumber: app.reference_number,
        status: 'info_requested',
        note: String(p.note ?? ''),
        timeZone: ws.timezone,
        applicationUrl: `${ws.origin}/portal/applications/${app.id}`,
      });
    }
  },

  async 'collaborator.invited'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const app = await rt.db
      .selectFrom('applications as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .innerJoin('opportunities as op', 'op.id', 'a.opportunity_id')
      .select(['a.title', 'o.legal_name', 'op.title as opp_title'])
      .where('a.id', '=', ev.entity_id)
      .executeTakeFirst();
    await sendTemplate(rt, ws, String(p.email), 'collaborator_invite', {
      inviterName: String(p.invitedBy ?? 'A colleague'),
      organizationName: app?.legal_name ?? 'their organization',
      applicationTitle: app?.title ?? 'an application',
      opportunityName: app?.opp_title ?? '',
      acceptUrl: `${ws.origin}/portal/join?token=${encodeURIComponent(String(p.token))}`,
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      timeZone: ws.timezone,
    });
  },

  async 'team.invited'(rt, ev, ws, p) {
    if (!ws) return;
    const inviter = await rt.db.selectFrom('invitations as i').leftJoin('profiles as p', 'p.id', 'i.invited_by').select(['p.full_name', 'i.expires_at']).where('i.id', '=', ev.entity_id!).executeTakeFirst();
    await sendTemplate(rt, ws, String(p.email), 'staff_invite', {
      inviterName: inviter?.full_name ?? 'Your colleague',
      role: p.role as 'reviewer',
      acceptUrl: `${ws.origin}/invite/accept?token=${encodeURIComponent(String(p.token))}`,
      expiresAt: inviter?.expires_at ?? new Date(Date.now() + 14 * 86400000).toISOString(),
      timeZone: ws.timezone,
    });
  },

  async 'message.sent'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const msg = await rt.db.selectFrom('messages').select(['body']).where('id', '=', String(p.messageId)).executeTakeFirst();
    const thread = await rt.db.selectFrom('threads').selectAll().where('id', '=', ev.entity_id).executeTakeFirst();
    if (!thread || !msg) return;
    const excerpt = msg.body.length > 280 ? `${msg.body.slice(0, 277)}…` : msg.body;
    if (p.side === 'staff' && thread.application_id) {
      for (const r of await applicationRecipients(rt.db, thread.application_id)) {
        await sendTemplate(rt, ws, r.email, 'message_notification', { recipientName: r.name, senderName: ws.brand.displayName, subjectLine: thread.subject, excerpt, threadUrl: `${ws.origin}/portal/applications/${thread.application_id}#messages` });
        await notifyInApp(rt.db, { workspaceId: ws.id, userIds: [r.id], kind: 'message', title: `New message from ${ws.brand.displayName}`, body: excerpt, link: `/portal/applications/${thread.application_id}#messages` });
      }
    } else if (p.side === 'applicant') {
      const staff = await staffWith(rt.db, ws.id, ['program_officer', 'admin']);
      await notifyInApp(rt.db, { workspaceId: ws.id, userIds: staff.map((s) => s.id), kind: 'message', title: `Reply on ${thread.subject}`, body: excerpt, link: thread.application_id ? `/console/applications/${thread.application_id}#messages` : '/console' });
    }
  },

  async 'approval.requested'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const req = await rt.db.selectFrom('approval_requests').selectAll().where('id', '=', ev.entity_id).executeTakeFirst();
    if (!req) return;
    const person = await rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('id', '=', req.on_behalf_of).executeTakeFirst();
    const preview = req.preview as { title?: string; summary?: string; fields?: { label: string; value: string }[] };
    if (req.audience === 'applicant' && person) {
      await sendTemplate(rt, ws, person.email, 'agent_confirmation_request', {
        recipientName: person.full_name,
        agentName: req.requester_name,
        actionSummary: preview.title ?? req.action_id,
        actionDetails: (preview.fields ?? []).map((f) => `${f.label}: ${f.value}`),
        requestedAt: req.created_at,
        expiresAt: req.expires_at,
        timeZone: ws.timezone,
        confirmUrl: String(p.confirmUrl),
      } as never);
    }
    const inbox = req.audience === 'staff' ? await staffWith(rt.db, ws.id, ['owner', 'admin']) : [];
    await notifyInApp(rt.db, {
      workspaceId: ws.id,
      userIds: [...(person ? [person.id] : []), ...inbox.map((s) => s.id)],
      kind: 'approval',
      title: `${req.requester_name} is asking you to confirm: ${preview.title ?? req.action_id}`,
      link: req.audience === 'staff' ? `/console/approvals/${req.id}` : `/portal/confirm/${req.id}`,
    });
  },

  async 'award.created'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const a = await rt.db
      .selectFrom('awards as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('opportunities as op', 'op.id', 'a.opportunity_id')
      .select(['a.id', 'a.reference', 'a.title', 'a.amount_cents', 'a.currency', 'a.start_date', 'a.end_date', 'a.applicant_org_id', 'o.legal_name', 'op.title as opp_title'])
      .where('a.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!a) return;
    if (a.applicant_org_id) await runSystem(rt, ws, 'diligence.run', { applicantOrgId: a.applicant_org_id, awardId: a.id, context: 'award' });
    for (const r of await orgAdmins(rt.db, a.applicant_org_id)) {
      await sendTemplate(rt, ws, r.email, 'award_notice', {
        recipientName: r.name,
        organizationName: a.legal_name ?? 'your organization',
        opportunityName: a.opp_title ?? '',
        applicationTitle: a.title,
        awardReference: a.reference,
        amountCents: a.amount_cents,
        currency: a.currency,
        periodStart: a.start_date,
        periodEnd: a.end_date,
        awardUrl: `${ws.origin}/portal/grants/${a.id}`,
      });
    }
    void p;
  },

  async 'agreement.sent'(rt, ev, ws) {
    if (!ws || !ev.entity_id) return;
    const g = await rt.db
      .selectFrom('agreements as g')
      .innerJoin('awards as a', 'a.id', 'g.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .select(['a.id as award_id', 'a.reference', 'a.amount_cents', 'a.currency', 'a.applicant_org_id', 'o.legal_name'])
      .where('g.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!g) return;
    for (const r of await orgAdmins(rt.db, g.applicant_org_id)) {
      await sendTemplate(rt, ws, r.email, 'agreement_ready', { recipientName: r.name, organizationName: g.legal_name ?? '', awardReference: g.reference, amountCents: g.amount_cents, currency: g.currency, signUrl: `${ws.origin}/portal/grants/${g.award_id}/agreement` });
    }
  },

  async 'agreement.signed'(rt, ev, ws) {
    if (!ws || !ev.entity_id) return;
    const g = await rt.db.selectFrom('agreements as g').innerJoin('awards as a', 'a.id', 'g.award_id').select(['a.id', 'a.reference', 'a.applicant_org_id']).where('g.id', '=', ev.entity_id).executeTakeFirst();
    if (!g) return;
    const admins = await staffWith(rt.db, ws.id, ['owner', 'admin']);
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: admins.map((a) => a.id), kind: 'agreement', title: `Agreement ${g.reference} signed — ready to countersign`, link: `/console/awards/${g.id}` });
    // Bank onboarding starts as soon as the grantee signs.
    if (g.applicant_org_id) {
      const conn = await rt.db.selectFrom('bank_connections').select('id').where('workspace_id', '=', ws.id).where('status', '=', 'connected').executeTakeFirst();
      if (conn) await runSystem(rt, ws, 'payees.invite', { applicantOrgId: g.applicant_org_id });
    }
  },

  async 'payee.invited'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const payee = await rt.db
      .selectFrom('payees as y')
      .innerJoin('applicant_orgs as o', 'o.id', 'y.applicant_org_id')
      .select(['y.contact_email', 'y.onboarding_url', 'y.invited_at', 'o.legal_name', 'o.id as org_id'])
      .where('y.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!payee?.onboarding_url) return;
    const award = await rt.db.selectFrom('awards').select('reference').where('applicant_org_id', '=', payee.org_id).where('workspace_id', '=', ws.id).where('kind', '=', 'original').orderBy('created_at', 'desc').executeTakeFirst();
    await sendTemplate(rt, ws, payee.contact_email, 'payee_onboarding', {
      organizationName: payee.legal_name,
      awardReference: award?.reference ?? '',
      onboardingUrl: payee.onboarding_url,
      expiresAt: new Date(Date.parse(payee.invited_at ?? new Date().toISOString()) + 30 * 86400000).toISOString(),
      timeZone: ws.timezone,
    });
    void p;
  },

  async 'payee.onboarded'(rt, ev, ws) {
    if (!ws) return;
    const fin = await staffWith(rt.db, ws.id, ['finance']);
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: fin.map((f) => f.id), kind: 'payee', title: 'A grantee finished bank onboarding', link: '/console/payments' });
  },

  async 'payment.requested'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const b = await rt.db.selectFrom('payment_batches as b').innerJoin('profiles as p', 'p.id', 'b.created_by').select(['b.id', 'b.name', 'b.total_cents', 'b.created_by', 'b.requires_second_approval', 'p.full_name']).where('b.id', '=', ev.entity_id).executeTakeFirst();
    if (!b) return;
    const count = await sql<{ n: number }>`select count(*)::int as n from public.payments where batch_id = ${b.id}::uuid`.execute(rt.db);
    const approvers = (await staffWith(rt.db, ws.id, ['finance', 'admin', 'owner'])).filter((s) => s.id !== b.created_by);
    for (const a of approvers) {
      await sendTemplate(rt, ws, a.email, 'approval_needed', {
        recipientName: a.name,
        batchName: b.name,
        paymentCount: count.rows[0]?.n ?? 0,
        totalCents: b.total_cents,
        submittedBy: b.full_name ?? 'A colleague',
        approvalsRequired: b.requires_second_approval ? 2 : 1,
        approvalsReceived: 0,
        approveUrl: `${ws.origin}/console/payments/batches/${b.id}`,
      });
    }
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: approvers.map((a) => a.id), kind: 'payment', title: `Approve ${b.name}`, link: `/console/payments/batches/${b.id}` });
    void p;
  },

  async 'payment.approved'(rt, ev, ws) {
    if (!ws || !ev.entity_id) return;
    await runSystem(rt, ws, 'system.submit_batch', { batchId: ev.entity_id });
  },

  async 'payment.sent'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    if (!p.manual) await runSystem(rt, ws, 'system.annotate_transaction', { paymentId: ev.entity_id }).catch(() => {});
    const pay = await rt.db
      .selectFrom('payments as p')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .select(['p.id', 'p.amount_cents', 'p.currency', 'p.method', 'p.sent_at', 'a.id as award_id', 'a.reference', 'a.applicant_org_id', 'o.legal_name'])
      .where('p.id', '=', ev.entity_id)
      .executeTakeFirst();
    if (!pay) return;
    for (const r of await orgAdmins(rt.db, pay.applicant_org_id)) {
      await sendTemplate(rt, ws, r.email, 'payment_sent', {
        recipientName: r.name,
        organizationName: pay.legal_name ?? '',
        amountCents: pay.amount_cents,
        currency: pay.currency,
        method: pay.method as 'ach',
        sentAt: pay.sent_at ?? new Date().toISOString(),
        timeZone: ws.timezone,
        expectedArrival: pay.method === 'ach' ? '1–3 business days' : pay.method === 'check' ? '5–10 business days' : '1 business day',
        awardReference: pay.reference,
        remittanceAttached: false,
        paymentUrl: `${ws.origin}/portal/grants/${pay.award_id}#payments`,
      });
    }
  },

  async 'payment.failed'(rt, ev, ws, p) {
    if (!ws) return;
    const fin = await staffWith(rt.db, ws.id, ['finance', 'admin']);
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: fin.map((f) => f.id), kind: 'payment', title: 'A payment failed', body: String(p.reason ?? ''), link: ev.entity_id ? `/console/payments/${ev.entity_id}` : '/console/payments' });
  },

  async 'report.due'(rt, ev, ws) {
    await reportEmail(rt, ev, ws, 'report_due');
  },
  async 'report.overdue'(rt, ev, ws) {
    await reportEmail(rt, ev, ws, 'report_overdue');
  },
  async 'report.revisions_requested'(rt, ev, ws, p) {
    if (!ws || !ev.entity_id) return;
    const r = await rt.db.selectFrom('report_requirements as r').innerJoin('awards as a', 'a.id', 'r.award_id').select(['r.id', 'r.title', 'a.id as award_id', 'a.applicant_org_id']).where('r.id', '=', ev.entity_id).executeTakeFirst();
    if (!r) return;
    for (const a of await orgAdmins(rt.db, r.applicant_org_id)) {
      await sendTemplate(rt, ws, a.email, 'revisions_requested', { recipientName: a.name, itemKind: 'report', itemName: r.title, requestedBy: ws.brand.displayName, notes: String(p.note ?? ''), itemUrl: `${ws.origin}/portal/grants/${r.award_id}/reports/${r.id}` });
    }
  },

  async 'review.assigned'(rt, ev, ws, p) {
    if (!ws) return;
    const ids = (p.reviewerIds as string[] | undefined) ?? [];
    await notifyInApp(rt.db, { workspaceId: ws.id, userIds: ids, kind: 'review', title: 'You have new applications to review', link: '/review' });
  },

  async 'export.requested'(rt, ev, ws) {
    if (!ws || !ev.entity_id) return;
    const { runExport } = await import('./exports');
    await runExport(rt, ev.entity_id);
  },

  async 'comms.bulk_send'(rt, ev, ws) {
    if (!ws || !ev.entity_id) return;
    const m = await rt.db.selectFrom('bulk_messages as m').innerJoin('profiles as p', 'p.id', 'm.created_by').select(['m.id', 'm.subject', 'm.body_md', 'p.full_name']).where('m.id', '=', ev.entity_id).executeTakeFirst();
    if (!m) return;
    const queue = await rt.db.selectFrom('email_deliveries').select(['id', 'to_email']).where('bulk_message_id', '=', m.id).where('status', '=', 'queued').execute();
    for (const d of queue) {
      const person = await rt.db.selectFrom('profiles').select(['full_name']).where(sql<boolean>`lower(email) = lower(${d.to_email})`).executeTakeFirst();
      await sendTemplate(
        rt,
        ws,
        d.to_email,
        'bulk_message',
        { recipientName: person?.full_name ?? null, subject: m.subject, markdown: m.body_md, senderName: m.full_name ?? ws.brand.displayName, reason: `You applied to or receive grants from ${ws.brand.displayName}.`, mergeValues: { 'applicant.first_name': person?.full_name?.split(' ')[0] ?? 'there' } } as never,
        { bulkMessageId: m.id, deliveryId: d.id },
      ).catch(() => {});
    }
    await rt.db.updateTable('bulk_messages').set({ status: 'sent', sent_at: new Date().toISOString() }).where('id', '=', m.id).execute();
  },
};

async function reportEmail(rt: Runtime, ev: OutboxRow, ws: WorkspaceInfo | null, template: 'report_due' | 'report_overdue') {
  if (!ws || !ev.entity_id) return;
  const r = await rt.db
    .selectFrom('report_requirements as r')
    .innerJoin('awards as a', 'a.id', 'r.award_id')
    .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
    .select(['r.id', 'r.title', 'r.due_date', 'a.id as award_id', 'a.reference', 'a.applicant_org_id', 'o.legal_name', 'a.on_hold'])
    .where('r.id', '=', ev.entity_id)
    .executeTakeFirst();
  if (!r) return;
  const settings = await rt.db.selectFrom('workspace_settings').select('overdue_report_hold').where('workspace_id', '=', ws.id).executeTakeFirst();
  for (const a of await orgAdmins(rt.db, r.applicant_org_id)) {
    const base = { recipientName: a.name, organizationName: r.legal_name ?? '', reportName: r.title, awardReference: r.reference, dueDate: r.due_date, reportUrl: `${ws.origin}/portal/grants/${r.award_id}/reports/${r.id}` };
    if (template === 'report_due') await sendTemplate(rt, ws, a.email, 'report_due', base);
    else await sendTemplate(rt, ws, a.email, 'report_overdue', { ...base, daysOverdue: Math.max(1, Math.round((Date.now() - Date.parse(r.due_date)) / 86400000)), paymentsOnHold: Boolean(settings?.overdue_report_hold) });
  }
}

/** Creates signed delivery rows for every endpoint subscribed to this event. */
async function fanOutWebhooks(rt: Runtime, ev: OutboxRow) {
  if (!ev.workspace_id || !WEBHOOK_EVENTS.has(ev.event_type)) return;
  const endpoints = await rt.db.selectFrom('webhook_endpoints').select(['id', 'events']).where('workspace_id', '=', ev.workspace_id).where('status', '=', 'active').execute();
  const targets = endpoints.filter((e) => e.events.includes(ev.event_type));
  if (!targets.length) return;
  const payload = scrub(ev.payload as Payload);
  const body = { id: `evt_${ev.id}`, type: ev.event_type, createdAt: ev.created_at, data: { entityType: ev.entity_type, entityId: ev.entity_id, ...payload } };
  await rt.db
    .insertInto('webhook_deliveries')
    .values(targets.map((t) => ({ workspace_id: ev.workspace_id!, endpoint_id: t.id, event_id: body.id, event_type: ev.event_type, payload: JSON.stringify(body), status: 'pending' })))
    .execute();
}

function scrub(p: Payload): Payload {
  const sensitive = new Set([...((p.sensitive as string[] | undefined) ?? []), 'sensitive', 'token', 'onboardingUrl']);
  return Object.fromEntries(Object.entries(p).filter(([k]) => !sensitive.has(k)));
}

export async function processEvent(rt: Runtime, ev: OutboxRow): Promise<void> {
  const payload = (ev.payload ?? {}) as Payload;
  const wsId = ev.workspace_id ?? (typeof payload.workspaceId === 'string' ? payload.workspaceId : null);
  const ws = wsId ? await workspaceInfo(rt.db, wsId) : null;
  const handler = handlers[ev.event_type];
  if (handler) await handler(rt, ev, ws, payload);
  await fanOutWebhooks(rt, ev);
}

/** Claims and processes a batch of outbox events. Returns how many were processed. */
export async function drainOutbox(rt: Runtime, batch = 50): Promise<number> {
  const rows = await sql<OutboxRow>`select * from gms_private.claim_outbox(${batch})`.execute(rt.db);
  for (const ev of rows.rows) {
    try {
      await processEvent(rt, ev);
      // Processed events drop sensitive fields (one-time tokens, onboarding links).
      await rt.db.updateTable('outbox').set({ processed_at: new Date().toISOString(), last_error: null, payload: JSON.stringify(scrub((ev.payload ?? {}) as Payload)) }).where('id', '=', ev.id).execute();
    } catch (err) {
      await rt.db.updateTable('outbox').set({ last_error: (err as Error).message.slice(0, 1000) }).where('id', '=', ev.id).execute();
      console.error(`[outbox] ${ev.event_type} #${ev.id} failed: ${(err as Error).message}`);
    }
  }
  return rows.rows.length;
}

/** Delivers pending outbound webhooks with HMAC-SHA256 signatures and exponential backoff. */
export async function deliverWebhooks(rt: Runtime, limit = 50): Promise<number> {
  const due = await rt.db
    .selectFrom('webhook_deliveries as d')
    .innerJoin('webhook_endpoints as e', 'e.id', 'd.endpoint_id')
    .select(['d.id', 'd.payload', 'd.attempt', 'd.event_id', 'd.event_type', 'e.url', 'e.secret_ref'])
    .where('d.status', '=', 'pending')
    .where('d.next_attempt_at', '<=', new Date().toISOString())
    .limit(limit)
    .execute();
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const secret = (await rt.adapters.secrets.get(d.secret_ref)) ?? '';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    let status = 0;
    let snippet = '';
    try {
      const res = await fetch(d.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'GMS-Webhooks/1', 'gms-event': d.event_type, 'gms-delivery': d.id, 'gms-event-id': d.event_id, 'gms-timestamp': ts, 'gms-signature': `v1=${sig}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      snippet = (await res.text()).slice(0, 500);
    } catch (err) {
      snippet = (err as Error).message.slice(0, 500);
    }
    const attempt = d.attempt + 1;
    if (status >= 200 && status < 300) {
      await rt.db.updateTable('webhook_deliveries').set({ status: 'succeeded', attempt, response_status: status, response_snippet: snippet, delivered_at: new Date().toISOString() }).where('id', '=', d.id).execute();
    } else {
      const giveUp = attempt >= 8;
      const backoff = Math.min(2 ** attempt * 30, 6 * 3600) * 1000;
      await rt.db
        .updateTable('webhook_deliveries')
        .set({ status: giveUp ? 'failed' : 'pending', attempt, response_status: status || null, response_snippet: snippet, next_attempt_at: new Date(Date.now() + backoff).toISOString() })
        .where('id', '=', d.id)
        .execute();
    }
  }
  return due.length;
}

export const _test = { scrub, randomUUID };
