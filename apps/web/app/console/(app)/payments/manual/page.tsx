// SPDX-License-Identifier: AGPL-3.0-only
// Manual rail: record a payment made outside GMS, import payments from CSV, export payments as CSV.
// ?state= (non-production): no-awards · error
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DeniedState, ErrorState, PageHeader } from '@gms/ui';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { CsvImport, RecordPaymentForm, type ManualAward } from '@/components/console/finance/manual-rail';
import { can, FINANCE_READ, FINANCE_WRITE, todayIn, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Record payments' };

export default async function ManualPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const forced = forcedState(await searchParams);
  const header = (
    <PageHeader
      title="Record payments made outside GMS"
      breadcrumbs={[{ label: 'Payments', href: '/console/payments' }, { label: 'Record payments' }]}
      linkComponent={NextLink}
      description="For grants paid from another bank, by check, or through a fiscal host. Recorded payments count toward each award’s paid amount and your 990-PF schedule."
      actions={
        <Button asChild variant="outline">
          <a href="/console/payments/export" download>
            <Download aria-hidden="true" /> Export all payments (CSV)
          </a>
        </Button>
      }
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load awards" description="Refresh to try again." />
      </div>
    );
  }
  const writer = can(viewer.role, FINANCE_WRITE);
  const d = await rls(async (trx) => {
    const conn = await trx.selectFrom('bank_connections').select('provider').where('workspace_id', '=', tenant.id).where('status', '=', 'connected').orderBy('created_at', 'desc').executeTakeFirst();
    const awards = await trx
      .selectFrom('awards as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .select(['a.id', 'a.reference', 'o.legal_name', 'a.amount_cents', 'a.disbursed_cents'])
      .where('a.workspace_id', '=', tenant.id)
      .where('a.kind', '=', 'original')
      .where('a.status', 'in', ['active', 'completed'])
      .orderBy('a.reference')
      .limit(1000)
      .execute();
    const installments = awards.length
      ? await trx
          .selectFrom('installments as i')
          .select(['i.id', 'i.award_id', 'i.position', 'i.due_date', 'i.amount_cents'])
          .where('i.workspace_id', '=', tenant.id)
          .where('i.status', '=', 'scheduled')
          .where((eb) => eb.not(eb.exists(eb.selectFrom('payments as p').select('p.id').whereRef('p.installment_id', '=', 'i.id').where('p.status', 'not in', ['failed', 'cancelled']))))
          .orderBy('i.position')
          .execute()
      : [];
    return { conn, awards, installments };
  });
  const awards: ManualAward[] =
    forced === 'no-awards'
      ? []
      : d.awards.map((a) => ({
          id: a.id,
          reference: a.reference,
          grantee: a.legal_name ?? '—',
          amountCents: a.amount_cents,
          disbursedCents: a.disbursed_cents,
          installments: d.installments.filter((i) => i.award_id === a.id).map((i) => ({ id: i.id, position: i.position, dueDate: i.due_date, amountCents: i.amount_cents })),
        }));
  return (
    <div className="grid gap-6">
      {header}
      {d.conn?.provider === 'mercury' ? (
        <Alert variant="info" title="You’re connected to Mercury">
          Only record payments here that you made outside GMS. Payments sent through a batch are tracked automatically.
        </Alert>
      ) : null}
      {writer ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Record one payment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RecordPaymentForm awards={awards} today={todayIn(tenant.timezone)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Import from CSV
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CsvImport />
            </CardContent>
          </Card>
        </div>
      ) : (
        <DeniedState title="Only finance admins and owners can record payments" description="You can still export the payment list." />
      )}
    </div>
  );
}
