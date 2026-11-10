// SPDX-License-Identifier: AGPL-3.0-only
// Ajv 2020 with the GMS widget keywords and formats, for Node tooling (CLI import/export, tests).
// Not for the Workers runtime: Ajv compiles schemas with `new Function`, which Workers forbid.
// The API validates with `validateResponse` (the interpreter in validate.ts), same keywords.
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Json, ValidationError, WidgetName, WidgetOptions } from "./types.ts";
import { checkWordCount, isPhone, validateWidget } from "./widgets.ts";

type KeywordFn = ((schema: unknown, data: unknown, parentSchema?: unknown, cxt?: { rootData?: unknown }) => boolean) & {
  errors?: Partial<ErrorObject>[];
};

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  (addFormats as unknown as (a: Ajv2020, formats: string[]) => void)(ajv, ["email", "uri", "date", "date-time"]);
  ajv.addFormat("phone", { type: "string", validate: isPhone });

  const widget: KeywordFn = (schema, data, parentSchema, cxt) => {
    const opts = ((parentSchema as Record<string, unknown> | undefined)?.["x-widgetOptions"] ?? {}) as WidgetOptions;
    const issues = validateWidget(schema as WidgetName, data as Json, opts, cxt?.rootData);
    widget.errors = issues.map((i) => ({ keyword: "x-widget", message: i.message, params: { path: i.path, type: i.type } }));
    return issues.length === 0;
  };
  ajv.addKeyword({ keyword: "x-widget", errors: true, validate: widget });
  ajv.addKeyword({ keyword: "x-widgetOptions" });

  const wordCount: KeywordFn = (schema, data) => {
    if (typeof data !== "string") return true;
    const issue = checkWordCount(data, schema as { min?: number; max?: number });
    wordCount.errors = issue ? [{ keyword: "x-wordCount", message: issue.message, params: { path: "", type: issue.type } }] : [];
    return !issue;
  };
  ajv.addKeyword({ keyword: "x-wordCount", errors: true, validate: wordCount });
  return ajv;
}

/** Ajv errors → CommonGrants `validationErrors`, in the same shape the interpreter produces. */
export function ajvErrorsToValidationErrors(errors: readonly ErrorObject[] | null | undefined): ValidationError[] {
  return (errors ?? [])
    .filter((e) => e.keyword !== "if")
    .map((e) => {
      const params = e.params as Record<string, unknown>;
      if (e.keyword === "required") return { field: `${e.instancePath}/${String(params.missingProperty)}`, message: "is required", type: "required" };
      if (e.keyword === "additionalProperties") return { field: `${e.instancePath}/${String(params.additionalProperty)}`, message: "is not an expected field", type: "additionalProperties" };
      if (e.keyword === "x-widget" || e.keyword === "x-wordCount") {
        return { field: e.instancePath + String(params.path ?? ""), message: e.message ?? "is invalid", type: String(params.type ?? "widget") };
      }
      return { field: e.instancePath, message: e.message ?? "is invalid", type: e.keyword };
    });
}
