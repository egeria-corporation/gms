// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.8.0): what a funder's grants-awarded pages, badge, sitemap and share kit show.
// A confidential award never leaks through any public route; an award is public only once accepted,
// to an organization, with the funder listing awards and the grantee not opting out; amounts can be
// hidden; "verified" appears only for a funder linked to Passport; every change is a person's.
import { describe, expect, it } from "vitest";
import { makeActor, type ServiceContext } from "../src/services/context.ts";
import * as sharing from "../src/services/award-sharing.ts";
import { ApiError } from "../src/lib/errors.ts";
import { BASE, CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const GRANTEE_ADMIN = "14141414-1414-4141-8141-141414141414";
const OTHER_ADMIN = "15151515-1515-4151-8151-151515151515";
const INDIVIDUAL_WS = "16161616-1616-4161-8161-161616161616";
const PROGRAM = "17171717-1717-4171-8171-171717171717";

const money = (amount: string) => ({ awardedAmount: { amount, currency: "USD" } });

async function setup() {
  const h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: OTHER_ADMIN, role: "admin" });
  // An applicant workspace that says it is an individual.
  await h.repos.table("workspaces").insert({ id: INDIVIDUAL_WS, kind: "applicant", handle: "jo-person", display_name: "Jo Person", profile_source: "self_declared", self_declared_profile: { legalName: "Jo Person", orgType: "individual" } });
  await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community Health" });
  const award = (title: string, extra: Record<string, unknown> = {}) =>
    h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", funding: money("150000.00"), key_dates: { awardDate: { date: "2027-03-01" } }, program_id: PROGRAM, description: "Internal: the board asked for quarterly calls", ...extra } as never);
  const listed = await award("Mobile Health Navigation");
  const hidden = {
    confidential: await award("Confidential Shelter Project", { confidential: true }),
    offered: await award("Offered Not Yet Accepted", { status: "offered" }),
    suspended: await award("Suspended Project", { status: "suspended" }),
    cancelled: await award("Cancelled Project", { status: "cancelled" }),
    person: await award("Grant To A Person", { recipient_workspace_id: null, recipient_individual: { name: "Pat Example" } }),
    selfIndividual: await award("Grant To A Self Declared Individual", { recipient_workspace_id: INDIVIDUAL_WS }),
    unlisted: await award("Grantee Chose Unlisted", { recipient_unlisted: true }),
  };
  const other = await h.repos.table("awards").insert({ workspace_id: WS_OTHER, recipient_workspace_id: WS_APPLICANT, title: "Clinic Navigation Pilot", status: "completed", funding: money("40000.00"), key_dates: { awardDate: { date: "2026-07-01" } } } as never);
  const who = async (userId: string, ws: string): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
  return { h, listed, hidden, other, admin: await who(USER_ADMIN, WS_FUNDER), officer: await who(USER_OFFICER, WS_FUNDER), auditor: await who(USER_AUDITOR, WS_FUNDER), grantee: await who(GRANTEE_ADMIN, WS_APPLICANT), editor: await who(USER_OFFICER, WS_APPLICANT), otherAdmin: await who(OTHER_ADMIN, WS_OTHER) };
}
type S = Awaited<ReturnType<typeof setup>>;

const get = (h: Harness, path: string, headers?: H) => h.request(path, headers ? { headers } : undefined);
const put = (h: Harness, path: string, headers: H, body: unknown) => h.request(path, { method: "PUT", headers, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const awd = (id: string) => `awd_${id}`;
const listOn = (s: S, body: Record<string, unknown> = { listAwards: true }) => put(s.h, "/gms/award-sharing/settings", s.admin, body);

interface AwardsPage {
  awards: { slug: string; purpose: string; recipient: { name: string }; program: string | null; year: number; amount: { amount: string } | null; links: { page: string; badge: string; image: string } }[];
  years: number[];
  programs: string[];
  amountsShown: boolean;
}
const slugOf = (a: { public_slug: string }) => `alder-creek-family-services-${a.public_slug}`;

/** Every public surface, as text: the funder page, the awards page, each award page and badge asked for, and the sitemap. */
async function everythingPublic(s: S, slugs: string[]): Promise<string> {
  const parts: string[] = [];
  for (const path of ["/gms/public/funders/riverbend", "/gms/public/funders/riverbend/awards", "/sitemap.xml", ...slugs.flatMap((x) => [`/gms/public/funders/riverbend/awards/${x}`, `/gms/public/badges/${x}.svg`])]) parts.push(await (await get(s.h, path)).text());
  return parts.join("\n");
}

describe("listing is off until the funder turns it on", () => {
  it("shows no award anywhere public by default", async () => {
    const s = await setup();
    expect((await get(s.h, "/gms/public/funders/riverbend/awards")).status).toBe(404);
    expect((await get(s.h, `/gms/public/funders/riverbend/awards/${slugOf(s.listed)}`)).status).toBe(404);
    expect((await get(s.h, `/gms/public/badges/${slugOf(s.listed)}.svg`)).status).toBe(404);
    expect((await data<{ pastAwards: unknown }>(await get(s.h, "/gms/public/funders/riverbend"))).pastAwards).toBeNull();
    expect(await (await get(s.h, "/sitemap.xml")).text()).not.toContain("/awards");
    // The share kit is not offered either.
    const panel = await data<sharing.AwardSharing>(await get(s.h, `/gms/awards/${awd(s.listed.id)}/sharing`, s.officer));
    expect(panel).toMatchObject({ listed: false, reason: "listing_off", listingOn: false, kit: null, awardsPage: null });
  });

  it("lists only accepted awards to organizations that are not confidential or unlisted", async () => {
    const s = await setup();
    const on = await listOn(s);
    expect(on.status).toBe(200);
    expect(await data(on)).toMatchObject({ listAwards: true, showAmounts: true, counts: { listed: 1, confidential: 1, recipientUnlisted: 1 } });
    const page = await data<AwardsPage>(await get(s.h, "/gms/public/funders/riverbend/awards"));
    expect(page.awards.map((a) => a.purpose)).toEqual(["Mobile Health Navigation"]);
    expect(page.awards[0]).toMatchObject({ slug: slugOf(s.listed), recipient: { name: "Alder Creek Family Services" }, program: "Community Health", year: 2027, amount: { amount: "150000.00", currency: "USD" }, links: { page: `${WEB}/f/riverbend/awards/${slugOf(s.listed)}`, badge: `${WEB}/badge/${slugOf(s.listed)}.svg`, image: `${WEB}/og/f/riverbend/awards/${slugOf(s.listed)}.png` } });
    expect(page).toMatchObject({ years: [2027], programs: ["Community Health"], amountsShown: true });

    const one = await get(s.h, `/gms/public/funders/riverbend/awards/${slugOf(s.listed)}`);
    expect(one.status).toBe(200);
    expect(await data(one)).toMatchObject({ verified: true, award: { purpose: "Mobile Health Navigation" }, funder: { handle: "riverbend" } });
    // Found by its token: the name part is for reading, so a rename keeps old links working.
    expect((await get(s.h, `/gms/public/funders/riverbend/awards/${s.listed.public_slug}`)).status).toBe(200);
    // Under another funder's handle it is not found.
    expect((await get(s.h, `/gms/public/funders/cascade-county/awards/${slugOf(s.listed)}`)).status).toBe(404);
    // The award's internal description is never public.
    expect(await everythingPublic(s, [slugOf(s.listed)])).not.toContain("quarterly calls");
  });
});

describe("a confidential or hidden award never leaks", () => {
  it("is absent from every public route, the sitemap and the badge, with the same 404 as an award that does not exist", async () => {
    const s = await setup();
    await listOn(s);
    const slugs = Object.values(s.hidden).map((a) => `x-${a.public_slug}`);
    const text = await everythingPublic(s, slugs);
    for (const a of Object.values(s.hidden)) {
      expect(text).not.toContain(a.title);
      expect(text).not.toContain(a.public_slug);
    }
    expect(text).not.toContain("Pat Example");
    expect(text).not.toContain("Jo Person");
    const missing = await get(s.h, "/gms/public/badges/nothing-000000000000.svg");
    const missingBody = await missing.text();
    for (const x of slugs) {
      const badge = await get(s.h, `/gms/public/badges/${x}.svg`);
      expect(badge.status).toBe(404);
      expect(await badge.text()).toBe(missingBody);
      expect(badge.headers.get("Content-Type")).toBe(missing.headers.get("Content-Type"));
      expect((await get(s.h, `/gms/public/funders/riverbend/awards/${x}`)).status).toBe(404);
    }
    expect(missingBody).toBe("Not found");
  });

  it("drops out of the public pages the moment the funder marks it confidential", async () => {
    const s = await setup();
    await listOn(s);
    const marked = await put(s.h, `/gms/awards/${awd(s.listed.id)}/confidential`, s.officer, { confidential: true });
    expect(marked.status).toBe(200);
    expect(await data(marked)).toMatchObject({ listed: false, reason: "confidential", confidential: true, kit: null });
    expect((await data<AwardsPage>(await get(s.h, "/gms/public/funders/riverbend/awards"))).awards).toEqual([]);
    expect((await get(s.h, `/gms/public/badges/${slugOf(s.listed)}.svg`)).status).toBe(404);
    expect(await everythingPublic(s, [slugOf(s.listed)])).not.toContain("Mobile Health Navigation");
    expect(s.h.ledger.events.some((e) => e.eventType === "award.made_confidential" && e.subjectId === s.listed.id)).toBe(true);
    // The grantee's share kit goes with it.
    expect(await data(await get(s.h, `/gms/my/awards/${awd(s.listed.id)}/sharing`, s.grantee))).toMatchObject({ listed: false, reason: "confidential", kit: null });
  });

  it("is never offered as a share kit, through the service either", async () => {
    const s = await setup();
    await listOn(s);
    const ctx = serviceCtx(s.h, "user", USER_OFFICER, WS_FUNDER, "funder", "program_officer", ["awards:read"]);
    expect(await sharing.shareKit(ctx, s.hidden.confidential.id, "funder")).toBeNull();
    expect(await sharing.shareKit(ctx, s.hidden.unlisted.id, "funder")).toBeNull();
    expect(await sharing.shareKit(ctx, s.listed.id, "funder")).not.toBeNull();
    expect(await sharing.awardIsPubliclyListable({ repos: s.h.repos }, s.hidden.confidential.id)).toBe(false);
    expect(await sharing.awardIsPubliclyListable({ repos: s.h.repos }, s.listed.id)).toBe(true);
  });
});

describe("consent", () => {
  it("lets the grantee take its own award off the funder's page, and back", async () => {
    const s = await setup();
    await listOn(s);
    const off = await put(s.h, `/gms/my/awards/${awd(s.listed.id)}/listing`, s.grantee, { unlisted: true });
    expect(off.status).toBe(200);
    expect(await data(off)).toMatchObject({ listed: false, reason: "recipient_unlisted", recipientUnlisted: true, canChange: true });
    expect((await data<AwardsPage>(await get(s.h, "/gms/public/funders/riverbend/awards"))).awards).toEqual([]);
    expect((await get(s.h, `/gms/public/funders/riverbend/awards/${slugOf(s.listed)}`)).status).toBe(404);
    expect((await data<{ pastAwards: unknown[] }>(await get(s.h, "/gms/public/funders/riverbend"))).pastAwards).toEqual([]);
    // The funder sees why, and cannot override it.
    expect(await data(await get(s.h, `/gms/awards/${awd(s.listed.id)}/sharing`, s.admin))).toMatchObject({ listed: false, reason: "recipient_unlisted" });
    expect(s.h.ledger.events.some((e) => e.eventType === "award.recipient_unlisted" && e.workspaceId === WS_FUNDER)).toBe(true);

    const back = await put(s.h, `/gms/my/awards/${awd(s.listed.id)}/listing`, s.grantee, { unlisted: false });
    expect(await data(back)).toMatchObject({ listed: true, reason: null });
    expect((await data<AwardsPage>(await get(s.h, "/gms/public/funders/riverbend/awards"))).awards).toHaveLength(1);
  });

  it("never lists an award to an individual, whatever else is on", async () => {
    const s = await setup();
    await listOn(s);
    for (const a of [s.hidden.person, s.hidden.selfIndividual]) {
      const panel = await data<sharing.AwardSharing>(await get(s.h, `/gms/awards/${awd(a.id)}/sharing`, s.admin));
      expect(panel).toMatchObject({ listed: false, reason: "individual", kit: null });
    }
  });

  it("hides amounts when the funder chooses to, everywhere", async () => {
    const s = await setup();
    await listOn(s, { listAwards: true, showAmounts: false });
    const page = await data<AwardsPage>(await get(s.h, "/gms/public/funders/riverbend/awards"));
    expect(page.amountsShown).toBe(false);
    expect(page.awards[0]!.amount).toBeNull();
    expect((await data<{ award: { amount: unknown } }>(await get(s.h, `/gms/public/funders/riverbend/awards/${slugOf(s.listed)}`))).award.amount).toBeNull();
    expect((await data<{ pastAwards: { awardedAmount: unknown }[] }>(await get(s.h, "/gms/public/funders/riverbend"))).pastAwards[0]!.awardedAmount).toBeNull();
    const kit = (await data<sharing.AwardSharing>(await get(s.h, `/gms/my/awards/${awd(s.listed.id)}/sharing`, s.grantee))).kit!;
    const text = JSON.stringify(kit);
    expect(text).not.toContain("150,000");
    expect(text).not.toContain("150000");
    expect(kit.posts.short).toContain("for a grant for");
  });
});

describe("the badge", () => {
  it("says verified only for a funder linked to Passport", async () => {
    const s = await setup();
    await listOn(s);
    const badge = await get(s.h, `/gms/public/badges/${slugOf(s.listed)}.svg`);
    expect(badge.status).toBe(200);
    expect(badge.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(badge.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=3600");
    expect(badge.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const svg = await badge.text();
    expect(svg).toContain("Riverbend Community Foundation · verified");
    expect(svg).toContain('aria-label="Funded by Riverbend Community Foundation, verified"');
    expect(svg).not.toMatch(/<script|<image|href=/i);

    // Cascade County is not linked to Passport: "Funded by", without the word verified.
    await put(s.h, "/gms/award-sharing/settings", s.otherAdmin, { listAwards: true });
    const slug = `alder-creek-family-services-${s.other.public_slug}`;
    const unverified = await (await get(s.h, `/gms/public/badges/${slug}.svg`)).text();
    expect(unverified).toContain("Cascade County Health Department");
    expect(unverified).not.toContain("verified");
    expect(await data(await get(s.h, `/gms/public/funders/cascade-county/awards/${slug}`))).toMatchObject({ verified: false });
    const kit = (await data<sharing.AwardSharing>(await get(s.h, `/gms/awards/${awd(s.other.id)}/sharing`, s.otherAdmin))).kit!;
    expect(kit.badge).toMatchObject({ verified: false, text: "Funded by Cascade County Health Department" });
    expect(kit.badge.snippet).toBe(`<a href="${WEB}/f/cascade-county/awards/${slug}"><img src="${WEB}/badge/${slug}.svg" alt="Funded by Cascade County Health Department" width="${sharing.badgeSize(kit.badge.text).width}" height="20"></a>`);
  });

  it("escapes the funder's name", () => {
    const svg = sharing.badgeSvg('Fund <script>alert("x")</script> & Co', false);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("Fund &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
  });
});

describe("the share kit", () => {
  it("gives the funder and the grantee three posts from public fields only, with the link, card and badge", async () => {
    const s = await setup();
    await listOn(s);
    const funder = (await data<sharing.AwardSharing>(await get(s.h, `/gms/awards/${awd(s.listed.id)}/sharing`, s.officer))).kit!;
    expect(funder.posts.linkedin).toBe(`We are proud to support Alder Creek Family Services with a $150,000 grant through our Community Health program. The grant funds “Mobile Health Navigation”.\n\nCongratulations to the Alder Creek Family Services team.\n\n${WEB}/f/riverbend/awards/${slugOf(s.listed)}`);
    expect(funder.posts.newsletter).toContain(`See every grant we have awarded: ${WEB}/f/riverbend/awards`);
    const grantee = (await data<sharing.AwardSharing>(await get(s.h, `/gms/my/awards/${awd(s.listed.id)}/sharing`, s.grantee))).kit!;
    expect(grantee.posts.linkedin).toContain("We are grateful to Riverbend Community Foundation for a $150,000 grant through its Community Health program.");
    expect(grantee.posts.short).toBe(`Thank you, Riverbend Community Foundation, for a $150,000 grant for “Mobile Health Navigation”. ${WEB}/f/riverbend/awards/${slugOf(s.listed)}`);
    expect(grantee.posts.newsletter).toContain("Alder Creek Family Services has received a $150,000 grant from Riverbend Community Foundation");
    expect(grantee.links).toEqual({ page: `${WEB}/f/riverbend/awards/${slugOf(s.listed)}`, awards: `${WEB}/f/riverbend/awards`, image: `${WEB}/og/f/riverbend/awards/${slugOf(s.listed)}.png`, badge: `${WEB}/badge/${slugOf(s.listed)}.svg` });
    expect(grantee.badge).toMatchObject({ verified: true, text: "Funded by Riverbend Community Foundation · verified" });
    for (const kit of [funder, grantee]) {
      expect(JSON.stringify(kit)).not.toContain("quarterly calls");
      expect(kit.posts.short.length).toBeLessThanOrEqual(sharing.SHORT_POST_MAX);
    }
  });

  it("keeps the short post within its limit for a long purpose", async () => {
    const s = await setup();
    await listOn(s);
    await s.h.repos.table("awards").update({ id: s.listed.id }, { title: "A very long project title ".repeat(12).trim() });
    const kit = (await data<sharing.AwardSharing>(await get(s.h, `/gms/my/awards/${awd(s.listed.id)}/sharing`, s.grantee))).kit!;
    expect(kit.posts.short.length).toBeLessThanOrEqual(sharing.SHORT_POST_MAX);
    expect(kit.posts.short).toContain("…”");
  });

  it("is read by each side only", async () => {
    const s = await setup();
    await listOn(s);
    expect((await get(s.h, `/gms/awards/${awd(s.listed.id)}/sharing`, s.otherAdmin)).status).toBe(404);
    expect((await get(s.h, `/gms/my/awards/${awd(s.listed.id)}/sharing`, s.admin)).status).toBe(403);
    expect((await get(s.h, `/gms/awards/${awd(s.other.id)}/sharing`, s.admin)).status).toBe(404);
    expect((await get(s.h, `/gms/awards/${awd(s.listed.id)}/sharing`)).status).toBe(401);
  });
});

function serviceCtx(h: Harness, kind: "user" | "delegated" | "client", userId: string | null, ws: string, wsKind: "funder" | "applicant", role: string | null, scopes: string[]): ServiceContext {
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

describe("changes are a person's", () => {
  it("refuses agents and API clients, and roles that may not change them", async () => {
    const s = await setup();
    const agentFunder = serviceCtx(s.h, "delegated", USER_ADMIN, WS_FUNDER, "funder", "admin", ["awards:read", "awards:write", "workspace:admin", "programs:write"]);
    const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ApiError ? e.code : String(e)));
    expect(await code(sharing.setAwardConfidential(agentFunder, s.listed.id, { confidential: false }))).toBe("human_only");
    expect(await code(sharing.updateListingSettings(agentFunder, { listAwards: true }))).toBe("human_only");
    expect(await code(sharing.setProgramConfidentialDefault(agentFunder, PROGRAM, { awardsConfidential: true }))).toBe("human_only");
    const agentGrantee = serviceCtx(s.h, "delegated", GRANTEE_ADMIN, WS_APPLICANT, "applicant", "admin", ["awards:read", "awards:write"]);
    expect(await code(sharing.setRecipientUnlisted(agentGrantee, s.listed.id, { unlisted: true }))).toBe("human_only");
    // Reading the panel is fine for an agent, and it says the agent cannot change it.
    expect(await sharing.awardSharing(agentFunder, s.listed.id, "funder")).toMatchObject({ canChange: false });

    const client = { ...bearer(await clientCredentialsToken(s.h, "workspace:admin awards:read")).headers, "Content-Type": "application/json" };
    expect((await put(s.h, "/gms/award-sharing/settings", client, { listAwards: true })).status).toBe(403);
    expect((await put(s.h, "/gms/award-sharing/settings", s.officer, { listAwards: true })).status).toBe(403);
    expect((await put(s.h, `/gms/awards/${awd(s.listed.id)}/confidential`, s.auditor, { confidential: true })).status).toBe(403);
    expect((await put(s.h, `/gms/my/awards/${awd(s.listed.id)}/listing`, s.editor, { unlisted: true })).status).toBe(403);
    expect((await put(s.h, `/gms/award-sharing/settings`, s.admin, { listAwards: "yes" })).status).toBe(400);
    expect(sharing.listingSettingsOf(await s.h.repos.table("workspaces").one({ id: WS_FUNDER }))).toEqual({ listAwards: false, showAmounts: true });
  });

  it("keeps the listing settings out of the workspace PATCH", async () => {
    const s = await setup();
    await listOn(s);
    expect((await s.h.request(`/gms/workspaces/${WS_FUNDER}`, { method: "PATCH", headers: s.admin, body: JSON.stringify({ settings: { awardSharing: { listAwards: false }, contactEmail: "grants@riverbendcf.example" } }) })).status).toBe(200);
    expect(sharing.listingSettingsOf(await s.h.repos.table("workspaces").one({ id: WS_FUNDER }))).toEqual({ listAwards: true, showAmounts: true });
  });

  it("sets a program's default for new awards", async () => {
    const s = await setup();
    const res = await put(s.h, `/gms/programs/${PROGRAM}/award-sharing`, s.officer, { awardsConfidential: true });
    expect(res.status).toBe(200);
    expect((await data<sharing.ListingSettingsView>(res)).programs).toEqual([{ id: PROGRAM, name: "Community Health", awardsConfidential: true }]);
    expect((await put(s.h, `/gms/programs/${PROGRAM}/award-sharing`, s.otherAdmin, { awardsConfidential: false })).status).toBe(404);
  });
});

describe("sitemap", () => {
  it("names the grants-awarded page and each listed award, and nothing else", async () => {
    const s = await setup();
    await listOn(s);
    const xml = await (await get(s.h, "/sitemap.xml")).text();
    expect(xml).toContain(`<loc>${WEB}/f/riverbend/awards</loc>`);
    expect(xml).toContain(`<loc>${WEB}/f/riverbend/awards/${slugOf(s.listed)}</loc>`);
    expect(xml.match(/\/awards\//g)).toHaveLength(1);
    // Cascade County does not list awards.
    expect(xml).not.toContain("cascade-county/awards");
  });
});

describe("isPubliclyListable", () => {
  const funder = { id: "f", kind: "funder", status: "active", settings: { awardSharing: { listAwards: true } } } as never;
  const recipient = { id: "r", kind: "applicant", self_declared_profile: null, org_projection: null } as never;
  const base = { workspace_id: "f", recipient_workspace_id: "r", recipient_individual: null, status: "active", confidential: false, recipient_unlisted: false } as const;
  it("gives the first reason that applies, confidential first", () => {
    expect(sharing.listability(base, { funder, recipient })).toEqual({ listable: true });
    expect(sharing.listability({ ...base, confidential: true, status: "offered", recipient_unlisted: true }, { funder, recipient })).toEqual({ listable: false, reason: "confidential" });
    expect(sharing.listability({ ...base, confidential: undefined }, { funder, recipient })).toEqual({ listable: false, reason: "confidential" });
    expect(sharing.listability({ ...base, recipient_workspace_id: null, recipient_individual: { name: "A person" } }, { funder, recipient: null })).toEqual({ listable: false, reason: "individual" });
    for (const status of ["offered", "suspended", "cancelled"]) expect(sharing.listability({ ...base, status }, { funder, recipient })).toEqual({ listable: false, reason: "not_accepted" });
    expect(sharing.listability(base, { funder: { ...(funder as object), status: "suspended" } as never, recipient })).toEqual({ listable: false, reason: "funder_unavailable" });
    expect(sharing.listability(base, { funder: { ...(funder as object), settings: { transparency: true } } as never, recipient })).toEqual({ listable: false, reason: "listing_off" });
    expect(sharing.listability({ ...base, recipient_unlisted: true }, { funder, recipient })).toEqual({ listable: false, reason: "recipient_unlisted" });
  });
  it("words amounts with the right article", () => {
    expect(["$150,000", "$80,000", "$11,000", "$18,500", "$8", "$1,800", "$110,000"].map(sharing.aGrant)).toEqual(["a $150,000 grant", "an $80,000 grant", "an $11,000 grant", "an $18,500 grant", "an $8 grant", "a $1,800 grant", "a $110,000 grant"]);
    expect(sharing.aGrant(null)).toBe("a grant");
    expect(sharing.formatAmount({ amount: "150000.00", currency: "USD" })).toBe("$150,000");
    expect(sharing.formatAmount({ amount: "1250.50", currency: "EUR" })).toBe("€1,250.50");
  });
  it("reads a slug's token and nothing else", () => {
    expect(sharing.tokenOf("alder-creek-0123456789ab")).toBe("0123456789ab");
    expect(sharing.tokenOf("0123456789ab")).toBe("0123456789ab");
    for (const bad of [undefined, "", "alder-creek", "UPPER-0123456789AB", "../0123456789ab", "a-short"]) expect(sharing.tokenOf(bad)).toBeNull();
    expect(sharing.nameSlug("Ålder & Créek: Family Services!")).toBe("alder-and-creek-family-services");
  });
});
