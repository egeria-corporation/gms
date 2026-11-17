// SPDX-License-Identifier: AGPL-3.0-only
// The operators' measures in mock mode (VITE_USE_MOCKS=true and tests): the demo person is an
// operator unless a test says otherwise; anyone else is refused as the server refuses them.
// Counts only, as on the server. Mock mode has no Google sign-in: connecting Search Console is
// made at once, and its figures are fixed.
import { ApiError } from "../api/client.ts";
import { LOST_DEAL_REASONS, type LostDealInput, type LostDealRecorded, type MeasuresApi, type OperatorMeasures, type SearchConsoleReport, type SearchConsoleState } from "../api/measures.ts";
import { MOCK_USER } from "./fixtures.ts";

export interface MockCounts {
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
}

export interface MeasuresStore {
  /** Operators by address. The demo person by default. */
  operatorEmails: string[];
  counts: MockCounts;
  /** Lost deals recorded, by day lost. */
  lostDeals: { reason: LostDealInput["reason"]; lostOn: string }[];
  searchConsole: { available: boolean; connected: boolean; site: string | null };
}

export function seedMeasuresStore(): MeasuresStore {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  return {
    operatorEmails: [MOCK_USER.email],
    counts: {
      fundersWithOpenCall: 14,
      activeApplicantWorkspaces: 386,
      newApplicantWorkspaces: 47,
      callsPublished: 4,
      fundersJoinedFromApplicantLinks: 2,
      switchedFundersWithCall: 3,
      awardsEligibleForKit: 22,
      awardsShared: 8,
      awardPosts: 11,
      awardPostClicks: 64,
      awardPostsWithClicks: 9,
      invitationsSent: 25,
      invitationsAccepted: 9,
    },
    lostDeals: [
      { reason: "reviews", lostOn: day(3) },
      { reason: "reviews", lostOn: day(12) },
      { reason: "procurement", lostOn: day(8) },
      { reason: "data_migration", lostOn: day(20) },
    ],
    searchConsole: { available: true, connected: false, site: null },
  };
}

const SITES = [
  { siteUrl: "sc-domain:opengrants.io", permissionLevel: "siteOwner" },
  { siteUrl: "https://gms.opengrants.io/", permissionLevel: "siteFullUser" },
];
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function report(site: string): SearchConsoleReport {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - 29 * 86_400_000);
  const pages: SearchConsoleReport["pages"] = [
    { kind: "opportunity", clicks: 212, impressions: 4810 },
    { kind: "funder", clicks: 96, impressions: 2950 },
    { kind: "home", clicks: 88, impressions: 3400 },
    { kind: "switch", clicks: 41, impressions: 1220 },
    { kind: "award", clicks: 17, impressions: 390 },
    { kind: "templates", clicks: 9, impressions: 310 },
  ];
  const sum = (xs: typeof pages) => ({ clicks: xs.reduce((a, p) => a + p.clicks, 0), impressions: xs.reduce((a, p) => a + p.impressions, 0) });
  return { site, range: { start: iso(start), end: iso(end) }, totals: sum(pages), pages, organic: sum(pages.filter((p) => ["opportunity", "funder", "award"].includes(p.kind))), baselineWeek: { start: "2026-11-16", end: "2026-11-22", clicks: 25 } };
}

export function createMockMeasuresApi(opts: { store: MeasuresStore; email: () => Promise<string | null> }): MeasuresApi {
  const { store } = opts;
  const isOperator = async () => {
    const email = (await opts.email())?.toLowerCase();
    if (!email) throw new ApiError(401, "Sign in to continue", [{ code: "missing_token" }]);
    return store.operatorEmails.map((e) => e.toLowerCase()).includes(email);
  };
  const operator = async () => {
    if (!(await isOperator())) throw new ApiError(403, "Only OpenGrants' operators can see the measures", [{ code: "not_an_operator" }]);
  };
  const state = (): SearchConsoleState => ({ available: store.searchConsole.available, connected: store.searchConsole.connected, problem: null, site: store.searchConsole.site, sites: store.searchConsole.connected ? SITES.map((s) => ({ ...s })) : [] });
  const unavailable = () => new ApiError(404, "Google Search Console is not set up on this server", [{ code: "search_console_unavailable" }]);

  return {
    isOperator,
    async measures(): Promise<OperatorMeasures> {
      await operator();
      const c = store.counts;
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 86_400_000);
      const lostFrom = iso(from);
      const lost = LOST_DEAL_REASONS.map((reason) => ({ reason, count: store.lostDeals.filter((d) => d.reason === reason && d.lostOn > lostFrom).length }));
      const perCall = ratio(c.newApplicantWorkspaces, c.callsPublished);
      const kit = ratio(c.awardsShared, c.awardsEligibleForKit);
      const joined = ratio(c.invitationsAccepted, c.invitationsSent);
      const sc = store.searchConsole;
      const r = sc.available && sc.connected && sc.site ? report(sc.site) : null;
      const weekly = r ? Math.round((r.organic.clicks / 30) * 7 * 10) / 10 : null;
      const target = r?.baselineWeek.clicks != null ? r.baselineWeek.clicks * 3 : null;
      return {
        window: { from: from.toISOString(), to: to.toISOString(), days: 30 },
        fundersWithOpenCall: { value: c.fundersWithOpenCall, target: 50, met: c.fundersWithOpenCall >= 50 },
        activeApplicantWorkspaces: { value: c.activeApplicantWorkspaces, target: 1000, met: c.activeApplicantWorkspaces >= 1000 },
        newApplicantWorkspacesPerCall: { value: perCall, target: 10, met: perCall !== null && perCall >= 10, newApplicantWorkspaces: c.newApplicantWorkspaces, callsPublished: c.callsPublished },
        fundersJoinedFromApplicantLinks: { value: c.fundersJoinedFromApplicantLinks, target: 5, met: c.fundersJoinedFromApplicantLinks >= 5 },
        switchedFundersWithCall: { value: c.switchedFundersWithCall, target: 25, met: c.switchedFundersWithCall >= 25, withinDays: 14 },
        shareKit: { value: kit, target: 0.3, met: kit !== null && kit >= 0.3, awardsShared: c.awardsShared, awardsEligible: c.awardsEligibleForKit, posts: c.awardPosts, clicks: c.awardPostClicks, postsWithClicks: c.awardPostsWithClicks, clicksPerPost: ratio(c.awardPostClicks, c.awardPostsWithClicks) },
        organicVisits: r
          ? { source: "search_console", value: r.organic.clicks, impressions: r.organic.impressions, weeklyAverage: weekly, range: r.range, baselineWeek: r.baselineWeek, target: { multiple: 3, value: target }, met: target === null || weekly === null ? null : weekly >= target }
          : { source: !sc.available ? "not_configured" : !sc.connected ? "not_connected" : "no_site", value: null, impressions: null, weeklyAverage: null, range: null, baselineWeek: null, target: { multiple: 3, value: null }, met: null },
        invitedTeammatesJoined: { value: joined, target: 0.4, met: joined !== null && joined >= 0.4, sent: c.invitationsSent, accepted: c.invitationsAccepted },
        dealsLost: { total: lost.reduce((a, x) => a + x.count, 0), byReason: lost },
      };
    },
    async recordLostDeal(input): Promise<LostDealRecorded> {
      await operator();
      const today = iso(new Date());
      const lostOn = input.lostOn ?? today;
      if (lostOn > today) throw new ApiError(422, "A deal is recorded once it is lost, not before", [{ code: "invalid_date", field: "lostOn" }]);
      store.lostDeals.push({ reason: input.reason, lostOn });
      return { recorded: true, reason: input.reason, lostOn };
    },
    async searchConsole() {
      await operator();
      return state();
    },
    async connectSearchConsole() {
      await operator();
      if (!store.searchConsole.available) throw unavailable();
      store.searchConsole.connected = true;
      return { connected: true, connectUrl: null };
    },
    async disconnectSearchConsole() {
      await operator();
      if (!store.searchConsole.available) throw unavailable();
      Object.assign(store.searchConsole, { connected: false, site: null });
      return { connected: false, site: null };
    },
    async chooseSite(siteUrl) {
      await operator();
      if (!SITES.some((s) => s.siteUrl === siteUrl)) throw new ApiError(422, "Choose the property for gms.opengrants.io", [{ code: "site_not_gms", field: "siteUrl" }]);
      store.searchConsole.site = siteUrl;
      return { site: siteUrl };
    },
    async searchConsoleReport() {
      await operator();
      if (!store.searchConsole.available) throw unavailable();
      if (!store.searchConsole.site) throw new ApiError(409, "Choose the GMS's property in Search Console first", [{ code: "search_console_site_required" }]);
      return report(store.searchConsole.site);
    },
  };
}
