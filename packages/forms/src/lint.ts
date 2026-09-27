// SPDX-License-Identifier: AGPL-3.0-only
// Form linter for the builder: problems that block publishing (errors), likely mistakes
// (warnings) and suggestions (info). Messages are written for program staff.
import { cgPathInfo, suggestCgPath } from './cg';
import { type Field, FIELD_ID_PATTERN, type FormModel, listFields, listInfoBlocks, conditionFlagRefs } from './model';
import { detectRuleCycles } from './rules';

export type LintLevel = 'error' | 'warning' | 'info';

export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
  fieldId?: string;
  pageId?: string;
}

/** Word limits above this are almost always a typo (e.g. 15000 for 150). */
export const MAX_REASONABLE_WORDS = 2000;
export const MAX_LABEL_LENGTH = 200;
const VAGUE_LABELS = new Set(['click here', 'here', 'field', 'question', 'untitled', 'untitled question', 'text', 'enter text', 'new question', 'label', 'input']);
const COMPLEX_TYPES = new Set(['repeater_table', 'likert_matrix', 'file_upload']);

const name = (f: { label: string; id: string }) => (f.label.trim() ? `“${f.label.trim()}”` : `the question “${f.id}”`);

function limitsIssues(field: Field): LintIssue[] {
  const out: LintIssue[] = [];
  const at = { fieldId: field.id };
  if ((field.type === 'long_text' || field.type === 'rich_text') && field.maxWords && field.maxWords > MAX_REASONABLE_WORDS) {
    out.push({ level: 'warning', code: 'word_limit_high', message: `${name(field)} allows ${field.maxWords.toLocaleString('en-US')} words. That is very long for an application answer. Did you mean ${Math.round(field.maxWords / 10).toLocaleString('en-US')}?`, ...at });
  }
  if ((field.type === 'number' || field.type === 'currency') && field.min !== undefined && field.max !== undefined && field.min > field.max) {
    out.push({ level: 'error', code: 'min_greater_than_max', message: `${name(field)} has a minimum that is larger than its maximum, so no answer can pass.`, ...at });
  }
  if (field.type === 'date' && field.min && field.max && field.min > field.max) {
    out.push({ level: 'error', code: 'min_greater_than_max', message: `${name(field)} has an earliest date after its latest date, so no answer can pass.`, ...at });
  }
  if (field.type === 'repeater_table' && field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
    out.push({ level: 'error', code: 'min_greater_than_max', message: `${name(field)} needs more rows than it allows.`, ...at });
  }
  return out;
}

/** Lints a builder model. Results follow form order; errors must be fixed before publishing. */
export function lintForm(model: FormModel): LintIssue[] {
  const issues: LintIssue[] = [];
  const fields = listFields(model);
  const byId = new Map<string, Field>();

  if (model.pages.length === 0) issues.push({ level: 'error', code: 'no_pages', message: 'This form has no pages yet. Add a page and at least one question.' });
  if (!model.title.trim()) issues.push({ level: 'error', code: 'missing_title', message: 'Give the form a title applicants will recognize.' });

  // Ids: pages, sections, info blocks and fields share one namespace so rules and links stay unambiguous.
  const idCounts = new Map<string, number>();
  const bump = (id: string) => idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  for (const page of model.pages) {
    bump(page.id);
    for (const el of page.elements) {
      bump(el.id);
      if (el.type === 'section') for (const c of el.elements) bump(c.id);
    }
  }
  const reported = new Set<string>();
  for (const [id, n] of idCounts) {
    if (n > 1 && !reported.has(id)) {
      reported.add(id);
      issues.push({ level: 'error', code: 'duplicate_id', message: `The id “${id}” is used ${n} times. Each page, section and question needs its own id, or answers will overwrite each other.`, fieldId: id });
    }
  }

  for (const page of model.pages) {
    const hasContent = page.elements.some((e) => e.type !== 'section' || e.elements.length > 0);
    if (!hasContent) issues.push({ level: 'warning', code: 'empty_page', message: `The page “${page.title || page.id}” has no questions. Add some or remove the page.`, pageId: page.id });
    if (!page.title.trim()) issues.push({ level: 'error', code: 'missing_page_title', message: 'Every page needs a title. Applicants see it in the progress list.', pageId: page.id });
  }

  const cgUsers = new Map<string, string[]>();
  const lastPageIndex = model.pages.length - 1;
  const declaredFlags = new Set(Object.keys(model.flags));

  for (const { field, page, pageIndex } of fields) {
    byId.set(field.id, field);
    const at = { fieldId: field.id, pageId: page.id };
    const label = field.label.trim();

    if (!FIELD_ID_PATTERN.test(field.id)) {
      issues.push({ level: 'error', code: 'invalid_id', message: `The id “${field.id}” can only use letters, numbers and underscores, and must start with a letter.`, ...at });
    }
    if (!label) issues.push({ level: 'error', code: 'missing_label', message: `The question “${field.id}” has no label. Applicants and screen readers need one.`, ...at });
    else if (VAGUE_LABELS.has(label.toLowerCase().replace(/[.:!?]+$/, ''))) {
      issues.push({ level: 'warning', code: 'vague_label', message: `The label “${label}” doesn't say what to answer. Screen reader users hear only the label, so describe the question.`, ...at });
    }
    if (label.length > MAX_LABEL_LENGTH) {
      issues.push({ level: 'warning', code: 'label_too_long', message: `The label “${label.slice(0, 60)}…” is ${label.length} characters long. Keep labels under ${MAX_LABEL_LENGTH} characters and move detail into the help text.`, ...at });
    }
    if (COMPLEX_TYPES.has(field.type) && !field.help?.trim()) {
      issues.push({ level: 'warning', code: 'missing_help', message: `${name(field)} is a ${field.type.replace(/_/g, ' ')}. Add help text that explains how to fill it in.`, ...at });
    }

    if ((field.type === 'select' || field.type === 'multi_select' || field.type === 'checkbox_group') && field.options.length === 0) {
      issues.push({ level: 'error', code: 'select_without_options', message: `${name(field)} has no choices. Add at least two options.`, ...at });
    } else if ((field.type === 'select' || field.type === 'multi_select' || field.type === 'checkbox_group') && field.options.length === 1) {
      issues.push({ level: 'warning', code: 'single_option', message: `${name(field)} has only one choice. Add another option or use a yes/no question.`, ...at });
    }
    if ('options' in field) {
      const values = field.options.map((o) => o.value);
      if (new Set(values).size !== values.length) issues.push({ level: 'error', code: 'duplicate_option', message: `${name(field)} has two choices with the same value.`, ...at });
    }
    if (field.type === 'likert_matrix' && (field.rows.length === 0 || field.scale.length < 2)) {
      issues.push({ level: 'error', code: 'likert_incomplete', message: `${name(field)} needs at least one row and two answer choices.`, ...at });
    }
    if (field.type === 'repeater_table' && field.columns.length === 0) {
      issues.push({ level: 'error', code: 'repeater_without_columns', message: `${name(field)} has no columns. Add at least one.`, ...at });
    }
    if (field.type === 'file_upload' && field.accept.length === 0) {
      issues.push({ level: 'warning', code: 'file_without_type_restriction', message: `${name(field)} accepts any file type. Choose the types you can open, like PDF or XLSX.`, ...at });
    }
    issues.push(...limitsIssues(field).map((i) => ({ ...i, pageId: page.id })));

    if (field.type === 'repeater_table' && field.sumEquals) {
      const col = field.columns.find((c) => c.id === field.sumEquals!.column);
      if (!col) issues.push({ level: 'error', code: 'sum_equals_unknown_column', message: `${name(field)} checks the total of a column “${field.sumEquals.column}” that doesn't exist.`, ...at });
      else if (col.type !== 'currency' && col.type !== 'number') issues.push({ level: 'error', code: 'sum_equals_column_not_numeric', message: `${name(field)} totals the column “${col.label}”, but only number or currency columns can be totaled.`, ...at });
    }

    if (field.type === 'attestation' && pageIndex !== lastPageIndex) {
      issues.push({ level: 'info', code: 'attestation_not_last', message: `${name(field)} is not on the last page. Applicants usually sign after answering everything.`, ...at });
    }

    for (const flag of [...conditionFlagRefs(field.visibleWhen), ...conditionFlagRefs(field.enabledWhen), ...conditionFlagRefs(field.requiredWhen)]) {
      if (!declaredFlags.has(flag)) issues.push({ level: 'warning', code: 'unknown_flag', message: `${name(field)} uses the form setting “${flag}”, which is not set on this form, so it counts as off.`, ...at });
    }

    if (field.cgMapping) {
      cgUsers.set(field.cgMapping, [...(cgUsers.get(field.cgMapping) ?? []), field.id]);
      const info = cgPathInfo(field.cgMapping);
      if (!info) issues.push({ level: 'info', code: 'custom_cg_path', message: `${name(field)} maps to “${field.cgMapping}”, which is not a well-known CommonGrants path. Prefill won't work for it.`, ...at });
      else if (!info.fieldTypes.includes(field.type)) issues.push({ level: 'warning', code: 'cg_type_mismatch', message: `${name(field)} is a ${field.type.replace(/_/g, ' ')} question, but “${info.label}” expects ${info.fieldTypes.map((t) => t.replace(/_/g, ' ')).join(' or ')}.`, ...at });
      else if (info.identifying && !field.blind) issues.push({ level: 'info', code: 'identifying_not_blind', message: `${name(field)} identifies the applicant, so blind reviewers never see it, even though it isn't marked hidden. Mark it hidden to make that clear.`, ...at });
    } else if (field.required || field.requiredWhen) {
      const suggestion = suggestCgPath(field);
      if (suggestion) issues.push({ level: 'warning', code: 'unmapped_required', message: `${name(field)} looks like “${suggestion.label}.” Map it to ${suggestion.path} so applicants get it prefilled from their profile.`, ...at });
    }
  }

  for (const [path, ids] of cgUsers) {
    if (ids.length < 2) continue;
    const labels = ids.map((id) => name(byId.get(id)!));
    issues.push({
      level: 'warning',
      code: 'mapping_conflict',
      message: `${labels.join(' and ')} are both mapped to ${path}. Only the first one is used for prefill, and exports may disagree. Keep one mapping.`,
      fieldId: ids[1],
    });
  }

  // Rules
  const rules = detectRuleCycles(model);
  for (const cycle of rules.cycles) {
    const names = cycle.map((id) => (byId.get(id) ? name(byId.get(id)!) : `“${id}”`));
    issues.push({
      level: 'error',
      code: 'rule_cycle',
      message: cycle.length === 2 && cycle[0] === cycle[1] ? `${names[0]} is shown or enabled based on its own answer, so it can never appear. Change the rule.` : `These rules depend on each other in a loop, so none of them can appear: ${names.join(' → ')}. Break the loop.`,
      fieldId: cycle[0],
    });
  }
  for (const r of rules.unknownReferences) {
    issues.push({ level: 'error', code: 'rule_unknown_field', message: `A rule on “${r.fieldId}” uses the question “${r.ref}”, which isn't in this form. Pick another question or remove the rule.`, fieldId: r.fieldId });
  }
  for (const r of rules.nonQuestionReferences) {
    issues.push({ level: 'error', code: 'rule_not_a_question', message: `A rule on “${r.fieldId}” uses “${r.ref}”, which is text or a section, not a question. Rules can only use answers.`, fieldId: r.fieldId });
  }
  for (const r of rules.laterPageReferences) {
    issues.push({ level: 'info', code: 'rule_later_page', message: `A rule on “${r.fieldId}” uses an answer from a later page (“${r.ref}”). That works, but applicants may be confused when things change after they move on.`, fieldId: r.fieldId });
  }
  for (const { field } of fields) {
    if (field.type !== 'repeater_table' || !field.sumEquals) continue;
    const target = byId.get(field.sumEquals.field);
    if (!target) issues.push({ level: 'error', code: 'sum_equals_unknown_field', message: `${name(field)} must add up to “${field.sumEquals.field}”, which isn't in this form.`, fieldId: field.id });
    else if (target.type !== 'currency') issues.push({ level: 'error', code: 'sum_equals_not_currency', message: `${name(field)} must add up to ${name(target)}, but that is a ${target.type.replace(/_/g, ' ')} question. Point it at a currency question.`, fieldId: field.id });
  }
  for (const { block } of listInfoBlocks(model)) {
    if (!block.markdown.trim()) issues.push({ level: 'warning', code: 'empty_info_block', message: `The text block “${block.id}” is empty. Add text or remove it.`, fieldId: block.id });
  }

  return issues;
}

/** True when the form has no lint errors (warnings and info don't block publishing). */
export function canPublish(issues: readonly LintIssue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
