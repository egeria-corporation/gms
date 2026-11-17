// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// What shared links and search engines see for the grants-awarded page and an award's page: the
// routes, the meta, the share card's text, and schema.org JSON-LD checked against the vocabulary
// (MonetaryGrant with its funder and the organization it funds). Hidden amounts stay hidden.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { awardCard, awardMeta, awardsCard, awardsMeta, badgeApiPathOf, badgeRouteOf, imageRouteOf, routeOf, type AwardPageData, type FunderAwardsPageData, type PageMeta } from "../src/edge/meta.ts";
import { loadCardAssets, renderCard } from "../src/edge/og/card.ts";
import { pngSize } from "../src/edge/og/png.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const ORIGIN = "https://gms.opengrants.io";
const verified = { handle: "riverbend", name: "Riverbend Community Foundation", mission: "We fund community-led health work across Riverbend County.", website: "https://riverbendcf.example", verificationLevel: "L2", verification: { source: "passport" } };
const unverified = { handle: "cascade", name: "Cascade County Fund", mission: null, website: "https://cascade.example", verificationLevel: null, verification: { source: "self_declared" } };
const award = (over: Partial<AwardPageData["award"]> = {}): AwardPageData["award"] => ({ slug: "alder-creek-family-services-0123456789ab", recipient: { name: "Alder Creek Family Services" }, purpose: "Mobile Health Navigation", program: "Community Health", year: 2027, awardDate: "2027-03-01", amount: { amount: "150000.00", currency: "USD" }, ...over });
const page = (over: Partial<AwardPageData["award"]> = {}, funder: AwardPageData["funder"] = verified): AwardPageData => ({ funder, award: award(over) });
const list = (awards = [award(), award({ slug: "harbor-light-0123456789ac", recipient: { name: "Harbor Light Shelter" }, year: 2025 })], funder: FunderAwardsPageData["funder"] = verified): FunderAwardsPageData => ({ funder, awards });

// ---- schema.org (as in share-meta.test.ts) ----
interface Vocab {
  classes: Record<string, string[]>;
  properties: Record<string, { domain: string[]; range: string[]; superseded?: boolean }>;
}
const vocab = JSON.parse(readFileSync(here("./fixtures/schemaorg-30.1-subset.json"), "utf8")) as Vocab;
const isA = (c: string, target: string): boolean => c === target || (vocab.classes[c] ?? []).some((p) => isA(p, target));
const TEXTUAL = ["Text", "URL", "Date", "DateTime", "Time"];
const NUMERIC = ["Number", "Integer", "Float"];
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
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v && typeof v === "object") {
        const t = (v as Record<string, unknown>)["@type"];
        if (typeof t !== "string" || !prop.range.some((r) => isA(t, r))) out.push(`${at}: ${String(t)} is not in its range`);
        out.push(...schemaProblems(v as Record<string, unknown>, at));
      } else if (typeof v === "number") {
        if (!prop.range.some((r) => NUMERIC.some((n) => isA(n, r)))) out.push(`${at}: a number is not in its range`);
      } else if (typeof v === "string") {
        if (!prop.range.some((r) => TEXTUAL.some((x) => isA(x, r))) && !/^https:\/\//.test(v)) out.push(`${at}: text is not in its range`);
      } else out.push(`${at}: unexpected ${typeof v}`);
    }
  }
  return out;
}
const valid = (m: PageMeta) => m.jsonLd.flatMap((n) => schemaProblems(n));

describe("routes", () => {
  it("knows the grants-awarded page, award pages, their cards and the badge", () => {
    expect(routeOf("/f/riverbend/awards")).toEqual({ kind: "awards", handle: "riverbend" });
    expect(routeOf("/f/riverbend/awards/")).toEqual({ kind: "awards", handle: "riverbend" });
    expect(routeOf("/f/riverbend/awards/alder-creek-0123456789ab")).toEqual({ kind: "award", handle: "riverbend", slug: "alder-creek-0123456789ab" });
    for (const p of ["/f/riverbend/awards/x/y", "/f/riverbend/awards/X", "/f/riverbend/award"]) expect(routeOf(p), p).toBeNull();
    // The funder and opportunity pages are as they were.
    expect(routeOf("/f/riverbend")).toEqual({ kind: "funder", handle: "riverbend" });
    expect(routeOf("/f/riverbend/o/awards")).toEqual({ kind: "opportunity", handle: "riverbend", slug: "awards" });
    expect(imageRouteOf("/og/f/riverbend/awards.png")).toEqual({ kind: "awards", handle: "riverbend" });
    expect(imageRouteOf("/og/f/riverbend/awards/alder-creek-0123456789ab.png")).toEqual({ kind: "award", handle: "riverbend", slug: "alder-creek-0123456789ab" });
    expect(badgeRouteOf("/badge/alder-creek-0123456789ab.svg")).toBe("alder-creek-0123456789ab");
    for (const p of ["/badge/../x.svg", "/badge/A.svg", "/badge/x.png", "/badge/a/b.svg"]) expect(badgeRouteOf(p), p).toBeNull();
    expect(badgeApiPathOf("alder-creek-0123456789ab")).toBe("/gms/public/badges/alder-creek-0123456789ab.svg");
  });
});

describe("award page meta", () => {
  it("says who awarded whom, the amount and what for, with valid MonetaryGrant data", () => {
    const m = awardMeta(page(), ORIGIN);
    expect(m.title).toBe("Riverbend Community Foundation awarded Alder Creek Family Services a grant");
    expect(m.description).toBe("A $150,000 grant awarded in 2027 through Community Health, for “Mobile Health Navigation”.");
    expect(m.url).toBe(`${ORIGIN}/f/riverbend/awards/alder-creek-family-services-0123456789ab`);
    expect(m.image).toMatch(new RegExp(`^${ORIGIN}/og/f/riverbend/awards/alder-creek-family-services-0123456789ab\\.png\\?v=[0-9a-z]+$`));
    expect(m.jsonLd[0]).toMatchObject({ "@type": "MonetaryGrant", funder: { "@type": "Organization", name: "Riverbend Community Foundation", url: "https://riverbendcf.example" }, fundedItem: { "@type": "Organization", name: "Alder Creek Family Services" }, amount: { "@type": "MonetaryAmount", currency: "USD", value: 150000 } });
    expect(valid(m)).toEqual([]);
  });

  it("leaves the amount out everywhere when the funder hides it", () => {
    const d = page({ amount: null });
    const m = awardMeta(d, ORIGIN);
    expect(JSON.stringify(m)).not.toContain("150");
    expect(m.jsonLd[0]).not.toHaveProperty("amount");
    expect(m.description).toBe("A grant awarded in 2027 through Community Health, for “Mobile Health Navigation”.");
    expect(awardCard(d, "gms.opengrants.io").amount).toBeNull();
    expect(valid(m)).toEqual([]);
  });

  it("does not present an unverified funder as verified", () => {
    const d = page({}, unverified);
    expect(awardCard(d, "gms.opengrants.io").note).toBe("Not verified with OpenGrants Passport");
    expect(awardCard(page(), "gms.opengrants.io").note).toBeNull();
    // A self-declared website is its own word: not on the Organization.
    expect(awardMeta(d, ORIGIN).jsonLd[0]).toMatchObject({ funder: { "@type": "Organization", name: "Cascade County Fund" } });
    expect((awardMeta(d, ORIGIN).jsonLd[0] as { funder: Record<string, unknown> }).funder).not.toHaveProperty("url");
  });

  it("draws a 1200x627 card with the headline", async () => {
    const card = awardCard(page(), "gms.opengrants.io");
    expect(card).toMatchObject({ eyebrow: "Grant awarded", title: "Riverbend Community Foundation awarded Alder Creek Family Services a grant", detail: "Mobile Health Navigation", amount: "$150,000", status: { label: "Awarded 2027" } });
    const read = (p: string) => {
      try {
        return new Uint8Array(readFileSync(here(`../public${p}`)));
      } catch {
        return null;
      }
    };
    const png = await renderCard(card, await loadCardAssets(read));
    expect(pngSize(png)).toEqual({ width: 1200, height: 627 });
  });
});

describe("grants-awarded page meta", () => {
  it("names the funder, how many grants and the years, as a schema.org list", () => {
    const m = awardsMeta(list(), ORIGIN);
    expect(m.title).toBe("Grants awarded by Riverbend Community Foundation");
    expect(m.description).toBe("2 grants awarded from 2025 to 2027. We fund community-led health work across Riverbend County.");
    expect(m.jsonLd[0]).toMatchObject({ "@type": "ItemList", numberOfItems: 2, itemListElement: [{ position: 1, url: `${ORIGIN}/f/riverbend/awards/alder-creek-family-services-0123456789ab` }, { position: 2, name: "Riverbend Community Foundation awarded Harbor Light Shelter a grant" }] });
    expect(valid(m)).toEqual([]);
    expect(awardsCard(list(), "gms.opengrants.io")).toMatchObject({ eyebrow: "Grants awarded by", title: "Riverbend Community Foundation", status: { label: "2 grants listed" } });
    expect(awardsCard(list([]), "gms.opengrants.io").status).toEqual({ label: "No grants listed yet", tone: "neutral" });
    expect(awardsMeta(list([award()]), ORIGIN).description).toMatch(/^1 grant awarded in 2027\./);
  });
});
