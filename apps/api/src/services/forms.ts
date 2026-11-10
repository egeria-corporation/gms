// SPDX-License-Identifier: AGPL-3.0-only
// Forms: CommonGrants `FormBase`, versioned. A published version is immutable; editing creates the
// next draft (build spec §10.2). Definitions are checked by `@gms/forms` before every save.
import { FormDefinitionError, assertEditable, nextDraft, publishForm, testFill, validateFormDefinition, type FormDefinition } from "@gms/forms";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { unprocessable } from "../lib/input.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import type { PageRequest } from "./programs.ts";
import type { Row } from "./repos/types.ts";

const PURPOSES = ["application", "report", "loi", "amendment", "site_visit", "other"] as const;
const json = z.record(z.string(), z.unknown());

export const formInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10_000).nullable().optional(),
    instructions: z.string().max(20_000).nullable().optional(),
    purpose: z.enum(PURPOSES).optional(),
    jsonSchema: json.optional(),
    uiSchema: json.optional(),
    mappingFromCommonGrants: json.optional(),
    mappingToCommonGrants: json.optional(),
    fieldMeta: json.optional(),
    /** Start from a published library or workspace form instead of an empty one. */
    copyFrom: z.object({ id: z.string(), version: z.number().int().min(1).optional() }).strict().optional(),
  })
  .strict();
export const formPatch = formInput.omit({ copyFrom: true }).partial();

type FormRow = Row<"forms">;
type J = FormRow["json_schema"];

export const toDefinition = (r: FormRow): FormDefinition =>
  ({
    id: r.id,
    version: r.version,
    title: r.title,
    ...(r.description ? { description: r.description } : {}),
    ...(r.instructions ? { instructions: r.instructions } : {}),
    jsonSchema: r.json_schema,
    uiSchema: r.ui_schema,
    mappingFromCommonGrants: r.mapping_from_cg,
    mappingToCommonGrants: r.mapping_to_cg,
    fieldMeta: r.field_meta,
    publishedAt: r.published_at,
    supersedesFormVersion: r.supersedes_form_version,
  }) as unknown as FormDefinition;

export const formView = (r: FormRow) => ({
  id: apiId("form", r.id),
  version: r.version,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  purpose: r.purpose,
  jsonSchema: r.json_schema,
  uiSchema: r.ui_schema,
  mappingFromCommonGrants: r.mapping_from_cg,
  mappingToCommonGrants: r.mapping_to_cg,
  fieldMeta: r.field_meta,
  status: r.published_at ? ("published" as const) : ("draft" as const),
  publishedAt: r.published_at,
  supersedesFormVersion: r.supersedes_form_version,
  shared: r.workspace_id === null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const summary = (r: FormRow) => {
  const { jsonSchema: _s, uiSchema: _u, mappingFromCommonGrants: _f, mappingToCommonGrants: _t, fieldMeta: _m, ...rest } = formView(r);
  return rest;
};

function columns(i: z.output<typeof formPatch>) {
  return {
    ...(i.title !== undefined ? { title: i.title } : {}),
    ...(i.description !== undefined ? { description: i.description } : {}),
    ...(i.instructions !== undefined ? { instructions: i.instructions } : {}),
    ...(i.purpose !== undefined ? { purpose: i.purpose } : {}),
    ...(i.jsonSchema !== undefined ? { json_schema: i.jsonSchema as J } : {}),
    ...(i.uiSchema !== undefined ? { ui_schema: i.uiSchema as J } : {}),
    ...(i.mappingFromCommonGrants !== undefined ? { mapping_from_cg: i.mappingFromCommonGrants as J } : {}),
    ...(i.mappingToCommonGrants !== undefined ? { mapping_to_cg: i.mappingToCommonGrants as J } : {}),
    ...(i.fieldMeta !== undefined ? { field_meta: i.fieldMeta as J } : {}),
  };
}

function assertValid(def: FormDefinition) {
  const errors = validateFormDefinition(def);
  if (errors.length) throw unprocessable("This form definition is not valid", errors);
}

/** Every version of a form the caller may read: the workspace's own, or the shared library's. */
async function versions(ctx: ServiceContext, workspaceId: string, id: string): Promise<FormRow[]> {
  const rows = await ctx.repos.table("forms").find({ id }, { orderBy: "version" });
  return rows.filter((r) => r.workspace_id === workspaceId || r.workspace_id === null).sort((a, b) => a.version - b.version);
}

const latestOf = (rows: FormRow[]) => rows[rows.length - 1];

/** The workspace's forms, newest version of each. */
export async function listForms(ctx: ServiceContext, page: PageRequest, filter: { purpose?: string } = {}) {
  const ws = await authorize(ctx, { scope: "forms:read", kind: "funder" });
  return latestPage(await ctx.repos.table("forms").find({ workspace_id: ws.id, ...(filter.purpose ? { purpose: filter.purpose } : {}) }), page);
}

/** The shared form library (published versions only). */
export async function listLibrary(ctx: ServiceContext, page: PageRequest) {
  await authorize(ctx, { scope: "forms:read" });
  return latestPage(await ctx.repos.table("forms").find({ workspace_id: null }, { notNull: ["published_at"] }), page);
}

function latestPage(rows: FormRow[], page: PageRequest) {
  const latest = new Map<string, FormRow>();
  for (const r of rows) if ((latest.get(r.id)?.version ?? 0) < r.version) latest.set(r.id, r);
  const all = [...latest.values()].sort((a, b) => a.title.localeCompare(b.title));
  return { items: all.slice(page.offset, page.offset + page.pageSize).map(summary), total: all.length };
}

export async function getForm(ctx: ServiceContext, id: string, version?: number) {
  const ws = await authorize(ctx, { scope: "forms:read" });
  const rows = await versions(ctx, ws.id, id);
  const row = required(version === undefined ? latestOf(rows) : rows.find((r) => r.version === version), "Form");
  return { ...formView(row), versions: rows.map((r) => ({ version: r.version, status: r.published_at ? "published" : "draft", publishedAt: r.published_at })) };
}

export async function createForm(ctx: ServiceContext, input: z.output<typeof formInput>, copyFromId?: string) {
  const ws = await authorize(ctx, { scope: "forms:write", kind: "funder" });
  let base: Partial<FormRow> = {};
  if (input.copyFrom && copyFromId) {
    const rows = (await versions(ctx, ws.id, copyFromId)).filter((r) => r.published_at);
    const src = required(input.copyFrom.version ? rows.find((r) => r.version === input.copyFrom!.version) : latestOf(rows), "Form to copy");
    base = { json_schema: src.json_schema, ui_schema: src.ui_schema, mapping_from_cg: src.mapping_from_cg, mapping_to_cg: src.mapping_to_cg, field_meta: src.field_meta, purpose: src.purpose, description: src.description, instructions: src.instructions };
  }
  const { copyFrom: _c, ...fields } = input;
  const draft = { ...base, ...columns(fields), title: input.title };
  assertValid(toDefinition({ id: "new", version: 1, json_schema: { type: "object", properties: {} }, ui_schema: { type: "VerticalLayout", elements: [] }, mapping_from_cg: {}, mapping_to_cg: {}, field_meta: {}, ...draft } as FormRow));
  const row = await ctx.repos.table("forms").insert({ workspace_id: ws.id, version: 1, ...draft });
  await audit(ctx, "form.created", "form", row.id, { title: row.title, version: 1, ...(copyFromId ? { copiedFrom: copyFromId } : {}) });
  return formView(row);
}

/** Edit the current draft. A published version answers 409: create the next version first. */
export async function updateForm(ctx: ServiceContext, id: string, input: z.output<typeof formPatch>) {
  const ws = await authorize(ctx, { scope: "forms:write", kind: "funder" });
  const current = required(latestOf(await ctx.repos.table("forms").find({ id, workspace_id: ws.id }, { orderBy: "version" })), "Form");
  try {
    assertEditable(toDefinition(current));
  } catch (e) {
    if (e instanceof FormDefinitionError) throw new ApiError(409, "form_published", `Version ${current.version} is published and cannot change. Create version ${current.version + 1} to edit`);
    throw e;
  }
  const patch = columns(input);
  assertValid(toDefinition({ ...current, ...patch } as FormRow));
  const [row] = await ctx.repos.table("forms").update({ id, version: current.version, workspace_id: ws.id }, patch);
  await audit(ctx, "form.updated", "form", id, { version: current.version, fields: Object.keys(input) });
  return formView(row!);
}

/** Start the next draft from the latest published version. */
export async function createFormVersion(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "forms:write", kind: "funder" });
  const current = required(latestOf(await ctx.repos.table("forms").find({ id, workspace_id: ws.id }, { orderBy: "version" })), "Form");
  if (!current.published_at) throw new ApiError(409, "draft_exists", `Version ${current.version} is still a draft. Edit it, or publish it before starting the next version`);
  const next = nextDraft(toDefinition(current));
  const row = await ctx.repos.table("forms").insert({
    id,
    version: next.version,
    workspace_id: ws.id,
    title: current.title,
    description: current.description,
    instructions: current.instructions,
    json_schema: current.json_schema,
    ui_schema: current.ui_schema,
    mapping_from_cg: current.mapping_from_cg,
    mapping_to_cg: current.mapping_to_cg,
    field_meta: current.field_meta,
    purpose: current.purpose,
    supersedes_form_version: current.version,
  });
  await audit(ctx, "form.version_created", "form", id, { version: row.version, supersedes: current.version });
  return formView(row);
}

export async function publishFormVersion(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "forms:write", kind: "funder" });
  const current = required(latestOf(await ctx.repos.table("forms").find({ id, workspace_id: ws.id }, { orderBy: "version" })), "Form");
  if (current.published_at) throw new ApiError(409, "form_published", `Version ${current.version} is already published`);
  let published: FormDefinition;
  try {
    published = publishForm(toDefinition(current), ctx.now());
  } catch (e) {
    if (e instanceof FormDefinitionError) throw unprocessable("This form cannot be published yet", e.errors.length ? e.errors : [{ path: "", message: e.message }]);
    throw e;
  }
  const [row] = await ctx.repos.table("forms").update({ id, version: current.version, workspace_id: ws.id }, { published_at: published.publishedAt });
  await audit(ctx, "form.published", "form", id, { version: current.version });
  return formView(row!);
}

/** A realistic generated response, for previews and tests. Deterministic for a seed. */
export async function testFillForm(ctx: ServiceContext, id: string, opts: { version?: number; seed?: number } = {}) {
  const ws = await authorize(ctx, { scope: "forms:read" });
  const rows = await versions(ctx, ws.id, id);
  const row = required(opts.version === undefined ? latestOf(rows) : rows.find((r) => r.version === opts.version), "Form");
  return { formId: apiId("form", row.id), version: row.version, response: testFill(toDefinition(row), { seed: opts.seed ?? 1 }) };
}
