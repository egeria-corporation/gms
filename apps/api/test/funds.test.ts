// SPDX-License-Identifier: AGPL-3.0-only
// Funds: the default fund, creating and editing funds, a fund's budget per fiscal year beside its
// programs' budgets, programs in a fund, the "Advisor for {fund}" invitation, and the public page
// of one fund.
import { beforeEach, describe, expect, it } from "vitest";
import { budgetTotals } from "../src/services/funds.ts";
import { USER_ADMIN, USER_OFFICER, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

let h: Harness;
let admin: Record<string, string>;
let officer: Record<string, string>;
const headers = async (user: string, ws = WS_FUNDER) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
async function call<T = unknown>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data: T } & Record<string, unknown> };
}
interface FundOut {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  programCount: number;
  totals: { fiscalYear: number; budgetMinor: number | null; programsMinor: number; availableMinor: number | null; over: boolean }[];
}

beforeEach(async () => {
  h = await harness();
  admin = await headers(USER_ADMIN);
  officer = await headers(USER_OFFICER);
});

describe("funds", () => {
  it("every funder workspace has a default fund, and a program that names no fund goes into it", async () => {
    const list = await call<{ items: FundOut[]; scoped: boolean }>(officer, "GET", "/gms/funds");
    expect(list.status).toBe(200);
    expect(list.body.data.scoped).toBe(false);
    expect(list.body.data.items).toMatchObject([{ name: "Default fund", slug: "default", isDefault: true }]);
    const p = await call<{ id: string; fundId: string }>(officer, "POST", "/gms/programs", { name: "Community Health" });
    expect(p.status).toBe(201);
    expect(p.body.data.fundId).toBe(list.body.data.items[0]!.id);
    // Asking again does not make a second default.
    expect((await call<{ items: FundOut[] }>(officer, "GET", "/gms/funds")).body.data.items.filter((f) => f.isDefault)).toHaveLength(1);
  });

  it("an admin creates and edits a fund; a program officer cannot", async () => {
    expect((await call(officer, "POST", "/gms/funds", { name: "Riverside Arts Fund" })).status).toBe(403);
    const made = await call<FundOut>(admin, "POST", "/gms/funds", { name: "Riverside Arts Fund", description: "Murals and music in the river towns.", brand: { color: "teal" } });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ name: "Riverside Arts Fund", slug: "riverside-arts-fund", isDefault: false, brand: { color: "teal", logoUrl: null } });
    // The address is unique in the workspace, and words the funder's pages use are refused.
    expect((await call(admin, "POST", "/gms/funds", { name: "Again", slug: "riverside-arts-fund" })).status).toBe(409);
    expect((await call(admin, "POST", "/gms/funds", { name: "Awards", slug: "awards" })).status).toBe(400);
    // Colours come from the theme palette only.
    expect((await call(admin, "POST", "/gms/funds", { name: "Hex", brand: { color: "#ff0000" } })).status).toBe(400);
    const edited = await call<FundOut>(admin, "PATCH", `/gms/funds/${made.body.data.id}`, { name: "River Arts Fund", slug: "river-arts" });
    expect(edited.body.data).toMatchObject({ name: "River Arts Fund", slug: "river-arts" });
    const events = await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "fund", subjectId: made.body.data.id });
    expect(events.map((e) => e.eventType)).toEqual(["fund.created", "fund.updated"]);
    expect(events[1]!.data).toMatchObject({ slugFrom: "riverside-arts-fund", slugTo: "river-arts" });
  });

  it("a program belongs to the fund it names, which must be this workspace's", async () => {
    const fund = (await call<FundOut>(admin, "POST", "/gms/funds", { name: "Elder Care Fund" })).body.data;
    const p = await call<{ id: string; fundId: string }>(officer, "POST", "/gms/programs", { name: "Home visits", fundId: fund.id });
    expect(p.body.data.fundId).toBe(fund.id);
    const elsewhere = await h.repos.table("funds").insert({ workspace_id: WS_OTHER, name: "Not yours", slug: "not-yours" });
    expect((await call(officer, "POST", "/gms/programs", { name: "Sneaky", fundId: elsewhere.id })).status).toBe(404);
    expect((await call(officer, "PATCH", `/gms/programs/${p.body.data.id}`, { fundId: elsewhere.id })).status).toBe(404);
    // Moving a program between funds is on the ledger with both funds.
    const def = (await call<{ items: FundOut[] }>(officer, "GET", "/gms/funds")).body.data.items.find((f) => f.isDefault)!;
    expect((await call<{ fundId: string }>(officer, "PATCH", `/gms/programs/${p.body.data.id}`, { fundId: def.id })).body.data.fundId).toBe(def.id);
    const moved = (await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "program", subjectId: p.body.data.id })).at(-1)!;
    expect(moved.data).toMatchObject({ fundFrom: fund.id, fundTo: def.id });
  });

  it("a fund's budget per fiscal year sits beside its programs' budgets", async () => {
    const fund = (await call<FundOut>(admin, "POST", "/gms/funds", { name: "Elder Care Fund" })).body.data;
    await call(officer, "POST", "/gms/programs", { name: "Home visits", fundId: fund.id, fiscalYear: 2027, budgetAmountMinor: 30_000_000 });
    await call(officer, "POST", "/gms/programs", { name: "Respite", fundId: fund.id, fiscalYear: 2027, budgetAmountMinor: 25_000_000 });
    await call(officer, "POST", "/gms/programs", { name: "Next year", fundId: fund.id, fiscalYear: 2028, budgetAmountMinor: 10_000_000 });
    // A program of another fund does not count.
    await call(officer, "POST", "/gms/programs", { name: "Default program", fiscalYear: 2027, budgetAmountMinor: 99_000_000 });
    expect((await call(officer, "PUT", `/gms/funds/${fund.id}/budgets`, { budgets: [{ fiscalYear: 2027, amountMinor: 50_000_000 }] })).status).toBe(403);
    expect((await call(admin, "PUT", `/gms/funds/${fund.id}/budgets`, { budgets: [{ fiscalYear: 2027, amountMinor: 1 }, { fiscalYear: 2027, amountMinor: 2 }] })).status).toBe(400);
    const set = await call<FundOut>(admin, "PUT", `/gms/funds/${fund.id}/budgets`, { budgets: [{ fiscalYear: 2027, amountMinor: 50_000_000 }, { fiscalYear: 2029, amountMinor: 70_000_000 }] });
    expect(set.status).toBe(200);
    expect(set.body.data.totals).toEqual([
      { fiscalYear: 2027, currency: "USD", budgetMinor: 50_000_000, programsMinor: 55_000_000, programCount: 2, availableMinor: -5_000_000, over: true },
      { fiscalYear: 2028, currency: "USD", budgetMinor: null, programsMinor: 10_000_000, programCount: 1, availableMinor: null, over: false },
      { fiscalYear: 2029, currency: "USD", budgetMinor: 70_000_000, programsMinor: 0, programCount: 0, availableMinor: 70_000_000, over: false },
    ]);
    const listed = (await call<{ items: FundOut[] }>(officer, "GET", "/gms/funds")).body.data.items.find((f) => f.id === fund.id)!;
    expect(listed.totals[0]).toMatchObject({ fiscalYear: 2027, programsMinor: 55_000_000, over: true });
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "fund.budgets_set" }))[0]!.data).toMatchObject({ from: [], to: [{ fiscalYear: 2027, amountMinor: 50_000_000, currency: "USD" }, { fiscalYear: 2029, amountMinor: 70_000_000, currency: "USD" }] });
  });

  it("budget totals count a program only in its own year and currency", () => {
    const totals = budgetTotals({ budgets: [{ fiscalYear: 2027, amountMinor: 100, currency: "USD" }] }, [
      { fiscal_year: 2027, budget_amount_minor: 40, currency: "USD" },
      { fiscal_year: 2027, budget_amount_minor: 1000, currency: "CAD" },
      { fiscal_year: null, budget_amount_minor: 5, currency: "USD" },
      { fiscal_year: 2027, budget_amount_minor: null, currency: "USD" },
    ]);
    expect(totals).toEqual([{ fiscalYear: 2027, currency: "USD", budgetMinor: 100, programsMinor: 40, programCount: 1, availableMinor: 60, over: false }]);
  });

  it("an admin invites an advisor for one fund with an existing role and a fund scope", async () => {
    const fund = (await call<FundOut>(admin, "POST", "/gms/funds", { name: "Elder Care Fund" })).body.data;
    expect((await call(officer, "POST", `/gms/funds/${fund.id}/advisors`, { email: "leo@advisors.example", role: "program_officer" })).status).toBe(403);
    expect((await call(admin, "POST", `/gms/funds/${fund.id}/advisors`, { email: "leo@advisors.example", role: "admin" })).status).toBe(400);
    const inv = await call<{ role: string; fund: { name: string }; acceptUrl: string }>(admin, "POST", `/gms/funds/${fund.id}/advisors`, { email: "leo@advisors.example", role: "program_officer" });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ role: "program_officer", fund: { name: "Elder Care Fund" } });
    const row = (await h.repos.table("invitations").find({ workspace_id: WS_FUNDER })).find((i) => i.email === "leo@advisors.example")!;
    expect(row.scope).toEqual({ fundIds: [fund.id] });
  });

  it("the public page of a fund lists that fund's published opportunities only", async () => {
    const fund = (await call<FundOut>(admin, "POST", "/gms/funds", { name: "Elder Care Fund", slug: "elder-care", description: "Care at home for older neighbours." })).body.data;
    const inFund = (await call<{ id: string }>(officer, "POST", "/gms/programs", { name: "Home visits", fundId: fund.id })).body.data;
    const other = (await call<{ id: string }>(officer, "POST", "/gms/programs", { name: "Elsewhere" })).body.data;
    const opp = async (title: string, programId: string) => {
      const o = (await call<{ id: string }>(officer, "POST", "/gms/opportunities", { title, programId, description: `${title} description.` })).body.data;
      expect((await call(officer, "POST", `/gms/opportunities/${o.id}/publish`, {})).status).toBe(200);
    };
    await opp("Home visit grants", inFund.id);
    await opp("Other grants", other.id);
    await call(officer, "POST", "/gms/opportunities", { title: "Unpublished in fund", programId: inFund.id });
    const res = await h.request("/gms/public/funders/riverbend/funds/elder-care");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { fund: Record<string, unknown>; opportunities: { title: string }[]; open: unknown[] } };
    expect(body.data.fund).toEqual({ name: "Elder Care Fund", slug: "elder-care", description: "Care at home for older neighbours.", brand: { color: null, logoUrl: null } });
    expect(body.data.opportunities.map((o) => o.title)).toEqual(["Home visit grants"]);
    // Nothing internal: no budgets, no advisors.
    expect(JSON.stringify(body)).not.toMatch(/budget|advisor|programIds/i);
    expect((await h.request("/gms/public/funders/riverbend/funds/nope")).status).toBe(404);
  });
});
