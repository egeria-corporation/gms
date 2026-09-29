// SPDX-License-Identifier: AGPL-3.0-or-later
// In-memory demo models for the builder's documented states (`?state=` on /console/forms/[formId]). They are
// built from a copy of the current model and never saved.
import { FormModelSchema, listFields, templateModel, type FormModel } from '@gms/forms';

type Json = Record<string, unknown>;

/** A copy with at least two fields (falls back to a built-in template for empty forms). */
function withTwoFields(model: FormModel): FormModel {
  return listFields(model).length >= 2 ? structuredClone(model) : { ...templateModel('general_operating'), title: model.title };
}

function fieldRefs(model: FormModel): Json[] {
  const out: Json[] = [];
  for (const page of model.pages as unknown as { elements: Json[] }[]) {
    for (const el of page.elements) {
      if (el.type === 'section') for (const c of el.elements as Json[]) out.push(c);
      else out.push(el);
    }
  }
  return out.filter((e) => e.type !== 'info_block' && e.type !== 'section');
}

/** FB-02: two questions mapped to the same CommonGrants path. */
export function mappingConflictModel(model: FormModel): FormModel {
  const m = withTwoFields(model);
  const [a, b] = fieldRefs(m);
  const path = (typeof a!.cgMapping === 'string' && a!.cgMapping) || (typeof b!.cgMapping === 'string' && b!.cgMapping) || 'organization.legalName';
  a!.cgMapping = path;
  b!.cgMapping = path;
  return FormModelSchema.parse(m);
}

/** FB-03: two questions whose visibility depends on each other. */
export function circularRuleModel(model: FormModel): FormModel {
  const m = withTwoFields(model);
  const [a, b] = fieldRefs(m);
  a!.visibleWhen = { field: String(b!.id), op: 'truthy' };
  b!.visibleWhen = { field: String(a!.id), op: 'truthy' };
  return FormModelSchema.parse(m);
}

/** FB-07: a copy with checker errors (a choice question without choices and a question without a label). */
export function lintModel(model: FormModel): FormModel {
  const m = structuredClone(model) as unknown as { pages: { id: string; title: string; elements: Json[] }[] };
  if (!m.pages.length) m.pages.push({ id: 'page_1', title: 'Page 1', elements: [] });
  m.pages[0]!.elements.push(
    { id: 'demo_program_area', type: 'select', label: 'Which program area?', options: [] },
    { id: 'demo_unlabeled', type: 'long_text', label: '' },
    { id: 'demo_budget_file', type: 'file_upload', label: 'Upload your budget', required: true },
  );
  return FormModelSchema.parse(m);
}
