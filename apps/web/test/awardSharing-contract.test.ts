// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.9.0), one scenario on two backends: the web HTTP client (api/awardSharing.ts)
// against the real API Worker in-process, and the in-browser mock. The same assertions run on both,
// on the fields the screens read, so the e2e flow in mock mode proves what a real install does.
// v1.12.0: the federal share statement, the press release's credit, the carousel and the pages to tag.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { createHttpAwardSharingApi, type AwardSharingApi } from "../src/api/awardSharing.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { createMockAwardSharingApi, seedAwardSharingStore } from "../src/mocks/awardSharing.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

const WS_APPLICANT = "33333333-3333-4333-8333-333333333333";
const GRANTEE_ADMIN = "12121212-1212-4121-8121-121212121212";

interface Backend {
  funder: AwardSharingApi;
  grantee: AwardSharingApi;
  anon: AwardSharingApi;
  funderAwardId: string;
  granteeAwardId: string;
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

async function http(): Promise<Backend> {
  const helpers = await loadApi();
  const h: ApiHarness = await helpers.harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  const award = await h.repos.table("awards").insert({ workspace_id: helpers.WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile Health Navigation for Rural Families", status: "accepted", funding: { awardedAmount: { amount: "150000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-05-18" } } });
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const port = (userId: string | null, workspaceId: string | null) => createHttpAwardSharingApi({ baseUrl: helpers.BASE, token: async () => (userId ? h.session(userId) : null), workspaceId: () => workspaceId, fetch: fetchInProcess });
  const id = `awd_${award.id as string}`;
  return { funder: port(helpers.USER_ADMIN, helpers.WS_FUNDER), grantee: port(GRANTEE_ADMIN, WS_APPLICANT), anon: port(null, null), funderAwardId: id, granteeAwardId: id };
}

function mock(): Backend {
  const store = seedAwardSharingStore();
  const gms = createMockApi({ session: async () => demoSession() });
  const funder = async (handle: string) => (await gms.publicFunder(handle)).funder;
  const port = (ws: { id: string; kind: "funder" | "applicant"; handle: string; role: string } | null) => createMockAwardSharingApi({ store, workspace: () => ws, funder });
  return {
    funder: port({ id: "riverbend", kind: "funder", handle: "riverbend", role: "admin" }),
    grantee: port({ id: "alder-creek", kind: "applicant", handle: "alder-creek", role: "admin" }),
    anon: port(null),
    funderAwardId: MOCK_IDS.award,
    granteeAwardId: "awd_a0000000-0000-7000-8000-000000000001",
  };
}

describe.each([
  ["the HTTP client against the API", http],
  ["the mock", async () => mock()],
] as const)("award sharing on %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("keeps everything off the public pages until the funder lists awards", async () => {
    expect(await status(b.anon.funderAwards("riverbend"))).toBe(404);
    const panel = await b.funder.sharing(b.funderAwardId, "funder");
    expect(panel).toMatchObject({ listed: false, reason: "listing_off", listingOn: false, kit: null, canChange: true });
    expect((await b.funder.settings()).listAwards).toBe(false);
  });

  it("lists the award, gives both sides a kit and a public page, and hides amounts on request", async () => {
    const on = await b.funder.updateSettings({ listAwards: true });
    expect(on).toMatchObject({ listAwards: true, showAmounts: true });
    const page = await b.anon.funderAwards("riverbend");
    expect(page.awards.map((a) => [a.recipient.name, a.purpose, a.amount?.amount])).toEqual([["Alder Creek Family Services", "Mobile Health Navigation for Rural Families", "150000.00"]]);
    const slug = page.awards[0]!.slug;
    expect(slug).toMatch(/^alder-creek-family-services-[a-z0-9]{12}$/);
    const one = await b.anon.awardPage("riverbend", slug);
    expect(one).toMatchObject({ verified: true, award: { slug }, funder: { handle: "riverbend", name: "Riverbend Community Foundation" } });

    const funderKit = (await b.funder.sharing(b.funderAwardId, "funder")).kit!;
    expect(funderKit.posts.linkedin).toContain("We are proud to support Alder Creek Family Services with a $150,000 grant");
    const granteeKit = (await b.grantee.sharing(b.granteeAwardId, "grantee")).kit!;
    expect(granteeKit.posts.short).toMatch(/^Thank you, Riverbend Community Foundation, for a \$150,000 grant for “Mobile Health Navigation for Rural Families”\. \S+\/f\/riverbend\/awards\/alder-creek-family-services-[a-z0-9]{12}$/);
    expect(granteeKit.badge).toMatchObject({ verified: true, text: "Funded by Riverbend Community Foundation · verified" });
    expect(granteeKit.badge.svg).toMatch(/^<svg /);
    expect(granteeKit.badge.snippet).toContain(`/badge/${slug}.svg`);

    await b.funder.updateSettings({ showAmounts: false });
    expect((await b.anon.funderAwards("riverbend")).awards[0]!.amount).toBeNull();
    expect(JSON.stringify((await b.grantee.sharing(b.granteeAwardId, "grantee")).kit)).not.toContain("150,000");
    await b.funder.updateSettings({ showAmounts: true });
  });

  it("drops the award when the grantee opts out or the funder makes it confidential", async () => {
    const off = await b.grantee.setUnlisted(b.granteeAwardId, true);
    expect(off).toMatchObject({ listed: false, reason: "recipient_unlisted", recipientUnlisted: true, kit: null });
    expect((await b.anon.funderAwards("riverbend")).awards).toEqual([]);
    expect((await b.funder.sharing(b.funderAwardId, "funder")).reason).toBe("recipient_unlisted");
    await b.grantee.setUnlisted(b.granteeAwardId, false);

    const secret = await b.funder.setConfidential(b.funderAwardId, true);
    expect(secret).toMatchObject({ listed: false, reason: "confidential", confidential: true, kit: null });
    expect((await b.anon.funderAwards("riverbend")).awards).toEqual([]);
    expect((await b.grantee.sharing(b.granteeAwardId, "grantee")).reason).toBe("confidential");
    expect((await b.funder.settings()).counts).toMatchObject({ listed: 0, confidential: 1 });
    await b.funder.setConfidential(b.funderAwardId, false);
    expect((await b.anon.funderAwards("riverbend")).awards).toHaveLength(1);
  });

  it("adds the federal statement only with both numbers, credits the funder, and tags only with consent (v1.12.0)", async () => {
    const statement = "This project is supported with federal funds as part of a financial assistance award totaling $80,000, with 62.5 percent of the project's total costs funded with federal money. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, the U.S. Government.";
    let panel = await b.funder.setFederalFunding(b.funderAwardId, { federallyFunded: true, amount: "80000" });
    expect(panel.federal).toMatchObject({ funded: true, amount: "80000.00", percent: null, statement: null, canChange: true });
    expect(panel.kit!.federalStatement).toBeNull();
    panel = await b.funder.setFederalFunding(b.funderAwardId, { federallyFunded: true, percent: 62.5 });
    expect(panel.federal.statement).toBe(statement);
    const g = await b.grantee.sharing(b.granteeAwardId, "grantee");
    expect(g.federal).toMatchObject({ funded: true, statement, canChange: false });
    expect(g.kit!.federalStatement).toBe(statement);
    expect(g.kit!.pressRelease).toContain(statement);
    expect(await status(b.grantee.setFederalFunding(b.granteeAwardId, { federallyFunded: false }))).toBe(403);

    const kit = (await b.funder.sharing(b.funderAwardId, "funder")).kit!;
    expect(kit.creditLine).toBe("Funded by Riverbend Community Foundation");
    expect(kit.pressRelease.split("\n\n").slice(0, 2)).toEqual(["Riverbend Community Foundation awards a grant to Alder Creek Family Services", "FOR IMMEDIATE RELEASE"]);
    expect(kit.pressRelease).toContain("The project is funded by Riverbend Community Foundation.");
    expect(kit.pressRelease).not.toMatch(/sponsor/i);
    // Cover, what it funds, the grantee, the amount, the funder, the federal share, thanks, learn more.
    expect(kit.carousel.pages).toHaveLength(8);
    expect(kit.carousel.pages[5]).toEqual({ heading: "The federal share of costs", alt: `Slide 6 of 8: The federal share of costs. ${statement}` });
    const pdf = new TextDecoder("latin1").decode(new Uint8Array(await (await b.funder.carouselPdf(kit.carousel.path)).arrayBuffer()));
    expect([...pdf.matchAll(/\/Type \/Page\b[\s\S]*?\/MediaBox \[ ?0 0 1080 1350 ?\]/g)]).toHaveLength(8);
    expect(kit.portrait).toMatchObject({ funder: "Riverbend Community Foundation", recipient: "Alder Creek Family Services", amount: { amount: "150000.00", currency: "USD" } });

    // The funder chooses "supported by"; the grantee shares its page, then agrees to be tagged.
    expect(await b.funder.updateShareProfile({ creditWording: "supported_by" })).toMatchObject({ creditWording: "supported_by", canChange: true });
    expect((await b.funder.sharing(b.funderAwardId, "funder")).kit!.pressRelease).toContain("The project is supported by Riverbend Community Foundation.");
    expect(await b.grantee.updateShareProfile({ pageUrl: "https://linkedin.com/company/alder-creek-family-services" })).toMatchObject({ pageUrl: "https://www.linkedin.com/company/alder-creek-family-services", tagConsent: false });
    expect((await b.funder.sharing(b.funderAwardId, "funder")).kit!.tags.grantee).toBeNull();
    await b.grantee.updateShareProfile({ tagConsent: true });
    expect((await b.funder.sharing(b.funderAwardId, "funder")).kit!.tags.grantee).toEqual({ name: "Alder Creek Family Services", url: "https://www.linkedin.com/company/alder-creek-family-services", platform: "linkedin", handle: "@alder-creek-family-services" });
    expect(await status(b.grantee.updateShareProfile({ pageUrl: "https://linkedin.com/in/a-person" }))).toBe(422);
    expect(await status(b.grantee.updateShareProfile({ creditWording: "supported_by" }))).toBe(422);

    // Unmarking clears the numbers.
    panel = await b.funder.setFederalFunding(b.funderAwardId, { federallyFunded: false });
    expect(panel.federal).toMatchObject({ funded: false, amount: null, percent: null, source: null, statement: null });
    await b.funder.updateShareProfile({ creditWording: "funded_by" });
  });

  it("keeps each side to its own switch", async () => {
    expect(await status(b.grantee.setConfidential(b.granteeAwardId, true))).toBe(403);
    expect(await status(b.funder.setUnlisted(b.funderAwardId, true))).toBe(403);
    expect(await status(b.grantee.updateSettings({ listAwards: false }))).toBe(403);
  });
});
