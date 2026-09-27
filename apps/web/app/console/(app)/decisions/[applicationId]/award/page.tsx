// SPDX-License-Identifier: AGPL-3.0-only
// R-06 Award builder: amount, period, purpose, conditions, flags and the payment schedule for an
// application's award (awards.draft, with program budget warnings); activation (awards.activate, R3, people
// only); and, once active, amendments and supplements as child awards (awards.amend) — approved on the award page.
// ?state= over-budget | schedule-mismatch | active | not-found | error
import { sql } from '@gms/db';
import { formatDateOnly, formatMoney, splitInstallments } from '@gms/domain';
import { Alert, Button, DescriptionList, ErrorState, MoneyDisplay, NotFoundState, PageHeader, Section, StatTile, StatusChip, ToneChip } from '@gms/ui';
import { ArrowRight, FileSignature, ShieldAlert, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AmendmentsPanel, type AmendmentRow } from '@/components/console/grantmaking/decisions/amendments-panel';
import { AwardBuilder, type AwardDraft } from '@/components/console/grantmaking/decisions/award-builder';
import { DecisionOutcomeChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Award builder' };

const DRAFT_ROLES = ['owner', 'admin', 'program_officer', 'finance'];
const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'];

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + months, Math.min(d!, 28)));
  return dt.toISOString().slice(0, 10);
}

export default async function AwardBuilderPage({ params, searchParams }: { params: Promise<{ applicationId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { applicationId } = await params;
  const forced = forcedState(await searchParams);
  const canDraft = Boolean(viewer.role && DRAFT_ROLES.includes(viewer.role));
  const canProgram = Boolean(viewer.role && PROGRAM_ROLES.includes(viewer.role));

  const data =
    forced === 'not-found' || !isUuid(applicationId)
      ? undefined
      : await rls(async (trx) => {
          const app = await trx
            .selectFrom('applications as a')
            .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
            .leftJoin('programs as p', 'p.id', 'o.program_id')
            .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
            .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'a.requested_amount_cents', 'o.title as opp_title', 'o.program_id', 'p.name as program_name', 'g.legal_name'])
            .where('a.id', '=', applicationId)
            .where('a.workspace_id', '=', tenant.id)
            .executeTakeFirst();
          if (!app) return undefined;
          const [finalDecision, rec, award] = await Promise.all([
            trx.selectFrom('decisions').select(['outcome', 'recommended_amount_cents', 'recorded_at']).where('application_id', '=', app.id).where('is_final', '=', true).orderBy('recorded_at', 'desc').executeTakeFirst(),
            trx.selectFrom('decisions').select(['outcome', 'recommended_amount_cents']).where('application_id', '=', app.id).where('is_final', '=', false).orderBy('recorded_at', 'desc').executeTakeFirst(),
            trx.selectFrom('awards').selectAll().where('application_id', '=', app.id).where('kind', '=', 'original').where('workspace_id', '=', tenant.id).executeTakeFirst(),
          ]);
          const [installments, conditions, children] = award
            ? await Promise.all([
                trx.selectFrom('installments').select(['id', 'position', 'due_date', 'amount_cents', 'condition', 'status']).where('award_id', '=', award.id).orderBy('position').execute(),
                trx.selectFrom('award_conditions').select(['id', 'body', 'status']).where('award_id', '=', award.id).orderBy('created_at').execute(),
                trx
                  .selectFrom('awards as c')
                  .leftJoin('profiles as p', 'p.id', 'c.created_by')
                  .select(['c.id', 'c.reference', 'c.kind', 'c.amount_cents', 'c.end_date', 'c.amendment_status', 'c.purpose', 'c.created_at', 'p.full_name'])
                  .where('c.parent_award_id', '=', award.id)
                  .orderBy('c.created_at')
                  .execute(),
              ])
            : [[], [], []];
          const fy = award?.fiscal_year ?? Number(todayIn(tenant.timezone).slice(0, 4));
          const programId = award?.program_id ?? app.program_id;
          const [budget, committed] = programId
            ? await Promise.all([
                trx.selectFrom('program_budgets').select('amount_cents').where('program_id', '=', programId).where('fiscal_year', '=', fy).executeTakeFirst(),
                trx
                  .selectFrom('awards')
                  .select(sql<number>`coalesce(sum(amount_cents), 0)::bigint`.as('c'))
                  .where('program_id', '=', programId)
                  .where('fiscal_year', '=', fy)
                  .where('status', 'in', ['active', 'completed'])
                  .where((eb) => eb.or([eb('kind', '=', 'original'), eb('amendment_status', '=', 'approved')]))
                  .$if(Boolean(award), (q) => q.where('id', '!=', award!.id))
                  .executeTakeFirst(),
              ])
            : [undefined, undefined];
          return { app, finalDecision, rec, award, installments, conditions, children, fy, programId, budgetCents: budget ? Number(budget.amount_cents) : null, committedCents: Number(committed?.c ?? 0) };
        }).catch((e: unknown) => {
          console.error('[award-builder] load failed', e);
          return null;
        });

  const crumbs = [
    { label: 'Console', href: '/console' },
    { label: 'Decisions', href: '/console/decisions?final=decided' },
    { label: 'Award builder' },
  ];

  if (data === null || forced === 'error') {
    return (
      <div className="grid gap-4">
        <PageHeader title="Award builder" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load this award. Your data is safe; try again in a moment." />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Award builder" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState
          title="We couldn’t find that application"
          description="It may have been removed, or you may not have access to it."
          action={
            <Button asChild variant="outline">
              <Link href="/console/decisions">Back to decisions</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { app, award } = data;
  const today = todayIn(tenant.timezone);
  const suggestedAmount = award?.amount_cents ?? data.finalDecision?.recommended_amount_cents ?? data.rec?.recommended_amount_cents ?? app.requested_amount_cents ?? 0;
  const amount = Number(suggestedAmount);
  const start = award?.start_date ?? today;
  const end = award?.end_date ?? addMonths(start, 12);
  const defaultInstallments = amount > 0
    ? splitInstallments(amount, amount >= 1_000_000 ? 2 : 1).map((c, i) => ({ dueDate: addMonths(start, i * 6), amountCents: c, condition: i === 0 ? 'On signed agreement' : 'After the interim report is accepted' }))
    : [{ dueDate: start, amountCents: 0, condition: 'On signed agreement' }];
  let installments = award && data.installments.length ? data.installments.map((i) => ({ dueDate: i.due_date, amountCents: Number(i.amount_cents), condition: i.condition })) : defaultInstallments;
  if (forced === 'schedule-mismatch' && installments.length) {
    installments = installments.map((i, idx) => (idx === 0 ? { ...i, amountCents: Math.max(100, i.amountCents - 100_000) } : i));
  }

  const status = forced === 'active' ? 'active' : (award?.status ?? 'none');
  const isFinalApprove = data.finalDecision?.outcome === 'approve' || app.status === 'awarded';
  const savedTotal = data.installments.reduce((s, i) => s + Number(i.amount_cents), 0);
  const scheduleMatches = Boolean(award && savedTotal === award.amount_cents && data.installments.length > 0);

  // Budget context (same rule as the budget check in awards.draft).
  const projected = data.committedCents + amount;
  const warnings: string[] = [];
  if (data.programId) {
    if (data.budgetCents === null) warnings.push(`No FY${data.fy} budget is set for ${app.program_name ?? 'this program'}.`);
    else if (projected > data.budgetCents) warnings.push(`This award would bring FY${data.fy} commitments to ${formatMoney(projected)}, over the ${formatMoney(data.budgetCents)} budget by ${formatMoney(projected - data.budgetCents)}.`);
  }
  if (forced === 'over-budget' && !warnings.some((w) => w.includes('over the'))) {
    const budget = data.budgetCents ?? amount;
    warnings.push(`This award would bring FY${data.fy} commitments to ${formatMoney(budget + amount)}, over the ${formatMoney(budget)} budget by ${formatMoney(amount)}. (Example for ?state=over-budget.)`);
  }

  const draft: AwardDraft = {
    amountCents: amount,
    startDate: start,
    endDate: end,
    purpose: award?.purpose ?? '',
    conditions: data.conditions.filter((c) => c.status === 'open').map((c) => c.body),
    installments,
    expenditureResponsibility: award?.expenditure_responsibility ?? false,
    grantToIndividual: award?.grant_to_individual ?? !app.legal_name,
  };

  const children: AmendmentRow[] = data.children.map((c) => ({
    id: c.id,
    reference: c.reference,
    kind: c.kind,
    amountCents: Number(c.amount_cents),
    endDate: c.end_date,
    status: c.amendment_status,
    reason: c.purpose,
    createdAt: c.created_at,
    createdBy: c.full_name,
  }));

  const title = app.title ?? app.opp_title;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Award: ${title}`}
        description={`${app.reference_number} · ${app.legal_name ?? 'Individual applicant'} · ${app.opp_title}`}
        breadcrumbs={crumbs}
        linkComponent={NextLink}
        meta={
          <>
            <StatusChip kind="application" value={app.status} size="sm" />
            {status !== 'none' ? <StatusChip kind="award" value={status} size="sm" /> : <ToneChip tone="muted" icon={FileSignature} label="No award yet" size="sm" />}
            {award ? <span className="text-xs text-muted-foreground">Award {award.reference}</span> : null}
            {draft.grantToIndividual ? <ToneChip tone="info" icon={UserRound} label="Grant to individual" size="sm" /> : null}
            {draft.expenditureResponsibility ? <ToneChip tone="warning" icon={ShieldAlert} label="Expenditure responsibility" size="sm" /> : null}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/console/applications/${app.id}`}>Application</Link>
            </Button>
            {status === 'active' ? (
              <Button asChild size="sm">
                <Link href={`/console/decisions/${app.id}/agreement`}>
                  Letter & agreement <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {!isFinalApprove ? (
        <Alert
          variant="warning"
          title="No final approval is recorded for this application"
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/console/decisions">Go to decisions</Link>
            </Button>
          }
        >
          Awards normally follow a final “Approve” decision. You can still draft terms here, but record the decision before activating.
          {data.rec ? (
            <span className="mt-1 flex items-center gap-2">
              Latest recommendation: <DecisionOutcomeChip outcome={data.rec.outcome} />
              {data.rec.recommended_amount_cents ? <MoneyDisplay cents={Number(data.rec.recommended_amount_cents)} /> : null}
            </span>
          ) : null}
        </Alert>
      ) : null}

      <section aria-label={`FY${data.fy} program budget`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`${app.program_name ?? 'Program'} · FY${data.fy} budget`} value={data.budgetCents === null ? 'Not set' : <MoneyDisplay cents={data.budgetCents} short />} />
        <StatTile label="Committed (other awards)" value={<MoneyDisplay cents={data.committedCents} short />} footnote="Active and completed awards, incl. approved amendments" />
        <StatTile label="This award" value={<MoneyDisplay cents={amount} short />} />
        <StatTile
          label="Remaining after this award"
          value={data.budgetCents === null ? '—' : <MoneyDisplay cents={data.budgetCents - projected} short className={data.budgetCents - projected < 0 ? 'text-status-danger-fg' : undefined} />}
          footnote={data.budgetCents !== null && data.budgetCents - projected < 0 ? 'Over budget' : undefined}
        />
      </section>

      {status === 'active' ? (
        <>
          <Alert variant="success" title="This award is active">
            Terms are locked. Change the amount or end date with an amendment or supplement below; they are approved on the{' '}
            {award ? <Link href={`/console/awards/${award.id}`}>award page</Link> : 'award page'}.
          </Alert>
          <Section title="Award terms" card>
            <DescriptionList
              layout="grid"
              items={[
                { term: 'Amount', detail: <MoneyDisplay cents={draft.amountCents} />, numeric: true },
                { term: 'Period', detail: `${formatDateOnly(draft.startDate)} – ${formatDateOnly(draft.endDate)}` },
                { term: 'Purpose', detail: draft.purpose || '—', wide: true },
                { term: 'Conditions', detail: draft.conditions.length ? <ul className="list-disc pl-5">{draft.conditions.map((c) => <li key={c}>{c}</li>)}</ul> : 'None', wide: true },
                { term: 'Payment schedule', detail: <ol className="grid gap-1">{draft.installments.map((i, n) => <li key={`${i.dueDate}-${n}`} className="flex flex-wrap gap-2 tabular-nums"><span>{n + 1}.</span><span>{formatDateOnly(i.dueDate)}</span><MoneyDisplay cents={i.amountCents} /><span className="text-muted-foreground">{i.condition ?? ''}</span></li>)}</ol>, wide: true },
              ]}
            />
          </Section>
          <AmendmentsPanel
            applicationId={app.id}
            awardId={award?.status === 'active' ? award.id : null}
            awardReference={award?.reference ?? null}
            currentEndDate={draft.endDate}
            rows={children}
            canAmend={canProgram}
            timeZone={tenant.timezone}
          />
        </>
      ) : (
        <AwardBuilder
          applicationId={app.id}
          award={award ? { id: award.id, status: award.status, reference: award.reference } : null}
          initial={draft}
          requestedCents={app.requested_amount_cents === null ? null : Number(app.requested_amount_cents)}
          serverWarnings={warnings}
          scheduleMatches={scheduleMatches}
          canDraft={canDraft}
          canActivate={canProgram && isFinalApprove}
          activateBlockedReason={!isFinalApprove ? 'Record a final Approve decision first.' : !canProgram ? 'Program officers, admins and owners activate awards.' : null}
        />
      )}
    </div>
  );
}
