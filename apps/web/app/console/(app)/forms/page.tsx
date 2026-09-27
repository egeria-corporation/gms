// SPDX-License-Identifier: AGPL-3.0-only
// FB-01 Forms: every form with its kind, published version, draft in progress, the stages that use it and when
// it last changed. Create blank / from a template, import CommonGrants JSON, rename, archive.
// Filters: `kind`, `archived=1`.   ?state= empty | import-error (opens the import dialog with a parse error)
import { Button, EmptyState, ErrorState, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CreateFormDialog, type WorkspaceTemplate } from '@/components/console/grantmaking/forms/create-form-dialog';
import { FormsTable, type FormRow } from '@/components/console/grantmaking/forms/forms-table';
import { ImportFormDialog } from '@/components/console/grantmaking/forms/import-form-dialog';
import { FORM_KINDS } from '@/components/console/grantmaking/forms/kinds';
import { requireStaff } from '@/lib/auth';
import { oneParam, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Forms' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];

export default async function FormsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const kindParam = oneParam(sp, 'kind');
  const kind = kindParam && FORM_KINDS.some((k) => k.value === kindParam) ? kindParam : null;
  const showArchived = oneParam(sp, 'archived') === '1';

  const data = await rls(async (trx) => {
    let q = trx.selectFrom('forms').select(['id', 'name', 'description', 'kind', 'status', 'current_version_id', 'last_modified_at']).where('workspace_id', '=', tenant.id);
    if (kind) q = q.where('kind', '=', kind);
    if (!showArchived) q = q.where('status', '=', 'active');
    const [forms, versions, usage, templates, anyForms] = await Promise.all([
      q.orderBy('name').execute(),
      trx.selectFrom('form_versions').select(['id', 'form_id', 'version', 'status', 'last_modified_at']).where('workspace_id', '=', tenant.id).execute(),
      trx
        .selectFrom('competition_forms as cf')
        .innerJoin('competitions as c', 'c.id', 'cf.competition_id')
        .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
        .select(['cf.form_id', 'o.id as opportunity_id', 'o.title', 'c.name as stage_name'])
        .where('cf.workspace_id', '=', tenant.id)
        .orderBy('o.title')
        .execute(),
      trx.selectFrom('form_templates').select(['id', 'name', 'description', 'kind']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
      trx.selectFrom('forms').select('id').where('workspace_id', '=', tenant.id).limit(1).execute(),
    ]);
    return { forms, versions, usage, templates, hasAny: anyForms.length > 0 };
  }).catch(() => null);

  const templates: WorkspaceTemplate[] = data?.templates ?? [];
  const header = (
    <PageHeader
      title="Forms"
      description="Application, letter of inquiry and report forms. Published versions never change; edits go into a new draft version."
      actions={
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            <ImportFormDialog forcedError={forced === 'import-error'} />
            <CreateFormDialog templates={templates} />
          </div>
        ) : null
      }
    />
  );

  if (!data) {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState description="We couldn’t load forms. Refresh the page, or try again in a minute." action={<Button asChild variant="outline" size="sm"><Link href="/console/forms">Try again</Link></Button>} />
      </div>
    );
  }

  if (forced === 'empty' || !data.hasAny) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          title="No forms yet"
          description="Build a form from scratch, start from a template like a letter of inquiry or a final report, or import a CommonGrants form."
          action={canEdit ? <CreateFormDialog templates={templates} triggerLabel="Create your first form" /> : undefined}
        />
      </div>
    );
  }

  const rows: FormRow[] = data.forms.map((f) => {
    const vs = data.versions.filter((v) => v.form_id === f.id);
    const published = vs.find((v) => v.id === f.current_version_id && v.status === 'published');
    const draft = vs.filter((v) => v.status === 'draft').sort((a, b) => b.version - a.version)[0];
    const lastModified = [f.last_modified_at, ...vs.map((v) => v.last_modified_at)].sort().at(-1) ?? f.last_modified_at;
    const used = data.usage.filter((u) => u.form_id === f.id);
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      kind: f.kind,
      status: f.status,
      publishedVersion: published?.version ?? null,
      draftVersion: draft?.version ?? null,
      usedBy: [...new Map(used.map((u) => [`${u.title} · ${u.stage_name}`, { opportunityId: u.opportunity_id, label: `${u.title} · ${u.stage_name}` }])).values()],
      lastModifiedAt: lastModified,
    };
  });

  return (
    <div className="grid gap-6">
      {header}
      <FormsTable rows={rows} timeZone={tenant.timezone} kind={kind} showArchived={showArchived} canEdit={canEdit} />
    </div>
  );
}
