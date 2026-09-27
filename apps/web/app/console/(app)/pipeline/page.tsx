// SPDX-License-Identifier: AGPL-3.0-only
// C-06 Pipeline: every application in the workspace as a server-paged table or a status board
// (`?view=table|kanban`). Filters (status, opportunity, stage, program, tags, from/to, agent, dupes, q) live in
// the URL so they can be saved as views. Bulk actions: advance, decline, assign reviewers, message, tag.
// Possible duplicates come from gms.application_duplicates(ws).
// Supported `?state=` values (non-production): empty, error, kanban (same as view=kanban), bulk (hint for the
// bulk-action bar).
import { sql } from '@gms/db';
import { APPLICATION_STATUS, formatInZone, zonedTimeToUtc, type ApplicationStatus } from '@gms/domain';
import { Alert, Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import { Columns3, Rows3 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PipelineFilters, type PipelineFilterValues } from '@/components/console/grantmaking/pipeline/pipeline-filters';
import { PipelineKanban } from '@/components/console/grantmaking/pipeline/pipeline-kanban';
import { PipelineTable } from '@/components/console/grantmaking/pipeline/pipeline-table';
import { BOARD_STATUSES, type PipelineRow, type PossibleDuplicate } from '@/components/console/grantmaking/pipeline/types';
import { SavedViewsMenu } from '@/components/console/grantmaking/saved-views';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, listParam, oneParam, savedViews, tableParams, teamMembers, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Pipeline' };

const SORTS = {
  reference: 'a.reference_number',
  title: 'a.title',
  org: 'g.legal_name',
  status: 'a.status',
  requested: 'a.requested_amount_cents',
  submitted: 'a.submitted_at',
} as const;
type SortKey = keyof typeof SORTS;

const KANBAN_LIMIT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function hrefWith(sp: SearchParams, patch: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined || k in patch) continue;
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  }
  for (const [k, v] of Object.entries(patch)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/console/pipeline?${s}` : '/console/pipeline';
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const view = forced === 'kanban' || oneParam(sp, 'view') === 'kanban' ? 'kanban' : 'table';
  const canEdit = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));
  const tp = tableParams(sp, { sortable: Object.keys(SORTS), sort: 'submitted', dir: 'desc' });

  const statuses = listParam(sp, 'status').filter((s) => s in APPLICATION_STATUS);
  const tags = listParam(sp, 'tags').slice(0, 20);
  const opportunity = oneParam(sp, 'opportunity');
  const stage = oneParam(sp, 'stage');
  const program = oneParam(sp, 'program');
  const from = oneParam(sp, 'from');
  const to = oneParam(sp, 'to');
  const agent = oneParam(sp, 'agent');
  const dupesOnly = oneParam(sp, 'dupes') === '1';
  const filters: PipelineFilterValues = {
    status: statuses,
    opportunity: isUuid(opportunity) ? opportunity : '',
    stage: isUuid(stage) ? stage : '',
    program: isUuid(program) ? program : '',
    tags,
    from: from && DATE_RE.test(from) ? from : '',
    to: to && DATE_RE.test(to) ? to : '',
    agent: agent === 'yes' || agent === 'no' ? agent : '',
    dupes: dupesOnly,
    q: tp.q,
  };

  let data;
  try {
    data = await rls(async (trx) => {
      const dupRows = (
        await sql<{ application_id: string; other_application_id: string; reason: string; score: number }>`select * from gms.application_duplicates(${tenant.id}::uuid)`.execute(trx)
      ).rows;
      const flagged = [...new Set(dupRows.flatMap((d) => [d.application_id, d.other_application_id]))];

      let base = trx
        .selectFrom('applications as a')
        .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
        .innerJoin('competitions as c', 'c.id', 'a.competition_id')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .where('a.workspace_id', '=', tenant.id);
      if (filters.status.length) base = base.where('a.status', 'in', filters.status);
      if (filters.opportunity) base = base.where('a.opportunity_id', '=', filters.opportunity);
      if (filters.stage) base = base.where('a.competition_id', '=', filters.stage);
      if (filters.program) base = base.where('o.program_id', '=', filters.program);
      if (filters.tags.length) base = base.where(sql<boolean>`a.tags && ${filters.tags}::text[]`);
      if (filters.from) base = base.where('a.submitted_at', '>=', zonedTimeToUtc(`${filters.from}T00:00`, tenant.timezone).toISOString());
      if (filters.to) base = base.where('a.submitted_at', '<', zonedTimeToUtc(`${nextDay(filters.to)}T00:00`, tenant.timezone).toISOString());
      if (filters.agent === 'yes') base = base.where('a.submitted_via', '=', 'agent');
      if (filters.agent === 'no') base = base.where((eb) => eb.or([eb('a.submitted_via', 'is', null), eb('a.submitted_via', '!=', 'agent')]));
      if (filters.dupes) base = flagged.length ? base.where('a.id', 'in', flagged) : base.where(sql<boolean>`false`);
      if (filters.q) {
        const pat = `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        base = base.where((eb) => eb.or([eb('a.reference_number', 'ilike', pat), eb('a.title', 'ilike', pat), eb('g.legal_name', 'ilike', pat), eb('g.dba_name', 'ilike', pat)]));
      }
      if (view === 'kanban') base = base.where('a.status', 'in', [...BOARD_STATUSES]);

      const select = base.select([
        'a.id',
        'a.reference_number',
        'a.title',
        'a.status',
        'a.requested_amount_cents',
        'a.currency',
        'a.submitted_at',
        'a.submitted_via',
        'a.duplicate_of',
        'a.tags',
        'a.opportunity_id',
        'a.competition_id',
        'o.title as opp_title',
        'c.name as stage_name',
        'g.legal_name',
        'g.dba_name',
      ]);
      const [countRow, rows] = await Promise.all([
        view === 'table' ? base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst() : Promise.resolve({ n: 0 }),
        view === 'table'
          ? select
              .orderBy(SORTS[tp.sort as SortKey], (ob) => (tp.dir === 'asc' ? ob.asc().nullsFirst() : ob.desc().nullsLast()))
              .orderBy('a.reference_number')
              .limit(tp.pageSize)
              .offset((tp.page - 1) * tp.pageSize)
              .execute()
          : select.orderBy('a.submitted_at', 'desc').orderBy('a.reference_number').limit(KANBAN_LIMIT + 1).execute(),
      ]);
      const ids = rows.map((r) => r.id);
      const dupOf = [...new Set(rows.map((r) => r.duplicate_of).filter((x): x is string => Boolean(x)))];
      const dupOthers = dupRows.filter((d) => ids.includes(d.application_id) || ids.includes(d.other_application_id)).flatMap((d) => [d.application_id, d.other_application_id]);
      const refIds = [...new Set([...dupOf, ...dupOthers])];
      const [reviews, refs, opps, comps, programs, tagRows, reviewStages, reviewers, views] = await Promise.all([
        ids.length
          ? trx
              .selectFrom('review_assignments as ra')
              .leftJoin('reviews as r', 'r.assignment_id', 'ra.id')
              .select([
                'ra.application_id',
                sql<number>`count(*) filter (where ra.status <> 'recused')::int`.as('assigned'),
                sql<number>`count(r.id) filter (where r.status = 'submitted')::int`.as('done'),
                sql<number | null>`avg(r.weighted_score) filter (where r.status = 'submitted')::float8`.as('avg'),
              ])
              .where('ra.application_id', 'in', ids)
              .groupBy('ra.application_id')
              .execute()
          : Promise.resolve([]),
        refIds.length ? trx.selectFrom('applications').select(['id', 'reference_number']).where('id', 'in', refIds).execute() : Promise.resolve([]),
        trx.selectFrom('opportunities').select(['id', 'title', 'program_id']).where('workspace_id', '=', tenant.id).orderBy('title').execute(),
        trx.selectFrom('competitions').select(['id', 'name', 'opportunity_id', 'access', 'status']).where('workspace_id', '=', tenant.id).orderBy('stage_order').execute(),
        trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
        sql<{ tag: string }>`select distinct unnest(tags) as tag from public.applications where workspace_id = ${tenant.id}::uuid order by 1`.execute(trx),
        trx.selectFrom('review_stages').select(['id', 'name', 'competition_id', 'status', 'reviewers_per_application']).where('workspace_id', '=', tenant.id).orderBy('position').execute(),
        teamMembers(trx, tenant.id, ['reviewer', 'program_officer']),
        savedViews(trx, tenant.id, 'pipeline', viewer.userId),
      ]);
      return { dupRows, rows, total: Number(countRow?.n ?? 0), reviews, refs, opps, comps, programs, tags: tagRows.rows.map((t) => t.tag), reviewStages, reviewers, views };
    });
  } catch (err) {
    console.error('[pipeline] load failed', err);
    data = null;
  }

  const header = (
    <PageHeader
      title="Pipeline"
      description="Every application in your workspace. Filter, save views, and act on several at once."
      linkComponent={NextLink}
      breadcrumbs={[{ label: 'Console', href: '/console' }, { label: 'Pipeline' }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {data ? <SavedViewsMenu surface="pipeline" views={data.views} /> : null}
          <div role="group" aria-label="Layout" className="inline-flex rounded-md border bg-card p-0.5">
            <Button asChild size="sm" variant={view === 'table' ? 'secondary' : 'ghost'}>
              <Link href={hrefWith(sp, { view: null, state: null })} aria-current={view === 'table' ? 'page' : undefined}>
                <Rows3 aria-hidden="true" /> Table
              </Link>
            </Button>
            <Button asChild size="sm" variant={view === 'kanban' ? 'secondary' : 'ghost'}>
              <Link href={hrefWith(sp, { view: 'kanban', page: null, state: null })} aria-current={view === 'kanban' ? 'page' : undefined}>
                <Columns3 aria-hidden="true" /> Board
              </Link>
            </Button>
          </div>
        </div>
      }
    />
  );

  if (forced === 'error' || !data) {
    return (
      <div className="grid gap-4">
        {header}
        <ErrorState title="We couldn’t load the pipeline" description="Refresh the page to try again. If it keeps happening, check the database connection." action={<Button asChild size="sm"><Link href="/console/pipeline">Try again</Link></Button>} />
      </div>
    );
  }

  const refOf = new Map(data.refs.map((r) => [r.id, r.reference_number]));
  const revOf = new Map(data.reviews.map((r) => [r.application_id, r]));
  const dupesOf = (id: string): PossibleDuplicate[] =>
    data.dupRows
      .filter((d) => d.application_id === id || d.other_application_id === id)
      .map((d) => {
        const other = d.application_id === id ? d.other_application_id : d.application_id;
        return { otherId: other, otherReference: refOf.get(other) ?? 'another application', reason: d.reason };
      });
  const empty = forced === 'empty';
  const overflow = view === 'kanban' && data.rows.length > KANBAN_LIMIT;
  const rows: PipelineRow[] = empty
    ? []
    : data.rows.slice(0, KANBAN_LIMIT).map((r) => {
        const rv = revOf.get(r.id);
        return {
          id: r.id,
          reference: r.reference_number,
          title: r.title ?? r.opp_title,
          orgName: r.dba_name || r.legal_name,
          opportunityId: r.opportunity_id,
          opportunityTitle: r.opp_title,
          competitionId: r.competition_id,
          stageName: r.stage_name,
          status: r.status,
          requestedCents: r.requested_amount_cents === null ? null : Number(r.requested_amount_cents),
          currency: r.currency,
          submittedAt: r.submitted_at,
          submittedLabel: r.submitted_at ? formatInZone(r.submitted_at, tenant.timezone, { dateOnly: true }) : '—',
          assigned: Number(rv?.assigned ?? 0),
          reviewsDone: Number(rv?.done ?? 0),
          avgScore: rv?.avg === null || rv?.avg === undefined ? null : Number(rv.avg),
          tags: r.tags,
          viaAgent: r.submitted_via === 'agent',
          duplicateOf: r.duplicate_of ? { id: r.duplicate_of, reference: refOf.get(r.duplicate_of) ?? 'another application' } : null,
          possibleDuplicates: dupesOf(r.id),
        };
      });
  const anyFilter = Boolean(filters.status.length || filters.tags.length || filters.opportunity || filters.stage || filters.program || filters.from || filters.to || filters.agent || filters.dupes || filters.q);
  const noApplications = empty || (!anyFilter && data.total === 0 && view === 'table') || (!anyFilter && view === 'kanban' && rows.length === 0);

  const statusOptions = (Object.keys(APPLICATION_STATUS) as ApplicationStatus[]).map((s) => ({ value: s, label: APPLICATION_STATUS[s].label }));
  const filterBar = (
    <PipelineFilters
      values={filters}
      statuses={view === 'kanban' ? statusOptions.filter((s) => (BOARD_STATUSES as readonly string[]).includes(s.value)) : statusOptions}
      opportunities={data.opps.map((o) => ({ value: o.id, label: o.title }))}
      stages={data.comps.map((c) => ({ value: c.id, label: c.name, parent: c.opportunity_id }))}
      programs={data.programs.map((p) => ({ value: p.id, label: p.name }))}
      tags={data.tags.map((t) => ({ value: t, label: t }))}
      showSearch={view === 'kanban'}
    />
  );

  return (
    <div className="grid gap-4">
      {header}
      {noApplications ? (
        <EmptyState
          title="No applications yet"
          description="Applications appear here as soon as applicants start them. Publish an opportunity to start receiving applications."
          action={
            <Button asChild size="sm">
              <Link href="/console/opportunities">Go to opportunities</Link>
            </Button>
          }
        />
      ) : (
        <>
          {filterBar}
          {forced === 'bulk' ? (
            <Alert variant="info" title="Bulk actions">
              Select applications with the checkboxes to advance, decline, assign reviewers, message or tag them together.
            </Alert>
          ) : null}
          {!canEdit ? <p className="text-sm text-muted-foreground">You have read-only access to the pipeline. Program staff can move and update applications.</p> : null}
          {view === 'kanban' ? (
            <section aria-labelledby="board-h" className="grid gap-2">
              <h2 id="board-h" className="sr-only">
                Board
              </h2>
              {overflow ? (
                <Alert variant="warning" title={`Showing the ${KANBAN_LIMIT} most recent applications`}>
                  Narrow the filters to see the rest, or switch to the table.
                </Alert>
              ) : null}
              <p className="text-xs text-muted-foreground">In-progress and withdrawn applications aren’t shown on the board. Drag a card, or use its “Move” menu.</p>
              <PipelineKanban
                rows={rows}
                canEdit={canEdit}
                inviteStages={data.comps.filter((c) => c.access === 'invite').map((c) => ({ id: c.id, name: c.name, opportunityId: c.opportunity_id, status: c.status }))}
              />
            </section>
          ) : (
            <section aria-labelledby="table-h" className="grid gap-2">
              <h2 id="table-h" className="sr-only">
                Applications
              </h2>
              <PipelineTable
                rows={rows}
                state={{ page: tp.page, pageSize: tp.pageSize, sort: tp.sort, dir: tp.dir, q: tp.q }}
                totalRows={data.total}
                canEdit={canEdit}
                emptyTitle={anyFilter ? 'No applications match these filters' : 'No applications yet'}
                stages={data.reviewStages.map((s) => ({ id: s.id, name: s.name, competitionId: s.competition_id, status: s.status, reviewersPerApplication: s.reviewers_per_application }))}
                reviewers={data.reviewers.map((m) => ({ id: m.userId, name: m.name, role: m.role }))}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
