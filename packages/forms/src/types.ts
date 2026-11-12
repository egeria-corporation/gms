// SPDX-License-Identifier: AGPL-3.0-only
// Shared types for the form engine (build spec §10.2). A form is a CommonGrants `FormBase`:
// JSON Schema 2020-12 (restricted subset) + JSON Forms-style UI schema + CG mappings.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** A JSON Schema node of the supported subset. Kept loose on purpose; `checkSchemaSubset` is the gate. */
export interface FormSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, FormSchema>;
  title?: string;
  description?: string;
  default?: Json;
  examples?: Json[];
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, FormSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: FormSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  enum?: Json[];
  const?: Json;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  if?: FormSchema;
  then?: FormSchema;
  else?: FormSchema;
  "x-widget"?: WidgetName;
  "x-widgetOptions"?: WidgetOptions;
  "x-wordCount"?: { min?: number; max?: number };
}

export const WIDGETS = [
  "money",
  "fileRef",
  "richText",
  "budgetTable",
  "passportField",
  "signature",
  "address",
  "phone",
] as const;
export type WidgetName = (typeof WIDGETS)[number];

export interface WidgetOptions {
  /** money / budgetTable: the only currency accepted (fixed per competition). */
  currency?: string;
  /** budgetTable: the funder's categories; a row's `category` must be one of them. */
  categories?: string[];
  /** budgetTable: decimal string ceiling for the table total. */
  maxTotal?: string;
  /** budgetTable: JSON pointer into the response to a Money (or decimal) the total must not exceed. */
  maxTotalPath?: string;
}

/** CommonGrants validation error entry. `field` is a JSON pointer into the response. */
export interface ValidationError {
  field: string;
  message: string;
  type: string;
}

export interface DefinitionError {
  path: string;
  message: string;
}

// ---- UI schema ----
export type RuleEffect = "SHOW" | "HIDE" | "ENABLE" | "DISABLE";
export interface UiRule {
  effect: RuleEffect;
  condition: { scope: string; schema: FormSchema };
}
export interface ControlOptions {
  widget?: WidgetName;
  placeholder?: string;
  help?: string;
  /** Default true. False hides the field from every reviewer. */
  reviewerVisible?: boolean;
  /** Default false. True masks the value for external reviewers. */
  pii?: boolean;
  /** True on a numeric report field whose values add up across accepted reports (program outcome totals). */
  outcome?: boolean;
  /** What an outcome counts, e.g. "people served". */
  unit?: string;
  [key: string]: Json | undefined;
}
export interface UiControl {
  type: "Control";
  scope: string;
  label?: string;
  options?: ControlOptions;
  rule?: UiRule;
}
export interface UiLayout {
  type: "VerticalLayout" | "HorizontalLayout" | "Group" | "Categorization" | "Category";
  label?: string;
  elements: UiElement[];
  options?: Record<string, Json | undefined>;
  rule?: UiRule;
}
export type UiElement = UiControl | UiLayout;

// ---- mappings (CG MappingSchema) ----
export interface MappingFieldFunction {
  field: string;
}
export interface MappingConstantFunction {
  const: Json;
}
export interface MappingSwitchFunction {
  switch: { field: string; case: Record<string, Json>; default?: Json };
}
export type MappingFunction = MappingFieldFunction | MappingConstantFunction | MappingSwitchFunction;
export type MappingSchema = { [key: string]: MappingFunction | MappingSchema };

// ---- form definition ----
export interface FieldMeta {
  reviewerVisible?: boolean;
  pii?: boolean;
  /** True on a numeric report field whose values add up across accepted reports (program outcome totals). */
  outcome?: boolean;
  /** What an outcome counts, e.g. "people served". */
  unit?: string;
}

export interface FormDefinition {
  id: string;
  version: number;
  title: string;
  description?: string;
  instructions?: string;
  jsonSchema: FormSchema;
  uiSchema: UiElement;
  mappingFromCommonGrants?: MappingSchema;
  mappingToCommonGrants?: MappingSchema;
  /** JSON pointer → reviewer visibility / PII flags. Merged with the UI schema control options. */
  fieldMeta?: Record<string, FieldMeta>;
  publishedAt?: string | null;
  supersedesFormVersion?: number | null;
}

/** `self_declared`: prefilled from the profile an organization without Passport entered itself (shown as "you entered"). */
export type ProvenanceSource = "passport" | "self_declared" | "library" | "prior_submission" | "qbo" | "user" | `agent:${string}`;
export type Provenance = Record<string, ProvenanceSource>;
/** Provenance a later prefill may overwrite: values that came from the organization record, not from a person. */
export const isPrefillSource = (s: ProvenanceSource | undefined): boolean => s === "passport" || s === "self_declared";
export type ResponseStatus = "notStarted" | "inProgress" | "complete";
