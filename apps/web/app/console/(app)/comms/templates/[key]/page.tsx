// SPDX-License-Identifier: AGPL-3.0-only
// CM-01 Email template editor (states: new). Key "new" creates a template; the branded preview is rendered on the server.
import { MERGE_FIELDS } from '@gms/email';
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TemplateEditor } from '@/components/console/admin/comms/template-editor';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { renderMessagePreview } from '../../preview';

export const metadata: Metadata = { title: 'Edit email template' };

const STARTER = {
  key: '',
  name: '',
  subject: 'An update from {{foundation.name}}',
  bodyMd: ['Hi {{applicant.first_name}},', '', 'Thanks for applying to {{opportunity.name}}.', '', 'Warmly,', '{{sender.name}}'].join('\n'),
};

export default async function TemplateEditorPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const forced = forcedState(sp);
  const isNew = key === 'new' || forced === 'new';
  const canEdit = viewer.role !== 'auditor';
  if (key === 'new' && !canEdit) notFound();

  let initial = STARTER;
  if (!isNew) {
    const row = await rls((trx) => trx.selectFrom('email_templates').select(['key', 'name', 'subject', 'body_md']).where('workspace_id', '=', tenant.id).where('key', '=', key).executeTakeFirst());
    if (!row) notFound();
    initial = { key: row.key, name: row.name, subject: row.subject, bodyMd: row.body_md };
  }
  const preview = await renderMessagePreview(tenant, viewer.name, initial.subject, initial.bodyMd);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={isNew ? 'New email template' : initial.name}
        description={isNew ? 'Write the message once; merge fields fill in each person’s details when it’s sent.' : canEdit ? 'Changes apply the next time someone uses this template.' : 'You can view this template. Auditors can’t change it.'}
        breadcrumbs={[{ label: 'Messages & email', href: '/console/comms' }, { label: 'Templates', href: '/console/comms/templates' }, { label: isNew ? 'New' : initial.key }]}
        linkComponent={NextLink}
      />
      <TemplateEditor
        isNew={isNew}
        canEdit={canEdit}
        initial={initial}
        initialPreview={preview}
        mergeFields={MERGE_FIELDS.map((f) => ({ key: f.key, label: f.label, example: f.example }))}
      />
    </div>
  );
}
