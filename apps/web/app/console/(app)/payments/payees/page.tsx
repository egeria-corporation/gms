// SPDX-License-Identifier: AGPL-3.0-only
// P-02 Payee onboarding: grantees' payee status (Invite sent / Onboarding / Ready / Invite expired), invite
// awarded organizations that have no payee yet, and reissue expired invites.
// ?state= (non-production): empty · no-bank · error
import { sql } from '@gms/db';
import { Alert, Button, ErrorState, PageHeader, Section } from '@gms/ui';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NextLink } from '@/components/next-link';
import { PayeesTable, UninvitedList, type PayeeRow, type UninvitedRow } from '@/components/console/finance/payees';
import { can, FINANCE_READ, FINANCE_WRITE, oneOf, paging, type SearchParams } from '@/components/console/finance/params';
import { requireStaff } from '@/lib/auth';
import { config } from '@/lib/config';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payee onboarding' };

const STATUSES = ['invite_sent', 'onboarding', 'ready', 'invite_expired'] as const;

export default async function PayeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = oneOf(sp, 'status', STATUSES);
  const breadcrumbs = [{ label: 'Payments', href: '/console/payments' }, { label: 'Payee onboarding' }];
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Payee onboarding" breadcrumbs={breadcrumbs} linkComponent={NextLink} />
        <ErrorState title="We couldn’t load payees" description="Nothing was changed. Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    const conn = await trx.selectFrom('bank_connections').select(['provider']).where('workspace_id', '=', tenant.id).where('status', '=', 'connected').orderBy('created_at', 'desc').executeTakeFirst();
    let q = trx.selectFrom('payees as p').innerJoin('applicant_orgs as o', 'o.id', 'p.applicant_org_id').where('p.workspace_id', '=', tenant.id);
    if (status) q = q.where('p.status', '=', status);
    const [rows, count, uninvited] = await Promise.all([
      q
        .select(['p.id', 'p.applicant_org_id', 'o.legal_name', 'p.status', 'p.provider', 'p.contact_email', 'p.invited_at', 'p.ready_at', 'p.last_polled_at'])
        .orderBy(sql`case p.status when 'invite_expired' then 0 when 'invite_sent' then 1 when 'onboarding' then 2 else 3 end`)
        .orderBy('o.legal_name')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      trx
        .selectFrom('awards as a')
        .innerJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
        .select(['a.id', 'a.reference', 'o.id as org_id', 'o.legal_name', 'o.email'])
        .where('a.workspace_id', '=', tenant.id)
        .where('a.kind', '=', 'original')
        .where('a.status', 'in', ['active', 'draft'])
        .where((eb) => eb.not(eb.exists(eb.selectFrom('payees as y').select('y.id').whereRef('y.applicant_org_id', '=', 'a.applicant_org_id').where('y.workspace_id', '=', tenant.id))))
        .orderBy('o.legal_name')
        .limit(200)
        .execute(),
    ]);
    return { conn, rows, total: Number(count?.n ?? 0), uninvited };
  });

  const noBank = forced === 'no-bank' || !d.conn;
  const empty = forced === 'empty';
  const rows: PayeeRow[] = empty
    ? []
    : d.rows.map((r) => ({
        id: r.id,
        orgId: r.applicant_org_id,
        grantee: r.legal_name,
        status: r.status,
        provider: r.provider,
        contactEmail: r.contact_email,
        invitedAt: r.invited_at,
        readyAt: r.ready_at,
        lastPolledAt: r.last_polled_at,
      }));
  const byOrg = new Map<string, UninvitedRow>();
  if (!empty) {
    for (const a of d.uninvited) {
      const cur = byOrg.get(a.org_id) ?? { orgId: a.org_id, grantee: a.legal_name, email: a.email, awards: [] };
      cur.awards.push({ id: a.id, reference: a.reference });
      byOrg.set(a.org_id, cur);
    }
  }
  const writer = can(viewer.role, FINANCE_WRITE);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payee onboarding"
        breadcrumbs={breadcrumbs}
        linkComponent={NextLink}
        description="Grantees set up how they get paid directly with Mercury. GMS tracks their status and never sees bank account or routing numbers."
      />
      <Alert variant="info" icon={<ShieldCheck aria-hidden="true" />} title="Bank details stay with the bank">
        Invites use Mercury’s recipient onboarding with a required tax form. We check onboarding status every few minutes; a payee becomes <strong>Ready</strong> once Mercury confirms it.
        {config.devToolsEnabled ? (
          <>
            {' '}
            In this environment you can simulate the grantee side in <Link href="/dev/mercury">the fake bank controls</Link>.
          </>
        ) : null}
      </Alert>

      {noBank ? (
        <Alert
          variant="warning"
          title="Connect the bank first"
          actions={
            writer ? (
              <Button asChild size="sm">
                <Link href="/console/payments/connect">Connect your bank</Link>
              </Button>
            ) : undefined
          }
        >
          Payee invites need a connected Mercury account, or choose to pay outside GMS.
        </Alert>
      ) : null}

      <Section title="Awarded, not yet invited" description="Organizations with a draft or active award and no payee record.">
        <UninvitedList rows={[...byOrg.values()]} canWrite={writer && !noBank} />
      </Section>

      <Section title="Payees">
        <PayeesTable rows={rows} total={empty ? 0 : d.total} page={page} pageSize={pageSize} status={status} canWrite={writer && !noBank} />
      </Section>
    </div>
  );
}
