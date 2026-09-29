// SPDX-License-Identifier: AGPL-3.0-or-later
// S-05 Approval inbox: agent requests for staff (and ones made on the viewer's behalf) with confirm / reject,
// plus payment batches waiting for the viewer's approval. Mobile friendly (states: empty).
import { EmptyState, MoneyDisplay, PageHeader, Section, StatusChip, Badge } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ApprovalCard } from './approval-card';
import { toApprovalView, type ApprovalRow } from './shared';

export const metadata: Metadata = { title: 'Approvals' };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const forced = forcedState(await searchParams);
  const financeApprover = viewer.role === 'owner' || viewer.role === 'admin' || viewer.role === 'finance';
  const data = await rls(async (trx) => {
    const base = trx
      .selectFrom('approval_requests as r')
      .leftJoin('agent_clients as c', 'c.id', 'r.requested_by_client_id')
      .leftJoin('profiles as p', 'p.id', 'r.on_behalf_of')
      .leftJoin('profiles as d', 'd.id', 'r.decided_by')
      .select(['r.id', 'r.action_id', 'r.preview', 'r.risk_tier', 'r.requester_name', 'r.status', 'r.audience', 'r.expires_at', 'r.created_at', 'r.decided_at', 'r.entity_type', 'r.entity_id', 'r.on_behalf_of', 'r.result', 'c.name as client_name', 'p.full_name as on_behalf_name', 'd.full_name as decided_by_name'])
      .where('r.workspace_id', '=', tenant.id)
      .where((eb) => eb.or([eb('r.audience', '=', 'staff'), eb('r.on_behalf_of', '=', viewer.userId)]));
    const [waiting, recent, batches] = await Promise.all([
      base.where('r.status', '=', 'awaiting_confirmation').orderBy('r.created_at', 'asc').limit(50).execute(),
      base.where('r.status', '!=', 'awaiting_confirmation').orderBy('r.decided_at', 'desc').limit(10).execute(),
      financeApprover
        ? trx
            .selectFrom('payment_batches as b')
            .leftJoin('profiles as p', 'p.id', 'b.created_by')
            .select(['b.id', 'b.name', 'b.total_cents', 'b.status', 'b.created_at', 'b.created_by', 'b.requires_second_approval', 'b.approved_by', 'b.created_by_agent_client_id', 'p.full_name as creator'])
            .where('b.workspace_id', '=', tenant.id)
            .where('b.status', '=', 'awaiting_approval')
            .orderBy('b.created_at')
            .execute()
        : Promise.resolve([]),
    ]);
    return { waiting, recent, batches };
  });
  const now = new Date();
  const views = forced === 'empty' ? [] : data.waiting.map((r) => toApprovalView(r as ApprovalRow, viewer, now));
  const open = views.filter((v) => v.status === 'awaiting_confirmation');
  const lapsed = views.filter((v) => v.status !== 'awaiting_confirmation');
  const decided = forced === 'empty' ? [] : [...lapsed, ...data.recent.map((r) => toApprovalView(r as ApprovalRow, viewer, now))];
  // Maker-checker: people never approve batches they created; a first approver can't give the second approval.
  const batches = forced === 'empty' ? [] : data.batches.filter((b) => b.created_by !== viewer.userId && b.approved_by !== viewer.userId);
  const total = open.length + batches.length;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        title="Approvals"
        description={total ? `${total} ${total === 1 ? 'item needs' : 'items need'} a person’s decision.` : 'Requests that need a person’s decision show up here.'}
      />
      {total === 0 ? (
        <EmptyState
          variant="page"
          title="You’re all caught up"
          description="When an AI agent asks to do something consequential, or a payment batch needs your approval, it appears here. Nothing happens until a person decides."
        />
      ) : null}

      {batches.length ? (
        <Section title="Payment batches waiting for you" description="Approve or reject each batch on its own page. Approving needs your authenticator code.">
          <ul className="grid gap-2">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/console/payments/batches/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-muted/50">
                  <span className="grid gap-1">
                    <span className="font-medium">{b.name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusChip kind="batch" value={b.status} size="sm" />
                      {b.approved_by ? <Badge variant="info">Needs second approval</Badge> : b.requires_second_approval ? <Badge variant="neutral">Two approvals required</Badge> : null}
                      {b.created_by_agent_client_id ? <Badge variant="agent">Proposed by an agent</Badge> : null}
                      <span>
                        Created by {b.creator ?? 'a teammate'} · {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: tenant.timezone }).format(new Date(b.created_at))}
                      </span>
                    </span>
                  </span>
                  <MoneyDisplay cents={b.total_cents} className="text-lg font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {open.length ? (
        <Section title="Agent requests" description="Read exactly what the agent wants to do. Confirming carries it out as the agent, recorded with your name.">
          <ul className="grid gap-4">
            {open.map((v) => (
              <li key={v.id}>
                <ApprovalCard view={v} timeZone={tenant.timezone} now={now.toISOString()} showLink />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {decided.length ? (
        <Section title="Recently decided" level={2}>
          <ul className="divide-y rounded-lg border bg-card">
            {decided.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <Link href={`/console/approvals/${v.id}`} className="min-w-0 font-medium hover:underline">
                  {v.title}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {v.requesterName}
                    {v.decidedByName ? ` · decided by ${v.decidedByName}` : ''}
                  </span>
                </Link>
                <StatusChip kind="agentAction" value={v.status} size="sm" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
