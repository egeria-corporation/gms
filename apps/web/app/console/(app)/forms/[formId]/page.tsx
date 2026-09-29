// SPDX-License-Identifier: AGPL-3.0-or-later
// FB-01…FB-08 Form builder: edits the form's draft version (save, publish with a migration notice, version
// history and compare, preview desktop/mobile with a test submission, checks). When the newest version is
// published the builder opens view-only with "Start a new version".
// ?state= mapping-conflict (FB-02) | circular-rule (FB-03) | lint (FB-07, checker errors) | read-only
//   Demo states load an in-memory copy of the model and never save.
import { FieldSchema, FormModelSchema, type FormModel, type FormTemplate, type QuestionBankItem, type TemplateKind } from '@gms/forms';
import type { FormVersionStatus, FormVersionSummary } from '@gms/forms/react';
import { Alert, Button, NotFoundState, PageHeader, ToneChip } from '@gms/ui';
import { Archive } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { circularRuleModel, lintModel, mappingConflictModel } from '@/components/console/grantmaking/forms/demo-models';
import { FormBuilderHost } from '@/components/console/grantmaking/forms/form-builder-host';
import { kindLabel } from '@/components/console/grantmaking/forms/kinds';
import { SaveTemplateDialog } from '@/components/console/grantmaking/forms/save-template-dialog';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Form builder' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];
const TEMPLATE_KINDS: TemplateKind[] = ['application', 'loi', 'report'];
const DEMO_STATES: Record<string, string> = {
  'mapping-conflict': 'two questions share one CommonGrants mapping (FB-02)',
  'circular-rule': 'two questions’ visibility rules depend on each other (FB-03)',
  lint: 'the form checker finds errors (FB-07). Open the Check tab',
};

function parseModel(v: unknown): FormModel | null {
  const r = FormModelSchema.safeParse(v);
  return r.success ? r.data : null;
}

export default async function FormBuilderPage({ params, searchParams }: { params: Promise<{ formId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const [{ formId }, sp] = await Promise.all([params, searchParams]);
  const forced = forcedState(sp);
  const data = !isUuid(formId)
    ? null
    : await rls(async (trx) => {
        const form = await trx.selectFrom('forms').selectAll().where('workspace_id', '=', tenant.id).where('id', '=', formId).executeTakeFirst();
        if (!form) return null;
        const [versions, bank, templates] = await Promise.all([
          trx
            .selectFrom('form_versions as v')
            .leftJoin('profiles as p', 'p.id', 'v.published_by')
            .select(['v.id', 'v.version', 'v.status', 'v.published_at', 'v.change_note', 'v.builder_model', 'v.last_modified_at', 'p.full_name as published_by_name'])
            .where('v.workspace_id', '=', tenant.id)
            .where('v.form_id', '=', formId)
            .orderBy('v.version', 'desc')
            .execute(),
          trx.selectFrom('question_bank_items').select(['id', 'label', 'field', 'tags', 'cg_path']).where('workspace_id', '=', tenant.id).orderBy('label').execute(),
          trx.selectFrom('form_templates').select(['id', 'name', 'description', 'kind', 'builder_model']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
        ]);
        return { form, versions, bank, templates };
      });

  const crumbs = [
    { label: 'Console', href: '/console' },
    { label: 'Forms', href: '/console/forms' },
  ];
  const latest = data?.versions[0];
  const model = latest ? parseModel(latest.builder_model) : null;
  if (!data || !latest || !model) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Form not found" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState
          title={data && latest && !model ? 'This form version can’t be opened' : 'We couldn’t find that form'}
          description={data && latest && !model ? 'Its saved definition is not valid. Start a new version or contact support.' : 'It may have been removed, or the link is wrong.'}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/console/forms">Back to forms</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { form } = data;
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const demoLabel = forced ? DEMO_STATES[forced] : undefined;
  const demo = Boolean(demoLabel);
  const isDraft = latest.status === 'draft';
  const readOnly = forced === 'read-only' || !isDraft || !canEdit || (form.status === 'archived' && !demo);
  const initialModel = forced === 'mapping-conflict' ? mappingConflictModel(model) : forced === 'circular-rule' ? circularRuleModel(model) : forced === 'lint' ? lintModel(model) : model;
  const published = data.versions.find((v) => v.id === form.current_version_id && v.status === 'published');
  const publishedModel = published ? (parseModel(published.builder_model) ?? undefined) : undefined;

  const versions: FormVersionSummary[] = data.versions.map((v) => ({
    id: v.id,
    version: v.version,
    status: (['draft', 'published', 'retired'].includes(v.status) ? v.status : 'retired') as FormVersionStatus,
    publishedAt: v.published_at,
    publishedBy: v.published_by_name,
    changeNote: v.change_note,
  }));
  const questionBank: QuestionBankItem[] = data.bank.flatMap((b) => {
    const f = FieldSchema.safeParse(b.field);
    return f.success ? [{ key: b.id, label: b.label, description: '', tags: b.tags, ...(b.cg_path ? { cgPath: b.cg_path } : {}), field: f.data }] : [];
  });
  const templates: FormTemplate[] = data.templates.flatMap((t) => {
    const m = parseModel(t.builder_model);
    return m ? [{ key: t.id, name: t.name, description: t.description ?? '', kind: TEMPLATE_KINDS.includes(t.kind as TemplateKind) ? (t.kind as TemplateKind) : 'application', model: m }] : [];
  });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={form.name}
        breadcrumbs={[...crumbs, { label: form.name }]}
        linkComponent={NextLink}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{kindLabel(form.kind)}</span>
            <span>· Editing v{latest.version} ({isDraft ? 'draft' : 'published, view only'})</span>
            {published ? <span>· v{published.version} is live</span> : <span>· Not published yet</span>}
            {form.status === 'archived' ? <ToneChip tone="muted" icon={Archive} label="Archived" size="sm" /> : null}
          </span>
        }
        actions={canEdit ? <SaveTemplateDialog versionId={latest.id} formName={form.name} versionLabel={`v${latest.version}`} /> : null}
      />
      {demo ? (
        <Alert variant="info" title="Demo state">
          This builder shows a copy of the form where {demoLabel}. Nothing here is saved or published.
        </Alert>
      ) : null}
      {forced === 'read-only' ? <Alert variant="info">Demo state: the builder is shown view only.</Alert> : null}
      {!isDraft && canEdit && !demo && forced !== 'read-only' ? (
        <Alert variant="info" title={`Version ${latest.version} is published`}>
          Published versions never change. Open the Versions tab and choose “Start a new version” to edit a copy; applications in progress move to it when you publish.
        </Alert>
      ) : null}
      {form.status === 'archived' ? (
        <Alert variant="warning" title="This form is archived">
          It stays attached to stages that already use it but is hidden from the stage picker. Restore it from the forms list to edit.
        </Alert>
      ) : null}
      <FormBuilderHost
        key={`${latest.id}:${latest.status}:${forced ?? ''}`}
        formId={form.id}
        versionId={latest.id}
        initialModel={initialModel}
        lastModifiedAt={latest.last_modified_at}
        readOnly={readOnly}
        demo={demo}
        versions={versions}
        publishedModel={publishedModel}
        questionBank={questionBank}
        templates={templates}
        canEdit={canEdit && form.status !== 'archived'}
      />
    </div>
  );
}
