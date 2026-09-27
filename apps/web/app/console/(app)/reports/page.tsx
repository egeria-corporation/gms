// SPDX-License-Identifier: AGPL-3.0-only
// PA-01 Report due tracker: every report requirement, overdue first, with filters, the per-report payment
// hold and the award hold. ?state= (non-production): overdue · hold · empty · error
import { sql } from '@gms/db';
import { REPORT_STATUS } from '@gms/domain';
import { Alert, ErrorState, PageHeader, StatTile } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { can, likeTerm, oneOf, paging, PROGRAM_READ, PROGRAM_WRITE, str, todayIn, type SearchParams } from '@/components/console/finance/params';
import { ReportsTable, type ReportRow } from '@/components/console/finance/reports-table';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Reports' };

const STATUSES = Object.keys(REPORT_STATUS) as (keyof typeof REPORT_STATUS)[];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(PROGRAM_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = oneOf(sp, 'status', STATUSES);
  const programRaw = str(sp, 'program');
  const program = programRaw && /^[0-9a-f-]{36}$/i.test(programRaw) ? programRaw : undefined;
  const q = str(sp, 'q')?.slice(0, 100);
  const header = <PageHeader title="Reports" description="Grant reports by due date. Overdue reports come first; accept or request revisions from each report." />;
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load reports" description="Refresh to try again." />
      </div>
    );
  }
  const today = todayIn(tenant.timezone);
  const d = await rls(async (trx) => {
    let base = trx
      .selectFrom('report_requirements as r')
      .innerJoin('awards as a', 'a.id', 'r.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('programs as p', 'p.id', 'a.program_id')
      .where('r.workspace_id', '=', tenant.id);
    if (status) base = base.where('r.status', '=', status);
    if (program) base = base.where('a.program_id', '=', program);
    if (q) base = base.where((eb) => eb.or([eb('a.reference', 'ilike', likeTerm(q)), eb('o.legal_name', 'ilike', likeTerm(q)), eb('r.title', 'ilike', likeTerm(q))]));
    const [rows, count, counts, programs, settings] = await Promise.all([
      base
        .select(['r.id', 'r.title', 'r.kind', 'r.due_date', 'r.status', 'r.holds_payments', 'a.id as award_id', 'a.reference', 'a.on_hold', 'a.hold_reason', 'o.legal_name', 'p.name as program_name'])
        .orderBy(sql`case r.status when 'overdue' then 0 when 'submitted' then 1 when 'revisions_requested' then 2 when 'due' then 3 when 'upcoming' then 4 else 5 end`)
        .orderBy('r.due_date')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      trx.selectFrom('report_requirements').select(['status', sql<number>`count(*)::int`.as('n')]).where('workspace_id', '=', tenant.id).groupBy('status').execute(),
      trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
      trx.selectFrom('workspace_settings').select('overdue_report_hold').where('workspace_id', '=', tenant.id).executeTakeFirst(),
    ]);
    return { rows, total: Number(count?.n ?? 0), counts, programs, holdSetting: settings?.overdue_report_hold ?? true };
  });
  const daysLate = (due: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000));
  const rows: ReportRow[] =
    forced === 'empty'
      ? []
      : d.rows.map((r) => {
          const st = forced === 'overdue' && ['upcoming', 'due', 'revisions_requested'].includes(r.status) ? 'overdue' : r.status;
          return {
            id: r.id,
            title: r.title,
            kind: r.kind,
            dueDate: r.due_date,
            status: st,
            holdsPayments: forced === 'hold' ? true : r.holds_payments,
            awardId: r.award_id,
            awardReference: r.reference,
            grantee: r.legal_name ?? '—',
            program: r.program_name,
            awardOnHold: forced === 'hold' ? true : r.on_hold,
            holdReason: forced === 'hold' ? 'Final report is 45 days overdue.' : r.hold_reason,
            daysLate: st === 'overdue' ? Math.max(1, daysLate(r.due_date)) : 0,
          };
        });
  const n = (s: string) => Number(d.counts.find((c) => c.status === s)?.n ?? 0);
  const overdueCount = forced === 'overdue' ? n('overdue') + n('upcoming') + n('due') + n('revisions_requested') : n('overdue');

  return (
    <div className="grid gap-6">
      {header}
      <section aria-label="Report summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Overdue" value={overdueCount} action={<Link className="text-link underline" href="/console/reports?status=overdue">Show overdue</Link>} />
        <StatTile label="Submitted — to review" value={n('submitted')} action={<Link className="text-link underline" href="/console/reports?status=submitted">Review</Link>} />
        <StatTile label="Due in 30 days" value={n('due')} />
        <StatTile label="Revisions requested" value={n('revisions_requested')} />
      </section>
      <Alert variant={d.holdSetting ? 'info' : 'warning'} title={d.holdSetting ? 'Overdue reports hold payments' : 'Overdue reports don’t hold payments'}>
        {d.holdSetting
          ? 'When a report is overdue, the batch builder blocks that grant’s payments until the report comes in. Each report’s switch records whether it should hold payments; you can also put a whole award on hold.'
          : 'Your workspace setting lets payments continue when reports are overdue. You can still put an award on hold.'}
      </Alert>
      <ReportsTable
        rows={rows}
        total={forced === 'empty' ? 0 : d.total}
        page={page}
        pageSize={pageSize}
        filters={{ status, program, q }}
        programs={d.programs}
        canWriteReports={can(viewer.role, PROGRAM_WRITE)}
        canHoldAwards={can(viewer.role, [...PROGRAM_WRITE, 'finance'])}
      />
    </div>
  );
}
