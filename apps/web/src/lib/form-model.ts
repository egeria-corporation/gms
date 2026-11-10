// SPDX-License-Identifier: AGPL-3.0-only
// The form builder edits sections of fields; a form is stored as JSON Schema + UI Schema +
// CommonGrants mappings (`@gms/forms`). This module converts between the two and holds the
// editing operations, so the screen stays thin and the conversions are tested on their own.
//
// A layout the builder does not model (a HorizontalLayout inside a section) is flattened into
// its section when a form is opened; parts of a field's schema the builder does not edit are
// kept as they were.
import type { ControlOptions, FormSchema, Json, MappingSchema, UiControl, UiElement } from "@gms/forms";

export type FieldKind =
  | "text"
  | "longText"
  | "number"
  | "money"
  | "date"
  | "select"
  | "multiSelect"
  | "boolean"
  | "file"
  | "address"
  | "phone"
  | "email"
  | "richText"
  | "budgetTable"
  | "signature"
  | "passportField"
  /** A repeating group or other structure made outside the builder; label, help and flags stay editable. */
  | "other";

export const FIELD_KINDS: { kind: Exclude<FieldKind, "other">; label: string }[] = [
  { kind: "text", label: "Short text" },
  { kind: "longText", label: "Long text" },
  { kind: "number", label: "Number" },
  { kind: "money", label: "Money" },
  { kind: "date", label: "Date" },
  { kind: "select", label: "Select" },
  { kind: "multiSelect", label: "Multi-select" },
  { kind: "boolean", label: "Yes / No" },
  { kind: "file", label: "File" },
  { kind: "address", label: "Address" },
  { kind: "phone", label: "Phone" },
  { kind: "email", label: "Email" },
  { kind: "richText", label: "Rich text" },
  { kind: "budgetTable", label: "Budget table" },
  { kind: "signature", label: "Signature" },
  { kind: "passportField", label: "Passport field" },
];
export const kindLabel = (kind: FieldKind) => FIELD_KINDS.find((k) => k.kind === kind)?.label ?? "Custom";

export interface ShowWhen {
  /** Key of the field this one depends on. */
  field: string;
  equals: string | boolean;
}

export interface FieldModel {
  key: string;
  kind: FieldKind;
  label: string;
  help: string;
  required: boolean;
  /** Long text: maximum words. */
  wordMax: number | null;
  /** Select and multi-select choices. */
  choices: string[];
  /** Budget table categories. */
  categories: string[];
  reviewerVisible: boolean;
  pii: boolean;
  showWhen: ShowWhen | null;
  /** Path into the Passport record this field is pre-filled from. */
  prefill: string | null;
  /** CommonGrants application property this field supplies at submit. */
  mapsTo: string | null;
  /** The property schema and control options as stored, for the parts the builder does not edit. */
  schema: FormSchema;
  options: ControlOptions;
}

export interface SectionModel {
  id: string;
  label: string;
  fields: FieldModel[];
}

export interface FormModel {
  sections: SectionModel[];
}

export interface FormParts {
  jsonSchema: FormSchema;
  uiSchema: UiElement;
  mappingFromCommonGrants: MappingSchema;
  mappingToCommonGrants: MappingSchema;
}

/** CommonGrants application properties a field can supply. */
export const CG_TARGETS = [
  { key: "requestedAmount", label: "requestedAmount" },
  { key: "title", label: "title" },
  { key: "applicantType", label: "applicantType" },
] as const;

const scopeOf = (key: string) => `#/properties/${key}`;
const keyOfScope = (scope: string): string | null => /^#\/properties\/([^/]+)$/.exec(scope)?.[1] ?? null;

function kindOf(schema: FormSchema, options: ControlOptions): FieldKind {
  const widget = options.widget ?? schema["x-widget"];
  switch (widget) {
    case "money":
      return "money";
    case "fileRef":
      return "file";
    case "richText":
      return "richText";
    case "budgetTable":
      return "budgetTable";
    case "passportField":
      return "passportField";
    case "signature":
      return "signature";
    case "address":
      return "address";
    case "phone":
      return "phone";
  }
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "array") return schema.items && typeof schema.items === "object" && Array.isArray((schema.items as FormSchema).enum) ? "multiSelect" : "other";
  if (schema.type === "string") {
    if (Array.isArray(schema.enum)) return "select";
    if (schema.format === "date") return "date";
    if (schema.format === "email") return "email";
    if (schema["x-wordCount"] !== undefined || options.multi === true || (schema.maxLength ?? 0) > 200) return "longText";
    return "text";
  }
  return "other";
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A stored form → the builder's sections and fields. */
export function parseForm(parts: FormParts): FormModel {
  const props = (parts.jsonSchema.properties ?? {}) as Record<string, FormSchema>;
  const required = new Set(strings(parts.jsonSchema.required));
  const prefills = new Map<string, string>();
  for (const [key, fn] of Object.entries(parts.mappingFromCommonGrants ?? {})) {
    if (fn && typeof fn === "object" && "field" in fn && typeof fn.field === "string") prefills.set(key, fn.field);
  }
  const targets = new Map<string, string>();
  for (const [target, fn] of Object.entries(parts.mappingToCommonGrants ?? {})) {
    if (fn && typeof fn === "object" && "field" in fn && typeof fn.field === "string") targets.set(fn.field, target);
  }

  const field = (control: UiControl): FieldModel | null => {
    const key = keyOfScope(control.scope);
    if (!key) return null;
    const schema = props[key] ?? {};
    const options = control.options ?? {};
    const kind = kindOf(schema, options);
    const cond = control.rule?.effect === "SHOW" ? control.rule.condition : null;
    const condKey = cond ? keyOfScope(cond.scope) : null;
    const condValue = cond?.schema.const;
    const widgetOptions = (options.widgetOptions ?? schema["x-widgetOptions"] ?? {}) as { categories?: unknown };
    return {
      key,
      kind,
      label: control.label ?? schema.title ?? key,
      help: typeof options.help === "string" ? options.help : (schema.description ?? ""),
      required: required.has(key),
      wordMax: schema["x-wordCount"]?.max ?? null,
      choices: kind === "select" ? strings(schema.enum) : kind === "multiSelect" ? strings((schema.items as FormSchema).enum) : [],
      categories: strings(widgetOptions.categories),
      reviewerVisible: options.reviewerVisible !== false,
      pii: options.pii === true,
      showWhen: condKey && (typeof condValue === "string" || typeof condValue === "boolean") ? { field: condKey, equals: condValue } : null,
      prefill: prefills.get(key) ?? null,
      mapsTo: targets.get(key) ?? null,
      schema,
      options,
    };
  };

  const sections: SectionModel[] = [];
  let loose: SectionModel | null = null;
  const collect = (el: UiElement, into: FieldModel[]) => {
    if (el.type === "Control") {
      const f = field(el);
      if (f) into.push(f);
    } else for (const child of el.elements ?? []) collect(child, into);
  };
  const top = parts.uiSchema.type === "Control" ? [parts.uiSchema] : (parts.uiSchema.elements ?? []);
  top.forEach((el, i) => {
    if (el.type === "Group" || el.type === "Category") {
      const s: SectionModel = { id: `s${i + 1}`, label: el.label ?? `Section ${sections.length + 1}`, fields: [] };
      collect(el, s.fields);
      sections.push(s);
      loose = null;
    } else {
      if (!loose) {
        loose = { id: `s${i + 1}`, label: "Questions", fields: [] };
        sections.push(loose);
      }
      collect(el, loose.fields);
    }
  });
  return { sections };
}

function schemaFor(f: FieldModel): FormSchema {
  // Start from what was stored so constraints the builder does not edit survive a round trip,
  // then set the keywords this kind owns.
  const { enum: _e, format: _f, items: _i, "x-wordCount": _w, type: _t, uniqueItems: _u, title: _title, ...keep } = f.schema;
  const base: FormSchema = { ...keep, title: f.label };
  switch (f.kind) {
    case "text":
    case "phone":
    case "richText":
    case "passportField":
      return { ...base, type: "string" };
    case "longText":
      return { ...base, type: "string", ...(f.wordMax ? { "x-wordCount": { ...(f.schema["x-wordCount"]?.min ? { min: f.schema["x-wordCount"].min } : {}), max: f.wordMax } } : {}) };
    case "number":
      return { ...base, type: f.schema.type === "integer" ? "integer" : "number" };
    case "date":
      return { ...base, type: "string", format: "date" };
    case "email":
      return { ...base, type: "string", format: "email" };
    case "select":
      return { ...base, type: "string", enum: f.choices };
    case "multiSelect":
      return { ...base, type: "array", items: { type: "string", enum: f.choices }, uniqueItems: true };
    case "boolean":
      return { ...base, type: "boolean" };
    case "money":
    case "file":
    case "address":
    case "signature":
      return { ...base, type: "object" };
    case "budgetTable":
      return { ...base, type: "array", items: f.schema.items ?? { type: "object" } };
    case "other":
      return { ...f.schema, title: f.label };
  }
}

const WIDGET: Partial<Record<FieldKind, NonNullable<ControlOptions["widget"]>>> = {
  money: "money",
  file: "fileRef",
  address: "address",
  phone: "phone",
  richText: "richText",
  budgetTable: "budgetTable",
  signature: "signature",
  passportField: "passportField",
};

function controlFor(f: FieldModel): UiControl {
  const { widget: _w, help: _h, reviewerVisible: _r, pii: _p, multi: _m, ...keep } = f.options;
  const options: ControlOptions = { ...keep };
  const widget = f.kind === "other" ? f.options.widget : WIDGET[f.kind];
  if (widget) options.widget = widget;
  if (f.help.trim()) options.help = f.help.trim();
  if (!f.reviewerVisible) options.reviewerVisible = false;
  if (f.pii) options.pii = true;
  if (f.kind === "longText" && !f.wordMax) options.multi = true;
  if (f.kind === "money") options.widgetOptions = { currency: "USD", ...(f.options.widgetOptions as object | undefined) } as Json;
  if (f.kind === "budgetTable") options.widgetOptions = { currency: "USD", ...(f.options.widgetOptions as object | undefined), categories: f.categories } as Json;
  return {
    type: "Control",
    scope: scopeOf(f.key),
    ...(Object.keys(options).length ? { options } : {}),
    ...(f.showWhen ? { rule: { effect: "SHOW", condition: { scope: scopeOf(f.showWhen.field), schema: { const: f.showWhen.equals } } } } : {}),
  };
}

/** The builder's sections and fields → what the API stores. */
export function compileForm(model: FormModel): FormParts {
  const fields = model.sections.flatMap((s) => s.fields);
  const mappingFrom: MappingSchema = {};
  const mappingTo: MappingSchema = {};
  for (const f of fields) {
    if (f.prefill) mappingFrom[f.key] = { field: f.prefill };
    if (f.mapsTo) mappingTo[f.mapsTo] = { field: f.key };
  }
  return {
    jsonSchema: { type: "object", properties: Object.fromEntries(fields.map((f) => [f.key, schemaFor(f)])), required: fields.filter((f) => f.required).map((f) => f.key) },
    uiSchema: { type: "VerticalLayout", elements: model.sections.map((s) => ({ type: "Group" as const, label: s.label, elements: s.fields.map(controlFor) })) },
    mappingFromCommonGrants: mappingFrom,
    mappingToCommonGrants: mappingTo,
  };
}

const camel = (label: string) => {
  const words = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(key) ? key : `field${key}`;
};

const allKeys = (model: FormModel) => new Set(model.sections.flatMap((s) => s.fields.map((f) => f.key)));

/** A property key not used by any field yet, derived from the label. */
export function uniqueKey(model: FormModel, label: string): string {
  const taken = allKeys(model);
  const base = camel(label) || "field";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  return key;
}

export function newField(model: FormModel, kind: Exclude<FieldKind, "other">): FieldModel {
  const label = kind === "passportField" ? "Legal name" : kindLabel(kind);
  return {
    key: uniqueKey(model, label),
    kind,
    label,
    help: "",
    required: false,
    wordMax: kind === "longText" ? 250 : null,
    choices: kind === "select" || kind === "multiSelect" ? ["Option 1", "Option 2"] : [],
    categories: kind === "budgetTable" ? ["Personnel", "Supplies", "Indirect"] : [],
    reviewerVisible: true,
    pii: false,
    showWhen: null,
    prefill: kind === "passportField" ? "name" : null,
    mapsTo: null,
    schema: {},
    options: {},
  };
}

const mapSections = (model: FormModel, fn: (s: SectionModel) => SectionModel): FormModel => ({ sections: model.sections.map(fn) });

export function addSection(model: FormModel, id: string): FormModel {
  return { sections: [...model.sections, { id, label: `Section ${model.sections.length + 1}`, fields: [] }] };
}

export function renameSection(model: FormModel, id: string, label: string): FormModel {
  return mapSections(model, (s) => (s.id === id ? { ...s, label } : s));
}

/** Removes a section and its fields. Conditions that pointed at a removed field are dropped. */
export function removeSection(model: FormModel, id: string): FormModel {
  return dropDanglingConditions({ sections: model.sections.filter((s) => s.id !== id) });
}

export function addField(model: FormModel, sectionId: string, field: FieldModel): FormModel {
  return mapSections(model, (s) => (s.id === sectionId ? { ...s, fields: [...s.fields, field] } : s));
}

export function updateField(model: FormModel, key: string, change: Partial<FieldModel>): FormModel {
  let next = mapSections(model, (s) => ({ ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, ...change } : f)) }));
  // A field supplies at most one CommonGrants property, and each property has one source.
  if (change.mapsTo) next = mapSections(next, (s) => ({ ...s, fields: s.fields.map((f) => (f.key !== key && f.mapsTo === change.mapsTo ? { ...f, mapsTo: null } : f)) }));
  return next;
}

export function removeField(model: FormModel, key: string): FormModel {
  return dropDanglingConditions(mapSections(model, (s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })));
}

function dropDanglingConditions(model: FormModel): FormModel {
  const keys = allKeys(model);
  return mapSections(model, (s) => ({ ...s, fields: s.fields.map((f) => (f.showWhen && !keys.has(f.showWhen.field) ? { ...f, showWhen: null } : f)) }));
}

/** Moves a field one place up or down; at a section's edge it crosses into the neighbouring section. */
export function moveField(model: FormModel, key: string, direction: -1 | 1): FormModel {
  const si = model.sections.findIndex((s) => s.fields.some((f) => f.key === key));
  if (si < 0) return model;
  const sections = model.sections.map((s) => ({ ...s, fields: [...s.fields] }));
  const from = sections[si]!;
  const fi = from.fields.findIndex((f) => f.key === key);
  const target = fi + direction;
  if (target >= 0 && target < from.fields.length) {
    [from.fields[fi], from.fields[target]] = [from.fields[target]!, from.fields[fi]!];
    return { sections };
  }
  const neighbour = sections[si + direction];
  if (!neighbour) return model;
  const [moved] = from.fields.splice(fi, 1);
  if (direction === 1) neighbour.fields.unshift(moved!);
  else neighbour.fields.push(moved!);
  return { sections };
}

export function canMove(model: FormModel, key: string, direction: -1 | 1): boolean {
  const si = model.sections.findIndex((s) => s.fields.some((f) => f.key === key));
  if (si < 0) return false;
  const fi = model.sections[si]!.fields.findIndex((f) => f.key === key);
  const target = fi + direction;
  return (target >= 0 && target < model.sections[si]!.fields.length) || !!model.sections[si + direction];
}

/** Fields a condition can depend on: selects and yes/no questions that come before `key`. */
export function conditionSources(model: FormModel, key: string): FieldModel[] {
  const fields = model.sections.flatMap((s) => s.fields);
  const index = fields.findIndex((f) => f.key === key);
  return fields.slice(0, index < 0 ? fields.length : index).filter((f) => f.kind === "select" || f.kind === "boolean");
}

export function describeCondition(model: FormModel, when: ShowWhen): string {
  const source = model.sections.flatMap((s) => s.fields).find((f) => f.key === when.field);
  const value = typeof when.equals === "boolean" ? (when.equals ? "Yes" : "No") : when.equals;
  return `${source?.label ?? when.field} = ${value}`;
}

export interface FormCounts {
  sections: number;
  fields: number;
  prefills: number;
  conditionals: number;
}
export function countForm(model: FormModel): FormCounts {
  const fields = model.sections.flatMap((s) => s.fields);
  return { sections: model.sections.length, fields: fields.length, prefills: fields.filter((f) => f.prefill).length, conditionals: fields.filter((f) => f.showWhen).length };
}

/** Problems the builder can name before the server does. Keyed by field key. */
export function localProblems(model: FormModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of model.sections.flatMap((s) => s.fields)) {
    if (!f.label.trim()) out[f.key] = "Give this field a label";
    else if ((f.kind === "select" || f.kind === "multiSelect") && f.choices.filter((c) => c.trim()).length < 2) out[f.key] = "Add at least two choices";
    else if (f.kind === "passportField" && !f.prefill) out[f.key] = "Choose the Passport field this shows";
    else if (f.kind === "budgetTable" && f.categories.filter((c) => c.trim()).length === 0) out[f.key] = "Add at least one budget category";
  }
  return out;
}
