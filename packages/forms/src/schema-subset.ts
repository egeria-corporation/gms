// SPDX-License-Identifier: AGPL-3.0-only
// Save-time gate: a form's JSON Schema must stay inside the supported 2020-12 subset (§10.2).
// Anything else is rejected with a path-qualified error so the builder can point at the field.
import { getAt, isPlainObject, parsePointer } from "./pointer.ts";
import { WIDGETS, type DefinitionError, type FormSchema } from "./types.ts";

const TYPES = new Set(["object", "string", "number", "integer", "boolean", "array"]);
export const STRING_FORMATS = ["email", "uri", "date", "date-time", "phone"] as const;
const FORMATS = new Set<string>(STRING_FORMATS);
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "default", "examples"]);
const BY_TYPE: Record<string, Set<string>> = {
  object: new Set(["properties", "required", "additionalProperties"]),
  string: new Set(["format", "minLength", "maxLength", "pattern", "x-wordCount"]),
  number: new Set(["minimum", "maximum"]),
  integer: new Set(["minimum", "maximum"]),
  boolean: new Set(),
  array: new Set(["items", "minItems", "maxItems", "uniqueItems"]),
};
const ANY_TYPE = new Set(["type", "enum", "const", "if", "then", "else", "$ref", "$defs", "x-widget", "x-widgetOptions"]);

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function resolveRef(root: FormSchema, ref: string): FormSchema | undefined {
  if (!ref.startsWith("#")) return undefined;
  const target = getAt(root, parsePointer(ref.slice(1)));
  return isPlainObject(target) ? (target as FormSchema) : undefined;
}

/** Returns every violation; an empty array means the schema is inside the subset. */
export function checkSchemaSubset(schema: unknown): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const err = (path: string, message: string) => errors.push({ path: path || "#", message });
  if (!isPlainObject(schema)) return [{ path: "#", message: "the schema must be an object" }];
  const root = schema as FormSchema;
  if (root.type !== "object") err("#/type", 'the root schema must have type "object"');

  const walk = (node: unknown, path: string, conditional: boolean): void => {
    if (!isPlainObject(node)) {
      err(path, "must be a schema object (boolean schemas are not supported)");
      return;
    }
    const s = node as FormSchema & Record<string, unknown>;
    const type = s.type;
    if (type !== undefined && (typeof type !== "string" || !TYPES.has(type))) {
      err(`${path}/type`, `unsupported type ${JSON.stringify(type)}; use one of ${[...TYPES].join(", ")}`);
    }
    if (type === undefined && s.$ref === undefined && !conditional && s.enum === undefined && s.const === undefined) {
      err(path, "must declare a type (or $ref, enum, const)");
    }
    for (const key of Object.keys(s)) {
      if (ANNOTATIONS.has(key) || ANY_TYPE.has(key)) continue;
      const allowed = typeof type === "string" ? BY_TYPE[type] : undefined;
      if (allowed?.has(key)) continue;
      // Inside if/then/else, untyped fragments may use any supported keyword.
      if (type === undefined && Object.values(BY_TYPE).some((set) => set.has(key))) continue;
      const known = Object.values(BY_TYPE).some((set) => set.has(key));
      err(`${path}/${key}`, known ? `"${key}" is not valid for type "${String(type)}"` : `unsupported keyword "${key}"`);
    }
    if (s.$ref !== undefined) {
      if (typeof s.$ref !== "string" || !s.$ref.startsWith("#")) err(`${path}/$ref`, "$ref must point inside this document (start with #)");
      else if (!resolveRef(root, s.$ref)) err(`${path}/$ref`, `$ref target ${s.$ref} does not exist`);
    }
    if (s.$defs !== undefined) {
      if (!isPlainObject(s.$defs)) err(`${path}/$defs`, "must be an object");
      else for (const [k, v] of Object.entries(s.$defs)) walk(v, `${path}/$defs/${k}`, false);
    }
    if (s.properties !== undefined) {
      if (!isPlainObject(s.properties)) err(`${path}/properties`, "must be an object");
      else for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}/properties/${k}`, conditional);
    }
    if (s.required !== undefined) {
      if (!Array.isArray(s.required) || s.required.some((r) => typeof r !== "string")) err(`${path}/required`, "must be a list of property names");
      else if (!conditional && isPlainObject(s.properties)) {
        for (const r of s.required) if (!(r in s.properties)) err(`${path}/required`, `"${r}" is required but not defined in properties`);
      }
    }
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean") {
      err(`${path}/additionalProperties`, "must be true or false");
    }
    if (type === "array") {
      if (s.items === undefined) err(`${path}/items`, "arrays must declare items");
      else if (isPlainObject(s.items)) {
        const it = s.items as FormSchema;
        const target = it.$ref ? resolveRef(root, it.$ref) : it;
        const ok = target?.type === "object" || (target?.type === "string" && Array.isArray(target.enum));
        if (!ok) err(`${path}/items`, "array items must be objects (repeating group) or strings with an enum (multi-select)");
        walk(s.items, `${path}/items`, false);
      } else err(`${path}/items`, "must be a schema object");
    }
    for (const k of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
      if (s[k] !== undefined && !isCount(s[k])) err(`${path}/${k}`, "must be a non-negative integer");
    }
    for (const k of ["minimum", "maximum"] as const) {
      if (s[k] !== undefined && typeof s[k] !== "number") err(`${path}/${k}`, "must be a number");
    }
    if (s.uniqueItems !== undefined && typeof s.uniqueItems !== "boolean") err(`${path}/uniqueItems`, "must be true or false");
    if (s.enum !== undefined && (!Array.isArray(s.enum) || s.enum.length === 0)) err(`${path}/enum`, "must be a non-empty list");
    if (s.format !== undefined && (typeof s.format !== "string" || !FORMATS.has(s.format))) {
      err(`${path}/format`, `unsupported format ${JSON.stringify(s.format)}; use one of ${[...FORMATS].join(", ")}`);
    }
    if (s.pattern !== undefined) {
      if (typeof s.pattern !== "string") err(`${path}/pattern`, "must be a string");
      else {
        try {
          new RegExp(s.pattern, "u");
        } catch {
          err(`${path}/pattern`, "is not a valid regular expression");
        }
      }
    }
    if (s["x-widget"] !== undefined && !(WIDGETS as readonly unknown[]).includes(s["x-widget"])) {
      err(`${path}/x-widget`, `unknown widget ${JSON.stringify(s["x-widget"])}; use one of ${WIDGETS.join(", ")}`);
    }
    if (s["x-widgetOptions"] !== undefined && !isPlainObject(s["x-widgetOptions"])) err(`${path}/x-widgetOptions`, "must be an object");
    const wc = s["x-wordCount"];
    if (wc !== undefined && (!isPlainObject(wc) || Object.entries(wc).some(([k, v]) => !["min", "max"].includes(k) || !isCount(v)))) {
      err(`${path}/x-wordCount`, "must be { min?, max? } with non-negative integers");
    }
    if ((s.then !== undefined || s.else !== undefined) && s.if === undefined) err(path, '"then"/"else" need an "if"');
    for (const k of ["if", "then", "else"] as const) if (s[k] !== undefined) walk(s[k], `${path}/${k}`, true);
  };

  walk(root, "#", false);
  return errors;
}
