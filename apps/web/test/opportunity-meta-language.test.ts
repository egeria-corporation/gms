// SPDX-License-Identifier: AGPL-3.0-only
// The opportunity page's meta and share card on `?lang=es` (docs/forms.md, "Languages"): the
// funder's reviewed Spanish title and summary where it gave them, its own text otherwise; English
// reads exactly as before.
import { describe, expect, it } from "vitest";
import { cardVersion, opportunityCard, opportunityMeta, opportunityTextIn, type OpportunityPageData } from "../src/edge/meta.ts";

const ORIGIN = "https://gms.opengrants.io";
const NOW = new Date("2027-04-16T17:00:00Z");
const funder = { handle: "riverbend", name: "Riverbend Community Foundation", mission: null, website: null, verificationLevel: "L2", verification: { source: "passport" } };
const page = (translations?: OpportunityPageData["opportunity"]["translations"]): OpportunityPageData => ({
  funder,
  opportunity: {
    slug: "community-health-2027",
    title: "Community Health Grants 2027",
    description: "Grants for community health navigation in Riverbend County.",
    status: "open",
    funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
    keyDates: { closeDate: { name: "Deadline", date: "2027-04-30" } },
    acceptingApplications: true,
    ...(translations ? { translations } : {}),
  },
  competitions: [{ status: "open" }],
});
const SPANISH = { es: { title: "Subvenciones de Salud Comunitaria 2027", description: "Subvenciones para la navegación de salud comunitaria en el condado de Riverbend." } };

describe("opportunity meta in the funder's Spanish", () => {
  it("uses the Spanish title and summary on ?lang=es", () => {
    const m = opportunityMeta(page(SPANISH), ORIGIN, NOW, "es");
    expect(m.title).toBe("Subvenciones de Salud Comunitaria 2027 | Riverbend Community Foundation");
    expect(m.description).toContain("Subvenciones para la navegación de salud comunitaria");
    expect(m.description).not.toContain("Grants for community health");
    expect(m.imageAlt.startsWith("Subvenciones de Salud Comunitaria 2027.")).toBe(true);
    expect(m.jsonLd[0]).toMatchObject({ name: "Subvenciones de Salud Comunitaria 2027", description: SPANISH.es.description });
    expect(m.locale).toBe("es");
    expect(m.image).toContain("lang=es");
  });

  it("the share card takes the Spanish title, and a new version when it changes", () => {
    const es = opportunityCard(page(SPANISH), "gms.opengrants.io", NOW, "es");
    expect(es.title).toBe("Subvenciones de Salud Comunitaria 2027");
    expect(cardVersion(es)).not.toBe(cardVersion(opportunityCard(page(), "gms.opengrants.io", NOW, "es")));
  });

  it("English reads as before, and Spanish without a translation keeps the funder's text", () => {
    expect(opportunityMeta(page(SPANISH), ORIGIN, NOW, "en")).toEqual(opportunityMeta(page(), ORIGIN, NOW, "en"));
    expect(opportunityMeta(page(), ORIGIN, NOW, "es").title).toBe("Community Health Grants 2027 | Riverbend Community Foundation");
    // Only the title translated: the summary stays as the funder wrote it.
    expect(opportunityTextIn(page({ es: { title: "Subvenciones" } }).opportunity, "es")).toEqual({ title: "Subvenciones", description: "Grants for community health navigation in Riverbend County." });
  });
});
