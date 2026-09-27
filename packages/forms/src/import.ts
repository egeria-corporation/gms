// SPDX-License-Identifier: AGPL-3.0-only
// Best-effort import of CommonGrants form-library-style JSON (a JSON Schema + UI schema pair,
// optionally with `x-cg-mapping` hints or a `mappingToCommonGrants` block) into a builder model.
// Anything that can't be represented is reported, never silently dropped.
import { EIN_PATTERN, UEI_PATTERN } from './compile';
import {
  type Column,
  COLUMN_TYPES,
  ColumnSchema,
  type Condition,
  defineForm,
  type ElementInput,
  type FieldInput,
  type FormModel,
  type Option,
} from './model';
import { isPlainObject } from './util';

export interface CgFormLibraryDocument {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  jsonSchema?: unknown;
  /** Alternate key some exports use. */
  schema?: unknown;
  uiSchema?: unknown;
  uischema?: unknown;
  mappingToCommonGrants?: unknown;
  mappingFromCommonGrants?: unknown;
}

export interface ImportSkip {
  /** Where in the source the item was (a JSON Pointer into the JSON Schema or UI schema). */
  path: string;
  reason: string;
}

export interface ImportResult {
  model: FormModel;
  /** Source property → new field id. */
  mapped: { property: string; fieldId: string; type: string }[];
  /** Things that could not be imported. Review these by hand. */
  skipped: ImportSkip[];
  /** Imported, but with a change worth checking. */
  warnings: string[];
}

type Json = Record<string, unknown>;

function humanize(key: string): string {
  const s = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sanitizeId(key: string, taken: Set<string>): string {
  let id = key.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(id)) id = `f_${id}`;
  id = id.slice(0, 60);
  let candidate = id;
  let n = 2;
  while (taken.has(candidate)) candidate = `${id}_${n++}`;
  taken.add(candidate);
  return candidate;
}

function primaryType(schema: Json): string | undefined {
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.find((x): x is string => typeof x === 'string' && x !== 'null');
  if (Array.isArray(schema.enum) || Array.isArray(schema.oneOf)) return 'string';
  return undefined;
}

function enumOptions(schema: Json): Option[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum.filter((v) => typeof v === 'string' || typeof v === 'number').map((v) => ({ value: String(v), label: humanize(String(v)) }));
  if (Array.isArray(schema.oneOf)) {
    const opts: Option[] = [];
    for (const o of schema.oneOf) {
      if (!isPlainObject(o) || (typeof o.const !== 'string' && typeof o.const !== 'number')) return undefined;
      opts.push({ value: String(o.const), label: typeof o.title === 'string' ? o.title : humanize(String(o.const)) });
    }
    return opts;
  }
  return undefined;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

function hasKeys(schema: Json, keys: string[]): boolean {
  return isPlainObject(schema.properties) && keys.every((k) => k in (schema.properties as Json));
}

interface Converted {
  field?: FieldInput;
  reason?: string;
  warning?: string;
}

/** Converts one JSON Schema property into a builder field (or explains why it can't). */
function convertProperty(id: string, label: string, schema: Json, ui: Json | undefined, forColumn = false): Converted {
  const help = str(schema.description);
  const base = { id, label, ...(help ? { help } : {}) };
  const type = primaryType(schema);
  const options = isPlainObject(ui?.options) ? (ui.options as Json) : {};
  if (type === 'string') {
    const opts = enumOptions(schema);
    if (opts) return opts.length ? { field: { ...base, type: 'select', options: opts, ...(options.format === 'radio' ? { display: 'radio' } : {}) } } : { reason: 'The list of choices is empty.' };
    if (schema.contentEncoding || schema.contentMediaType || schema.format === 'data-url' || schema.format === 'binary') {
      return { reason: 'Files stored inside the answer are not supported. Add a file upload question instead.' };
    }
    if (schema.format === 'email') return { field: { ...base, type: 'email' } };
    if (schema.format === 'date') return { field: { ...base, type: 'date', ...(str(schema.formatMinimum) ? { min: schema.formatMinimum as string } : {}), ...(str(schema.formatMaximum) ? { max: schema.formatMaximum as string } : {}) } };
    if (schema.format === 'date-time') return { field: { ...base, type: 'date' }, warning: `“${label}” asked for a date and time; it now asks for a date only.` };
    if (schema.pattern === EIN_PATTERN || (/\bein\b/i.test(label) && typeof schema.pattern === 'string')) return { field: { ...base, type: 'ein' } };
    if (schema.pattern === UEI_PATTERN) return { field: { ...base, type: 'uei' } };
    const maxLength = num(schema.maxLength);
    const warning = typeof schema.pattern === 'string' ? `“${label}” had a custom format rule (${schema.pattern}) that was not imported.` : undefined;
    if (options.multi === true || (maxLength !== undefined && maxLength > 500)) {
      return { field: { ...base, type: 'long_text', ...(maxLength ? { maxLength } : {}) }, ...(warning ? { warning } : {}) };
    }
    return { field: { ...base, type: 'text', ...(maxLength ? { maxLength } : {}) }, ...(warning ? { warning } : {}) };
  }
  if (type === 'integer' || type === 'number') {
    const min = num(schema.minimum);
    const max = num(schema.maximum);
    return { field: { ...base, type: 'number', integer: type === 'integer', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } };
  }
  if (type === 'boolean') return { field: { ...base, type: 'yes_no' } };
  if (forColumn) return { reason: 'This kind of question cannot be a table column.' };
  if (type === 'array') {
    const items = isPlainObject(schema.items) ? (schema.items as Json) : undefined;
    if (!items) return { reason: 'The list has no item definition.' };
    const opts = enumOptions(items);
    if (opts) {
      const maxSelections = num(schema.maxItems);
      return {
        field: { ...base, type: options.format === 'checkbox' ? 'checkbox_group' : 'multi_select', options: opts, ...(maxSelections ? { maxSelections } : {}) },
      };
    }
    if (primaryType(items) === 'object' && isPlainObject(items.properties)) {
      const columns: Column[] = [];
      const dropped: string[] = [];
      const req = new Set(Array.isArray(items.required) ? items.required.filter((x): x is string => typeof x === 'string') : []);
      const taken = new Set<string>();
      for (const [k, v] of Object.entries(items.properties as Json)) {
        if (!isPlainObject(v)) continue;
        const cid = sanitizeId(k, taken);
        const c = convertProperty(cid, str(v.title) ?? humanize(k), v, undefined, true);
        if (c.field && (COLUMN_TYPES as readonly string[]).includes(c.field.type)) columns.push(ColumnSchema.parse({ ...c.field, required: req.has(k) }));
        else dropped.push(k);
      }
      if (!columns.length) return { reason: 'None of the table’s columns could be imported.' };
      const minRows = num(schema.minItems);
      const maxRows = num(schema.maxItems);
      return {
        field: { ...base, type: 'repeater_table', columns, ...(minRows ? { minRows } : {}), ...(maxRows ? { maxRows } : {}) },
        ...(dropped.length ? { warning: `The table “${label}” lost ${dropped.length} column(s) that could not be imported: ${dropped.join(', ')}.` } : {}),
      };
    }
    return { reason: 'Lists of this kind are not supported.' };
  }
  if (type === 'object') {
    if (hasKeys(schema, ['amount', 'currency'])) return { field: { ...base, type: 'currency' } };
    if (hasKeys(schema, ['firstName', 'lastName']) || hasKeys(schema, ['first', 'last'])) return { field: { ...base, type: 'name' } };
    if (hasKeys(schema, ['street1', 'city']) || hasKeys(schema, ['line1', 'city'])) return { field: { ...base, type: 'address' } };
    return { reason: 'Nested groups of questions are not supported. Rebuild them as separate questions.' };
  }
  return { reason: 'The question has no type GMS understands.' };
}

/** Reads `{ organization: { name: { field: 'orgName' } } }` into `[['organization.name', 'orgName']]`. */
function walkMapping(node: unknown, prefix: string[], out: [string, string][]): void {
  if (!isPlainObject(node)) return;
  if (typeof node.field === 'string') {
    out.push([prefix.join('.'), node.field]);
    return;
  }
  for (const [k, v] of Object.entries(node)) walkMapping(v, [...prefix, k], out);
}

function ruleToCondition(rule: unknown, idOf: (prop: string) => string | undefined): { kind: 'visibleWhen' | 'enabledWhen'; cond: Condition } | { error: string } {
  if (!isPlainObject(rule) || !isPlainObject(rule.condition)) return { error: 'The rule has no condition.' };
  const effect = rule.effect;
  const c = rule.condition as Json;
  const scope = typeof c.scope === 'string' ? c.scope : '';
  const m = /^#\/properties\/([^/]+)$/.exec(scope);
  if (!m || !isPlainObject(c.schema)) return { error: 'Only rules that check one top-level answer can be imported.' };
  const field = idOf(m[1]!);
  if (!field) return { error: `The rule checks “${m[1]}”, which was not imported.` };
  const s = c.schema as Json;
  const positive = effect === 'SHOW' || effect === 'ENABLE';
  const kind = effect === 'SHOW' || effect === 'HIDE' ? 'visibleWhen' : 'enabledWhen';
  if (effect !== 'SHOW' && effect !== 'HIDE' && effect !== 'ENABLE' && effect !== 'DISABLE') return { error: `Rules with the effect “${String(effect)}” are not supported.` };
  const scalar = (v: unknown): v is string | number | boolean | null => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if ('const' in s && scalar(s.const)) return { kind, cond: { field, op: positive ? 'eq' : 'neq', value: s.const } };
  if (Array.isArray(s.enum) && s.enum.every(scalar)) {
    if (!positive) return { error: '“Hide when one of several values” rules are not supported.' };
    return { kind, cond: { field, op: 'in', value: s.enum as (string | number | boolean | null)[] } };
  }
  return { error: 'The rule’s condition is too complex to import.' };
}

/** Imports a CommonGrants form-library-style JSON document into a builder model. */
export function importCommonGrantsForm(doc: CgFormLibraryDocument): ImportResult {
  const schema = (isPlainObject(doc.jsonSchema) ? doc.jsonSchema : isPlainObject(doc.schema) ? doc.schema : {}) as Json;
  const ui = (isPlainObject(doc.uiSchema) ? doc.uiSchema : isPlainObject(doc.uischema) ? doc.uischema : undefined) as Json | undefined;
  const title = str(doc.title) ?? str(doc.name) ?? str(schema.title) ?? 'Imported form';
  const props = (isPlainObject(schema.properties) ? schema.properties : {}) as Json;
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === 'string') : []);

  const skipped: ImportSkip[] = [];
  const warnings: string[] = [];
  const mapped: ImportResult['mapped'] = [];
  const taken = new Set<string>();
  const idByProp = new Map<string, string>();
  for (const key of Object.keys(props)) {
    const id = sanitizeId(key, taken);
    idByProp.set(key, id);
    if (id !== key) warnings.push(`The question “${key}” was given the id “${id}” (ids can only use letters, numbers and underscores).`);
  }
  // Page and section ids share the namespace with field ids.
  const structuralId = (base: string) => sanitizeId(base, taken);

  // CG mappings from the document-level blocks, then per-property hints (hints win).
  const cgByProp = new Map<string, string>();
  const toCg: [string, string][] = [];
  walkMapping(doc.mappingToCommonGrants, [], toCg);
  for (const [cgPath, fieldPath] of toCg) {
    if (fieldPath in props) cgByProp.set(fieldPath, cgPath);
    else skipped.push({ path: `/mappingToCommonGrants/${cgPath.replace(/\./g, '/')}`, reason: `The mapping points at “${fieldPath}”, which is not a top-level question.` });
  }
  const fromCg: [string, string][] = [];
  walkMapping(doc.mappingFromCommonGrants, [], fromCg);
  for (const [fieldPath, cgPath] of fromCg) if (fieldPath in props && !cgByProp.has(fieldPath)) cgByProp.set(fieldPath, cgPath);
  for (const [key, v] of Object.entries(props)) {
    if (isPlainObject(v) && typeof v['x-cg-mapping'] === 'string') cgByProp.set(key, v['x-cg-mapping']);
  }

  const placed = new Set<string>();
  const buildField = (key: string, control: Json | undefined): FieldInput | undefined => {
    const s = props[key];
    const id = idByProp.get(key)!;
    if (!isPlainObject(s)) {
      skipped.push({ path: `/properties/${key}`, reason: 'The question definition is not an object.' });
      return undefined;
    }
    const label = (typeof control?.label === 'string' && control.label.trim()) || str(s.title) || humanize(key);
    const c = convertProperty(id, label, s, control);
    if (!c.field) {
      skipped.push({ path: `/properties/${key}`, reason: c.reason ?? 'Unsupported question.' });
      return undefined;
    }
    if (c.warning) warnings.push(c.warning);
    const field: FieldInput = { ...c.field, required: required.has(key) };
    const cg = cgByProp.get(key);
    if (cg) field.cgMapping = cg;
    if (control?.rule !== undefined) {
      const r = ruleToCondition(control.rule, (p) => idByProp.get(p));
      if ('error' in r) skipped.push({ path: `/uiSchema/rule(${key})`, reason: `The rule on “${label}” was not imported. ${r.error}` });
      else field[r.kind] = r.cond;
    }
    mapped.push({ property: key, fieldId: id, type: field.type });
    return field;
  };

  const convertElements = (elements: unknown, path: string, inSection: boolean): ElementInput[] => {
    const out: ElementInput[] = [];
    if (!Array.isArray(elements)) return out;
    elements.forEach((el, i) => {
      if (!isPlainObject(el)) return;
      const here = `${path}/${i}`;
      if (el.type === 'Control') {
        const m = typeof el.scope === 'string' ? /^#\/properties\/([^/]+)$/.exec(el.scope) : null;
        if (!m || !(m[1]! in props)) {
          skipped.push({ path: here, reason: 'This control points at a nested or missing question.' });
          return;
        }
        if (placed.has(m[1]!)) return;
        placed.add(m[1]!);
        const f = buildField(m[1]!, el);
        if (f) out.push(f);
      } else if (el.type === 'Label') {
        if (typeof el.text === 'string' && el.text.trim()) out.push({ type: 'info_block', id: structuralId(`text_${i + 1}`), markdown: el.text });
      } else if (el.type === 'Group' && !inSection) {
        const kids = convertElements(el.elements, `${here}/elements`, true).filter((k): k is Exclude<ElementInput, { type: 'section' }> => k.type !== 'section');
        out.push({ type: 'section', id: structuralId(`section_${i + 1}`), title: typeof el.label === 'string' ? el.label : 'Section', elements: kids });
      } else if (el.type === 'VerticalLayout' || el.type === 'HorizontalLayout' || el.type === 'Group') {
        out.push(...convertElements(el.elements, `${here}/elements`, inSection));
      } else {
        skipped.push({ path: here, reason: `The layout element “${String(el.type)}” is not supported.` });
      }
    });
    return out;
  };

  const pages: { id: string; title: string; elements: ElementInput[] }[] = [];
  if (ui && ui.type === 'Categorization' && Array.isArray(ui.elements)) {
    ui.elements.forEach((cat, i) => {
      if (!isPlainObject(cat)) return;
      const label = typeof cat.label === 'string' && cat.label.trim() ? cat.label : `Page ${i + 1}`;
      pages.push({ id: structuralId(`page_${i + 1}`), title: label, elements: convertElements(cat.elements, `/uiSchema/elements/${i}/elements`, false) });
    });
  } else if (ui) {
    pages.push({ id: structuralId('page_1'), title, elements: convertElements(ui.type === 'Control' ? [ui] : ui.elements, '/uiSchema/elements', false) });
  }
  const leftovers: ElementInput[] = [];
  for (const key of Object.keys(props)) {
    if (placed.has(key)) continue;
    placed.add(key);
    const f = buildField(key, undefined);
    if (f) leftovers.push(f);
  }
  if (leftovers.length) {
    if (pages.length) pages.push({ id: structuralId('more_questions'), title: 'More questions', elements: leftovers });
    else pages.push({ id: structuralId('page_1'), title, elements: leftovers });
  }

  const model = defineForm({ version: 1, title, ...(str(doc.description) ? { description: doc.description } : {}), pages });
  return { model, mapped, skipped, warnings };
}
