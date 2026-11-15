// SPDX-License-Identifier: AGPL-3.0-only
// Funds: one funder workspace, many funds (migration 0039). A fund has a name, a public address,
// a short description, an optional brand from the theme palette and its own budget per fiscal
// year. Programs belong to one fund; everything under a program belongs to its fund. Every funder
// workspace has a default fund that holds the programs made before funds existed.
//
// Who sees what is decided once, in `authorize()` (context.ts, `fundScopeOf`): a fund advisor's
// reads here pass through their funds like every other read, so this file has no filter of its own.
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, fundScopeOf, guardWrite, required, type ServiceContext } from "./context.ts";
import { funderPage, type PublicContext } from "./public.ts";
import type { Row } from "./repos/types.ts";
import { createInvitation } from "./workspaces.ts";

type Fund = Row<"funds">;

/** The theme palette a fund's colour comes from (tokens.css). Never a hex value. */
export const FUND_COLORS = ["teal", "blue", "mint", "navy", "gray"] as const;
/** Words a fund's address cannot be: they are pages of the funder's site (`/f/{handle}/o/…`, `/f/{handle}/awards`). */
export const RESERVED_FUND_SLUGS: readonly string[] = ["o", "awards", "embed", "apply", "funds", "fund", "badge", "programs", "opportunities", "new", "settings", "about", "join"];
/** The roles "Advisor for {fund}" may be invited with: no new role, a scope on an existing one. */
export const ADVISOR_ROLES = ["reviewer", "program_officer"] as const;

const slug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "Use lowercase letters, digits and hyphens")
  .refine((s) => !RESERVED_FUND_SLUGS.includes(s), "That address is used by the funder's own pages. Choose another");

export const fundInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slug.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    brand: z
      .object({
        color: z.enum(FUND_COLORS).nullable().optional(),
        logoUrl: z.url().max(500).refine((u) => u.startsWith("https://"), "Use an https link").nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const fundPatch = fundInput.partial();

export const fundBudgetsInput = z
  .object({
    budgets: z
      .array(z.object({ fiscalYear: z.number().int().min(1990).max(2200), amountMinor: z.number().int().min(0).max(1e15), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict())
      .max(50)
      .refine((b) => new Set(b.map((x) => x.fiscalYear)).size === b.length, "One budget per fiscal year"),
  })
  .strict();

export const advisorInput = z.object({ email: z.email().max(320), role: z.enum(ADVISOR_ROLES), expiresInDays: z.number().int().min(1).max(90).optional() }).strict();

export const slugifyFund = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "") || "fund";

interface FundBudget {
  fiscalYear: number;
  amountMinor: number;
  currency: string;
}
const budgetsOf = (f: Pick<Fund, "budgets">): FundBudget[] =>
  (Array.isArray(f.budgets) ? (f.budgets as unknown[]) : []).flatMap((b) => {
    const x = b as Partial<FundBudget> | null;
    return x && typeof x.fiscalYear === "number" && typeof x.amountMinor === "number" ? [{ fiscalYear: x.fiscalYear, amountMinor: x.amountMinor, currency: typeof x.currency === "string" ? x.currency : "USD" }] : [];
  });
const brandOf = (f: Pick<Fund, "brand">) => {
  const b = (f.brand ?? {}) as { color?: unknown; logoUrl?: unknown };
  return { color: typeof b.color === "string" && (FUND_COLORS as readonly string[]).includes(b.color) ? b.color : null, logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null };
};

/**
 * A fund's budget for each fiscal year beside its programs' budgets for that year. A year appears
 * when the fund has a budget for it or a program of the fund is budgeted in it. `availableMinor`
 * is the fund's budget less its programs' (negative when the programs are budgeted past it).
 */
export function budgetTotals(fund: Pick<Fund, "budgets">, programs: Pick<Row<"programs">, "fiscal_year" | "budget_amount_minor" | "currency">[]) {
  const own = budgetsOf(fund);
  const years = [...new Set([...own.map((b) => b.fiscalYear), ...programs.flatMap((p) => (p.fiscal_year !== null && p.budget_amount_minor !== null ? [p.fiscal_year] : []))])].sort((a, b) => a - b);
  return years.map((fiscalYear) => {
    const b = own.find((x) => x.fiscalYear === fiscalYear) ?? null;
    const currency = b?.currency ?? programs.find((p) => p.fiscal_year === fiscalYear)?.currency ?? "USD";
    const inYear = programs.filter((p) => p.fiscal_year === fiscalYear && p.budget_amount_minor !== null && p.currency === currency);
    const programsMinor = inYear.reduce((n, p) => n + (p.budget_amount_minor ?? 0), 0);
    const budgetMinor = b?.amountMinor ?? null;
    const availableMinor = budgetMinor === null ? null : budgetMinor - programsMinor;
    return { fiscalYear, currency, budgetMinor, programsMinor, programCount: inYear.length, availableMinor, over: availableMinor !== null && availableMinor < 0 };
  });
}

const fundView = (f: Fund, programs: Row<"programs">[] = []) => ({
  id: f.id,
  name: f.name,
  slug: f.slug,
  description: f.description,
  brand: brandOf(f),
  isDefault: f.is_default,
  budgets: budgetsOf(f),
  totals: budgetTotals(f, programs),
  programCount: programs.length,
  programIds: programs.map((p) => p.id),
  createdAt: f.created_at,
  updatedAt: f.updated_at,
});

/** The default fund of a workspace, made once when it has none (the database does the same: gms.default_fund_of). */
export async function ensureDefaultFund(ctx: Pick<ServiceContext, "repos">, workspaceId: string): Promise<Fund> {
  const existing = await ctx.repos.table("funds").one({ workspace_id: workspaceId, is_default: true });
  if (existing) return existing;
  const taken = await ctx.repos.table("funds").one({ workspace_id: workspaceId, slug: "default" });
  try {
    return await ctx.repos.table("funds").insert({ workspace_id: workspaceId, name: "Default fund", slug: taken ? `default-fund-${workspaceId.slice(0, 6)}` : "default", is_default: true });
  } catch (e) {
    // Two requests at once: the other one made it.
    const made = await ctx.repos.table("funds").one({ workspace_id: workspaceId, is_default: true });
    if (made) return made;
    throw e;
  }
}

/**
 * The fund a new program goes into: the one named, else the default fund. A fund advisor names one
 * of their funds, or has exactly one.
 */
export async function fundForProgram(ctx: ServiceContext, workspaceId: string, fundId: string | null | undefined): Promise<Fund> {
  if (fundId) return required(await ctx.repos.table("funds").one({ id: fundId, workspace_id: workspaceId }), "Fund");
  const scope = fundScopeOf(ctx.workspace);
  if (scope) {
    const mine = await ctx.repos.table("funds").find({ workspace_id: workspaceId });
    if (mine.length === 1) return mine[0]!;
    throw new ApiError(422, "fund_required", "Choose the fund this program belongs to", [{ code: "invalid", field: "fundId" }]);
  }
  return ensureDefaultFund(ctx, workspaceId);
}

/** Whether the caller sees every fund, and the funds they see (in order: the default first, then by name). */
export async function listFunds(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  const scope = fundScopeOf(ws);
  if (!scope) await ensureDefaultFund(ctx, ws.id);
  const [funds, programs] = await Promise.all([ctx.repos.table("funds").find({ workspace_id: ws.id }, { orderBy: "name" }), ctx.repos.table("programs").find({ workspace_id: ws.id }, { orderBy: "name", limit: 5000 })]);
  const sorted = [...funds].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  return { items: sorted.map((f) => fundView(f, programs.filter((p) => p.fund_id === f.id))), scoped: scope !== null };
}

export async function getFund(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  const fund = required(await ctx.repos.table("funds").one({ id, workspace_id: ws.id }), "Fund");
  const programs = await ctx.repos.table("programs").find({ workspace_id: ws.id, fund_id: fund.id }, { orderBy: "name" });
  const members = await ctx.repos.table("workspace_members").find({ workspace_id: ws.id });
  const advisors = members.filter((m) => m.role !== "admin" && Array.isArray((m.scope as { fundIds?: unknown } | null)?.fundIds) && ((m.scope as { fundIds: unknown[] }).fundIds).includes(fund.id));
  const people = advisors.length ? await ctx.ports.directory?.lookup(advisors.map((m) => m.user_id)) : undefined;
  return {
    ...fundView(fund, programs),
    advisors: advisors.map((m) => ({ userId: m.user_id, role: m.role, name: people?.get(m.user_id)?.name ?? null, email: people?.get(m.user_id)?.email ?? ((m.scope as { email?: unknown }).email as string | undefined) ?? null })),
  };
}

const ADMIN = { scope: "workspace:admin", kind: "funder", roles: ["admin"] } as const;

export async function createFund(ctx: ServiceContext, input: z.output<typeof fundInput>) {
  const ws = await authorize(ctx, ADMIN);
  const row = await guardWrite("A fund with this address", () =>
    ctx.repos.table("funds").insert({ workspace_id: ws.id, name: input.name, slug: input.slug ?? slugifyFund(input.name), description: input.description || null, brand: (input.brand ?? {}) as Fund["brand"] }),
  );
  await audit(ctx, "fund.created", "fund", row.id, { name: row.name, slug: row.slug });
  return fundView(row);
}

export async function updateFund(ctx: ServiceContext, id: string, input: z.output<typeof fundPatch>) {
  const ws = await authorize(ctx, ADMIN);
  const before = required(await ctx.repos.table("funds").one({ id, workspace_id: ws.id }), "Fund");
  const patch = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.description !== undefined ? { description: input.description || null } : {}),
    ...(input.brand !== undefined ? { brand: { ...brandOf(before), ...input.brand } as Fund["brand"] } : {}),
  };
  const [row] = await guardWrite("A fund with this address", () => ctx.repos.table("funds").update({ id, workspace_id: ws.id }, patch));
  await audit(ctx, "fund.updated", "fund", id, { fields: Object.keys(input), ...(input.slug !== undefined && input.slug !== before.slug ? { slugFrom: before.slug, slugTo: input.slug } : {}) });
  const programs = await ctx.repos.table("programs").find({ workspace_id: ws.id, fund_id: id });
  return fundView(row!, programs);
}

/** The fund's own budget per fiscal year. Money the allocator may read later, so both values go on the ledger. */
export async function putFundBudgets(ctx: ServiceContext, id: string, input: z.output<typeof fundBudgetsInput>) {
  const ws = await authorize(ctx, ADMIN);
  const before = required(await ctx.repos.table("funds").one({ id, workspace_id: ws.id }), "Fund");
  const budgets = [...input.budgets].sort((a, b) => a.fiscalYear - b.fiscalYear).map((b) => ({ fiscalYear: b.fiscalYear, amountMinor: b.amountMinor, currency: b.currency ?? "USD" }));
  const [row] = await ctx.repos.table("funds").update({ id, workspace_id: ws.id }, { budgets: budgets as unknown as Fund["budgets"] });
  await audit(ctx, "fund.budgets_set", "fund", id, { from: budgetsOf(before), to: budgets });
  const programs = await ctx.repos.table("programs").find({ workspace_id: ws.id, fund_id: id });
  return fundView(row!, programs);
}

/**
 * "Advisor for {fund}": an invitation with an existing role (reviewer or program officer) and a
 * scope naming this fund. Changes who can see what, so it is a person's action with no MCP tool.
 */
export async function inviteAdvisor(ctx: ServiceContext, fundId: string, input: z.output<typeof advisorInput>) {
  const ws = await authorize(ctx, { ...ADMIN, person: true });
  const fund = required(await ctx.repos.table("funds").one({ id: fundId, workspace_id: ws.id }), "Fund");
  const invitation = await createInvitation(ctx, ws.id, { email: input.email, role: input.role, scope: { fundIds: [fund.id] }, ...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}) });
  await audit(ctx, "fund.advisor_invited", "fund", fund.id, { invitationId: invitation.id, role: input.role });
  return { ...invitation, fund: { id: fund.id, name: fund.name } };
}

// ------------------------------------------------------------------------------------ public

/** What the public pages show of a fund: never its budgets or who advises it. */
export const publicFundView = (f: Pick<Fund, "name" | "slug" | "description" | "brand" | "is_default">) => ({ name: f.name, slug: f.slug, description: f.description, brand: brandOf(f), isDefault: f.is_default });

/**
 * A funder's funds as the public pages group its opportunities: each fund with the ids of its
 * published opportunities. For the funder page (sections when more than one fund has open calls)
 * and the opportunity page ("A fund of {Funder}").
 */
export async function publicFundsOf(ctx: PublicContext, workspaceId: string): Promise<(ReturnType<typeof publicFundView> & { opportunityIds: string[] })[]> {
  const [funds, programs, opps] = await Promise.all([
    ctx.repos.table("funds").find({ workspace_id: workspaceId }, { orderBy: "name" }),
    ctx.repos.table("programs").find({ workspace_id: workspaceId }, { limit: 5000 }),
    ctx.repos.table("opportunities").find({ workspace_id: workspaceId }, { notNull: ["published_at"], limit: 5000 }),
  ]);
  const fundOf = new Map(programs.map((p) => [p.id, p.fund_id]));
  return funds.map((f) => ({ ...publicFundView(f), opportunityIds: opps.filter((o) => o.program_id && fundOf.get(o.program_id) === f.id).map((o) => o.id) }));
}

/** Data for `/f/{handle}/{fundSlug}`: the funder, the fund, and that fund's published opportunities. */
export async function publicFundPage(ctx: PublicContext, handle: string, fundSlug: string) {
  const page = await funderPage(ctx, handle);
  const w = required(await ctx.repos.table("workspaces").one({ handle, kind: "funder" }), "Funder");
  const fund = await ctx.repos.table("funds").one({ workspace_id: w.id, slug: fundSlug });
  if (!fund) throw notFound("Fund");
  const ids = new Set((await publicFundsOf(ctx, w.id)).find((f) => f.slug === fund.slug)?.opportunityIds ?? []);
  const cards = page.opportunities.filter((o) => ids.has(o.id));
  return { funder: page.funder, fund: publicFundView(fund), opportunities: cards, open: cards.filter((o) => o.status === "open"), forecasted: cards.filter((o) => o.status === "forecasted") };
}

/** The fund an opportunity page names ("{Fund} · A fund of {Funder}"), or null when it has none. */
export async function publicFundOfOpportunity(ctx: PublicContext, workspaceId: string, opportunityId: string): Promise<{ name: string; slug: string; isDefault: boolean } | null> {
  const fund = (await publicFundsOf(ctx, workspaceId)).find((f) => f.opportunityIds.includes(opportunityId));
  return fund ? { name: fund.name, slug: fund.slug, isDefault: fund.isDefault } : null;
}
