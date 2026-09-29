// SPDX-License-Identifier: AGPL-3.0-or-later
// E-01 Board docket detail: items (gms.board_docket_items) with requested vs recommended amounts, review
// aggregates and vote tallies (who voted, when); reorder / add / remove while draft or published; lifecycle
// published → in session → closed (tally against the quorum); board book PDF; approved items link to the
// award builder after close.
// ?state= empty | in-session | closed | not-found | error
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import { Alert, Button, EmptyState, ErrorState, NotFoundState, PageHeader } from '@gms/ui';
import { FileDown, ListPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DocketStatusChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { AddDocketItemDialog } from '@/components/console/grantmaking/dockets/add-item-dialog';
import { DocketItems, type DocketItemView } from '@/components/console/grantmaking/dockets/docket-items';
import { DocketLifecycle } from '@/components/console/grantmaking/dockets/docket-lifecycle';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Board docket' };

interface ItemRow {
  item_id: string;
  application_id: string;
  item_position: number;
  reference_number: string;
  application_title: string | null;
  organization_name: string | null;
  opportunity_title: string;
  requested_amount_cents: number | null;
  recommended_amount_cents: number | null;
  recommendation: string | null;
  outcome: string | null;
  review_count: number;
  average_score: number | null;
  min_score: number | null;
  max_score: number | null;
  application_status: string;
}

/** Same rule as board.set_docket_status when it closes a docket. */
function tally(votes: { vote: string }[], quorum: number): string {
  const approve = votes.filter((v) => v.vote === 'approve').length;
  const decline = votes.filter((v) => v.vote === 'decline').length;
  const abstain = votes.filter((v) => v.vote === 'abstain').length;
  if (approve + decline + abstain < quorum) return 'no_quorum';
  return approve > decline ? 'approved' : decline > approve ? 'declined' : 'deferred';
}

export default async function DocketPage({ params, searchParams }: { params: Promise<{ docketId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { docketId } = await params;
  const forced = forcedState(await searchParams);
  const canEdit = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));

  const data =
    forced === 'not-found' || !isUuid(docketId)
      ? undefined
      : await rls(async (trx) => {
          const docket = await trx.selectFrom('dockets').selectAll().where('id', '=', docketId).where('workspace_id', '=', tenant.id).executeTakeFirst();
          if (!docket) return undefined;
          const [items, votes, candidates, board] = await Promise.all([
            sql<ItemRow>`select * from gms.board_docket_items(${docket.id}::uuid)`.execute(trx).then((r) => r.rows),
            trx
              .selectFrom('votes as v')
              .innerJoin('docket_items as i', 'i.id', 'v.docket_item_id')
              .leftJoin('profiles as p', 'p.id', 'v.voter_id')
              .select(['v.docket_item_id', 'v.vote', 'v.recorded_at', 'p.full_name', 'p.email'])
              .where('i.docket_id', '=', docket.id)
              .orderBy('v.recorded_at')
              .execute(),
            trx
              .selectFrom('decisions as dc')
              .innerJoin('applications as a', 'a.id', 'dc.application_id')
              .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
              .select(['dc.application_id', 'dc.outcome', 'dc.recommended_amount_cents', 'dc.reason', 'a.reference_number', 'a.title', 'a.requested_amount_cents', 'g.legal_name'])
              .where('dc.workspace_id', '=', tenant.id)
              .where('dc.is_final', '=', false)
              .where('a.status', 'in', ['submitted', 'under_review', 'invited_to_next_stage'])
              .where('dc.application_id', 'not in', (eb) => eb.selectFrom('docket_items').select('application_id'))
              .distinctOn('dc.application_id')
              .orderBy('dc.application_id')
              .orderBy('dc.recorded_at', 'desc')
              .execute(),
            trx
              .selectFrom('workspace_members')
              .select(sql<number>`count(*)::int`.as('n'))
              .where('workspace_id', '=', tenant.id)
              .where('role', '=', 'board')
              .where('status', '=', 'active')
              .executeTakeFirst(),
          ]);
          return { docket, items, votes, candidates: candidates.filter((c) => c.outcome === 'approve'), boardMembers: Number(board?.n ?? 0) };
        }).catch((e: unknown) => {
          console.error('[docket] load failed', e);
          return null;
        });

  const crumbs = [{ label: 'Console', href: '/console' }, { label: 'Board dockets', href: '/console/dockets' }, { label: data ? data.docket.name : 'Docket' }];

  if (data === null || forced === 'error') {
    return (
      <div className="grid gap-4">
        <PageHeader title="Board docket" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load this docket. Your data is safe; try again in a moment." />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Board docket" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState description="That docket doesn’t exist, or you don’t have access to it." action={<Button asChild variant="outline"><Link href="/console/dockets">All dockets</Link></Button>} />
      </div>
    );
  }

  const { docket } = data;
  const status = forced === 'in-session' ? 'in_session' : forced === 'closed' ? 'closed' : docket.status;
  const editable = canEdit && (status === 'draft' || status === 'published');
  const rows = forced === 'empty' ? [] : data.items;
  const items: DocketItemView[] = rows.map((r) => {
    const v = data.votes.filter((x) => x.docket_item_id === r.item_id);
    return {
      id: r.item_id,
      applicationId: r.application_id,
      position: r.item_position,
      reference: r.reference_number,
      title: r.application_title ?? r.opportunity_title,
      organization: r.organization_name,
      opportunity: r.opportunity_title,
      requestedCents: r.requested_amount_cents === null ? null : Number(r.requested_amount_cents),
      recommendedCents: r.recommended_amount_cents === null ? null : Number(r.recommended_amount_cents),
      recommendation: r.recommendation,
      outcome: r.outcome ?? (status === 'closed' ? tally(v, docket.quorum) : null),
      applicationStatus: r.application_status,
      reviews: { count: Number(r.review_count), average: r.average_score === null ? null : Number(r.average_score), min: r.min_score === null ? null : Number(r.min_score), max: r.max_score === null ? null : Number(r.max_score) },
      tally: {
        approve: v.filter((x) => x.vote === 'approve').length,
        decline: v.filter((x) => x.vote === 'decline').length,
        abstain: v.filter((x) => x.vote === 'abstain').length,
        recuse: v.filter((x) => x.vote === 'recuse').length,
      },
      voters: v.map((x) => ({ name: x.full_name || x.email || 'Board member', vote: x.vote, at: formatInZone(x.recorded_at, tenant.timezone) })),
    };
  });
  const totalRecommended = items.reduce((s, i) => s + (i.recommendedCents ?? 0), 0);
  const approvedCount = items.filter((i) => i.outcome === 'approved').length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={docket.name}
        breadcrumbs={crumbs}
        linkComponent={NextLink}
        description={`${docket.meeting_at ? `Meets ${formatInZone(docket.meeting_at, tenant.timezone)}` : 'No meeting time set'} · Quorum ${docket.quorum} of ${data.boardMembers} board member${data.boardMembers === 1 ? '' : 's'} · ${items.length} item${items.length === 1 ? '' : 's'}`}
        meta={<DocketStatusChip status={status} />}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/console/dockets/${docket.id}/board-book`} target="_blank" rel="noreferrer">
                <FileDown aria-hidden="true" /> Board book (PDF)
              </a>
            </Button>
            {editable ? (
              <AddDocketItemDialog
                docketId={docket.id}
                candidates={data.candidates.map((c) => ({
                  applicationId: c.application_id,
                  label: `${c.reference_number} · ${c.legal_name ?? 'Individual applicant'} — ${c.title ?? ''}`,
                  recommendedCents: c.recommended_amount_cents === null ? (c.requested_amount_cents === null ? null : Number(c.requested_amount_cents)) : Number(c.recommended_amount_cents),
                  recommendation: c.reason,
                }))}
              />
            ) : null}
            {canEdit ? <DocketLifecycle docketId={docket.id} status={status} itemCount={items.length} quorum={docket.quorum} boardMembers={data.boardMembers} labels={Object.fromEntries(items.map((i) => [i.applicationId, `${i.reference} · ${i.organization ?? i.title}`]))} /> : null}
          </>
        }
      />

      {forced === 'in-session' || forced === 'closed' ? (
        <Alert variant="info" title={`Preview of the “${status.replace('_', ' ')}” state`}>
          Forced with ?state={forced}; this docket is really “{docket.status.replace('_', ' ')}”.{forced === 'closed' ? ' Outcomes shown are what a close would tally from the votes so far.' : ''}
        </Alert>
      ) : null}

      {status === 'draft' ? (
        <Alert variant="info" title="Draft: the board can’t see this docket yet">
          Put the items in the order the board will discuss them, check the board book, then publish.
        </Alert>
      ) : status === 'in_session' ? (
        <Alert variant="info" title="Voting is open">
          Board members vote in the board portal. Items can’t change until the docket is closed. Each item needs {docket.quorum} vote{docket.quorum === 1 ? '' : 's'} (approve, decline or abstain) for a result.
        </Alert>
      ) : status === 'closed' ? (
        <Alert variant="success" title={`Closed: ${approvedCount} of ${items.length} approved`}>
          Approved items are ready for a final decision and an award. Open each one’s award builder from the list below.
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          variant="page"
          icon={ListPlus}
          title="No items on this docket"
          description={editable ? 'Add applications that have an approve recommendation. They’ll appear in the order you set here.' : 'This docket has no items.'}
          action={
            <Button asChild variant="outline">
              <Link href="/console/decisions?rec=approve">Find approve recommendations</Link>
            </Button>
          }
        />
      ) : (
        <DocketItems docketId={docket.id} items={items} editable={editable} status={status} quorum={docket.quorum} totalRecommendedCents={totalRecommended} />
      )}
    </div>
  );
}
