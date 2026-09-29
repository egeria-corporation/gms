// SPDX-License-Identifier: AGPL-3.0-or-later
// AN-01 Dashboards: pipeline funnel, time in stage, committed vs paid vs remaining by program and fiscal year,
// cash-flow forecast, portfolio by cause and county, outcomes, voluntary demographics with suppression
// (states: empty, suppressed). Every number comes from the analytics schema (one definition per metric).
import { formatMoneyShort } from '@gms/domain';
import {
  Alert,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CountyMap,
  DonutChart,
  EmptyState,
  Field,
  LineChart,
  MoneyDisplay,
  PageHeader,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StackedBarChart,
  StatTile,
} from '@gms/ui';
import { EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { COUNTY_SHAPES, COUNTY_VIEWBOX, countyKey, fiscalYearLabel, fiscalYearOf, monthLabel, statusLabel } from './lib';

export const metadata: Metadata = { title: 'Dashboards' };

const STAGE_ORDER = ['in_progress', 'submitted', 'under_review', 'invited_to_next_stage', 'awarded', 'declined', 'withdrawn', 'ineligible'];

interface DemoCell {
  question: string;
  answer: string;
  responses: number | null;
  suppressed: boolean;
  question_respondents: number | null;
}

const PREVIEW_DEMOGRAPHICS: DemoCell[] = [
  { question: 'bipoc_led', answer: 'true', responses: 31, suppressed: false, question_respondents: 52 },
  { question: 'bipoc_led', answer: 'false', responses: 18, suppressed: false, question_respondents: 52 },
  { question: 'bipoc_led', answer: 'prefer_not_to_say', responses: null, suppressed: true, question_respondents: 52 },
  { question: 'annual_budget_band', answer: 'under_250k', responses: 22, suppressed: false, question_respondents: 49 },
  { question: 'annual_budget_band', answer: '250k_1m', responses: 19, suppressed: false, question_respondents: 49 },
  { question: 'annual_budget_band', answer: '1m_5m', responses: null, suppressed: true, question_respondents: 49 },
  { question: 'annual_budget_band', answer: 'over_5m', responses: null, suppressed: true, question_respondents: 49 },
];

const humanize = (s: string) => (s === 'true' ? 'Yes' : s === 'false' ? 'No' : s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'finance', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const oppParam = one(sp.opportunity) ?? '';
  const oppFilter = /^[0-9a-f-]{36}$/i.test(oppParam) ? oppParam : '';
  const d = await rls(async (trx) => {
    const [ws, funnel, stages, budget, cash, cause, county, outcomes, demo] = await Promise.all([
      trx.selectFrom('workspaces').select('fiscal_year_start_month').where('id', '=', tenant.id).executeTakeFirstOrThrow(),
      trx.selectFrom('analytics_pipeline_funnel').selectAll().where('workspace_id', '=', tenant.id).orderBy('opportunity_title').execute(),
      trx.selectFrom('analytics_time_in_stage').selectAll().where('workspace_id', '=', tenant.id).execute(),
      trx.selectFrom('analytics_budget_by_program').selectAll().where('workspace_id', '=', tenant.id).orderBy('program_name').execute(),
      trx.selectFrom('analytics_cashflow_forecast').selectAll().where('workspace_id', '=', tenant.id).orderBy('month').execute(),
      trx.selectFrom('analytics_portfolio_by_cause').selectAll().where('workspace_id', '=', tenant.id).orderBy('committed_cents', 'desc').execute(),
      trx.selectFrom('analytics_portfolio_by_county').selectAll().where('workspace_id', '=', tenant.id).orderBy('committed_cents', 'desc').execute(),
      trx.selectFrom('analytics_outcomes').selectAll().where('workspace_id', '=', tenant.id).orderBy('indicator').execute(),
      trx.selectFrom('analytics_demographics').selectAll().where('workspace_id', '=', tenant.id).orderBy('question').orderBy('answer').execute(),
    ]);
    return { fyStart: ws.fiscal_year_start_month, funnel, stages, budget, cash, cause, county, outcomes, demo };
  });
  const empty = forced === 'empty' || (d.funnel.length === 0 && d.budget.length === 0 && d.cash.length === 0 && d.outcomes.length === 0);
  const refreshed = [...d.funnel, ...d.budget, ...d.cash].map((r) => r.refreshed_at).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(new Date(iso));

  const header = (
    <PageHeader
      title="Dashboards"
      description={refreshed ? `Updated hourly. Data as of ${fmt(refreshed)}.` : 'Updated hourly from your grants data.'}
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href="/console/analytics/builder">Build a report</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/console/analytics/compliance">990-PF & distributions</Link>
          </Button>
        </>
      }
    />
  );
  if (empty) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          variant="page"
          title="Nothing to chart yet"
          description="Dashboards fill in as applications arrive, awards are made and payments go out. Numbers refresh every hour."
          action={
            <Button asChild>
              <Link href="/console/opportunities">Go to opportunities</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const currentFy = fiscalYearOf(new Date(), d.fyStart, tenant.timezone);
  const years = [...new Set(d.budget.map((b) => Number(b.fiscal_year)))].sort((a, b) => b - a);
  const fyParam = Number(one(sp.fy));
  const fy = years.includes(fyParam) ? fyParam : years.includes(currentFy) ? currentFy : (years[0] ?? currentFy);
  const budgetRows = d.budget.filter((b) => Number(b.fiscal_year) === fy);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const committed = sum(budgetRows.map((b) => b.committed_cents));
  const paid = sum(budgetRows.map((b) => b.paid_cents));
  const budgetTotal = budgetRows.some((b) => b.budget_cents !== null) ? sum(budgetRows.map((b) => b.budget_cents)) : null;

  const funnelRows = oppFilter ? d.funnel.filter((f) => f.opportunity_id === oppFilter) : d.funnel;
  const f = { started: sum(funnelRows.map((r) => r.started)), submitted: sum(funnelRows.map((r) => r.submitted)), reviewed: sum(funnelRows.map((r) => r.reviewed)), awarded: sum(funnelRows.map((r) => r.awarded)) };
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

  const today = new Date().toISOString().slice(0, 7);
  const cashRows = d.cash.filter((c) => (c.month ?? '') >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`).slice(0, 24);
  const stageRows = [...d.stages].sort((a, b) => STAGE_ORDER.indexOf(a.status ?? '') - STAGE_ORDER.indexOf(b.status ?? ''));
  // Final statuses (awarded, declined…) never "complete", so only statuses people have moved on from are charted.
  const completedStages = stageRows.filter((s) => (s.completed ?? 0) > 0);
  const currentStages = stageRows.filter((s) => (s.current ?? 0) > 0 && !['awarded', 'declined', 'withdrawn', 'ineligible'].includes(s.status ?? ''));

  const countyByKey = new Map(d.county.map((c) => [countyKey(c.county ?? ''), c]));
  const demo: DemoCell[] =
    forced === 'suppressed'
      ? PREVIEW_DEMOGRAPHICS
      : d.demo.map((r) => ({ question: r.question ?? '', answer: r.answer ?? '', responses: r.responses, suppressed: Boolean(r.suppressed), question_respondents: r.question_respondents }));
  const questions = [...new Set(demo.map((r) => r.question))];

  return (
    <div className="grid gap-8">
      {header}

      <section aria-label={`Summary for ${fiscalYearLabel(fy, d.fyStart)}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Committed · FY ${fy}`} value={<MoneyDisplay cents={committed} short />} footnote={`${sum(budgetRows.map((b) => b.awards))} awards`} />
        <StatTile label={`Paid · FY ${fy}`} value={<MoneyDisplay cents={paid} short />} footnote={committed ? `${pct(paid, committed)} of committed` : undefined} />
        <StatTile label="Remaining budget" value={budgetTotal === null ? '—' : <MoneyDisplay cents={budgetTotal - committed} short />} footnote={budgetTotal === null ? 'No program budgets set' : `of ${formatMoneyShort(budgetTotal)} budgeted`} />
        <StatTile label="Applications awarded" value={f.awarded.toLocaleString('en-US')} footnote={`${pct(f.awarded, f.submitted)} of ${f.submitted.toLocaleString('en-US')} submitted`} />
      </section>

      <Section title="Pipeline">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Field label="Opportunity" htmlFor="an-opp">
            <Select name="opportunity" defaultValue={oppFilter || 'all'}>
              <SelectTrigger id="an-opp" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All opportunities</SelectItem>
                {d.funnel.map((o) => (
                  <SelectItem key={o.opportunity_id} value={o.opportunity_id ?? ''}>
                    {o.opportunity_title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {one(sp.fy) ? <input type="hidden" name="fy" value={one(sp.fy)} /> : null}
          <Button type="submit" variant="secondary" size="sm">
            Show
          </Button>
        </form>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <BarChart
                title="Applications by stage reached"
                description={`${f.started} started, ${f.submitted} submitted (${pct(f.submitted, f.started)}), ${f.reviewed} reviewed, ${f.awarded} awarded (${pct(f.awarded, f.submitted)} of submitted).`}
                data={[
                  { stage: 'Started', applications: f.started },
                  { stage: 'Submitted', applications: f.submitted },
                  { stage: 'Reviewed', applications: f.reviewed },
                  { stage: 'Awarded', applications: f.awarded },
                ]}
                categoryKey="stage"
                categoryLabel="Stage"
                series={[{ key: 'applications', label: 'Applications' }]}
                orientation="horizontal"
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              {completedStages.length ? (
                <BarChart
                  title="Average days in each status"
                  description={`Completed stays, from status history.${currentStages.length ? ` Right now: ${currentStages.map((s) => `${s.current} ${statusLabel(s.status ?? '').toLowerCase()} (${s.current_avg_days} days so far on average)`).join(', ')}.` : ''}`}
                  data={completedStages.map((s) => ({ status: statusLabel(s.status ?? ''), average: s.avg_days, median: s.median_days, p90: s.p90_days }))}
                  categoryKey="status"
                  categoryLabel="Status"
                  series={[
                    { key: 'average', label: 'Average days' },
                    { key: 'median', label: 'Median days', color: 3 },
                    { key: 'p90', label: '90th percentile', color: 5 },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No completed stages yet. Time in stage appears once applications move from one status to the next.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Budget and payments"
        actions={
          years.length > 1 ? (
            <nav aria-label="Fiscal year" className="flex flex-wrap gap-1">
              {years.map((y) => (
                <Button key={y} asChild size="sm" variant={y === fy ? 'secondary' : 'ghost'}>
                  <Link href={`?fy=${y}${oppFilter ? `&opportunity=${oppFilter}` : ''}`} aria-current={y === fy ? 'page' : undefined}>
                    FY {y}
                  </Link>
                </Button>
              ))}
            </nav>
          ) : null
        }
        description={`${fiscalYearLabel(fy, d.fyStart)}. Committed = active and completed awards plus approved amendments; paid = payments sent.`}
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              {budgetRows.length ? (
                <StackedBarChart
                  title={`Committed, paid and remaining by program · FY ${fy}`}
                  description={`${formatMoneyShort(committed)} committed, ${formatMoneyShort(paid)} paid${budgetTotal !== null ? `, ${formatMoneyShort(Math.max(0, budgetTotal - committed))} of budget left to commit` : ''}.`}
                  data={budgetRows.map((b) => ({
                    program: b.program_name ?? 'No program',
                    paid: b.paid_cents ?? 0,
                    unpaid: Math.max(0, b.unpaid_commitments_cents ?? 0),
                    remaining: b.remaining_cents === null ? 0 : Math.max(0, b.remaining_cents),
                  }))}
                  categoryKey="program"
                  categoryLabel="Program"
                  valueFormat="money"
                  orientation="horizontal"
                  series={[
                    { key: 'paid', label: 'Paid', color: 1 },
                    { key: 'unpaid', label: 'Committed, not yet paid', color: 3 },
                    { key: 'remaining', label: 'Budget remaining', color: 5 },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No awards, payments or budgets in FY {fy}.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              {cashRows.length ? (
                <LineChart
                  title="Cash flow: scheduled vs paid, by month"
                  description="Scheduled installments that haven’t been paid yet, next to what actually went out each month."
                  data={cashRows.map((c) => ({ month: monthLabel(c.month ?? ''), scheduled: c.scheduled_cents ?? 0, paid: c.paid_cents ?? 0 }))}
                  categoryKey="month"
                  categoryLabel="Month"
                  valueFormat="money"
                  series={[
                    { key: 'scheduled', label: 'Scheduled', color: 2 },
                    { key: 'paid', label: 'Paid', color: 1 },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No installments scheduled.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Portfolio" description="Active and completed awards (committed dollars).">
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              {d.cause.length ? (
                <DonutChart
                  title="By cause area"
                  description={`Largest: ${d.cause[0]?.cause_label} (${formatMoneyShort(d.cause[0]?.committed_cents ?? 0)}).`}
                  data={d.cause.map((c) => ({ cause: c.cause_label ?? 'Unspecified', committed: c.committed_cents ?? 0 }))}
                  nameKey="cause"
                  valueKey="committed"
                  nameLabel="Cause area"
                  valueLabel="Committed"
                  valueFormat="money"
                  centerLabel={formatMoneyShort(sum(d.cause.map((c) => c.committed_cents)))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No active awards yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <CountyMap
                title="By county"
                description="Where grantees are based (mailing address). Counties outside the map are listed below."
                viewBox={COUNTY_VIEWBOX}
                regions={COUNTY_SHAPES.map((s) => ({ ...s, value: countyByKey.get(countyKey(s.name))?.committed_cents ?? null }))}
                valueLabel="Committed"
                valueFormat="money"
                steps={4}
              />
              {d.county.some((c) => !COUNTY_SHAPES.some((s) => countyKey(s.name) === countyKey(c.county ?? ''))) ? (
                <ul className="grid gap-1 text-sm">
                  {d.county
                    .filter((c) => !COUNTY_SHAPES.some((s) => countyKey(s.name) === countyKey(c.county ?? '')))
                    .map((c) => (
                      <li key={c.county} className="flex justify-between gap-2">
                        <span>{c.county}</span>
                        <span className="tabular-nums">
                          <MoneyDisplay cents={c.committed_cents} short /> · {c.awards} {c.awards === 1 ? 'award' : 'awards'}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Outcomes" description="Totals of what grantees reported against your indicators.">
        {d.outcomes.length ? (
          <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Outcomes" tabIndex={0}>
            <table className="w-full text-sm">
              <caption className="sr-only">Reported outcomes by indicator</caption>
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Indicator</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Program</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total reported</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Awards reporting</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Latest period</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.outcomes.map((o) => (
                  <tr key={o.indicator_id}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">{o.indicator}</th>
                    <td className="px-3 py-2">{o.program_name ?? 'All programs'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(o.total_value ?? 0).toLocaleString('en-US')} {o.unit === 'count' ? '' : o.unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.awards_reporting}</td>
                    <td className="px-3 py-2">{o.latest_period_end ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No indicators yet. Add indicators to a program to collect outcomes in grant reports.</p>
        )}
      </Section>

      <Section title="Voluntary demographics" description="Answers applicants chose to share, counted per question. Never shown per applicant.">
        <Alert variant="info" title="Small groups are hidden" icon={<EyeOff aria-hidden="true" />}>
          Any answer given by fewer than 5 applicants is hidden, and so is the next-smallest answer when needed, so no one can work out a hidden number by subtracting.
        </Alert>
        {questions.length ? (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="demographics">
            {questions.map((q) => {
              const cells = demo.filter((c) => c.question === q);
              const respondents = cells[0]?.question_respondents ?? null;
              return (
                <Card key={q}>
                  <CardHeader>
                    <CardTitle as="h3" className="text-sm">
                      {humanize(q)}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{respondents === null ? 'Fewer than 5 people answered' : `${respondents} people answered`}</p>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <caption className="sr-only">Answers to {humanize(q)}</caption>
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="py-1 text-left font-medium">Answer</th>
                          <th scope="col" className="py-1 text-right font-medium">People</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {cells.map((c) => (
                          <tr key={c.answer}>
                            <th scope="row" className="py-1.5 text-left font-normal">{humanize(c.answer)}</th>
                            <td className="py-1.5 text-right tabular-nums">
                              {c.suppressed ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <EyeOff aria-hidden="true" className="size-3.5" /> Hidden (small group)
                                </span>
                              ) : (
                                c.responses
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No demographic answers yet. They’re optional for applicants and only ever shown in aggregate.</p>
        )}
      </Section>
    </div>
  );
}
