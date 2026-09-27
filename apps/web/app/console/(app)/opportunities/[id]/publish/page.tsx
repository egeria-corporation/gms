// SPDX-License-Identifier: AGPL-3.0-only
// C-05 Review & publish: the readiness checklist (mirrors the server checks in opportunities.publish), the
// lifecycle timeline Draft → Forecasted → Open → Closed → Archived in the workspace timezone, publish,
// status changes allowed by opportunityMachine, and invitations to invite-only stages.
// ?state= ready (all checks pass) | blocked (required items missing) | published (as if just published)
import { sql } from '@gms/db';
import { formatInZone, nextStates, opportunityMachine, OPPORTUNITY_STATUS, type OpportunityStatus } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, NotFoundState, PageHeader, StatusChip, cn } from '@gms/ui';
import { Archive, CalendarClock, CheckCircle2, CircleDot, CircleSlash, PencilLine, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { InvitePanel, PublishButton, StatusActions, type InviteCandidate, type InviteStage } from '@/components/console/grantmaking/opportunities/publish-actions';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { loadEligibility, loadOpportunity, loadStages } from '../../data';

export const metadata: Metadata = { title: 'Review & publish' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];

interface Check {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
  fixHref: string;
}

const LIFECYCLE: { status: OpportunityStatus; icon: LucideIcon }[] = [
  { status: 'draft', icon: PencilLine },
  { status: 'forecasted', icon: CalendarClock },
  { status: 'open', icon: CircleDot },
  { status: 'closed', icon: CircleSlash },
  { status: 'archived', icon: Archive },
];

export default async function PublishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const forced = forcedState(sp);
  const tz = tenant.timezone;
  const data = !isUuid(id)
    ? null
    : await rls(async (trx) => {
        const o = await loadOpportunity(trx, tenant.id, id);
        if (!o) return null;
        const [stages, rules, budget, candidates, invites] = await Promise.all([
          loadStages(trx, tenant.id, id, tz),
          loadEligibility(trx, tenant.id, id),
          o.program_id ? trx.selectFrom('program_budgets').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).where('program_id', '=', o.program_id).executeTakeFirst() : Promise.resolve(undefined),
          trx
            .selectFrom('applications as a')
            .innerJoin('competitions as c', 'c.id', 'a.competition_id')
            .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
            .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'g.legal_name', 'c.stage_order', 'c.name as stage_name'])
            .where('a.workspace_id', '=', tenant.id)
            .where('a.opportunity_id', '=', id)
            .where('a.status', 'in', ['submitted', 'under_review'])
            .orderBy('c.stage_order')
            .orderBy('a.reference_number')
            .limit(500)
            .execute(),
          trx
            .selectFrom('competition_invites as i')
            .innerJoin('competitions as c', 'c.id', 'i.competition_id')
            .select(['i.competition_id', sql<number>`count(*)::int`.as('n')])
            .where('i.workspace_id', '=', tenant.id)
            .where('c.opportunity_id', '=', id)
            .groupBy('i.competition_id')
            .execute(),
        ]);
        return { o, stages, rules, hasBudget: Number(budget?.n ?? 0) > 0, candidates, invites };
      });

  const crumbs = [
    { label: 'Console', href: '/console' },
    { label: 'Opportunities', href: '/console/opportunities' },
  ];
  if (!data) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Opportunity not found" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState title="We couldn’t find that opportunity" action={<Button asChild size="sm" variant="outline"><Link href="/console/opportunities">Back to opportunities</Link></Button>} />
      </div>
    );
  }

  const { o, stages, rules } = data;
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const edit = `/console/opportunities/${o.id}`;
  const stage1 = stages[0];
  const stage1FormsOk = Boolean(stage1 && stage1.forms.length > 0 && stage1.forms.every((f) => f.versionStatus === 'published'));
  let checks: Check[] = [
    { id: 'dates', label: 'Open and close dates are set', ok: Boolean(o.opens_at && o.closes_at), blocking: true, detail: o.opens_at && o.closes_at ? `${formatInZone(o.opens_at, tz)} → ${formatInZone(o.closes_at, tz)}` : 'Set when applications open and the deadline.', fixHref: `${edit}?tab=details` },
    { id: 'summary', label: 'Summary for listings', ok: Boolean(o.summary?.trim()), blocking: true, detail: o.summary?.trim() ? 'Present.' : 'Add a short summary for the public listing.', fixHref: `${edit}?tab=details` },
    {
      id: 'stage',
      label: 'First stage has a published form',
      ok: stage1FormsOk,
      blocking: true,
      detail: !stage1 ? 'Add at least one stage.' : stage1FormsOk ? `“${stage1.name}” uses ${stage1.forms.map((f) => `${f.formName} v${f.version}`).join(', ')}.` : `Attach a published form to “${stage1.name}”.`,
      fixHref: `${edit}?tab=stages`,
    },
    { id: 'eligibility', label: 'Eligibility questions', ok: rules.length > 0, blocking: false, detail: rules.length ? `${rules.length} question${rules.length === 1 ? '' : 's'}.` : 'None. Applicants won’t get a pre-check (recommended, not required).', fixHref: `${edit}?tab=eligibility` },
    {
      id: 'program',
      label: 'Program and budget linked',
      ok: Boolean(o.program_id && data.hasBudget),
      blocking: false,
      detail: !o.program_id ? 'No program. Awards won’t count against a budget (recommended, not required).' : data.hasBudget ? `${o.program_name ?? 'Program'} has a budget.` : `${o.program_name ?? 'The program'} has no budget yet.`,
      fixHref: o.program_id ? `/console/programs/${o.program_id}` : `${edit}?tab=details`,
    },
  ];
  let status = o.status as OpportunityStatus;
  let publishedAt = o.published_at;
  if (forced === 'ready') checks = checks.map((c) => ({ ...c, ok: true }));
  if (forced === 'blocked') checks = checks.map((c) => (c.id === 'dates' || c.id === 'stage' ? { ...c, ok: false } : c));
  if (forced === 'ready' || forced === 'blocked') status = 'draft';
  if (forced === 'published') {
    status = o.opens_at && new Date(o.opens_at) > new Date() ? 'forecasted' : 'open';
    publishedAt = publishedAt ?? new Date().toISOString();
  }
  const blocked = checks.some((c) => c.blocking && !c.ok);
  const warnings = checks.filter((c) => !c.blocking && !c.ok).length;
  const targets = nextStates(opportunityMachine, status).filter((t) => !(status === 'draft' && (t === 'forecasted' || t === 'open')));
  const grace = stage1?.graceMinutes ?? 0;
  const closesWithGrace = o.closes_at ? new Date(new Date(o.closes_at).getTime() + grace * 60_000).toISOString() : null;
  const timeline: { status: OpportunityStatus; when: string }[] = [
    { status: 'draft', when: `Created ${formatInZone(o.created_at, tz)}` },
    { status: 'forecasted', when: o.forecast_at ? `Announce ${formatInZone(o.forecast_at, tz)}${publishedAt ? ` · published ${formatInZone(publishedAt, tz)}` : ''}` : publishedAt ? `Published ${formatInZone(publishedAt, tz)}` : 'When you publish before the open date' },
    { status: 'open', when: o.opens_at ? `Opens ${formatInZone(o.opens_at, tz)}` : 'Open date not set' },
    { status: 'closed', when: closesWithGrace ? `Closes ${formatInZone(o.closes_at, tz)}${grace ? ` + ${grace} min grace (${formatInZone(closesWithGrace, tz)})` : ''}` : 'Deadline not set' },
    { status: 'archived', when: status === 'archived' ? 'Archived' : 'When you archive it' },
  ];
  const currentIdx = LIFECYCLE.findIndex((l) => l.status === status);
  const inviteStages: InviteStage[] = stages
    .filter((s) => s.access === 'invite')
    .map((s) => ({ id: s.id, name: s.name, order: s.order, status: s.status, invited: Number(data.invites.find((i) => i.competition_id === s.id)?.n ?? 0) }));
  const candidates: InviteCandidate[] = data.candidates.map((c) => ({ id: c.id, reference: c.reference_number, title: c.title, orgName: c.legal_name, status: c.status, stageOrder: c.stage_order, stageName: c.stage_name }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={status === 'draft' ? `Review & publish: ${o.title}` : `Lifecycle: ${o.title}`}
        breadcrumbs={[...crumbs, { label: o.title, href: edit }, { label: status === 'draft' ? 'Publish' : 'Lifecycle' }]}
        linkComponent={NextLink}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusChip kind="opportunity" value={status} size="sm" />
            <span>Times in {tz}</span>
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={edit}>Edit opportunity</Link>
          </Button>
        }
      />
      {forced ? <Alert variant="info">Demo state “{forced}”: the page shows this state regardless of the saved data. Actions still run against the real opportunity.</Alert> : null}
      {forced === 'published' ? (
        <Alert variant="success" title="Published">
          {status === 'open' ? 'Applications are open. Applicants can find it on your site and in the feeds you chose.' : 'It is forecasted: people can see it and subscribe, and it opens automatically on schedule.'}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Readiness checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-2">
              {checks.map((c) => {
                const Icon = c.ok ? CheckCircle2 : c.blocking ? XCircle : TriangleAlert;
                return (
                  <li key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
                    <span className="flex items-start gap-2">
                      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', c.ok ? 'text-status-success-fg' : c.blocking ? 'text-status-danger-fg' : 'text-status-warning-fg')} />
                      <span>
                        <span className="font-medium">{c.label}</span>
                        <span className="ml-1 text-xs font-semibold">{c.ok ? '(done)' : c.blocking ? '(required)' : '(recommended)'}</span>
                        <span className="block text-muted-foreground">{c.detail}</span>
                      </span>
                    </span>
                    {!c.ok && canEdit ? (
                      <Link href={c.fixHref} className="shrink-0 text-link underline">
                        Fix<span className="sr-only"> {c.label}</span>
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {status === 'draft' ? (
              canEdit ? (
                <div className="grid gap-2">
                  {blocked ? (
                    <Alert variant="warning" title="Not ready yet">
                      Finish the required items. The server checks them again when you publish.
                    </Alert>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {o.opens_at && new Date(o.opens_at) <= new Date() ? 'The open date has passed, so publishing opens applications immediately.' : 'Publishing makes it Forecasted now; it opens automatically on the open date.'}
                      {warnings ? ` ${warnings} recommendation${warnings === 1 ? '' : 's'} left.` : ''}
                    </p>
                  )}
                  <PublishButton opportunityId={o.id} disabled={blocked && forced === 'blocked'} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Only program staff can publish.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Published {publishedAt ? formatInZone(publishedAt, tz) : ''}.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Lifecycle
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ol className="grid gap-0">
              {LIFECYCLE.map((l, i) => {
                const Icon = l.icon;
                const current = i === currentIdx;
                const past = i < currentIdx;
                return (
                  <li key={l.status} className="relative flex gap-3 pb-4 last:pb-0" aria-current={current ? 'step' : undefined}>
                    {i < LIFECYCLE.length - 1 ? <span aria-hidden="true" className="absolute top-7 left-3.5 h-[calc(100%-1.75rem)] w-px bg-border" /> : null}
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', current ? 'border-primary bg-primary text-primary-foreground' : past ? 'border-status-success-border bg-status-success-bg text-status-success-fg' : 'bg-card text-muted-foreground')}>
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="grid text-sm">
                      <span className={cn(current ? 'font-semibold' : 'font-medium')}>
                        {OPPORTUNITY_STATUS[l.status].label}
                        {current ? <span className="ml-2 text-xs font-semibold text-primary">Current</span> : past ? <span className="sr-only"> (done)</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{timeline[i]!.when}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            {canEdit ? (
              <div className="grid gap-2 border-t pt-4">
                <h3 className="text-sm font-semibold">Change status</h3>
                <StatusActions opportunityId={o.id} status={status} targets={targets} />
                {status === 'draft' ? <p className="text-xs text-muted-foreground">To make it Forecasted or Open, use Publish.</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Invite applicants to a later stage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? <InvitePanel opportunityId={o.id} stages={inviteStages} candidates={candidates} /> : <p className="text-sm text-muted-foreground">Only program staff can send invitations.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
