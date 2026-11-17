// SPDX-License-Identifier: AGPL-3.0-only
// The growth measures (F3, docs/measures.md): nine numbers for OpenGrants' operators, each over the
// last 30 days with its 90-day target from the growth plan, and Google Search Console's figures for
// the GMS's own public pages.
//
//   * Operators only: the people in the OPERATORS secret (user ids or email addresses), else
//     GALLERY_MODERATORS. A signed-in person only; agents and API clients never reach this, and no
//     MCP tool reads it. A funder or applicant admin who is not an operator is refused.
//   * Aggregate counts only. Every number comes from public.gms_operator_measures() (migration
//     0052), which returns counts and nothing else, or from Search Console's totals. No list of
//     people or organizations is ever returned: Search Console's pages are grouped by kind of page
//     (a funder's page, a call, an award), never by address, because an address names a funder.
//   * No third-party tracker. Organic visits come from Search Console through Composio, read only.
import { z } from "zod";
import type { SearchAnalyticsRow, SearchConsole, SearchConsoleSite } from "@gms/connectors";
import { ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, SourceReadError } from "@gms/connectors";
import { forbidden } from "../auth/verify.ts";
import { ApiError } from "../lib/errors.ts";
import { audit, type ServiceContext } from "./context.ts";
import { moderatorsOf } from "./gallery.ts";
import type { SupabaseRpcLike } from "./ports.ts";

// ------------------------------------------------------------------------------------ choices (one constant each)

/** Every measure is counted over this many days, ending now. */
export const MEASURE_WINDOW_DAYS = 30;
/** Measure 5: a call published within this many days after a history import counts as a switch that worked. */
export const SWITCH_CALL_WITHIN_DAYS = 14;
/** The 90-day targets of the growth plan (approved 15 November 2026, decision 8). */
export const MEASURE_TARGETS = {
  fundersWithOpenCall: 50,
  activeApplicantWorkspaces: 1000,
  newApplicantWorkspacesPerCall: 10,
  fundersJoinedFromApplicantLinks: 5,
  switchedFundersWithCall: 25,
  /** Share of awards with a share-kit post. */
  shareKitShare: 0.3,
  /** Organic visits a week, as a multiple of the first week's. */
  organicVisitsMultiple: 3,
  /** Share of invited teammates who joined. */
  invitedTeammatesShare: 0.4,
} as const;
/**
 * The stated reasons a deal was lost: the plan's parity gaps, then the common reasons. Kept equal to
 * the lost_deals.reason check of migration 0052 by a test. No free text, so a record never names
 * an organization or a person.
 */
export const LOST_DEAL_REASONS = ["forms", "reviews", "reporting", "payments", "procurement", "languages", "integrations", "data_migration", "support", "went_elsewhere", "timing", "no_decision", "other"] as const;
export type LostDealReason = (typeof LOST_DEAL_REASONS)[number];
/** A lost deal is recorded for a day at most this long ago (and never in the future). */
export const LOST_DEAL_MAX_AGE_DAYS = 365;
/** The first week of the plan (Monday after its approval): the baseline organic visits are measured against. */
export const ORGANIC_BASELINE_WEEK_START = "2026-11-16";
/** Search Console's final figures run this many days behind. */
export const SEARCH_CONSOLE_LAG_DAYS = 3;
/** Search Console figures are read again after this long (per isolate). */
export const SEARCH_CONSOLE_CACHE_MS = 15 * 60 * 1000;
/**
 * An email address in OPERATORS matches only a session that did not come through single sign-on: a
 * workspace's identity provider can assert any address (docs/sso.md), so its word never makes an
 * operator. A user id always matches. Set true to let SSO sessions match by email too.
 */
export const OPERATOR_EMAIL_MATCHES_SSO_SESSIONS = false;
/** Where Composio sends the browser back after the Google sign-in. Fixed: never taken from the request. */
export const MEASURES_PAGE = "/operator/measures";

// ------------------------------------------------------------------------------------ operators

export interface Operator {
  userId: string;
  email: string | null;
  /** Whether the session came through single sign-on (any `sso/saml` entry). */
  viaSso: boolean;
}

/** OPERATORS, else GALLERY_MODERATORS while it is unset or blank: comma-separated user ids or email addresses. */
export const operatorsOf = (env: { OPERATORS?: string; GALLERY_MODERATORS?: string }): string | null => (env.OPERATORS?.trim() ? env.OPERATORS : (env.GALLERY_MODERATORS ?? null));

export function isOperator(raw: string | null | undefined, who: Operator): boolean {
  const m = moderatorsOf(raw);
  if (m.ids.has(who.userId.toLowerCase())) return true;
  if (who.viaSso && !OPERATOR_EMAIL_MATCHES_SSO_SESSIONS) return false;
  return !!who.email && m.emails.has(who.email.trim().toLowerCase());
}

/** A signed-in person on the operators' list, or 403. Checked before any body is read. */
export function assertOperator(ctx: ServiceContext, raw: string | null | undefined, who: Operator): void {
  if (ctx.actor.kind !== "user" || ctx.actor.userId !== who.userId) throw forbidden("human_only", "The measures are for OpenGrants' operators, signed in, never an agent or API client");
  if (!isOperator(raw, who)) throw new ApiError(403, "not_an_operator", "Only OpenGrants' operators can see the measures");
}

// ------------------------------------------------------------------------------------ the counts (migration 0052)

/** What public.gms_operator_measures() returns: counts and the window, nothing else. */
export interface MeasureCounts {
  from: string;
  to: string;
  fundersWithOpenCall: number;
  activeApplicantWorkspaces: number;
  newApplicantWorkspaces: number;
  callsPublished: number;
  fundersJoinedFromApplicantLinks: number;
  switchedFundersWithCall: number;
  awardsEligibleForKit: number;
  awardsShared: number;
  awardPosts: number;
  awardPostClicks: number;
  awardPostsWithClicks: number;
  invitationsSent: number;
  invitationsAccepted: number;
  lostDeals: Partial<Record<string, number>>;
}

export interface MeasuresStore {
  counts(now: Date, windowDays: number, switchDays: number): Promise<MeasureCounts>;
}

const COUNT_KEYS = ["fundersWithOpenCall", "activeApplicantWorkspaces", "newApplicantWorkspaces", "callsPublished", "fundersJoinedFromApplicantLinks", "switchedFundersWithCall", "awardsEligibleForKit", "awardsShared", "awardPosts", "awardPostClicks", "awardPostsWithClicks", "invitationsSent", "invitationsAccepted"] as const;

/** Reads the function's answer strictly: every count a whole number, lost deals by known reason only. */
export function parseCounts(raw: unknown): MeasureCounts {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(x) || x < 0) throw new Error("The measures came back in an unexpected shape");
    return x;
  };
  const lost: Partial<Record<string, number>> = {};
  const rawLost = r.lostDeals && typeof r.lostDeals === "object" ? (r.lostDeals as Record<string, unknown>) : {};
  for (const reason of LOST_DEAL_REASONS) if (rawLost[reason] !== undefined) lost[reason] = n(rawLost[reason]);
  const out = { from: String(r.from ?? ""), to: String(r.to ?? ""), lostDeals: lost } as MeasureCounts;
  for (const k of COUNT_KEYS) out[k] = n(r[k]);
  return out;
}

/** The counts through `public.gms_operator_measures` (service role). */
export class SupabaseMeasuresStore implements MeasuresStore {
  constructor(private readonly client: SupabaseRpcLike) {}
  async counts(now: Date, windowDays: number, switchDays: number): Promise<MeasureCounts> {
    const { data, error } = await this.client.rpc("gms_operator_measures", { p_now: now.toISOString(), p_window_days: windowDays, p_switch_days: switchDays });
    if (error) throw new Error(`Reading the measures failed: ${error.message}`);
    return parseCounts(data);
  }
}

// ------------------------------------------------------------------------------------ Search Console

/** The GMS's own host, from WEB_BASE_URL. */
export function gmsHost(webBaseUrl: string): string {
  return new URL(webBaseUrl).hostname.toLowerCase();
}

/** Whether a Search Console property covers the GMS's host: its domain or a parent domain, or a URL-prefix property at its root. */
export function siteCoversHost(siteUrl: string, host: string): boolean {
  if (siteUrl.startsWith("sc-domain:")) {
    const d = siteUrl.slice("sc-domain:".length).toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  }
  return siteUrl === `https://${host}/`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Every Search Console query is held to these pages: the GMS's host over HTTPS. */
export const hostPagesRegex = (host: string) => `^https://${escapeRegex(host)}/`;
/** Measure 7 counts the funder pages and what hangs off them (calls, funds, awards): `/f/…`. */
export const organicPagesRegex = (host: string) => `^https://${escapeRegex(host)}/f/`;

/** Kinds of public page. A page's address is never returned: it would name the funder. */
export const PAGE_KINDS = ["home", "funder", "opportunity", "fund", "awards", "award", "switch", "templates", "for_funders", "partners", "other"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
const ORGANIC_KINDS: ReadonlySet<PageKind> = new Set(["funder", "opportunity", "fund", "awards", "award"]);

export function pageKindOf(pageUrl: string): PageKind {
  let path: string;
  try {
    path = new URL(pageUrl).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "other";
  }
  const p = path.split("/").filter(Boolean);
  if (p.length === 0) return "home";
  if (p[0] === "f") {
    if (p.length === 2) return "funder";
    if (p.length === 4 && p[2] === "o") return "opportunity";
    if (p.length === 3 && p[2] === "awards") return "awards";
    if (p.length === 4 && p[2] === "awards") return "award";
    if (p.length === 3) return "fund";
    return "other";
  }
  if (p[0] === "switch") return "switch";
  if (p[0] === "templates") return "templates";
  if (p[0] === "for-funders" && p.length === 1) return "for_funders";
  if (p[0] === "partners" && p.length === 1) return "partners";
  return "other";
}

export interface PageKindTotal {
  kind: PageKind;
  clicks: number;
  impressions: number;
}

/** Search Console's page rows, added up by kind of page, most clicked first. */
export function byPageKind(rows: readonly SearchAnalyticsRow[]): PageKindTotal[] {
  const sums = new Map<PageKind, PageKindTotal>();
  for (const r of rows) {
    const kind = pageKindOf(r.keys[0] ?? "");
    const t = sums.get(kind) ?? { kind, clicks: 0, impressions: 0 };
    t.clicks += r.clicks;
    t.impressions += r.impressions;
    sums.set(kind, t);
  }
  return [...sums.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || PAGE_KINDS.indexOf(a.kind) - PAGE_KINDS.indexOf(b.kind));
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));

/** The 30 days Search Console has final figures for, ending SEARCH_CONSOLE_LAG_DAYS ago. */
export function searchConsoleRange(now: Date): { start: string; end: string } {
  const end = addDays(day(now), -SEARCH_CONSOLE_LAG_DAYS);
  return { start: addDays(end, -(MEASURE_WINDOW_DAYS - 1)), end };
}

export interface SearchConsoleReport {
  site: string;
  range: { start: string; end: string };
  totals: { clicks: number; impressions: number };
  /** By kind of page, never by address. */
  pages: PageKindTotal[];
  /** Measure 7: clicks from Google Search to funder pages, their calls, funds and awards. */
  organic: { clicks: number; impressions: number };
  baselineWeek: { start: string; end: string; clicks: number | null };
}

const reportCache = new WeakMap<SearchConsole, Map<string, { at: number; report: SearchConsoleReport }>>();

/** Search Console's figures for the GMS's public pages: two read-only queries, cached a while per isolate. */
export async function searchConsoleReport(ctx: ServiceContext, port: SearchConsole, site: string): Promise<SearchConsoleReport> {
  const host = gmsHost(ctx.config.webBaseUrl);
  const now = ctx.now();
  const range = searchConsoleRange(now);
  const baseline = { start: ORGANIC_BASELINE_WEEK_START, end: addDays(ORGANIC_BASELINE_WEEK_START, 6) };
  const key = `${site}|${range.end}`;
  let cache = reportCache.get(port);
  if (!cache) reportCache.set(port, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < SEARCH_CONSOLE_CACHE_MS) return hit.report;

  const rows = await port.query({ siteUrl: site, startDate: range.start, endDate: range.end, dimensions: ["page"], pageRegex: hostPagesRegex(host), rowLimit: 5000 });
  const pages = byPageKind(rows);
  const sum = (xs: readonly PageKindTotal[]) => ({ clicks: xs.reduce((a, x) => a + x.clicks, 0), impressions: xs.reduce((a, x) => a + x.impressions, 0) });
  // The baseline week is read once its figures are final; before then it is not known yet.
  let baselineClicks: number | null = null;
  if (baseline.end <= range.end) {
    const b = await port.query({ siteUrl: site, startDate: baseline.start, endDate: baseline.end, dimensions: [], pageRegex: organicPagesRegex(host), rowLimit: 1 });
    baselineClicks = b.reduce((a, r) => a + r.clicks, 0);
  }
  const report: SearchConsoleReport = { site, range, totals: sum(pages), pages, organic: sum(pages.filter((p) => ORGANIC_KINDS.has(p.kind))), baselineWeek: { ...baseline, clicks: baselineClicks } };
  cache.set(key, { at: now.getTime(), report });
  return report;
}

async function settings(ctx: ServiceContext) {
  return ctx.repos.table("operator_settings").one({ id: true });
}

/** A connection problem as one plain word for the screen, never Composio's or Google's own text. */
function searchConsoleProblem(e: unknown): "reconnect" | "too_broad" | "unreachable" | null {
  if (e instanceof ConnectorScopeError) return "too_broad";
  if (e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorAuthError) return "reconnect";
  if (e instanceof ConnectorUnavailableError || e instanceof SourceReadError) return "unreachable";
  return null;
}

const notConfigured = () => new ApiError(404, "search_console_unavailable", "Search Console is not set up on this server");

/** Whether Search Console is set up, connected, and which property it reads; the properties that cover the GMS's host. */
export async function searchConsoleState(ctx: ServiceContext) {
  const port = ctx.ports.searchConsole;
  const site = (await settings(ctx))?.search_console_site ?? null;
  if (!port) return { available: false, connected: false, problem: null, site: null, sites: [] as SearchConsoleSite[] };
  try {
    const { connected } = await port.status();
    if (!connected) return { available: true, connected: false, problem: null, site, sites: [] };
    const host = gmsHost(ctx.config.webBaseUrl);
    // Only the properties for the GMS's own host are shown, never the account's other sites.
    const sites = (await port.listSites()).filter((s) => s.permissionLevel !== "siteUnverifiedUser" && siteCoversHost(s.siteUrl, host));
    return { available: true, connected: true, problem: null, site, sites };
  } catch (e) {
    const problem = searchConsoleProblem(e);
    if (!problem) throw e;
    return { available: true, connected: false, problem, site, sites: [] };
  }
}

/** Start connecting: a Composio-hosted Google sign-in that returns to the measures page, until connected. */
export async function connectSearchConsole(ctx: ServiceContext) {
  const port = ctx.ports.searchConsole;
  if (!port) throw notConfigured();
  const r = await port.status({ link: true, returnTo: MEASURES_PAGE });
  if (!r.connected) await audit(ctx, "operator.search_console_connect_started", "operator", ctx.actor.userId!, {});
  return r;
}

/** Remove the connection at Composio and forget the property. */
export async function disconnectSearchConsole(ctx: ServiceContext) {
  const port = ctx.ports.searchConsole;
  if (!port) throw notConfigured();
  await port.disconnect();
  if (await settings(ctx)) await ctx.repos.table("operator_settings").update({ id: true }, { search_console_site: null, updated_by: ctx.actor.userId });
  await audit(ctx, "operator.search_console_disconnected", "operator", ctx.actor.userId!, {});
  return { connected: false, site: null };
}

export const siteInput = z.object({ siteUrl: z.string().min(1).max(300) }).strict();

/** Choose the property: one the connected account can read that covers the GMS's own host. */
export async function chooseSearchConsoleSite(ctx: ServiceContext, input: z.output<typeof siteInput>) {
  const port = ctx.ports.searchConsole;
  if (!port) throw notConfigured();
  const host = gmsHost(ctx.config.webBaseUrl);
  if (!siteCoversHost(input.siteUrl, host)) throw new ApiError(422, "site_not_gms", `Choose the property for ${host}`, [{ code: "invalid", field: "siteUrl", detail: `Choose the property for ${host}` }]);
  const sites = await port.listSites();
  if (!sites.some((s) => s.siteUrl === input.siteUrl && s.permissionLevel !== "siteUnverifiedUser")) throw new ApiError(422, "site_not_found", "The connected Google account cannot read that property", [{ code: "invalid", field: "siteUrl" }]);
  const existing = await settings(ctx);
  if (existing) await ctx.repos.table("operator_settings").update({ id: true }, { search_console_site: input.siteUrl, updated_by: ctx.actor.userId });
  else await ctx.repos.table("operator_settings").insert({ id: true, search_console_site: input.siteUrl, updated_by: ctx.actor.userId });
  await audit(ctx, "operator.search_console_site_chosen", "operator", ctx.actor.userId!, { siteUrl: input.siteUrl });
  return { site: input.siteUrl };
}

/** Search Console's figures for the chosen property, grouped by kind of page. */
export async function getSearchConsoleReport(ctx: ServiceContext) {
  const port = ctx.ports.searchConsole;
  if (!port) throw notConfigured();
  const site = (await settings(ctx))?.search_console_site ?? null;
  if (!site) throw new ApiError(409, "search_console_site_required", "Choose the GMS's property in Search Console first");
  try {
    return await searchConsoleReport(ctx, port, site);
  } catch (e) {
    const problem = searchConsoleProblem(e);
    if (problem === "unreachable") throw new ApiError(503, "search_console_unreachable", "Search Console did not answer. Try again in a few minutes");
    if (problem) throw new ApiError(409, "search_console_reconnect", "Connect Search Console again");
    throw e;
  }
}

// ------------------------------------------------------------------------------------ the measures

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
const count = (value: number, target: number) => ({ value, target, met: value >= target });

type OrganicSource = "search_console" | "not_configured" | "not_connected" | "no_site" | "unavailable";

/** Measure 7 from Search Console when it is connected and a property is chosen; otherwise says why it is missing. */
async function organicVisits(ctx: ServiceContext) {
  const port = ctx.ports.searchConsole;
  const empty = (source: OrganicSource) => ({ source, value: null, impressions: null, weeklyAverage: null, range: null, baselineWeek: null, target: { multiple: MEASURE_TARGETS.organicVisitsMultiple, value: null }, met: null });
  if (!port) return empty("not_configured");
  const site = (await settings(ctx))?.search_console_site ?? null;
  try {
    if (!(await port.status()).connected) return empty("not_connected");
    if (!site) return empty("no_site");
    const r = await searchConsoleReport(ctx, port, site);
    const weekly = Math.round((r.organic.clicks / MEASURE_WINDOW_DAYS) * 7 * 10) / 10;
    const target = r.baselineWeek.clicks === null ? null : r.baselineWeek.clicks * MEASURE_TARGETS.organicVisitsMultiple;
    return { source: "search_console" as const, value: r.organic.clicks, impressions: r.organic.impressions, weeklyAverage: weekly, range: r.range, baselineWeek: r.baselineWeek, target: { multiple: MEASURE_TARGETS.organicVisitsMultiple, value: target }, met: target === null ? null : target > 0 && weekly >= target };
  } catch (e) {
    if (!searchConsoleProblem(e)) throw e;
    return empty("unavailable");
  }
}

/** The nine measures over the last 30 days, each with its 90-day target. Counts only. */
export async function getMeasures(ctx: ServiceContext) {
  const store = ctx.ports.measures;
  if (!store) throw new ApiError(503, "measures_unavailable", "The measures are not available on this server");
  const c = await store.counts(ctx.now(), MEASURE_WINDOW_DAYS, SWITCH_CALL_WITHIN_DAYS);
  const perCall = ratio(c.newApplicantWorkspaces, c.callsPublished);
  const kitShare = ratio(c.awardsShared, c.awardsEligibleForKit);
  const joinShare = ratio(c.invitationsAccepted, c.invitationsSent);
  const lost = LOST_DEAL_REASONS.map((reason) => ({ reason, count: c.lostDeals[reason] ?? 0 }));
  return {
    window: { from: c.from, to: c.to, days: MEASURE_WINDOW_DAYS },
    fundersWithOpenCall: count(c.fundersWithOpenCall, MEASURE_TARGETS.fundersWithOpenCall),
    activeApplicantWorkspaces: count(c.activeApplicantWorkspaces, MEASURE_TARGETS.activeApplicantWorkspaces),
    newApplicantWorkspacesPerCall: { value: perCall, target: MEASURE_TARGETS.newApplicantWorkspacesPerCall, met: perCall !== null && perCall >= MEASURE_TARGETS.newApplicantWorkspacesPerCall, newApplicantWorkspaces: c.newApplicantWorkspaces, callsPublished: c.callsPublished },
    fundersJoinedFromApplicantLinks: count(c.fundersJoinedFromApplicantLinks, MEASURE_TARGETS.fundersJoinedFromApplicantLinks),
    switchedFundersWithCall: { ...count(c.switchedFundersWithCall, MEASURE_TARGETS.switchedFundersWithCall), withinDays: SWITCH_CALL_WITHIN_DAYS },
    shareKit: { value: kitShare, target: MEASURE_TARGETS.shareKitShare, met: kitShare !== null && kitShare >= MEASURE_TARGETS.shareKitShare, awardsShared: c.awardsShared, awardsEligible: c.awardsEligibleForKit, posts: c.awardPosts, clicks: c.awardPostClicks, postsWithClicks: c.awardPostsWithClicks, clicksPerPost: ratio(c.awardPostClicks, c.awardPostsWithClicks) },
    organicVisits: await organicVisits(ctx),
    invitedTeammatesJoined: { value: joinShare, target: MEASURE_TARGETS.invitedTeammatesShare, met: joinShare !== null && joinShare >= MEASURE_TARGETS.invitedTeammatesShare, sent: c.invitationsSent, accepted: c.invitationsAccepted },
    dealsLost: { total: lost.reduce((a, x) => a + x.count, 0), byReason: lost },
  };
}

// ------------------------------------------------------------------------------------ deals lost

export const lostDealInput = z
  .object({
    reason: z.enum(LOST_DEAL_REASONS),
    lostOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/** Record one lost deal by its stated reason. Nothing else is kept: no name, no note. */
export async function recordLostDeal(ctx: ServiceContext, input: z.output<typeof lostDealInput>) {
  const today = day(ctx.now());
  const lostOn = input.lostOn ?? today;
  if (Number.isNaN(Date.parse(`${lostOn}T00:00:00Z`)) || day(new Date(`${lostOn}T00:00:00Z`)) !== lostOn) throw new ApiError(422, "invalid_date", "Enter a real date", [{ code: "invalid", field: "lostOn" }]);
  if (lostOn > today) throw new ApiError(422, "invalid_date", "A deal is recorded once it is lost, not before", [{ code: "invalid", field: "lostOn" }]);
  if (lostOn < addDays(today, -LOST_DEAL_MAX_AGE_DAYS)) throw new ApiError(422, "invalid_date", "Record deals lost in the last year", [{ code: "invalid", field: "lostOn" }]);
  const row = await ctx.repos.table("lost_deals").insert({ reason: input.reason, lost_on: lostOn, recorded_by: ctx.actor.userId! });
  await audit(ctx, "operator.lost_deal_recorded", "lost_deal", row.id, { reason: input.reason, lostOn });
  return { recorded: true, reason: input.reason, lostOn };
}
