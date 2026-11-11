// SPDX-License-Identifier: AGPL-3.0-only
// Programs and rubrics: what a funder sets up before designing an opportunity.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { audit, authorize, guardWrite, required, type ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
}

export const programInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullable().optional(),
    fiscalYear: z.number().int().min(1990).max(2200).nullable().optional(),
    budgetAmountMinor: z.number().int().min(0).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    defaults: z.record(z.string(), z.unknown()).optional(),
    /** The staff member who owns the program; null clears it. Must be a member of the workspace. */
    ownerUserId: z.uuid().nullable().optional(),
  })
  .strict();

/** The funder's budget categories for awards under a program: short, unique names. */
export const budgetCategoriesInput = z
  .object({
    categories: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .refine((c) => new Set(c.map((x) => x.toLowerCase())).size === c.length, "Category names must be unique"),
  })
  .strict();

export const budgetCategoriesOf = (p: Pick<Row<"programs">, "defaults"> | null | undefined): string[] => {
  const raw = (p?.defaults as { budgetCategories?: unknown } | null)?.budgetCategories;
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && !!c.trim()) : [];
};
export const programPatch = programInput.partial();

type Owner = { userId: string; name: string | null } | null;

/** Owner names for a page of programs: one directory read. */
async function ownersOf(ctx: ServiceContext, rows: Row<"programs">[]): Promise<Map<string, Owner>> {
  const ids = [...new Set(rows.map((p) => p.owner_user_id).filter((id): id is string => !!id))];
  const people = ids.length ? await ctx.ports.directory?.lookup(ids) : undefined;
  return new Map(rows.map((p) => [p.id, p.owner_user_id ? { userId: p.owner_user_id, name: people?.get(p.owner_user_id)?.name ?? people?.get(p.owner_user_id)?.email ?? null } : null]));
}

const programView = (p: Row<"programs">, owner: Owner = p.owner_user_id ? { userId: p.owner_user_id, name: null } : null) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  fiscalYear: p.fiscal_year,
  budgetAmountMinor: p.budget_amount_minor,
  currency: p.currency,
  defaults: p.defaults,
  budgetCategories: budgetCategoriesOf(p),
  ownerUserId: p.owner_user_id,
  ownerName: owner?.name ?? null,
  owner,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

function programColumns(i: z.output<typeof programPatch>) {
  return {
    ...(i.name !== undefined ? { name: i.name } : {}),
    ...(i.description !== undefined ? { description: i.description } : {}),
    ...(i.fiscalYear !== undefined ? { fiscal_year: i.fiscalYear } : {}),
    ...(i.budgetAmountMinor !== undefined ? { budget_amount_minor: i.budgetAmountMinor } : {}),
    ...(i.currency !== undefined ? { currency: i.currency } : {}),
    ...(i.defaults !== undefined ? { defaults: i.defaults as Row<"programs">["defaults"] } : {}),
    ...(i.ownerUserId !== undefined ? { owner_user_id: i.ownerUserId } : {}),
  };
}

export async function listPrograms(ctx: ServiceContext, page: PageRequest) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  const where = { workspace_id: ws.id };
  const [rows, total] = await Promise.all([ctx.repos.table("programs").find(where, { orderBy: "name", limit: page.pageSize, offset: page.offset }), ctx.repos.table("programs").count(where)]);
  const owners = await ownersOf(ctx, rows);
  return { items: rows.map((p) => programView(p, owners.get(p.id))), total };
}

export async function getProgram(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  return withOwner(ctx, required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program"));
}

const withOwner = async (ctx: ServiceContext, p: Row<"programs">) => programView(p, (await ownersOf(ctx, [p])).get(p.id));

/** What a program patch may carry beyond plain columns: an owner who is on the team, and well-formed budget categories. */
async function checkProgramInput(ctx: ServiceContext, workspaceId: string, input: z.output<typeof programPatch>) {
  if (input.ownerUserId && !(await ctx.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: input.ownerUserId }))) {
    throw new ApiError(422, "owner_not_a_member", "The program owner must be a member of this workspace", [{ code: "invalid", field: "ownerUserId" }]);
  }
  const cats = (input.defaults as { budgetCategories?: unknown } | undefined)?.budgetCategories;
  if (cats !== undefined && !budgetCategoriesInput.safeParse({ categories: cats }).success) {
    throw new ApiError(422, "invalid_budget_categories", "Budget categories are up to 50 unique names of at most 100 characters", [{ code: "invalid", field: "defaults.budgetCategories" }]);
  }
}

export async function getBudgetCategories(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  return { programId: id, categories: budgetCategoriesOf(required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program")) };
}

export async function putBudgetCategories(ctx: ServiceContext, id: string, input: z.output<typeof budgetCategoriesInput>) {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder" });
  const before = required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program");
  const defaults = { ...((before.defaults as Record<string, unknown> | null) ?? {}), budgetCategories: input.categories };
  await ctx.repos.table("programs").update({ id, workspace_id: ws.id }, { defaults: defaults as Row<"programs">["defaults"] });
  await audit(ctx, "program.budget_categories_set", "program", id, { categories: input.categories });
  return { programId: id, categories: input.categories };
}

export async function createProgram(ctx: ServiceContext, input: z.output<typeof programInput>) {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder" });
  await checkProgramInput(ctx, ws.id, input);
  const row = await guardWrite("This program", () => ctx.repos.table("programs").insert({ workspace_id: ws.id, name: input.name, ...programColumns(input) }));
  await audit(ctx, "program.created", "program", row.id, { name: row.name, budgetAmountMinor: row.budget_amount_minor, currency: row.currency });
  return withOwner(ctx, row);
}

export async function updateProgram(ctx: ServiceContext, id: string, input: z.output<typeof programPatch>) {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder" });
  const before = required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program");
  await checkProgramInput(ctx, ws.id, input);
  const [row] = await guardWrite("This program", () => ctx.repos.table("programs").update({ id, workspace_id: ws.id }, programColumns(input)));
  // The budget is money the allocator reads, so a change to it is always on the ledger with both values.
  await audit(ctx, "program.updated", "program", id, { fields: Object.keys(input), ...(input.budgetAmountMinor !== undefined ? { budgetFromMinor: before.budget_amount_minor, budgetToMinor: input.budgetAmountMinor } : {}) });
  return withOwner(ctx, row!);
}

const criterion = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    weight: z.number().positive().max(1000),
    scale: z.union([
      z.object({ type: z.literal("numeric"), min: z.number(), max: z.number() }).strict().refine((s) => s.max > s.min, "max must be greater than min"),
      z.object({ type: z.literal("categorical"), options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1).optional(), score: z.number().min(0).max(1) }).strict()).min(2) }).strict(),
    ]),
    guidance: z.string().max(4000).optional(),
  })
  .strict();

export const rubricInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    criteria: z
      .array(criterion)
      .min(1)
      .refine((c) => new Set(c.map((x) => x.key)).size === c.length, "Criterion keys must be unique"),
    overall: z.object({ recommendations: z.array(z.string().min(1)).optional(), spreadThreshold: z.number().positive().optional() }).optional(),
  })
  .strict();

const rubricView = (r: Row<"rubrics">) => ({ id: r.id, version: r.version, name: r.name, criteria: r.criteria, overall: r.overall, shared: r.workspace_id === null, createdAt: r.created_at, updatedAt: r.updated_at });

/** The workspace's rubrics plus the shared library. */
export async function listRubrics(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder" });
  const [own, shared] = await Promise.all([ctx.repos.table("rubrics").find({ workspace_id: ws.id }, { orderBy: "name" }), ctx.repos.table("rubrics").find({ workspace_id: null }, { orderBy: "name" })]);
  return [...own, ...shared].map(rubricView);
}

export async function createRubric(ctx: ServiceContext, input: z.output<typeof rubricInput>) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder" });
  const row = await ctx.repos.table("rubrics").insert({ workspace_id: ws.id, name: input.name, criteria: input.criteria as Row<"rubrics">["criteria"], overall: (input.overall ?? {}) as Row<"rubrics">["overall"] });
  await audit(ctx, "rubric.created", "rubric", row.id, { name: row.name, version: row.version });
  return rubricView(row);
}
