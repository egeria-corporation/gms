// SPDX-License-Identifier: AGPL-3.0-only
// S-04 AI agents & policy (states: key-created, empty).
import { actionAudience, listActions } from '@gms/actions';
import { formatInZone, ROLE_LABELS, SCOPES, STAFF_ROLES, type Scope, type WorkspaceRole } from '@gms/domain';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import { Check, ExternalLink, PlugZap, X } from 'lucide-react';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { AgentAccounts, type AgentAccountRow } from '@/components/console/admin/agents/agent-accounts';
import { AgentStatusChip } from '@/components/console/admin/agents/agent-status';
import { AiPolicyForm, type AiPolicy } from '@/components/console/admin/agents/ai-policy-form';
import { ModelKeyForm } from '@/components/console/admin/agents/model-key-form';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'AI agents & policy' };

const PREVIEW_KEY = 'gms_ak_4fT9sQwLk2Rz8VbN1mXcYp6HdJ0eGuA3';

export default async function AgentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';

  const d = await rls(async (trx) => {
    const [accounts, staff, grants, policy] = await Promise.all([
      trx
        .selectFrom('agent_clients as c')
        .leftJoin('profiles as p', 'p.id', 'c.owner_user_id')
        .select([
          'c.id',
          'c.name',
          'c.client_id',
          'c.scopes',
          'c.tool_allowlist',
          'c.rate_limit_per_min',
          'c.status',
          'c.created_at',
          'p.full_name',
          'p.email',
        ])
        .where('c.workspace_id', '=', tenant.id)
        .where('c.kind', '=', 'agent_account')
        .orderBy('c.created_at', 'desc')
        .execute(),
      trx
        .selectFrom('workspace_members as m')
        .leftJoin('profiles as p', 'p.id', 'm.user_id')
        .select(['m.user_id', 'm.role', 'p.full_name', 'p.email'])
        .where('m.workspace_id', '=', tenant.id)
        .where('m.status', '=', 'active')
        .where('m.role', 'in', [...STAFF_ROLES])
        .orderBy('p.full_name')
        .execute(),
      trx
        .selectFrom('agent_grants as g')
        .innerJoin('agent_clients as c', 'c.id', 'g.client_id')
        .leftJoin('profiles as p', 'p.id', 'g.user_id')
        .select([
          'g.id',
          'g.scopes',
          'g.status',
          'g.expires_at',
          'g.last_used_at',
          'g.created_at',
          'c.name as client_name',
          'c.kind as client_kind',
          'p.full_name',
          'p.email',
        ])
        .where('g.workspace_id', '=', tenant.id)
        .orderBy('g.created_at', 'desc')
        .limit(100)
        .execute(),
      trx
        // llm_key_ref is never readable by request roles (column grant), so "a key is saved" is inferred from the provider.
        .selectFrom('agent_policies')
        .select([
          'ai_use',
          'disclosure_prompt',
          'reviewer_assist',
          'agent_submissions_enabled',
          'mcp_enabled',
          'a2a_enabled',
          'llm_provider',
        ])
        .where('workspace_id', '=', tenant.id)
        .executeTakeFirst(),
    ]);
    const ids = accounts.map((a) => a.id);
    const keys = ids.length
      ? await trx
          .selectFrom('api_keys')
          .select(['agent_client_id', 'prefix'])
          .where('workspace_id', '=', tenant.id)
          .where('agent_client_id', 'in', ids)
          .where('revoked_at', 'is', null)
          .execute()
      : [];
    return { accounts, staff, grants, policy, keys };
  });

  const keyByClient = new Map(d.keys.map((k) => [k.agent_client_id, k.prefix]));
  const accounts: AgentAccountRow[] =
    forced === 'empty'
      ? []
      : d.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          clientId: a.client_id,
          ownerName: a.full_name ?? a.email,
          scopes: a.scopes,
          toolAllowlist: a.tool_allowlist,
          rateLimitPerMin: a.rate_limit_per_min,
          status: a.status,
          createdAt: a.created_at,
          keyPrefix: keyByClient.get(a.id) ?? null,
        }));
  const grants = forced === 'empty' ? [] : d.grants;
  const staff = d.staff.map((s) => ({
    id: s.user_id,
    name: s.full_name ?? s.email ?? 'Team member',
    roleLabel: ROLE_LABELS[s.role as WorkspaceRole] ?? s.role,
  }));
  const tools = listActions()
    .filter((a) => actionAudience(a) === 'staff' && a.riskTier !== 'R3')
    .map((a) => ({ id: a.id, title: a.title, tier: a.riskTier }));
  const policy: AiPolicy = {
    aiUse:
      d.policy?.ai_use === 'disclosure' || d.policy?.ai_use === 'prohibited' ? d.policy.ai_use : 'allowed',
    disclosurePrompt: d.policy?.disclosure_prompt ?? '',
    reviewerAssist: d.policy?.reviewer_assist ?? false,
    agentSubmissionsEnabled: d.policy?.agent_submissions_enabled ?? true,
    mcpEnabled: d.policy?.mcp_enabled ?? true,
    a2aEnabled: d.policy?.a2a_enabled ?? true,
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title="AI agents & policy"
        description="Who can act in GMS through software, what they may do, and your foundation’s rules for AI use."
      />
      <SettingsTabs current="/console/settings/agents" />

      <Section
        title="Agent accounts"
        description="Foundation-owned agents with their own key, an owner, permissions, a tool allowlist and a rate limit."
      >
        <AgentAccounts
          accounts={accounts}
          staff={staff}
          tools={tools}
          timeZone={tenant.timezone}
          canEdit={canEdit}
          previewKey={forced === 'key-created' && canEdit ? PREVIEW_KEY : null}
        />
      </Section>

      <Section
        title="Connected apps"
        description="AI tools that people signed in to with “Sign in with GMS”. Each person manages their own connections from their account page."
      >
        {grants.length ? (
          <Table containerLabel="Connected apps">
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Allowed by</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.client_name}</TableCell>
                  <TableCell>{g.full_name ?? g.email ?? '—'}</TableCell>
                  <TableCell>
                    <ul
                      className="flex max-w-sm flex-wrap gap-1"
                      aria-label={`Permissions for ${g.client_name}`}
                    >
                      {g.scopes.map((s) => (
                        <li key={s}>
                          <Badge variant="neutral" title={SCOPES[s as Scope]?.label ?? s}>
                            {s}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <AgentStatusChip status={g.status} expiresAt={g.expires_at} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {g.expires_at ? formatInZone(g.expires_at, tenant.timezone, { dateOnly: true }) : 'Never'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {g.last_used_at ? formatInZone(g.last_used_at, tenant.timezone) : 'Not used yet'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            level={3}
            icon={PlugZap}
            title="No connected apps"
            description="When someone allows an AI tool to act for them in this workspace, it shows up here with exactly what it can do."
          />
        )}
      </Section>

      <Section
        title="AI-use policy"
        description="Applies to every opportunity. Applicants see it before they start."
        card
      >
        <AiPolicyForm policy={policy} canEdit={canEdit} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Agent Card & guides
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <p className="text-muted-foreground">
              What agents read to learn how to work with {tenant.brand.displayName}. They reflect the policy
              above.
            </p>
            <ul className="grid gap-2">
              {[
                { href: '/.well-known/agent-card.json', label: 'Agent Card (A2A)', note: 'agent-card.json' },
                { href: '/agents.md', label: 'Agent guide', note: 'agents.md' },
                { href: '/llms.txt', label: 'LLM index', note: 'llms.txt' },
              ].map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 font-medium text-link underline underline-offset-4"
                  >
                    {l.label}
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{l.note}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <h3 className="font-medium">Agents can</h3>
                <ul className="grid gap-1">
                  {[
                    'Read what their permissions allow',
                    'Draft applications, reviews, awards and messages',
                    'Propose payment batches and bulk sends',
                    'Ask a person to confirm consequential steps (R2)',
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-success-fg" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-1.5">
                <h3 className="font-medium">Agents never</h3>
                <ul className="grid gap-1">
                  {[
                    'Approve or send payments',
                    'Record final decisions or sign agreements',
                    'Change roles, keys or bank details',
                    'Take any people-only (R3) action',
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-danger-fg" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Model provider key
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Optional. Built-in assistants (reviewer assist, summaries) use your own Anthropic or
              OpenAI-compatible key. People only: we check your authenticator first.
            </p>
            <ModelKeyForm
              savedProvider={d.policy?.llm_provider ?? null}
              hasKey={Boolean(d.policy?.llm_provider)}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
