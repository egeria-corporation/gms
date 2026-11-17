// SPDX-License-Identifier: AGPL-3.0-only
// The operators' growth measures (F3, docs/measures.md): operators only (a funder admin, an agent
// and an API client are refused), counts only (no person, organization, address or id in any
// answer), the shaping of each measure and its target from the counts migration 0052 returns
// (pgTAP 52_operator_measures checks the counts themselves against fixtures), deals lost by a
// fixed reason, and Search Console against a fake, grouped by kind of page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, FixtureSearchConsole, type SearchAnalyticsQuery, type SearchAnalyticsRow } from "@gms/connectors";
import {
  LOST_DEAL_REASONS,
  MEASURES_PAGE,
  PAGE_KINDS,
  byPageKind,
  isOperator,
  operatorsOf,
  pageKindOf,
  parseCounts,
  searchConsoleRange,
  siteCoversHost,
  type MeasureCounts,
  type MeasuresStore,
} from "../src/services/measures.ts";
import { CLIENT_API, SESSION_SECRET, USER_ADMIN, USER_OFFICER, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const OPERATOR = "0be7a70f-0000-4000-8000-0000000000aa";
const OPERATOR_EMAIL = "ops@opengrants.example";
const PROVIDER = "5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a";
const HOST = "app.gms.test";

let h: Harness;
let store: FakeStore;

class FakeStore implements MeasuresStore {
  calls: { now: string; windowDays: number; switchDays: number }[] = [];
  answer: MeasureCounts = {
    from: "2027-03-17T17:00:00.000Z",
    to: "2027-04-16T17:00:00.000Z",
    fundersWithOpenCall: 12,
    activeApplicantWorkspaces: 340,
    newApplicantWorkspaces: 42,
    callsPublished: 4,
    fundersJoinedFromApplicantLinks: 2,
    switchedFundersWithCall: 3,
    awardsEligibleForKit: 20,
    awardsShared: 7,
    awardPosts: 9,
    awardPostClicks: 45,
    awardPostsWithClicks: 6,
    invitationsSent: 10,
    invitationsAccepted: 5,
    lostDeals: { reviews: 2, procurement: 1 },
  };
  async counts(now: Date, windowDays: number, switchDays: number) {
    this.calls.push({ now: now.toISOString(), windowDays, switchDays });
    return this.answer;
  }
}

/** A Supabase session with its own address and, for an SSO sign-in, the `amr` entry. */
async function session(userId: string, opts: { email?: string; sso?: boolean } = {}) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const amr = opts.sso ? [{ method: "sso/saml", timestamp: iat, provider: PROVIDER }] : [{ method: "otp", timestamp: iat }];
  return new SignJWT({ aal: "aal2", email: opts.email ?? "person@riverbendcf.example", role: "authenticated", amr }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
}

/** A response body read loosely: nested fields by name, leaves compared by the matchers. */
interface Body {
  [key: string]: Body & string;
}
interface Answer {
  status: number;
  code?: string;
  data: Body;
}
type ReasonCount = { reason: string; count: number };
async function call(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const res = await h.request(path, { method, headers: { ...(token ? bearer(token).headers : {}), ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { code: string }[] };
  return { status: res.status, code: json.errors?.[0]?.code, data: json.data as unknown as Body };
}

const ROUTES: [string, string, unknown?][] = [
  ["GET", "/gms/operator/measures"],
  ["POST", "/gms/operator/lost-deals", { reason: "forms" }],
  ["GET", "/gms/operator/search-console"],
  ["POST", "/gms/operator/search-console/connect", {}],
  ["DELETE", "/gms/operator/search-console"],
  ["PUT", "/gms/operator/search-console/site", { siteUrl: `https://${HOST}/` }],
  ["GET", "/gms/operator/search-console/report"],
];

/** Every string an answer holds, wherever it sits. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

beforeEach(async () => {
  h = await harness();
  store = new FakeStore();
  h.extraPorts.measures = store;
  h.env.OPERATORS = `${OPERATOR}, ${OPERATOR_EMAIL}`;
});

describe("operators only", () => {
  it("refuses a funder admin on every route, and writes nothing", async () => {
    const admin = await session(USER_ADMIN);
    for (const [method, path, body] of ROUTES) {
      const r = await call(admin, method, path, body, { "X-GMS-Workspace": WS_FUNDER });
      expect([path, r.status, r.code]).toEqual([path, 403, "not_an_operator"]);
    }
    expect(await h.repos.table("lost_deals").count({})).toBe(0);
    expect(store.calls).toEqual([]);
    expect((await call(admin, "GET", "/gms/operator/me")).data).toEqual({ operator: false });
  });

  it("refuses API clients and agents (a session only) and anyone not signed in", async () => {
    const token = await clientCredentialsToken(h, "workspace:admin");
    for (const [method, path, body] of ROUTES) {
      expect((await call(token, method, path, body)).code).toBe("session_required");
      expect((await call(null, method, path, body)).status).toBe(401);
    }
    expect(CLIENT_API).toBeTruthy();
  });

  it("admits an operator by user id, and by address only for a session that skipped single sign-on", async () => {
    expect((await call(await session(OPERATOR), "GET", "/gms/operator/measures")).status).toBe(200);
    expect((await call(await session(USER_OFFICER, { email: "OPS@opengrants.example" }), "GET", "/gms/operator/measures")).status).toBe(200);
    // A workspace's identity provider can assert any address: its word never makes an operator.
    expect((await call(await session(USER_OFFICER, { email: OPERATOR_EMAIL, sso: true }), "GET", "/gms/operator/measures")).code).toBe("not_an_operator");
    expect((await call(await session(OPERATOR, { sso: true }), "GET", "/gms/operator/me")).data).toEqual({ operator: true });
  });

  it("reads OPERATORS, and GALLERY_MODERATORS only while OPERATORS is unset or blank", () => {
    expect(operatorsOf({ OPERATORS: " ", GALLERY_MODERATORS: OPERATOR })).toBe(OPERATOR);
    expect(operatorsOf({ GALLERY_MODERATORS: OPERATOR })).toBe(OPERATOR);
    expect(operatorsOf({ OPERATORS: USER_ADMIN, GALLERY_MODERATORS: OPERATOR })).toBe(USER_ADMIN);
    expect(operatorsOf({})).toBeNull();
    expect(isOperator(null, { userId: OPERATOR, email: null, viaSso: false })).toBe(false);
    expect(isOperator("not-an-id, ", { userId: OPERATOR, email: null, viaSso: false })).toBe(false);
  });

  it("falls back to the gallery's moderators while OPERATORS is not set", async () => {
    delete h.env.OPERATORS;
    h.env.GALLERY_MODERATORS = USER_ADMIN;
    expect((await call(await session(USER_ADMIN), "GET", "/gms/operator/measures")).status).toBe(200);
    h.env.OPERATORS = OPERATOR;
    expect((await call(await session(USER_ADMIN), "GET", "/gms/operator/measures")).code).toBe("not_an_operator");
  });
});

describe("the measures", () => {
  it("shapes each of the nine with its 90-day target, over the last 30 days", async () => {
    const r = await call(await session(OPERATOR), "GET", "/gms/operator/measures");
    expect(store.calls).toEqual([{ now: h.clock.now.toISOString(), windowDays: 30, switchDays: 14 }]);
    expect(r.data).toMatchObject({
      window: { from: "2027-03-17T17:00:00.000Z", to: "2027-04-16T17:00:00.000Z", days: 30 },
      fundersWithOpenCall: { value: 12, target: 50, met: false },
      activeApplicantWorkspaces: { value: 340, target: 1000, met: false },
      newApplicantWorkspacesPerCall: { value: 10.5, target: 10, met: true, newApplicantWorkspaces: 42, callsPublished: 4 },
      fundersJoinedFromApplicantLinks: { value: 2, target: 5, met: false },
      switchedFundersWithCall: { value: 3, target: 25, met: false, withinDays: 14 },
      shareKit: { value: 0.35, target: 0.3, met: true, awardsShared: 7, awardsEligible: 20, posts: 9, clicks: 45, postsWithClicks: 6, clicksPerPost: 7.5 },
      organicVisits: { source: "not_configured", value: null, target: { multiple: 3, value: null }, met: null },
      invitedTeammatesJoined: { value: 0.5, target: 0.4, met: true, sent: 10, accepted: 5 },
    });
    expect(r.data.dealsLost?.total).toBe(3);
    const byReason = r.data.dealsLost?.byReason as unknown as ReasonCount[];
    expect(byReason.map((x) => x.reason)).toEqual([...LOST_DEAL_REASONS]);
    expect(byReason.find((x) => x.reason === "reviews")?.count).toBe(2);
  });

  it("says nothing it cannot divide: no call published, no award, no invitation", async () => {
    store.answer = { ...store.answer, callsPublished: 0, awardsEligibleForKit: 0, awardsShared: 0, awardPostsWithClicks: 0, invitationsSent: 0, invitationsAccepted: 0 };
    const r = await call(await session(OPERATOR), "GET", "/gms/operator/measures");
    expect(r.data.newApplicantWorkspacesPerCall).toMatchObject({ value: null, met: false });
    expect(r.data.shareKit).toMatchObject({ value: null, met: false, clicksPerPost: null });
    expect(r.data.invitedTeammatesJoined).toMatchObject({ value: null, met: false });
  });

  it("holds counts only: no person, organization, address or id in the answer", async () => {
    const r = await call(await session(OPERATOR), "GET", "/gms/operator/measures");
    const allowed = new Set<string>([...LOST_DEAL_REASONS, "not_configured"]);
    expect(strings(r.data).filter((s) => !ISO.test(s) && !allowed.has(s))).toEqual([]);
  });

  it("reads the function's answer strictly", () => {
    expect(() => parseCounts({ ...store.answer, fundersWithOpenCall: "Riverbend" })).toThrow();
    expect(() => parseCounts({ ...store.answer, activeApplicantWorkspaces: -1 })).toThrow();
    expect(parseCounts({ ...store.answer, lostDeals: { forms: 1, "Acme Foundation": 4 } }).lostDeals).toEqual({ forms: 1 });
  });

  it("is unavailable without the database's measures", async () => {
    h.withoutPorts.add("measures");
    delete h.extraPorts.measures;
    expect((await call(await session(OPERATOR), "GET", "/gms/operator/measures")).code).toBe("measures_unavailable");
  });
});

describe("deals lost", () => {
  it("keeps the reason list equal to migration 0052's check", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0052_operator_measures.sql", import.meta.url)), "utf8");
    const check = /reason\s+text not null check \(reason in \(([^)]*)\)\)/.exec(sql)![1]!;
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...LOST_DEAL_REASONS]);
  });

  it("records a reason and a day, nothing else, and the ledger says the reason only", async () => {
    const op = await session(OPERATOR);
    const r = await call(op, "POST", "/gms/operator/lost-deals", { reason: "procurement", lostOn: "2027-04-10" });
    expect(r).toMatchObject({ status: 201, data: { recorded: true, reason: "procurement", lostOn: "2027-04-10" } });
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "forms" })).data.lostOn).toBe("2027-04-16");
    const rows = await h.repos.table("lost_deals").find({});
    expect(rows.map((x) => [x.reason, x.lost_on, x.recorded_by])).toEqual([
      ["procurement", "2027-04-10", OPERATOR],
      ["forms", "2027-04-16", OPERATOR],
    ]);
    const event = h.ledger.events.find((e) => e.eventType === "operator.lost_deal_recorded")!;
    expect(event.data).toEqual({ reason: "procurement", lostOn: "2027-04-10" });
    expect(event.workspaceId).toBeNull();
  });

  it("refuses free text, an unknown reason, a day in the future or over a year ago", async () => {
    const op = await session(OPERATOR);
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "forms", note: "Acme Foundation chose another system" })).code).toBe("bad_request");
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "price" })).code).toBe("bad_request");
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "forms", lostOn: "2027-04-17" })).code).toBe("invalid_date");
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "forms", lostOn: "2026-04-15" })).code).toBe("invalid_date");
    expect((await call(op, "POST", "/gms/operator/lost-deals", { reason: "forms", lostOn: "2027-02-30" })).code).toBe("invalid_date");
    expect(await h.repos.table("lost_deals").count({})).toBe(0);
  });
});

describe("Search Console", () => {
  const ROWS: SearchAnalyticsRow[] = [
    { keys: [`https://${HOST}/f/riverbend/o/arts-2027`], clicks: 60, impressions: 900 },
    { keys: [`https://${HOST}/f/riverbend`], clicks: 30, impressions: 700 },
    { keys: [`https://${HOST}/f/cascade/awards/water-2027`], clicks: 6, impressions: 50 },
    { keys: [`https://${HOST}/`], clicks: 40, impressions: 1200 },
    { keys: [`https://${HOST}/switch/fluxx?lang=es`], clicks: 5, impressions: 80 },
  ];
  let gsc: FixtureSearchConsole;
  beforeEach(() => {
    gsc = new FixtureSearchConsole(
      [
        { siteUrl: "sc-domain:gms.test", permissionLevel: "siteOwner" },
        { siteUrl: `https://${HOST}/`, permissionLevel: "siteFullUser" },
        { siteUrl: "https://www.example.org/", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:example.org", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:app.gms.test", permissionLevel: "siteUnverifiedUser" },
      ],
      (q: SearchAnalyticsQuery) => (q.dimensions.length === 0 ? [{ keys: [], clicks: 7, impressions: 140 }] : ROWS),
    );
    h.extraPorts.searchConsole = gsc;
  });

  it("is hidden until its auth config is set", async () => {
    delete h.extraPorts.searchConsole;
    const op = await session(OPERATOR);
    expect((await call(op, "GET", "/gms/operator/search-console")).data).toMatchObject({ available: false, connected: false, sites: [] });
    expect((await call(op, "POST", "/gms/operator/search-console/connect", {})).code).toBe("search_console_unavailable");
  });

  it("connects through a Composio sign-in that returns to the measures page", async () => {
    gsc.connected = false;
    const op = await session(OPERATOR);
    expect((await call(op, "GET", "/gms/operator/search-console")).data).toMatchObject({ available: true, connected: false });
    const r = await call(op, "POST", "/gms/operator/search-console/connect", { returnTo: "https://evil.example/" });
    expect(r.data).toMatchObject({ connected: false, connectUrl: expect.stringContaining("google_search_console") });
    expect(MEASURES_PAGE).toBe("/operator/measures");
    expect(h.ledger.events.some((e) => e.eventType === "operator.search_console_connect_started")).toBe(true);
  });

  it("offers only the properties that cover the GMS's own host, never the account's other sites", async () => {
    const r = await call(await session(OPERATOR), "GET", "/gms/operator/search-console");
    expect((r.data.sites as unknown as { siteUrl: string }[]).map((s) => s.siteUrl)).toEqual(["sc-domain:gms.test", `https://${HOST}/`]);
    expect(siteCoversHost("sc-domain:opengrants.io", "gms.opengrants.io")).toBe(true);
    expect(siteCoversHost("sc-domain:gms.opengrants.io", "gms.opengrants.io")).toBe(true);
    expect(siteCoversHost("sc-domain:ngrants.io", "gms.opengrants.io")).toBe(false);
    expect(siteCoversHost("https://gms.opengrants.io/f/", "gms.opengrants.io")).toBe(false);
    expect(siteCoversHost("http://gms.opengrants.io/", "gms.opengrants.io")).toBe(false);
  });

  it("keeps the chosen property, only one for the GMS that the account can read", async () => {
    const op = await session(OPERATOR);
    expect((await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:example.org" })).code).toBe("site_not_gms");
    expect((await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:app.gms.test" })).code).toBe("site_not_found");
    expect((await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" })).data).toEqual({ site: "sc-domain:gms.test" });
    expect((await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: `https://${HOST}/` })).data).toEqual({ site: `https://${HOST}/` });
    expect(await h.repos.table("operator_settings").find({})).toHaveLength(1);
    expect((await call(op, "GET", "/gms/operator/search-console")).data.site).toBe(`https://${HOST}/`);
  });

  it("reports clicks and impressions by kind of page, never a page's address", async () => {
    const op = await session(OPERATOR);
    expect((await call(op, "GET", "/gms/operator/search-console/report")).code).toBe("search_console_site_required");
    await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" });
    const r = await call(op, "GET", "/gms/operator/search-console/report");
    expect(r.data).toMatchObject({
      site: "sc-domain:gms.test",
      range: { start: "2027-03-15", end: "2027-04-13" },
      totals: { clicks: 141, impressions: 2930 },
      organic: { clicks: 96, impressions: 1650 },
      baselineWeek: { start: "2026-11-16", end: "2026-11-22", clicks: 7 },
    });
    expect(r.data.pages).toEqual([
      { kind: "opportunity", clicks: 60, impressions: 900 },
      { kind: "home", clicks: 40, impressions: 1200 },
      { kind: "funder", clicks: 30, impressions: 700 },
      { kind: "award", clicks: 6, impressions: 50 },
      { kind: "switch", clicks: 5, impressions: 80 },
    ]);
    expect(strings(r.data).filter((s) => /riverbend|cascade|https?:/.test(s))).toEqual([]);
    // Every query is held to the GMS's own pages.
    expect(gsc.queries.map((q) => [q.dimensions.join(), q.pageRegex])).toEqual([
      ["page", "^https://app\\.gms\\.test/"],
      ["", "^https://app\\.gms\\.test/f/"],
    ]);
  });

  it("feeds measure 7 from Search Console, against three times the first week", async () => {
    const op = await session(OPERATOR);
    await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" });
    const r = await call(op, "GET", "/gms/operator/measures");
    expect(r.data.organicVisits).toMatchObject({ source: "search_console", value: 96, impressions: 1650, weeklyAverage: 22.4, baselineWeek: { clicks: 7 }, target: { multiple: 3, value: 21 }, met: true });
  });

  it("waits for the first week's figures before setting the target", async () => {
    h.clock.now = new Date("2026-11-21T12:00:00Z");
    const op = await session(OPERATOR);
    await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" });
    const r = await call(op, "GET", "/gms/operator/measures");
    expect(r.data.organicVisits).toMatchObject({ source: "search_console", baselineWeek: { clicks: null }, target: { value: null }, met: null });
    expect(gsc.queries).toHaveLength(1);
    expect(searchConsoleRange(h.clock.now)).toEqual({ start: "2026-10-20", end: "2026-11-18" });
  });

  it("says why measure 7 is missing, and keeps the other measures when Search Console fails", async () => {
    const op = await session(OPERATOR);
    expect((await call(op, "GET", "/gms/operator/measures")).data.organicVisits?.source).toBe("no_site");
    await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" });
    gsc.answer = () => {
      throw new ConnectorUnavailableError("composio");
    };
    const r = await call(op, "GET", "/gms/operator/measures");
    expect(r.status).toBe(200);
    expect(r.data.organicVisits?.source).toBe("unavailable");
    expect(r.data.fundersWithOpenCall?.value).toBe(12);
    expect((await call(op, "GET", "/gms/operator/search-console/report")).code).toBe("search_console_unreachable");
    gsc.connected = false;
    expect((await call(op, "GET", "/gms/operator/measures")).data.organicVisits?.source).toBe("not_connected");
  });

  it("starts afresh when the connection held more than read-only access, and asks to reconnect when it cannot be read", async () => {
    const op = await session(OPERATOR);
    let asked = 0;
    gsc.status = async () => {
      asked++;
      // The first look deletes a connection that held the full webmasters scope (the connector does this).
      if (asked === 1) throw new ConnectorScopeError(["https://www.googleapis.com/auth/webmasters"]);
      return { connected: false, connectUrl: "https://composio.invalid/connect/google_search_console" };
    };
    expect((await call(op, "POST", "/gms/operator/search-console/connect", {})).data).toEqual({ connected: false, connectUrl: "https://composio.invalid/connect/google_search_console" });
    gsc.status = async () => ({ connected: true, connectUrl: null });
    gsc.listSites = async () => {
      throw new ConnectorScopeUnverifiedError();
    };
    expect((await call(op, "GET", "/gms/operator/search-console")).data).toMatchObject({ connected: false, problem: "reconnect", sites: [] });
    expect((await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" })).code).toBe("search_console_reconnect");
  });

  it("disconnects at Composio and forgets the property", async () => {
    const op = await session(OPERATOR);
    await call(op, "PUT", "/gms/operator/search-console/site", { siteUrl: "sc-domain:gms.test" });
    expect((await call(op, "DELETE", "/gms/operator/search-console")).data).toEqual({ connected: false, site: null });
    expect(gsc.connected).toBe(false);
    expect((await h.repos.table("operator_settings").one({ id: true }))?.search_console_site).toBeNull();
  });

  it("names every kind of public page from its path", () => {
    expect(PAGE_KINDS).toContain("other");
    expect(["/", "/f/a", "/f/a/o/b", "/f/a/fund-x", "/f/a/awards", "/f/a/awards/b", "/switch", "/switch/fluxx", "/templates/x", "/for-funders", "/partners", "/join/abc", "/f/a/o/b/extra"].map((p) => pageKindOf(`https://${HOST}${p}`))).toEqual([
      "home",
      "funder",
      "opportunity",
      "fund",
      "awards",
      "award",
      "switch",
      "switch",
      "templates",
      "for_funders",
      "partners",
      "other",
      "other",
    ]);
    expect(pageKindOf("not a url")).toBe("other");
    expect(byPageKind([])).toEqual([]);
  });
});
