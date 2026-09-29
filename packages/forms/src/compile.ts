// SPDX-License-Identifier: AGPL-3.0-or-later
// Compiles a builder model into JSON Schema (2020-12), a JSON Forms UI schema (one Category per
// page), field_meta and CommonGrants mappings. Output is deterministic: it depends only on the
// model's content (never on input key order), and keys are inserted in a fixed order.
import {
  type Categorization,
  type Category,
  type ControlElement,
  type GroupLayout,
  type LabelElement,
  type Rule,
  RuleEffect,
  type UISchemaElement,
  type VerticalLayout,
} from '@jsonforms/core';
import { cgTransformFor } from './cg';
import { andConditions, foldCondition, foldedToSchema } from './conditions';
import {
  type Column,
  type Condition,
  type Field,
  type FieldEligibilityRule,
  type FieldType,
  type FormModel,
  type FormModelInput,
  FormModelSchema,
  type InfoBlock,
  isField,
  type Option,
  type Section,
  type SumEquals,
} from './model';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** The subset of JSON Schema 2020-12 GMS emits, plus its `x-` extension keywords. */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  contains?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  formatMinimum?: string;
  formatMaximum?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  additionalProperties?: boolean | JsonSchema;
  /** Custom keyword: maximum number of words in a string. */
  maxWords?: number;
  'x-fieldType'?: FieldType;
  'x-currency'?: string;
  'x-totals'?: string[];
  'x-maxBytes'?: number;
  /** Custom keyword: a repeater column's total must equal another field's value. */
  'x-sumEquals'?: SumEquals;
  /** Custom keyword: allowed file extensions for a file object. */
  'x-accept'?: string[];
}

export type CgTransform = 'identity' | 'money' | 'name' | 'address';
export interface CgMappingEntry {
  path: string;
  transform: CgTransform;
}
export interface CgReverseMappingEntry {
  fieldId: string;
  transform: CgTransform;
}

export interface ColumnMeta {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: Option[];
  currency?: string;
}

/** Stored in `form_versions.field_meta`, keyed by field id (which is also the data key). */
export interface FieldMeta {
  type: FieldType;
  label: string;
  help?: string;
  pageId: string;
  sectionId?: string;
  /** 0-based position across the form. */
  order: number;
  /** Always required (when visible and enabled). */
  required: boolean;
  /** Required only when this condition is true (flags already resolved). */
  requiredWhen?: Condition;
  /** Effective visibility, including the section's rule (flags already resolved). */
  visibleWhen?: Condition;
  enabledWhen?: Condition;
  /** Never editable in this version (a flag turned it off). */
  disabled?: boolean;
  /** Hidden from reviewers in blind stages (`gms.reviewer_submission` masks these keys). */
  blind: boolean;
  reviewerNotes?: string;
  cgMapping?: string;
  eligibility?: FieldEligibilityRule;
  indicator?: string;
  options?: Option[];
  currency?: string;
  maxWords?: number;
  maxLength?: number;
  columns?: ColumnMeta[];
  sumEquals?: SumEquals;
  rows?: { id: string; label: string }[];
  scale?: Option[];
  statement?: string;
  accept?: string[];
  maxBytes?: number;
}

export interface CompiledPage {
  id: string;
  title: string;
  description?: string;
  fieldIds: string[];
}

export interface CompiledForm {
  title: string;
  description?: string;
  jsonSchema: JsonSchema;
  uiSchema: Categorization;
  fieldMeta: Record<string, FieldMeta>;
  /** field id → CG path (+ value transform). */
  mappingToCg: Record<string, CgMappingEntry>;
  /** CG path → field id. When two fields share a path, the first one in the form wins. */
  mappingFromCg: Record<string, CgReverseMappingEntry>;
  pages: CompiledPage[];
}

export class FormCompileError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'FormCompileError';
  }
}

export const PHONE_PATTERN = '^[+(]?[0-9][0-9(). -]{5,20}[0-9]$';
export const EIN_PATTERN = '^\\d{2}-\\d{7}$';
export const UEI_PATTERN = '^[A-Z0-9]{12}$';
export const POSTAL_PATTERN = '^\\d{5}(-\\d{4})?$';

function optionsSchema(options: readonly Option[]): Pick<JsonSchema, 'oneOf'> {
  // An empty oneOf is not valid JSON Schema; the linter reports selects without options.
  return options.length ? { oneOf: options.map((o) => ({ const: o.value, title: o.label })) } : {};
}

function fileObjectSchema(accept: readonly string[], maxBytes: number): JsonSchema {
  return {
    type: 'object',
    properties: {
      fileId: { type: 'string', title: 'File' },
      name: { type: 'string', title: 'File name' },
      size: { type: 'integer', minimum: 0, maximum: maxBytes, title: 'File size' },
      mimeType: { type: 'string', title: 'File type' },
    },
    required: ['fileId', 'name'],
    ...(accept.length ? { 'x-accept': [...accept].map((a) => a.replace(/^\./, '').toLowerCase()) } : {}),
  };
}

/** The shape/format/limit schema of an answer (no completeness rules). */
function shapeSchema(field: Field | Column): JsonSchema {
  const head: JsonSchema = { title: field.label, ...(field.help ? { description: field.help } : {}), 'x-fieldType': field.type };
  switch (field.type) {
    case 'text':
      return { ...head, type: 'string', ...(field.maxLength ? { maxLength: field.maxLength } : {}) };
    case 'long_text':
      return { ...head, type: 'string', ...(field.maxLength ? { maxLength: field.maxLength } : {}), ...(field.maxWords ? { maxWords: field.maxWords } : {}) };
    case 'rich_text':
      return { ...head, type: 'string', ...(field.maxWords ? { maxWords: field.maxWords } : {}) };
    case 'number':
      return {
        ...head,
        type: field.integer ? 'integer' : 'number',
        ...(field.min !== undefined ? { minimum: field.min } : {}),
        ...(field.max !== undefined ? { maximum: field.max } : {}),
      };
    case 'currency':
      return {
        ...head,
        type: 'integer',
        ...(field.min !== undefined ? { minimum: field.min } : {}),
        ...(field.max !== undefined ? { maximum: field.max } : {}),
        'x-currency': field.currency,
      };
    case 'date':
      return {
        ...head,
        type: 'string',
        format: 'date',
        ...(field.min ? { formatMinimum: field.min } : {}),
        ...(field.max ? { formatMaximum: field.max } : {}),
      };
    case 'select':
      return { ...head, type: 'string', ...optionsSchema(field.options) };
    case 'multi_select':
    case 'checkbox_group':
      return {
        ...head,
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', ...optionsSchema(field.options) },
        ...(field.maxSelections ? { maxItems: field.maxSelections } : {}),
      };
    case 'yes_no':
      return { ...head, type: 'boolean', oneOf: [{ const: true, title: 'Yes' }, { const: false, title: 'No' }] };
    case 'name':
      return {
        ...head,
        type: 'object',
        properties: {
          first: { type: 'string', title: 'First name', maxLength: 100 },
          last: { type: 'string', title: 'Last name', maxLength: 100 },
        },
      };
    case 'address':
      return {
        ...head,
        type: 'object',
        properties: {
          line1: { type: 'string', title: 'Street address', maxLength: 200 },
          line2: { type: 'string', title: 'Apartment, suite, or unit', maxLength: 200 },
          city: { type: 'string', title: 'City', maxLength: 100 },
          state: { type: 'string', title: 'State', maxLength: 50 },
          postal: { type: 'string', title: 'ZIP code', pattern: POSTAL_PATTERN },
          county: { type: 'string', title: 'County', maxLength: 100 },
        },
      };
    case 'email':
      return { ...head, type: 'string', format: 'email', maxLength: 254 };
    case 'phone':
      return { ...head, type: 'string', pattern: PHONE_PATTERN };
    case 'ein':
      return { ...head, type: 'string', pattern: EIN_PATTERN };
    case 'uei':
      return { ...head, type: 'string', pattern: UEI_PATTERN };
    case 'file_upload': {
      const file = fileObjectSchema(field.accept, field.maxBytes);
      const common = { ...head, 'x-maxBytes': field.maxBytes };
      if (field.multiple) return { ...common, type: 'array', items: file, ...(field.maxFiles ? { maxItems: field.maxFiles } : {}) };
      return { ...common, ...file, title: field.label };
    }
    case 'repeater_table': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const col of field.columns) {
        properties[col.id] = shapeSchema(col);
        if (col.required) required.push(col.id);
      }
      const totals = field.totals ? field.columns.filter((c) => c.type === 'number' || c.type === 'currency').map((c) => c.id) : [];
      return {
        ...head,
        type: 'array',
        items: { type: 'object', properties, ...(required.length ? { required } : {}) },
        ...(field.minRows ? { minItems: field.minRows } : {}),
        ...(field.maxRows ? { maxItems: field.maxRows } : {}),
        ...(totals.length ? { 'x-totals': totals } : {}),
        ...(field.sumEquals ? { 'x-sumEquals': { ...field.sumEquals } } : {}),
      };
    }
    case 'likert_matrix': {
      const properties: Record<string, JsonSchema> = {};
      for (const row of field.rows) properties[row.id] = { type: 'string', title: row.label, ...optionsSchema(field.scale) };
      return { ...head, type: 'object', properties };
    }
    case 'attestation':
      return {
        ...head,
        description: field.statement,
        type: 'object',
        properties: {
          agreed: { type: 'boolean', title: 'I confirm this statement is true' },
          ...(field.requireName ? { name: { type: 'string', title: 'Your full name', maxLength: 200 } } : {}),
        },
      };
  }
}

/** Extra rules that apply only when the answer is required (merged into the property or a `then`). */
function completionSchema(field: Field): JsonSchema | undefined {
  switch (field.type) {
    case 'name':
      return { required: ['first', 'last'] };
    case 'address':
      return { required: ['line1', 'city', 'state', 'postal'] };
    case 'likert_matrix':
      return field.rows.length ? { required: field.rows.map((r) => r.id) } : undefined;
    case 'attestation':
      return { required: field.requireName ? ['agreed', 'name'] : ['agreed'], properties: { agreed: { const: true } } };
    default:
      return undefined;
  }
}

function mergeSchemas(a: JsonSchema, b: JsonSchema | undefined): JsonSchema {
  if (!b) return a;
  const out: JsonSchema = { ...a };
  if (b.required) out.required = [...new Set([...(a.required ?? []), ...b.required])];
  if (b.properties) {
    const props: Record<string, JsonSchema> = { ...(a.properties ?? {}) };
    for (const [k, v] of Object.entries(b.properties)) props[k] = mergeSchemas(props[k] ?? {}, v);
    out.properties = props;
  }
  for (const [k, v] of Object.entries(b) as [keyof JsonSchema, unknown][]) {
    if (k === 'required' || k === 'properties') continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function makeRule(effect: 'SHOW' | 'ENABLE', cond: Condition | false): Rule {
  return {
    effect: effect === 'SHOW' ? RuleEffect.SHOW : RuleEffect.ENABLE,
    condition: { scope: '#', schema: foldedToSchema(cond) } as Rule['condition'],
  };
}

function controlOptions(field: Field): Record<string, unknown> {
  const o: Record<string, unknown> = { fieldType: field.type };
  if (field.help) o.help = field.help;
  switch (field.type) {
    case 'text':
      if (field.maxLength) o.maxLength = field.maxLength;
      if (field.placeholder) o.placeholder = field.placeholder;
      break;
    case 'long_text':
      o.multi = true;
      if (field.maxWords) o.maxWords = field.maxWords;
      break;
    case 'rich_text':
      o.multi = true;
      o.richText = true;
      if (field.maxWords) o.maxWords = field.maxWords;
      break;
    case 'number':
      if (field.unit) o.unit = field.unit;
      break;
    case 'currency':
      o.currency = field.currency;
      o.cents = true;
      break;
    case 'select':
      if (field.display === 'radio') o.format = 'radio';
      break;
    case 'yes_no':
      o.format = 'radio';
      break;
    case 'file_upload':
      o.accept = field.accept;
      o.maxBytes = field.maxBytes;
      o.multiple = field.multiple;
      break;
    case 'repeater_table':
      o.detail = {
        type: 'HorizontalLayout',
        elements: field.columns.map((c) => ({ type: 'Control', scope: `#/properties/${c.id}`, label: c.label, options: { fieldType: c.type } })),
      };
      if (field.addLabel) o.addLabel = field.addLabel;
      if (field.sumEquals) o.sumEquals = { ...field.sumEquals };
      o.showTotals = field.totals;
      break;
    case 'attestation':
      o.statement = field.statement;
      o.requireName = field.requireName;
      break;
    default:
      break;
  }
  return o;
}

function fieldMeta(
  field: Field,
  ctx: { pageId: string; section?: Section; order: number; required: boolean; requiredWhen?: Condition; visibleWhen?: Condition; enabledWhen?: Condition; disabled: boolean },
): FieldMeta {
  const m: FieldMeta = {
    type: field.type,
    label: field.label,
    ...(field.help ? { help: field.help } : {}),
    pageId: ctx.pageId,
    ...(ctx.section ? { sectionId: ctx.section.id } : {}),
    order: ctx.order,
    required: ctx.required,
    ...(ctx.requiredWhen ? { requiredWhen: ctx.requiredWhen } : {}),
    ...(ctx.visibleWhen ? { visibleWhen: ctx.visibleWhen } : {}),
    ...(ctx.enabledWhen ? { enabledWhen: ctx.enabledWhen } : {}),
    ...(ctx.disabled ? { disabled: true } : {}),
    blind: field.blind,
    ...(field.reviewerNotes ? { reviewerNotes: field.reviewerNotes } : {}),
    ...(field.cgMapping ? { cgMapping: field.cgMapping } : {}),
    ...(field.eligibility ? { eligibility: { ...field.eligibility } } : {}),
    ...(field.indicator ? { indicator: field.indicator } : {}),
  };
  switch (field.type) {
    case 'text':
      if (field.maxLength) m.maxLength = field.maxLength;
      break;
    case 'long_text':
    case 'rich_text':
      if (field.maxWords) m.maxWords = field.maxWords;
      break;
    case 'currency':
      m.currency = field.currency;
      break;
    case 'select':
    case 'multi_select':
    case 'checkbox_group':
      m.options = field.options.map((o) => ({ value: o.value, label: o.label }));
      break;
    case 'repeater_table':
      m.columns = field.columns.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
        required: c.required,
        ...(c.type === 'select' ? { options: c.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
        ...(c.type === 'currency' ? { currency: c.currency } : {}),
      }));
      if (field.sumEquals) m.sumEquals = { ...field.sumEquals };
      break;
    case 'likert_matrix':
      m.rows = field.rows.map((r) => ({ id: r.id, label: r.label }));
      m.scale = field.scale.map((o) => ({ value: o.value, label: o.label }));
      break;
    case 'attestation':
      m.statement = field.statement;
      break;
    case 'file_upload':
      m.accept = [...field.accept];
      m.maxBytes = field.maxBytes;
      break;
    default:
      break;
  }
  return m;
}

/** Compiles a builder model. Throws FormCompileError when field ids collide (answers would overwrite each other). */
export function compileForm(input: FormModel | FormModelInput): CompiledForm {
  const model = FormModelSchema.parse(input);
  const flags = model.flags;

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const page of model.pages)
    for (const el of page.elements) {
      const kids = el.type === 'section' ? el.elements : [el];
      for (const k of kids) {
        if (!isField(k)) continue;
        if (seen.has(k.id)) dupes.push(k.id);
        seen.add(k.id);
      }
    }
  if (dupes.length) throw new FormCompileError(`Two questions share the id "${dupes[0]}". Give each question its own id.`, dupes);

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const allOf: JsonSchema[] = [];
  const meta: Record<string, FieldMeta> = {};
  const mappingToCg: Record<string, CgMappingEntry> = {};
  const mappingFromCg: Record<string, CgReverseMappingEntry> = {};
  const pages: CompiledPage[] = [];
  const categories: Category[] = [];
  let order = 0;

  const compileField = (field: Field, pageId: string, section: Section | undefined, sectionVisible: Condition | boolean): UISchemaElement | undefined => {
    const ownVisible = foldCondition(field.visibleWhen, flags);
    const visible = andConditions([sectionVisible, ownVisible]);
    if (visible === false) return undefined; // never shown in this version (e.g. a flag is off)
    const enabled = foldCondition(field.enabledWhen, flags);
    const req = field.required ? true : field.requiredWhen ? foldCondition(field.requiredWhen, flags) : false;

    const shape = shapeSchema(field);
    const completion = completionSchema(field);
    const effective = andConditions([req, visible, enabled]);
    if (effective === true) {
      required.push(field.id);
      properties[field.id] = mergeSchemas(shape, completion);
    } else {
      properties[field.id] = shape;
      if (effective !== false) {
        allOf.push({
          if: foldedToSchema(effective),
          then: { required: [field.id], ...(completion ? { properties: { [field.id]: completion } } : {}) },
        });
      }
    }

    meta[field.id] = fieldMeta(field, {
      pageId,
      section,
      order: order++,
      required: req === true,
      ...(typeof req === 'object' ? { requiredWhen: req } : {}),
      ...(typeof visible === 'object' ? { visibleWhen: visible } : {}),
      ...(typeof enabled === 'object' ? { enabledWhen: enabled } : {}),
      disabled: enabled === false,
    });

    if (field.cgMapping) {
      const transform = cgTransformFor(field.type, field.cgMapping);
      mappingToCg[field.id] = { path: field.cgMapping, transform };
      if (!mappingFromCg[field.cgMapping]) mappingFromCg[field.cgMapping] = { fieldId: field.id, transform };
    }

    const control: ControlElement = {
      type: 'Control',
      scope: `#/properties/${field.id}`,
      label: field.label,
      options: controlOptions(field),
    };
    // The section's rule lives on its Group; the field's own rules live on the control.
    const showRule = typeof ownVisible === 'object' ? ownVisible : undefined;
    if (enabled !== true) control.rule = makeRule('ENABLE', enabled);
    if (showRule && control.rule) {
      const wrapper: VerticalLayout = { type: 'VerticalLayout', elements: [control], rule: makeRule('SHOW', showRule) };
      return wrapper;
    }
    if (showRule) control.rule = makeRule('SHOW', showRule);
    return control;
  };

  const compileInfo = (block: InfoBlock, sectionVisible: Condition | boolean): UISchemaElement | undefined => {
    const own = foldCondition(block.visibleWhen, flags);
    if (andConditions([sectionVisible, own]) === false) return undefined;
    const label: LabelElement = {
      type: 'Label',
      text: block.markdown,
      options: { markdown: true, blockId: block.id, ...(block.title ? { title: block.title } : {}) },
    };
    if (typeof own === 'object') label.rule = makeRule('SHOW', own);
    return label;
  };

  for (const page of model.pages) {
    const elements: UISchemaElement[] = [];
    const fieldIds: string[] = [];
    for (const el of page.elements) {
      if (el.type === 'section') {
        const secVisible = foldCondition(el.visibleWhen, flags);
        if (secVisible === false) continue;
        const kids: UISchemaElement[] = [];
        for (const child of el.elements) {
          const ui = child.type === 'info_block' ? compileInfo(child, secVisible) : compileField(child, page.id, el, secVisible);
          if (!ui) continue;
          kids.push(ui);
          if (isField(child)) fieldIds.push(child.id);
        }
        const group: GroupLayout = {
          type: 'Group',
          label: el.title,
          elements: kids,
          options: { sectionId: el.id, ...(el.description ? { description: el.description } : {}) },
        };
        if (typeof secVisible === 'object') group.rule = makeRule('SHOW', secVisible);
        elements.push(group);
      } else if (el.type === 'info_block') {
        const ui = compileInfo(el, true);
        if (ui) elements.push(ui);
      } else {
        const ui = compileField(el, page.id, undefined, true);
        if (ui) {
          elements.push(ui);
          fieldIds.push(el.id);
        }
      }
    }
    categories.push({
      type: 'Category',
      label: page.title,
      elements,
      options: { pageId: page.id, ...(page.description ? { description: page.description } : {}) },
    });
    pages.push({ id: page.id, title: page.title, ...(page.description ? { description: page.description } : {}), fieldIds });
  }

  const jsonSchema: JsonSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    title: model.title,
    ...(model.description ? { description: model.description } : {}),
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    ...(allOf.length ? { allOf } : {}),
  };

  const uiSchema: Categorization = {
    type: 'Categorization',
    label: model.title,
    elements: categories,
    options: { variant: 'stepper', showNavButtons: true },
  };

  return {
    title: model.title,
    ...(model.description ? { description: model.description } : {}),
    jsonSchema,
    uiSchema,
    fieldMeta: meta,
    mappingToCg,
    mappingFromCg,
    pages,
  };
}
