// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// FB-01…FB-08 forms: create (blank, built-in template, workspace template), CommonGrants import, rename/archive,
// save draft, publish, new version, save as template, and loading an older version's builder model.
import { DomainError, toProblem } from '@gms/domain';
import { FormModelSchema, templateModel, type FormModel } from '@gms/forms';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { isUuid } from '@/lib/grantmaking-data';
import { act } from '@/lib/server/act';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

type Kind = 'application' | 'loi' | 'report' | 'eligibility' | 'other';

function refresh(formId?: string) {
  revalidatePath('/console/forms');
  if (formId) revalidatePath(`/console/forms/${formId}`);
}

export async function createFormAction(input: { name: string; kind: Kind; description?: string | null; builtinTemplate?: string; templateId?: string }) {
  let model: FormModel | undefined;
  if (input.builtinTemplate) {
    try {
      model = { ...templateModel(input.builtinTemplate), title: input.name };
    } catch {
      return { ok: false as const, problem: toProblem(new DomainError('not_found', 'That template no longer exists.')) };
    }
  }
  const r = await act<{ formId: string; versionId: string }>('forms.create', {
    name: input.name,
    kind: input.kind,
    description: input.description ?? null,
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(model ? { model } : {}),
  });
  refresh();
  return r;
}

export async function importCommonGrantsAction(input: { name: string; kind: Kind; source: Record<string, unknown> }) {
  const r = await act<{ formId: string; versionId: string; unmapped: string[] }>('forms.import_commongrants', input);
  refresh();
  return r;
}

export async function updateFormAction(formId: string, input: { name?: string; description?: string | null; status?: 'active' | 'archived' }) {
  const r = await act('forms.update', { formId, ...input });
  refresh(formId);
  return r;
}

export async function saveDraftAction(formId: string, input: { versionId: string; model: FormModel; expectedLastModifiedAt?: string }) {
  const r = await act<{ lastModifiedAt: string; lint: { level: string; code: string; message: string; fieldId?: string }[] }>('forms.save_draft', input);
  // Only the list changes; the open builder keeps its own state (no re-render of the builder page).
  if (r.ok) revalidatePath('/console/forms');
  return r;
}

export async function publishFormAction(formId: string, input: { versionId: string; changeNote?: string }) {
  const r = await act<{ version: number; migratedApplications: number; notice: string }>('forms.publish', { versionId: input.versionId, ...(input.changeNote ? { changeNote: input.changeNote } : {}) });
  refresh(formId);
  revalidatePath('/console/opportunities');
  return r;
}

export async function newVersionAction(formId: string) {
  const r = await act<{ id: string }>('forms.new_version', { formId });
  refresh(formId);
  return r;
}

export async function saveTemplateAction(input: { versionId: string; name: string; description?: string }) {
  const r = await act<{ id: string }>('forms.save_template', input);
  refresh();
  return r;
}

/** Read-only: an older version's builder model for the compare view (FB-08). */
export async function loadVersionModelAction(versionId: string): Promise<{ ok: true; data: FormModel } | { ok: false; problem: { detail: string } }> {
  const tenant = await requireTenant();
  await requireStaff();
  if (!isUuid(versionId)) return { ok: false, problem: { detail: 'That version was not found.' } };
  const row = await rls((trx) => trx.selectFrom('form_versions').select('builder_model').where('workspace_id', '=', tenant.id).where('id', '=', versionId).executeTakeFirst());
  if (!row) return { ok: false, problem: { detail: 'That version was not found.' } };
  const parsed = FormModelSchema.safeParse(row.builder_model);
  if (!parsed.success) return { ok: false, problem: { detail: 'That version could not be read.' } };
  return { ok: true, data: parsed.data };
}
