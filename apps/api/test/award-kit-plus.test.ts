// SPDX-License-Identifier: AGPL-3.0-only
// The award kit, plus (v1.12.0): the federal share statement appears only with both numbers; the
// press release credits "funded by" or "supported by" and never "sponsored"; the carousel is 6 to 10
// pages of 1080 × 1350 with each page's alt text; the portrait card hides the amount the funder hides;
// each side's page is tagged only with its consent; "Meet our grantees" lists only what may be
// public; every change is a signed-in person's.
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/errors.ts";
import * as sharing from "../src/services/award-sharing.ts";
import { makeActor, type ServiceContext } from "../src/services/context.ts";
import { BASE, CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
/** The page sizes of a PDF written without object streams (as @gms/documents writes them). */
const pageSizes = async (res: Response) => {
  const text = new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer()));
  return [...text.matchAll(/\/Type \/Page\b[\s\S]*?\/MediaBox \[ ?0 0 (\d+) (\d+) ?\]/g)].map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
};
const GRANTEE_ADMIN = "48484848-4848-4484-8484-484848484848";
const SECOND_GRANTEE = "48484848-4848-4484-8484-4848484848a2";
const SECOND_ADMIN = "48484848-4848-4484-8484-4848484848a3";
const PROGRAM = "48484848-4848-4484-8484-4848484848d1";
const OTHER_PROGRAM = "48484848-4848-4484-8484-4848484848d2";

async function setup() {
  const h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  await h.repos.table("workspaces").insert({ id: SECOND_GRANTEE, kind: "applicant", handle: "valley-food-bank", display_name: "Valley Food Bank" });
  await h.repos.table("workspace_members").insert({ workspace_id: SECOND_GRANTEE, user_id: SECOND_ADMIN, role: "admin" });
  await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community Health 2027" });
  await h.repos.table("programs").insert({ id: OTHER_PROGRAM, workspace_id: WS_FUNDER, name: "Arts 2027" });
  const award = (title: string, extra: Record<string, unknown> = {}) =>
    h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", funding: { awardedAmount: { amount: "150000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-05-18" } }, program_id: PROGRAM, ...extra } as never);
  const listed = await award("Mobile Health Navigation for Rural Families");
  const who = async (userId: string, ws: string): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
  const s = { h, listed, admin: await who(USER_ADMIN, WS_FUNDER), officer: await who(USER_OFFICER, WS_FUNDER), auditor: await who(USER_AUDITOR, WS_FUNDER), grantee: await who(GRANTEE_ADMIN, WS_APPLICANT), second: await who(SECOND_ADMIN, SECOND_GRANTEE) };
  // The funder lists its awards.
  expect((await put(s, "/gms/award-sharing/settings", s.admin, { listAwards: true })).status).toBe(200);
  return { ...s, award };
}
type S = Awaited<ReturnType<typeof setup>>;

const get = (s: S, path: string, headers?: H) => s.h.request(path, headers ? { headers } : undefined);
const put = (s: { h: Harness }, path: string, headers: H, body: unknown) => s.h.request(path, { method: "PUT", headers, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const awd = (id: string) => `awd_${id}`;
const panel = async (s: S, side: "funder" | "grantee" = "funder", id = s.listed.id, headers?: H) => data<sharing.AwardSharing>(await get(s, side === "funder" ? `/gms/awards/${awd(id)}/sharing` : `/gms/my/awards/${awd(id)}/sharing`, headers ?? (side === "funder" ? s.officer : s.grantee)));
const federal = (s: S, body: unknown, headers?: H) => put(s, `/gms/awards/${awd(s.listed.id)}/federal-funding`, headers ?? s.officer, body);

describe("the federal share statement", () => {
  it("appears only once both the amount and the percentage are entered", async () => {
    const s = await setup();
    expect((await panel(s)).federal).toMatchObject({ funded: false, amount: null, percent: null, statement: null, canChange: true });
    expect((await panel(s)).kit!.federalStatement).toBeNull();

    // Marked, with the amount only: no statement, nothing guessed.
    let res = await federal(s, { federallyFunded: true, amount: "80000" });
    expect(res.status).toBe(200);
    let p = await data<sharing.AwardSharing>(res);
    expect(p.federal).toMatchObject({ funded: true, amount: "80000.00", percent: null, statement: null });
    expect(p.kit!.federalStatement).toBeNull();
    expect(p.kit!.pressRelease).not.toMatch(/federal/i);

    // The percentage alone: still none.
    p = await data<sharing.AwardSharing>(await federal(s, { federallyFunded: true, amount: null, percent: 62.5 }));
    expect(p.federal).toMatchObject({ amount: null, percent: 62.5, statement: null });

    // Both: the statement, in the kit, the press release and the carousel.
    p = await data<sharing.AwardSharing>(await federal(s, { federallyFunded: true, amount: "80000", percent: 62.5 }));
    expect(p.federal.statement).toBe("This project is supported with federal funds as part of a financial assistance award totaling $80,000, with 62.5 percent of the project's total costs funded with federal money. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, the U.S. Government.");
    expect(p.kit!.federalStatement).toBe(p.federal.statement);
    expect(p.kit!.pressRelease).toContain(p.federal.statement!);
    expect(p.kit!.carousel.pages.map((x) => x.heading)).toContain("The federal share of costs");

    // With the agency named, as HHS's sample statement names it.
    p = await data<sharing.AwardSharing>(await federal(s, { federallyFunded: true, source: "the Administration for Children and Families (ACF) of the U.S. Department of Health and Human Services (HHS)" }));
    expect(p.federal.statement).toMatch(/^This project is supported by the Administration for Children and Families \(ACF\) of the U\.S\. Department of Health and Human Services \(HHS\) as part of a financial assistance award totaling \$80,000, with 62\.5 percent/);

    // The grantee reads it, in Spanish too, and cannot change it.
    const g = await data<sharing.AwardSharing>(await get(s, `/gms/my/awards/${awd(s.listed.id)}/sharing?lang=es`, s.grantee));
    expect(g.federal).toMatchObject({ funded: true, canChange: false });
    expect(g.federal.statement).toMatch(/^Este proyecto cuenta con el apoyo de .* subvención federal de (US)?\$80,000, que cubre el 62[.,]5 por ciento del costo total del proyecto\./);
    expect((await federal(s, { federallyFunded: false }, s.grantee)).status).toBe(403);

    // Unmarking clears the numbers.
    p = await data<sharing.AwardSharing>(await federal(s, { federallyFunded: false }));
    expect(p.federal).toMatchObject({ funded: false, amount: null, percent: null, source: null, statement: null });
    const ledger = await s.h.ledger.list({ workspaceId: WS_FUNDER, eventType: "award.federal_funding_changed" });
    expect(ledger.length).toBe(5);
  });

  it("refuses numbers out of range, agents and roles that may not change it", async () => {
    const s = await setup();
    for (const body of [{ federallyFunded: true, percent: 0 }, { federallyFunded: true, percent: 100.5 }, { federallyFunded: true, percent: 33.333 }, { federallyFunded: true, amount: "0" }, { federallyFunded: true, amount: "-5" }, { federallyFunded: true, amount: "1,000" }, { federallyFunded: true, guessed: 50 }]) {
      expect((await federal(s, body)).status).toBe(400);
    }
    expect((await federal(s, { federallyFunded: true, amount: "1000" }, s.auditor)).status).toBe(403);
    const client = { ...bearer(await clientCredentialsToken(s.h, "workspace:admin awards:read")).headers, "Content-Type": "application/json" };
    expect((await federal(s, { federallyFunded: true, amount: "1000" }, client)).status).toBe(403);
    const agent = ctx(s.h, "delegated", USER_ADMIN, WS_FUNDER, "funder", "admin", ["awards:read", "awards:write", "workspace:admin"]);
    await expect(sharing.setFederalFunding(agent, s.listed.id, { federallyFunded: true, amount: "1000" })).rejects.toMatchObject({ code: "human_only" });
    expect((await panel(s)).federal.funded).toBe(false);
  });
});

describe("the press release", () => {
  it("credits the funder with \"funded by\" or \"supported by\", never \"sponsored\", with its description", async () => {
    const s = await setup();
    let kit = (await panel(s)).kit!;
    expect(kit.creditLine).toBe("Funded by Riverbend Community Foundation");
    expect(kit.pressRelease.split("\n\n").slice(0, 4)).toEqual([
      "Riverbend Community Foundation awards a grant to Alder Creek Family Services",
      "FOR IMMEDIATE RELEASE",
      "May 18, 2027: Riverbend Community Foundation has awarded Alder Creek Family Services a grant of $150,000 through its Community Health 2027 program. The grant funds “Mobile Health Navigation for Rural Families”.",
      "The project is funded by Riverbend Community Foundation.",
    ]);
    expect(kit.pressRelease).toContain("[Add a short description of Riverbend Community Foundation.]");
    expect(kit.pressRelease).not.toMatch(/sponsor/i);

    const res = await put(s, "/gms/share-kit/profile", s.admin, { creditWording: "supported_by", standardDescription: "Riverbend Community Foundation funds community health across the valley." });
    expect(res.status).toBe(200);
    kit = (await panel(s)).kit!;
    expect(kit.creditLine).toBe("Supported by Riverbend Community Foundation");
    expect(kit.pressRelease).toContain("The project is supported by Riverbend Community Foundation.");
    expect(kit.pressRelease).toContain("About Riverbend Community Foundation\n\nRiverbend Community Foundation funds community health across the valley.");
    expect(kit.pressRelease).not.toMatch(/funded by|sponsor/i);

    // The grantee's release, from its side, with the funder's wording.
    const g = (await panel(s, "grantee")).kit!;
    expect(g.pressRelease.split("\n\n")[0]).toBe("Alder Creek Family Services receives a grant from Riverbend Community Foundation");
    expect(g.pressRelease).toContain("Alder Creek Family Services has received a grant of $150,000 from Riverbend Community Foundation");
    expect(g.pressRelease).toContain("The project is supported by Riverbend Community Foundation.");

    // "Sponsored" cannot be chosen.
    expect((await put(s, "/gms/share-kit/profile", s.admin, { creditWording: "sponsored_by" })).status).toBe(400);
    // Hidden amounts stay hidden in the release.
    await put(s, "/gms/award-sharing/settings", s.admin, { showAmounts: false });
    kit = (await panel(s)).kit!;
    expect(kit.pressRelease).toContain("has awarded Alder Creek Family Services a grant through its Community Health 2027 program");
    expect(kit.pressRelease).not.toContain("$150,000");
  });

  it("is in the request's language", async () => {
    const s = await setup();
    const kit = (await data<sharing.AwardSharing>(await get(s, `/gms/awards/${awd(s.listed.id)}/sharing?lang=es`, s.officer))).kit!;
    expect(kit.creditLine).toBe("Financiado por Riverbend Community Foundation");
    expect(kit.pressRelease).toContain("PARA PUBLICACIÓN INMEDIATA");
    expect(kit.pressRelease).toContain("otorgó a Alder Creek Family Services una subvención de");
  });
});

describe("the carousel", () => {
  it("is 6 to 10 pages of 1080 × 1350, each with its alt text", async () => {
    const s = await setup();
    let kit = (await panel(s)).kit!;
    // Cover, what it funds, the grantee, the amount, the funder, thanks, learn more.
    expect(kit.carousel.pages).toHaveLength(7);
    expect(kit.carousel.pages[0]).toEqual({ heading: "Riverbend Community Foundation awarded Alder Creek Family Services a grant", alt: "Slide 1 of 7: Riverbend Community Foundation awarded Alder Creek Family Services a grant. Mobile Health Navigation for Rural Families" });
    expect(kit.carousel.path).toBe(`/gms/awards/${awd(s.listed.id)}/sharing/carousel.pdf`);

    let res = await get(s, kit.carousel.path, s.officer);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="alder-creek-family-services-[a-z0-9]{12}-carousel\.pdf"$/);
    expect(await pageSizes(res)).toEqual(Array.from({ length: 7 }, () => ({ width: 1080, height: 1350 })));

    // Hidden amount: 6 pages. With the federal statement too: 7.
    await put(s, "/gms/award-sharing/settings", s.admin, { showAmounts: false });
    expect((await panel(s)).kit!.carousel.pages).toHaveLength(6);
    await federal(s, { federallyFunded: true, amount: "80000", percent: 62.5 });
    await put(s, "/gms/award-sharing/settings", s.admin, { showAmounts: true });
    kit = (await panel(s)).kit!;
    expect(kit.carousel.pages).toHaveLength(8);
    res = await get(s, `/gms/my/awards/${awd(s.listed.id)}/sharing/carousel.pdf`, s.grantee);
    expect(await pageSizes(res)).toHaveLength(8);
    expect(kit.carousel.pages.every((p, i) => p.alt.startsWith(`Slide ${i + 1} of 8: `))).toBe(true);
  });

  it("is not made for an award that is not public, nor for another workspace", async () => {
    const s = await setup();
    const hidden = await s.award("Confidential Shelter", { confidential: true });
    expect((await get(s, `/gms/awards/${awd(hidden.id)}/sharing/carousel.pdf`, s.officer)).status).toBe(409);
    expect((await get(s, `/gms/my/awards/${awd(s.listed.id)}/sharing/carousel.pdf`, s.second)).status).toBe(404);
    expect((await get(s, `/gms/awards/${awd(s.listed.id)}/sharing/carousel.pdf`)).status).toBe(401);
  });
});

describe("the portrait card", () => {
  it("carries both names and the program, and no amount the funder hides", async () => {
    const s = await setup();
    expect((await panel(s)).kit!.portrait).toEqual({ funder: "Riverbend Community Foundation", recipient: "Alder Creek Family Services", program: "Community Health 2027", purpose: "Mobile Health Navigation for Rural Families", year: 2027, amount: { amount: "150000.00", currency: "USD" }, verified: true });
    await put(s, "/gms/award-sharing/settings", s.admin, { showAmounts: false });
    expect((await panel(s)).kit!.portrait.amount).toBeNull();
  });
});

describe("pages to tag", () => {
  it("tags a side's page only when it gave the link and agreed", async () => {
    const s = await setup();
    expect((await panel(s)).kit!.tags).toEqual({ funder: null, grantee: null });

    // The grantee gives its page without agreeing: never tagged.
    let res = await put(s, "/gms/share-kit/profile", s.grantee, { pageUrl: "https://linkedin.com/company/alder-creek-family-services/" });
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ pageUrl: "https://www.linkedin.com/company/alder-creek-family-services", page: { platform: "linkedin", handle: "@alder-creek-family-services" }, tagConsent: false, canChange: true });
    expect((await panel(s)).kit!.tags.grantee).toBeNull();

    // It agrees: the funder's kit names its page.
    await put(s, "/gms/share-kit/profile", s.grantee, { tagConsent: true });
    expect((await panel(s)).kit!.tags.grantee).toEqual({ name: "Alder Creek Family Services", url: "https://www.linkedin.com/company/alder-creek-family-services", platform: "linkedin", handle: "@alder-creek-family-services" });

    // A new link needs consent again.
    res = await put(s, "/gms/share-kit/profile", s.grantee, { pageUrl: "https://bsky.app/profile/aldercreek.org" });
    expect(await data(res)).toMatchObject({ tagConsent: false, page: { platform: "bluesky", handle: "@aldercreek.org" } });
    expect((await panel(s)).kit!.tags.grantee).toBeNull();

    // The funder's page, for the grantee to tag.
    await put(s, "/gms/share-kit/profile", s.admin, { pageUrl: "https://x.com/riverbendcf", tagConsent: true });
    expect((await panel(s, "grantee")).kit!.tags.funder).toMatchObject({ handle: "@riverbendcf", platform: "x", url: "https://x.com/riverbendcf" });
    const ledger = await s.h.ledger.list({ workspaceId: WS_APPLICANT, eventType: "workspace.share_kit_changed" });
    expect(ledger.length).toBe(3);
  });

  it("refuses a link that is not an organization's page, consent without a link, and anyone but an admin in person", async () => {
    const s = await setup();
    for (const pageUrl of ["http://linkedin.com/company/alder", "https://linkedin.com/in/some-person", "https://example.org/alder", "https://x.com/alder/status/1", "javascript:alert(1)", "https://user:pw@x.com/alder"]) {
      expect((await put(s, "/gms/share-kit/profile", s.grantee, { pageUrl })).status).toBe(422);
    }
    expect((await put(s, "/gms/share-kit/profile", s.grantee, { tagConsent: true })).status).toBe(422);
    // A grantee sets no credit wording.
    expect((await put(s, "/gms/share-kit/profile", s.grantee, { creditWording: "supported_by" })).status).toBe(422);
    expect((await put(s, "/gms/share-kit/profile", s.officer, { pageUrl: "https://x.com/riverbendcf" })).status).toBe(403);
    const client = { ...bearer(await clientCredentialsToken(s.h, "workspace:admin awards:read")).headers, "Content-Type": "application/json" };
    expect((await put(s, "/gms/share-kit/profile", client, { pageUrl: "https://x.com/riverbendcf" })).status).toBe(403);
    const agent = ctx(s.h, "delegated", GRANTEE_ADMIN, WS_APPLICANT, "applicant", "admin", ["awards:read", "workspace:admin"]);
    await expect(sharing.updateShareProfile(agent, { pageUrl: "https://x.com/alder", tagConsent: true })).rejects.toMatchObject({ code: "human_only" });
    // Reading is fine for any staff member.
    expect(await data(await get(s, "/gms/share-kit/profile", s.officer))).toMatchObject({ pageUrl: null, tagConsent: false, creditWording: "funded_by", canChange: false });
  });
});

describe("Meet our grantees", () => {
  it("lists only a program's awards that may be public, with a grantee's page only when it agreed", async () => {
    const s = await setup();
    await s.h.repos.table("share_kit_profiles").insert({ workspace_id: SECOND_GRANTEE, page_url: "https://www.instagram.com/valleyfoodbank", tag_consent: true, consented_at: s.h.clock.now.toISOString(), consented_by: SECOND_ADMIN });
    const food = await s.award("Weekend Meals for Students", { recipient_workspace_id: SECOND_GRANTEE, key_dates: { awardDate: { date: "2027-06-01" } } });
    await s.award("Confidential Shelter Project", { confidential: true });
    await s.award("Grantee Chose Unlisted", { recipient_unlisted: true });
    await s.award("Offered Not Yet Accepted", { status: "offered" });
    await s.award("Grant To A Person", { recipient_workspace_id: null, recipient_individual: { name: "Pat Example" } });
    await s.award("Another Program", { program_id: OTHER_PROGRAM });
    const out = await sharing.meetOurGrantees(ctx(s.h, "user", USER_OFFICER, WS_FUNDER, "funder", "program_officer", ["awards:read"]), PROGRAM);
    expect(out.program).toEqual({ id: PROGRAM, name: "Community Health 2027" });
    expect(out.grantees.map((g) => g.purpose)).toEqual(["Weekend Meals for Students", "Mobile Health Navigation for Rural Families"]);
    expect(out.grantees[0]).toMatchObject({ awardId: awd(food.id), recipient: "Valley Food Bank", tag: { handle: "@valleyfoodbank", platform: "instagram" } });
    expect(out.grantees[1]!.tag).toBeNull();
    // Nothing while the funder does not list awards.
    await put(s, "/gms/award-sharing/settings", s.admin, { listAwards: false });
    expect((await sharing.meetOurGrantees(ctx(s.h, "user", USER_OFFICER, WS_FUNDER, "funder", "program_officer", ["awards:read"]), PROGRAM)).grantees).toEqual([]);
    // Another workspace's program is not found.
    await expect(sharing.meetOurGrantees(ctx(s.h, "user", GRANTEE_ADMIN, WS_APPLICANT, "applicant", "admin", ["awards:read"]), PROGRAM)).rejects.toBeInstanceOf(ApiError);
  });
});

function ctx(h: Harness, kind: "user" | "delegated" | "client", userId: string | null, ws: string, wsKind: "funder" | "applicant", role: string | null, scopes: string[]): ServiceContext {
  return {
    actor: makeActor(kind, userId, kind === "user" ? null : CLIENT_AGENT),
    workspace: { id: ws, kind: wsKind, role, memberScope: null },
    scopes,
    repos: h.repos,
    ledger: h.ledger,
    webhooks: h.webhooks,
    now: () => h.clock.now,
    config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null },
    ports: {},
  };
}
