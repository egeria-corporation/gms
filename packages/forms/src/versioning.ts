// SPDX-License-Identifier: AGPL-3.0-only
// Form versioning: a published version is immutable; editing creates a draft of the next version;
// competitions pin versions; `migrate: true` re-validates in-progress responses.
import { validateMappings } from "./mapping.ts";
import { clone, formatPointer, isPlainObject } from "./pointer.ts";
import { computeResponseStatus } from "./response.ts";
import { checkSchemaSubset, resolveRef } from "./schema-subset.ts";
import type { DefinitionError, FormDefinition, FormSchema, JsonObject, Provenance, ResponseStatus, ValidationError } from "./types.ts";
import { validateUiSchema } from "./ui-schema.ts";
import { validateResponse } from "./validate.ts";

export class FormDefinitionError extends Error {
  readonly errors: DefinitionError[];
  constructor(message: string, errors: DefinitionError[] = []) {
    super(message);
    this.name = "FormDefinitionError";
    this.errors = errors;
  }
}

/** Everything checked at save time: schema subset, UI schema, mappings. */
export function validateFormDefinition(form: Pick<FormDefinition, "jsonSchema" | "uiSchema" | "mappingFromCommonGrants" | "mappingToCommonGrants">): DefinitionError[] {
  const schemaErrors = checkSchemaSubset(form.jsonSchema).map((e) => ({ ...e, path: `jsonSchema${e.path.replace(/^#/, "")}` }));
  if (schemaErrors.length) return schemaErrors;
  return [
    ...validateUiSchema(form.uiSchema, form.jsonSchema).map((e) => ({ ...e, path: `uiSchema${e.path.replace(/^#/, "")}` })),
    ...validateMappings(form),
  ];
}

export const isPublished = (form: Pick<FormDefinition, "publishedAt">): boolean => !!form.publishedAt;

/** Throws when the version is published. Call before any write to a form version. */
export function assertEditable(form: Pick<FormDefinition, "id" | "version" | "publishedAt">): void {
  if (isPublished(form)) {
    throw new FormDefinitionError(`form ${form.id} v${form.version} is published and immutable; create a draft of v${form.version + 1}`);
  }
}

export function publishForm<T extends FormDefinition>(form: T, now: Date = new Date()): T {
  assertEditable(form);
  const errors = validateFormDefinition(form);
  if (errors.length) throw new FormDefinitionError(`form ${form.id} v${form.version} cannot be published`, errors);
  return { ...clone(form), publishedAt: now.toISOString() };
}

/** The editable draft that follows a published version. */
export function nextDraft<T extends FormDefinition>(published: T): T {
  if (!isPublished(published)) throw new FormDefinitionError(`form ${published.id} v${published.version} is still a draft; edit it directly`);
  return { ...clone(published), version: published.version + 1, publishedAt: null, supersedesFormVersion: published.version };
}

/** Removes values for fields the schema no longer declares. Returns the pruned copy and what was dropped. */
export function pruneToSchema(schema: FormSchema, response: JsonObject): { response: JsonObject; dropped: string[] } {
  const dropped: string[] = [];
  const walk = (node: FormSchema | undefined, value: JsonObject, segs: string[]): JsonObject => {
    const n = node?.$ref ? resolveRef(schema, node.$ref) ?? node : node;
    if (!n?.properties || n["x-widget"]) return value;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      const sub = n.properties[k];
      if (!sub) {
        if (n.additionalProperties === true) out[k] = v;
        else dropped.push(formatPointer([...segs, k]));
      } else out[k] = isPlainObject(v) ? walk(sub, v, [...segs, k]) : v;
    }
    return out;
  };
  return { response: walk(schema, clone(response), []), dropped };
}

export interface MigrationInput {
  id: string;
  response: JsonObject;
  provenance?: Provenance | null;
}
export interface MigrationResult {
  id: string;
  formVersion: number;
  response: JsonObject;
  dropped: string[];
  status: ResponseStatus;
  validationErrors: ValidationError[];
}

/** Re-validates in-progress responses against a newly pinned form version. */
export function migrateResponses(target: FormDefinition, responses: readonly MigrationInput[]): MigrationResult[] {
  return responses.map((r) => {
    const { response, dropped } = pruneToSchema(target.jsonSchema, r.response);
    return {
      id: r.id,
      formVersion: target.version,
      response,
      dropped,
      status: computeResponseStatus(target, response, r.provenance),
      validationErrors: validateResponse(target, response).validationErrors,
    };
  });
}
