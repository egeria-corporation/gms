// SPDX-License-Identifier: AGPL-3.0-only
// Funds (v1.8.0): one funder workspace, many funds. A fund has a name, a public address, a short
// description, a colour from the theme palette and its own budget per fiscal year. Programs belong
// to one fund; everything under a program belongs to its fund. A fund advisor (a member invited as
// "Advisor for {fund}") sees only their funds; the API decides that, and `scoped` says so.
//
// `createHttpFundsApi` calls the GMS Worker (api/funds.tsp); `createMockFundsApi` (mocks/funds.ts)
// implements the same interface in the browser.
import type { FunderHttpIo } from "./funder.ts";
import type { components } from "./schema.d.ts";
import type { PublicFunder, PublicOpportunityCard } from "./types.ts";

type S = components["schemas"];
export type FundColor = S["Models.FundColor"];
export type FundBrand = S["Models.FundBrand"];
export type FundYearTotal = S["Models.FundYearTotal"];
export type Fund = S["Models.Fund"];
export type FundDetail = S["Models.FundDetail"];
export type FundList = S["Models.FundList"];
export type FundInput = S["Models.FundInput"];
export type FundPatch = S["Models.FundPatch"];
export type FundBudgetInput = S["Models.FundBudgetInput"];
export type FundAdvisorInput = S["Models.FundAdvisorInput"];
export type FundAdvisorInvitation = S["Models.FundAdvisorInvitation"];
export type PublicFund = S["Models.PublicFund"];
/** A fund on the funder page, with its published opportunities (sent once the public data carries funds). */
export type PublicFundSection = S["Models.PublicFundSection"];
export interface FundPageData {
  funder: PublicFunder;
  fund: PublicFund;
  opportunities: PublicOpportunityCard[];
  open: PublicOpportunityCard[];
  forecasted: PublicOpportunityCard[];
}

/** The theme palette, in the order the picker offers it, with the words a person reads. */
export const FUND_COLORS: { value: FundColor; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "blue", label: "Blue" },
  { value: "mint", label: "Mint" },
  { value: "navy", label: "Navy" },
  { value: "gray", label: "Gray" },
];
/** The theme token behind each palette name (tokens.css). */
export const FUND_COLOR_TOKEN: Record<FundColor, string> = { teal: "var(--og-teal)", blue: "var(--og-blue)", mint: "var(--og-mint)", navy: "var(--og-navy)", gray: "var(--og-gray-600)" };
/** Addresses the funder's own pages use: a fund cannot take them (as on the server). */
export const RESERVED_FUND_SLUGS = ["o", "awards", "embed", "apply", "funds", "fund", "badge", "programs", "opportunities", "new", "settings", "about", "join"];
/** The roles "Advisor for {fund}" is offered with: an existing role plus a fund scope. */
export const ADVISOR_ROLES = [
  { value: "program_officer", label: "Program officer" },
  { value: "reviewer", label: "Reviewer" },
] as const;

export interface FundsApi {
  listFunds(): Promise<FundList>;
  getFund(id: string): Promise<FundDetail>;
  createFund(input: FundInput): Promise<Fund>;
  updateFund(id: string, patch: FundPatch): Promise<Fund>;
  putFundBudgets(id: string, budgets: FundBudgetInput[]): Promise<Fund>;
  inviteAdvisor(id: string, input: FundAdvisorInput): Promise<FundAdvisorInvitation>;
  /** `/f/{handle}/{fundSlug}`: no token. */
  publicFund(handle: string, slug: string): Promise<FundPageData>;
}

export function createHttpFundsApi(io: FunderHttpIo): FundsApi {
  const e = encodeURIComponent;
  async function call<T>(method: string, path: string, body?: unknown, funder = true): Promise<T> {
    const token = funder ? await io.token() : null;
    const ws = io.workspaceId();
    const res = await (io.fetch ?? fetch)(`${io.baseUrl}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ws && funder ? { "X-GMS-Workspace": ws } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string; errors?: unknown[] };
    if (!res.ok) throw io.fail(res.status, j.message ?? `Request failed (${res.status})`, j.errors ?? []);
    return j.data as T;
  }
  return {
    listFunds: () => call("GET", "/gms/funds"),
    getFund: (id) => call("GET", `/gms/funds/${e(id)}`),
    createFund: (input) => call("POST", "/gms/funds", input),
    updateFund: (id, patch) => call("PATCH", `/gms/funds/${e(id)}`, patch),
    putFundBudgets: (id, budgets) => call("PUT", `/gms/funds/${e(id)}/budgets`, { budgets }),
    inviteAdvisor: (id, input) => call("POST", `/gms/funds/${e(id)}/advisors`, input),
    publicFund: (handle, slug) => call("GET", `/gms/public/funders/${e(handle)}/funds/${e(slug)}`, undefined, false),
  };
}

/** The fund a program belongs to; a program from before funds (no fund) is the default fund's. */
export function fundOfProgram(funds: Pick<Fund, "id" | "isDefault">[], program: { fundId?: string | null }): string | null {
  return program.fundId ?? funds.find((f) => f.isDefault)?.id ?? null;
}

/** Up to two letters of the fund's name, for its badge. */
export const fundInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "F";
