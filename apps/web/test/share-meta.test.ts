// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// What shared links and search engines see: the page meta, the schema.org JSON-LD (checked against
// the schema.org vocabulary), robots.txt and the default meta in index.html.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  ROBOTS_DISALLOW,
  funderCard,
  funderMeta,
  headTags,
  imageRouteOf,
  landingMeta,
  opportunityCard,
  opportunityMeta,
  robotsTxt,
  routeOf,
  type FunderPageData,
  type OpportunityPageData,
  type PageMeta,
} from "../src/edge/meta.ts";
import { pngSize } from "../src/edge/og/png.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const ORIGIN = "https://gms.opengrants.io";
const NOW = new Date("2027-04-16T17:00:00Z");

const verified = { handle: "riverbend", name: "Riverbend Community Foundation", mission: "We fund community-led health work across Riverbend County.", website: "https://riverbendcf.example", verificationLevel: "L2", verification: { source: "passport" } };
const unverified = { handle: "cascade", name: "Cascade County Fund", mission: null, website: "https://cascade.example", verificationLevel: null, verification: { source: "self" } };
const money = (amount: string) => ({ amount, currency: "USD" });
const opp = (over: Record<string, unknown> = {}) => ({
  slug: "community-health-2027",
  title: "Community Health Grants 2027",
  description: "Grants for community health navigation in Riverbend County.",
  status: "open",
  funding: { minAwardAmount: money("50000.00"), maxAwardAmount: money("150000.00") },
  keyDates: { closeDate: { name: "Deadline", eventType: "singleDate", date: "2027-04-30" } },
  acceptingApplications: true,
  ...over,
});
const oppPage = (o: Record<string, unknown> = {}, funder: OpportunityPageData["funder"] = verified): OpportunityPageData => ({ funder, opportunity: opp(o), competitions: [{ status: "open" }] });

// ---- schema.org ----
interface Vocab {
  version: string;
  classes: Record<string, string[]>;
  properties: Record<string, { domain: string[]; range: string[]; superseded?: boolean }>;
}
const vocab = JSON.parse(readFileSync(here("./fixtures/schemaorg-30.1-subset.json"), "utf8")) as Vocab;
const isA = (c: string, target: string): boolean => c === target || (vocab.classes[c] ?? []).some((p) => isA(p, target));
const TEXTUAL = ["Text", "URL", "Date", "DateTime", "Time"];
const NUMERIC = ["Number", "Integer", "Float"];

/** Problems with a JSON-LD node: unknown types, properties outside the type's domain, values outside the range. */
function schemaProblems(node: Record<string, unknown>, path = "$"): string[] {
  const type = node["@type"];
  if (typeof type !== "string" || !vocab.classes[type]) return [`${path}: unknown type ${String(type)}`];
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@")) continue;
    const prop = vocab.properties[key];
    const at = `${path}.${key}`;
    if (!prop || !prop.domain.some((d) => isA(type, d))) {
      out.push(`${at}: not a property of ${type}`);
      continue;
    }
    if (prop.superseded) out.push(`${at}: superseded`);
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v && typeof v === "object") {
        const t = (v as Record<string, unknown>)["@type"];
        if (typeof t !== "string" || !prop.range.some((r) => isA(t, r))) out.push(`${at}: ${String(t)} is not in its range (${prop.range.join(", ")})`);
        out.push(...schemaProblems(v as Record<string, unknown>, at));
      } else if (typeof v === "number") {
        if (!prop.range.some((r) => NUMERIC.some((n) => isA(n, r)))) out.push(`${at}: a number is not in its range`);
      } else if (typeof v === "string") {
        const textual = prop.range.some((r) => TEXTUAL.some((x) => isA(x, r)));
        const reference = /^https:\/\//.test(v);
        // A URL may stand for a node of a class range (a reference by address).
        if (!textual && !reference) out.push(`${at}: text is not in its range`);
        if (prop.range.includes("URL") && !prop.range.includes("Text") && !reference) out.push(`${at}: not an absolute https URL`);
      } else out.push(`${at}: unexpected ${typeof v}`);
    }
  }
  return out;
}
const nodes = (m: PageMeta) => m.jsonLd;

describe("routes", () => {
  it("knows the public pages and their share images, and nothing else", () => {
    expect(routeOf("/")).toEqual({ kind: "landing" });
    expect(routeOf("/f/riverbend")).toEqual({ kind: "funder", handle: "riverbend" });
    expect(routeOf("/f/riverbend/")).toEqual({ kind: "funder", handle: "riverbend" });
    expect(routeOf("/f/riverbend/o/community-health-2027")).toEqual({ kind: "opportunity", handle: "riverbend", slug: "community-health-2027" });
    for (const p of ["/signin", "/w/abc", "/f/Riverbend", "/f/a%2Fb", "/f/riverbend/o/x/y", "/f/", "/f/-x"]) expect(routeOf(p), p).toBeNull();
    expect(imageRouteOf("/og/home.png")).toEqual({ kind: "landing" });
    expect(imageRouteOf("/og/f/riverbend.png")).toEqual({ kind: "funder", handle: "riverbend" });
    expect(imageRouteOf("/og/f/riverbend/o/community-health-2027.png")).toEqual({ kind: "opportunity", handle: "riverbend", slug: "community-health-2027" });
    for (const p of ["/og/f/riverbend.jpg", "/og/f/../x.png", "/og/w/x.png"]) expect(imageRouteOf(p), p).toBeNull();
  });
});

describe("page meta", () => {
  it("names an open call, its funder, amount and deadline, with its own card", () => {
    const m = opportunityMeta(oppPage(), ORIGIN, NOW);
    expect(m.title).toBe("Community Health Grants 2027 | Riverbend Community Foundation");
    expect(m.description).toBe("Open for applications until Apr 30, 2027. Awards of $50,000 \u2013 $150,000. Grants for community health navigation in Riverbend County.");
    expect(m.url).toBe(`${ORIGIN}/f/riverbend/o/community-health-2027`);
    expect(m.image).toMatch(/^https:\/\/gms\.opengrants\.io\/og\/f\/riverbend\/o\/community-health-2027\.png\?v=[0-9a-z]+$/);
    // The image address changes when what the card shows changes.
    expect(opportunityMeta(oppPage({ title: "Renamed" }), ORIGIN, NOW).image).not.toBe(m.image);
  });

  it("keeps closed and forecasted calls, with their status in the description", () => {
    expect(opportunityMeta(oppPage({ status: "closed", acceptingApplications: false }), ORIGIN, NOW).description).toMatch(/^Closed to applications\. /);
    expect(opportunityMeta(oppPage({ status: "forecasted", acceptingApplications: false, keyDates: { postDate: { name: "Opens", date: "2027-06-01" } } }), ORIGIN, NOW).description).toMatch(/^Forecasted to open Jun 1, 2027\. /);
    expect(opportunityMeta(oppPage({ acceptingApplications: false }), ORIGIN, NOW).description).toMatch(/^Not taking applications yet\. /);
    expect(opportunityCard(oppPage({ status: "closed", acceptingApplications: false }), "gms.opengrants.io", NOW).status).toEqual({ label: "Closed", tone: "closed" });
    const long = opportunityMeta(oppPage({ description: "word ".repeat(200) }), ORIGIN, NOW).description;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("\u2026")).toBe(true);
  });

  it("describes a funder page by its calls and mission, and says when a funder is not verified", () => {
    const data: FunderPageData = { funder: verified, opportunities: [opp(), opp({ slug: "b", status: "forecasted", acceptingApplications: false }), opp({ slug: "c", status: "closed", acceptingApplications: false })] };
    const m = funderMeta(data, ORIGIN);
    expect(m.title).toBe("Grants from Riverbend Community Foundation");
    expect(m.description).toBe("1 call open for applications, 1 forecasted, 1 closed. We fund community-led health work across Riverbend County.");
    expect(m.url).toBe(`${ORIGIN}/f/riverbend`);
    expect(m.image).toMatch(/^https:\/\/gms\.opengrants\.io\/og\/f\/riverbend\.png\?v=/);
    expect(funderCard(data, "gms.opengrants.io")).toMatchObject({ title: "Riverbend Community Foundation", status: { label: "1 open call", tone: "open" }, note: null });
    expect(funderCard({ funder: unverified, opportunities: [] }, "gms.opengrants.io")).toMatchObject({ status: { label: "No open calls right now", tone: "neutral" }, note: "Not verified with OpenGrants Passport" });
    expect(funderMeta({ funder: unverified, opportunities: [] }, ORIGIN).description).toBe("No calls published yet.");
  });

  it("escapes what it writes into the page", () => {
    const hostile = oppPage({ title: 'Grants "for" <b>you</b> & me', description: "</script><script>alert(1)</script>\u2028" });
    const html = headTags(opportunityMeta(hostile, ORIGIN, NOW));
    expect(html).toContain("content=\"Grants &quot;for&quot; &lt;b&gt;you&lt;/b&gt; &amp; me | Riverbend Community Foundation\"");
    expect(html).not.toContain("<b>");
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const ld = JSON.parse(scripts[0]![1]!) as { description?: string }[];
    expect(ld[0]!.description).toBe("</script><script>alert(1)</script>");
  });

  it("writes every tag a link preview reads", () => {
    const html = headTags(landingMeta(ORIGIN));
    for (const tag of ['name="description"', 'rel="canonical" href="https://gms.opengrants.io/"', 'property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'property="og:type" content="website"', 'property="og:image:width" content="1200"', 'property="og:image:height" content="627"', 'name="twitter:card" content="summary_large_image"', 'name="twitter:image"']) {
      expect(html, tag).toContain(tag);
    }
    expect(landingMeta(ORIGIN)).toMatchObject({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION });
  });
});

describe("structured data", () => {
  it("describes an opportunity as a MonetaryGrant from an Organization, with breadcrumbs", () => {
    const [grant, crumbs] = nodes(opportunityMeta(oppPage(), ORIGIN, NOW));
    expect(grant).toMatchObject({
      "@context": "https://schema.org",
      "@type": "MonetaryGrant",
      name: "Community Health Grants 2027",
      url: `${ORIGIN}/f/riverbend/o/community-health-2027`,
      funder: { "@type": "Organization", name: "Riverbend Community Foundation", url: "https://riverbendcf.example" },
      amount: { "@type": "MonetaryAmount", currency: "USD", minValue: 50000, maxValue: 150000 },
    });
    expect(crumbs).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Riverbend Community Foundation", item: `${ORIGIN}/f/riverbend` },
        { "@type": "ListItem", position: 2, name: "Community Health Grants 2027", item: `${ORIGIN}/f/riverbend/o/community-health-2027` },
      ],
    });
  });

  it("gives only the amounts it knows, and no website for a funder not verified with Passport", () => {
    expect(opportunityMeta(oppPage({ funding: { maxAwardAmount: money("10000") } }), ORIGIN, NOW).description).toContain(" Awards up to $10,000. ");
    const [onlyMax] = nodes(opportunityMeta(oppPage({ funding: { maxAwardAmount: money("10000") } }, unverified), ORIGIN, NOW));
    expect(onlyMax!.amount).toEqual({ "@type": "MonetaryAmount", currency: "USD", maxValue: 10000 });
    expect(onlyMax!.funder).toEqual({ "@type": "Organization", name: "Cascade County Fund" });
    const [none] = nodes(opportunityMeta(oppPage({ funding: {} }), ORIGIN, NOW));
    expect(none).not.toHaveProperty("amount");
    const [org] = nodes(funderMeta({ funder: unverified, opportunities: [] }, ORIGIN));
    expect(org).toEqual({ "@context": "https://schema.org", "@type": "Organization", name: "Cascade County Fund", mainEntityOfPage: `${ORIGIN}/f/cascade` });
  });

  it("uses only schema.org types and properties, each within its range", () => {
    expect(vocab.version).toBe("30.1");
    const all = [
      ...nodes(landingMeta(ORIGIN)),
      ...nodes(funderMeta({ funder: verified, opportunities: [opp()] }, ORIGIN)),
      ...nodes(funderMeta({ funder: unverified, opportunities: [] }, ORIGIN)),
      ...nodes(opportunityMeta(oppPage(), ORIGIN, NOW)),
      ...nodes(opportunityMeta(oppPage({ status: "closed", funding: { minAwardAmount: money("5000") } }, unverified), ORIGIN, NOW)),
    ];
    expect(all.map((n) => n["@type"])).toEqual(["WebSite", "Organization", "Organization", "MonetaryGrant", "BreadcrumbList", "MonetaryGrant", "BreadcrumbList"]);
    for (const n of all) expect(schemaProblems(n), String(n["@type"])).toEqual([]);
    // The checker itself catches a property outside the type and a value outside the range.
    expect(schemaProblems({ "@type": "MonetaryGrant", applicationDeadline: "2027-04-30" })).toEqual(["$.applicationDeadline: not a property of MonetaryGrant"]);
    expect(schemaProblems({ "@type": "MonetaryGrant", funder: { "@type": "MonetaryAmount" } })[0]).toMatch(/not in its range/);
  });
});

/** Google's rule: the longest matching path wins, and Allow wins a tie. */
function allowed(robots: string, path: string): boolean {
  let best = { length: -1, allow: true };
  for (const line of robots.split("\n")) {
    const m = /^(Allow|Disallow):\s*(\S+)/.exec(line);
    if (!m || !path.startsWith(m[2]!)) continue;
    const allow = m[1] === "Allow";
    if (m[2]!.length > best.length || (m[2]!.length === best.length && allow)) best = { length: m[2]!.length, allow };
  }
  return best.allow;
}

describe("robots.txt", () => {
  const robots = robotsTxt(ORIGIN);
  it("lets crawlers read the public pages, their data and their images, and keeps them out of the app", () => {
    for (const p of ["/", "/f/riverbend", "/f/riverbend/o/community-health-2027", "/og/f/riverbend.png", "/gms/public/funders/riverbend", "/sitemap.xml", "/brand/og-preview.png", "/common-grants/opportunities"]) expect(allowed(robots, p), p).toBe(true);
    for (const p of ["/w/abc/home", "/gms/opportunities", "/gms/me", "/signin", "/onboarding/funder/organization", "/onboarding/applicant", "/apply/riverbend/x", "/account/agents", "/embed/f/riverbend/o/x"]) expect(allowed(robots, p), p).toBe(false);
    expect(robots).toContain("Sitemap: https://gms.opengrants.io/sitemap.xml");
    expect(robots.startsWith("#")).toBe(true);
    expect(ROBOTS_DISALLOW).toContain("/w/");
  });
});

describe("index.html defaults", () => {
  const html = readFileSync(here("../index.html"), "utf8");
  it("describe the system without Passport, with the app's name and a 1200x627 card", () => {
    expect(html).not.toMatch(/Passport needed/i);
    expect(html).toContain(`<title>${DEFAULT_TITLE}</title>`);
    expect(html.match(new RegExp(`content="${DEFAULT_DESCRIPTION}"`, "g"))).toHaveLength(3);
    expect(html).toContain('<meta property="og:image:height" content="627" />');
    const png = new Uint8Array(readFileSync(here("../public/brand/og-preview.png")));
    expect(pngSize(png)).toEqual({ width: 1200, height: 627 });
    expect(png.length).toBeLessThan(600 * 1024);
  });
});
