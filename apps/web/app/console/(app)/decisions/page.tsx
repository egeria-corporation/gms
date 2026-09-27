// SPDX-License-Identifier: AGPL-3.0-only
// R-05 Decision queue: applications awaiting a decision (submitted / under review / invited) with review
// aggregates and the latest recommendation; recommend, record the final decision (R3, people only) and
// bulk decline with a letter preview. The "Decided" view lists final decisions with links to the award builder.
// URL: ?final=pending|decided|all · ?opp=<opportunityId> · ?rec=approve|decline|defer|none · q/sort/dir/page/size.
// ?state= empty | confirm-final (opens the final-decision dialog for the first row) | bulk-decline (opens the
// bulk decline dialog with the first rows selected) | error
import { sql } from '@gms/db';
import { Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionsFilters } from '@/components/console/grantmaking/decisions/decisions-filters';
import { DecisionsTable, type DecisionRow } from '@/components/console/grantmaking/decisions/decisions-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, oneParam, tableParams, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Decisions' };

const QUEUE = ['submitted', 'under_review', 'invited_to_next_stage'] as const;
const DECIDED = ['awarded', 'declined'] as const;
const SORTABLE = ['submitted', 'score', 'requested', 'reference', 'recommended'] as const;
const DECIDE_ROLES = ['owner', 'admin', 'program_officer'];

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const tp = tableParams(sp, { sortable: SORTABLE, sort: 'submitted', dir: 'asc' });
  const finalParam = oneParam(sp, 'final');
  const view: 'pending' | 'decided' | 'all' = finalParam === 'decided' || finalParam === 'all' ? finalParam : 'pending';
  const opp = oneParam(sp, 'opp');
  const recParam = oneParam(sp, 'rec');
  const rec = recParam && ['approve', 'decline', 'defer', 'none'].includes(recParam) ? recParam : null;
  const canDecide = Boolean(viewer.role && DECIDE_ROLES.includes(viewer.role));

  const data = await rls(async (trx) => {
    const statuses: string[] = view === 'pending' ? [...QUEUE] : view === 'decided' ? [...DECIDED] : [...QUEUE, ...DECIDED];
    let q = trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('reviews as r')
            .innerJoin('review_assignments as ra', 'ra.id', 'r.assignment_id')
            .select([
              sql<number>`count(*)::int`.as('n'),
              sql<number | null>`round(avg(r.weighted_score)::numeric, 1)`.as('mean'),
              sql<number>`(count(*) filter (where r.recommendation = 'fund'))::int`.as('fund'),
              sql<number>`(count(*) filter (where r.recommendation = 'maybe'))::int`.as('maybe'),
              sql<number>`(count(*) filter (where r.recommendation = 'decline'))::int`.as('decline'),
            ])
            .whereRef('ra.application_id', '=', 'a.id')
            .where('r.status', '=', 'submitted')
            .as('rv'),
        (j) => j.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('decisions as d')
            .leftJoin('profiles as p', 'p.id', 'd.recorded_by')
            .select(['d.id', 'd.outcome', 'd.recommended_amount_cents', 'd.reason', 'd.recorded_at', 'p.full_name'])
            .whereRef('d.application_id', '=', 'a.id')
            .where('d.is_final', '=', false)
            .orderBy('d.recorded_at', 'desc')
            .limit(1)
            .as('rec'),
        (j) => j.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('decisions as f')
            .leftJoin('profiles as fp', 'fp.id', 'f.recorded_by')
            .select(['f.outcome', 'f.recommended_amount_cents', 'f.recorded_at', 'f.letter_sent_at', 'fp.full_name'])
            .whereRef('f.application_id', '=', 'a.id')
            .where('f.is_final', '=', true)
            .orderBy('f.recorded_at', 'desc')
            .limit(1)
            .as('fin'),
        (j) => j.onTrue(),
      )
      .leftJoin('awards as aw', (j) => j.onRef('aw.application_id', '=', 'a.id').on('aw.kind', '=', 'original'))
      .where('a.workspace_id', '=', tenant.id)
      .where('a.status', 'in', statuses);
    if (isUuid(opp)) q = q.where('a.opportunity_id', '=', opp);
    if (rec === 'none') q = q.where('rec.id', 'is', null);
    else if (rec) q = q.where('rec.outcome', '=', rec);
    if (tp.q) {
      const like = `%${tp.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      q = q.where((eb) => eb.or([eb('a.reference_number', 'ilike', like), eb('a.title', 'ilike', like), eb('g.legal_name', 'ilike', like)]));
    }
    const dir = sql.raw(tp.dir === 'asc' ? 'asc' : 'desc');
    const order =
      tp.sort === 'score'
        ? sql`rv.mean ${dir} nulls last`
        : tp.sort === 'requested'
          ? sql`a.requested_amount_cents ${dir} nulls last`
          : tp.sort === 'recommended'
            ? sql`rec.recommended_amount_cents ${dir} nulls last`
            : tp.sort === 'reference'
              ? sql`a.reference_number ${dir}`
              : sql`a.submitted_at ${dir} nulls last`;
    const [total, rows, opportunities] = await Promise.all([
      q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      q
        .select([
          'a.id',
          'a.reference_number',
          'a.title',
          'a.status',
          'a.requested_amount_cents',
          'a.submitted_at',
          'a.submitted_via',
          'o.title as opp_title',
          'g.legal_name',
          'rv.n as review_count',
          'rv.mean',
          'rv.fund',
          'rv.maybe',
          'rv.decline',
          'rec.outcome as rec_outcome',
          'rec.recommended_amount_cents as rec_amount',
          'rec.reason as rec_reason',
          'rec.recorded_at as rec_at',
          'rec.full_name as rec_by',
          'fin.outcome as fin_outcome',
          'fin.recommended_amount_cents as fin_amount',
          'fin.recorded_at as fin_at',
          'fin.full_name as fin_by',
          'fin.letter_sent_at as fin_letter',
          'aw.id as award_id',
          'aw.status as award_status',
        ])
        .orderBy(order)
        .orderBy('a.reference_number')
        .limit(tp.pageSize)
        .offset((tp.page - 1) * tp.pageSize)
        .execute(),
      trx.selectFrom('opportunities').select(['id', 'title']).where('workspace_id', '=', tenant.id).where('status', '!=', 'draft').orderBy('title').execute(),
    ]);
    return { total: Number(total?.n ?? 0), rows, opportunities };
  }).catch((e: unknown) => {
    console.error('[decisions] load failed', e);
    return null;
  });

  const header = (
    <PageHeader
      title="Decisions"
      description="Recommend, then record final decisions. Approving creates a draft award; declining can send a letter."
      breadcrumbs={[{ label: 'Console', href: '/console' }, { label: 'Decisions' }]}
      linkComponent={NextLink}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/console/dockets">Board dockets</Link>
        </Button>
      }
    />
  );

  if (!data || forced === 'error') {
    return (
      <div className="grid gap-4">
        {header}
        <ErrorState description="We couldn’t load the decision queue. Your data is safe; try again in a moment." action={<Button asChild variant="outline"><Link href="/console/decisions">Try again</Link></Button>} />
      </div>
    );
  }

  const rows: DecisionRow[] =
    forced === 'empty'
      ? []
      : data.rows.map((r) => ({
          id: r.id,
          reference: r.reference_number,
          title: r.title ?? r.opp_title,
          opportunity: r.opp_title,
          organization: r.legal_name,
          status: r.status,
          viaAgent: r.submitted_via === 'agent',
          requestedCents: r.requested_amount_cents === null ? null : Number(r.requested_amount_cents),
          submittedAt: r.submitted_at,
          reviewCount: Number(r.review_count ?? 0),
          meanScore: r.mean === null || r.mean === undefined ? null : Number(r.mean),
          tally: { fund: Number(r.fund ?? 0), maybe: Number(r.maybe ?? 0), decline: Number(r.decline ?? 0) },
          recommendation: r.rec_outcome
            ? { outcome: r.rec_outcome, amountCents: r.rec_amount === null ? null : Number(r.rec_amount), reason: r.rec_reason, by: r.rec_by, at: r.rec_at ?? '' }
            : null,
          final: r.fin_outcome ? { outcome: r.fin_outcome, amountCents: r.fin_amount === null ? null : Number(r.fin_amount), by: r.fin_by, at: r.fin_at ?? '', letterSent: Boolean(r.fin_letter) } : null,
          awardId: r.award_id,
          awardStatus: r.award_status,
        }));

  const pendingRows = rows.filter((r) => (QUEUE as readonly string[]).includes(r.status));
  const firstPending = pendingRows[0]?.id ?? null;

  return (
    <div className="grid gap-4">
      {header}
      <DecisionsFilters view={view} opportunities={data.opportunities.map((o) => ({ id: o.id, title: o.title }))} opp={isUuid(opp) ? opp : null} rec={rec} />
      {rows.length === 0 && !tp.q && !rec && !isUuid(opp) ? (
        <EmptyState
          variant="page"
          title={view === 'decided' ? 'No final decisions yet' : 'Nothing is waiting for a decision'}
          description={
            view === 'decided'
              ? 'Awarded and declined applications show up here once a final decision is recorded.'
              : 'Submitted applications appear here with their review scores. Move applications along in the pipeline, then come back to decide.'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/console/pipeline">Open the pipeline</Link>
            </Button>
          }
        />
      ) : (
        <DecisionsTable
          rows={rows}
          totalRows={forced === 'empty' ? 0 : data.total}
          state={{ page: tp.page, pageSize: tp.pageSize, sort: tp.sort, dir: tp.dir, q: tp.q }}
          canDecide={canDecide}
          timeZone={tenant.timezone}
          openFinalFor={forced === 'confirm-final' ? firstPending : null}
          openBulkWith={forced === 'bulk-decline' ? pendingRows.slice(0, 3).map((r) => r.id) : null}
          caption={view === 'decided' ? 'Final decisions' : 'Applications awaiting a decision'}
        />
      )}
    </div>
  );
}
