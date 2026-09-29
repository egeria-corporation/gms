// SPDX-License-Identifier: AGPL-3.0-or-later
// B-14 Agent confirmation (full preview + attestation; confirm / reject / expired; mobile; opened from email).
import type { RiskTier } from '@gms/domain';
import { Alert, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ConfirmDecision, type ConfirmView } from './decision';

export const metadata: Metadata = { title: 'Confirm a request' };

export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { id } = await params;
  const sp = await searchParams;
  const req = await rls((trx) =>
    trx
      .selectFrom('approval_requests as r')
      .leftJoin('agent_clients as c', 'c.id', 'r.requested_by_client_id')
      .leftJoin('profiles as p', 'p.id', 'r.on_behalf_of')
      .select(['r.id', 'r.action_id', 'r.preview', 'r.risk_tier', 'r.requester_name', 'r.status', 'r.expires_at', 'r.created_at', 'r.entity_type', 'r.entity_id', 'r.on_behalf_of', 'c.name as client_name', 'p.full_name'])
      .where('r.id', '=', id)
      .where('r.workspace_id', '=', tenant.id)
      .executeTakeFirst(),
  );
  if (!req) notFound();
  const forced = forcedState(sp);
  const expired = forced === 'expired' || (req.status === 'awaiting_confirmation' && new Date(req.expires_at) < new Date());
  const preview = req.preview as { title?: string; summary?: string; fields?: { label: string; value: string }[]; quotedContent?: { label: string; text: string }[]; attestation?: string };
  const view: ConfirmView = {
    id: req.id,
    title: preview.title ?? req.action_id,
    summary: preview.summary ?? '',
    requester: { name: req.client_name ?? req.requester_name, onBehalfOfName: req.full_name },
    requestedAt: req.created_at,
    expiresAt: req.expires_at,
    timeZone: tenant.timezone,
    risk: req.risk_tier as RiskTier,
    changes: (preview.fields ?? []).map((f) => ({ field: f.label, after: f.value })),
    applicantSupplied: preview.quotedContent ?? [],
    attestation: preview.attestation ?? null,
    status: expired ? 'expired' : forced && ['confirmed', 'rejected'].includes(forced) ? forced : req.status,
    entityHref: req.entity_type === 'application' && req.entity_id ? `/portal/applications/${req.entity_id}` : null,
  };
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 pb-16">
      <PageHeader
        density="spacious"
        title="An AI agent is asking for your OK"
        description="Read exactly what it wants to do. Nothing happens unless you confirm here."
      />
      {req.on_behalf_of !== viewer.userId ? (
        <Alert variant="warning" title="This request is for someone else">
          Only the person the agent is acting for can confirm it. Sign in with that account.
        </Alert>
      ) : expired ? (
        <Alert variant="info" title="This request expired">
          Requests last 72 hours. Nothing was changed. Ask the agent to try again if you still want this.
        </Alert>
      ) : null}
      <ConfirmDecision view={view} token={one(sp.t) ?? null} />
    </div>
  );
}
