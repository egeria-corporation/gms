// SPDX-License-Identifier: AGPL-3.0-or-later
// E-02 Board docket: item summaries (gms.board_docket_items — board members can't read reviews or applicant
// orgs directly), recommended amounts, review score summaries (average / min / max, count — never individual
// reviews), a section nav of items, voting while the docket is in session (board.vote, R3, people only) with
// "Your vote … recorded …", the quorum count, and outcomes after close.
// ?state= empty | voted | closed | not-in-session | not-found | error
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import { Alert, Button, EmptyState, ErrorState, MoneyDisplay, NotFoundState, PageHeader } from '@gms/ui';
import { CircleCheck, Circle, ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BoardFrame } from '@/components/console/grantmaking/board/board-frame';
import { VotePanel } from '@/components/console/grantmaking/board/vote-panel';
import { DocketOutcomeChip, DocketStatusChip, VoteChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { requireMember } from '@/lib/auth';
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
}

function tally(votes: { vote: string }[], quorum: number): string {
  const approve = votes.filter((v) => v.vote === 'approve').length;
  const decline = votes.filter((v) => v.vote === 'decline').length;
  const abstain = votes.filter((v) => v.vote === 'abstain').length;
  if (approve + decline + abstain < quorum) return 'no_quorum';
  return approve > decline ? 'approved' : decline > approve ? 'declined' : 'deferred';
}

const fmtScore = (n: number | null) => (n === null ? '—' : Number(n).toFixed(1));

export default async function BoardDocketPage({ params, searchParams }: { params: Promise<{ docketId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireMember(['board'])]);
  const { docketId } = await params;
  const forced = forcedState(await searchParams);

  const data =
    forced === 'not-found' || !isUuid(docketId)
      ? undefined
      : await rls(async (trx) => {
          const docket = await trx.selectFrom('dockets').select(['id', 'name', 'status', 'meeting_at', 'quorum']).where('id', '=', docketId).where('workspace_id', '=', tenant.id).where('status', '!=', 'draft').executeTakeFirst();
          if (!docket) return undefined;
          const [items, votes] = await Promise.all([
            sql<ItemRow>`select * from gms.board_docket_items(${docket.id}::uuid)`.execute(trx).then((r) => r.rows),
            trx
              .selectFrom('votes as v')
              .innerJoin('docket_items as i', 'i.id', 'v.docket_item_id')
              .leftJoin('profiles as p', 'p.id', 'v.voter_id')
              .select(['v.docket_item_id', 'v.voter_id', 'v.vote', 'v.recorded_at', 'p.full_name'])
              .where('i.docket_id', '=', docket.id)
              .orderBy('v.recorded_at')
              .execute(),
          ]);
          return { docket, items, votes };
        }).catch((e: unknown) => {
          console.error('[board docket] load failed', e);
          return null;
        });

  const exit = { href: '/board', label: 'All dockets' };

  if (data === null || forced === 'error') {
    return (
      <BoardFrame tenant={tenant} viewer={viewer} exit={exit}>
        <PageHeader title="Board docket" density="spacious" />
        <ErrorState description="We couldn’t load this docket. Try again in a moment." />
      </BoardFrame>
    );
  }
  if (!data) {
    return (
      <BoardFrame tenant={tenant} viewer={viewer} exit={exit}>
        <PageHeader title="Board docket" density="spacious" />
        <NotFoundState description="This docket doesn’t exist or hasn’t been published to the board yet." action={<Button asChild variant="outline"><Link href="/board">All dockets</Link></Button>} />
      </BoardFrame>
    );
  }

  const { docket } = data;
  const status = forced === 'closed' ? 'closed' : forced === 'not-in-session' ? 'published' : forced === 'voted' ? 'in_session' : docket.status;
  const items = forced === 'empty' ? [] : data.items;
  const nowIso = new Date().toISOString();
  const view = items.map((it, idx) => {
    const v = data.votes.filter((x) => x.docket_item_id === it.item_id);
    const mineReal = v.find((x) => x.voter_id === viewer.userId);
    const mine = mineReal
      ? { vote: mineReal.vote, at: mineReal.recorded_at }
      : forced === 'voted'
        ? { vote: 'approve', at: nowIso }
        : null;
    return {
      it,
      n: idx + 1,
      votes: v,
      mine: mine ? { vote: mine.vote, recordedAt: formatInZone(mine.at, tenant.timezone, { withZone: false }) } : null,
      present: v.filter((x) => x.vote !== 'recuse').length,
      outcome: it.outcome ?? (status === 'closed' ? tally(v, docket.quorum) : null),
    };
  });
  const votedCount = view.filter((x) => x.mine).length;

  const sectionNav = view.length ? (
    <nav aria-label="Docket items" className="grid gap-2">
      <p className="text-sm font-semibold">Items</p>
      <ol className="grid gap-1">
        {view.map((x) => (
          <li key={x.it.item_id}>
            <a href={`#item-${x.it.item_id}`} className="flex min-h-11 items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              {x.mine ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-success-fg" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0">
                <span className="font-medium">{x.n}.</span> {x.it.organization_name ?? 'Individual applicant'}
                <span className="sr-only">{x.mine ? ' (you voted)' : ' (no vote yet)'}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  ) : undefined;

  return (
    <BoardFrame
      tenant={tenant}
      viewer={viewer}
      exit={exit}
      context={docket.name}
      progress={view.length && status !== 'published' ? `You voted on ${votedCount} of ${view.length}` : undefined}
      sectionNav={sectionNav}
    >
      <PageHeader
        title={docket.name}
        density="spacious"
        description={`${docket.meeting_at ? formatInZone(docket.meeting_at, tenant.timezone) : 'Meeting time to be announced'} · Quorum: ${docket.quorum} vote${docket.quorum === 1 ? '' : 's'} per item`}
        meta={<DocketStatusChip status={status} />}
      />

      {forced && ['voted', 'closed', 'not-in-session'].includes(forced) && status !== docket.status ? (
        <Alert variant="info" title="Preview" className="mb-6">
          Forced with ?state={forced}; this docket is really “{docket.status.replace('_', ' ')}”.
        </Alert>
      ) : null}

      {status === 'published' ? (
        <Alert variant="info" title="Voting hasn’t opened yet" className="mb-6">
          Read each item before the meeting. The chair opens voting at the meeting; this page then shows the voting buttons.
        </Alert>
      ) : status === 'in_session' ? (
        <Alert variant="info" title="Voting is open" className="mb-6">
          Vote on each item: approve, decline, abstain, or recuse if you have a conflict. You can change your vote until voting closes. Each vote is recorded with your name and the time.
        </Alert>
      ) : (
        <Alert variant="success" title="Voting is closed" className="mb-6">
          The results below are final for this meeting. Staff record the final decisions and awards.
        </Alert>
      )}

      {view.length === 0 ? (
        <EmptyState variant="page" icon={ListChecks} title="No items on this docket" description="Staff haven’t added any recommendations to this docket yet." />
      ) : (
        <div className="grid gap-10">
          {view.map((x) => {
            const r = x.it;
            const title = r.application_title ?? r.opportunity_title;
            const counts = {
              approve: x.votes.filter((v) => v.vote === 'approve').length,
              decline: x.votes.filter((v) => v.vote === 'decline').length,
              abstain: x.votes.filter((v) => v.vote === 'abstain').length,
              recuse: x.votes.filter((v) => v.vote === 'recuse').length,
            };
            return (
              <section key={r.item_id} id={`item-${r.item_id}`} aria-labelledby={`item-h-${r.item_id}`} className="grid scroll-mt-24 gap-5 rounded-xl border bg-card p-6 shadow-soft">
                <header className="grid gap-1">
                  <p className="text-sm text-muted-foreground">
                    Item {x.n} · {r.reference_number} · {r.opportunity_title}
                  </p>
                  <h2 id={`item-h-${r.item_id}`} className="font-heading text-2xl font-semibold">
                    {r.organization_name ?? 'Individual applicant'}
                  </h2>
                  <p className="text-lg">{title}</p>
                  {x.outcome ? (
                    <div className="mt-1">
                      <DocketOutcomeChip outcome={x.outcome} />
                    </div>
                  ) : null}
                </header>

                <dl className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-1 rounded-lg bg-muted/50 p-4">
                    <dt className="text-sm text-muted-foreground">Recommended</dt>
                    <dd className="text-2xl font-semibold">
                      <MoneyDisplay cents={r.recommended_amount_cents === null ? null : Number(r.recommended_amount_cents)} />
                    </dd>
                    <dd className="text-sm text-muted-foreground">
                      Requested <MoneyDisplay cents={r.requested_amount_cents === null ? null : Number(r.requested_amount_cents)} />
                    </dd>
                  </div>
                  <div className="grid gap-1 rounded-lg bg-muted/50 p-4 sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">Review scores (out of 100)</dt>
                    {Number(r.review_count) ? (
                      <>
                        <dd className="text-2xl font-semibold tabular-nums">{fmtScore(r.average_score)} average</dd>
                        <dd className="text-sm text-muted-foreground tabular-nums">
                          Range {fmtScore(r.min_score)}–{fmtScore(r.max_score)} · {Number(r.review_count)} review{Number(r.review_count) === 1 ? '' : 's'}
                        </dd>
                      </>
                    ) : (
                      <dd className="text-base text-muted-foreground">No submitted reviews</dd>
                    )}
                  </div>
                </dl>

                {r.recommendation ? (
                  <div className="grid gap-1">
                    <h3 className="text-sm font-semibold">Staff recommendation</h3>
                    <p className="text-base leading-relaxed">{r.recommendation}</p>
                  </div>
                ) : null}

                <div className="grid gap-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Votes</h3>
                  {status === 'published' ? (
                    <p className="text-base text-muted-foreground">Voting opens at the meeting.</p>
                  ) : (
                    <>
                      <p className="text-base tabular-nums">
                        {x.present} of {docket.quorum} vote{docket.quorum === 1 ? '' : 's'} needed for quorum
                        {x.present >= docket.quorum ? ' · quorum reached' : ''}
                        <span className="text-muted-foreground">
                          {' '}
                          (Approve {counts.approve} · Decline {counts.decline} · Abstain {counts.abstain} · Recuse {counts.recuse})
                        </span>
                      </p>
                      {status === 'in_session' ? (
                        <VotePanel
                          docketId={docket.id}
                          itemId={r.item_id}
                          itemLabel={`Item ${x.n}: ${r.organization_name ?? title}`}
                          mine={x.mine}
                          preview={forced === 'voted' && docket.status !== 'in_session'}
                        />
                      ) : x.mine ? (
                        <p className="flex flex-wrap items-center gap-2 text-base">
                          Your vote: <VoteChip vote={x.mine.vote} size="default" /> <span className="text-muted-foreground">recorded {x.mine.recordedAt}</span>
                        </p>
                      ) : (
                        <p className="text-base text-muted-foreground">You didn’t vote on this item.</p>
                      )}
                      {status === 'closed' && x.votes.length ? (
                        <ul className="grid gap-1 text-sm">
                          {x.votes.map((v) => (
                            <li key={`${v.voter_id}`} className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{v.full_name ?? 'Board member'}</span>
                              <VoteChip vote={v.vote} />
                              <span className="text-muted-foreground">{formatInZone(v.recorded_at, tenant.timezone)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </BoardFrame>
  );
}
