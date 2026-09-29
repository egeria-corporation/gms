// SPDX-License-Identifier: AGPL-3.0-or-later
// E-01 Board dockets: every docket with its meeting time (workspace timezone), status, items and quorum;
// create a docket, optionally auto-assembled from pending approve recommendations.
// ?state= empty | error
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import { Button, EmptyState, ErrorState, MoneyDisplay, PageHeader, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { Gavel } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DocketStatusChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { CreateDocketDialog } from '@/components/console/grantmaking/dockets/create-docket-dialog';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Board dockets' };

export default async function DocketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const forced = forcedState(await searchParams);
  const canEdit = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));

  const data = await rls(async (trx) => {
    const [dockets, opportunities, pendingRecs] = await Promise.all([
      trx
        .selectFrom('dockets as d')
        .leftJoin('docket_items as i', 'i.docket_id', 'd.id')
        .select([
          'd.id',
          'd.name',
          'd.status',
          'd.meeting_at',
          'd.quorum',
          sql<number>`count(i.id)::int`.as('items'),
          sql<number>`coalesce(sum(i.recommended_amount_cents), 0)::bigint`.as('recommended'),
          sql<number>`(count(i.id) filter (where i.outcome = 'approved'))::int`.as('approved'),
        ])
        .where('d.workspace_id', '=', tenant.id)
        .groupBy('d.id')
        .orderBy(sql`d.meeting_at desc nulls last`)
        .orderBy('d.created_at', 'desc')
        .execute(),
      trx.selectFrom('opportunities').select(['id', 'title']).where('workspace_id', '=', tenant.id).where('status', '!=', 'draft').orderBy('title').execute(),
      trx
        .selectFrom('decisions as dc')
        .innerJoin('applications as a', 'a.id', 'dc.application_id')
        .select(sql<number>`count(distinct dc.application_id)::int`.as('n'))
        .where('dc.workspace_id', '=', tenant.id)
        .where('dc.is_final', '=', false)
        .where('dc.outcome', '=', 'approve')
        .where('a.status', 'in', ['submitted', 'under_review', 'invited_to_next_stage'])
        .where('dc.application_id', 'not in', (eb) => eb.selectFrom('docket_items').select('application_id'))
        .executeTakeFirst(),
    ]);
    return { dockets, opportunities, pendingRecs: Number(pendingRecs?.n ?? 0) };
  }).catch((e: unknown) => {
    console.error('[dockets] load failed', e);
    return null;
  });

  const create = canEdit ? <CreateDocketDialog opportunities={data?.opportunities ?? []} pendingRecommendations={data?.pendingRecs ?? 0} /> : null;
  const header = (
    <PageHeader
      title="Board dockets"
      description="Assemble approve recommendations into a docket, publish it to the board, open voting, then close and tally."
      breadcrumbs={[{ label: 'Console', href: '/console' }, { label: 'Board dockets' }]}
      linkComponent={NextLink}
      actions={create}
    />
  );

  if (!data || forced === 'error') {
    return (
      <div className="grid gap-4">
        {header}
        <ErrorState description="We couldn’t load dockets. Your data is safe; try again in a moment." action={<Button asChild variant="outline"><Link href="/console/dockets">Try again</Link></Button>} />
      </div>
    );
  }

  const dockets = forced === 'empty' ? [] : data.dockets;

  return (
    <div className="grid gap-4">
      {header}
      {dockets.length === 0 ? (
        <EmptyState
          variant="page"
          icon={Gavel}
          title="No board dockets yet"
          description={
            data.pendingRecs
              ? `${data.pendingRecs} approve recommendation${data.pendingRecs === 1 ? ' is' : 's are'} ready to go on a docket.`
              : 'Record approve recommendations on the decisions page, then create a docket to bring them to the board.'
          }
          action={create ?? undefined}
          secondaryAction={
            <Button asChild variant="outline">
              <Link href="/console/decisions">Go to decisions</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableCaption className="sr-only">Board dockets</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Docket</TableHead>
                <TableHead>Meeting ({tenant.timezone.replace(/_/g, ' ')})</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Recommended</TableHead>
                <TableHead className="text-right">Quorum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dockets.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/console/dockets/${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                    {d.status === 'closed' ? <span className="block text-xs text-muted-foreground">{Number(d.approved)} approved</span> : null}
                  </TableCell>
                  <TableCell className="text-sm">{d.meeting_at ? formatInZone(d.meeting_at, tenant.timezone) : 'Not scheduled'}</TableCell>
                  <TableCell>
                    <DocketStatusChip status={d.status} size="sm" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(d.items)}</TableCell>
                  <TableCell className="text-right">
                    <MoneyDisplay cents={Number(d.recommended)} compact />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.quorum}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
