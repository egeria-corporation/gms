// SPDX-License-Identifier: AGPL-3.0-or-later
// C-08 Grantees (CRM list): every organization that has applied to this workspace, with application and award
// counts, total awarded, latest status, EIN, diligence summary, tags and relationship owner.
// URL: page/size/sort/dir/q (UrlDataTable), `tag`, `active=1` (has an active award).
// Supported `?state=` values (non-production): empty, error.
import { sql } from '@gms/db';
import { Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GranteesTable, type GranteeRow } from '@/components/console/grantmaking/grantees/grantees-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { oneParam, tableParams, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Grantees' };

const SORTS: Record<string, string> = {
  name: 'lower(coalesce(o.dba_name, o.legal_name))',
  applications: 'o.applications',
  active: 'active_awards',
  awarded: 'awarded_cents',
};

interface Row {
  id: string;
  legal_name: string;
  dba_name: string | null;
  ein: string | null;
  applications: number;
  latest_status: string | null;
  active_awards: number;
  awarded_cents: number;
  tags: string[] | null;
  owner_name: string | null;
  diligence_status: string | null;
  screening_status: string | null;
  total: number;
}

export default async function GranteesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff()]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const tp = tableParams(sp, { sortable: Object.keys(SORTS), sort: 'name', dir: 'asc' });
  const tag = (oneParam(sp, 'tag') ?? '').slice(0, 40);
  const activeOnly = oneParam(sp, 'active') === '1';
  const ws = tenant.id;
  const pat = tp.q ? `%${tp.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  let data: { rows: Row[]; tags: string[]; any: boolean } | null;
  try {
    data = await rls(async (trx) => {
      const [list, tagRows, anyRow] = await Promise.all([
        sql<Row>`
          with orgs as (
            select g.id, g.legal_name, g.dba_name, g.ein,
              count(a.id)::int as applications,
              (array_agg(a.status order by coalesce(a.submitted_at, a.created_at) desc))[1] as latest_status
            from public.applicant_orgs g
            join public.applications a on a.applicant_org_id = g.id and a.workspace_id = ${ws}::uuid
            group by g.id
          ),
          aw as (
            select applicant_org_id,
              count(*) filter (where status = 'active')::int as active_awards,
              coalesce(sum(amount_cents) filter (where status in ('active', 'completed')), 0)::bigint as awarded_cents
            from public.awards
            where workspace_id = ${ws}::uuid and kind = 'original' and applicant_org_id is not null
            group by applicant_org_id
          )
          select o.id, o.legal_name, o.dba_name, o.ein, o.applications, o.latest_status,
            coalesce(aw.active_awards, 0)::int as active_awards, coalesce(aw.awarded_cents, 0)::bigint as awarded_cents,
            gp.tags, p.full_name as owner_name,
            (select d.status from public.diligence_checks d where d.workspace_id = ${ws}::uuid and d.applicant_org_id = o.id order by d.checked_at desc limit 1) as diligence_status,
            (select s.status from public.sanctions_screenings s where s.workspace_id = ${ws}::uuid and s.applicant_org_id = o.id order by s.created_at desc limit 1) as screening_status,
            count(*) over ()::int as total
          from orgs o
          left join aw on aw.applicant_org_id = o.id
          left join public.grantee_profiles gp on gp.workspace_id = ${ws}::uuid and gp.applicant_org_id = o.id
          left join public.profiles p on p.id = gp.relationship_owner_id
          where true
            ${pat ? sql`and (o.legal_name ilike ${pat} or o.dba_name ilike ${pat} or o.ein ilike ${pat})` : sql``}
            ${tag ? sql`and ${tag} = any(gp.tags)` : sql``}
            ${activeOnly ? sql`and coalesce(aw.active_awards, 0) > 0` : sql``}
          order by ${sql.raw(SORTS[tp.sort] ?? SORTS.name!)} ${sql.raw(tp.dir === 'asc' ? 'asc nulls first' : 'desc nulls last')}, o.legal_name
          limit ${tp.pageSize} offset ${(tp.page - 1) * tp.pageSize}`.execute(trx),
        sql<{ tag: string }>`select distinct unnest(tags) as tag from public.grantee_profiles where workspace_id = ${ws}::uuid order by 1`.execute(trx),
        trx.selectFrom('applications').select('id').where('workspace_id', '=', ws).where('applicant_org_id', 'is not', null).limit(1).executeTakeFirst(),
      ]);
      return { rows: list.rows, tags: tagRows.rows.map((t) => t.tag), any: Boolean(anyRow) };
    });
  } catch (err) {
    console.error('[grantees] load failed', err);
    data = null;
  }

  const header = (
    <PageHeader
      title="Grantees"
      description="Organizations that have applied to you: their history, awards, diligence and your relationship notes."
      linkComponent={NextLink}
      breadcrumbs={[{ label: 'Console', href: '/console' }, { label: 'Grantees' }]}
    />
  );
  if (forced === 'error' || !data) {
    return (
      <div className="grid gap-4">
        {header}
        <ErrorState title="We couldn’t load grantees" description="Refresh the page to try again." action={<Button asChild size="sm"><Link href="/console/grantees">Try again</Link></Button>} />
      </div>
    );
  }
  if (forced === 'empty' || !data.any) {
    return (
      <div className="grid gap-4">
        {header}
        <EmptyState
          title="No grantees yet"
          description="Organizations appear here once they apply to one of your opportunities."
          action={
            <Button asChild size="sm">
              <Link href="/console/opportunities">Go to opportunities</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const rows: GranteeRow[] = data.rows.map((r) => ({
    id: r.id,
    name: r.dba_name || r.legal_name,
    legalName: r.legal_name,
    ein: r.ein,
    applications: Number(r.applications),
    activeAwards: Number(r.active_awards),
    awardedCents: Number(r.awarded_cents),
    latestStatus: r.latest_status,
    diligence: r.diligence_status,
    screening: r.screening_status,
    tags: r.tags ?? [],
    owner: r.owner_name,
  }));
  return (
    <div className="grid gap-4">
      {header}
      <GranteesTable rows={rows} state={{ page: tp.page, pageSize: tp.pageSize, sort: tp.sort, dir: tp.dir, q: tp.q }} totalRows={Number(data.rows[0]?.total ?? 0)} tags={data.tags} tag={tag} active={activeOnly} />
    </div>
  );
}
