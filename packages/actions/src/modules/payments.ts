// SPDX-License-Identifier: AGPL-3.0-only
// Payments with the foundation's own bank (Mercury approval-mode) or the manual rail.
// GMS never holds funds and never stores bank numbers: payees onboard through Mercury recipient invites,
// payments go through maker-checker in GMS, then Mercury's request-send-money (a person approves in Mercury).
import { randomUUID } from 'node:crypto';
import type { PaymentRail, RailPaymentMethod } from '@gms/adapters/types';
import { sql, type Tx } from '@gms/db';
import { batchMachine, DomainError, formatMoney, mercuryFeeCents, paymentMachine, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import { z } from 'zod';
import { defineAction, type RunContext } from '../define';
import { DateOnly, found, IdOut, json, Ok, transition, uid, uuid, ws } from './lib';

const FINANCE = ['owner', 'admin', 'finance'] as const;
const METHOD = z.enum(['ach', 'check', 'domestic_wire', 'international_wire']);
const RAIL_METHOD: Record<Exclude<PaymentMethod, 'manual'>, RailPaymentMethod> = {
  ach: 'ach',
  check: 'check',
  domestic_wire: 'domesticWire',
  international_wire: 'internationalWire',
};

async function railFor(ctx: RunContext): Promise<PaymentRail> {
  return ctx.deps.paymentRail(ws(ctx).id, ctx.db);
}

async function connectionFor(trx: Tx, workspaceId: string) {
  return trx.selectFrom('bank_connections').selectAll().where('workspace_id', '=', workspaceId).where('status', '=', 'connected').orderBy('created_at', 'desc').executeTakeFirst();
}

// Bank connection (R3) --------------------------------------------------------------------------------
export const connectBank = defineAction({
  id: 'bank.connect',
  title: 'Connect the bank',
  description:
    'Connects the foundation’s Mercury account (token mode; OAuth is flag-gated pending Mercury partner approval) or chooses the manual rail. Tokens go straight into the SecretStore. People only (R3), with authenticator step-up.',
  input: z.object({ provider: z.enum(['mercury', 'manual']), environment: z.enum(['fake', 'sandbox']).default('fake'), apiToken: z.string().min(10).max(500).optional() }),
  output: z.object({ connectionId: z.string().uuid(), accounts: z.number(), webhook: z.string() }),
  scopes: [],
  roles: FINANCE,
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.provider === 'mercury' && input.environment === 'sandbox' && !input.apiToken) {
      throw new DomainError('validation_failed', 'Paste a Mercury sandbox API token.', {}, [{ pointer: '/apiToken', message: 'Required for the sandbox.' }]);
    }
    await ctx.db.updateTable('bank_connections').set({ status: 'disconnected' }).where('workspace_id', '=', w.id).where('status', '=', 'connected').execute();
    const secretRef = input.apiToken ? await ctx.deps.secrets.put(`mercury-token:${w.id}`, input.apiToken, { workspaceId: w.id }) : null;
    const conn = await ctx.db
      .insertInto('bank_connections')
      .values({
        workspace_id: w.id,
        provider: input.provider,
        mode: input.provider === 'manual' ? 'none' : 'token',
        environment: input.provider === 'manual' ? 'fake' : input.environment,
        secret_ref: secretRef,
        status: 'connected',
        connected_by: uid(ctx),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    let accounts = 0;
    let webhook = 'none';
    if (input.provider === 'mercury') {
      const rail = await ctx.deps.paymentRail(w.id, ctx.db);
      accounts = await syncAccounts(ctx.db, w.id, conn.id, rail);
      try {
        const reg = await rail.createWebhook({ url: `${ctx.deps.origin(w.slug)}/webhooks/mercury`, eventTypes: ['transaction.created', 'transaction.updated', 'balance.updated'] });
        const ref = await ctx.deps.secrets.put(`mercury-webhook:${w.id}`, reg.secret, { workspaceId: w.id });
        await ctx.db.updateTable('bank_connections').set({ webhook_id: reg.webhookId, webhook_secret_ref: ref, webhook_status: 'active' }).where('id', '=', conn.id).execute();
        webhook = 'active';
      } catch (e) {
        webhook = `failed: ${(e as Error).message.slice(0, 120)}`;
        await ctx.db.updateTable('bank_connections').set({ webhook_status: 'failing' }).where('id', '=', conn.id).execute();
      }
    }
    ctx.audit({ entityType: 'bank_connection', entityId: conn.id, after: { provider: input.provider, environment: input.environment, accounts, webhook } });
    ctx.emit('bank.connected', { type: 'bank_connection', id: conn.id }, { provider: input.provider });
    return { connectionId: conn.id, accounts, webhook };
  },
});

export async function syncAccounts(trx: Tx, workspaceId: string, connectionId: string, rail: PaymentRail): Promise<number> {
  const accts = await rail.listAccounts();
  for (const a of accts) {
    await trx
      .insertInto('bank_accounts')
      .values({
        workspace_id: workspaceId,
        connection_id: connectionId,
        provider_account_id: a.id,
        name: a.name,
        mask: a.mask && /^\d{4}$/.test(a.mask) ? a.mask : null,
        kind: a.kind,
        available_cents: a.availableCents,
        current_cents: a.currentCents,
        currency: a.currency,
        balance_updated_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(['connection_id', 'provider_account_id']).doUpdateSet({ name: a.name, available_cents: a.availableCents, current_cents: a.currentCents, balance_updated_at: new Date().toISOString() }),
      )
      .execute();
  }
  await trx.updateTable('bank_connections').set({ last_synced_at: new Date().toISOString() }).where('id', '=', connectionId).execute();
  return accts.length;
}

export const syncBank = defineAction({
  id: 'bank.sync',
  title: 'Refresh balances',
  description: 'Refreshes bank account names and balances from the connected bank (read-only; moves no money).',
  input: z.object({}),
  output: z.object({ accounts: z.number() }),
  scopes: ['payments:read'],
  roles: [...FINANCE, 'system'],
  riskTier: 'R1',
  idempotent: true,
  async run(_input, ctx) {
    const w = ws(ctx);
    const conn = found(await connectionFor(ctx.db, w.id), 'bank connection');
    if (conn.provider === 'manual') return { accounts: 0 };
    return { accounts: await syncAccounts(ctx.db, w.id, conn.id, await railFor(ctx)) };
  },
});

export const mapProgramAccount = defineAction({
  id: 'bank.map_program_account',
  title: 'Choose a program’s paying account',
  description: 'Sets which bank account pays a program’s grants. People only (R3), with step-up.',
  input: z.object({ programId: uuid, bankAccountId: uuid }),
  output: Ok,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    await ctx.db.deleteFrom('program_accounts').where('program_id', '=', input.programId).execute();
    await ctx.db.insertInto('program_accounts').values({ workspace_id: w.id, program_id: input.programId, bank_account_id: input.bankAccountId, is_default: true }).execute();
    ctx.audit({ entityType: 'program', entityId: input.programId, action: 'bank.map_program_account', after: { bankAccountId: input.bankAccountId } });
    return { ok: true as const };
  },
});

// Payees -----------------------------------------------------------------------------------------------
export const invitePayee = defineAction({
  id: 'payees.invite',
  title: 'Invite a grantee to bank onboarding',
  description:
    'Creates a Mercury recipient invite for a grantee (tax form required; Mercury does not email them — GMS sends a branded email with the onboarding link). GMS never sees bank account numbers.',
  input: z.object({ applicantOrgId: uuid, contactEmail: z.string().email().optional() }),
  output: z.object({ payeeId: z.string().uuid(), status: z.string() }),
  scopes: [],
  roles: [...FINANCE, 'system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const conn = await connectionFor(ctx.db, w.id);
    if (!conn) throw new DomainError('precondition_failed', 'Connect the bank (or choose the manual rail) before onboarding payees.');
    const existing = await ctx.db.selectFrom('payees').selectAll().where('workspace_id', '=', w.id).where('applicant_org_id', '=', input.applicantOrgId).executeTakeFirst();
    if (existing && ['ready', 'invite_sent', 'onboarding'].includes(existing.status)) return { payeeId: existing.id, status: existing.status };
    const org = found(await ctx.db.selectFrom('applicant_orgs').select(['legal_name', 'email']).where('id', '=', input.applicantOrgId).executeTakeFirst(), 'organization');
    let email = input.contactEmail ?? org.email;
    if (!email) {
      const admin = await ctx.db
        .selectFrom('applicant_org_members as m')
        .innerJoin('profiles as p', 'p.id', 'm.user_id')
        .select('p.email')
        .where('m.org_id', '=', input.applicantOrgId)
        .where('m.role', '=', 'org_admin')
        .executeTakeFirst();
      email = admin?.email ?? null;
    }
    if (!email) throw new DomainError('precondition_failed', 'We need a contact email for the grantee.');
    if (conn.provider === 'manual') {
      const row = await ctx.db
        .insertInto('payees')
        .values({ workspace_id: w.id, applicant_org_id: input.applicantOrgId, provider: 'manual', status: 'ready', contact_email: email, ready_at: ctx.now().toISOString() })
        .onConflict((oc) => oc.columns(['workspace_id', 'applicant_org_id', 'provider']).doUpdateSet({ status: 'ready', contact_email: email! }))
        .returning('id')
        .executeTakeFirstOrThrow();
      return { payeeId: row.id, status: 'ready' };
    }
    const brand = await ctx.db.selectFrom('workspace_brand').select('display_name').where('workspace_id', '=', w.id).executeTakeFirst();
    const rail = await railFor(ctx);
    const invite = await rail.createRecipientInvite({
      contactEmail: email,
      name: org.legal_name,
      paymentMethods: ['ach'],
      requireTaxDocument: true,
      sendEmail: false,
      organizationNameOnRequest: brand?.display_name ?? w.name,
    });
    const values = {
      workspace_id: w.id,
      applicant_org_id: input.applicantOrgId,
      provider: 'mercury',
      invite_id: invite.inviteId,
      onboarding_url: invite.onboardingUrl,
      invite_status: invite.status,
      status: 'invite_sent',
      contact_email: email,
      invited_at: ctx.now().toISOString(),
    };
    const row = await ctx.db
      .insertInto('payees')
      .values(values)
      .onConflict((oc) => oc.columns(['workspace_id', 'applicant_org_id', 'provider']).doUpdateSet({ invite_id: invite.inviteId, onboarding_url: invite.onboardingUrl, invite_status: invite.status, status: 'invite_sent', contact_email: email!, invited_at: values.invited_at }))
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'payee', entityId: row.id, after: { inviteId: invite.inviteId, contactEmail: email } });
    ctx.emit('payee.invited', { type: 'payee', id: row.id }, { applicantOrgId: input.applicantOrgId, contactEmail: email, onboardingUrl: invite.onboardingUrl, sensitive: ['onboardingUrl'] });
    return { payeeId: row.id, status: 'invite_sent' };
  },
});

export const reissuePayeeInvite = defineAction({
  id: 'payees.reissue',
  title: 'Send a new onboarding invite',
  description: 'Issues a fresh Mercury recipient invite when the last one expired.',
  input: z.object({ payeeId: uuid }),
  output: Ok,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const p = found(await ctx.db.selectFrom('payees').selectAll().where('id', '=', input.payeeId).executeTakeFirst(), 'payee');
    if (p.status === 'ready') throw new DomainError('conflict', 'This payee is already ready to receive payments.');
    await ctx.db.updateTable('payees').set({ status: 'invite_expired' }).where('id', '=', p.id).execute();
    const rail = await railFor(ctx);
    const brand = await ctx.db.selectFrom('workspace_brand').select('display_name').where('workspace_id', '=', p.workspace_id).executeTakeFirst();
    const org = await ctx.db.selectFrom('applicant_orgs').select('legal_name').where('id', '=', p.applicant_org_id).executeTakeFirst();
    const invite = await rail.createRecipientInvite({ contactEmail: p.contact_email, name: org?.legal_name, paymentMethods: ['ach'], requireTaxDocument: true, sendEmail: false, organizationNameOnRequest: brand?.display_name });
    await ctx.db.updateTable('payees').set({ invite_id: invite.inviteId, onboarding_url: invite.onboardingUrl, invite_status: invite.status, status: 'invite_sent', invited_at: ctx.now().toISOString() }).where('id', '=', p.id).execute();
    ctx.audit({ entityType: 'payee', entityId: p.id, action: 'payees.reissue', after: { inviteId: invite.inviteId } });
    ctx.emit('payee.invited', { type: 'payee', id: p.id }, { applicantOrgId: p.applicant_org_id, contactEmail: p.contact_email, onboardingUrl: invite.onboardingUrl, sensitive: ['onboardingUrl'] });
    return { ok: true as const };
  },
});

export const pollPayees = defineAction({
  id: 'system.poll_payees',
  title: 'Poll payee onboarding',
  description: 'System task: polls Mercury recipient invites (there is no webhook for invites) and marks payees Ready, or Invite expired.',
  input: z.object({}),
  output: z.object({ ready: z.number(), expired: z.number(), checked: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(_input, ctx) {
    const w = ws(ctx);
    const pending = await ctx.db.selectFrom('payees').selectAll().where('workspace_id', '=', w.id).where('provider', '=', 'mercury').where('status', 'in', ['invite_sent', 'onboarding']).limit(100).execute();
    if (!pending.length) return { ready: 0, expired: 0, checked: 0 };
    const rail = await railFor(ctx);
    let ready = 0;
    let expired = 0;
    for (const p of pending) {
      if (!p.invite_id) continue;
      const inv = await rail.getRecipientInvite(p.invite_id);
      const now = ctx.now().toISOString();
      if (inv.status === 'completed' && inv.recipientId) {
        await ctx.db.updateTable('payees').set({ status: 'ready', invite_status: 'completed', provider_recipient_id: inv.recipientId, ready_at: now, last_polled_at: now }).where('id', '=', p.id).execute();
        ctx.audit({ entityType: 'payee', entityId: p.id, before: { status: p.status }, after: { status: 'ready' } });
        ctx.emit('payee.onboarded', { type: 'payee', id: p.id }, { applicantOrgId: p.applicant_org_id });
        ready++;
      } else if (inv.status === 'expired') {
        await ctx.db.updateTable('payees').set({ status: 'invite_expired', invite_status: 'expired', last_polled_at: now }).where('id', '=', p.id).execute();
        ctx.emit('payee.invite_expired', { type: 'payee', id: p.id }, { applicantOrgId: p.applicant_org_id });
        expired++;
      } else {
        await ctx.db.updateTable('payees').set({ last_polled_at: now }).where('id', '=', p.id).execute();
      }
    }
    return { ready, expired, checked: pending.length };
  },
});

// Batches ------------------------------------------------------------------------------------------------
const Blocked = z.object({ installmentId: z.string(), awardReference: z.string(), grantee: z.string(), amountCents: z.number(), reasons: z.array(z.string()) });

interface DueRow {
  installment_id: string;
  award_id: string;
  amount_cents: number;
  due_date: string;
  reference: string;
  on_hold: boolean;
  report_overdue: boolean;
  agreement_pending: boolean;
  award_status: string;
  applicant_org_id: string | null;
  legal_name: string | null;
  program_id: string | null;
  fiscal_year: number | null;
}

async function dueInstallments(trx: Tx, workspaceId: string, opts: { installmentIds?: string[]; dueBefore?: string }): Promise<DueRow[]> {
  let q = trx
    .selectFrom('installments as i')
    .innerJoin('awards as a', 'a.id', 'i.award_id')
    .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
    .select([
      'i.id as installment_id',
      'i.award_id',
      'i.amount_cents',
      'i.due_date',
      'a.reference',
      'a.on_hold',
      'a.report_overdue',
      'a.agreement_pending',
      'a.status as award_status',
      'a.applicant_org_id',
      'o.legal_name',
      'a.program_id',
      'a.fiscal_year',
    ])
    .where('i.workspace_id', '=', workspaceId)
    .where('i.status', '=', 'scheduled')
    .where((eb) => eb.not(eb.exists(eb.selectFrom('payments as p').select('p.id').whereRef('p.installment_id', '=', 'i.id').where('p.status', 'not in', ['failed', 'cancelled']))));
  if (opts.installmentIds?.length) q = q.where('i.id', 'in', opts.installmentIds);
  if (opts.dueBefore) q = q.where('i.due_date', '<=', opts.dueBefore);
  return q.orderBy('i.due_date').execute();
}

export const proposeBatch = defineAction({
  id: 'payments.propose_batch',
  title: 'Propose a payment batch',
  description:
    'Builds a DRAFT payment batch from due installments. Installments that cannot be paid yet are returned in `blocked` with reasons (payee not ready, hold, sanctions match pending review, overdue report, agreement not countersigned, over budget). A person reviews and a different person approves; approval is people-only.',
  input: z.object({ sourceAccountId: uuid.optional(), method: METHOD.default('ach'), installmentIds: z.array(uuid).max(500).optional(), dueBefore: DateOnly.optional(), name: z.string().max(200).optional() }),
  output: z.object({ batchId: z.string().uuid().nullable(), included: z.number(), totalCents: z.number(), feeCents: z.number(), blocked: z.array(Blocked) }),
  scopes: ['payments:propose'],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const conn = await connectionFor(ctx.db, w.id);
    if (!conn) throw new DomainError('precondition_failed', 'Connect the bank (or choose the manual rail) first.');
    const settings = await ctx.db.selectFrom('workspace_settings').selectAll().where('workspace_id', '=', w.id).executeTakeFirstOrThrow();
    const dueBefore = input.dueBefore ?? new Date(ctx.now().getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const due = await dueInstallments(ctx.db, w.id, { installmentIds: input.installmentIds, dueBefore: input.installmentIds?.length ? undefined : dueBefore });
    let sourceAccountId = input.sourceAccountId ?? null;
    if (!sourceAccountId && conn.provider === 'mercury') {
      const first = await ctx.db.selectFrom('bank_accounts').select('id').where('connection_id', '=', conn.id).orderBy('available_cents', 'desc').executeTakeFirst();
      sourceAccountId = first?.id ?? null;
    }
    const blocked: z.infer<typeof Blocked>[] = [];
    const ok: (DueRow & { payee_id: string | null; root: string | null })[] = [];
    for (const d of due) {
      const reasons: string[] = [];
      if (d.award_status !== 'active') reasons.push('Award is not active');
      if (d.agreement_pending) reasons.push('Agreement not countersigned yet');
      if (d.on_hold) reasons.push('Award is on hold');
      // Overdue reports hold payments when the workspace setting is on and that report is set to hold payments.
      if (settings.overdue_report_hold) {
        const holding = await ctx.db
          .selectFrom('report_requirements')
          .select('title')
          .where('award_id', '=', d.award_id)
          .where('status', '=', 'overdue')
          .where('holds_payments', '=', true)
          .executeTakeFirst();
        if (holding) reasons.push(`Report overdue: ${holding.title} (payment hold)`);
      }
      // Never propose more than the award (plus approved amendments) allows; earlier rows in this batch count too.
      const ceiling = await sql<{ root: string; ceiling: number; committed: number }>`
        with r as (select gms_private.award_root(${d.award_id}::uuid) as root)
        select r.root, gms_private.award_ceiling_cents(r.root)::bigint as ceiling,
               coalesce((select sum(p.amount_cents) from public.payments p
                         where gms_private.award_root(p.award_id) = r.root and p.status not in ('failed', 'cancelled')), 0)::bigint as committed
        from r`.execute(ctx.db);
      const c = ceiling.rows[0];
      if (c) {
        const inBatch = ok.filter((o) => o.root === c.root).reduce((sum, o) => sum + o.amount_cents, 0);
        if (Number(c.committed) + inBatch + d.amount_cents > Number(c.ceiling)) {
          reasons.push(`Over budget: ${formatMoney(Number(c.committed) + inBatch + d.amount_cents)} would exceed the award's ${formatMoney(Number(c.ceiling))}`);
        }
      }
      let payeeId: string | null = null;
      if (d.applicant_org_id) {
        const payee = await ctx.db.selectFrom('payees').select(['id', 'status']).where('workspace_id', '=', w.id).where('applicant_org_id', '=', d.applicant_org_id).executeTakeFirst();
        payeeId = payee?.id ?? null;
        if (!payee || payee.status !== 'ready') reasons.push(payee ? `Payee is ${payee.status.replace(/_/g, ' ')}` : 'Payee has not been invited to bank onboarding');
        const screening = await ctx.db
          .selectFrom('sanctions_screenings')
          .select(['status'])
          .where('applicant_org_id', '=', d.applicant_org_id)
          .where('workspace_id', '=', w.id)
          .orderBy('created_at', 'desc')
          .executeTakeFirst();
        if (screening?.status === 'potential_match') reasons.push('Sanctions (OFAC) match pending review');
        if (screening?.status === 'confirmed_match') reasons.push('Confirmed sanctions (OFAC) match');
      } else reasons.push('No grantee organization');
      if (reasons.length) blocked.push({ installmentId: d.installment_id, awardReference: d.reference, grantee: d.legal_name ?? '—', amountCents: d.amount_cents, reasons });
      else ok.push({ ...d, payee_id: payeeId, root: ceiling.rows[0]?.root ?? null });
    }
    if (!ok.length) return { batchId: null, included: 0, totalCents: 0, feeCents: 0, blocked };
    const method: PaymentMethod = conn.provider === 'manual' ? 'manual' : input.method;
    const batchId = randomUUID();
    const total = ok.reduce((s, d) => s + d.amount_cents, 0);
    const fees = ok.reduce((s, d) => s + mercuryFeeCents(method, d.amount_cents), 0);
    await ctx.db
      .insertInto('payment_batches')
      .values({
        id: batchId,
        workspace_id: w.id,
        name: input.name ?? `Payments due by ${dueBefore}`,
        source_account_id: sourceAccountId,
        method,
        status: 'draft',
        requires_second_approval: total >= settings.second_approval_threshold_cents,
        total_cents: total,
        created_by: uid(ctx),
        created_by_agent_client_id: ctx.actor.type === 'agent' ? (ctx.actor.agentClientId ?? null) : null,
      })
      .execute();
    for (const d of ok) {
      await ctx.db
        .insertInto('payments')
        .values({
          workspace_id: w.id,
          award_id: d.award_id,
          installment_id: d.installment_id,
          batch_id: batchId,
          payee_id: d.payee_id,
          source_account_id: sourceAccountId,
          method,
          amount_cents: d.amount_cents,
          fee_cents: mercuryFeeCents(method, d.amount_cents),
          status: 'in_batch',
          rail: conn.provider === 'manual' ? 'manual' : 'mercury',
          memo: `Grants paid · ${d.reference}`,
          created_by: uid(ctx),
        })
        .execute();
    }
    ctx.audit({ entityType: 'payment_batch', entityId: batchId, after: { included: ok.length, totalCents: total, blocked: blocked.length, method } });
    ctx.emit('payment.batch_proposed', { type: 'payment_batch', id: batchId }, { totalCents: total, count: ok.length });
    return { batchId, included: ok.length, totalCents: total, feeCents: fees, blocked };
  },
});

export const submitBatchForApproval = defineAction({
  id: 'payments.submit_batch_for_approval',
  title: 'Send a batch for approval',
  description: 'Sends a draft batch to approvers. The person who created it cannot approve it.',
  input: z.object({ batchId: uuid }),
  output: Ok,
  scopes: ['payments:propose'],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const b = found(await ctx.db.selectFrom('payment_batches').selectAll().where('id', '=', input.batchId).executeTakeFirst(), 'batch');
    transition(batchMachine, b.status, 'awaiting_approval');
    await ctx.db.updateTable('payment_batches').set({ status: 'awaiting_approval' }).where('id', '=', b.id).execute();
    await ctx.db.updateTable('payments').set({ status: 'awaiting_approval' }).where('batch_id', '=', b.id).where('status', '=', 'in_batch').execute();
    ctx.audit({ entityType: 'payment_batch', entityId: b.id, before: { status: b.status }, after: { status: 'awaiting_approval' } });
    ctx.emit('payment.requested', { type: 'payment_batch', id: b.id }, { totalCents: b.total_cents, createdBy: b.created_by, requiresSecondApproval: b.requires_second_approval });
    return { ok: true as const };
  },
});

export const approveBatch = defineAction({
  id: 'payments.approve_batch',
  title: 'Approve a payment batch',
  description:
    'Approves a batch awaiting approval. The approver must not be its creator and must confirm with their authenticator app. Large batches need a second, different approver. After approval GMS asks the bank to send each payment; a person approves each request in Mercury. People only (R3).',
  input: z.object({ batchId: uuid, note: z.string().max(1000).optional() }),
  output: z.object({ status: z.string(), needsSecondApproval: z.boolean() }),
  scopes: [],
  roles: FINANCE,
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const me = uid(ctx);
    const b = found(await ctx.db.selectFrom('payment_batches').selectAll().where('id', '=', input.batchId).forUpdate().executeTakeFirst(), 'batch');
    if (b.status !== 'awaiting_approval') throw new DomainError('conflict', `This batch is ${b.status.replace(/_/g, ' ')}.`);
    if (b.created_by === me) throw new DomainError('forbidden', 'You created this batch, so someone else must approve it.', { rule: 'maker_checker' });
    if (b.approved_by === me) throw new DomainError('forbidden', 'The second approval must come from a different person.', { rule: 'maker_checker' });
    await ctx.db.insertInto('payment_approvals').values({ workspace_id: b.workspace_id, batch_id: b.id, approver_id: me, decision: 'approve', aal: ctx.aal, note: input.note ?? null }).execute();
    const now = ctx.now().toISOString();
    if (b.requires_second_approval && !b.approved_by) {
      await ctx.db.updateTable('payment_batches').set({ approved_by: me, approved_at: now }).where('id', '=', b.id).execute();
      ctx.audit({ entityType: 'payment_batch', entityId: b.id, action: 'payments.approve_batch', after: { approval: 1, of: 2 } });
      ctx.emit('payment.first_approval', { type: 'payment_batch', id: b.id }, { approvedBy: me });
      return { status: 'awaiting_approval', needsSecondApproval: true };
    }
    await ctx.db
      .updateTable('payment_batches')
      .set(b.approved_by ? { second_approved_by: me, second_approved_at: now, status: 'approved' } : { approved_by: me, approved_at: now, status: 'approved' })
      .where('id', '=', b.id)
      .execute();
    ctx.audit({ entityType: 'payment_batch', entityId: b.id, before: { status: b.status }, after: { status: 'approved', approvedBy: me } });
    ctx.emit('payment.approved', { type: 'payment_batch', id: b.id }, { totalCents: b.total_cents, method: b.method });
    return { status: 'approved', needsSecondApproval: false };
  },
});

export const rejectBatch = defineAction({
  id: 'payments.reject_batch',
  title: 'Reject a payment batch',
  description: 'Rejects a batch awaiting approval; its payments return to Scheduled. People only (R3).',
  input: z.object({ batchId: uuid, reason: z.string().trim().min(1).max(1000) }),
  output: Ok,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const b = found(await ctx.db.selectFrom('payment_batches').selectAll().where('id', '=', input.batchId).executeTakeFirst(), 'batch');
    transition(batchMachine, b.status, 'rejected');
    await ctx.db.insertInto('payment_approvals').values({ workspace_id: b.workspace_id, batch_id: b.id, approver_id: uid(ctx), decision: 'reject', aal: ctx.aal, note: input.reason }).execute();
    await ctx.db.updateTable('payment_batches').set({ status: 'rejected', note: input.reason }).where('id', '=', b.id).execute();
    await ctx.db.updateTable('payments').set({ status: 'cancelled' }).where('batch_id', '=', b.id).where('status', 'in', ['in_batch', 'awaiting_approval']).execute();
    ctx.audit({ entityType: 'payment_batch', entityId: b.id, before: { status: b.status }, after: { status: 'rejected', reason: input.reason } });
    return { ok: true as const };
  },
});

export const cancelBatch = defineAction({
  id: 'payments.cancel_batch',
  title: 'Cancel a draft batch',
  description: 'Cancels a batch that has not been approved; its installments can be batched again.',
  input: z.object({ batchId: uuid }),
  output: Ok,
  scopes: ['payments:propose'],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const b = found(await ctx.db.selectFrom('payment_batches').selectAll().where('id', '=', input.batchId).executeTakeFirst(), 'batch');
    transition(batchMachine, b.status, 'cancelled');
    await ctx.db.updateTable('payment_batches').set({ status: 'cancelled' }).where('id', '=', b.id).execute();
    await ctx.db.updateTable('payments').set({ status: 'cancelled' }).where('batch_id', '=', b.id).where('status', 'in', ['in_batch', 'awaiting_approval']).execute();
    ctx.audit({ entityType: 'payment_batch', entityId: b.id, before: { status: b.status }, after: { status: 'cancelled' } });
    return { ok: true as const };
  },
});

// Submission to the rail (system) ----------------------------------------------------------------------------
export const submitApprovedBatch = defineAction({
  id: 'system.submit_batch',
  title: 'Send approved payments to the bank',
  description: 'System task: for an approved batch, calls request-send-money once per payment (sequential per recipient, idempotency key = payment id). Status becomes “Awaiting bank approval (Mercury)”.',
  input: z.object({ batchId: uuid }),
  output: z.object({ requested: z.number(), failed: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const b = found(await ctx.db.selectFrom('payment_batches').selectAll().where('id', '=', input.batchId).executeTakeFirst(), 'batch');
    if (b.status !== 'approved' && b.status !== 'submitting') return { requested: 0, failed: 0 };
    await ctx.db.updateTable('payment_batches').set({ status: 'submitting' }).where('id', '=', b.id).execute();
    const payments = await ctx.db
      .selectFrom('payments as p')
      .leftJoin('payees as y', 'y.id', 'p.payee_id')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .select(['p.id', 'p.status', 'p.amount_cents', 'p.method', 'p.rail', 'p.memo', 'y.provider_recipient_id', 'a.reference'])
      .where('p.batch_id', '=', b.id)
      .where('p.status', '=', 'awaiting_approval')
      .orderBy('y.provider_recipient_id')
      .execute();
    let requested = 0;
    let failed = 0;
    const now = ctx.now().toISOString();
    if (b.method === 'manual') {
      for (const p of payments) {
        await ctx.db.updateTable('payments').set({ status: 'sent', sent_at: now, requested_at: now }).where('id', '=', p.id).execute();
        requested++;
      }
    } else {
      const rail = await ctx.deps.paymentRail(b.workspace_id, ctx.db);
      const account = b.source_account_id
        ? await ctx.db.selectFrom('bank_accounts').select(['provider_account_id']).where('id', '=', b.source_account_id).executeTakeFirst()
        : undefined;
      if (!account) throw new DomainError('precondition_failed', 'The batch has no source account.');
      for (const p of payments) {
        if (!p.provider_recipient_id) {
          await ctx.db.updateTable('payments').set({ status: 'failed', failure_reason: 'Payee has no bank recipient yet.' }).where('id', '=', p.id).execute();
          failed++;
          continue;
        }
        try {
          const req = await rail.requestSendMoney(account.provider_account_id, {
            recipientId: p.provider_recipient_id,
            amountCents: p.amount_cents,
            paymentMethod: RAIL_METHOD[p.method as Exclude<PaymentMethod, 'manual'>] ?? 'ach',
            idempotencyKey: p.id,
            note: `Grants paid · ${p.reference}`,
            externalMemo: `Grant ${p.reference}`,
          });
          transition(paymentMachine, 'awaiting_approval', 'awaiting_bank_approval');
          await ctx.db.updateTable('payments').set({ status: 'awaiting_bank_approval', rail_ref: req.requestId, requested_at: now }).where('id', '=', p.id).execute();
          requested++;
        } catch (e) {
          await ctx.db.updateTable('payments').set({ status: 'failed', failure_reason: (e as Error).message.slice(0, 500) }).where('id', '=', p.id).execute();
          ctx.emit('payment.failed', { type: 'payment', id: p.id }, { reason: (e as Error).message.slice(0, 200) });
          failed++;
        }
      }
    }
    await ctx.db.updateTable('payment_batches').set({ status: 'submitted', submitted_at: now }).where('id', '=', b.id).execute();
    ctx.audit({ entityType: 'payment_batch', entityId: b.id, before: { status: b.status }, after: { status: 'submitted', requested, failed } });
    if (b.method === 'manual') for (const p of payments) ctx.emit('payment.sent', { type: 'payment', id: p.id }, { amountCents: p.amount_cents });
    return { requested, failed };
  },
});

async function markSent(ctx: RunContext, paymentId: string, txId: string | null) {
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
  if (p.status === 'sent' || p.status === 'reconciled') return false;
  transition(paymentMachine, p.status, 'sent');
  const now = ctx.now().toISOString();
  await ctx.db.updateTable('payments').set({ status: 'sent', sent_at: now, ...(txId ? { rail_transaction_id: txId } : {}) }).where('id', '=', p.id).execute();
  if (p.installment_id) await ctx.db.updateTable('installments').set({ status: 'paid' }).where('id', '=', p.installment_id).execute();
  ctx.audit({ entityType: 'payment', entityId: p.id, before: { status: p.status }, after: { status: 'sent', transactionId: txId } });
  ctx.emit('payment.sent', { type: 'payment', id: p.id }, { amountCents: p.amount_cents, awardId: p.award_id, transactionId: txId });
  return true;
}

export const pollBankRequests = defineAction({
  id: 'system.poll_bank_requests',
  title: 'Check bank approvals',
  description: 'System task: polls pending request-send-money approvals; links approved requests to their transaction and marks payments Sent (or Failed when rejected).',
  input: z.object({}),
  output: z.object({ sent: z.number(), failed: z.number(), pending: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(_input, ctx) {
    const w = ws(ctx);
    const pending = await ctx.db
      .selectFrom('payments as p')
      .innerJoin('bank_accounts as b', 'b.id', 'p.source_account_id')
      .select(['p.id', 'p.rail_ref', 'p.rail_transaction_id', 'b.provider_account_id'])
      .where('p.workspace_id', '=', w.id)
      .where('p.status', '=', 'awaiting_bank_approval')
      .limit(200)
      .execute();
    if (!pending.length) return { sent: 0, failed: 0, pending: 0 };
    const rail = await railFor(ctx);
    let sent = 0;
    let failed = 0;
    for (const p of pending) {
      if (!p.rail_ref) continue;
      const req = await rail.getSendMoneyRequest(p.provider_account_id, p.rail_ref);
      if (req.status === 'rejected' || req.status === 'cancelled') {
        await ctx.db.updateTable('payments').set({ status: 'failed', failure_reason: `The bank request was ${req.status}.` }).where('id', '=', p.id).execute();
        ctx.emit('payment.failed', { type: 'payment', id: p.id }, { reason: `Bank request ${req.status}` });
        failed++;
        continue;
      }
      if (req.status === 'approved' && req.transactionId) {
        if (!p.rail_transaction_id) await ctx.db.updateTable('payments').set({ rail_transaction_id: req.transactionId }).where('id', '=', p.id).execute();
        const tx = await rail.getTransaction(p.provider_account_id, req.transactionId);
        if (tx.status === 'sent') {
          if (await markSent(ctx, p.id, tx.id)) sent++;
        } else if (tx.status === 'failed' || tx.status === 'cancelled' || tx.status === 'reversed' || tx.status === 'blocked') {
          await ctx.db.updateTable('payments').set({ status: 'failed', failure_reason: `Bank transaction ${tx.status}.` }).where('id', '=', p.id).execute();
          ctx.emit('payment.failed', { type: 'payment', id: p.id }, { reason: `Transaction ${tx.status}` });
          failed++;
        }
      }
    }
    return { sent, failed, pending: pending.length - sent - failed };
  },
});

export const processRailEvent = defineAction({
  id: 'system.process_rail_event',
  title: 'Process a bank webhook event',
  description: 'System task: applies a verified, de-duplicated bank webhook event (transaction created/updated) to payments.',
  input: z.object({ railEventId: uuid }),
  output: z.object({ applied: z.boolean() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const ev = found(await ctx.db.selectFrom('rail_events').selectAll().where('id', '=', input.railEventId).executeTakeFirst(), 'event');
    if (ev.processed_at || !ev.signature_valid) return { applied: false };
    const payload = ev.payload as { resourceId?: string; mergePatch?: { status?: string }; type?: string };
    let applied = false;
    if (payload.resourceId && ev.event_type.startsWith('transaction.')) {
      const p = await ctx.db.selectFrom('payments').select(['id', 'status']).where('rail_transaction_id', '=', payload.resourceId).executeTakeFirst();
      const status = payload.mergePatch?.status;
      if (p && status === 'sent') applied = await markSent(ctx, p.id, payload.resourceId);
      else if (p && status && ['failed', 'cancelled', 'reversed', 'blocked'].includes(status) && p.status !== 'failed') {
        await ctx.db.updateTable('payments').set({ status: 'failed', failure_reason: `Bank transaction ${status}.` }).where('id', '=', p.id).execute();
        ctx.emit('payment.failed', { type: 'payment', id: p.id }, { reason: `Transaction ${status}` });
        applied = true;
      }
    }
    await ctx.db.updateTable('rail_events').set({ processed_at: ctx.now().toISOString() }).where('id', '=', ev.id).execute();
    return { applied };
  },
});

export const reconcile = defineAction({
  id: 'system.reconcile',
  title: 'Reconcile bank transactions',
  description: 'System task (nightly): mirrors recent bank transactions, matches them to payments (transaction link, idempotency key, memo) and records exceptions for anything unmatched.',
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  output: z.object({ mirrored: z.number(), reconciled: z.number(), exceptions: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const conn = await connectionFor(ctx.db, w.id);
    if (!conn || conn.provider !== 'mercury') return { mirrored: 0, reconciled: 0, exceptions: 0 };
    const rail = await railFor(ctx);
    const accounts = await ctx.db.selectFrom('bank_accounts').selectAll().where('connection_id', '=', conn.id).execute();
    const start = new Date(ctx.now().getTime() - input.days * 86400000).toISOString().slice(0, 10);
    let mirrored = 0;
    let reconciled = 0;
    let exceptions = 0;
    for (const acct of accounts) {
      const txs = await rail.listTransactions(acct.provider_account_id, { start });
      for (const tx of txs) {
        const row = await ctx.db
          .insertInto('bank_transactions')
          .values({
            workspace_id: w.id,
            bank_account_id: acct.id,
            provider_transaction_id: tx.id,
            amount_cents: tx.amountCents,
            status: tx.status,
            kind: tx.kind,
            counterparty_name: tx.counterpartyName,
            memo: tx.externalMemo,
            note: tx.note,
            posted_at: tx.postedAt,
            raw: json(tx.raw),
          })
          .onConflict((oc) => oc.columns(['workspace_id', 'provider_transaction_id']).doUpdateSet({ status: tx.status, posted_at: tx.postedAt, amount_cents: tx.amountCents }))
          .returning(['id', 'payment_id'])
          .executeTakeFirstOrThrow();
        mirrored++;
        if (tx.amountCents >= 0 || row.payment_id) continue;
        // Match: 1) linked transaction id, 2) idempotency key == payment id, 3) memo contains award reference + amount.
        let payment = await ctx.db.selectFrom('payments').selectAll().where('workspace_id', '=', w.id).where('rail_transaction_id', '=', tx.id).executeTakeFirst();
        if (!payment && tx.idempotencyKey) payment = await ctx.db.selectFrom('payments').selectAll().where('workspace_id', '=', w.id).where('id', '=', tx.idempotencyKey).executeTakeFirst();
        if (!payment && tx.externalMemo) {
          const m = /Grant ([A-Z0-9-]+)/.exec(tx.externalMemo);
          if (m) {
            payment = await ctx.db
              .selectFrom('payments as p')
              .innerJoin('awards as a', 'a.id', 'p.award_id')
              .selectAll('p')
              .where('p.workspace_id', '=', w.id)
              .where('a.reference', '=', m[1]!)
              .where('p.amount_cents', '=', -tx.amountCents)
              .where('p.status', 'in', ['sent', 'awaiting_bank_approval'])
              .executeTakeFirst();
          }
        }
        if (!payment) {
          await ctx.db.insertInto('recon_exceptions').values({ workspace_id: w.id, kind: 'unmatched_transaction', bank_transaction_id: row.id, details: `Outgoing ${formatMoney(-tx.amountCents)} to ${tx.counterpartyName ?? 'unknown'} has no matching payment.` }).execute();
          exceptions++;
          continue;
        }
        if (payment.amount_cents !== -tx.amountCents) {
          await ctx.db.insertInto('recon_exceptions').values({ workspace_id: w.id, kind: 'amount_mismatch', bank_transaction_id: row.id, payment_id: payment.id, details: `Bank shows ${formatMoney(-tx.amountCents)}; GMS expected ${formatMoney(payment.amount_cents)}.` }).execute();
          await ctx.db.updateTable('payments').set({ status: 'exception' }).where('id', '=', payment.id).execute();
          exceptions++;
          continue;
        }
        await ctx.db.updateTable('bank_transactions').set({ payment_id: payment.id }).where('id', '=', row.id).execute();
        if (tx.status === 'sent' && ['sent', 'awaiting_bank_approval'].includes(payment.status)) {
          if (payment.status === 'awaiting_bank_approval') await markSent(ctx, payment.id, tx.id);
          await ctx.db.updateTable('payments').set({ status: 'reconciled', reconciled_at: ctx.now().toISOString(), rail_transaction_id: tx.id }).where('id', '=', payment.id).execute();
          ctx.emit('payment.reconciled', { type: 'payment', id: payment.id });
          reconciled++;
        }
      }
    }
    // Payments marked sent long ago with no bank transaction.
    const stale = await ctx.db
      .selectFrom('payments')
      .select(['id', 'amount_cents'])
      .where('workspace_id', '=', w.id)
      .where('status', '=', 'sent')
      .where('rail', '=', 'mercury')
      .where('sent_at', '<', new Date(ctx.now().getTime() - 7 * 86400000).toISOString())
      .where((eb) => eb.not(eb.exists(eb.selectFrom('bank_transactions as t').select('t.id').whereRef('t.payment_id', '=', 'payments.id'))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('recon_exceptions as r').select('r.id').whereRef('r.payment_id', '=', 'payments.id').where('r.status', '=', 'open'))))
      .execute();
    for (const s of stale) {
      await ctx.db.insertInto('recon_exceptions').values({ workspace_id: w.id, kind: 'unmatched_payment', payment_id: s.id, details: `Payment of ${formatMoney(s.amount_cents)} was sent over a week ago but no bank transaction matches it.` }).execute();
      exceptions++;
    }
    if (mirrored || reconciled || exceptions) ctx.audit({ entityType: 'reconciliation', entityId: null, after: { mirrored, reconciled, exceptions } });
    return { mirrored, reconciled, exceptions };
  },
});

export const annotateTransaction = defineAction({
  id: 'system.annotate_transaction',
  title: 'Annotate the bank transaction',
  description: 'System task: sets the transaction note/category to “Grants paid” + award reference and attaches the award letter PDF in the bank.',
  input: z.object({ paymentId: uuid }),
  output: Ok,
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const p = await ctx.db
      .selectFrom('payments as p')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .leftJoin('bank_accounts as b', 'b.id', 'p.source_account_id')
      .select(['p.id', 'p.rail', 'p.rail_transaction_id', 'a.id as award_id', 'a.reference', 'b.provider_account_id'])
      .where('p.id', '=', input.paymentId)
      .executeTakeFirstOrThrow();
    if (p.rail !== 'mercury' || !p.rail_transaction_id || !p.provider_account_id) return { ok: true as const };
    const rail = await railFor(ctx);
    await rail.updateTransaction(p.provider_account_id, p.rail_transaction_id, { note: `Grants paid · ${p.reference}`, category: 'Grants paid' });
    const agreement = await ctx.db.selectFrom('agreements').select(['document_path']).where('award_id', '=', p.award_id).where('status', 'in', ['signed', 'countersigned']).executeTakeFirst();
    if (agreement?.document_path) {
      const bytes = await ctx.deps.storage.get('agreements', agreement.document_path);
      if (bytes) await rail.uploadTransactionAttachment(p.provider_account_id, p.rail_transaction_id, { fileName: `award-letter-${p.reference}.pdf`, contentType: 'application/pdf', data: bytes });
    }
    return { ok: true as const };
  },
});

export const resolveException = defineAction({
  id: 'payments.resolve_exception',
  title: 'Resolve a reconciliation exception',
  description: 'Resolves or ignores a reconciliation exception, optionally linking a bank transaction to a payment.',
  input: z.object({ exceptionId: uuid, resolution: z.enum(['resolved', 'ignored']), paymentId: uuid.optional(), note: z.string().trim().min(1).max(2000) }),
  output: Ok,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const ex = found(await ctx.db.selectFrom('recon_exceptions').selectAll().where('id', '=', input.exceptionId).executeTakeFirst(), 'exception');
    if (input.paymentId && ex.bank_transaction_id) {
      await ctx.db.updateTable('bank_transactions').set({ payment_id: input.paymentId }).where('id', '=', ex.bank_transaction_id).execute();
      await ctx.db.updateTable('payments').set({ status: 'reconciled', reconciled_at: ctx.now().toISOString() }).where('id', '=', input.paymentId).execute();
    } else if (ex.payment_id && input.resolution === 'resolved') {
      const p = await ctx.db.selectFrom('payments').select('status').where('id', '=', ex.payment_id).executeTakeFirst();
      if (p?.status === 'exception') await ctx.db.updateTable('payments').set({ status: 'reconciled', reconciled_at: ctx.now().toISOString() }).where('id', '=', ex.payment_id).execute();
    }
    await ctx.db.updateTable('recon_exceptions').set({ status: input.resolution, resolved_by: uid(ctx), resolved_at: ctx.now().toISOString(), note: input.note }).where('id', '=', ex.id).execute();
    ctx.audit({ entityType: 'recon_exception', entityId: ex.id, before: { status: ex.status }, after: { status: input.resolution, note: input.note } });
    return { ok: true as const };
  },
});

export const retryPayment = defineAction({
  id: 'payments.retry',
  title: 'Retry a failed payment',
  description: 'Returns a failed payment’s installment to Scheduled so it can be batched again.',
  input: z.object({ paymentId: uuid }),
  output: Ok,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const p = found(await ctx.db.selectFrom('payments').selectAll().where('id', '=', input.paymentId).executeTakeFirst(), 'payment');
    if (p.status !== 'failed') throw new DomainError('conflict', 'Only failed payments can be retried.');
    await ctx.db.updateTable('payments').set({ status: 'cancelled' }).where('id', '=', p.id).execute();
    ctx.audit({ entityType: 'payment', entityId: p.id, action: 'payments.retry', before: { status: 'failed' }, after: { status: 'cancelled', installmentReady: true } });
    return { ok: true as const };
  },
});

// Manual rail --------------------------------------------------------------------------------------------------
const ManualIn = z.object({
  awardId: uuid,
  installmentId: uuid.optional(),
  amountCents: z.number().int().positive(),
  paidOn: DateOnly,
  method: z.enum(['ach', 'check', 'domestic_wire', 'international_wire', 'manual']).default('manual'),
  reference: z.string().trim().max(200).optional(),
  memo: z.string().max(500).optional(),
});

async function recordManualPayment(ctx: RunContext, input: z.infer<typeof ManualIn>) {
  const w = ws(ctx);
  const a = found(await ctx.db.selectFrom('awards').select(['id', 'reference', 'status', 'applicant_org_id']).where('id', '=', input.awardId).executeTakeFirst(), 'award');
  if (a.status !== 'active' && a.status !== 'completed') throw new DomainError('precondition_failed', 'Payments can only be recorded against active awards.');
  const id = randomUUID();
  await ctx.db
    .insertInto('payments')
    .values({
      id,
      workspace_id: w.id,
      award_id: a.id,
      installment_id: input.installmentId ?? null,
      method: input.method,
      amount_cents: input.amountCents,
      status: 'sent',
      rail: 'manual',
      external_reference: input.reference ?? null,
      memo: input.memo ?? `Recorded payment · ${a.reference}`,
      sent_at: new Date(`${input.paidOn}T12:00:00Z`).toISOString(),
      created_by: uid(ctx),
    })
    .execute();
  if (input.installmentId) await ctx.db.updateTable('installments').set({ status: 'paid' }).where('id', '=', input.installmentId).execute();
  ctx.audit({ entityType: 'payment', entityId: id, after: { manual: true, amountCents: input.amountCents, paidOn: input.paidOn, method: PAYMENT_METHOD_LABELS[input.method] } });
  ctx.emit('payment.sent', { type: 'payment', id }, { amountCents: input.amountCents, awardId: a.id, manual: true });
  return id;
}

export const recordManual = defineAction({
  id: 'payments.record_manual',
  title: 'Record a payment made outside GMS',
  description: 'Records a grant payment made through another bank (manual rail). It counts toward the award’s disbursed amount and the 990-PF schedule.',
  input: ManualIn,
  output: IdOut,
  scopes: [],
  roles: FINANCE,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    return { id: await recordManualPayment(ctx, input) };
  },
});

export const importManualCsv = defineAction({
  id: 'payments.import_csv',
  title: 'Import payments from CSV',
  description: 'Imports payments made elsewhere from a CSV (award_reference, amount, paid_on, method, reference). Rows with errors are reported and skipped.',
  input: z.object({ rows: z.array(z.object({ awardReference: z.string(), amountCents: z.number().int().positive(), paidOn: DateOnly, method: z.string().optional(), reference: z.string().optional() })).min(1).max(2000) }),
  output: z.object({ imported: z.number(), errors: z.array(z.object({ row: z.number(), message: z.string() })) }),
  scopes: [],
  roles: FINANCE,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    let imported = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [i, r] of input.rows.entries()) {
      const a = await ctx.db.selectFrom('awards').select('id').where('workspace_id', '=', w.id).where('reference', '=', r.awardReference).executeTakeFirst();
      if (!a) {
        errors.push({ row: i + 1, message: `No award with reference ${r.awardReference}` });
        continue;
      }
      try {
        await sql`savepoint csv_row`.execute(ctx.db);
        const method = (['ach', 'check', 'domestic_wire', 'international_wire', 'manual'].includes(r.method ?? '') ? r.method : 'manual') as z.infer<typeof ManualIn>['method'];
        await recordManualPayment(ctx, { awardId: a.id, amountCents: r.amountCents, paidOn: r.paidOn, method, reference: r.reference });
        await sql`release savepoint csv_row`.execute(ctx.db);
        imported++;
      } catch (e) {
        await sql`rollback to savepoint csv_row`.execute(ctx.db);
        errors.push({ row: i + 1, message: (e as Error).message });
      }
    }
    return { imported, errors };
  },
});
