// SPDX-License-Identifier: AGPL-3.0-only
// Response validation. The engine is a small interpreter for the supported schema subset, so it
// runs on Cloudflare Workers (which forbid the runtime code generation Ajv relies on). `ajv.ts`
// registers the same widget keywords on Ajv 2020 for Node tooling; the test suite uses Ajv as a
// conformance oracle for this interpreter.
import { deepEqual, formatPointer, isAtOrUnder, isPlainObject } from "./pointer.ts";
import { resolveRef } from "./schema-subset.ts";
import type { FormDefinition, FormSchema, Json, ValidationError, WidgetOptions } from "./types.ts";
import { collectControls, evaluateUi } from "./ui-schema.ts";
import { checkWordCount, isPhone, validateWidget } from "./widgets.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[tT ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([zZ]|[+-]\d{2}:\d{2})$/;

function isDate(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number;
  return d <= days;
}

export function checkFormat(format: string, v: string): boolean {
  switch (format) {
    case "email":
      return EMAIL.test(v);
    case "uri":
      return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(v) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(v);
    case "date":
      return isDate(v);
    case "date-time": {
      const m = DATE_TIME.exec(v);
      return !!m && isDate(m[1] as string) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 61;
    }
    case "phone":
      return isPhone(v);
    default:
      return true;
  }
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(type: string, v: unknown): boolean {
  if (type === "integer") return typeof v === "number" && Number.isInteger(v);
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === type;
}

const codePoints = (s: string) => [...s].length;

/** Validates `data` against a subset schema. `rootData` is the whole response (budget ceilings). */
export function validateAgainstSchema(schema: FormSchema, data: unknown, rootSchema: FormSchema = schema, rootData: unknown = data): ValidationError[] {
  const errors: ValidationError[] = [];
  const push = (segs: (string | number)[], message: string, type: string) =>
    errors.push({ field: formatPointer(segs), message, type });

  const run = (s: FormSchema, v: unknown, segs: (string | number)[], depth: number): void => {
    if (depth > 64) return;
    if (s.$ref) {
      const target = resolveRef(rootSchema, s.$ref);
      if (target) run(target, v, segs, depth + 1);
    }
    if (s.type && !matchesType(s.type, v)) {
      push(segs, `must be ${s.type}`, "type");
      return;
    }
    if (s.enum && !s.enum.some((e) => deepEqual(e, v))) push(segs, "must be one of the allowed values", "enum");
    if (s.const !== undefined && !deepEqual(s.const, v)) push(segs, "must equal the required value", "const");

    if (typeof v === "string") {
      if (s.minLength !== undefined && codePoints(v) < s.minLength) push(segs, `must be at least ${s.minLength} characters`, "minLength");
      if (s.maxLength !== undefined && codePoints(v) > s.maxLength) push(segs, `must be at most ${s.maxLength} characters`, "maxLength");
      if (s.pattern !== undefined && !new RegExp(s.pattern, "u").test(v)) push(segs, "is not in the expected format", "pattern");
      if (s.format !== undefined && !checkFormat(s.format, v)) push(segs, `must be a valid ${s.format}`, "format");
      if (s["x-wordCount"]) {
        const w = checkWordCount(v, s["x-wordCount"]);
        if (w) push(segs, w.message, w.type);
      }
    }
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) push(segs, `must be at least ${s.minimum}`, "minimum");
      if (s.maximum !== undefined && v > s.maximum) push(segs, `must be at most ${s.maximum}`, "maximum");
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) push(segs, `must have at least ${s.minItems} item${s.minItems === 1 ? "" : "s"}`, "minItems");
      if (s.maxItems !== undefined && v.length > s.maxItems) push(segs, `must have at most ${s.maxItems} item${s.maxItems === 1 ? "" : "s"}`, "maxItems");
      if (s.uniqueItems && v.some((a, i) => v.findIndex((b) => deepEqual(a, b)) !== i)) push(segs, "must not contain duplicates", "uniqueItems");
      if (s.items) v.forEach((item, i) => run(s.items as FormSchema, item, [...segs, i], depth + 1));
    }
    if (isPlainObject(v)) {
      for (const r of s.required ?? []) {
        if (v[r] === undefined) push([...segs, r], "is required", "required");
      }
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        if (v[k] !== undefined) run(sub, v[k], [...segs, k], depth + 1);
      }
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(s.properties && k in s.properties)) push([...segs, k], "is not an expected field", "additionalProperties");
      }
    }
    if (s["x-widget"]) {
      for (const w of validateWidget(s["x-widget"], v as Json, s["x-widgetOptions"] ?? {}, rootData)) {
        errors.push({ field: formatPointer(segs) + w.path, message: w.message, type: w.type });
      }
    }
    if (s.if) {
      const matched = validateAgainstSchema(s.if, v, rootSchema, rootData).length === 0;
      const branch = matched ? s.then : s.else;
      if (branch) run(branch, v, segs, depth + 1);
    }
  };

  run(schema, data, [], 0);
  // The same field can fail in a branch and at the top level; report each (field, type) once.
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.field}\u0000${e.type}\u0000${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The schema the validator actually runs: the form's JSON Schema with widgets declared on UI
 * controls (`options.widget`, `options.widgetOptions`) written onto the matching property as
 * `x-widget` / `x-widgetOptions`. Schema-declared widgets win.
 */
export function effectiveSchema(form: Pick<FormDefinition, "jsonSchema" | "uiSchema">): FormSchema {
  const schema = JSON.parse(JSON.stringify(form.jsonSchema)) as FormSchema;
  for (const c of collectControls(form.uiSchema)) {
    const widget = c.options?.widget;
    if (!widget) continue;
    let node: FormSchema | undefined = schema;
    for (const seg of c.path.split("/").slice(1)) {
      if (node?.$ref) node = resolveRef(schema, node.$ref);
      node = node?.properties?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    if (!node || c.path === "") continue;
    node["x-widget"] ??= widget;
    const opts = c.options?.widgetOptions;
    if (isPlainObject(opts)) node["x-widgetOptions"] ??= opts as WidgetOptions;
  }
  return schema;
}

export interface ValidationResult {
  valid: boolean;
  validationErrors: ValidationError[];
}

/**
 * Validates a response for a form. Fields hidden by UI rules are neither required nor validated.
 * Errors use the CommonGrants `validationErrors` shape with JSON-pointer `field`s.
 */
export function validateResponse(form: Pick<FormDefinition, "jsonSchema" | "uiSchema">, response: unknown): ValidationResult {
  const schema = effectiveSchema(form);
  const data = isPlainObject(response) ? response : {};
  const { hidden } = evaluateUi(form.uiSchema, data);
  const validationErrors = validateAgainstSchema(schema, data).filter((e) => !hidden.some((h) => h !== "" && isAtOrUnder(e.field, h)));
  return { valid: validationErrors.length === 0, validationErrors };
}
