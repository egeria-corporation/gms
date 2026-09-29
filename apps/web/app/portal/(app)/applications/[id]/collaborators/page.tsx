// SPDX-License-Identifier: AGPL-3.0-or-later
// B-07 Collaborators.
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { ManageCollaborators } from './manage';

export const metadata: Metadata = { title: 'Collaborators' };

export default async function CollaboratorsPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const d = await rls(async (trx) => {
    const app = await trx.selectFrom('applications').select(['id', 'reference_number', 'applicant_user_id', 'applicant_org_id', 'status']).where('id', '=', id).executeTakeFirst();
    if (!app) return null;
    const rows = await trx
      .selectFrom('application_collaborators as c')
      .leftJoin('profiles as p', 'p.id', 'c.user_id')
      .select(['c.id', 'c.email', 'c.role', 'c.status', 'p.full_name'])
      .where('c.application_id', '=', id)
      .where('c.status', '!=', 'removed')
      .orderBy('c.created_at')
      .execute();
    return { app, rows };
  });
  if (!d) notFound();
  const canManage = d.app.applicant_user_id === viewer.userId || viewer.orgs.some((o) => o.orgId === d.app.applicant_org_id);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[
          { label: 'My applications', href: '/portal' },
          { label: d.app.reference_number, href: `/portal/applications/${id}` },
          { label: 'Collaborators' },
        ]}
        title="Work on this application together"
        description="Invite teammates to help write answers. Everyone sees changes as they’re saved, and we’ll warn you if two people edit the same answer."
      />
      <ManageCollaborators
        applicationId={id}
        canManage={canManage && d.app.status === 'in_progress'}
        collaborators={d.rows.map((r) => ({ id: r.id, email: r.email, name: r.full_name, role: r.role as 'editor' | 'viewer', status: r.status as 'invited' | 'active' | 'removed' }))}
      />
    </div>
  );
}
