// SPDX-License-Identifier: AGPL-3.0-or-later
// P-06 Reconciliation exceptions. ?state= (non-production): empty · error
import { sql } from '@gms/db';
import { ErrorState, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { ExceptionsTable, type CandidatePayment, type ExceptionRow } from '@/components/console/finance/exceptions';
import { can, FINANCE_READ, FINANCE_WRITE, oneOf, paging, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Reconciliation exceptions' };

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = oneOf(sp, 'status', ['open', 'resolved', 'ignored', 'any'] as const) ?? 'open';
  const header = (
    <PageHeader
      title="Reconciliation exceptions"
      breadcrumbs={[{ label: 'Payments', href: '/console/payments' }, { label: 'Exceptions' }]}
      linkComponent={NextLink}
      description="Bank transactions GMS couldn’t match to a payment, payments with no bank transaction, and amount mismatches. Every resolution is recorded in the audit log."
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load exceptions" description="Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    let base = trx
      .selectFrom('recon_exceptions as e')
      .leftJoin('bank_transactions as t', 't.id', 'e.bank_transaction_id')
      .leftJoin('payments as p', 'p.id', 'e.payment_id')
      .leftJoin('awards as a', 'a.id', 'p.award_id')
      .where('e.workspace_id', '=', tenant.id);
    if (status !== 'any') base = base.where('e.status', '=', status);
    const [rows, count, candidates] = await Promise.all([
      base
        .select([
          'e.id',
          'e.kind',
          'e.status',
          'e.details',
          'e.created_at',
          'e.note',
          'e.resolved_by',
          'e.resolved_at',
          't.id as tx_id',
          't.provider_transaction_id',
          't.amount_cents as tx_amount',
          't.counterparty_name',
          't.posted_at',
          't.memo',
          'p.id as payment_id',
          'p.amount_cents as payment_amount',
          'p.status as payment_status',
          'a.reference',
        ])
        .orderBy('e.created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      trx
        .selectFrom('payments as p')
        .innerJoin('awards as a', 'a.id', 'p.award_id')
        .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
        .select(['p.id', 'a.reference', 'o.legal_name', 'p.amount_cents', 'p.status'])
        .where('p.workspace_id', '=', tenant.id)
        .where('p.status', 'in', ['sent', 'awaiting_bank_approval', 'exception'])
        .where((eb) => eb.not(eb.exists(eb.selectFrom('bank_transactions as t').select('t.id').whereRef('t.payment_id', '=', 'p.id'))))
        .orderBy('p.created_at', 'desc')
        .limit(200)
        .execute(),
    ]);
    return { rows, total: Number(count?.n ?? 0), candidates };
  });
  const rows: ExceptionRow[] =
    forced === 'empty'
      ? []
      : d.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          details: r.details,
          createdAt: r.created_at,
          note: r.note,
          resolvedBy: r.resolved_by,
          resolvedAt: r.resolved_at,
          tx: r.tx_id
            ? { id: r.tx_id, providerId: r.provider_transaction_id ?? '', amountCents: r.tx_amount ?? 0, counterparty: r.counterparty_name, postedAt: r.posted_at, memo: r.memo }
            : null,
          payment: r.payment_id ? { id: r.payment_id, awardReference: r.reference ?? '—', amountCents: r.payment_amount ?? 0, status: r.payment_status ?? '' } : null,
        }));
  const candidates: CandidatePayment[] = d.candidates.map((c) => ({ id: c.id, awardReference: c.reference, grantee: c.legal_name ?? '—', amountCents: c.amount_cents, status: c.status }));
  return (
    <div className="grid gap-6">
      {header}
      <ExceptionsTable rows={rows} total={forced === 'empty' ? 0 : d.total} page={page} pageSize={pageSize} status={status} candidates={candidates} canWrite={can(viewer.role, FINANCE_WRITE)} />
    </div>
  );
}
