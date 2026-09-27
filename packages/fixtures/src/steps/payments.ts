// SPDX-License-Identifier: AGPL-3.0-only
// The fake Mercury bank, payees (real fake-rail recipients for ready payees), payment batches with maker-checker
// approvals, 64 Halcyon payments across every status, bank transactions and reconciliation exceptions.
import { FakeMercury, fakeMercuryControls } from '@gms/adapters';
import { mercuryFeeCents } from '@gms/domain';
import { json, type Row, type SeedContext } from '../context';
import type { AwardRec, Awards, InstallmentPlan } from './awards';
import type { Catalog } from './catalog';

export interface PaymentsOut {
  accounts: { operating: string; youthArts: string };
  batchAwaitingApproval: string;
  payments: number;
}

interface BatchDef {
  key: string;
  name: string;
  account: 'operating' | 'youthArts';
  creator: 'priya' | 'marcus';
  createdAt: string;
  status: 'draft' | 'awaiting_approval' | 'submitted' | 'rejected';
  approvedAt?: string;
  submittedAt?: string;
  note?: string;
  items: { award: AwardRec; position: number; plan: InstallmentPlan }[];
}

export async function payments(ctx: SeedContext, cat: Catalog, aw: Awards): Promise<PaymentsOut> {
  const c = ctx.clock;
  const hal = ctx.ws('halcyon');
  const db = ctx.db;

  // Bank: fake Mercury accounts, the connection (as Priya connected it), mirrored accounts, program mapping.
  const controls = fakeMercuryControls(hal.id, db);
  const seeded = await controls.seedAccounts([
    { name: 'Halcyon Operating', mask: '4821', availableCents: 240_000_000 },
    { name: 'Youth Arts Fund', mask: '0937', availableCents: 61_200_000 },
  ]);
  const rail = new FakeMercury({ workspaceId: hal.id, db });
  const hook = await rail.createWebhook({ url: `${ctx.runtime.deps.origin('halcyon')}/webhooks/mercury`, eventTypes: ['transaction.created', 'transaction.updated', 'balance.updated'] });
  const hookRef = await ctx.runtime.adapters.secrets.put(`mercury-webhook:${hal.id}`, hook.secret, { workspaceId: hal.id });
  const connectionId = ctx.id('bank-connection:halcyon');
  const connectedAt = c.iso(-400);
  await ctx.insert('bank_connections', [
    { id: connectionId, workspace_id: hal.id, provider: 'mercury', mode: 'token', environment: 'fake', webhook_id: hook.webhookId, webhook_secret_ref: hookRef, webhook_status: 'active', status: 'connected', last_synced_at: c.iso(0, -1), connected_by: ctx.person('priya').id, created_at: connectedAt },
  ]);
  ctx.audit({ workspace: 'halcyon', at: connectedAt, actor: ctx.human('priya'), action: 'bank.connect', entityType: 'bank_connection', entityId: connectionId, after: { provider: 'mercury', environment: 'fake', accounts: 2, webhook: 'active' }, riskTier: 'R3' });
  const accountId = { operating: ctx.id('bank-account:halcyon:operating'), youthArts: ctx.id('bank-account:halcyon:youth-arts') };
  const providerId = { operating: seeded[0]!.id, youthArts: seeded[1]!.id };
  await ctx.insert('bank_accounts', [
    { id: accountId.operating, workspace_id: hal.id, connection_id: connectionId, provider_account_id: providerId.operating, name: 'Halcyon Operating', mask: '4821', kind: 'checking', available_cents: 240_000_000, current_cents: 240_000_000, balance_updated_at: c.iso(0, -1), created_at: connectedAt },
    { id: accountId.youthArts, workspace_id: hal.id, connection_id: connectionId, provider_account_id: providerId.youthArts, name: 'Youth Arts Fund', mask: '0937', kind: 'checking', available_cents: 61_200_000, current_cents: 61_200_000, balance_updated_at: c.iso(0, -1), created_at: connectedAt },
  ]);
  const mapping: [string, 'operating' | 'youthArts'][] = [['yaf', 'youthArts'], ['nfs', 'operating'], ['cbg', 'operating']];
  await ctx.insert(
    'program_accounts',
    mapping.map(([p, a]) => ({ id: ctx.id(`program-account:${p}`), workspace_id: hal.id, program_id: cat.programs[p]!, bank_account_id: accountId[a], is_default: true, created_at: connectedAt })),
  );
  for (const [p, a] of mapping) {
    ctx.audit({ workspace: 'halcyon', at: connectedAt, actor: ctx.human('priya'), action: 'bank.map_program_account', entityType: 'program', entityId: cat.programs[p]!, after: { bankAccountId: accountId[a] }, riskTier: 'R3' });
  }
  // Marigold pays by check/manual transfer.
  await ctx.insert('bank_connections', [{ id: ctx.id('bank-connection:marigold'), workspace_id: ctx.ws('marigold').id, provider: 'manual', mode: 'none', environment: 'fake', status: 'connected', connected_by: ctx.person('ines').id, created_at: c.iso(-300) }]);

  // Payees -------------------------------------------------------------------------------------------------
  const payeeRows: Row<'payees'>[] = [];
  const payeeId = new Map<string, string>();
  for (const r of aw.all) {
    const w = ctx.ws(r.ws);
    const id = ctx.id(`payee:${r.ws}:${r.app.org.id}`);
    payeeId.set(r.id, id);
    const invitedAt = new Date(Date.parse(r.createdAt) + 9 * 86_400_000).toISOString();
    if (r.ws !== 'halcyon') {
      payeeRows.push({ id, workspace_id: w.id, applicant_org_id: r.app.org.id, provider: 'manual', status: 'ready', contact_email: r.app.org.admin.email, payment_methods: ['check'], invited_at: invitedAt, ready_at: invitedAt, created_at: invitedAt });
      continue;
    }
    const invite = await rail.createRecipientInvite({
      contactEmail: r.app.org.admin.email,
      name: r.app.org.name,
      paymentMethods: ['ach'],
      requireTaxDocument: true,
      sendEmail: false,
      organizationNameOnRequest: r.app.org.name,
    });
    let recipientId: string | null = null;
    let inviteStatus: 'created' | 'completed' | 'expired' = 'created';
    if (r.payee === 'ready') {
      recipientId = (await controls.completeInvite(invite.inviteId, { recipientName: r.app.org.name })).recipientId;
      inviteStatus = 'completed';
    } else if (r.payee === 'invite_expired') {
      await controls.expireInvite(invite.inviteId);
      inviteStatus = 'expired';
    }
    const readyAt = new Date(Date.parse(invitedAt) + 3 * 86_400_000).toISOString();
    payeeRows.push({
      id,
      workspace_id: w.id,
      applicant_org_id: r.app.org.id,
      provider: 'mercury',
      provider_recipient_id: recipientId,
      invite_id: invite.inviteId,
      onboarding_url: invite.onboardingUrl,
      invite_status: inviteStatus,
      status: r.payee,
      contact_email: r.app.org.admin.email,
      payment_methods: ['ach'],
      invited_at: r.payee === 'invite_expired' ? c.iso(-40) : r.payee === 'invite_sent' ? c.iso(-4) : invitedAt,
      ready_at: r.payee === 'ready' ? readyAt : null,
      last_polled_at: c.iso(0, -1),
      created_at: invitedAt,
    });
    ctx.audit({ workspace: 'halcyon', at: invitedAt, actor: ctx.human('priya'), action: 'payees.invite', entityType: 'payee', entityId: id, after: { org: r.app.org.name } });
    if (r.payee === 'ready') ctx.audit({ workspace: 'halcyon', at: readyAt, actor: { type: 'system' }, action: 'system.poll_payees', entityType: 'payee', entityId: id, before: { status: 'invite_sent' }, after: { status: 'ready' } });
  }
  await ctx.insert('payees', payeeRows);

  // Batches and payments -------------------------------------------------------------------------------------
  const yaf = aw.yaf;
  const nfs = aw.nfs;
  const pick = (awards: AwardRec[], position: number, plan: InstallmentPlan) =>
    awards.filter((a) => a.installments.find((i) => i.position === position)?.plan === plan).map((award) => ({ award, position, plan }));
  const batches: BatchDef[] = [
    { key: 'y1', name: 'Youth Arts Fund 2025: first installments', account: 'youthArts', creator: 'priya', createdAt: '2025-06-18T17:00:00.000Z', approvedAt: '2025-06-19T16:00:00.000Z', submittedAt: '2025-06-20T16:30:00.000Z', status: 'submitted', items: pick(yaf, 1, 'reconciled') },
    { key: 'y1b', name: 'Youth Arts Fund 2025: final installments (one-year grants)', account: 'youthArts', creator: 'priya', createdAt: '2025-12-11T17:00:00.000Z', approvedAt: '2025-12-12T16:00:00.000Z', submittedAt: '2025-12-15T16:30:00.000Z', status: 'submitted', items: pick(yaf.filter((a) => a.status === 'completed'), 2, 'reconciled') },
    { key: 'n1', name: 'Neighborhood Food Security 2026: first installments', account: 'operating', creator: 'priya', createdAt: '2026-04-13T17:00:00.000Z', approvedAt: '2026-04-14T16:00:00.000Z', submittedAt: '2026-04-15T16:30:00.000Z', status: 'submitted', items: [...pick(nfs, 1, 'reconciled'), ...pick(nfs, 1, 'exception')] },
    { key: 'n2', name: 'Neighborhood Food Security 2026: first installments (round 2)', account: 'operating', creator: 'marcus', createdAt: '2026-05-04T17:00:00.000Z', status: 'rejected', note: 'Rejected: hold these until the new board treasurer confirms the bank details.', items: pick(nfs, 1, 'cancelled') },
    { key: 'y2a', name: 'Youth Arts year-two installments (group 1)', account: 'youthArts', creator: 'priya', createdAt: c.iso(-23), approvedAt: c.iso(-22), submittedAt: c.iso(-21), status: 'submitted', items: pick(yaf, 2, 'failed') },
    { key: 'y2b', name: 'Youth Arts year-two installments (group 2)', account: 'youthArts', creator: 'priya', createdAt: c.iso(-8), approvedAt: c.iso(-7), submittedAt: c.iso(-6), status: 'submitted', items: [...pick(yaf, 2, 'sent'), ...pick(yaf, 2, 'awaiting_bank_approval')] },
    { key: 'await', name: 'October grant payments', account: 'operating', creator: 'priya', createdAt: c.iso(-1, -2), status: 'awaiting_approval', items: pick(nfs, 2, 'awaiting_approval') },
    { key: 'draft', name: 'Draft: payments due in two weeks', account: 'operating', creator: 'marcus', createdAt: c.iso(0, -5), status: 'draft', items: pick(nfs, 2, 'in_batch') },
  ];
  const settings = await db.selectFrom('workspace_settings').select('second_approval_threshold_cents').where('workspace_id', '=', hal.id).executeTakeFirstOrThrow();
  const threshold = settings.second_approval_threshold_cents;

  const batchRows: Row<'payment_batches'>[] = [];
  const approvals: Row<'payment_approvals'>[] = [];
  const paymentRows: Row<'payments'>[] = [];
  const txRows: Row<'bank_transactions'>[] = [];
  const exceptions: Row<'recon_exceptions'>[] = [];
  let seq = 0;
  const installment = (a: AwardRec, position: number) => a.installments.find((i) => i.position === position)!;
  const accountFor = (a: AwardRec): 'operating' | 'youthArts' => (a.group === 'yaf' ? 'youthArts' : 'operating');
  let batchAwaitingApproval = '';

  const addPayment = (a: AwardRec, position: number, plan: InstallmentPlan, batch: BatchDef | null, batchId: string | null) => {
    const inst = installment(a, position);
    const id = ctx.id(`payment:${inst.id}:${plan}`);
    const n = ++seq;
    const acct = accountFor(a);
    const requestedAt = batch?.submittedAt ?? null;
    const sentAt =
      plan === 'reconciled' || plan === 'exception'
        ? new Date(Date.parse(requestedAt!) + 86_400_000).toISOString()
        : plan === 'sent'
          ? c.iso(-(3 + (n % 3)))
          : null;
    const status = plan === 'none' ? 'scheduled' : plan;
    paymentRows.push({
      id,
      workspace_id: hal.id,
      award_id: a.id,
      installment_id: inst.id,
      batch_id: batchId,
      payee_id: payeeId.get(a.id)!,
      source_account_id: accountId[acct],
      method: 'ach',
      amount_cents: inst.amount,
      fee_cents: mercuryFeeCents('ach', inst.amount),
      status,
      rail: 'mercury',
      rail_ref: ['reconciled', 'sent', 'exception', 'failed'].includes(plan) ? `seed_req_${String(n).padStart(4, '0')}` : null,
      rail_transaction_id: ['reconciled', 'sent', 'exception'].includes(plan) ? `seed_txn_${String(n).padStart(4, '0')}` : null,
      idempotency_key: id,
      hold_reason: plan === 'held' ? a.onHold : null,
      failure_reason: plan === 'failed' ? (n % 2 ? 'The bank request was rejected.' : 'Bank transaction failed: the receiving account was closed.') : null,
      memo: `Grants paid · ${a.ref}`,
      requested_at: ['failed', 'awaiting_bank_approval', 'sent', 'reconciled', 'exception'].includes(plan) ? requestedAt : null,
      sent_at: sentAt,
      reconciled_at: plan === 'reconciled' ? new Date(Date.parse(sentAt!) + 2 * 86_400_000).toISOString() : null,
      created_by: ctx.person(batch?.creator ?? 'priya').id,
      created_at: batch?.createdAt ?? c.iso(-12),
      last_modified_at: sentAt ?? batch?.createdAt ?? c.iso(-12),
    });
    if (plan === 'reconciled' || plan === 'sent' || plan === 'exception') {
      const txId = ctx.id(`bank-tx:${id}`);
      const bankAmount = plan === 'exception' ? -(inst.amount - 25_000) : -inst.amount;
      txRows.push({
        id: txId,
        workspace_id: hal.id,
        bank_account_id: accountId[acct],
        provider_transaction_id: `seed_txn_${String(n).padStart(4, '0')}`,
        amount_cents: bankAmount,
        status: plan === 'sent' ? 'pending' : 'sent',
        kind: 'outgoingPayment',
        counterparty_name: a.app.org.name,
        memo: `Grant ${a.ref}`,
        note: `Grants paid · ${a.ref}`,
        posted_at: plan === 'sent' ? null : new Date(Date.parse(sentAt!) + 86_400_000).toISOString(),
        raw: json({ source: 'seed' }),
        payment_id: plan === 'exception' ? null : id,
        created_at: sentAt!,
      });
      if (plan === 'exception') {
        exceptions.push({
          id: ctx.id(`recon-exception:${id}`),
          workspace_id: hal.id,
          kind: 'amount_mismatch',
          bank_transaction_id: txId,
          payment_id: id,
          details: `Bank shows $${((inst.amount - 25_000) / 100).toFixed(2)}; GMS expected $${(inst.amount / 100).toFixed(2)}.`,
          status: 'open',
          created_at: new Date(Date.parse(sentAt!) + 2 * 86_400_000).toISOString(),
        });
      }
    }
    return { id, amount: inst.amount };
  };

  for (const b of batches) {
    const id = ctx.id(`batch:${b.key}`);
    if (b.key === 'await') batchAwaitingApproval = id;
    const made = b.items.map((it) => addPayment(it.award, it.position, it.plan, b, id));
    const total = made.reduce((s, p) => s + p.amount, 0);
    const second = total >= threshold;
    if (b.key === 'await' && second) throw new Error(`the batch awaiting approval must stay under the second-approval threshold (${total} >= ${threshold})`);
    const creator = ctx.person(b.creator);
    const approver = b.creator === 'priya' ? ctx.person('marcus') : ctx.person('priya');
    const approved = b.status === 'submitted';
    batchRows.push({
      id,
      workspace_id: hal.id,
      name: b.name,
      source_account_id: accountId[b.account],
      method: 'ach',
      status: b.status,
      requires_second_approval: second,
      total_cents: total,
      created_by: creator.id,
      approved_by: approved ? approver.id : null,
      approved_at: approved ? b.approvedAt! : null,
      second_approved_by: approved && second ? ctx.person('helen').id : null,
      second_approved_at: approved && second ? new Date(Date.parse(b.approvedAt!) + 3_600_000).toISOString() : null,
      submitted_at: approved ? b.submittedAt! : null,
      note: b.note ?? null,
      created_at: b.createdAt,
      last_modified_at: b.submittedAt ?? b.createdAt,
    });
    ctx.audit({ workspace: 'halcyon', at: b.createdAt, actor: ctx.human(b.creator), action: 'payments.propose_batch', entityType: 'payment_batch', entityId: id, after: { included: made.length, totalCents: total, method: 'ach' } });
    if (b.status !== 'draft') {
      ctx.audit({ workspace: 'halcyon', at: new Date(Date.parse(b.createdAt) + 600_000).toISOString(), actor: ctx.human(b.creator), action: 'payments.submit_batch_for_approval', entityType: 'payment_batch', entityId: id, before: { status: 'draft' }, after: { status: 'awaiting_approval' } });
    }
    if (approved) {
      approvals.push({ id: ctx.id(`approval:${b.key}:1`), workspace_id: hal.id, batch_id: id, approver_id: approver.id, decision: 'approve', aal: 'aal2', note: null, created_at: b.approvedAt! });
      ctx.audit({ workspace: 'halcyon', at: b.approvedAt!, actor: { type: 'human', id: approver.id, name: approver.name }, action: 'payments.approve_batch', entityType: 'payment_batch', entityId: id, after: second ? { approval: 1, of: 2 } : { status: 'approved' }, riskTier: 'R3' });
      if (second) {
        const at = new Date(Date.parse(b.approvedAt!) + 3_600_000).toISOString();
        approvals.push({ id: ctx.id(`approval:${b.key}:2`), workspace_id: hal.id, batch_id: id, approver_id: ctx.person('helen').id, decision: 'approve', aal: 'aal2', note: 'Second approval (over threshold).', created_at: at });
        ctx.audit({ workspace: 'halcyon', at, actor: ctx.human('helen'), action: 'payments.approve_batch', entityType: 'payment_batch', entityId: id, after: { status: 'approved' }, riskTier: 'R3' });
      }
      ctx.audit({ workspace: 'halcyon', at: b.submittedAt!, actor: { type: 'system' }, action: 'system.submit_batch', entityType: 'payment_batch', entityId: id, before: { status: 'approved' }, after: { status: 'submitted', requested: made.length } });
    }
    if (b.status === 'rejected') {
      const at = new Date(Date.parse(b.createdAt) + 20 * 3_600_000).toISOString();
      approvals.push({ id: ctx.id(`approval:${b.key}:reject`), workspace_id: hal.id, batch_id: id, approver_id: approver.id, decision: 'reject', aal: 'aal2', note: b.note ?? null, created_at: at });
      ctx.audit({ workspace: 'halcyon', at, actor: { type: 'human', id: approver.id, name: approver.name }, action: 'payments.reject_batch', entityType: 'payment_batch', entityId: id, before: { status: 'awaiting_approval' }, after: { status: 'rejected' }, riskTier: 'R3' });
    }
  }
  // Payments outside any batch: scheduled (payee ready, due soon) and held.
  for (const it of [...pick(nfs, 2, 'scheduled'), ...pick(nfs, 2, 'held')]) addPayment(it.award, it.position, it.plan, null, null);

  // Other bank activity: an incoming transfer and an outgoing payment nobody can match.
  const unmatched = ctx.id('bank-tx:unmatched');
  txRows.push(
    { id: ctx.id('bank-tx:incoming'), workspace_id: hal.id, bank_account_id: accountId.operating, provider_transaction_id: 'seed_txn_in_0001', amount_cents: 25_000_000, status: 'sent', kind: 'incomingDomesticWire', counterparty_name: 'Halcyon Ridge Endowment Trust', memo: 'Quarterly distribution', posted_at: c.iso(-30), raw: json({ source: 'seed' }), created_at: c.iso(-30) },
    { id: unmatched, workspace_id: hal.id, bank_account_id: accountId.operating, provider_transaction_id: 'seed_txn_out_0001', amount_cents: -125_000, status: 'sent', kind: 'outgoingPayment', counterparty_name: 'Ridgeline Print & Copy', memo: null, posted_at: c.iso(-9), raw: json({ source: 'seed' }), created_at: c.iso(-9) },
  );
  exceptions.push({ id: ctx.id('recon-exception:unmatched'), workspace_id: hal.id, kind: 'unmatched_transaction', bank_transaction_id: unmatched, details: 'Outgoing $1,250.00 to Ridgeline Print & Copy has no matching payment.', status: 'open', created_at: c.iso(-8) });

  await ctx.insert('payment_batches', batchRows);
  // Payments go in one at a time per award tree so the ceiling trigger sees a consistent state; the gate
  // trigger checks ready payees and holds for batched statuses.
  await ctx.insert('payments', paymentRows, 100);
  await ctx.insert('payment_approvals', approvals);
  await ctx.insert('bank_transactions', txRows);
  await ctx.insert('recon_exceptions', exceptions);
  ctx.audit({ workspace: 'halcyon', at: c.iso(0, -6), actor: { type: 'system' }, action: 'system.reconcile', entityType: 'reconciliation', entityId: null, after: { mirrored: txRows.length, reconciled: paymentRows.filter((p) => p.status === 'reconciled').length, exceptions: exceptions.length } });

  // Bank-side requests for the payments awaiting approval in Mercury, so /dev simulate controls can approve them.
  for (const p of paymentRows.filter((x) => x.status === 'awaiting_bank_approval')) {
    const payee = payeeRows.find((y) => y.id === p.payee_id)!;
    const req = await rail.requestSendMoney(providerId.youthArts, {
      recipientId: payee.provider_recipient_id!,
      amountCents: p.amount_cents,
      paymentMethod: 'ach',
      idempotencyKey: p.id!,
      note: p.memo ?? undefined,
      externalMemo: p.memo?.replace('Grants paid · ', 'Grant ') ?? undefined,
    });
    await db.updateTable('payments').set({ rail_ref: req.requestId }).where('id', '=', p.id!).execute();
  }

  return { accounts: accountId, batchAwaitingApproval, payments: paymentRows.length };
}
