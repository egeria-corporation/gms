// SPDX-License-Identifier: AGPL-3.0-only
// C-02 Programs & budgets: every program with its fiscal-year budget, committed (active + completed awards,
// including approved amendments), paid (disbursed) and remaining.
// ?state= empty | error   ·   ?fy=2027 picks the fiscal year.
import { sql } from '@gms/db';
import { Button, EmptyState, ErrorState, MoneyDisplay, PageHeader, StatTile } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProgramDialog } from '@/components/console/grantmaking/programs/program-dialog';
import { ProgramsTable, type ProgramRow } from '@/components/console/grantmaking/programs/programs-table';
import { FiscalYearPicker } from '@/components/console/grantmaking/programs/fiscal-year-picker';
import { requireStaff } from '@/lib/auth';
import { currentYear, oneParam, teamMembers, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Programs' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'finance', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const thisYear = currentYear(tenant.timezone);
  const fy = Number(oneParam(sp, 'fy')) || thisYear;
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));

  const data = await rls(async (trx) => {
    const [programs, budgets, awards, opps, leads, years] = await Promise.all([
      trx
        .selectFrom('programs as p')
        .leftJoin('profiles as l', 'l.id', 'p.lead_user_id')
        .select(['p.id', 'p.name', 'p.status', 'p.cause_area', 'l.full_name as lead_name'])
        .where('p.workspace_id', '=', tenant.id)
        .orderBy('p.status')
        .orderBy('p.name')
        .execute(),
      trx.selectFrom('program_budgets').select(['program_id', 'amount_cents']).where('workspace_id', '=', tenant.id).where('fiscal_year', '=', fy).execute(),
      trx
        .selectFrom('awards')
        .select([
          'program_id',
          sql<number>`coalesce(sum(amount_cents) filter (where status in ('active','completed') and (kind = 'original' or amendment_status = 'approved')), 0)::bigint`.as('committed'),
          sql<number>`coalesce(sum(disbursed_cents) filter (where kind = 'original'), 0)::bigint`.as('paid'),
          sql<number>`coalesce(sum(amount_cents) filter (where status = 'draft' and kind = 'original'), 0)::bigint`.as('pending'),
        ])
        .where('workspace_id', '=', tenant.id)
        .where('fiscal_year', '=', fy)
        .groupBy('program_id')
        .execute(),
      trx.selectFrom('opportunities').select(['program_id', sql<number>`count(*)::int`.as('n')]).where('workspace_id', '=', tenant.id).groupBy('program_id').execute(),
      canEdit ? teamMembers(trx, tenant.id, ['owner', 'admin', 'program_officer']) : Promise.resolve([]),
      trx.selectFrom('program_budgets').select('fiscal_year').distinct().where('workspace_id', '=', tenant.id).execute(),
    ]);
    return { programs, budgets, awards, opps, leads, years: years.map((y) => y.fiscal_year) };
  }).catch(() => null);

  const header = (
    <PageHeader
      title="Programs"
      description="Funding areas, their budgets per fiscal year, and how much is committed and paid."
      actions={
        <>
          <FiscalYearPicker value={fy} years={[...new Set([thisYear - 1, thisYear, thisYear + 1, ...(data?.years ?? [])])].sort()} />
          {canEdit ? <ProgramDialog leads={(data?.leads ?? []).map((l) => ({ userId: l.userId, name: l.name }))} /> : null}
        </>
      }
    />
  );

  if (!data || forced === 'error') {
    return (
      <div className="grid gap-4">
        {header}
        <ErrorState description="We couldn’t load programs. Your data is safe; try again in a moment." action={<Button asChild variant="outline"><Link href="/console/programs">Try again</Link></Button>} />
      </div>
    );
  }

  const budgetOf = new Map(data.budgets.map((b) => [b.program_id, Number(b.amount_cents)]));
  const awardsOf = new Map(data.awards.map((a) => [a.program_id, a]));
  const oppsOf = new Map(data.opps.map((o) => [o.program_id, Number(o.n)]));
  const rows: ProgramRow[] = forced === 'empty' ? [] : data.programs.map((p) => {
    const a = awardsOf.get(p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      causeArea: p.cause_area,
      leadName: p.lead_name,
      budgetCents: budgetOf.get(p.id) ?? null,
      committedCents: Number(a?.committed ?? 0),
      paidCents: Number(a?.paid ?? 0),
      pendingCents: Number(a?.pending ?? 0),
      opportunities: oppsOf.get(p.id) ?? 0,
    };
  });
  const totals = rows.reduce((t, r) => ({ budget: t.budget + (r.budgetCents ?? 0), committed: t.committed + r.committedCents, paid: t.paid + r.paidCents }), { budget: 0, committed: 0, paid: 0 });

  return (
    <div className="grid gap-6">
      {header}
      {rows.length === 0 ? (
        <EmptyState
          variant="page"
          title="No programs yet"
          description="Create a program for each funding area (for example “Youth Arts”). Budgets, opportunities and awards all hang off a program."
          action={canEdit ? <ProgramDialog leads={data.leads.map((l) => ({ userId: l.userId, name: l.name }))} /> : undefined}
        />
      ) : (
        <>
          <section aria-label={`FY${fy} totals`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`FY${fy} budget`} value={<MoneyDisplay cents={totals.budget} short />} />
            <StatTile label="Committed" value={<MoneyDisplay cents={totals.committed} short />} footnote={totals.budget ? `${Math.round((totals.committed / totals.budget) * 100)}% of budget` : undefined} />
            <StatTile label="Paid" value={<MoneyDisplay cents={totals.paid} short />} footnote={totals.committed ? `${Math.round((totals.paid / totals.committed) * 100)}% of committed` : undefined} />
            <StatTile label="Remaining" value={<MoneyDisplay cents={totals.budget - totals.committed} short />} />
          </section>
          <ProgramsTable rows={rows} fiscalYear={fy} />
        </>
      )}
    </div>
  );
}
