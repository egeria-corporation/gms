// SPDX-License-Identifier: AGPL-3.0-or-later
// P-07 Payment detail: milestones (created → batched → approved → requested → sent → reconciled), the activity
// timeline from the audit log and bank webhooks, references (idempotency key, Mercury request id, transaction
// id), and the award. ?state= (non-production): failed · error
import { sql } from '@gms/db';
import { formatDateOnly, formatInZone, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import { Alert, Card, CardContent, CardHeader, CardTitle, DescriptionList, ErrorState, MoneyDisplay, PageHeader, StatusChip, Timeline, type TimelineEvent } from '@gms/ui';
import { CheckCircle2, Circle, CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auditActor, describeAudit } from '@/components/console/finance/audit-text';
import { can, FINANCE_READ, FINANCE_WRITE, type SearchParams } from '@/components/console/finance/params';
import { RetryPaymentButton } from '@/components/console/finance/payments-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payment' };

export default async function PaymentDetail({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const { paymentId } = await params;
  const forced = forcedState(await searchParams);
  const breadcrumbs = [{ label: 'Payments', href: '/console/payments' }, { label: 'Status', href: '/console/payments/status' }, { label: 'Payment' }];
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Payment" breadcrumbs={breadcrumbs} linkComponent={NextLink} />
        <ErrorState title="We couldn’t load this payment" description="Refresh to try again." />
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) notFound();
  const d = await rls(async (trx) => {
    const p = await trx
      .selectFrom('payments as p')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('payment_batches as b', 'b.id', 'p.batch_id')
      .leftJoin('bank_accounts as ba', 'ba.id', 'p.source_account_id')
      .leftJoin('installments as i', 'i.id', 'p.installment_id')
      .leftJoin('payees as y', 'y.id', 'p.payee_id')
      .selectAll('p')
      .select([
        'a.reference',
        'a.title as award_title',
        'o.legal_name',
        'b.name as batch_name',
        'b.status as batch_status',
        'b.created_at as batch_created_at',
        'b.approved_at',
        'b.second_approved_at',
        'b.requires_second_approval',
        'ba.name as account_name',
        'ba.mask as account_mask',
        'i.position',
        'i.due_date',
        'y.status as payee_status',
      ])
      .where('p.id', '=', paymentId)
      .where('p.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!p) return null;
    const [audit, events, txs, exceptions] = await Promise.all([
      trx
        .selectFrom('audit_log')
        .select(['id', 'occurred_at', 'actor_type', 'actor_name', 'on_behalf_of_name', 'action', 'after'])
        .where('workspace_id', '=', tenant.id)
        .where((eb) => eb.or([eb.and([eb('entity_type', '=', 'payment'), eb('entity_id', '=', p.id)]), ...(p.batch_id ? [eb.and([eb('entity_type', '=', 'payment_batch'), eb('entity_id', '=', p.batch_id)])] : [])]))
        .orderBy('occurred_at')
        .limit(200)
        .execute(),
      p.rail_transaction_id
        ? trx
            .selectFrom('rail_events')
            .select(['id', 'event_id', 'event_type', 'received_at', 'processed_at', 'payload'])
            .where('workspace_id', '=', tenant.id)
            .where(sql<string>`payload ->> 'resourceId'`, '=', p.rail_transaction_id)
            .orderBy('received_at')
            .limit(50)
            .execute()
        : Promise.resolve([]),
      trx.selectFrom('bank_transactions').select(['id', 'provider_transaction_id', 'amount_cents', 'status', 'posted_at', 'counterparty_name']).where('payment_id', '=', p.id).execute(),
      trx.selectFrom('recon_exceptions').select(['id', 'kind', 'status', 'details']).where('payment_id', '=', p.id).execute(),
    ]);
    return { p, audit, events, txs, exceptions };
  });
  if (!d) notFound();
  const { p } = d;
  const status = forced === 'failed' ? 'failed' : p.status;
  const failureReason = forced === 'failed' ? (p.failure_reason ?? 'The bank request was rejected.') : p.failure_reason;
  const approvedAt = p.requires_second_approval ? p.second_approved_at : p.approved_at;
  const failed = status === 'failed' || status === 'cancelled';
  const milestones: { label: string; at: string | null; done: boolean }[] = [
    { label: 'Created', at: p.created_at, done: true },
    { label: 'Batched', at: p.batch_created_at, done: Boolean(p.batch_id) || p.rail === 'manual' },
    { label: 'Approved in GMS', at: approvedAt, done: Boolean(approvedAt) || p.rail === 'manual' },
    { label: 'Requested from Mercury', at: p.requested_at, done: Boolean(p.requested_at) || p.rail === 'manual' },
    { label: 'Sent', at: p.sent_at, done: Boolean(p.sent_at) && status !== 'failed' },
    { label: 'Reconciled', at: p.reconciled_at, done: Boolean(p.reconciled_at) },
  ];
  const events: TimelineEvent[] = [
    ...d.audit.map((a) => {
      const v = describeAudit(a);
      return { id: `a-${a.id}`, actor: auditActor(a), action: v.text, at: a.occurred_at, tone: v.tone };
    }),
    ...d.events.map((e) => {
      const patch = (e.payload as { mergePatch?: { status?: string } }).mergePatch;
      return {
        id: `e-${e.id}`,
        actor: { type: 'system' as const, name: 'Mercury' },
        action: `received a bank webhook: ${e.event_type}${patch?.status ? ` (status ${patch.status})` : ''}`,
        at: e.received_at,
        tone: 'info' as const,
        detail: <span className="text-xs text-muted-foreground">Event {e.event_id}{e.processed_at ? ' · applied' : ' · waiting to be applied'}</span>,
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <>
            <MoneyDisplay cents={p.amount_cents} currency={p.currency} /> to {p.legal_name ?? 'grantee'}
          </>
        }
        breadcrumbs={breadcrumbs}
        linkComponent={NextLink}
        meta={<StatusChip kind="payment" value={status} />}
        description={`${p.reference} · ${PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}${p.rail === 'manual' ? ' · paid outside GMS' : ''}`}
      />

      {status === 'failed' ? (
        <Alert variant="danger" title="This payment failed" actions={can(viewer.role, FINANCE_WRITE) ? <RetryPaymentButton id={p.id} /> : undefined}>
          {failureReason ?? 'The bank did not complete it.'} Retry puts the installment back on the schedule so it can go in the next batch; nothing is resent automatically.
        </Alert>
      ) : null}
      {status === 'awaiting_bank_approval' ? (
        <Alert variant="warning" title="Awaiting bank approval (Mercury)">
          GMS asked Mercury to send this payment. A person with approval rights must approve the request in Mercury before money moves.
        </Alert>
      ) : null}
      {status === 'held' ? <Alert variant="danger" title="On hold">{p.hold_reason ?? 'The award is on hold.'}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {milestones.map((m, i) => {
              const isFailedStep = failed && !m.done && milestones.slice(0, i).every((x) => x.done);
              const Icon = m.done ? CheckCircle2 : isFailedStep ? CircleX : Circle;
              return (
                <li key={m.label} className="flex items-start gap-2 text-sm">
                  <Icon aria-hidden="true" className={`mt-0.5 size-4.5 shrink-0 ${m.done ? 'text-status-success-fg' : isFailedStep ? 'text-status-danger-fg' : 'text-muted-foreground'}`} />
                  <span className="grid">
                    <span className={m.done ? 'font-medium' : 'text-muted-foreground'}>
                      {m.label}
                      <span className="sr-only">{m.done ? ' (done)' : isFailedStep ? ' (failed here)' : ' (not yet)'}</span>
                    </span>
                    {m.done && m.at ? <span className="text-xs text-muted-foreground">{formatInZone(m.at, tenant.timezone)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                {
                  term: 'Award',
                  detail: (
                    <Link href={`/console/awards/${p.award_id}`} className="font-medium hover:underline">
                      {p.reference} · {p.award_title}
                    </Link>
                  ),
                },
                { term: 'Installment', detail: p.position ? `#${p.position}, due ${formatDateOnly(p.due_date)}` : null },
                { term: 'Amount', detail: <MoneyDisplay cents={p.amount_cents} currency={p.currency} showCurrencyCode />, numeric: true },
                { term: 'Mercury fee', detail: <MoneyDisplay cents={p.fee_cents} />, numeric: true },
                { term: 'Source account', detail: p.account_name ? `${p.account_name}${p.account_mask ? ` ··${p.account_mask}` : ''}` : p.rail === 'manual' ? 'Outside GMS' : null },
                { term: 'Payee', detail: p.payee_status ? <StatusChip kind="payee" value={p.payee_status} size="sm" /> : null },
                {
                  term: 'Batch',
                  detail: p.batch_id ? (
                    <Link href={`/console/payments/batches/${p.batch_id}`} className="hover:underline">
                      {p.batch_name}
                    </Link>
                  ) : null,
                },
                { term: 'Memo', detail: p.memo },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              References
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { term: 'Payment id', detail: <code className="break-all text-xs">{p.id}</code> },
                { term: 'Idempotency key', detail: <code className="break-all text-xs">{p.rail === 'mercury' ? p.id : p.idempotency_key}</code> },
                { term: 'Mercury request id', detail: p.rail_ref ? <code className="break-all text-xs">{p.rail_ref}</code> : null },
                { term: 'Mercury transaction id', detail: p.rail_transaction_id ? <code className="break-all text-xs">{p.rail_transaction_id}</code> : null },
                { term: 'External reference', detail: p.external_reference },
                {
                  term: 'Bank transaction',
                  detail: d.txs.length
                    ? d.txs.map((t) => (
                        <span key={t.id} className="block">
                          <MoneyDisplay cents={t.amount_cents} /> · {t.status}
                          {t.posted_at ? ` · posted ${formatDateOnly(t.posted_at)}` : ''}
                        </span>
                      ))
                    : null,
                },
                {
                  term: 'Exceptions',
                  detail: d.exceptions.length
                    ? d.exceptions.map((e) => (
                        <Link key={e.id} href="/console/payments/exceptions?status=any" className="block hover:underline">
                          {e.details} ({e.status})
                        </Link>
                      ))
                    : null,
                },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">Mercury receives the payment id as its idempotency key, so a retried request can never pay twice.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>{events.length ? <Timeline events={events} timeZone={tenant.timezone} /> : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}</CardContent>
      </Card>
    </div>
  );
}
