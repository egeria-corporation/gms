// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.8.0), one scenario on two backends: the web HTTP client (api/awardSharing.ts)
// against the real API Worker in-process, and the in-browser mock. The same assertions run on both,
// on the fields the screens read, so the e2e flow in mock mode proves what a real install does.
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

  it("keeps each side to its own switch", async () => {
    expect(await status(b.grantee.setConfidential(b.granteeAwardId, true))).toBe(403);
    expect(await status(b.funder.setUnlisted(b.funderAwardId, true))).toBe(403);
    expect(await status(b.grantee.updateSettings({ listAwards: false }))).toBe(403);
  });
});
