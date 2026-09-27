// SPDX-License-Identifier: AGPL-3.0-only
// P-05 Payment status tracking. ?state= (non-production): empty · failed · error
import { sql } from '@gms/db';
import { formatMoney, PAYMENT_METHOD_LABELS, PAYMENT_STATUS } from '@gms/domain';
import { Button, ErrorState, PageHeader, StatTile } from '@gms/ui';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { can, FINANCE_READ, FINANCE_WRITE, likeTerm, oneOf, paging, str, type SearchParams } from '@/components/console/finance/params';
import { PaymentsTable, type PaymentRow } from '@/components/console/finance/payments-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payment status' };

const STATUSES = Object.keys(PAYMENT_STATUS) as (keyof typeof PAYMENT_STATUS)[];
const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[];

export default async function PaymentStatusPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = forced === 'failed' ? 'failed' : oneOf(sp, 'status', STATUSES);
  const method = oneOf(sp, 'method', METHODS);
  const batchRaw = str(sp, 'batch');
  const batch = batchRaw && /^[0-9a-f-]{36}$/i.test(batchRaw) ? batchRaw : undefined;
  const q = str(sp, 'q')?.slice(0, 100);
  const header = (
    <PageHeader
      title="Payment status"
      breadcrumbs={[{ label: 'Payments', href: '/console/payments' }, { label: 'Status' }]}
      linkComponent={NextLink}
      description="Every grant payment and where it is: in GMS approval, waiting for approval in Mercury, sent, reconciled — or failed with the next step."
      actions={
        <Button asChild variant="outline">
          <a href="/console/payments/export" download>
            <Download aria-hidden="true" /> Export CSV
          </a>
        </Button>
      }
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load payments" description="Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    let base = trx
      .selectFrom('payments as p')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('payment_batches as b', 'b.id', 'p.batch_id')
      .where('p.workspace_id', '=', tenant.id);
    if (status) base = base.where('p.status', '=', status);
    if (method) base = base.where('p.method', '=', method);
    if (batch) base = base.where('p.batch_id', '=', batch);
    if (q) base = base.where((eb) => eb.or([eb('a.reference', 'ilike', likeTerm(q)), eb('o.legal_name', 'ilike', likeTerm(q))]));
    const [rows, count, summary, batches] = await Promise.all([
      base
        .select(['p.id', 'p.award_id', 'a.reference', 'o.legal_name', 'p.amount_cents', 'p.currency', 'p.method', 'p.rail', 'p.status', 'p.failure_reason', 'p.hold_reason', 'p.batch_id', 'b.name as batch_name', 'p.requested_at', 'p.sent_at', 'p.created_at'])
        .orderBy(sql`case p.status when 'failed' then 0 when 'exception' then 1 when 'awaiting_bank_approval' then 2 when 'awaiting_approval' then 3 else 4 end`)
        .orderBy('p.created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      trx
        .selectFrom('payments')
        .select(['status', sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('c')])
        .where('workspace_id', '=', tenant.id)
        .where('status', 'in', ['awaiting_approval', 'awaiting_bank_approval', 'failed', 'sent'])
        .groupBy('status')
        .execute(),
      trx.selectFrom('payment_batches').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('created_at', 'desc').limit(30).execute(),
    ]);
    return { rows, total: Number(count?.n ?? 0), summary, batches };
  });
  const rows: PaymentRow[] =
    forced === 'empty'
      ? []
      : d.rows.map((r) => ({
          id: r.id,
          awardId: r.award_id,
          awardReference: r.reference,
          grantee: r.legal_name ?? '—',
          amountCents: r.amount_cents,
          currency: r.currency,
          method: r.method,
          rail: r.rail,
          status: r.status,
          failureReason: r.failure_reason,
          holdReason: r.hold_reason,
          batchId: r.batch_id,
          batchName: r.batch_name,
          requestedAt: r.requested_at,
          sentAt: r.sent_at,
          createdAt: r.created_at,
        }));
  const s = (k: string) => d.summary.find((x) => x.status === k);
  return (
    <div className="grid gap-6">
      {header}
      <section aria-label="Payment status summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(['awaiting_approval', 'awaiting_bank_approval', 'failed', 'sent'] as const).map((k) => (
          <StatTile key={k} label={PAYMENT_STATUS[k].label} value={Number(s(k)?.n ?? 0)} footnote={formatMoney(Number(s(k)?.c ?? 0))} />
        ))}
      </section>
      <PaymentsTable
        rows={rows}
        total={forced === 'empty' ? 0 : d.total}
        page={page}
        pageSize={pageSize}
        filters={{ status, method, batch, q }}
        batches={d.batches}
        canWrite={can(viewer.role, FINANCE_WRITE)}
      />
    </div>
  );
}
