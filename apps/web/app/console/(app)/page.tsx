// SPDX-License-Identifier: AGPL-3.0-or-later
// C-01 Console home: my tasks, deadlines, pipeline snapshot, payments awaiting approval, overdue reports,
// agent approvals; a checklist for new workspaces.
import { APPLICATION_STATUS, formatDateOnly, formatMoneyShort, type ApplicationStatus } from '@gms/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DeadlineChip, EmptyState, MoneyDisplay, PageHeader, StatTile, StatusChip } from '@gms/ui';
import { CheckCircle2, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from '@gms/db';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Console' };

export default async function ConsoleHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const forced = forcedState(await searchParams);
  const today = new Date().toISOString().slice(0, 10);
  const d = await rls(async (trx) => {
    const [pipeline, toScreen, closing, overdue, batches, approvals, setup, committed] = await Promise.all([
      trx.selectFrom('applications').select(['status', sql<number>`count(*)::int`.as('n')]).where('workspace_id', '=', tenant.id).groupBy('status').execute(),
      trx
        .selectFrom('applications as a')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['a.id', 'a.reference_number', 'a.title', 'a.submitted_at', 'g.legal_name', 'a.created_via', 'a.submitted_via'])
        .where('a.workspace_id', '=', tenant.id)
        .where('a.status', '=', 'submitted')
        .orderBy('a.submitted_at')
        .limit(6)
        .execute(),
      trx.selectFrom('opportunities').select(['id', 'title', 'closes_at', 'status']).where('workspace_id', '=', tenant.id).where('status', 'in', ['open', 'forecasted']).orderBy('closes_at').limit(5).execute(),
      trx
        .selectFrom('report_requirements as r')
        .innerJoin('awards as a', 'a.id', 'r.award_id')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['r.id', 'r.title', 'r.due_date', 'r.status', 'a.id as award_id', 'a.reference', 'g.legal_name'])
        .where('r.workspace_id', '=', tenant.id)
        .where((eb) => eb.or([eb('r.status', '=', 'overdue'), eb('r.status', '=', 'submitted')]))
        .orderBy('r.due_date')
        .limit(6)
        .execute(),
      viewer.role && ['owner', 'admin', 'finance', 'auditor'].includes(viewer.role)
        ? trx.selectFrom('payment_batches').select(['id', 'name', 'total_cents', 'status', 'created_by', 'requires_second_approval']).where('workspace_id', '=', tenant.id).where('status', '=', 'awaiting_approval').execute()
        : Promise.resolve([]),
      trx.selectFrom('approval_requests').select(['id', 'requester_name', 'preview', 'audience', 'created_at']).where('workspace_id', '=', tenant.id).where('status', '=', 'awaiting_confirmation').where('audience', '=', 'staff').orderBy('created_at', 'desc').limit(5).execute(),
      Promise.all([
        trx.selectFrom('programs').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst(),
        trx.selectFrom('opportunities').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst(),
        trx.selectFrom('workspace_members').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst(),
        trx.selectFrom('bank_connections').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst().catch(() => ({ n: 0 })),
        trx.selectFrom('workspace_brand').select('version').where('workspace_id', '=', tenant.id).executeTakeFirst(),
      ]),
      trx.selectFrom('awards').select([sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('c'), sql<number>`coalesce(sum(disbursed_cents),0)::bigint`.as('p')]).where('workspace_id', '=', tenant.id).where('kind', '=', 'original').where('status', '=', 'active').executeTakeFirst(),
    ]);
    return { pipeline, toScreen, closing, overdue, batches, approvals, setup, committed };
  });
  const counts = Object.fromEntries(d.pipeline.map((p) => [p.status, Number(p.n)])) as Partial<Record<ApplicationStatus, number>>;
  const [programs, opps, members, bank, brand] = d.setup;
  const checklist = [
    { done: (brand?.version ?? 1) > 1, label: 'Set your branding', href: '/console/settings/branding' },
    { done: Number(programs?.n ?? 0) > 0, label: 'Create a program', href: '/console/programs' },
    { done: Number(opps?.n ?? 0) > 0, label: 'Publish your first opportunity', href: '/console/opportunities/new' },
    { done: Number(members?.n ?? 0) > 1, label: 'Invite your team', href: '/console/settings/team' },
    { done: Number(bank?.n ?? 0) > 0, label: 'Connect your bank (or choose to pay outside GMS)', href: '/console/payments/connect' },
  ];
  const showChecklist = forced === 'new-workspace' || checklist.some((c) => !c.done);

  return (
    <div className="grid gap-6">
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${viewer.name.split(' ')[0]}`} description={`${tenant.brand.displayName} · ${new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: tenant.timezone }).format(new Date())}`} />

      {showChecklist ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Get your workspace ready
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {(forced === 'new-workspace' ? checklist.map((c) => ({ ...c, done: false })) : checklist).map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex h-full items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted">
                    {c.done ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-status-success-fg" /> : <Circle aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
                    <span className={c.done ? 'text-muted-foreground line-through' : ''}>
                      {c.label}
                      <span className="sr-only">{c.done ? ' (done)' : ' (to do)'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Pipeline snapshot" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(['in_progress', 'submitted', 'under_review', 'invited_to_next_stage', 'awarded'] as ApplicationStatus[]).map((s) => (
          <StatTile key={s} label={APPLICATION_STATUS[s].label} value={counts[s] ?? 0} action={<Link className="text-xs text-link underline" href={`/console/pipeline?status=${s}`}>View</Link>} />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle as="h2" className="text-base">
              Waiting for screening
            </CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/console/pipeline?status=submitted">Open pipeline</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.toScreen.length ? (
              <ul className="grid gap-2">
                {d.toScreen.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/console/applications/${a.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {a.title ?? a.reference_number}
                      <span className="block truncate text-xs font-normal text-muted-foreground">{a.legal_name}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      {a.submitted_via === 'agent' ? <Badge variant="agent">Via agent</Badge> : null}
                      <span className="text-xs text-muted-foreground">{a.submitted_at ? formatDateOnly(a.submitted_at.slice(0, 10)) : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState variant="inline" level={3} title="Nothing waiting" description="New submissions show up here." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.closing.length ? (
              <ul className="grid gap-2">
                {d.closing.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/console/opportunities/${o.id}`} className="font-medium hover:underline">
                      {o.title}
                    </Link>
                    {o.closes_at ? <DeadlineChip at={o.closes_at} timeZone={tenant.timezone} label="Closes" /> : <StatusChip kind="opportunity" value={o.status} size="sm" />}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState variant="inline" level={3} title="No open opportunities" action={<Button asChild size="sm"><Link href="/console/opportunities/new">Create one</Link></Button>} />
            )}
          </CardContent>
        </Card>

        {viewer.role && ['owner', 'admin', 'finance', 'auditor'].includes(viewer.role) ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Payments awaiting approval
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.batches.length ? (
                <ul className="grid gap-2">
                  {d.batches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/console/payments/batches/${b.id}`} className="font-medium hover:underline">
                        {b.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        {b.created_by === viewer.userId ? <Badge variant="neutral">You created this</Badge> : null}
                        <MoneyDisplay cents={b.total_cents} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No batches are waiting. Grants paid this year: {formatMoneyShort(Number(d.committed?.p ?? 0))} of {formatMoneyShort(Number(d.committed?.c ?? 0))} committed.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Reports needing attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.overdue.length ? (
              <ul className="grid gap-2">
                {d.overdue.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/console/reports/${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {r.title}
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {r.legal_name} · {r.reference}
                      </span>
                    </Link>
                    <StatusChip kind="report" value={r.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No overdue or submitted reports.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Agent requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.approvals.length ? (
              <ul className="grid gap-2">
                {d.approvals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/console/approvals/${a.id}`} className="font-medium hover:underline">
                      {(a.preview as { title?: string }).title ?? 'Request'}
                    </Link>
                    <Badge variant="agent">{a.requester_name}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No agent requests waiting.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Today is {today} (UTC).</p>
    </div>
  );
}
