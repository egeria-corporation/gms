// SPDX-License-Identifier: AGPL-3.0-only
// Award budgets (build spec §8 `budgets`): the approved budget set by the funder, the actuals the
// grantee reports per period, and the variance between them by category.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { STAFF_ROLES, accessAward, currencyOf, fundingOf, minorOf } from "./awards.ts";
import { audit, type ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

type Budget = Row<"budgets">;
interface Line {
  category: string;
  label: string;
  amountMinor: number;
  notes?: string | undefined;
}

const lineInput = z.object({ category: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(200), amountMinor: z.number().int().min(0).max(9_000_000_000_000), notes: z.string().trim().max(1000).optional() }).strict();
export const budgetInput = z
  .object({
    kind: z.enum(["approved", "actual"]),
    lines: z.array(lineInput).min(1).max(200),
    periodStart: z.iso.date().optional(),
    periodEnd: z.iso.date().optional(),
  })
  .strict()
  .refine((b) => b.kind !== "actual" || (!!b.periodStart && !!b.periodEnd && b.periodStart <= b.periodEnd), "Actuals need a reporting period");

const linesOf = (b: Budget): Line[] => ((b.lines as unknown as { category: string; label: string; amount_minor: number; notes?: string }[] | null) ?? []).map((l) => ({ category: l.category, label: l.label, amountMinor: l.amount_minor, ...(l.notes ? { notes: l.notes } : {}) }));
const total = (lines: Line[]) => lines.reduce((s, l) => s + l.amountMinor, 0);
const view = (b: Budget) => ({ id: b.id, kind: b.kind, currency: b.currency, categories: b.categories, lines: linesOf(b), totalMinor: total(linesOf(b)), source: b.source, periodStart: b.period_start, periodEnd: b.period_end, updatedAt: b.updated_at });

export async function getBudget(ctx: ServiceContext, awardId: string) {
  const { award } = await accessAward(ctx, awardId, "awards:read");
  const rows = await ctx.repos.table("budgets").find({ award_id: award.id }, { orderBy: "created_at" });
  const proposed = award.application_id ? (await ctx.repos.table("budgets").find({ application_id: award.application_id, kind: "proposed" }, { orderBy: "created_at", ascending: false, limit: 1 }))[0] : undefined;
  const approved = rows.filter((b) => b.kind === "approved").pop();
  return { awardId: apiId("award", award.id), currency: currencyOf(award), awardedAmountMinor: minorOf(fundingOf(award).awardedAmount), proposed: proposed ? view(proposed) : null, approved: approved ? view(approved) : null, actuals: rows.filter((b) => b.kind === "actual").map(view) };
}

/** The funder sets the approved budget; the grantee reports actuals for a period. */
export async function putBudget(ctx: ServiceContext, awardId: string, input: z.output<typeof budgetInput>) {
  const { award, side, ws } = await accessAward(ctx, awardId, "awards:write");
  const currency = currencyOf(award);
  const lines = input.lines.map((l) => ({ category: l.category, label: l.label, amount_minor: l.amountMinor, ...(l.notes ? { notes: l.notes } : {}) }));
  const categories = [...new Set(input.lines.map((l) => l.category))];
  const source = ctx.actor.kind === "user" ? "user" : `agent:${ctx.actor.clientId}`;
  if (input.kind === "approved") {
    if (side !== "funder" || (ws.role !== null && !(STAFF_ROLES as readonly string[]).includes(ws.role))) throw new ApiError(403, "forbidden", "Only the funder's program staff set the approved budget");
    const awarded = minorOf(fundingOf(award).awardedAmount) ?? 0;
    if (total(input.lines) > awarded) throw new ApiError(422, "budget_over_award", "The approved budget is more than the awarded amount");
    const existing = (await ctx.repos.table("budgets").find({ award_id: award.id, kind: "approved" })).pop();
    const saved = existing ? (await ctx.repos.table("budgets").update({ id: existing.id }, { lines: lines as unknown as Budget["lines"], categories: categories as unknown as Budget["categories"], source }))[0]! : await ctx.repos.table("budgets").insert({ workspace_id: award.workspace_id, award_id: award.id, kind: "approved", currency, lines: lines as unknown as Budget["lines"], categories: categories as unknown as Budget["categories"], source });
    await audit(ctx, "budget.approved", "award", award.id, { totalMinor: total(input.lines), categories: categories.length }, award.workspace_id);
    return view(saved);
  }
  if (side !== "recipient") throw new ApiError(403, "forbidden", "Actuals are reported by the grantee");
  const same = (await ctx.repos.table("budgets").find({ award_id: award.id, kind: "actual" })).find((b) => b.period_start === input.periodStart && b.period_end === input.periodEnd);
  const saved = same ? (await ctx.repos.table("budgets").update({ id: same.id }, { lines: lines as unknown as Budget["lines"], categories: categories as unknown as Budget["categories"], source }))[0]! : await ctx.repos.table("budgets").insert({ workspace_id: award.workspace_id, award_id: award.id, kind: "actual", currency, lines: lines as unknown as Budget["lines"], categories: categories as unknown as Budget["categories"], source, period_start: input.periodStart!, period_end: input.periodEnd! });
  await audit(ctx, "budget.actuals_reported", "award", award.id, { totalMinor: total(input.lines), periodStart: input.periodStart, periodEnd: input.periodEnd }, award.workspace_id);
  return view(saved);
}

/** Approved versus reported actuals, by category. A positive variance is money not yet spent. */
export async function getVariance(ctx: ServiceContext, awardId: string) {
  const b = await getBudget(ctx, awardId);
  const approved = new Map<string, number>();
  const actual = new Map<string, number>();
  for (const l of b.approved?.lines ?? []) approved.set(l.category, (approved.get(l.category) ?? 0) + l.amountMinor);
  for (const a of b.actuals) for (const l of a.lines) actual.set(l.category, (actual.get(l.category) ?? 0) + l.amountMinor);
  const categories = [...new Set([...approved.keys(), ...actual.keys()])].map((category) => {
    const ap = approved.get(category) ?? 0;
    const ac = actual.get(category) ?? 0;
    return { category, approvedMinor: ap, actualMinor: ac, varianceMinor: ap - ac, percentSpent: ap > 0 ? Math.round((ac / ap) * 1000) / 10 : null, over: ac > ap };
  });
  const ap = categories.reduce((s, c) => s + c.approvedMinor, 0);
  const ac = categories.reduce((s, c) => s + c.actualMinor, 0);
  return { awardId: b.awardId, currency: b.currency, hasApprovedBudget: !!b.approved, periods: b.actuals.map((a) => ({ periodStart: a.periodStart, periodEnd: a.periodEnd, totalMinor: a.totalMinor })), categories, totals: { approvedMinor: ap, actualMinor: ac, varianceMinor: ap - ac, over: ac > ap } };
}
