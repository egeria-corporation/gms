// SPDX-License-Identifier: AGPL-3.0-only
// CM-03 Notification rules (states: empty). Owners and admins edit; program officers and auditors view.
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { RulesTable } from '@/components/console/admin/comms/rules-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Notification rules' };

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';
  const { rules, templates } = await rls(async (trx) => {
    const [rules, templates] = await Promise.all([
      forced === 'empty'
        ? Promise.resolve([])
        : trx
            .selectFrom('notification_rules')
            .select(['id', 'event_type', 'channel', 'audience', 'template_key', 'offset_days', 'enabled'])
            .where('workspace_id', '=', tenant.id)
            .orderBy('event_type')
            .orderBy('audience')
            .execute(),
      trx.selectFrom('email_templates').select(['key', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
    ]);
    return { rules, templates };
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Notification rules"
        description={
          canEdit
            ? 'Choose what GMS sends automatically, to whom, and when. Turn a rule off to pause it without losing its settings.'
            : 'What GMS sends automatically. Only owners and admins can change these rules.'
        }
        breadcrumbs={[{ label: 'Messages & email', href: '/console/comms' }, { label: 'Notification rules' }]}
        linkComponent={NextLink}
      />
      <RulesTable
        canEdit={canEdit}
        rules={rules.map((r) => ({ id: r.id, eventType: r.event_type, channel: r.channel, audience: r.audience, templateKey: r.template_key, offsetDays: r.offset_days, enabled: r.enabled }))}
        templates={templates}
      />
    </div>
  );
}
