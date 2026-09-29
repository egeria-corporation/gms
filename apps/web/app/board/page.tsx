// SPDX-License-Identifier: AGPL-3.0-or-later
// E-02 Board portal home: published, in-session and closed dockets (RLS hides drafts from the board), with
// the meeting time, item count and how many items you have voted on.
// ?state= empty | error
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import { Button, Card, CardContent, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import { ArrowRight, Gavel } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BoardFrame } from '@/components/console/grantmaking/board/board-frame';
import { DocketStatusChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { requireMember } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Board dockets' };

export default async function BoardHome({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireMember(['board'])]);
  const forced = forcedState(await searchParams);

  const dockets = await rls((trx) =>
    trx
      .selectFrom('dockets as d')
      .leftJoin('docket_items as i', 'i.docket_id', 'd.id')
      .leftJoin('votes as v', (j) => j.onRef('v.docket_item_id', '=', 'i.id').on('v.voter_id', '=', viewer.userId))
      .select(['d.id', 'd.name', 'd.status', 'd.meeting_at', 'd.quorum', sql<number>`count(distinct i.id)::int`.as('items'), sql<number>`count(distinct v.id)::int`.as('mine')])
      .where('d.workspace_id', '=', tenant.id)
      .where('d.status', '!=', 'draft')
      .groupBy('d.id')
      .orderBy(sql`case d.status when 'in_session' then 0 when 'published' then 1 else 2 end`)
      .orderBy(sql`d.meeting_at desc nulls last`)
      .execute(),
  ).catch((e: unknown) => {
    console.error('[board] load failed', e);
    return null;
  });

  const list = forced === 'empty' ? [] : (dockets ?? []);

  return (
    <BoardFrame tenant={tenant} viewer={viewer}>
      <PageHeader title="Board dockets" density="spacious" description={`Welcome, ${viewer.name.split(' ')[0]}. Read each docket before the meeting; vote when the chair opens voting.`} />
      {!dockets || forced === 'error' ? (
        <ErrorState description="We couldn’t load your dockets. Try again in a moment." action={<Button asChild variant="outline"><Link href="/board">Try again</Link></Button>} />
      ) : list.length === 0 ? (
        <EmptyState variant="page" icon={Gavel} title="No dockets yet" description="When staff publish a docket for a board meeting, it appears here with everything you need to review." />
      ) : (
        <ul className="grid gap-4">
          {list.map((d) => {
            const items = Number(d.items);
            const mine = Number(d.mine);
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 p-5">
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <h2 className="font-heading text-xl font-semibold">
                        <Link href={`/board/${d.id}`} className="hover:underline">
                          {d.name}
                        </Link>
                      </h2>
                      <p className="text-base text-muted-foreground">{d.meeting_at ? formatInZone(d.meeting_at, tenant.timezone) : 'Meeting time to be announced'}</p>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <DocketStatusChip status={d.status} />
                        <span>
                          {items} item{items === 1 ? '' : 's'}
                        </span>
                        {d.status !== 'published' ? (
                          <span className="text-muted-foreground">
                            You voted on {mine} of {items}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button asChild size="lg" variant={d.status === 'in_session' && mine < items ? 'default' : 'outline'}>
                      <Link href={`/board/${d.id}`} aria-label={`${d.status === 'in_session' && mine < items ? 'Vote on' : 'Open'} ${d.name}`}>
                        {d.status === 'in_session' && mine < items ? 'Vote now' : 'Open docket'} <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </BoardFrame>
  );
}
