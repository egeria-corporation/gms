// SPDX-License-Identifier: AGPL-3.0-only
// C-02 Program detail: budgets per fiscal year (budget vs committed vs paid vs remaining), set a budget,
// the program's opportunities and awards, and the Mercury account payments come from.
// ?state= no-budget | over-budget | no-account | not-found
import { sql } from '@gms/db';
import { formatDateOnly, formatMoney } from '@gms/domain';
import {
  Alert,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeadlineChip,
  DescriptionList,
  EmptyState,
  MoneyDisplay,
  NotFoundState,
  PageHeader,
  Section,
  StatTile,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
} from '@gms/ui';
import { Archive, CircleDot, Landmark, Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchiveProgramButton, BudgetForm } from '@/components/console/grantmaking/programs/budget-form';
import { ProgramDialog } from '@/components/console/grantmaking/programs/program-dialog';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { currentYear, isUuid, teamMembers, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Program' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];
const BUDGET_ROLES = ['owner', 'admin', 'finance'];
const FINANCE_READ = ['owner', 'admin', 'finance', 'auditor'];

export default async function ProgramDetail({ params, searchParams }: { params: Promise<{ programId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'finance', 'auditor'])]);
  const { programId } = await params;
  const forced = forcedState(await searchParams);
  const role = viewer.role ?? '';
  const canEdit = EDIT_ROLES.includes(role);
  const canBudget = BUDGET_ROLES.includes(role);
  const canSeeAccounts = FINANCE_READ.includes(role);
  const thisYear = currentYear(tenant.timezone);

  const data = isUuid(programId)
    ? await rls(async (trx) => {
        const program = await trx
          .selectFrom('programs as p')
          .leftJoin('profiles as l', 'l.id', 'p.lead_user_id')
          .select(['p.id', 'p.name', 'p.slug', 'p.status', 'p.description', 'p.cause_area', 'p.lead_user_id', 'l.full_name as lead_name', 'p.created_at'])
          .where('p.id', '=', programId)
          .where('p.workspace_id', '=', tenant.id)
          .executeTakeFirst();
        if (!program) return null;
        const [budgets, byYear, opportunities, awards, accounts, leads, causes] = await Promise.all([
          trx.selectFrom('program_budgets').select(['fiscal_year', 'amount_cents']).where('program_id', '=', program.id).orderBy('fiscal_year').execute(),
          trx
            .selectFrom('awards')
            .select([
              'fiscal_year',
              sql<number>`coalesce(sum(amount_cents) filter (where status in ('active','completed') and (kind = 'original' or amendment_status = 'approved')), 0)::bigint`.as('committed'),
              sql<number>`coalesce(sum(disbursed_cents) filter (where kind = 'original'), 0)::bigint`.as('paid'),
              sql<number>`coalesce(sum(amount_cents) filter (where status = 'draft' and kind = 'original'), 0)::bigint`.as('pending'),
              sql<number>`count(*) filter (where kind = 'original' and status in ('active','completed'))::int`.as('n'),
            ])
            .where('program_id', '=', program.id)
            .where('fiscal_year', 'is not', null)
            .groupBy('fiscal_year')
            .execute(),
          trx
            .selectFrom('opportunities as o')
            .select(['o.id', 'o.title', 'o.status', 'o.opens_at', 'o.closes_at', sql<number>`(select count(*) from public.applications a where a.opportunity_id = o.id and a.status <> 'in_progress')::int`.as('submitted')])
            .where('o.program_id', '=', program.id)
            .orderBy('o.created_at', 'desc')
            .execute(),
          trx
            .selectFrom('awards as a')
            .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
            .select(['a.id', 'a.reference', 'a.title', 'a.amount_cents', 'a.disbursed_cents', 'a.status', 'a.fiscal_year', 'a.start_date', 'g.legal_name'])
            .where('a.program_id', '=', program.id)
            .where('a.kind', '=', 'original')
            .orderBy('a.created_at', 'desc')
            .limit(10)
            .execute(),
          canSeeAccounts
            ? trx
                .selectFrom('program_accounts as pa')
                .innerJoin('bank_accounts as b', 'b.id', 'pa.bank_account_id')
                .select(['pa.id', 'pa.is_default', 'b.name', 'b.mask', 'b.kind', 'b.available_cents', 'b.currency', 'b.balance_updated_at'])
                .where('pa.program_id', '=', program.id)
                .orderBy('pa.is_default', 'desc')
                .execute()
            : Promise.resolve([]),
          canEdit ? teamMembers(trx, tenant.id, ['owner', 'admin', 'program_officer']) : Promise.resolve([]),
          trx.selectFrom('programs').select('cause_area').distinct().where('workspace_id', '=', tenant.id).where('cause_area', 'is not', null).execute(),
        ]);
        return { program, budgets, byYear, opportunities, awards, accounts, leads, causes: causes.map((c) => c.cause_area!).filter(Boolean) };
      })
    : null;

  if (!data || forced === 'not-found') {
    return (
      <div className="grid gap-4">
        <PageHeader title="Program not found" linkComponent={NextLink} breadcrumbs={[{ label: 'Programs', href: '/console/programs' }, { label: 'Not found' }]} />
        <NotFoundState title="We couldn’t find that program" description="It may have been removed, or the link is wrong." action={<Button asChild variant="outline"><Link href="/console/programs">Back to programs</Link></Button>} />
      </div>
    );
  }
  const { program } = data;

  // Fiscal years: every year with a budget or awards, plus the current one.
  const budgetOf = new Map(data.budgets.map((b) => [b.fiscal_year, Number(b.amount_cents)]));
  const yearsSet = new Set<number>([thisYear, ...data.budgets.map((b) => b.fiscal_year), ...data.byYear.map((y) => Number(y.fiscal_year))]);
  let years = [...yearsSet].sort((a, b) => a - b);
  let rows = years.map((y) => {
    const a = data.byYear.find((x) => Number(x.fiscal_year) === y);
    return { year: y, budget: budgetOf.get(y) ?? null, committed: Number(a?.committed ?? 0), paid: Number(a?.paid ?? 0), pending: Number(a?.pending ?? 0), awards: Number(a?.n ?? 0) };
  });
  if (forced === 'no-budget') rows = rows.map((r) => ({ ...r, budget: null }));
  if (forced === 'over-budget') rows = rows.map((r) => (r.year === thisYear ? { ...r, budget: r.budget ?? 0, committed: (r.budget ?? 0) + 2_500_000 } : r));
  years = rows.map((r) => r.year);
  const current = rows.find((r) => r.year === thisYear)!;
  const remaining = current.budget === null ? null : current.budget - current.committed;
  const accounts = forced === 'no-account' ? [] : data.accounts;
  const budgetsRecord: Record<number, number> = Object.fromEntries(rows.filter((r) => r.budget !== null).map((r) => [r.year, r.budget!]));

  return (
    <div className="grid gap-6">
      <PageHeader
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Programs', href: '/console/programs' }, { label: program.name }]}
        title={program.name}
        description={program.description ?? undefined}
        meta={program.status === 'archived' ? <ToneChip tone="muted" icon={Archive} label="Archived" /> : <ToneChip tone="success" icon={CircleDot} label="Active" />}
        actions={
          canEdit ? (
            <>
              <ArchiveProgramButton programId={program.id} archived={program.status === 'archived'} />
              <ProgramDialog
                program={{ id: program.id, name: program.name, description: program.description, causeArea: program.cause_area, leadUserId: program.lead_user_id }}
                leads={data.leads.map((l) => ({ userId: l.userId, name: l.name }))}
                causeAreas={data.causes}
              />
            </>
          ) : undefined
        }
      />

      {remaining !== null && remaining < 0 ? (
        <Alert variant="danger" title={`FY${thisYear} commitments are over budget`}>
          Active awards total {formatMoney(current.committed)}, which is {formatMoney(-remaining)} more than the {formatMoney(current.budget!)} budget.
          {canBudget ? ' Raise the budget below or amend awards.' : ' Ask finance to review the budget.'}
        </Alert>
      ) : null}
      {current.budget === null ? (
        <Alert variant="warning" title={`No FY${thisYear} budget yet`}>
          Award drafts show a budget warning until a budget is set{canBudget ? '. Set one below.' : '. Owners, admins and finance can set it.'}
        </Alert>
      ) : null}

      <section aria-label={`FY${thisYear} summary`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`FY${thisYear} budget`} value={<MoneyDisplay cents={current.budget} short />} />
        <StatTile label="Committed" value={<MoneyDisplay cents={current.committed} short />} footnote={`${current.awards} active or completed award${current.awards === 1 ? '' : 's'}`} />
        <StatTile label="Paid" value={<MoneyDisplay cents={current.paid} short />} footnote={current.committed ? `${Math.round((current.paid / current.committed) * 100)}% of committed` : undefined} />
        <StatTile label="Remaining" value={<MoneyDisplay cents={remaining} short />} footnote={current.pending ? `${formatMoney(current.pending)} more in draft awards` : undefined} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section title="Budgets by fiscal year" description="Committed = active and completed awards plus approved amendments. Paid = money disbursed.">
          <Card>
            <CardContent className="grid gap-5 pt-5">
              <BarChart
                title="Budget, committed and paid"
                description={`FY${thisYear}: ${formatMoney(current.committed)} committed of ${current.budget === null ? 'no budget' : formatMoney(current.budget)}.`}
                data={rows.map((r) => ({ year: `FY${r.year}`, budget: r.budget ?? 0, committed: r.committed, paid: r.paid }))}
                categoryKey="year"
                series={[
                  { key: 'budget', label: 'Budget', color: 1 },
                  { key: 'committed', label: 'Committed', color: 2 },
                  { key: 'paid', label: 'Paid', color: 3 },
                ]}
                valueFormat="money"
                height={220}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Fiscal year</TableHead>
                    <TableHead scope="col" className="text-right">Budget</TableHead>
                    <TableHead scope="col" className="text-right">Committed</TableHead>
                    <TableHead scope="col" className="text-right">Paid</TableHead>
                    <TableHead scope="col" className="text-right">Remaining</TableHead>
                    <TableHead scope="col" className="text-right">Draft awards</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rem = r.budget === null ? null : r.budget - r.committed;
                    return (
                      <TableRow key={r.year}>
                        <TableCell className="font-medium">FY{r.year}{r.year === thisYear ? <span className="ml-1 text-xs font-normal text-muted-foreground">(current)</span> : null}</TableCell>
                        <TableCell className="text-right"><MoneyDisplay cents={r.budget} compact /></TableCell>
                        <TableCell className="text-right"><MoneyDisplay cents={r.committed} compact /></TableCell>
                        <TableCell className="text-right"><MoneyDisplay cents={r.paid} compact /></TableCell>
                        <TableCell className={`text-right ${rem !== null && rem < 0 ? 'text-status-danger-fg' : ''}`}>
                          <MoneyDisplay cents={rem} compact />
                          {rem !== null && rem < 0 ? <span className="sr-only"> (over budget)</span> : null}
                        </TableCell>
                        <TableCell className="text-right"><MoneyDisplay cents={r.pending} compact /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {canBudget ? (
                <div className="border-t pt-4">
                  <h3 className="mb-3 text-sm font-semibold">Set a budget</h3>
                  <BudgetForm programId={program.id} years={[...new Set([...years, thisYear + 1, thisYear + 2])].sort((a, b) => a - b)} budgets={budgetsRecord} defaultYear={thisYear} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Owners, admins and finance can change budgets.</p>
              )}
            </CardContent>
          </Card>
        </Section>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="flex items-center gap-2 text-base">
                <Landmark aria-hidden="true" className="size-4" /> Payment account
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {!canSeeAccounts ? (
                <p className="text-muted-foreground">Finance, owners and admins can see which Mercury account pays this program’s grants.</p>
              ) : accounts.length ? (
                <ul className="grid gap-2">
                  {accounts.map((a) => (
                    <li key={a.id} className="grid gap-0.5 rounded-md border p-3">
                      <span className="flex items-center gap-2 font-medium">
                        {a.name}
                        {a.mask ? <span className="text-muted-foreground">••{a.mask}</span> : null}
                        {a.is_default ? <ToneChip tone="info" icon={Star} label="Default" size="sm" /> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.kind} · Available <MoneyDisplay cents={a.available_cents} currency={a.currency} />
                        {a.balance_updated_at ? ` · as of ${formatDateOnly(a.balance_updated_at.slice(0, 10))}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState variant="inline" level={3} title="No account mapped" description="Payments for this program use the workspace default account until one is mapped." />
              )}
              {canSeeAccounts ? (
                <Button asChild variant="outline" size="sm" className="justify-self-start">
                  <Link href="/console/payments/connect">{accounts.length ? 'Change account mapping' : 'Map an account'}</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Cause area', detail: program.cause_area },
                  { term: 'Program lead', detail: program.lead_name },
                  { term: 'Web address', detail: program.slug },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Section title="Opportunities" actions={canEdit ? <Button asChild size="sm" variant="outline"><Link href="/console/opportunities/new">New opportunity</Link></Button> : undefined}>
        {data.opportunities.length ? (
          <ul className="grid gap-2">
            {data.opportunities.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm">
                <Link href={`/console/opportunities/${o.id}`} className="font-medium hover:underline">
                  {o.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{o.submitted} submitted</span>
                  {o.status === 'open' && o.closes_at ? <DeadlineChip at={o.closes_at} timeZone={tenant.timezone} label="Closes" size="sm" /> : null}
                  <StatusChip kind="opportunity" value={o.status} size="sm" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState variant="inline" level={3} title="No opportunities in this program yet" />
        )}
      </Section>

      <Section title="Recent awards">
        {data.awards.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Award</TableHead>
                <TableHead scope="col">Grantee</TableHead>
                <TableHead scope="col">FY</TableHead>
                <TableHead scope="col" className="text-right">Amount</TableHead>
                <TableHead scope="col" className="text-right">Paid</TableHead>
                <TableHead scope="col">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.awards.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/console/awards/${a.id}`} className="font-medium hover:underline">
                      {a.reference}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{a.title}</span>
                  </TableCell>
                  <TableCell>{a.legal_name ?? '—'}</TableCell>
                  <TableCell>{a.fiscal_year ? `FY${a.fiscal_year}` : '—'}</TableCell>
                  <TableCell className="text-right"><MoneyDisplay cents={a.amount_cents} compact /></TableCell>
                  <TableCell className="text-right"><MoneyDisplay cents={a.disbursed_cents} compact /></TableCell>
                  <TableCell><StatusChip kind="award" value={a.status} size="sm" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState variant="inline" level={3} title="No awards yet" description="Awards appear here once decisions are recorded and award drafts are created." />
        )}
      </Section>
    </div>
  );
}
