// SPDX-License-Identifier: AGPL-3.0-only
// Syndication (docs/syndication.md): the open-call feeds carry only what each call's public page
// shows (each item equals the one built from `opportunityPage`), leave out calls taken out of the
// feeds, without a public page, unpublished or closed; filter by funder, region, fund and closing
// date; are cached with an ETag; the CSV is formula-safe and the RSS well-formed. The OpenGrants
// feed lists the index opt-ins as CommonGrants records the SDK validates. The PND email sent is
// the preview, once per call, by a person only, and not after PND's four weeks.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseCsv } from "@gms/importers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { opportunityPage } from "../src/services/public.ts";
import { FEED_CSV_COLUMNS, feedItemOf, PND, type FeedItem, type PublicCall } from "../src/services/syndication.ts";
import { BASE, CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WEB, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario } from "./scenario.ts";

// `@common-grants/sdk` is @gms/protocol's dependency, jsdom the web app's: load them from there.
const sdk = async () => {
  const req = createRequire(new URL("../../../packages/protocol/package.json", import.meta.url));
  return (await import(pathToFileURL(req.resolve("@common-grants/sdk/schemas")).href)) as { OpportunityBaseSchema: ZodType };
};
/** The few DOM members the RSS test reads (this package's types carry no DOM). */
interface XmlNode {
  nodeName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): XmlNode | null;
  querySelectorAll(selector: string): Iterable<XmlNode>;
  getElementsByTagNameNS(ns: string, name: string): ArrayLike<XmlNode>;
}
/** A strict XML parse (jsdom's, through saxes): malformed XML throws. */
const parseXml = async (text: string) => {
  const req = createRequire(new URL("../../web/package.json", import.meta.url));
  const { JSDOM } = (await import(pathToFileURL(req.resolve("jsdom")).href)) as { JSDOM: new (s: string, o: { contentType: string }) => { window: { document: XmlNode & { documentElement: XmlNode } } } };
  return new JSDOM(text, { contentType: "application/xml" }).window.document;
};

const OPP_OPEN = "0190e200-0000-7000-8000-0000000000a1";
const OPP_FORECAST = "0190e200-0000-7000-8000-0000000000a2";
const OPP_OPTOUT = "0190e200-0000-7000-8000-0000000000a3";
const OPP_NOPAGE = "0190e200-0000-7000-8000-0000000000a4";
const OPP_DRAFT = "0190e200-0000-7000-8000-0000000000a5";
const OPP_CLOSED = "0190e200-0000-7000-8000-0000000000a6";
const OPP_NOINDEX = "0190e200-0000-7000-8000-0000000000a7";
const OPP_FORMULA = "0190e200-0000-7000-8000-0000000000a8";
const COMP_OPEN = "0190e200-0000-7000-8000-0000000000c1";
const COMP_DRAFT = "0190e200-0000-7000-8000-0000000000c2";
const FUND = "0190e200-0000-7000-8000-0000000000f1";
const PROGRAM = "0190e200-0000-7000-8000-0000000000b1";
/** Strings that sit on the records but not on any public page: none may reach a feed. */
const SECRETS = ["SECRET-CUSTOM-FIELD", "SECRET-RULE-EXPLAIN", "SECRET-DRAFT-COMPETITION", "SECRET-FUNDER-SETTING", "SECRETEIN", "\"WA\"]"];

let h: Harness;
let seq = 0;
const json = (headers: Record<string, string>) => ({ ...headers, "Content-Type": "application/json" });
const person = async (user: string, ws = WS_FUNDER) => json({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws });
const agent = async (scope: string) => json({ Authorization: `Bearer ${await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-syn-${++seq}` })}`, "X-GMS-Workspace": WS_FUNDER });
const client = async (scope: string) => json({ Authorization: `Bearer ${await h.forge({ scope, jti: `tok-syn-${++seq}` })}`, "X-GMS-Workspace": WS_FUNDER });
const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
  const res = await h.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, headers: res.headers, text, body: parsed as { data?: Record<string, unknown>; errors?: { code?: string }[]; items?: unknown[]; paginationInfo?: Record<string, number> } & Record<string, unknown> };
};
const code = (r: { body: { errors?: { code?: string }[] } }) => r.body?.errors?.[0]?.code;
const feed = async (query = "") => {
  const r = await call("GET", `/gms/public/feeds/opportunities.json${query}`);
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  return r.body as unknown as { version: string; title: string; feed_url: string; items: { id: string; url: string; title: string; _gms: FeedItem }[] };
};
const ids = (f: { items: { id: string }[] }) => f.items.map((i) => i.id).sort();
const opp = (id: string, extra: Record<string, unknown>) => h.repos.table("opportunities").insert({ id, workspace_id: WS_FUNDER, status: "open", published_at: "2027-04-01T12:00:00.000Z", ...extra } as never);

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { contactEmail: "grants@riverbendcf.example", secretNote: "SECRET-FUNDER-SETTING" } as never, ein: "00SECRETEIN" });
  await h.repos.table("funds").insert({ id: FUND, workspace_id: WS_OTHER, name: "Rural Health Fund", slug: "rural-health", is_default: false } as never);
  await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_OTHER, name: "Rural health", fiscal_year: 2027, currency: "USD", fund_id: FUND } as never);
  await opp(OPP_OPEN, {
    slug: "community-health-2027",
    title: "Community Health Grants 2027",
    description: "Grants for clinics that bring care to families in rural Oregon.",
    funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" }, totalAmountAvailable: { amount: "1200000.00", currency: "USD" }, estimatedAwardCount: 10 },
    key_dates: { postDate: { name: "Opens", eventType: "singleDate", date: "2027-04-01" }, closeDate: { name: "Full proposals due", eventType: "singleDate", date: "2027-06-30" } },
    accepted_applicant_types: ["non_profit_with_501c3"],
    eligibility_rules: { all: [{ label: "Based in OR or WA", path: "org.addresses.primary.stateOrProvince", op: "in", value: ["OR", "WA"], explain: "SECRET-RULE-EXPLAIN" }] },
    custom_fields: { internalScore: { name: "internalScore", fieldType: "string", value: "SECRET-CUSTOM-FIELD" } },
    published_at: "2027-04-02T12:00:00.000Z",
  });
  await h.repos.table("competitions").insert({ id: COMP_OPEN, workspace_id: WS_FUNDER, opportunity_id: OPP_OPEN, title: "2027 cycle", status: "open", stages: [{ key: "loi", label: "Letter of intent", forms: {}, closes: "2027-05-31", entryFrom: [], requiresSubmission: true, decisionRequired: true }] } as never);
  await h.repos.table("competitions").insert({ id: COMP_DRAFT, workspace_id: WS_FUNDER, opportunity_id: OPP_OPEN, title: "SECRET-DRAFT-COMPETITION", status: "draft" } as never);
  await h.repos.table("opportunities").insert({ id: OPP_FORECAST, workspace_id: WS_OTHER, program_id: PROGRAM, slug: "county-call", title: "County clinic call", description: "Support for clinics in West Virginia.", status: "forecasted", published_at: "2027-04-03T12:00:00.000Z", key_dates: { closeDate: { name: "Applications close", eventType: "singleDate", date: "2027-09-01" } } } as never);
  await opp(OPP_OPTOUT, { slug: "opted-out", title: "Opted out call", description: "Not in feeds.", publish: { publicPage: true, openGrantsIndex: true, sitemap: true, feeds: false } });
  await opp(OPP_NOPAGE, { slug: "no-page", title: "No page call", description: "No public page.", publish: { publicPage: false, openGrantsIndex: true, sitemap: true } });
  await opp(OPP_DRAFT, { slug: "draft-call", title: "Draft call", description: "Not published.", published_at: null });
  await opp(OPP_CLOSED, { slug: "closed-call", title: "Closed call", description: "Closed.", status: "closed" });
  await opp(OPP_NOINDEX, { slug: "not-indexed", title: "Not indexed call", description: "Feeds only.", publish: { publicPage: true, openGrantsIndex: false, sitemap: true } });
});

describe("open-call feeds", () => {
  it("lists open and forecasted calls with a public page that are in the feeds, newest first", async () => {
    const f = await feed();
    expect(ids(f)).toEqual([OPP_OPEN, OPP_FORECAST, OPP_NOINDEX].sort());
    expect(f.items[0]!.id).toBe(OPP_FORECAST);
    expect(f.version).toBe("https://jsonfeed.org/version/1.1");
    expect(f.feed_url).toBe(`${BASE}/gms/public/feeds/opportunities.json`);
    for (const i of f.items) expect(new URL(i.url).searchParams.get("utm_source")).toBe("feed");
  });

  it("gives each call exactly what its public page shows, and nothing else", async () => {
    const f = await feed();
    const ctx = { repos: h.repos, now: () => h.clock.now, config: { baseUrl: BASE, webBaseUrl: WEB } } as unknown as Parameters<typeof opportunityPage>[0];
    for (const item of f.items) {
      const o = (await h.repos.table("opportunities").one({ id: item.id }))!;
      const w = (await h.repos.table("workspaces").one({ id: o.workspace_id }))!;
      const page: PublicCall = await opportunityPage(ctx, w.handle, o.slug);
      expect(item._gms).toEqual(feedItemOf(page));
    }
    const open = f.items.find((i) => i.id === OPP_OPEN)!._gms;
    expect(open).toMatchObject({ eligibility: ["Based in OR or WA"], acceptingApplications: true, closes: "2027-06-30", opens: "2027-04-01", category: null, funder: { name: "Riverbend Community Foundation", handle: "riverbend", page: `${WEB}/f/riverbend` } });
    expect(f.items.find((i) => i.id === OPP_FORECAST)!._gms.category).toEqual({ name: "Rural Health Fund", slug: "rural-health", page: `${WEB}/f/cascade-county/rural-health` });
    for (const format of ["json", "csv", "rss"]) {
      const body = (await call("GET", `/gms/public/feeds/opportunities.${format}`)).text;
      for (const s of SECRETS) expect(body, `${format}: ${s}`).not.toContain(s);
    }
  });

  it("filters by funder, region, fund and closing date; ignores other parameters", async () => {
    expect(ids(await feed("?funder=cascade-county"))).toEqual([OPP_FORECAST]);
    expect(ids(await feed("?funder=nobody-here"))).toEqual([]);
    // A state code in an eligibility label, its name in the description, and never inside a longer state name.
    expect(ids(await feed("?region=WA"))).toEqual([OPP_OPEN]);
    expect(ids(await feed("?region=oregon"))).toEqual([OPP_OPEN]);
    expect(ids(await feed("?region=West%20Virginia"))).toEqual([OPP_FORECAST]);
    expect(ids(await feed("?region=VA"))).toEqual([]);
    expect(ids(await feed("?category=rural-health"))).toEqual([OPP_FORECAST]);
    expect(ids(await feed("?category=Rural%20Health%20Fund"))).toEqual([OPP_FORECAST]);
    // 2027-04-16 to 2027-06-30 is 75 days.
    expect(ids(await feed("?closingWithin=60"))).toEqual([]);
    expect(ids(await feed("?closingWithin=90"))).toEqual([OPP_OPEN]);
    expect(ids(await feed("?closingWithin=90&utm_campaign=newsletter"))).toEqual([OPP_OPEN]);
    const bad = await call("GET", "/gms/public/feeds/opportunities.json?closingWithin=0");
    expect(bad.status).toBe(400);
    expect((await call("GET", "/gms/public/feeds/opportunities.json?funder=Not%20A%20Handle!")).status).toBe(400);
  });

  it("is cached, answers 304 for an unchanged feed, and anyone may read it", async () => {
    const first = await call("GET", "/gms/public/feeds/opportunities.rss", { Origin: "https://newsletter.example" });
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=900");
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const etag = first.headers.get("ETag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const again = await call("GET", "/gms/public/feeds/opportunities.rss", { "If-None-Match": etag });
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    await h.repos.table("opportunities").update({ id: OPP_OPEN }, { title: "Community Health Grants 2027 (updated)" });
    expect((await call("GET", "/gms/public/feeds/opportunities.rss", { "If-None-Match": etag })).status).toBe(200);
  });

  it("is kept in the colo's cache under its canonical address, other parameters ignored", async () => {
    // A stand-in for the Workers Cache API's `caches.default` (absent in Node).
    const kept = new Map<string, Response>();
    vi.stubGlobal("caches", { default: { match: async (r: Request) => kept.get(r.url)?.clone(), put: async (r: Request, res: Response) => void kept.set(r.url, res) } });
    const first = await call("GET", "/gms/public/feeds/opportunities.csv?funder=riverbend&utm_campaign=weekly");
    expect([...kept.keys()]).toEqual([`${BASE}/gms/public/feeds/opportunities.csv?funder=riverbend`]);
    expect(kept.get(`${BASE}/gms/public/feeds/opportunities.csv?funder=riverbend`)!.headers.get("Cache-Control")).toBe("public, max-age=300");
    await h.repos.table("opportunities").update({ id: OPP_OPEN }, { title: "Renamed while cached" });
    const again = await call("GET", "/gms/public/feeds/opportunities.csv?funder=riverbend");
    expect(again.text).toBe(first.text);
    expect(again.headers.get("Content-Disposition")).toBe(first.headers.get("Content-Disposition"));
    expect(again.headers.get("ETag")).toBe(first.headers.get("ETag"));
    kept.clear();
    expect((await call("GET", "/gms/public/feeds/opportunities.csv?funder=riverbend")).text).toContain("Renamed while cached");
  });

  it("writes formula-safe CSV cells", async () => {
    await opp(OPP_FORMULA, { slug: "formula", title: '=HYPERLINK("https://evil.example","Click")', description: "+1 cmd|' /C calc'!A0", eligibility_rules: { all: [{ label: "@SUM(1+1)", path: "org.name", op: "exists" }] } });
    const r = await call("GET", "/gms/public/feeds/opportunities.csv");
    expect(r.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const rows = parseCsv(r.text);
    expect(rows[0]).toEqual([...FEED_CSV_COLUMNS]);
    const row = rows.find((x) => x[0] === OPP_FORMULA)!;
    const col = (name: (typeof FEED_CSV_COLUMNS)[number]) => row[FEED_CSV_COLUMNS.indexOf(name)]!;
    expect(col("title")).toBe(`'=HYPERLINK("https://evil.example","Click")`);
    expect(col("description")).toBe("'+1 cmd|' /C calc'!A0");
    expect(col("eligibility")).toBe("'@SUM(1+1)");
    for (const x of rows.slice(1)) for (const cell of x) expect(cell, cell).not.toMatch(/^[=+\-@\t\r]/);
    const open = rows.find((x) => x[0] === OPP_OPEN)!;
    expect([open[FEED_CSV_COLUMNS.indexOf("min_award")], open[FEED_CSV_COLUMNS.indexOf("max_award")], open[FEED_CSV_COLUMNS.indexOf("currency")], open[FEED_CSV_COLUMNS.indexOf("closes")]]).toEqual(["50000.00", "150000.00", "USD", "2027-06-30"]);
  });

  it("writes well-formed RSS 2.0 with every item's title, link and guid", async () => {
    await opp(OPP_FORMULA, { slug: "formula", title: "Arts & <Culture> \"grants\"\u0007", description: "Fish & chips < 5 > 3" });
    const r = await call("GET", "/gms/public/feeds/opportunities.rss?funder=riverbend");
    expect(r.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    const doc = await parseXml(r.text);
    expect(doc.documentElement.nodeName).toBe("rss");
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");
    const channel = doc.querySelector("channel")!;
    expect(channel.querySelector(":scope > title")!.textContent).toBe("Open calls from Riverbend Community Foundation");
    expect(channel.querySelector(":scope > link")!.textContent).toBe(`${WEB}/f/riverbend`);
    expect(channel.querySelector(":scope > description")!.textContent!.length).toBeGreaterThan(10);
    expect(channel.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link")[0]!.getAttribute("href")).toBe(`${BASE}/gms/public/feeds/opportunities.rss?funder=riverbend`);
    const items = [...doc.querySelectorAll("item")];
    expect(items.map((i) => i.querySelector("guid")!.textContent).sort()).toEqual([`urn:uuid:${OPP_OPEN}`, `urn:uuid:${OPP_FORMULA}`, `urn:uuid:${OPP_NOINDEX}`].sort());
    for (const i of items) {
      expect(i.querySelector("title")!.textContent!.length).toBeGreaterThan(0);
      expect(new URL(i.querySelector("link")!.textContent!).searchParams.get("utm_source")).toBe("feed");
      expect(Number.isNaN(Date.parse(i.querySelector("pubDate")!.textContent!))).toBe(false);
    }
    const odd = items.find((i) => i.querySelector("guid")!.textContent === `urn:uuid:${OPP_FORMULA}`)!;
    expect(odd.querySelector("title")!.textContent).toBe('Arts & <Culture> "grants"');
    expect(odd.querySelector("description")!.textContent).toBe("Fish & chips < 5 > 3");
  });
});

describe("the OpenGrants index feed", () => {
  it("lists published calls with the index and their page on, closed ones included, as valid CommonGrants records", async () => {
    const r = await call("GET", "/gms/public/feeds/opengrants.json");
    expect(r.status).toBe(200);
    const items = r.body.items as { id: string; status: { value: string }; source: string; lastModifiedAt: string }[];
    expect(items.map((i) => i.id).sort()).toEqual([OPP_OPEN, OPP_FORECAST, OPP_OPTOUT, OPP_CLOSED].sort());
    const { OpportunityBaseSchema } = await sdk();
    for (const i of items) expect(OpportunityBaseSchema.safeParse(i).success, i.id).toBe(true);
    expect(items.find((i) => i.id === OPP_CLOSED)!.status.value).toBe("closed");
    expect(items.find((i) => i.id === OPP_OPEN)!.source).toBe(`${WEB}/f/riverbend/o/community-health-2027`);
    expect(r.body.paginationInfo).toMatchObject({ page: 1, pageSize: 100, totalItems: 4 });
    expect(r.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("pages, and returns only what changed since a time", async () => {
    const p1 = await call("GET", "/gms/public/feeds/opengrants.json?pageSize=3");
    const p2 = await call("GET", "/gms/public/feeds/opengrants.json?pageSize=3&page=2");
    expect([...(p1.body.items as { id: string }[]), ...(p2.body.items as { id: string }[])].map((i) => i.id).sort()).toEqual([OPP_OPEN, OPP_FORECAST, OPP_OPTOUT, OPP_CLOSED].sort());
    h.clock.now = new Date("2027-04-17T09:00:00Z");
    await h.repos.table("opportunities").update({ id: OPP_CLOSED }, { title: "Closed call, renamed" });
    const changed = await call("GET", `/gms/public/feeds/opengrants.json?modifiedSince=${encodeURIComponent("2027-04-17T00:00:00Z")}`);
    expect((changed.body.items as { id: string }[]).map((i) => i.id)).toEqual([OPP_CLOSED]);
    expect((await call("GET", "/gms/public/feeds/opengrants.json?modifiedSince=yesterday")).status).toBe(400);
    expect((await call("GET", "/gms/public/feeds/opengrants.json?pageSize=500")).status).toBe(400);
  });
});

describe("Philanthropy News Digest", () => {
  const preview = async (who: Record<string, string>, id = OPP_OPEN) => call("POST", `/gms/opportunities/opp_${id}/syndication/pnd/preview`, who);
  const send = async (who: Record<string, string>, digest: string, id = OPP_OPEN) => call("POST", `/gms/opportunities/opp_${id}/syndication/pnd`, who, { digest });

  it("previews PND's fields from the public page, and sends exactly the preview, to PND, with replies to the funder", async () => {
    const officer = await person(USER_OFFICER);
    const p = await preview(officer);
    expect(p.status, p.text.slice(0, 300)).toBe(200);
    const d = p.body.data as { from: string; to: string; replyTo: string; subject: string; text: string; html: string; digest: string; fields: { key: string; label: string; value: string }[]; earliestDeadline: string; sendBy: string };
    expect(d.to).toBe("pndrfp@candid.org");
    expect(d.replyTo).toBe("grants@riverbendcf.example");
    expect(d.from).toBe('"Riverbend Community Foundation" <notices@gms.test>');
    expect(d.subject).toBe("RFP for Philanthropy News Digest: Community Health Grants 2027 (Riverbend Community Foundation)");
    expect(d.fields.map((f) => f.label)).toEqual(["Funder", "Opportunity", "Program scope", "Grantee qualifications", "Application instructions", "Deadlines", "Full RFP", "Contact"]);
    const field = (k: string) => d.fields.find((f) => f.key === k)!.value;
    expect(field("scope")).toBe("Grants for clinics that bring care to families in rural Oregon.\n\nGrants of $50,000 to $150,000. $1,200,000 available in all. About 10 grants.");
    expect(field("qualifications")).toBe("Open to: 501(c)(3) nonprofits.\n- Based in OR or WA");
    expect(field("deadlines")).toBe("Opens: April 1, 2027\nLetter of intent due: May 31, 2027\nFull proposals due: June 30, 2027");
    expect(new URL(field("link")).searchParams.get("utm_source")).toBe("pnd");
    // The letter of intent, due first, sets PND's four weeks.
    expect([d.earliestDeadline, d.sendBy]).toEqual(["2027-05-31", "2027-05-03"]);
    for (const s of SECRETS) expect(d.text + d.html).not.toContain(s);
    expect(h.mailer.sent).toHaveLength(0);

    const r = await send(officer, d.digest);
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(h.mailer.sent).toHaveLength(1);
    const m = h.mailer.sent[0]!;
    expect({ from: m.from, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html }).toEqual({ from: d.from, to: [d.to], replyTo: d.replyTo, subject: d.subject, text: d.text, html: d.html });
    expect(m.idempotencyKey).toBe(`pnd:${OPP_OPEN}`);
    const rows = await h.repos.table("syndication_sends").find({ opportunity_id: OPP_OPEN });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target: "pnd", to_address: "pndrfp@candid.org", reply_to_masked: "g…@riverbendcf.example", digest: d.digest, sent_by: USER_OFFICER, message_id: m.id });
    expect(rows[0]!.sent_at).not.toBeNull();
    const event = h.ledger.events.find((e) => e.eventType === "opportunity.syndicated")!;
    expect(event.data).toMatchObject({ target: "pnd", to: "pndrfp@candid.org", replyTo: "g…@riverbendcf.example" });
    expect(JSON.stringify(event.data)).not.toContain("grants@riverbendcf.example");
  });

  it("sends once per call", async () => {
    const admin = await person(USER_ADMIN);
    const d = (await preview(admin)).body.data as { digest: string };
    expect((await send(admin, d.digest)).status).toBe(200);
    const again = await send(admin, d.digest);
    expect([again.status, code(again)]).toEqual([409, "pnd_already_sent"]);
    expect(code(await preview(admin))).toBe("pnd_already_sent");
    expect(h.mailer.sent).toHaveLength(1);
    const status = (await call("GET", `/gms/opportunities/opp_${OPP_OPEN}/syndication`, admin)).body.data as { pnd: { sent: { sentAt: string; replyTo: string } | null; canSend: boolean; blocked: string } };
    expect(status.pnd).toMatchObject({ canSend: false, blocked: "sent", sent: { replyTo: "g…@riverbendcf.example" } });
  });

  it("is a person's only: agents and API clients are refused, and a person needs a role that edits calls", async () => {
    for (const who of [await agent("opportunities:read opportunities:write"), await client("opportunities:read opportunities:write")]) {
      const p = await preview(who);
      expect([p.status, code(p)]).toEqual([403, "human_only"]);
      const s = await send(who, "0".repeat(64));
      expect([s.status, code(s)]).toEqual([403, "human_only"]);
    }
    const auditor = await person(USER_AUDITOR);
    expect(code(await preview(auditor))).toBe("insufficient_scope");
    expect((await preview(await person(USER_ADMIN), OPP_FORECAST)).status).toBe(404);
    expect(h.mailer.sent).toHaveLength(0);
    // The agent reads the panel and is told a person sends.
    const status = (await call("GET", `/gms/opportunities/opp_${OPP_OPEN}/syndication`, await agent("opportunities:read"))).body.data as { pnd: { canSend: boolean; blocked: string } };
    expect(status.pnd).toMatchObject({ canSend: false, blocked: "person_only" });
  });

  it("refuses a stale preview, a failed send leaves no record, and nothing goes after PND's four weeks", async () => {
    let officer = await person(USER_OFFICER);
    const before = (await preview(officer)).body.data as { digest: string };
    await h.repos.table("opportunities").update({ id: OPP_OPEN }, { description: "A changed description." });
    expect(code(await send(officer, before.digest))).toBe("preview_changed");
    const now = (await preview(officer)).body.data as { digest: string };
    h.mailer.failNext = new Error("Resend is down");
    const failed = await send(officer, now.digest);
    expect([failed.status, code(failed)]).toEqual([502, "mail_failed"]);
    expect(await h.repos.table("syndication_sends").find({ opportunity_id: OPP_OPEN })).toHaveLength(0);

    h.clock.now = new Date("2027-05-04T15:00:00Z");
    officer = await person(USER_OFFICER);
    const late = await preview(officer);
    expect([late.status, code(late)]).toEqual([409, "pnd_too_late"]);
    const status = (await call("GET", `/gms/opportunities/opp_${OPP_OPEN}/syndication`, officer)).body.data as { pnd: { blocked: string; sendBy: string } };
    expect(status.pnd).toMatchObject({ blocked: "too_late", sendBy: "2027-05-03" });
    expect(code(await preview(officer, OPP_CLOSED))).toBe("pnd_call_closed");
    expect(code(await preview(officer, OPP_NOPAGE))).toBe("pnd_not_listed");
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("without the funder's public address, replies go to the person who sends", async () => {
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: {} });
    const d = (await preview(await person(USER_OFFICER))).body.data as { replyTo: string; fields: { key: string; value: string }[] };
    expect(d.replyTo).toBe("dana.ortiz@riverbendcf.example");
    expect(d.fields.find((f) => f.key === "contact")!.value).toBe("dana.ortiz@riverbendcf.example");
  });
});

describe("agents", () => {
  const rpc = async (token: string, method: string, params?: unknown) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  };
  const token = () => h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "opportunities:read opportunities:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-syn-${++seq}` });

  it("read the panel over MCP, the same as REST; no tool sends to PND or changes the feeds", async () => {
    const out = (await rpc(await token(), "tools/call", { name: "get_opportunity_syndication", arguments: { opportunityId: `opp_${OPP_OPEN}` } })).structuredContent as { feeds: { listed: boolean }; pnd: { canSend: boolean; blocked: string; sendBy: string } };
    expect(out.feeds.listed).toBe(true);
    expect(out.pnd).toMatchObject({ canSend: false, blocked: "person_only", sendBy: "2027-05-03" });
    const tools = (await rpc(await token(), "tools/list")).tools as { name: string; _meta: Record<string, unknown> }[];
    expect(tools.filter((t) => /pnd|syndicat|philanthropy|feed/.test(t.name)).map((t) => t.name)).toEqual(["get_opportunity_syndication"]);
    expect(tools.find((t) => t.name === "get_opportunity_syndication")!._meta["gms/gated"]).toBe(false);
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("the Share this call panel", () => {
  it("shows the feeds and the OpenGrants feed, and takes a call out of the feeds and back", async () => {
    const officer = await person(USER_OFFICER);
    const s = (await call("GET", `/gms/opportunities/opp_${OPP_OPEN}/syndication`, officer)).body.data as { feeds: { on: boolean; listed: boolean; urls: Record<string, string> }; openGrants: { on: boolean; inFeed: boolean; feedUrl: string; pulling: boolean }; pnd: { address: string; sendBy: string; canSend: boolean } };
    expect(s.feeds).toMatchObject({ on: true, listed: true, urls: { rss: `${BASE}/gms/public/feeds/opportunities.rss?funder=riverbend` } });
    expect(s.openGrants).toEqual({ on: true, inFeed: true, feedUrl: `${BASE}/gms/public/feeds/opengrants.json`, pulling: false });
    expect(s.pnd).toMatchObject({ address: PND.address, sendBy: "2027-05-03", canSend: true });

    const off = await call("PUT", `/gms/opportunities/opp_${OPP_OPEN}/syndication/feeds`, officer, { feeds: false });
    expect(off.status).toBe(200);
    expect((off.body.data as { feeds: { on: boolean; listed: boolean } }).feeds).toMatchObject({ on: false, listed: false });
    expect(ids(await feed())).not.toContain(OPP_OPEN);
    const row = (await h.repos.table("opportunities").one({ id: OPP_OPEN }))!;
    expect(row.publish).toMatchObject({ publicPage: true, openGrantsIndex: true, sitemap: true, feeds: false });
    expect((await call("PUT", `/gms/opportunities/opp_${OPP_OPEN}/syndication/feeds`, officer, { feeds: true })).status).toBe(200);
    expect(ids(await feed())).toContain(OPP_OPEN);
    expect((await call("PUT", `/gms/opportunities/opp_${OPP_OPEN}/syndication/feeds`, await person(USER_AUDITOR), { feeds: false })).status).toBe(403);
    expect((await call("PUT", `/gms/opportunities/opp_${OPP_OPEN}/syndication/feeds`, officer, { feeds: "no" })).status).toBe(400);
  });

  it("counts applications started from feed and PND links", async () => {
    const s = await scenario(h);
    // Each start, then withdrawn, so the next start is a new application.
    for (const source of ["feed", "pnd", "newsletter"]) {
      const res = await h.request(`/common-grants/applications/start?utm_source=${source}`, { method: "POST", headers: { ...s.applicant, "Content-Type": "application/json" }, body: JSON.stringify({ competitionId: s.uuid.comp }) });
      expect(res.status).toBe(201);
      const app = (await h.repos.table("applications").find({ competition_id: s.uuid.comp, status: "draft" }))[0]!;
      await h.repos.table("applications").update({ id: app.id }, { status: "withdrawn" });
    }
    const started = await h.repos.table("application_events").find({ type: "started" });
    expect(started.map((e) => (e.payload as { utmSource?: string }).utmSource ?? null)).toEqual(["feed", "pnd", null]);
    const status = (await call("GET", `/gms/opportunities/${s.oppId}/syndication`, s.funder)).body.data as { startedFrom: { feed: number; pnd: number } };
    expect(status.startedFrom).toEqual({ feed: 1, pnd: 1 });
  });
});
