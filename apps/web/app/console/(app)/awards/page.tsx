// SPDX-License-Identifier: AGPL-3.0-only
// Awards list with status and flag chips (Agreement pending, On hold, Report overdue).
// ?state= (non-production): flags · empty · error
import { sql } from '@gms/db';
import { AWARD_FLAGS, AWARD_STATUS } from '@gms/domain';
import { ErrorState, MoneyDisplay, PageHeader, StatTile } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AwardsTable, type AwardRow } from '@/components/console/finance/awards-table';
import { AWARDS_READ, likeTerm, oneOf, paging, str, type SearchParams } from '@/components/console/finance/params';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Awards' };

const STATUSES = Object.keys(AWARD_STATUS) as (keyof typeof AWARD_STATUS)[];
const FLAGS = Object.keys(AWARD_FLAGS) as (keyof typeof AWARD_FLAGS)[];

export default async function AwardsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(AWARDS_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = oneOf(sp, 'status', STATUSES);
  const flag = oneOf(sp, 'flag', FLAGS);
  const programRaw = str(sp, 'program');
  const program = programRaw && /^[0-9a-f-]{36}$/i.test(programRaw) ? programRaw : undefined;
  const q = str(sp, 'q')?.slice(0, 100);
  const header = <PageHeader title="Awards" description="Every grant: its amount, what has been paid, and anything holding it up." />;
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load awards" description="Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    let base = trx
      .selectFrom('awards as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('programs as p', 'p.id', 'a.program_id')
      .where('a.workspace_id', '=', tenant.id)
      .where('a.kind', '=', 'original');
    if (status) base = base.where('a.status', '=', status);
    if (flag === 'agreement_pending') base = base.where('a.agreement_pending', '=', true).where('a.status', '=', 'active');
    if (flag === 'on_hold') base = base.where('a.on_hold', '=', true);
    if (flag === 'report_overdue') base = base.where('a.report_overdue', '=', true);
    if (program) base = base.where('a.program_id', '=', program);
    if (q) base = base.where((eb) => eb.or([eb('a.reference', 'ilike', likeTerm(q)), eb('a.title', 'ilike', likeTerm(q)), eb('o.legal_name', 'ilike', likeTerm(q))]));
    const [rows, count, programs, totals] = await Promise.all([
      base
        .select([
          'a.id',
          'a.reference',
          'a.title',
          'o.legal_name',
          'p.name as program_name',
          'a.amount_cents',
          'a.disbursed_cents',
          'a.currency',
          'a.status',
          'a.agreement_pending',
          'a.on_hold',
          'a.report_overdue',
          'a.start_date',
          'a.end_date',
        ])
        .select((eb) =>
          eb
            .selectFrom('awards as c')
            .select(sql<number>`coalesce(sum(c.amount_cents), 0)::bigint`.as('s'))
            .whereRef('c.parent_award_id', '=', 'a.id')
            .where('c.amendment_status', '=', 'approved')
            .as('amended_cents'),
        )
        .orderBy(sql`case a.status when 'draft' then 0 when 'active' then 1 else 2 end`)
        .orderBy('a.created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
      trx
        .selectFrom('awards')
        .select([
          sql<number>`count(*) filter (where status = 'active')::int`.as('active'),
          sql<number>`coalesce(sum(amount_cents) filter (where status = 'active'), 0)::bigint`.as('committed'),
          sql<number>`coalesce(sum(disbursed_cents) filter (where status = 'active'), 0)::bigint`.as('paid'),
          sql<number>`count(*) filter (where on_hold or report_overdue or (agreement_pending and status = 'active'))::int`.as('flagged'),
        ])
        .where('workspace_id', '=', tenant.id)
        .where('kind', '=', 'original')
        .executeTakeFirst(),
    ]);
    return { rows, total: Number(count?.n ?? 0), programs, totals };
  });
  const rows: AwardRow[] =
    forced === 'empty'
      ? []
      : d.rows.map((r, i) => ({
          id: r.id,
          reference: r.reference,
          title: r.title,
          grantee: r.legal_name ?? '—',
          program: r.program_name,
          amountCents: r.amount_cents,
          totalCents: r.amount_cents + Number(r.amended_cents ?? 0),
          disbursedCents: r.disbursed_cents,
          currency: r.currency,
          status: forced === 'flags' && r.status === 'draft' ? 'active' : r.status,
          agreementPending: forced === 'flags' ? i % 3 === 0 || r.agreement_pending : r.agreement_pending,
          onHold: forced === 'flags' ? i % 3 === 1 || r.on_hold : r.on_hold,
          reportOverdue: forced === 'flags' ? i % 3 === 2 || r.report_overdue : r.report_overdue,
          startDate: r.start_date,
          endDate: r.end_date,
        }));
  const t = d.totals;
  return (
    <div className="grid gap-6">
      {header}
      <section aria-label="Award summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active awards" value={Number(t?.active ?? 0)} />
        <StatTile label="Committed (active)" value={<MoneyDisplay cents={Number(t?.committed ?? 0)} short />} />
        <StatTile label="Paid on active awards" value={<MoneyDisplay cents={Number(t?.paid ?? 0)} short />} />
        <StatTile label="Need attention" value={Number(t?.flagged ?? 0)} footnote="On hold, report overdue or agreement pending" action={<Link className="text-link underline" href="/console/awards?flag=on_hold">Show held</Link>} />
      </section>
      <AwardsTable rows={rows} total={forced === 'empty' ? 0 : d.total} page={page} pageSize={pageSize} filters={{ status, flag, program, q }} programs={d.programs} />
    </div>
  );
}
