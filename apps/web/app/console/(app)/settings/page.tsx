// SPDX-License-Identifier: AGPL-3.0-only
// S-00 Workspace settings: name, timezone, public contact, about, fiscal year, scan requirement, overdue-report
// hold, second-approval threshold, transparency page; raising action risk tiers; time-boxed support access for
// platform operators (states: support-granted).
import { actionAudience, getRuntime, listActions } from '@gms/actions';
import type { RiskTier } from '@gms/domain';
import { PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { SupportAccess, type SupportGrantRow } from './support-access';
import { ActionTiers, type ActionTierRow } from './action-tiers';
import { WorkspaceForm } from './workspace-form';

export const metadata: Metadata = { title: 'Workspace settings' };

const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
];

export default async function WorkspaceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';
  const data = await rls(async (trx) => {
    const [ws, settings, grants] = await Promise.all([
      trx.selectFrom('workspaces').select(['name', 'timezone', 'public_contact_email', 'about_md', 'fiscal_year_start_month']).where('id', '=', tenant.id).executeTakeFirstOrThrow(),
      trx
        .selectFrom('workspace_settings')
        .select(['scan_required', 'overdue_report_hold', 'second_approval_threshold_cents', 'transparency_enabled', 'action_tier_overrides'])
        .where('workspace_id', '=', tenant.id)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom('support_access_grants as g')
        .leftJoin('profiles as p', 'p.id', 'g.granted_by')
        .select(['g.id', 'g.operator_user_id', 'g.reason', 'g.expires_at', 'g.revoked_at', 'g.created_at', 'p.full_name as granted_by_name'])
        .where('g.workspace_id', '=', tenant.id)
        .orderBy('g.created_at', 'desc')
        .limit(10)
        .execute(),
    ]);
    return { ws, settings, grants };
  });

  // Platform operators aren't visible to tenants under RLS; list them (name + email only) for admins choosing whom to grant.
  const operators = canEdit
    ? await getRuntime()
        .db.selectFrom('platform_operators as o')
        .innerJoin('profiles as p', 'p.id', 'o.user_id')
        .select(['o.user_id', 'p.full_name', 'p.email'])
        .orderBy('p.full_name')
        .execute()
    : [];
  const opName = new Map(operators.map((o) => [o.user_id, o.full_name || o.email]));
  const now = Date.now();
  let grants: SupportGrantRow[] = data.grants.map((g) => ({
    id: g.id,
    operator: opName.get(g.operator_user_id) ?? 'Platform operator',
    reason: g.reason,
    grantedBy: g.granted_by_name,
    createdAt: g.created_at,
    expiresAt: g.expires_at,
    active: !g.revoked_at && Date.parse(g.expires_at) > now,
    revokedAt: g.revoked_at,
  }));
  if (forced === 'support-granted' && !grants.some((g) => g.active)) {
    grants = [
      { id: 'preview-grant', operator: 'Opal Reyes (GMS support)', reason: 'Ticket 4821: payment batch stuck in “Submitting to bank”.', grantedBy: viewer.name, createdAt: new Date(now - 2 * 3600_000).toISOString(), expiresAt: new Date(now + 22 * 3600_000).toISOString(), active: true, revokedAt: null },
      ...grants,
    ];
  }

  const overrides = (data.settings.action_tier_overrides ?? {}) as Record<string, RiskTier>;
  const actions: ActionTierRow[] = listActions()
    .filter((a) => actionAudience(a) !== 'system')
    .map((a) => ({ id: a.id, title: a.title, tier: a.riskTier, override: overrides[a.id] ?? null, audience: actionAudience(a) }));
  const zones = COMMON_ZONES.includes(data.ws.timezone) ? COMMON_ZONES : [data.ws.timezone, ...COMMON_ZONES];

  return (
    <div className="grid gap-4">
      <PageHeader title="Workspace settings" description={`Settings for ${tenant.name}. Branding, team and integrations have their own tabs.`} />
      <SettingsTabs current="/console/settings" />
      <div className="grid gap-10">
        <WorkspaceForm
          initial={{
            name: data.ws.name,
            timezone: data.ws.timezone,
            publicContactEmail: data.ws.public_contact_email,
            aboutMd: data.ws.about_md,
            fiscalYearStartMonth: data.ws.fiscal_year_start_month,
            scanRequired: data.settings.scan_required,
            overdueReportHold: data.settings.overdue_report_hold,
            secondApprovalThresholdCents: data.settings.second_approval_threshold_cents,
            transparencyEnabled: data.settings.transparency_enabled,
          }}
          zones={zones}
          readOnly={!canEdit}
        />
        <Section
          title="Support access"
          description="Platform operators can only look at your workspace’s data while you’ve granted time-boxed access. Every view they make is recorded in your audit log."
        >
          <SupportAccess grants={grants} operators={operators.map((o) => ({ id: o.user_id, label: `${o.full_name || o.email} (${o.email})` }))} canEdit={canEdit} timeZone={tenant.timezone} />
        </Section>
        <Section
          title="Action risk tiers"
          description="Each action GMS can take has a risk tier. You can raise a tier for this workspace — for example, so agents must ask a person before saving answers — but never lower one. Raising a tier asks for your authenticator code."
        >
          <ActionTiers actions={actions} canEdit={canEdit} />
        </Section>
      </div>
    </div>
  );
}
