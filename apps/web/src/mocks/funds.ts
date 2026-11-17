// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/funds.ts over the mock API's own workspaces, so programs, the public
// pages and invitations behave as the Worker's do: every funder workspace starts with a Default fund
// holding the programs made before funds; a program names its fund; a person who accepted an
// "Advisor for {fund}" invitation sees only that fund's programs, opportunities, competitions and
// awards; the public funder page groups its opportunities by fund.
import type { GmsApi, Me } from "../api/client.ts";
import { RESERVED_FUND_SLUGS, fundOfProgram, type Fund, type FundBudgetInput, type FundDetail, type FundList, type FundsApi, type PublicFund } from "../api/funds.ts";
import type { Program } from "../api/types.ts";
import { slugify } from "../lib/format.ts";
import type { Store, WorkspaceData } from "./store.ts";

interface MockFund {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: Fund["brand"];
  isDefault: boolean;
  budgets: Fund["budgets"];
  createdAt: string;
  updatedAt: string;
}
interface MockAdvisor {
  email: string;
  role: string;
  fundId: string;
}
interface FundsData {
  funds: MockFund[];
  advisors: MockAdvisor[];
}

export interface MockFundsContext {
  /** The funder workspace the caller acts in. */
  ws: () => Promise<WorkspaceData>;
  me: () => Promise<Me>;
  now: () => string;
  store: Store;
  fail: (status: number, message: string, errors?: unknown[]) => Error;
}

const data = new WeakMap<WorkspaceData, FundsData>();
const clone = <T>(v: T): T => structuredClone(v);

function fundsOf(w: WorkspaceData, now: string): FundsData {
  let d = data.get(w);
  if (!d) {
    d = { funds: [{ id: crypto.randomUUID(), name: "Default fund", slug: "default", description: null, brand: { color: null, logoUrl: null }, isDefault: true, budgets: [], createdAt: now, updatedAt: now }], advisors: [] };
    data.set(w, d);
  }
  return d;
}

/** As the server's budgetTotals (apps/api/src/services/funds.ts). */
function totals(f: MockFund, programs: Program[]): Fund["totals"] {
  const years = [...new Set([...f.budgets.map((b) => b.fiscalYear), ...programs.flatMap((p) => (p.fiscalYear !== null && p.budgetAmountMinor !== null ? [p.fiscalYear] : []))])].sort((a, b) => a - b);
  return years.map((fiscalYear) => {
    const b = f.budgets.find((x) => x.fiscalYear === fiscalYear) ?? null;
    const currency = b?.currency ?? programs.find((p) => p.fiscalYear === fiscalYear)?.currency ?? "USD";
    const inYear = programs.filter((p) => p.fiscalYear === fiscalYear && p.budgetAmountMinor !== null && p.currency === currency);
    const programsMinor = inYear.reduce((n, p) => n + (p.budgetAmountMinor ?? 0), 0);
    const budgetMinor = b?.amountMinor ?? null;
    const availableMinor = budgetMinor === null ? null : budgetMinor - programsMinor;
    return { fiscalYear, currency, budgetMinor, programsMinor, programCount: inYear.length, availableMinor, over: availableMinor !== null && availableMinor < 0 };
  });
}

/** The fund API in the browser, plus the mock API's own reads narrowed to a fund advisor's funds. */
export function createMockFundsApi(ctx: MockFundsContext, base: Omit<GmsApi, keyof FundsApi>): FundsApi & Pick<GmsApi, "listPrograms" | "createProgram" | "updateProgram" | "listOpportunities" | "listCompetitions" | "listAwards" | "publicFunder" | "publicOpportunity"> {
  const now = ctx.now;
  const view = (w: WorkspaceData, f: MockFund): Fund => {
    const d = fundsOf(w, now());
    const programs = w.programs.filter((p) => fundOfProgram(d.funds, p) === f.id);
    return { ...clone(f), totals: totals(f, programs), programCount: programs.length, programIds: programs.map((p) => p.id) };
  };
  /** Null for everyone who sees every fund; the advisor's funds otherwise. */
  async function scope(w: WorkspaceData): Promise<string[] | null> {
    const me = await ctx.me();
    const m = me.workspaces.find((x) => x.id === w.record.id);
    if (!m || m.role === "admin") return null;
    const mine = fundsOf(w, now()).advisors.filter((a) => a.email === me.email.toLowerCase());
    return mine.length ? mine.map((a) => a.fundId) : null;
  }
  async function visible(): Promise<{ w: WorkspaceData; d: FundsData; funds: MockFund[]; scoped: boolean }> {
    const w = await ctx.ws();
    const d = fundsOf(w, now());
    const s = await scope(w);
    return { w, d, funds: s ? d.funds.filter((f) => s.includes(f.id)) : d.funds, scoped: s !== null };
  }
  async function admin(): Promise<{ w: WorkspaceData; d: FundsData }> {
    const w = await ctx.ws();
    const me = await ctx.me();
    if (me.workspaces.find((x) => x.id === w.record.id)?.role !== "admin") throw ctx.fail(403, "Only a workspace admin can change funds");
    return { w, d: fundsOf(w, now()) };
  }
  const found = (funds: MockFund[], id: string) => {
    const f = funds.find((x) => x.id === id);
    if (!f) throw ctx.fail(404, "Fund not found");
    return f;
  };
  function checkSlug(d: FundsData, slug: string, self?: MockFund) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) throw ctx.fail(400, "The request body is not valid", [{ code: "invalid_field", field: "slug", detail: "Use lowercase letters, digits and hyphens" }]);
    if (RESERVED_FUND_SLUGS.includes(slug)) throw ctx.fail(400, "The request body is not valid", [{ code: "invalid_field", field: "slug", detail: "That address is used by the funder's own pages. Choose another" }]);
    if (d.funds.some((f) => f !== self && f.slug === slug)) throw ctx.fail(409, "A fund with this address already exists");
  }
  /** The workspace's programs a caller sees, each with the fund it belongs to. */
  async function programsSeen() {
    const v = await visible();
    const ids = new Set(v.funds.map((f) => f.id));
    return { ...v, programIds: new Set(v.w.programs.filter((p) => ids.has(fundOfProgram(v.d.funds, p) ?? "")).map((p) => p.id)) };
  }
  const fundSections = (w: WorkspaceData) => {
    const d = fundsOf(w, now());
    return d.funds.map((f) => ({ name: f.name, slug: f.slug, description: f.description, isDefault: f.isDefault, opportunityIds: w.opportunities.filter((o) => o.published && o.programId && fundOfProgram(d.funds, w.programs.find((p) => p.id === o.programId) ?? {}) === f.id).map((o) => o.id.replace(/^opp_/, "")) }));
  };
  const publicView = (f: MockFund): PublicFund => ({ name: f.name, slug: f.slug, description: f.description, brand: clone(f.brand), isDefault: f.isDefault });

  return {
    async listFunds(): Promise<FundList> {
      const v = await visible();
      const order = [...v.funds].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
      return { items: order.map((f) => view(v.w, f)), scoped: v.scoped };
    },
    async getFund(id): Promise<FundDetail> {
      const v = await visible();
      const f = found(v.funds, id);
      return { ...view(v.w, f), advisors: v.d.advisors.filter((a) => a.fundId === f.id).map((a) => ({ userId: "", role: a.role, name: null, email: a.email })) };
    },
    async createFund(input) {
      const { w, d } = await admin();
      if (!input.name.trim()) throw ctx.fail(400, "The request body is not valid", [{ code: "invalid_field", field: "name", detail: "Give the fund a name" }]);
      const slug = input.slug ?? (slugify(input.name).slice(0, 64) || "fund");
      checkSlug(d, slug);
      const f: MockFund = { id: crypto.randomUUID(), name: input.name.trim(), slug, description: input.description?.trim() || null, brand: { color: input.brand?.color ?? null, logoUrl: input.brand?.logoUrl ?? null }, isDefault: false, budgets: [], createdAt: now(), updatedAt: now() };
      d.funds.push(f);
      return view(w, f);
    },
    async updateFund(id, patch) {
      const { w, d } = await admin();
      const f = found(d.funds, id);
      if (patch.slug !== undefined) checkSlug(d, patch.slug, f);
      if (patch.name !== undefined && !patch.name.trim()) throw ctx.fail(400, "The request body is not valid", [{ code: "invalid_field", field: "name", detail: "Give the fund a name" }]);
      Object.assign(f, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.brand !== undefined ? { brand: { ...f.brand, ...patch.brand } } : {}),
        updatedAt: now(),
      });
      return view(w, f);
    },
    async putFundBudgets(id, budgets: FundBudgetInput[]) {
      const { w, d } = await admin();
      const f = found(d.funds, id);
      if (new Set(budgets.map((b) => b.fiscalYear)).size !== budgets.length) throw ctx.fail(400, "The request body is not valid", [{ code: "invalid_field", field: "budgets", detail: "One budget per fiscal year" }]);
      f.budgets = [...budgets].sort((a, b) => a.fiscalYear - b.fiscalYear).map((b) => ({ fiscalYear: b.fiscalYear, amountMinor: b.amountMinor, currency: b.currency ?? "USD" }));
      f.updatedAt = now();
      return view(w, f);
    },
    async inviteAdvisor(id, input) {
      const { w, d } = await admin();
      const f = found(d.funds, id);
      const invitation = await base.createInvitation(w.record.id, { email: input.email, role: input.role });
      d.advisors.push({ email: input.email.trim().toLowerCase(), role: input.role, fundId: f.id });
      return { ...invitation, organization: null, token: "", emailed: false, acceptUrl: invitation.acceptUrl ?? "", fund: { id: f.id, name: f.name } } as Awaited<ReturnType<FundsApi["inviteAdvisor"]>>;
    },
    async publicFund(handle, slug) {
      const page = await base.publicFunder(handle);
      const w = ctx.store.workspaces.find((x) => x.record.handle === handle);
      const f = w ? fundsOf(w, now()).funds.find((x) => x.slug === slug) : undefined;
      if (!w || !f) throw ctx.fail(404, "Fund not found");
      const ids = new Set(fundSections(w).find((x) => x.slug === f.slug)?.opportunityIds ?? []);
      const cards = page.opportunities.filter((o) => ids.has(o.id));
      return { funder: page.funder, fund: publicView(f), opportunities: cards, open: cards.filter((o) => o.status === "open"), forecasted: cards.filter((o) => o.status === "forecasted") };
    },

    // The mock API's own reads, narrowed to a fund advisor's funds as the server narrows them.
    async listPrograms() {
      const { programIds } = await programsSeen();
      return (await base.listPrograms()).filter((p) => programIds.has(p.id));
    },
    async createProgram(input) {
      const v = await visible();
      const fundId = input.fundId ?? (v.scoped ? (v.funds.length === 1 ? v.funds[0]!.id : undefined) : v.d.funds.find((f) => f.isDefault)!.id);
      if (!fundId) throw ctx.fail(422, "Choose the fund this program belongs to", [{ path: "fundId", message: "Choose a fund" }]);
      found(v.funds, fundId);
      return base.createProgram({ ...input, fundId });
    },
    async updateProgram(id, patch) {
      const v = await programsSeen();
      if (!v.programIds.has(id)) throw ctx.fail(404, "Program not found");
      if (patch.fundId !== undefined) found(v.funds, patch.fundId);
      return base.updateProgram(id, patch);
    },
    async listOpportunities(...args: Parameters<GmsApi["listOpportunities"]>) {
      const { programIds, scoped } = await programsSeen();
      const all = await base.listOpportunities(...args);
      return scoped ? all.filter((o) => o.programId && programIds.has(o.programId)) : all;
    },
    async listCompetitions(...args: Parameters<GmsApi["listCompetitions"]>) {
      const v = await programsSeen();
      const all = await base.listCompetitions(...args);
      if (!v.scoped) return all;
      const opps = new Set(v.w.opportunities.filter((o) => o.programId && v.programIds.has(o.programId)).map((o) => o.id));
      return all.filter((c) => opps.has(c.opportunityId));
    },
    async listAwards(...args: Parameters<GmsApi["listAwards"]>) {
      const { programIds, scoped } = await programsSeen();
      const all = await base.listAwards(...args);
      return scoped ? all.filter((a) => a.programId && programIds.has(a.programId)) : all;
    },
    async publicFunder(handle) {
      const page = await base.publicFunder(handle);
      const w = ctx.store.workspaces.find((x) => x.record.handle === handle);
      return w ? { ...page, funds: fundSections(w) } : page;
    },
    async publicOpportunity(handle, slug) {
      const page = await base.publicOpportunity(handle, slug);
      const w = ctx.store.workspaces.find((x) => x.record.handle === handle);
      if (!w) return page;
      const d = fundsOf(w, now());
      const opp = w.opportunities.find((o) => o.slug === slug);
      const program = opp?.programId ? w.programs.find((p) => p.id === opp.programId) : undefined;
      const f = program ? d.funds.find((x) => x.id === fundOfProgram(d.funds, program)) : undefined;
      return { ...page, opportunity: { ...page.opportunity, fund: f ? { name: f.name, slug: f.slug, isDefault: f.isDefault } : null } };
    },
  };
}
