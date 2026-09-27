// SPDX-License-Identifier: AGPL-3.0-only
// React-free helpers behind <GmsForm>: stable DOM ids, error indexing, per-page progress,
// UI-schema rule evaluation and plain-text answer formatting. Visibility and requiredness always
// come from the same functions the server uses (visibleFields / requiredFields).
import type { Rule, UISchemaElement } from '@jsonforms/core';
import type { ValidateFunction } from 'ajv';
import { formatMoney } from '@gms/domain';
import type { CompiledForm, FieldMeta, JsonSchema } from '../compile';
import { evaluateCondition, type Flags } from '../conditions';
import { isEmptyValue, isPlainObject, parsePointer, pruneEmpty, type ResponseData } from '../util';
import { createAjv, type GmsAjv, requiredFields, type ResponseError, visibleFields } from '../validate';

/** A stored file answer. Arrays of these when the question allows several files. */
export interface FileRef {
  fileId: string;
  name: string;
  size?: number;
  mimeType?: string;
}

export function isFileRef(v: unknown): v is FileRef {
  return isPlainObject(v) && typeof v.fileId === 'string' && typeof v.name === 'string';
}

export function fileRefs(value: unknown): FileRef[] {
  if (Array.isArray(value)) return value.filter(isFileRef);
  return isFileRef(value) ? [value] : [];
}

// ---------------------------------------------------------------------------
// DOM ids
// ---------------------------------------------------------------------------

function idSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** `field-<fieldId>` (optionally prefixed, for pages that show two forms). */
export function fieldDomId(fieldId: string, prefix = ''): string {
  return `${prefix}field-${idSafe(fieldId)}`;
}

/** `/budget_lines/0/amount` → `field-budget_lines-0-amount`. The field id itself for top-level pointers. */
export function domIdForPointer(pointer: string, prefix = ''): string {
  const segs = parsePointer(pointer);
  if (!segs.length) return `${prefix}field-form`;
  return `${prefix}field-${segs.map(idSafe).join('-')}`;
}

/** Id of a part of a field: `field-<fieldId>-<part>-…`. */
export function partDomId(fieldId: string, parts: readonly (string | number)[], prefix = ''): string {
  return [fieldDomId(fieldId, prefix), ...parts.map((p) => idSafe(String(p)))].join('-');
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function errorsByField(errors: readonly ResponseError[] | undefined): Map<string, ResponseError[]> {
  const map = new Map<string, ResponseError[]>();
  for (const e of errors ?? []) map.set(e.fieldId, [...(map.get(e.fieldId) ?? []), e]);
  return map;
}

/** The message shown under a whole question (errors that point at the field itself, else the first one). */
export function fieldLevelError(errors: readonly ResponseError[] | undefined, fieldId: string): string | undefined {
  if (!errors?.length) return undefined;
  const top = errors.find((e) => e.pointer === `/${fieldId}`);
  return top?.message;
}

/** The message for a part of a field, e.g. `['first']` or `[0, 'amount']`. */
export function partError(errors: readonly ResponseError[] | undefined, fieldId: string, parts: readonly (string | number)[]): string | undefined {
  const pointer = `/${[fieldId, ...parts].map(String).join('/')}`;
  return errors?.find((e) => e.pointer === pointer)?.message;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Sets (or clears, for undefined/null) one answer immutably. */
export function setAnswer(data: ResponseData, fieldId: string, value: unknown): ResponseData {
  const next: ResponseData = { ...data };
  if (value === undefined || value === null) delete next[fieldId];
  else next[fieldId] = value;
  return next;
}

export interface FormView {
  visible: Set<string>;
  required: Set<string>;
  /** Fields that can't be edited right now (flag-disabled or `enabledWhen` false). */
  disabled: Set<string>;
}

/** Visibility, requiredness and enablement for the current answers, using the server's rules. */
export function computeFormView(compiled: CompiledForm, data: ResponseData, flags: Flags = {}): FormView {
  const visibleList = visibleFields(compiled, data);
  const visible = new Set(visibleList);
  const required = new Set(requiredFields(compiled, data));
  const pruned = pruneEmpty(data);
  const effective: ResponseData = {};
  for (const [k, v] of Object.entries(pruned)) if (!compiled.fieldMeta[k] || visible.has(k)) effective[k] = v;
  const disabled = new Set<string>();
  for (const id of visibleList) {
    const m = compiled.fieldMeta[id]!;
    if (m.disabled || (m.enabledWhen && !evaluateCondition(m.enabledWhen, effective, flags))) disabled.add(id);
  }
  return { visible, required, disabled };
}

/** The answers with hidden fields removed (what the server evaluates rules against). */
export function effectiveData(compiled: CompiledForm, data: ResponseData, visible: ReadonlySet<string>): ResponseData {
  const out: ResponseData = {};
  for (const [k, v] of Object.entries(pruneEmpty(data))) if (!compiled.fieldMeta[k] || visible.has(k)) out[k] = v;
  return out;
}

let ruleAjv: GmsAjv | undefined;
const ruleCache = new WeakMap<object, ValidateFunction>();

/**
 * Evaluates a compiled UI-schema rule (used for info blocks and sections, whose conditions live
 * only in the UI schema). The rule schemas are generated from the same conditions as fieldMeta,
 * so they agree with evaluateCondition.
 */
export function ruleHolds(rule: Rule | undefined, data: ResponseData): boolean {
  if (!rule) return true;
  const cond = rule.condition as { scope?: string; schema?: JsonSchema };
  if (!cond.schema) return true;
  let fn = ruleCache.get(cond.schema);
  if (!fn) {
    ruleAjv ??= createAjv();
    fn = ruleAjv.compile(cond.schema);
    ruleAjv.removeSchema(cond.schema);
    ruleCache.set(cond.schema, fn);
  }
  const ok = fn(data) === true;
  const effect = String(rule.effect);
  return effect === 'HIDE' || effect === 'DISABLE' ? !ok : ok;
}

/** The field id a UI-schema Control points at (`#/properties/<id>`). */
export function controlFieldId(el: UISchemaElement): string | undefined {
  const scope = (el as { scope?: unknown }).scope;
  if (typeof scope !== 'string') return undefined;
  const m = /^#\/properties\/([^/]+)$/.exec(scope);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type PageStatus = 'not_started' | 'in_progress' | 'complete' | 'error';

export interface PageProgress {
  id: string;
  title: string;
  status: PageStatus;
  /** Share (0–1) of required visible questions answered. */
  completion: number;
  requiredCount: number;
  answeredRequired: number;
  errorCount: number;
}

/** Per-page completion for the progress rail, from the answers and any validation errors. */
export function pageProgress(compiled: CompiledForm, data: ResponseData, errors: readonly ResponseError[] = []): PageProgress[] {
  const visible = new Set(visibleFields(compiled, data));
  const required = new Set(requiredFields(compiled, data));
  return compiled.pages.map((page) => {
    const ids = page.fieldIds.filter((id) => visible.has(id));
    const req = ids.filter((id) => required.has(id));
    const answeredReq = req.filter((id) => !isEmptyValue(data[id])).length;
    const answeredAny = ids.some((id) => !isEmptyValue(data[id]));
    const errorCount = errors.filter((e) => e.pageId === page.id && visible.has(e.fieldId)).length;
    let status: PageStatus;
    if (errorCount > 0) status = 'error';
    else if (req.length > 0 && answeredReq === req.length) status = 'complete';
    else if (req.length === 0 && answeredAny) status = 'complete';
    else if (answeredAny) status = 'in_progress';
    else status = 'not_started';
    return {
      id: page.id,
      title: page.title,
      status,
      completion: req.length ? answeredReq / req.length : answeredAny ? 1 : 0,
      requiredCount: req.length,
      answeredRequired: answeredReq,
      errorCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Answer text (review mode, previews, screen-reader summaries)
// ---------------------------------------------------------------------------

function optionLabel(meta: Pick<FieldMeta, 'options'>, v: unknown): string {
  const hit = meta.options?.find((o) => o.value === v);
  return hit ? hit.label : String(v);
}

function isoDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** A one-line plain-text rendering of an answer, or undefined when unanswered. */
export function answerText(meta: FieldMeta, value: unknown): string | undefined {
  if (isEmptyValue(value)) return undefined;
  switch (meta.type) {
    case 'currency':
      return typeof value === 'number' ? formatMoney(value, meta.currency ?? 'USD') : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
    case 'date':
      return typeof value === 'string' ? isoDateText(value) : String(value);
    case 'yes_no':
      return value === true ? 'Yes' : value === false ? 'No' : String(value);
    case 'select':
      return optionLabel(meta, value);
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(value) ? value.map((v) => optionLabel(meta, v)).join(', ') : optionLabel(meta, value);
    case 'name':
      if (isPlainObject(value)) return [value.first, value.last].filter((x) => typeof x === 'string' && x.trim()).join(' ');
      return String(value);
    case 'address':
      if (isPlainObject(value)) {
        const cityLine = [value.city, [value.state, value.postal].filter(Boolean).join(' ')].filter((x) => typeof x === 'string' && x.trim()).join(', ');
        return [value.line1, value.line2, cityLine, value.county ? `${String(value.county)} County` : undefined]
          .filter((x) => typeof x === 'string' && x.trim())
          .join(', ');
      }
      return String(value);
    case 'file_upload':
      return fileRefs(value)
        .map((f) => f.name)
        .join(', ');
    case 'attestation':
      if (isPlainObject(value)) return value.agreed === true ? `Confirmed${typeof value.name === 'string' && value.name ? ` — signed by ${value.name}` : ''}` : 'Not confirmed';
      return String(value);
    case 'likert_matrix':
      if (isPlainObject(value))
        return (meta.rows ?? [])
          .map((r) => `${r.label}: ${value[r.id] !== undefined ? (meta.scale?.find((s) => s.value === value[r.id])?.label ?? String(value[r.id])) : 'not answered'}`)
          .join('; ');
      return String(value);
    case 'repeater_table':
      return Array.isArray(value) ? `${value.length} ${value.length === 1 ? 'row' : 'rows'}` : String(value);
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
