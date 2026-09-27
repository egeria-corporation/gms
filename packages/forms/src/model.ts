// SPDX-License-Identifier: AGPL-3.0-only
// The builder model: the source of truth a staff member edits in the form builder.
// It is stored in `form_versions.builder_model` and compiled into JSON Schema,
// a JSON Forms UI schema, `field_meta` and CommonGrants mappings (see compile.ts).
import { z } from 'zod';

/** Field ids become data keys and JSON Pointer segments, so keep them simple. */
export const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// ---------------------------------------------------------------------------
// Conditions: a small structured rule language
// ---------------------------------------------------------------------------

export const CONDITION_OPS = ['eq', 'neq', 'in', 'gt', 'lt', 'truthy', 'falsy'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type ConditionScalar = string | number | boolean | null;
export type ConditionValue = ConditionScalar | ConditionScalar[];

/** Compares one answer with a value. `field` is another field's id. */
export interface FieldCondition {
  field: string;
  op: ConditionOp;
  value?: ConditionValue;
}
/**
 * True when a form-level flag (`model.flags[flag]`) is on. Flags are resolved when the form is
 * compiled, so a flag condition never reaches the applicant's browser.
 */
export interface FlagCondition {
  flag: string;
}
export interface AllCondition {
  all: Condition[];
}
export interface AnyCondition {
  any: Condition[];
}
export type Condition = FieldCondition | FlagCondition | AllCondition | AnyCondition;

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const ConditionValueSchema = z.union([ScalarSchema, z.array(ScalarSchema)]);

export const FieldConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(CONDITION_OPS),
  value: ConditionValueSchema.optional(),
});
export const FlagConditionSchema = z.object({ flag: z.string().min(1) });

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    FieldConditionSchema,
    FlagConditionSchema,
    z.object({ all: z.array(ConditionSchema).min(1) }),
    z.object({ any: z.array(ConditionSchema).min(1) }),
  ]),
);

export function isFieldCondition(c: Condition): c is FieldCondition {
  return 'field' in c;
}
export function isFlagCondition(c: Condition): c is FlagCondition {
  return 'flag' in c;
}
export function isAllCondition(c: Condition): c is AllCondition {
  return 'all' in c;
}
export function isAnyCondition(c: Condition): c is AnyCondition {
  return 'any' in c;
}

/** Every field id a condition reads (flags excluded). */
export function conditionFieldRefs(c: Condition | undefined): string[] {
  if (!c) return [];
  if (isFieldCondition(c)) return [c.field];
  if (isFlagCondition(c)) return [];
  const list = isAllCondition(c) ? c.all : c.any;
  return list.flatMap(conditionFieldRefs);
}

/** Every flag a condition reads. */
export function conditionFlagRefs(c: Condition | undefined): string[] {
  if (!c) return [];
  if (isFlagCondition(c)) return [c.flag];
  if (isFieldCondition(c)) return [];
  const list = isAllCondition(c) ? c.all : c.any;
  return list.flatMap(conditionFlagRefs);
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  'text',
  'long_text',
  'rich_text',
  'number',
  'currency',
  'date',
  'select',
  'multi_select',
  'checkbox_group',
  'yes_no',
  'name',
  'address',
  'email',
  'phone',
  'ein',
  'uei',
  'file_upload',
  'repeater_table',
  'likert_matrix',
  'attestation',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Types a repeater table column may use. */
export const COLUMN_TYPES = ['text', 'long_text', 'number', 'currency', 'date', 'select', 'yes_no', 'email', 'phone'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const OptionSchema = z.object({ value: z.string().min(1), label: z.string() });
export type Option = z.output<typeof OptionSchema>;

/** Knock-out rule on the field's own answer: when it matches, the applicant is not eligible. */
export const EligibilityRuleSchema = z.object({
  op: z.enum(CONDITION_OPS),
  value: ConditionValueSchema.optional(),
  message: z.string().min(1),
});
export type FieldEligibilityRule = z.output<typeof EligibilityRuleSchema>;

const base = {
  /** Stable id; becomes the key in the response data. Never reuse an id for a different question. */
  id: z.string().min(1),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean().default(false),
  /** Required only when this condition is true (and the field is visible). */
  requiredWhen: ConditionSchema.optional(),
  /** Shown only when this condition is true. Hidden fields are never required. */
  visibleWhen: ConditionSchema.optional(),
  /** Editable only when this condition is true. Disabled fields are never required. */
  enabledWhen: ConditionSchema.optional(),
  /** CommonGrants path such as `organization.ein`; drives prefill and CG export. */
  cgMapping: z.string().min(1).optional(),
  /** Hide this answer from reviewers in blind review stages. */
  blind: z.boolean().default(false),
  /** Staff-only guidance shown to reviewers next to the answer. */
  reviewerNotes: z.string().optional(),
  eligibility: EligibilityRuleSchema.optional(),
  /** Grantee-report indicator key this answer feeds (e.g. `youth_served`). */
  indicator: z.string().min(1).optional(),
};

const posInt = z.number().int().positive();

export const TextFieldSchema = z.object({ ...base, type: z.literal('text'), maxLength: posInt.optional(), placeholder: z.string().optional() });
export const LongTextFieldSchema = z.object({ ...base, type: z.literal('long_text'), maxWords: posInt.optional(), maxLength: posInt.optional() });
export const RichTextFieldSchema = z.object({ ...base, type: z.literal('rich_text'), maxWords: posInt.optional() });
export const NumberFieldSchema = z.object({
  ...base,
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().default(false),
  unit: z.string().optional(),
});
/** Money is integer cents. `min`/`max` are cents too. */
export const CurrencyFieldSchema = z.object({
  ...base,
  type: z.literal('currency'),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  currency: z.string().length(3).default('USD'),
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const DateFieldSchema = z.object({ ...base, type: z.literal('date'), min: isoDate.optional(), max: isoDate.optional() });
export const SelectFieldSchema = z.object({
  ...base,
  type: z.literal('select'),
  options: z.array(OptionSchema),
  display: z.enum(['dropdown', 'radio']).default('dropdown'),
});
export const MultiSelectFieldSchema = z.object({
  ...base,
  type: z.literal('multi_select'),
  options: z.array(OptionSchema),
  maxSelections: posInt.optional(),
});
export const CheckboxGroupFieldSchema = z.object({
  ...base,
  type: z.literal('checkbox_group'),
  options: z.array(OptionSchema),
  maxSelections: posInt.optional(),
});
export const YesNoFieldSchema = z.object({ ...base, type: z.literal('yes_no') });
export const NameFieldSchema = z.object({ ...base, type: z.literal('name') });
export const AddressFieldSchema = z.object({ ...base, type: z.literal('address') });
export const EmailFieldSchema = z.object({ ...base, type: z.literal('email') });
export const PhoneFieldSchema = z.object({ ...base, type: z.literal('phone') });
export const EinFieldSchema = z.object({ ...base, type: z.literal('ein') });
export const UeiFieldSchema = z.object({ ...base, type: z.literal('uei') });
export const FileUploadFieldSchema = z.object({
  ...base,
  type: z.literal('file_upload'),
  /** File extensions without the dot, e.g. `['pdf', 'xlsx']`. Empty means any type. */
  accept: z.array(z.string().min(1)).default([]),
  maxBytes: posInt.default(10 * 1024 * 1024),
  multiple: z.boolean().default(false),
  maxFiles: posInt.optional(),
});

export const ColumnSchema = z.discriminatedUnion('type', [
  TextFieldSchema,
  LongTextFieldSchema,
  NumberFieldSchema,
  CurrencyFieldSchema,
  DateFieldSchema,
  SelectFieldSchema,
  YesNoFieldSchema,
  EmailFieldSchema,
  PhoneFieldSchema,
]);
export type Column = z.output<typeof ColumnSchema>;

export const SumEqualsSchema = z.object({
  /** Id of a number/currency column. */
  column: z.string().min(1),
  /** Id of the field the column total must equal (normally a currency field). */
  field: z.string().min(1),
  /** How applicants call the rows, e.g. "budget lines". */
  noun: z.string().optional(),
});
export type SumEquals = z.output<typeof SumEqualsSchema>;

export const RepeaterTableFieldSchema = z.object({
  ...base,
  type: z.literal('repeater_table'),
  columns: z.array(ColumnSchema),
  minRows: z.number().int().nonnegative().optional(),
  maxRows: posInt.optional(),
  /** Show a computed total under each number/currency column. */
  totals: z.boolean().default(true),
  sumEquals: SumEqualsSchema.optional(),
  addLabel: z.string().optional(),
});
export const LikertMatrixFieldSchema = z.object({
  ...base,
  type: z.literal('likert_matrix'),
  rows: z.array(z.object({ id: z.string().min(1), label: z.string() })),
  scale: z.array(OptionSchema),
});
export const AttestationFieldSchema = z.object({
  ...base,
  type: z.literal('attestation'),
  /** Markdown statement the applicant confirms. */
  statement: z.string(),
  /** Ask for a typed full name as a signature. */
  requireName: z.boolean().default(true),
});

const FIELD_SCHEMAS = [
  TextFieldSchema,
  LongTextFieldSchema,
  RichTextFieldSchema,
  NumberFieldSchema,
  CurrencyFieldSchema,
  DateFieldSchema,
  SelectFieldSchema,
  MultiSelectFieldSchema,
  CheckboxGroupFieldSchema,
  YesNoFieldSchema,
  NameFieldSchema,
  AddressFieldSchema,
  EmailFieldSchema,
  PhoneFieldSchema,
  EinFieldSchema,
  UeiFieldSchema,
  FileUploadFieldSchema,
  RepeaterTableFieldSchema,
  LikertMatrixFieldSchema,
  AttestationFieldSchema,
] as const;

export const FieldSchema = z.discriminatedUnion('type', [...FIELD_SCHEMAS]);
export type Field = z.output<typeof FieldSchema>;
export type FieldInput = z.input<typeof FieldSchema>;
export type FieldOfType<T extends FieldType> = Extract<Field, { type: T }>;

/** Markdown shown to applicants; collects no data. */
export const InfoBlockSchema = z.object({
  type: z.literal('info_block'),
  id: z.string().min(1),
  title: z.string().optional(),
  markdown: z.string(),
  visibleWhen: ConditionSchema.optional(),
});
export type InfoBlock = z.output<typeof InfoBlockSchema>;

export const SectionChildSchema = z.discriminatedUnion('type', [...FIELD_SCHEMAS, InfoBlockSchema]);
export type SectionChild = z.output<typeof SectionChildSchema>;

/** A titled group of questions inside a page. Its `visibleWhen` applies to everything in it. */
export const SectionSchema = z.object({
  type: z.literal('section'),
  id: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  visibleWhen: ConditionSchema.optional(),
  elements: z.array(SectionChildSchema),
});
export type Section = z.output<typeof SectionSchema>;

export const ElementSchema = z.discriminatedUnion('type', [...FIELD_SCHEMAS, InfoBlockSchema, SectionSchema]);
export type Element = z.output<typeof ElementSchema>;
export type ElementInput = z.input<typeof ElementSchema>;

export const PageSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  elements: z.array(ElementSchema),
});
export type Page = z.output<typeof PageSchema>;

export const FormModelSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  description: z.string().optional(),
  /**
   * Form-level switches staff turn on or off per form version (e.g. `aiDisclosure`).
   * Conditions can read them with `{ flag: 'aiDisclosure' }`.
   */
  flags: z.record(z.string(), z.boolean()).default({}),
  pages: z.array(PageSchema),
});
export type FormModel = z.output<typeof FormModelSchema>;
export type FormModelInput = z.input<typeof FormModelSchema>;

/** Parses (and fills defaults for) a builder model. Throws a ZodError when the shape is wrong. */
export function defineForm(input: FormModelInput): FormModel {
  return FormModelSchema.parse(input);
}

/** Safe variant for untrusted JSON (e.g. a `builder_model` column). */
export function parseFormModel(input: unknown): { success: true; model: FormModel } | { success: false; issues: string[] } {
  const r = FormModelSchema.safeParse(input);
  if (r.success) return { success: true, model: r.data };
  return { success: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

export function isField(e: Element | SectionChild): e is Field {
  return e.type !== 'info_block' && e.type !== 'section';
}

export interface FieldLocation {
  field: Field;
  page: Page;
  pageIndex: number;
  section?: Section;
  /** 0-based position of the field across the whole form. */
  order: number;
}

/** Every data field in form order, with where it lives. */
export function listFields(model: FormModel): FieldLocation[] {
  const out: FieldLocation[] = [];
  model.pages.forEach((page, pageIndex) => {
    for (const el of page.elements) {
      if (el.type === 'section') {
        for (const child of el.elements) {
          if (isField(child)) out.push({ field: child, page, pageIndex, section: el, order: out.length });
        }
      } else if (isField(el)) {
        out.push({ field: el, page, pageIndex, order: out.length });
      }
    }
  });
  return out;
}

/** Info blocks in form order (with their page and optional section). */
export function listInfoBlocks(model: FormModel): { block: InfoBlock; page: Page; section?: Section }[] {
  const out: { block: InfoBlock; page: Page; section?: Section }[] = [];
  for (const page of model.pages) {
    for (const el of page.elements) {
      if (el.type === 'info_block') out.push({ block: el, page });
      if (el.type === 'section') for (const c of el.elements) if (c.type === 'info_block') out.push({ block: c, page, section: el });
    }
  }
  return out;
}

export function findField(model: FormModel, id: string): FieldLocation | undefined {
  return listFields(model).find((l) => l.field.id === id);
}
