// SPDX-License-Identifier: AGPL-3.0-or-later
// S-05 Approval request detail (opened from the "approval needed" email or the inbox): full preview with
// confirm / reject for people allowed to decide (states: confirmed, rejected, expired).
import { Alert, Button, DescriptionList, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ApprovalCard } from '../approval-card';
import { toApprovalView, type ApprovalRow, type ApprovalView } from '../shared';

export const metadata: Metadata = { title: 'Approval request' };

export default async function ApprovalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { id } = await params;
  const forced = forcedState(await searchParams);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await rls((trx) =>
    trx
      .selectFrom('approval_requests as r')
      .leftJoin('agent_clients as c', 'c.id', 'r.requested_by_client_id')
      .leftJoin('profiles as p', 'p.id', 'r.on_behalf_of')
      .leftJoin('profiles as d', 'd.id', 'r.decided_by')
      .select(['r.id', 'r.action_id', 'r.preview', 'r.risk_tier', 'r.requester_name', 'r.status', 'r.audience', 'r.expires_at', 'r.created_at', 'r.decided_at', 'r.entity_type', 'r.entity_id', 'r.on_behalf_of', 'r.result', 'c.name as client_name', 'p.full_name as on_behalf_name', 'd.full_name as decided_by_name'])
      .where('r.id', '=', id)
      .where('r.workspace_id', '=', tenant.id)
      .executeTakeFirst(),
  );
  if (!row) notFound();
  const now = new Date();
  let view: ApprovalView = toApprovalView(row as ApprovalRow, viewer, now);
  if (forced === 'confirmed' || forced === 'rejected' || forced === 'expired') {
    view = { ...view, status: forced, decidedAt: forced === 'expired' ? null : (view.decidedAt ?? now.toISOString()), decidedByName: forced === 'expired' ? null : (view.decidedByName ?? viewer.name) };
  }
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(new Date(iso));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 pb-12">
      <PageHeader
        title="An AI agent is asking for a decision"
        description="Read exactly what it wants to do. Nothing happens unless a person confirms it here."
        breadcrumbs={[{ label: 'Approvals', href: '/console/approvals' }, { label: 'Request' }]}
        linkComponent={NextLink}
      />
      {view.status === 'expired' ? (
        <Alert variant="info" title="This request expired">
          Requests last 72 hours. Nothing was changed. The agent can ask again if it’s still needed.
        </Alert>
      ) : null}
      <ApprovalCard view={view} timeZone={tenant.timezone} now={now.toISOString()} />
      <DescriptionList
        items={[
          { term: 'Action', detail: <code className="text-xs">{view.actionId}</code> },
          { term: 'Requested by', detail: `${view.requesterName} (AI agent)` },
          { term: 'Acting for', detail: view.onBehalfOfName ?? '—' },
          { term: 'Who can decide', detail: view.audience === 'staff' ? 'Owners and admins, or the person the agent acts for' : 'Only the person the agent acts for' },
          { term: 'Requested', detail: fmt(view.requestedAt) },
          { term: view.status === 'awaiting_confirmation' ? 'Expires' : 'Decided', detail: view.status === 'awaiting_confirmation' || view.status === 'expired' ? fmt(view.expiresAt) : view.decidedAt ? `${fmt(view.decidedAt)}${view.decidedByName ? ` by ${view.decidedByName}` : ''}` : '—' },
        ]}
      />
      <Button asChild variant="ghost" className="justify-self-start">
        <Link href="/console/approvals">Back to approvals</Link>
      </Button>
    </div>
  );
}
