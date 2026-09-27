// SPDX-License-Identifier: AGPL-3.0-only
// P-03 Batch builder. ?state= (non-production): no-bank · error
import { Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import { Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BatchBuilder, type BuilderAccount } from '@/components/console/finance/batch-builder';
import { addDays, FINANCE_WRITE, todayIn, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Build a payment batch' };

export default async function NewBatchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(FINANCE_WRITE)]);
  const forced = forcedState(await searchParams);
  const breadcrumbs = [{ label: 'Payments', href: '/console/payments' }, { label: 'Batches', href: '/console/payments/batches' }, { label: 'New batch' }];
  const d = await rls(async (trx) => {
    const conn = await trx.selectFrom('bank_connections').select(['id', 'provider']).where('workspace_id', '=', tenant.id).where('status', '=', 'connected').orderBy('created_at', 'desc').executeTakeFirst();
    const accounts = conn
      ? await trx.selectFrom('bank_accounts').select(['id', 'name', 'mask', 'available_cents', 'currency']).where('connection_id', '=', conn.id).orderBy('available_cents', 'desc').execute()
      : [];
    const mappings = accounts.length
      ? await trx
          .selectFrom('program_accounts as m')
          .innerJoin('programs as p', 'p.id', 'm.program_id')
          .select(['m.bank_account_id', 'p.name'])
          .where('m.bank_account_id', 'in', accounts.map((a) => a.id))
          .execute()
      : [];
    const settings = await trx.selectFrom('workspace_settings').select(['second_approval_threshold_cents']).where('workspace_id', '=', tenant.id).executeTakeFirst();
    return { conn, accounts, mappings, threshold: settings?.second_approval_threshold_cents ?? 5_000_000 };
  });
  const header = <PageHeader title="Build a payment batch" breadcrumbs={breadcrumbs} linkComponent={NextLink} description="Pick the account and method, preview exactly what will be paid, then send it to a colleague for approval." />;
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load your accounts" description="Nothing was changed. Refresh to try again." />
      </div>
    );
  }
  if (forced === 'no-bank' || !d.conn) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          variant="page"
          icon={Landmark}
          title="Connect your bank first"
          description="Batches pay from a connected Mercury account, or record payments made outside GMS."
          action={
            <Button asChild>
              <Link href="/console/payments/connect">Connect your bank</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const accounts: BuilderAccount[] = d.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    mask: a.mask,
    availableCents: a.available_cents,
    currency: a.currency,
    programs: d.mappings.filter((m) => m.bank_account_id === a.id).map((m) => m.name),
  }));
  return (
    <div className="grid gap-6">
      {header}
      <BatchBuilder accounts={accounts} manual={d.conn.provider === 'manual'} defaultDueBefore={addDays(todayIn(tenant.timezone), 14)} secondApprovalThresholdCents={d.threshold} />
    </div>
  );
}
