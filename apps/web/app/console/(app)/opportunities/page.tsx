// SPDX-License-Identifier: AGPL-3.0-only
// C-03 Opportunities: every opportunity with its status, program, open/close dates (workspace timezone) and
// application counts. Server-side pagination/sort/search; filters `status` (comma list) and `program`.
// ?state= empty | error
import { sql } from '@gms/db';
import { OPPORTUNITY_STATUS } from '@gms/domain';
import { Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpportunitiesTable, type OpportunityRow } from '@/components/console/grantmaking/opportunities/opportunities-table';
import { requireStaff } from '@/lib/auth';
import { isUuid, listParam, oneParam, tableParams, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Opportunities' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];
const SORTABLE = ['title', 'status', 'program', 'opens', 'closes', 'apps'] as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const tp = tableParams(sp, { sortable: SORTABLE, sort: 'closes', dir: 'desc' });
  const statuses = listParam(sp, 'status').filter((s) => s in OPPORTUNITY_STATUS);
  const program = oneParam(sp, 'program');
  const programId = isUuid(program) ? program : undefined;

  const data =
    forced === 'error'
      ? null
      : await rls(async (trx) => {
          let q = trx.selectFrom('opportunities as o').leftJoin('programs as p', 'p.id', 'o.program_id').where('o.workspace_id', '=', tenant.id);
          if (statuses.length) q = q.where('o.status', 'in', statuses);
          if (programId) q = q.where('o.program_id', '=', programId);
          if (tp.q) q = q.where((eb) => eb.or([eb('o.title', 'ilike', `%${tp.q}%`), eb('o.slug', 'ilike', `%${tp.q}%`)]));
          const appCount = sql<number>`(select count(*)::int from applications a where a.opportunity_id = o.id)`;
          const submittedCount = sql<number>`(select count(*)::int from applications a where a.opportunity_id = o.id and a.status <> 'in_progress')`;
          const orderCol = {
            title: sql`o.title`,
            status: sql`o.status`,
            program: sql`p.name`,
            opens: sql`o.opens_at`,
            closes: sql`o.closes_at`,
            apps: appCount,
          }[tp.sort as (typeof SORTABLE)[number]];
          const [rows, total, programs] = await Promise.all([
            q
              .select(['o.id', 'o.title', 'o.slug', 'o.status', 'o.visibility', 'o.opens_at', 'o.closes_at', 'o.forecast_at', 'p.name as program_name', appCount.as('apps'), submittedCount.as('submitted')])
              .orderBy(sql`${orderCol} ${sql.raw(tp.dir)} nulls last`)
              .orderBy('o.title')
              .limit(tp.pageSize)
              .offset((tp.page - 1) * tp.pageSize)
              .execute(),
            q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
            trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
          ]);
          return { rows, total: Number(total?.n ?? 0), programs };
        }).catch(() => null);

  const header = (
    <PageHeader
      title="Opportunities"
      description="Funding opportunities, their stages and deadlines. Dates are in the workspace timezone."
      meta={<span className="text-xs text-muted-foreground">Timezone: {tenant.timezone}</span>}
      actions={
        canEdit ? (
          <Button asChild size="sm">
            <Link href="/console/opportunities/new">
              <Plus aria-hidden="true" /> New opportunity
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (!data) {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState description="We couldn’t load opportunities. Refresh the page, or try again in a minute." action={<Button asChild variant="outline" size="sm"><Link href="/console/opportunities">Try again</Link></Button>} />
      </div>
    );
  }

  const noneAtAll = forced === 'empty' || (data.total === 0 && !statuses.length && !programId && !tp.q);
  if (noneAtAll) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          title="No opportunities yet"
          description="An opportunity is a call for applications: what you fund, who can apply, the stages and the deadline. Start with a draft; nothing is public until you publish it."
          action={
            canEdit ? (
              <Button asChild size="sm">
                <Link href="/console/opportunities/new">
                  <Plus aria-hidden="true" /> New opportunity
                </Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const rows: OpportunityRow[] = data.rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    status: r.status,
    visibility: r.visibility,
    programName: r.program_name,
    opensAt: r.opens_at,
    closesAt: r.closes_at,
    forecastAt: r.forecast_at,
    apps: Number(r.apps),
    submitted: Number(r.submitted),
  }));

  return (
    <div className="grid gap-6">
      {header}
      <OpportunitiesTable rows={rows} total={data.total} state={tp} timeZone={tenant.timezone} programs={data.programs} statuses={statuses} programId={programId ?? null} />
    </div>
  );
}
