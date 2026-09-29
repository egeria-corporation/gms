// SPDX-License-Identifier: AGPL-3.0-or-later
// B-13 Connected agents (applicant): list, scopes, activity, pause, revoke.
import { formatInZone } from '@gms/domain';
import { ActorBadge, PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';
import { AgentsManager, type AgentConnection } from './agents-manager';

export const metadata: Metadata = { title: 'Connected agents' };

export default async function AgentsPage() {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { tokens, grants, activity } = await rls(async (trx) => {
    const tokens = await trx
      .selectFrom('personal_access_tokens as t')
      .leftJoin('agent_clients as c', 'c.id', 't.agent_client_id')
      .select(['t.id', 't.name', 't.scopes', 't.created_at', 't.expires_at', 't.last_used_at', 't.revoked_at', 'c.status as client_status', 'c.kind'])
      .where('t.user_id', '=', viewer.userId)
      .where((eb) => eb.or([eb('c.kind', '=', 'pat_client'), eb('c.kind', 'is', null)]))
      .orderBy('t.created_at', 'desc')
      .execute();
    const grants = await trx
      .selectFrom('agent_grants as g')
      .innerJoin('agent_clients as c', 'c.id', 'g.client_id')
      .select(['g.id', 'c.name', 'g.scopes', 'g.status', 'g.created_at', 'g.expires_at', 'g.last_used_at'])
      .where('g.user_id', '=', viewer.userId)
      .orderBy('g.created_at', 'desc')
      .execute();
    const activity = await trx
      .selectFrom('approval_requests')
      .select(['id', 'requester_name', 'preview', 'status', 'created_at'])
      .where('on_behalf_of', '=', viewer.userId)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    return { tokens, grants, activity };
  });
  const now = new Date();
  const connections: AgentConnection[] = [
    ...tokens.map((t) => ({
      kind: 'token' as const,
      id: t.id,
      name: t.name,
      scopes: t.scopes,
      status: (t.revoked_at ? 'revoked' : t.expires_at && new Date(t.expires_at) < now ? 'expired' : t.client_status === 'paused' ? 'paused' : 'active') as AgentConnection['status'],
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      lastUsedAt: t.last_used_at,
    })),
    ...grants.map((g) => ({
      kind: 'grant' as const,
      id: g.id,
      name: g.name,
      scopes: g.scopes,
      status: (g.status === 'revoked' ? 'revoked' : g.expires_at && new Date(g.expires_at) < now ? 'expired' : g.status) as AgentConnection['status'],
      createdAt: g.created_at,
      expiresAt: g.expires_at,
      lastUsedAt: g.last_used_at,
    })),
  ];
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-10 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Account', href: '/portal/account' }, { label: 'Connected agents' }]}
        title="Connected agents"
        description="AI tools you’ve allowed to help with your applications. They can only do what you allowed, and they always ask you before submitting anything."
      />
      <Section title="Agents with access">
        <AgentsManager connections={connections} timeZone={tenant.timezone} />
      </Section>
      <Section title="Recent requests from agents">
        {activity.length ? (
          <ul className="grid gap-2">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm">
                <span className="grid gap-1">
                  <ActorBadge actor={{ type: 'agent', name: a.requester_name, onBehalfOfName: viewer.name }} size="sm" />
                  <span>{(a.preview as { title?: string }).title}</span>
                </span>
                <span className="text-muted-foreground">
                  {a.status.replace(/_/g, ' ')} · {formatInZone(a.created_at, tenant.timezone)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        )}
      </Section>
    </div>
  );
}
