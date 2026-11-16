// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The share cards follow the page's language (`?lang=es`, docs/i18n.md): their fixed words in
// Spanish, what the funder wrote as written, and an image address of their own so a Spanish page
// never shows the English card. English cards draw exactly as before.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCatalogs } from "@gms/i18n";
import { beforeAll, describe, expect, it } from "vitest";
import { awardCard, awardMeta, awardsCard, funderCard, funderMeta, landingCard, landingMeta, opportunityCard, opportunityMeta, type AwardPageData, type FunderAwardsPageData, type FunderPageData, type OpportunityPageData } from "../src/edge/meta.ts";
import { Font } from "../src/edge/og/font.ts";

const ORIGIN = "https://gms.opengrants.io";
const SITE = "gms.opengrants.io";
const NOW = new Date("2027-04-16T17:00:00Z");
const verified = { handle: "riverbend", name: "Riverbend Community Foundation", mission: "We fund community-led health work.", website: "https://riverbendcf.example", verificationLevel: "L2", verification: { source: "passport" } };
const unverified = { handle: "cascade", name: "Cascade County Fund", mission: null, website: null, verificationLevel: null, verification: { source: "self" } };
const money = (amount: string) => ({ amount, currency: "USD" });
const opp = { slug: "health-2027", title: "Community Health Grants 2027", description: "Health navigation.", status: "open", funding: { minAwardAmount: money("50000.00"), maxAwardAmount: money("150000.00") }, keyDates: { closeDate: { name: "Deadline", date: "2027-04-30" } }, acceptingApplications: true };
const funderPage = (funder = verified): FunderPageData => ({ funder, opportunities: [opp, { ...opp, slug: "b" }] }) as unknown as FunderPageData;
const oppPage = (funder = unverified): OpportunityPageData => ({ funder, opportunity: opp, competitions: [{ status: "open" }] }) as unknown as OpportunityPageData;
const awardsPage: FunderAwardsPageData = { funder: verified, awards: [{ slug: "a", year: 2026 }] } as unknown as FunderAwardsPageData;
const awardPage: AwardPageData = { funder: unverified, award: { slug: "a", year: 2026, purpose: "Mobile clinics", amount: money("25000.00"), program: null, recipient: { name: "Alder Creek Family Services" } } } as unknown as AwardPageData;

beforeAll(async () => {
  await loadCatalogs("es", ["public", "shared"]);
});

describe("share cards in Spanish", () => {
  it("draw their fixed words in Spanish and the funder's words as written", () => {
    expect(funderCard(funderPage(), SITE, "es")).toMatchObject({ eyebrow: "Subvenciones de", title: "Riverbend Community Foundation", detail: "We fund community-led health work.", status: { label: "2 convocatorias abiertas", tone: "open" }, note: null });
    const o = opportunityCard(oppPage(), SITE, NOW, "es");
    expect(o.note).toBe("No verificado con OpenGrants Passport");
    expect(o.title).toBe("Community Health Grants 2027");
    expect(o.status!.label).not.toMatch(/Apply|Open/);
    expect(awardsCard(awardsPage, SITE, "es")).toMatchObject({ eyebrow: "Subvenciones otorgadas por", status: { label: "1 subvención publicada" } });
    const a = awardCard(awardPage, SITE, "es");
    expect(a).toMatchObject({ eyebrow: "Subvención otorgada", detail: "Mobile clinics", status: { label: "Otorgada en 2026" }, note: "No verificado con OpenGrants Passport" });
    expect(a.title).toContain("Alder Creek Family Services");
    expect(a.title).not.toContain("awarded");
    expect(landingCard(SITE, "es").detail).toBe("Un sistema gratuito y de código abierto. Regístrese con su correo electrónico.");
  });

  it("stay as they were in English", () => {
    expect(funderCard(funderPage(), SITE)).toMatchObject({ eyebrow: "Grants from", status: { label: "2 open calls" } });
    expect(awardsCard(awardsPage, SITE)).toMatchObject({ eyebrow: "Grants awarded by", status: { label: "1 grant listed" } });
    expect(awardCard(awardPage, SITE)).toMatchObject({ eyebrow: "Grant awarded", title: "Cascade County Fund awarded Alder Creek Family Services a grant", status: { label: "Awarded 2026" }, note: "Not verified with OpenGrants Passport" });
    expect(landingCard(SITE)).toMatchObject({ title: "Run grant programs, apply for grants and manage awards.", detail: "One free, open-source system. Sign up with your email." });
  });

  it("are asked for with the page's language, so the Spanish page shows the Spanish card", () => {
    for (const [es, en] of [
      [funderMeta(funderPage(), ORIGIN, "es"), funderMeta(funderPage(), ORIGIN)],
      [opportunityMeta(oppPage(), ORIGIN, NOW, "es"), opportunityMeta(oppPage(), ORIGIN, NOW)],
      [awardMeta(awardPage, ORIGIN, "es"), awardMeta(awardPage, ORIGIN)],
      [landingMeta(ORIGIN, "es"), landingMeta(ORIGIN)],
    ] as const) {
      expect(es.image).toMatch(/\.png\?lang=es&v=[0-9a-z]+$/);
      expect(en.image).toMatch(/\.png\?v=[0-9a-z]+$/);
      expect(es.image.replace("lang=es&", "")).not.toBe(en.image);
    }
  });

  it("have the glyphs Spanish needs in the bundled fonts", () => {
    const pub = (p: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../public${p}`, import.meta.url))));
    for (const file of ["/fonts/Ubuntu-Bold.ttf", "/fonts/Lato-Regular.ttf", "/fonts/Lato-Bold.ttf"]) {
      const font = new Font(pub(file));
      for (const ch of "áéíóúüñÁÉÍÓÚÑ¿¡«»") expect(font.glyph(ch.codePointAt(0)!), `${file} ${ch}`).toBeGreaterThan(0);
    }
  });
});
