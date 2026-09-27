// SPDX-License-Identifier: AGPL-3.0-only
// AN-03 Compliance: the 990-PF grants-paid schedule (Part XV line 3a) for a tax year, with CSV/XLSX export,
// and a qualifying-distributions tracker labeled "Estimate, not tax advice." (states: empty).
import { sql } from '@gms/db';
import { Button, EmptyState, MoneyDisplay, PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { DistributionsTracker, Export990Buttons } from './compliance-client';

export const metadata: Metadata = { title: 'Compliance' };

interface GrantPaidRow {
  recipient: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  relationship_note: string | null;
  org_type: string | null;
  grant_to_individual: boolean;
  purpose: string | null;
  paid: number;
}

/** Foundation status of recipient, as 990-PF filers usually abbreviate it. */
function foundationStatus(orgType: string | null, individual: boolean): string {
  if (individual || orgType === 'individual') return 'Individual';
  if (orgType === 'nonprofit_501c3' || orgType === 'fiscally_sponsored' || orgType === 'school') return 'PC';
  if (orgType === 'government' || orgType === 'tribal') return 'GOV';
  return 'Other (expenditure responsibility)';
}

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'finance', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const thisYear = Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tenant.timezone }).format(new Date()));
  const years = await rls(async (trx) => {
    const r = await sql<{ y: number }>`select distinct extract(year from sent_at at time zone ${tenant.timezone})::int as y from public.payments
      where workspace_id = ${tenant.id}::uuid and status in ('sent', 'reconciled') and sent_at is not null order by 1 desc`.execute(trx);
    return r.rows.map((x) => Number(x.y));
  });
  const yearParam = Number(one(sp.year));
  const taxYear = Number.isInteger(yearParam) && yearParam > 1990 && yearParam <= thisYear ? yearParam : years.includes(thisYear - 1) || !years.length ? thisYear - 1 : years[0]!;
  const yearOptions = [...new Set([thisYear, thisYear - 1, thisYear - 2, ...years])].sort((a, b) => b - a);
  const rows =
    forced === 'empty'
      ? []
      : await rls(async (trx) => {
          const r = await sql<GrantPaidRow>`
            select g.legal_name as recipient, ad.line1, ad.city, ad.state, ad.postal_code, a.relationship_note, g.org_type,
                   a.grant_to_individual, coalesce(a.purpose, a.title) as purpose, sum(p.amount_cents)::bigint as paid
            from public.payments p
            join public.awards a on a.id = p.award_id
            left join public.applicant_orgs g on g.id = a.applicant_org_id
            left join lateral (select x.line1, x.city, x.state, x.postal_code from public.org_addresses x
                               where x.org_id = g.id order by (x.kind = 'mailing') desc limit 1) ad on true
            where p.workspace_id = ${tenant.id}::uuid and p.status in ('sent', 'reconciled') and p.sent_at is not null
              and extract(year from p.sent_at at time zone ${tenant.timezone}) = ${taxYear}
            group by 1, 2, 3, 4, 5, 6, 7, 8, 9
            order by 1, 9`.execute(trx);
          return r.rows.map((x) => ({ ...x, paid: Number(x.paid) }));
        });
  const total = rows.reduce((a, r) => a + r.paid, 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Compliance"
        description="Private-foundation reporting from your payment records. Check every figure with your accountant before filing."
        breadcrumbs={[{ label: 'Dashboards', href: '/console/analytics' }, { label: 'Compliance' }]}
        linkComponent={NextLink}
      />
      <nav aria-label="Tax year" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-sm text-muted-foreground">Tax year:</span>
        {yearOptions.map((y) => (
          <Button key={y} asChild size="sm" variant={y === taxYear ? 'secondary' : 'ghost'}>
            <Link href={`?year=${y}`} aria-current={y === taxYear ? 'page' : undefined}>
              {y}
            </Link>
          </Button>
        ))}
      </nav>

      <Section
        title={`Form 990-PF, Part XV line 3a: grants paid in ${taxYear}`}
        description="Grants and contributions paid during the year (payments sent or reconciled, by the date sent, in your timezone), grouped by recipient and purpose."
        actions={<Export990Buttons taxYear={taxYear} />}
      >
        {rows.length ? (
          <div className="overflow-x-auto rounded-lg border" role="region" aria-label={`Grants paid in ${taxYear}`} tabIndex={0}>
            <table className="w-full text-sm" data-testid="form-990pf">
              <caption className="sr-only">Grants and contributions paid during {taxYear}</caption>
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Recipient</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Address</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Relationship</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Foundation status</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Purpose</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={`${r.recipient}-${r.purpose}-${i}`}>
                    <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                      {r.grant_to_individual ? 'Individual (name withheld)' : (r.recipient ?? '—')}
                    </th>
                    <td className="px-3 py-2 align-top">{r.grant_to_individual ? '—' : [r.line1, r.city, r.state, r.postal_code].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-3 py-2 align-top">{r.relationship_note || 'None'}</td>
                    <td className="px-3 py-2 align-top">{foundationStatus(r.org_type, r.grant_to_individual)}</td>
                    <td className="px-3 py-2 align-top">{r.purpose}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      <MoneyDisplay cents={r.paid} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40 font-medium">
                <tr>
                  <th scope="row" colSpan={5} className="px-3 py-2 text-left">
                    Total grants paid ({rows.length} {rows.length === 1 ? 'line' : 'lines'})
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <MoneyDisplay cents={total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyState title={`No grants paid in ${taxYear}`} description="Once payments to grantees are sent (or recorded as paid outside GMS), they appear here by the date they went out." />
        )}
        <p className="text-xs text-muted-foreground">
          PC = public charity; GOV = government unit. Grants to organizations that aren’t public charities need expenditure responsibility (Part VII-B). Grants to individuals are listed without names here; your return needs the details your accountant keeps.
        </p>
      </Section>

      <Section title="Qualifying distributions tracker" description="Estimate, not tax advice.">
        <DistributionsTracker taxYear={taxYear} grantsPaidCents={total} />
      </Section>
    </div>
  );
}
