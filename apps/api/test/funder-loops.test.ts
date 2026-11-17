// SPDX-License-Identifier: AGPL-3.0-only
// Funder loops (E4): the peer invitation (limits, a person only, once per address, no reminders,
// the preview is what is sent), joins counted by invitation and link id, the for-funders count
// (never below ten, never a name), the profile funders see, and the partner directory's moderation
// states and withdrawal.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { PEER_INVITES_PER_WEEK, STALE_SENDING_MS, weekStartOf } from "../src/services/peer-invites.ts";
import { REGION_COUNT_FLOOR, regionOf } from "../src/services/for-funders.ts";
import { FUNDER_SEEN_FIELDS } from "../src/services/reusable-profile.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Data<T> = { data: T };
const headers = async (user: string, ws?: string) => ({ ...bearer(await h.session(user)).headers, ...(ws ? { "X-GMS-Workspace": ws } : {}), "Content-Type": "application/json" });
const call = <T = { data: unknown; errors?: { code: string }[] }>(who: Record<string, string>, method: string, path: string, body?: unknown) => s.call<T>(who, method, path, method === "GET" ? undefined : (body ?? {}));
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await call<Data<T>>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const code = (r: { body: unknown }) => ((r.body as { errors?: { code?: string }[] }).errors?.[0]?.code ?? null);
let admin: Record<string, string>;

type Preview = { to: string; from: string; replyTo: string; subject: string; text: string; html: string; token: string; digest: string; remainingThisWeek: number; perWeek: number };
const preview = (email: string, note?: string, who = admin) => data<Preview>(who, "POST", "/gms/peer-invitations/preview", { email, ...(note ? { note } : {}) });
const invite = async (email: string, note?: string) => {
  const p = await preview(email, note);
  return { p, r: await call(admin, "POST", "/gms/peer-invitations", { email, ...(note ? { note } : {}), token: p.token, digest: p.digest }) };
};

/** A new workspace made now by `user`, as funder or applicant setup would make it. */
async function newWorkspace(user: string, kind: "funder" | "applicant", handle: string) {
  const w = await h.repos.table("workspaces").insert({ kind, handle, display_name: `New ${handle}` });
  await h.repos.table("workspace_members").insert({ workspace_id: w.id, user_id: user, role: "admin" });
  return w.id;
}
const NEWCOMER = "e4e4e4e4-0000-4e4e-8e4e-e4e4e4e4e401";
const MODERATOR = "e4e4e4e4-0000-4e4e-8e4e-e4e4e4e4e402";

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
});

describe("inviting a peer funder", () => {
  it("previews exactly what is sent, under the admin's name, and sends it once", async () => {
    const { p, r } = await invite("Peer@Northwind.example", "We moved our whole cycle here last spring.");
    expect(r.status).toBe(200);
    expect(p).toMatchObject({ to: "peer@northwind.example", from: '"Helen Ortiz" <notices@gms.test>', replyTo: "helen.ortiz@riverbendcf.example", perWeek: PEER_INVITES_PER_WEEK });
    expect(p.text).toContain("We moved our whole cycle here last spring.");
    expect(p.text).toContain(`https://app.gms.test/for-funders?invite=${p.token}`);
    expect(h.mailer.sent).toHaveLength(1);
    const sent = h.mailer.sent[0]!;
    expect({ to: sent.to, subject: sent.subject, text: sent.text, html: sent.html, replyTo: sent.replyTo, from: sent.from }).toEqual({ to: [p.to], subject: p.subject, text: p.text, html: p.html, replyTo: p.replyTo, from: p.from });
    // Stored masked and hashed; the note and the token are not kept.
    const row = (await h.repos.table("peer_invitations").find({ workspace_id: WS_FUNDER }))[0]!;
    expect(row).toMatchObject({ email_masked: "p…@northwind.example", status: "sent", week_start: weekStartOf(h.clock.now) });
    expect(JSON.stringify(row)).not.toContain("peer@northwind");
    expect(JSON.stringify(row)).not.toContain(p.token);
    expect(JSON.stringify(row)).not.toContain("whole cycle");
    const list = await data<{ items: { to: string; status: string }[]; remainingThisWeek: number }>(admin, "GET", "/gms/peer-invitations");
    expect(list.items).toEqual([expect.objectContaining({ to: "p…@northwind.example", status: "sent" })]);
    expect(list.remainingThisWeek).toBe(PEER_INVITES_PER_WEEK - 1);
    const events = (await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "peer_invitation.sent" }));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain("peer@northwind");
  });

  it("refuses a send that differs from the preview", async () => {
    const p = await preview("peer@northwind.example", "First words");
    const r = await call(admin, "POST", "/gms/peer-invitations", { email: "peer@northwind.example", note: "Other words", token: p.token, digest: p.digest });
    expect(r.status).toBe(409);
    expect(code(r)).toBe("preview_changed");
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("invites an address once: there is never a second email or a reminder", async () => {
    expect((await invite("peer@northwind.example")).r.status).toBe(200);
    const again = await invite("PEER@northwind.example");
    expect(again.r.status).toBe(409);
    expect(code(again.r)).toBe("already_invited");
    expect(again.p).toMatchObject({ alreadyInvited: true });
    // Weeks later nothing more goes out: there is no reminder job for invitations.
    h.clock.now = new Date(h.clock.now.getTime() + 30 * 24 * 3600 * 1000);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it(`sends at most ${PEER_INVITES_PER_WEEK} a week per workspace`, async () => {
    for (let i = 1; i <= PEER_INVITES_PER_WEEK; i++) expect((await invite(`peer${i}@northwind.example`)).r.status).toBe(200);
    const sixth = await invite("peer6@northwind.example");
    expect(sixth.r.status).toBe(429);
    expect(code(sixth.r)).toBe("too_many_peer_invites");
    expect(h.mailer.sent).toHaveLength(PEER_INVITES_PER_WEEK);
    // Another workspace has its own five.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    const other = await headers(USER_ADMIN, WS_OTHER);
    const p = await preview("peer6@northwind.example", undefined, other);
    expect((await call(other, "POST", "/gms/peer-invitations", { email: "peer6@northwind.example", token: p.token, digest: p.digest })).status).toBe(200);
    // Seven days later the first workspace may send again.
    h.clock.now = new Date(h.clock.now.getTime() + 8 * 24 * 3600 * 1000);
    admin = await headers(USER_ADMIN, WS_FUNDER);
    expect((await invite("peer6@northwind.example")).r.status).toBe(200);
  });

  it("is a person's act: agents, API clients and other roles are refused", async () => {
    const agent = { ...bearer(await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-e4-agent" })).headers, "Content-Type": "application/json" };
    const client = { ...bearer(await clientCredentialsToken(h, "workspace:admin")).headers, "Content-Type": "application/json" };
    const officer = await headers(USER_OFFICER, WS_FUNDER);
    const p = await preview("peer@northwind.example");
    for (const [who, status] of [
      [agent, 403],
      [client, 403],
      [officer, 403],
      [s.applicant, 403],
    ] as const) {
      expect((await call(who, "POST", "/gms/peer-invitations/preview", { email: "peer@northwind.example" })).status).toBe(status);
      // Refused before the body is read: a bad body gets the same answer.
      expect((await call(who, "POST", "/gms/peer-invitations", { nonsense: true })).status).toBe(status);
      expect((await call(who, "POST", "/gms/peer-invitations", { email: "peer@northwind.example", token: p.token, digest: p.digest })).status).toBe(status);
    }
    expect(code(await call(agent, "POST", "/gms/peer-invitations/preview", { email: "x@y.example" }))).toBe("human_only");
    expect(h.mailer.sent).toHaveLength(0);
    // An API client with workspace:admin reads the list, and is told it cannot invite.
    expect(await data<{ canInvite: boolean }>(client, "GET", "/gms/peer-invitations")).toMatchObject({ canInvite: false });
  });

  it("refuses a note with a link, and the admin's own address", async () => {
    const r = await call(admin, "POST", "/gms/peer-invitations/preview", { email: "peer@northwind.example", note: "See https://example.org/offer" });
    expect([r.status, code(r)]).toEqual([422, "note_has_link"]);
    const self = await call(admin, "POST", "/gms/peer-invitations/preview", { email: "helen.ortiz@riverbendcf.example" });
    expect([self.status, code(self)]).toEqual([422, "invite_yourself"]);
  });

  it("frees the place of a send that never finished, and keeps one that failed from counting", async () => {
    h.mailer.failNext = new Error("down");
    const failed = await invite("peer@northwind.example");
    expect([failed.r.status, code(failed.r)]).toEqual([502, "mail_failed"]);
    expect(await h.repos.table("peer_invitations").count({ workspace_id: WS_FUNDER })).toBe(0);
    // A send left half done by a stopped Worker.
    const ok = await invite("peer@northwind.example");
    expect(ok.r.status).toBe(200);
    await h.repos.table("peer_invitations").update({ workspace_id: WS_FUNDER }, { status: "sending", sent_at: null });
    h.clock.now = new Date(h.clock.now.getTime() + STALE_SENDING_MS + 60_000);
    admin = await headers(USER_ADMIN, WS_FUNDER);
    expect((await invite("peer@northwind.example")).r.status).toBe(200);
  });
});

describe("joins are counted by the invitation's and the link's id", () => {
  it("counts the funder workspace made from an invitation, once, and marks the invitation joined", async () => {
    const { p } = await invite("peer@northwind.example");
    const landing = await data<{ invitation: { funder: { name: string }; inviter: string } | null }>({}, "GET", `/gms/public/for-funders?invite=${p.token}`);
    expect(landing.invitation).toEqual({ funder: { name: "Riverbend Community Foundation", handle: "riverbend" }, inviter: "Helen Ortiz" });
    const newcomer = await headers(NEWCOMER);
    const ws = await newWorkspace(NEWCOMER, "funder", "northwind");
    expect(await data(newcomer, "POST", "/gms/referrals/claim", { workspaceId: ws, source: "invite", token: p.token })).toEqual({ counted: true, reason: "counted" });
    expect(await data(newcomer, "POST", "/gms/referrals/claim", { workspaceId: ws, source: "invite", token: p.token })).toEqual({ counted: false, reason: "already_counted" });
    const list = await data<{ items: { status: string; joinedCount: number }[]; joined: number }>(admin, "GET", "/gms/peer-invitations");
    expect(list.items[0]).toMatchObject({ status: "joined", joinedCount: 1 });
    expect(list.joined).toBe(1);
    // The join names the invitation by id, never the person or their address.
    const joinEvent = (await h.ledger.list({ workspaceId: ws, eventType: "referral.joined" }))[0]!;
    expect(joinEvent.data).toMatchObject({ source: "peer_invitation", joinedKind: "funder" });
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "peer_invitation.joined" }))).toHaveLength(1);
    // A second funder from the same link adds to the count.
    const ws2 = await newWorkspace(NEWCOMER, "funder", "northwind-two");
    await data(newcomer, "POST", "/gms/referrals/claim", { workspaceId: ws2, source: "invite", token: p.token });
    expect((await data<{ items: { joinedCount: number }[] }>(admin, "GET", "/gms/peer-invitations")).items[0]!.joinedCount).toBe(2);
  });

  it("claims only a workspace the person just made and admins, never the inviter's own", async () => {
    const { p } = await invite("peer@northwind.example");
    let newcomer = await headers(NEWCOMER);
    const old = await newWorkspace(NEWCOMER, "funder", "old-northwind");
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 3600 * 1000);
    newcomer = await headers(NEWCOMER);
    admin = await headers(USER_ADMIN, WS_FUNDER);
    expect(code(await call(newcomer, "POST", "/gms/referrals/claim", { workspaceId: old, source: "invite", token: p.token }))).toBe("not_your_new_workspace");
    // Someone else's workspace.
    const theirs = await newWorkspace(USER_OFFICER, "funder", "officer-side");
    expect(code(await call(newcomer, "POST", "/gms/referrals/claim", { workspaceId: theirs, source: "invite", token: p.token }))).toBe("not_your_new_workspace");
    // A member of the inviting workspace.
    const own = await newWorkspace(USER_ADMIN, "funder", "riverbend-two");
    expect(await data(await headers(USER_ADMIN), "POST", "/gms/referrals/claim", { workspaceId: own, source: "invite", token: p.token })).toEqual({ counted: false, reason: "own_link" });
    // An applicant workspace is not a funder.
    const applicant = await newWorkspace(NEWCOMER, "applicant", "new-applicant");
    expect(code(await call(newcomer, "POST", "/gms/referrals/claim", { workspaceId: applicant, source: "invite", token: p.token }))).toBe("funders_only");
    // An unknown token counts nothing.
    const fresh = await newWorkspace(NEWCOMER, "funder", "fresh-northwind");
    expect(await data(newcomer, "POST", "/gms/referrals/claim", { workspaceId: fresh, source: "invite", token: "gms_pi_" + "x".repeat(43) })).toEqual({ counted: false, reason: "unknown_link" });
    // An agent cannot claim.
    const agent = { ...bearer(await h.forge({ sub: NEWCOMER, client_id: CLIENT_AGENT, scope: "workspace:admin", [WORKSPACE_CLAIM]: fresh, jti: "tok-e4-claim" })).headers, "Content-Type": "application/json" };
    expect((await call(agent, "POST", "/gms/referrals/claim", { workspaceId: fresh, source: "invite", token: p.token })).status).toBeGreaterThanOrEqual(401);
  });

  it("counts a funder who joined from an applicant's package link", async () => {
    const pkg = await h.repos.table("referral_links").insert({ workspace_id: WS_APPLICANT, kind: "package", token: "pkgtokenaaaabbbbcccc" });
    const ws = await newWorkspace(NEWCOMER, "funder", "from-package");
    expect(await data(await headers(NEWCOMER), "POST", "/gms/referrals/claim", { workspaceId: ws, source: "package", token: pkg.token })).toEqual({ counted: true, reason: "counted" });
    expect(await h.repos.table("referral_joins").one({ joined_workspace_id: ws })).toMatchObject({ source: "package", source_workspace_id: WS_APPLICANT, referral_link_id: pkg.id, joined_kind: "funder" });
  });
});

describe("for funders: the count", () => {
  const OREGON = (i: number) => ({ id: `e4e4e4e4-0000-4e4e-8e4e-${String(i).padStart(12, "0")}`, handle: `oregon-org-${i}`, name: `Oregon Org ${i}` });
  async function orgs(n: number, withApplications = true, region = "OR") {
    for (let i = 0; i < n; i++) {
      const o = OREGON(i + (region === "OR" ? 0 : 500));
      await h.repos.table("workspaces").insert({ id: o.id, kind: "applicant", handle: o.handle, display_name: o.name, profile_source: "self_declared", self_declared_profile: { legalName: o.name, address: { region, country: "US" } } });
      if (withApplications) await h.repos.table("outside_applications").insert({ workspace_id: o.id, title: "Ask", funder_name: "Someone" });
    }
  }
  const page = async () => data<{ ref: { region: { name: string } | null; organizations: number | null } | null; floor: number }>({}, "GET", `/gms/public/for-funders?ref=${(await h.repos.table("referral_links").insert({ workspace_id: OREGON(0).id, kind: "package", token: "pkgtokenoregon000000" })).token}`);

  it(`gives no number below ${REGION_COUNT_FLOOR}, and never a name`, async () => {
    await orgs(REGION_COUNT_FLOOR - 1);
    // Organizations elsewhere and organizations without an application do not count.
    await orgs(5, true, "WA");
    for (let i = 0; i < 4; i++) await h.repos.table("workspaces").insert({ kind: "applicant", handle: `oregon-empty-${i}`, display_name: `Empty ${i}`, profile_source: "self_declared", self_declared_profile: { legalName: `Empty ${i}`, address: { region: "Oregon" } } });
    const res = await h.request(`/gms/public/for-funders?ref=${(await h.repos.table("referral_links").insert({ workspace_id: OREGON(0).id, kind: "package", token: "pkgtokenoregon000000" })).token}`);
    const text = await res.text();
    const body = JSON.parse(text) as Data<{ ref: { region: { name: string }; organizations: number | null } }>;
    expect(body.data.ref).toEqual({ region: { name: "Oregon" }, organizations: null });
    expect(text).not.toMatch(/Oregon Org|Empty|oregon-org/);
    expect(text).not.toContain(String(REGION_COUNT_FLOOR - 1));
  });

  it(`counts from ${REGION_COUNT_FLOOR} up, matching a state by code or name`, async () => {
    await orgs(REGION_COUNT_FLOOR - 1);
    // The tenth is a Passport organization giving "OR" in its record.
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: ALDER_ORG.id, org_projection: ALDER_ORG as never, profile_source: "passport" });
    await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, title: "Ask", funder_name: "Someone" });
    const p = await page();
    expect(p.ref).toEqual({ region: { name: "Oregon" }, organizations: REGION_COUNT_FLOOR });
    expect(p.floor).toBe(REGION_COUNT_FLOOR);
  });

  it("reads an unknown or revoked link as none", async () => {
    expect((await data<{ ref: unknown }>({}, "GET", "/gms/public/for-funders?ref=nothinghere000000000")).ref).toBeNull();
    expect((await data<{ ref: unknown; invitation: unknown }>({}, "GET", "/gms/public/for-funders")).invitation).toBeNull();
  });

  it("knows a region by its state name, its code, or as written elsewhere", () => {
    const ws = (address: Record<string, string>) => ({ passport_org_id: null, profile_source: "self_declared", self_declared_profile: { legalName: "X", address } }) as never;
    expect(regionOf(ws({ region: "oregon" }))).toEqual({ key: "US:OR", name: "Oregon" });
    expect(regionOf(ws({ region: "OR", country: "US" }))).toEqual({ key: "US:OR", name: "Oregon" });
    expect(regionOf(ws({ region: "Antioquia", country: "CO" }))).toEqual({ key: "CO:antioquia", name: "Antioquia" });
    expect(regionOf(ws({ city: "Portland" }))).toBeNull();
  });
});

describe("the reusable profile", () => {
  it("shows a Passport organization exactly the record fields a funder sees, verified", async () => {
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: ALDER_ORG.id, org_projection: ALDER_ORG as never, profile_source: "passport", verification_level: "L3" });
    const p = await data<{ source: string; verified: boolean; level: string; fields: { key: string; value: string | null }[]; editPath: string | null; verifyPath: string | null }>(await headers(USER_APPLICANT, WS_APPLICANT), "GET", "/gms/reusable-profile");
    expect(p).toMatchObject({ source: "passport", verified: true, level: "L3", editPath: null, verifyPath: null });
    expect(p.fields.map((f) => f.key)).toEqual([...FUNDER_SEEN_FIELDS]);
    expect(Object.fromEntries(p.fields.map((f) => [f.key, f.value]))).toEqual({
      legalName: "Alder Creek Family Services",
      ein: "001234567",
      orgType: "Nonprofits",
      address: "418 Mill Road, Alder Creek, OR, 97000, US",
      email: "info@aldercreekfs.example",
      website: null,
      mission: ALDER_ORG.mission,
    });
  });

  it("shows a self-declared profile as self-declared, with where to edit and to verify, and nothing funders do not see", async () => {
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: null, profile_source: "self_declared", self_declared_profile: { legalName: "Alder Creek Family Services", contactEmail: "hello@alder.example", address: { city: "Alder Creek", region: "OR" } }, settings: { payee: "never shown" } });
    const res = await h.request("/gms/reusable-profile", { headers: await headers(USER_APPLICANT, WS_APPLICANT) });
    const text = await res.text();
    const p = (JSON.parse(text) as Data<{ source: string; verified: boolean; fields: { key: string; value: string | null }[]; editPath: string; verifyPath: string }>).data;
    expect(p).toMatchObject({ source: "self_declared", verified: false, editPath: "/w/alder-creek/settings#organization-details", verifyPath: "/onboarding/applicant" });
    expect(p.fields.find((f) => f.key === "email")?.value).toBe("hello@alder.example");
    expect(text).not.toContain("never shown");
    // A funder workspace has no reusable profile panel.
    expect((await call(admin, "GET", "/gms/reusable-profile")).status).toBe(403);
  });
});

describe("intermediaries: the onboarding link and the partner directory", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString("base64");
  const twoFunds = async () => {
    await h.repos.table("funds").insert({ workspace_id: WS_FUNDER, name: "Default fund", slug: "default", is_default: true });
    await h.repos.table("funds").insert({ workspace_id: WS_FUNDER, name: "River Health Fund", slug: "river-health" });
    await h.repos.table("funds").insert({ workspace_id: WS_FUNDER, name: "Youth Arts Fund", slug: "youth-arts" });
  };
  const moderatorHeaders = async () => {
    h.directory.users.set(MODERATOR, { email: "ops@opengrants.example", name: "Ops" });
    return headers(MODERATOR);
  };

  it("is only for a workspace that runs two or more funds", async () => {
    expect(code(await call(admin, "POST", "/gms/partner-settings/onboarding-link"))).toBe("not_an_intermediary");
    expect(code(await call(admin, "PUT", "/gms/partner-settings/listing", { region: "Oregon" }))).toBe("not_an_intermediary");
    expect(await data(admin, "GET", "/gms/partner-settings")).toMatchObject({ eligible: false, link: null, listing: null });
  });

  it("makes a co-branded link with its name, funds and an uploaded logo with alt text", async () => {
    await twoFunds();
    const made = await data<{ link: { token: string; url: string } }>(admin, "POST", "/gms/partner-settings/onboarding-link");
    expect(made.link.url).toBe(`https://app.gms.test/join/${made.link.token}`);
    // Not an image, or no alt text: refused.
    expect(code(await call(admin, "PUT", "/gms/partner-settings/onboarding-link/logo", { mime: "image/png", contentBase64: Buffer.from("<svg onload=alert(1)>").toString("base64"), alt: "Logo" }))).toBe("logo_not_an_image");
    expect((await call(admin, "PUT", "/gms/partner-settings/onboarding-link/logo", { mime: "image/png", contentBase64: PNG })).status).toBe(400);
    expect((await call(admin, "PUT", "/gms/partner-settings/onboarding-link/logo", { mime: "image/svg+xml", contentBase64: PNG, alt: "Logo" })).status).toBe(400);
    await data(admin, "PUT", "/gms/partner-settings/onboarding-link/logo", { mime: "image/png", contentBase64: PNG, alt: "Riverbend Community Foundation" });
    const pageData = await data<{ intermediary: { name: string }; funds: string[]; logo: { url: string; alt: string } }>({}, "GET", `/gms/public/join/${made.link.token}`);
    expect(pageData).toMatchObject({ intermediary: { name: "Riverbend Community Foundation" }, funds: ["River Health Fund", "Youth Arts Fund"], logo: { alt: "Riverbend Community Foundation" } });
    const logo = await h.request(`/gms/public/join/${made.link.token}/logo`);
    expect(logo.headers.get("Content-Type")).toBe("image/png");
    expect(logo.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // A grantee who joins from it is counted for the link.
    const ws = await newWorkspace(NEWCOMER, "applicant", "grantee-one");
    expect(await data(await headers(NEWCOMER), "POST", "/gms/referrals/claim", { workspaceId: ws, source: "onboarding", token: made.link.token })).toMatchObject({ counted: true });
    expect(await data(admin, "GET", "/gms/partner-settings")).toMatchObject({ link: { joined: 1 } });
    // Replacing the link stops the old one at once; the logo moves with it.
    const replaced = await data<{ link: { token: string; logo: { alt: string } } }>(admin, "POST", "/gms/partner-settings/onboarding-link/replace");
    expect(replaced.link.token).not.toBe(made.link.token);
    expect(replaced.link.logo.alt).toBe("Riverbend Community Foundation");
    expect((await call({}, "GET", `/gms/public/join/${made.link.token}`)).status).toBe(404);
    await data(admin, "DELETE", "/gms/partner-settings/onboarding-link");
    expect((await call({}, "GET", `/gms/public/join/${replaced.link.token}`)).status).toBe(404);
  });

  it("lists an intermediary only after a moderator approves, and takes it down when it withdraws", async () => {
    await twoFunds();
    const items = async () => (await call<{ items: { name: string; region: string; funds: number; page: string }[] }>({}, "GET", "/gms/public/partners")).body.items;
    expect(await data(admin, "PUT", "/gms/partner-settings/listing", { region: "Oregon" })).toMatchObject({ status: "pending", region: "Oregon" });
    expect(await items()).toEqual([]);
    // Not a moderator: refused. Nobody moderates until an operator is named.
    const mod = await moderatorHeaders();
    expect(code(await call(mod, "GET", "/gms/partners/moderation/queue"))).toBe("not_a_directory_moderator");
    // GALLERY_MODERATORS is used while DIRECTORY_MODERATORS is not set.
    h.env.GALLERY_MODERATORS = ` ${MODERATOR} `;
    const queue = (await call<{ items: { id: string; partner: { name: string }; funds: number }[] }>(mod, "GET", "/gms/partners/moderation/queue")).body.items;
    expect(queue).toEqual([expect.objectContaining({ partner: expect.objectContaining({ name: "Riverbend Community Foundation" }), funds: 2, status: "pending" })]);
    // DIRECTORY_MODERATORS, once set, replaces it.
    h.env.DIRECTORY_MODERATORS = "someone-else@opengrants.example";
    expect(code(await call(mod, "GET", "/gms/partners/moderation/queue"))).toBe("not_a_directory_moderator");
    h.env.DIRECTORY_MODERATORS = `${MODERATOR}`;
    // A decline needs a reason.
    expect((await call(mod, "POST", `/gms/partners/moderation/listings/${queue[0]!.id}/reject`, { reason: "" })).status).toBe(400);
    await data(mod, "POST", `/gms/partners/moderation/listings/${queue[0]!.id}/approve`);
    expect(await items()).toEqual([{ name: "Riverbend Community Foundation", handle: "riverbend", region: "Oregon", funds: 2, page: "https://app.gms.test/f/riverbend", verification: { source: "passport", level: null } }]);
    // Asking again while listed is refused; withdrawing takes it down at once.
    expect(code(await call(admin, "PUT", "/gms/partner-settings/listing", { region: "Washington" }))).toBe("already_listed");
    expect(await data(admin, "POST", "/gms/partner-settings/listing/withdraw")).toMatchObject({ status: "withdrawn" });
    expect(await items()).toEqual([]);
    // Asked again, it waits for a moderator again; a decline says why.
    await data(admin, "PUT", "/gms/partner-settings/listing", { region: "Washington" });
    expect(await data(mod, "POST", `/gms/partners/moderation/listings/${queue[0]!.id}/reject`, { reason: "Please add your public page first." })).toMatchObject({ status: "rejected", decisionReason: "Please add your public page first." });
    expect(await items()).toEqual([]);
    // Every move is on the workspace's ledger.
    const moves = (await h.ledger.list({ workspaceId: WS_FUNDER })).map((e) => e.eventType).filter((t) => t.startsWith("directory_listing."));
    expect(moves).toEqual(expect.arrayContaining(["directory_listing.requested", "directory_listing.approved", "directory_listing.withdrawn", "directory_listing.rejected"]));
  });

  it("leaves the directory when the workspace no longer runs enough funds", async () => {
    await twoFunds();
    h.env.DIRECTORY_MODERATORS = MODERATOR;
    const mod = await moderatorHeaders();
    await data(admin, "PUT", "/gms/partner-settings/listing", { region: "Oregon" });
    const [q] = (await call<{ items: { id: string }[] }>(mod, "GET", "/gms/partners/moderation/queue")).body.items;
    await data(mod, "POST", `/gms/partners/moderation/listings/${q!.id}/approve`);
    await h.repos.table("funds").remove({ workspace_id: WS_FUNDER, slug: "youth-arts" });
    expect((await call<{ items: unknown[] }>({}, "GET", "/gms/public/partners")).body.items).toEqual([]);
  });

  it("is an admin's in person: agents, API clients and other roles change nothing", async () => {
    await twoFunds();
    const agent = { ...bearer(await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-e4-partner" })).headers, "Content-Type": "application/json" };
    const client = { ...bearer(await clientCredentialsToken(h, "workspace:admin")).headers, "Content-Type": "application/json" };
    const officer = await headers(USER_OFFICER, WS_FUNDER);
    for (const who of [agent, client, officer]) {
      for (const [method, path, body] of [
        ["POST", "/gms/partner-settings/onboarding-link", undefined],
        ["PUT", "/gms/partner-settings/listing", { region: "Oregon" }],
        ["PUT", "/gms/partner-settings/onboarding-link/logo", { nonsense: true }],
        ["POST", "/gms/partner-settings/listing/withdraw", undefined],
      ] as const) {
        expect((await call(who, method, path, body)).status, `${method} ${path}`).toBe(403);
      }
    }
    expect(await h.repos.table("referral_links").count({ workspace_id: WS_FUNDER })).toBe(0);
    expect(await h.repos.table("directory_listings").count({ workspace_id: WS_FUNDER })).toBe(0);
  });
});
