// SPDX-License-Identifier: AGPL-3.0-or-later
// Response validation: Ajv 2020 with GMS keywords, applicant-friendly messages, save vs submit modes.
import type { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv';
import type { DataValidationCxt } from 'ajv/dist/types/index.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { CompiledForm, FieldMeta, JsonSchema } from './compile';
import { evaluateCondition, testValue } from './conditions';
import type { SumEquals } from './model';
import { formatBytes, formatIsoDate, getAtPointer, isPlainObject, listJoin, money, parsePointer, plural, pruneEmpty, type ResponseData, toPointer } from './util';

export { evaluateCondition } from './conditions';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Counts words the way applicants expect: HTML tags and entities are ignored, punctuation alone is not a word. */
export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, '');
  let n = 0;
  for (const token of plain.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Ajv
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  csv: ['text/csv'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword'],
  txt: ['text/plain'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
};

/** True when a file (by name extension or MIME type) matches the accepted extensions. */
export function fileMatchesAccept(file: { name?: unknown; mimeType?: unknown }, accept: readonly string[]): boolean {
  if (!accept.length) return true;
  const exts = accept.map((a) => a.replace(/^\./, '').toLowerCase());
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (ext && exts.includes(ext)) return true;
  if (typeof file.mimeType === 'string' && !ext) {
    const mime = file.mimeType.toLowerCase();
    return exts.some((e) => (MIME_BY_EXT[e] ?? []).includes(mime));
  }
  return false;
}

function maxWordsKeyword(limit: unknown, data: unknown): boolean {
  if (typeof limit !== 'number' || typeof data !== 'string') return true;
  const count = wordCount(data);
  if (count <= limit) return true;
  maxWordsKeyword.errors = [{ keyword: 'maxWords', params: { limit, count }, message: `must have at most ${limit} words` }];
  return false;
}
maxWordsKeyword.errors = [] as Partial<ErrorObject>[];

function sumEqualsKeyword(rule: unknown, data: unknown, _parent?: AnySchemaObject, cxt?: DataValidationCxt): boolean {
  if (!isPlainObject(rule) || !Array.isArray(data) || !cxt) return true;
  const { column, field } = rule as unknown as SumEquals;
  const root = cxt.rootData;
  const expected = isPlainObject(root) ? root[field] : undefined;
  if (typeof expected !== 'number') return true; // the target question reports its own "required" error
  let total = 0;
  for (const row of data) if (isPlainObject(row) && typeof row[column] === 'number') total += row[column];
  if (total === expected) return true;
  sumEqualsKeyword.errors = [{ keyword: 'x-sumEquals', params: { ...(rule as Record<string, unknown>), total, expected }, message: `column ${column} must add up to ${field}` }];
  return false;
}
sumEqualsKeyword.errors = [] as Partial<ErrorObject>[];

function acceptKeyword(accept: unknown, data: unknown): boolean {
  if (!Array.isArray(accept) || !isPlainObject(data)) return true;
  const list = accept.filter((a): a is string => typeof a === 'string');
  if (fileMatchesAccept(data, list)) return true;
  acceptKeyword.errors = [{ keyword: 'x-accept', params: { accept: list, name: data.name }, message: 'file type is not accepted' }];
  return false;
}
acceptKeyword.errors = [] as Partial<ErrorObject>[];

export type GmsAjv = InstanceType<typeof Ajv2020>;

/** An Ajv (draft 2020-12) instance that understands every keyword GMS form schemas use. */
export function createAjv(): GmsAjv {
  const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: true, strictRequired: false, strictTypes: false, strictTuples: false, allowUnionTypes: true });
  addFormats(ajv, { keywords: true });
  ajv.addKeyword({ keyword: 'maxWords', type: 'string', schemaType: 'number', errors: true, validate: maxWordsKeyword });
  ajv.addKeyword({ keyword: 'x-sumEquals', type: 'array', schemaType: 'object', errors: true, validate: sumEqualsKeyword });
  ajv.addKeyword({ keyword: 'x-accept', type: 'object', schemaType: 'array', errors: true, validate: acceptKeyword });
  for (const keyword of ['x-fieldType', 'x-currency', 'x-totals', 'x-maxBytes']) ajv.addKeyword({ keyword });
  return ajv;
}

let sharedAjv: GmsAjv | undefined;
const validatorCache = new WeakMap<JsonSchema, ValidateFunction>();

function validatorFor(schema: JsonSchema, ajv?: GmsAjv): ValidateFunction {
  if (ajv) return ajv.compile(schema);
  const hit = validatorCache.get(schema);
  if (hit) return hit;
  sharedAjv ??= createAjv();
  const fn = sharedAjv.compile(schema);
  sharedAjv.removeSchema(schema); // keep the shared instance from holding every schema forever
  validatorCache.set(schema, fn);
  return fn;
}

// ---------------------------------------------------------------------------
// Visibility, totals, eligibility
// ---------------------------------------------------------------------------

function isVisible(meta: FieldMeta, data: ResponseData): boolean {
  return !meta.visibleWhen || evaluateCondition(meta.visibleWhen, data);
}

/**
 * Ids of the fields an applicant can see right now, in form order. Answers to hidden fields are
 * treated as blank when deciding other fields' visibility (so a hidden chain stays hidden).
 */
export function visibleFields(compiled: CompiledForm, data: ResponseData): string[] {
  const pruned = pruneEmpty(data);
  const ids = Object.keys(compiled.fieldMeta);
  let visible = new Set(ids);
  for (let i = 0; i <= ids.length; i++) {
    const effective = withoutHidden(compiled, pruned, visible);
    const next = new Set(ids.filter((id) => isVisible(compiled.fieldMeta[id]!, effective)));
    if (next.size === visible.size && [...next].every((id) => visible.has(id))) break;
    visible = next;
  }
  return ids.filter((id) => visible.has(id));
}

function withoutHidden(compiled: CompiledForm, data: ResponseData, visible: ReadonlySet<string>): ResponseData {
  const out: ResponseData = {};
  for (const [k, v] of Object.entries(data)) if (!compiled.fieldMeta[k] || visible.has(k)) out[k] = v;
  return out;
}

/** Ids of visible fields that are required right now (always required, or their requiredWhen is true). */
export function requiredFields(compiled: CompiledForm, data: ResponseData): string[] {
  const pruned = pruneEmpty(data);
  const visible = visibleFields(compiled, pruned);
  const effective = withoutHidden(compiled, pruned, new Set(visible));
  return visible.filter((id) => {
    const m = compiled.fieldMeta[id]!;
    if (m.disabled) return false;
    if (m.enabledWhen && !evaluateCondition(m.enabledWhen, effective)) return false;
    return m.required || (m.requiredWhen ? evaluateCondition(m.requiredWhen, effective) : false);
  });
}

/** Column totals for every repeater table: `{ budget_lines: { amount: 2500000 } }` (currency in cents). */
export function computeTotals(compiled: CompiledForm, data: ResponseData): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, meta] of Object.entries(compiled.fieldMeta)) {
    if (meta.type !== 'repeater_table' || !meta.columns) continue;
    const rows = Array.isArray(data[id]) ? (data[id] as unknown[]) : [];
    const totals: Record<string, number> = {};
    for (const col of meta.columns) {
      if (col.type !== 'number' && col.type !== 'currency') continue;
      let sum = 0;
      for (const row of rows) if (isPlainObject(row) && typeof row[col.id] === 'number' && Number.isFinite(row[col.id])) sum += row[col.id] as number;
      totals[col.id] = col.type === 'currency' ? Math.round(sum) : sum;
    }
    out[id] = totals;
  }
  return out;
}

export interface Knockout {
  fieldId: string;
  pageId: string;
  message: string;
}

/** Eligibility knock-outs triggered by the current answers (visible fields only). */
export function checkEligibility(compiled: CompiledForm, data: ResponseData): Knockout[] {
  const pruned = pruneEmpty(data);
  const out: Knockout[] = [];
  for (const id of visibleFields(compiled, pruned)) {
    const m = compiled.fieldMeta[id]!;
    if (!m.eligibility || pruned[id] === undefined) continue;
    if (testValue(pruned[id], m.eligibility.op, m.eligibility.value)) out.push({ fieldId: id, pageId: m.pageId, message: m.eligibility.message });
  }
  return out;
}

// ---------------------------------------------------------------------------
// validateResponses
// ---------------------------------------------------------------------------

export type ValidationMode = 'save' | 'submit';

export interface ResponseError {
  /** JSON Pointer into the response data, e.g. `/budget_lines/0/amount`. */
  pointer: string;
  fieldId: string;
  pageId: string;
  message: string;
  /** The rule that failed (`required`, `maxWords`, `x-sumEquals`, …). */
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ResponseError[];
  /** Eligibility knock-outs (reported separately; they do not make the data invalid). */
  knockouts: Knockout[];
}

/** Rules about completeness. Drafts (`save`) may break them; `submit` enforces them. */
const COMPLETION_KEYWORDS = new Set(['required', 'minItems', 'const', 'x-sumEquals']);

/**
 * Validates answers against a compiled form.
 *
 * - `save`: drafts. Missing answers, too few rows, unchecked attestations and budget totals that
 *   don't match yet are fine; formats and limits (word counts, amounts, file types) are enforced.
 * - `submit`: everything, including conditional requirements and attestations.
 *
 * Hidden fields are never required and their answers are ignored.
 */
export function validateResponses(
  compiled: CompiledForm,
  data: ResponseData,
  opts: { mode: ValidationMode; ajv?: GmsAjv } = { mode: 'submit' },
): ValidationResult {
  const pruned = pruneEmpty(data);
  const visible = new Set(visibleFields(compiled, pruned));
  const effective = withoutHidden(compiled, pruned, visible);
  const validate = validatorFor(compiled.jsonSchema, opts.ajv);
  validate(effective);

  const errors: ResponseError[] = [];
  const seen = new Set<string>();
  for (const e of validate.errors ?? []) {
    if (e.keyword === 'if') continue; // the failing `then` reports its own errors
    if (/\/oneOf\/\d+\//.test(e.schemaPath)) continue; // branch noise; the oneOf error itself is kept
    if (opts.mode === 'save' && COMPLETION_KEYWORDS.has(e.keyword)) continue;
    const mapped = mapError(compiled, e, effective);
    if (!mapped || seen.has(mapped.pointer)) continue;
    seen.add(mapped.pointer);
    errors.push(mapped);
  }
  const orderOf = (id: string) => compiled.fieldMeta[id]?.order ?? Number.MAX_SAFE_INTEGER;
  errors.sort((a, b) => orderOf(a.fieldId) - orderOf(b.fieldId));
  return { valid: errors.length === 0, errors, knockouts: checkEligibility(compiled, effective) };
}

function mapError(compiled: CompiledForm, e: ErrorObject, data: ResponseData): ResponseError | undefined {
  let segments = parsePointer(e.instancePath);
  if (e.keyword === 'required') segments = [...segments, String((e.params as { missingProperty: string }).missingProperty)];
  const fieldId = segments[0];
  if (!fieldId) return undefined;
  const meta = compiled.fieldMeta[fieldId];
  if (!meta) return undefined;
  // File errors point at the file, not its internal size/name properties.
  if (meta.type === 'file_upload') {
    const last = segments[segments.length - 1];
    if (last === 'size' || last === 'name' || last === 'fileId' || last === 'mimeType') segments = segments.slice(0, -1);
  }
  const pointer = toPointer(segments);
  const message = friendlyMessage(compiled, meta, e, segments.slice(1), data);
  return { pointer, fieldId, pageId: meta.pageId, message, keyword: e.keyword };
}

// ---------------------------------------------------------------------------
// Friendly messages
// ---------------------------------------------------------------------------

const TRY_AGAIN = "This answer doesn't look right. Please check it and try again.";

function friendlyMessage(compiled: CompiledForm, meta: FieldMeta, e: ErrorObject, sub: string[], data: ResponseData): string {
  const params = e.params as Record<string, unknown>;
  const schema = (e.parentSchema ?? {}) as JsonSchema;
  const value = getAtPointer(data, e.instancePath);
  const fieldType = schema['x-fieldType'] ?? subFieldType(meta, sub);
  switch (e.keyword) {
    case 'required':
      return requiredMessage(meta, sub);
    case 'maxWords':
      return `Keep this under ${Number(params.limit)} words (you have ${Number(params.count)}).`;
    case 'maxLength': {
      const len = typeof value === 'string' ? [...value].length : 0;
      return `Keep this under ${Number(params.limit)} characters (you have ${len}).`;
    }
    case 'minLength':
      return `Please add at least ${plural(Number(params.limit), 'character')}.`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      if (meta.type === 'file_upload') {
        const size = typeof value === 'number' ? value : 0;
        return `This file is ${formatBytes(size)}, and the limit is ${formatBytes(Number(params.limit))}. Try saving a smaller version or compressing it, then upload it again.`;
      }
      return rangeMessage(schema, fieldType === 'currency' ? meta.currency ?? schema['x-currency'] ?? 'USD' : undefined);
    case 'type':
      return typeMessage(String(params.type), fieldType, meta, sub);
    case 'pattern':
      return patternMessage(fieldType, schema.title);
    case 'format':
      if (params.format === 'email') return 'Enter an email address, like name@example.org.';
      if (params.format === 'date') return 'Enter a real date, like 2027-03-15.';
      return TRY_AGAIN;
    case 'formatMinimum':
      return `Pick a date on or after ${formatIsoDate(String(schema.formatMinimum ?? params.limit))}.`;
    case 'formatMaximum':
      return `Pick a date on or before ${formatIsoDate(String(schema.formatMaximum ?? params.limit))}.`;
    case 'oneOf':
    case 'enum':
      return meta.type === 'yes_no' ? 'Please choose Yes or No.' : 'Please pick one of the choices listed.';
    case 'uniqueItems':
      return 'You picked the same choice twice. Please remove the extra one.';
    case 'maxItems': {
      const limit = Number(params.limit);
      const n = Array.isArray(value) ? value.length : 0;
      if (meta.type === 'repeater_table') return `You can add up to ${plural(limit, 'row')}. Please remove ${plural(n - limit, 'row')} to continue.`;
      if (meta.type === 'file_upload') return `You can upload up to ${plural(limit, 'file')}. Please remove ${n - limit} to continue.`;
      return `Please pick no more than ${plural(limit, 'choice')}.`;
    }
    case 'minItems': {
      const limit = Number(params.limit);
      if (meta.type === 'repeater_table') return `Please add at least ${plural(limit, 'row')}.`;
      return `Please pick at least ${plural(limit, 'choice')}.`;
    }
    case 'const':
      return 'Please check the box to confirm the statement is true.';
    case 'x-sumEquals':
      return sumMessage(compiled, meta, params);
    case 'x-accept': {
      const accept = Array.isArray(params.accept) ? (params.accept as string[]).map((a) => a.toUpperCase()) : [];
      return `This file type isn't accepted here. Please upload a ${listJoin(accept, 'or')} file.`;
    }
    default:
      return TRY_AGAIN;
  }
}

function subFieldType(meta: FieldMeta, sub: string[]): FieldMeta['type'] {
  if (meta.type === 'repeater_table' && sub.length >= 2) return meta.columns?.find((c) => c.id === sub[1])?.type ?? meta.type;
  return meta.type;
}

const ADDRESS_PARTS: Record<string, string> = { line1: 'street address', line2: 'apartment, suite, or unit', city: 'city', state: 'state', postal: 'ZIP code', county: 'county' };

function requiredMessage(meta: FieldMeta, sub: string[]): string {
  if (sub.length === 0) {
    switch (meta.type) {
      case 'select':
      case 'yes_no':
        return 'Please choose an answer.';
      case 'multi_select':
      case 'checkbox_group':
        return 'Please choose at least one option.';
      case 'file_upload':
        return 'Please upload a file.';
      case 'repeater_table':
        return 'Please add at least one row.';
      case 'attestation':
        return 'Please read the statement, check the box, and type your full name to sign.';
      case 'likert_matrix':
        return 'Please choose an answer for each row.';
      case 'name':
        return 'Please enter a first and last name.';
      case 'address':
        return 'Please enter the full address.';
      case 'ein':
        return 'Please enter the EIN, like 12-3456789.';
      case 'uei':
        return 'Please enter the 12-character UEI.';
      case 'email':
        return 'Please enter an email address, like name@example.org.';
      case 'phone':
        return 'Please enter a phone number with area code.';
      case 'currency':
        return 'Please enter an amount in dollars.';
      case 'number':
        return 'Please enter a number.';
      case 'date':
        return 'Please pick a date.';
      default:
        return 'Please answer this question.';
    }
  }
  const [part, col] = sub;
  switch (meta.type) {
    case 'name':
      return part === 'first' ? 'Please add a first name.' : 'Please add a last name.';
    case 'address':
      return `Please add the ${ADDRESS_PARTS[part ?? ''] ?? 'missing part of the address'}.`;
    case 'attestation':
      return part === 'agreed' ? 'Please check the box to confirm the statement is true.' : 'Please type your full name to sign.';
    case 'likert_matrix': {
      const row = meta.rows?.find((r) => r.id === part);
      return row ? `Please choose an answer for “${row.label}.”` : 'Please choose an answer for each row.';
    }
    case 'repeater_table': {
      const column = meta.columns?.find((c) => c.id === col);
      const rowNo = Number(part) + 1;
      return column ? `Please fill in the ${column.label.toLowerCase()} for row ${rowNo}.` : `Please finish row ${rowNo}.`;
    }
    case 'file_upload':
      return 'Something went wrong with this file. Please upload it again.';
    default:
      return 'Please answer this question.';
  }
}

function rangeMessage(schema: JsonSchema, currency: string | undefined): string {
  const min = schema.minimum ?? schema.exclusiveMinimum;
  const max = schema.maximum ?? schema.exclusiveMaximum;
  const fmt = (n: number) => (currency ? money(n, currency) : n.toLocaleString('en-US'));
  if (currency) {
    if (min !== undefined && max !== undefined) return `Enter an amount between ${fmt(min)} and ${fmt(max)}.`;
    if (min !== undefined) return `Enter an amount of at least ${fmt(min)}.`;
    if (max !== undefined) return `Enter an amount no more than ${fmt(max)}.`;
  }
  if (min !== undefined && max !== undefined) return `Enter a number between ${fmt(min)} and ${fmt(max)}.`;
  if (min !== undefined) return `Enter a number that is ${fmt(min)} or more.`;
  if (max !== undefined) return `Enter a number that is ${fmt(max)} or less.`;
  return TRY_AGAIN;
}

function typeMessage(expected: string, fieldType: string | undefined, meta: FieldMeta, sub: string[]): string {
  if (meta.type === 'attestation' && sub[0] === 'agreed') return 'Please check the box to confirm the statement is true.';
  if (fieldType === 'currency') return 'Enter a dollar amount, like 12,500.';
  if (fieldType === 'yes_no') return 'Please choose Yes or No.';
  if (expected.includes('integer')) return 'Enter a whole number, like 25.';
  if (expected.includes('number')) return 'Enter a number, like 25.';
  if (expected.includes('array')) return 'Please choose from the list.';
  if (expected.includes('object')) return 'Please fill in each part of this answer.';
  if (expected.includes('boolean')) return 'Please choose Yes or No.';
  return 'Please type your answer as text.';
}

function patternMessage(fieldType: string | undefined, title: string | undefined): string {
  if (fieldType === 'ein') return 'Enter the EIN as 9 digits in the format 12-3456789.';
  if (fieldType === 'uei') return 'Enter the 12-character UEI using capital letters and numbers, like A1B2C3D4E5F6.';
  if (fieldType === 'phone') return 'Enter a phone number with area code, like (555) 555-0123.';
  if (title === 'ZIP code') return 'Enter a 5-digit ZIP code, like 94110.';
  return 'Please check the format of this answer.';
}

function sumMessage(compiled: CompiledForm, meta: FieldMeta, params: Record<string, unknown>): string {
  const total = Number(params.total);
  const expected = Number(params.expected);
  const column = meta.columns?.find((c) => c.id === params.column);
  const target = compiled.fieldMeta[String(params.field)];
  const isMoney = column?.type === 'currency';
  const fmt = (n: number) => (isMoney ? money(n, column?.currency ?? 'USD') : n.toLocaleString('en-US'));
  const noun = typeof params.noun === 'string' && params.noun ? params.noun : `${meta.label.toLowerCase()} rows`;
  const asked = target && (target.cgMapping === 'funding.requestedAmount' || /request/i.test(target.label));
  const targetPhrase = asked ? `you asked for ${fmt(expected)}` : `“${target?.label ?? String(params.field)}” is ${fmt(expected)}`;
  return `Your ${noun} add up to ${fmt(total)}, but ${targetPhrase}. Make them match.`;
}
