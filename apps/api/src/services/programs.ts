// SPDX-License-Identifier: AGPL-3.0-only
// Programs and rubrics: what a funder sets up before designing an opportunity.
import { z } from "zod";
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
  })
  .strict();
export const programPatch = programInput.partial();

const programView = (p: Row<"programs">) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  fiscalYear: p.fiscal_year,
  budgetAmountMinor: p.budget_amount_minor,
  currency: p.currency,
  defaults: p.defaults,
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
  };
}

export async function listPrograms(ctx: ServiceContext, page: PageRequest) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  const where = { workspace_id: ws.id };
  const [rows, total] = await Promise.all([ctx.repos.table("programs").find(where, { orderBy: "name", limit: page.pageSize, offset: page.offset }), ctx.repos.table("programs").count(where)]);
  return { items: rows.map(programView), total };
}

export async function getProgram(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  return programView(required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program"));
}

export async function createProgram(ctx: ServiceContext, input: z.output<typeof programInput>) {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder" });
  const row = await guardWrite("This program", () => ctx.repos.table("programs").insert({ workspace_id: ws.id, name: input.name, ...programColumns(input) }));
  await audit(ctx, "program.created", "program", row.id, { name: row.name, budgetAmountMinor: row.budget_amount_minor, currency: row.currency });
  return programView(row);
}

export async function updateProgram(ctx: ServiceContext, id: string, input: z.output<typeof programPatch>) {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder" });
  const before = required(await ctx.repos.table("programs").one({ id, workspace_id: ws.id }), "Program");
  const [row] = await guardWrite("This program", () => ctx.repos.table("programs").update({ id, workspace_id: ws.id }, programColumns(input)));
  // The budget is money the allocator reads, so a change to it is always on the ledger with both values.
  await audit(ctx, "program.updated", "program", id, { fields: Object.keys(input), ...(input.budgetAmountMinor !== undefined ? { budgetFromMinor: before.budget_amount_minor, budgetToMinor: input.budgetAmountMinor } : {}) });
  return programView(row!);
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
