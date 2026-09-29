// SPDX-License-Identifier: AGPL-3.0-or-later
// CSV export of payments (read-only, under RLS as the viewer). Same columns as the manual-rail import.
import { paymentsToCsv, type PaymentCsvRow } from '@gms/adapters';
import type { PaymentMethod } from '@gms/domain';
import { FINANCE_READ } from '@/components/console/finance/params';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const status = new URL(req.url).searchParams.get('status');
  const rows = await rls(async (trx) => {
    let q = trx
      .selectFrom('payments as p')
      .innerJoin('awards as a', 'a.id', 'p.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .select(['p.id', 'a.reference', 'o.legal_name', 'p.amount_cents', 'p.currency', 'p.method', 'p.sent_at', 'p.external_reference', 'p.rail_ref', 'p.memo', 'p.status'])
      .where('p.workspace_id', '=', tenant.id)
      .where('p.status', '!=', 'cancelled');
    if (status && /^[a-z_]{3,30}$/.test(status)) q = q.where('p.status', '=', status);
    return q.orderBy('p.created_at', 'desc').limit(50_000).execute();
  });
  const csv = paymentsToCsv(
    rows.map(
      (r): PaymentCsvRow => ({
        paymentId: r.id,
        awardReference: r.reference,
        payeeName: r.legal_name ?? '',
        amountCents: r.amount_cents,
        currency: r.currency,
        method: r.method as PaymentMethod,
        paidOn: r.sent_at ? r.sent_at.slice(0, 10) : null,
        reference: r.external_reference ?? r.rail_ref,
        memo: r.memo,
        status: r.status,
      }),
    ),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tenant.slug}-payments-${stamp}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
