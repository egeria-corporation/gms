// SPDX-License-Identifier: AGPL-3.0-or-later
// S-02 Team & roles: members with roles, invitations (pending, revoke), role change / removal behind an
// authenticator step-up, reviewer capacity (states: invite-pending, step-up).
import { ROLE_DESCRIPTIONS, ROLE_LABELS, WORKSPACE_ROLES, type WorkspaceRole } from '@gms/domain';
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { TeamManager, type InvitationRow, type MemberRow } from './team-manager';

export const metadata: Metadata = { title: 'Team & roles' };

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const { members, invitations, load } = await rls(async (trx) => {
    const [members, invitations, load] = await Promise.all([
      trx
        .selectFrom('workspace_members as m')
        .innerJoin('profiles as p', 'p.id', 'm.user_id')
        .select(['m.id', 'm.user_id', 'm.role', 'm.status', 'm.title', 'm.review_capacity', 'm.created_at', 'p.full_name', 'p.email'])
        .where('m.workspace_id', '=', tenant.id)
        .orderBy('p.full_name')
        .execute(),
      trx
        .selectFrom('invitations as i')
        .leftJoin('profiles as p', 'p.id', 'i.invited_by')
        .select(['i.id', 'i.email', 'i.role', 'i.status', 'i.created_at', 'i.expires_at', 'p.full_name as invited_by_name'])
        .where('i.workspace_id', '=', tenant.id)
        .where('i.status', '=', 'pending')
        .orderBy('i.created_at', 'desc')
        .execute(),
      // Open review assignments per reviewer, to show next to their capacity.
      trx
        .selectFrom('review_assignments')
        .select(['reviewer_id', (eb) => eb.fn.countAll<number>().as('n')])
        .where('workspace_id', '=', tenant.id)
        .where('status', 'in', ['not_started', 'in_progress'])
        .groupBy('reviewer_id')
        .execute()
        .catch(() => [] as { reviewer_id: string; n: number }[]),
    ]);
    return { members, invitations, load };
  });
  const openByUser = new Map(load.map((l) => [l.reviewer_id, Number(l.n)]));
  const memberRows: MemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.full_name || m.email,
    email: m.email,
    role: m.role as WorkspaceRole,
    status: m.status,
    title: m.title,
    capacity: m.review_capacity,
    openAssignments: openByUser.get(m.user_id) ?? 0,
    joinedAt: m.created_at,
  }));
  let inviteRows: InvitationRow[] = invitations.map((i) => ({ id: i.id, email: i.email, role: i.role as WorkspaceRole, invitedBy: i.invited_by_name, createdAt: i.created_at, expiresAt: i.expires_at }));
  if (forced === 'invite-pending' && inviteRows.length === 0) {
    const now = Date.now();
    inviteRows = [{ id: 'preview-invitation', email: 'jordan.lee@halcyon.example', role: 'program_officer', invitedBy: viewer.name, createdAt: new Date(now - 3600_000).toISOString(), expiresAt: new Date(now + 14 * 86400_000).toISOString() }];
  }
  const canManage = viewer.role === 'owner' || viewer.role === 'admin';
  return (
    <div className="grid gap-4">
      <PageHeader title="Team & roles" description="Who can use the console, and what each person can do. Changing a role or removing someone asks for your authenticator code." />
      <SettingsTabs current="/console/settings/team" />
      <TeamManager
        members={memberRows}
        invitations={inviteRows}
        viewerId={viewer.userId}
        viewerIsOwner={viewer.role === 'owner'}
        canManage={canManage}
        timeZone={tenant.timezone}
        roles={WORKSPACE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))}
        forced={forced === 'invite-pending' || forced === 'step-up' ? forced : null}
      />
    </div>
  );
}
