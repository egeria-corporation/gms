// SPDX-License-Identifier: AGPL-3.0-only
// Social posting through Zernio, against the fake Zernio (no network): hidden when not set up;
// connect with a sealed state; the preview is what is sent; only a person posts; one workspace
// never reaches another's accounts or posts; the webhook is signed, applied once and only to its
// workspace; a retry with the same Idempotency-Key posts once and Zernio's 409 counts as sent.
import { prefixedId } from "@gms/protocol";
import { FakeZernio, sealToken, signZernioBody } from "@gms/social";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const share = vi.hoisted(() => ({ listable: false, kit: null as null | { posts: { kind: "linkedin" | "short" | "newsletter"; label: string; text: string }[]; link: string; imageUrl: string | null } }));
vi.mock("../src/services/social-award-share.ts", () => ({
  isPubliclyListable: async () => share.listable,
  shareKit: async () => share.kit,
}));

// Test values only; not real Zernio credentials.
const ZERNIO_KEY = "zk_test_unit_key_not_real";
const ZERNIO_SECRET = "zernio-webhook-secret-for-unit-tests";
const OTHER_ADMIN = "45454545-4545-4454-8454-454545454545";
const SECOND_ADMIN = "56565656-5656-4565-8565-565656565656";
const APPLICANT_ADMIN = "67676767-6767-4676-8676-676767676767";
const OPP = "0190b000-0000-7000-8000-0000000000c1";
const OTHER_OPP = "0190b000-0000-7000-8000-0000000000c2";
const AWARD = "0190b000-0000-7000-8000-0000000000e1";

let h: Harness;
let fake: FakeZernio;
let seq = 0;

const json = (headers: Record<string, string>) => ({ ...headers, "Content-Type": "application/json" });
const person = async (user: string, ws: string) => json({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws });
const agent = async (user: string, ws: string, scope: string) => json({ Authorization: `Bearer ${await h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-soc-${++seq}` })}`, "X-GMS-Workspace": ws });
const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await h.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> & { [k: string]: unknown }; message?: string; errors?: { code?: string }[]; code?: string } };
};
const data = <T = Record<string, unknown>>(r: { body: { data?: unknown } }) => r.body.data as T;

function configure() {
  h.env.ZERNIO_API_KEY = ZERNIO_KEY;
  h.env.ZERNIO_WEBHOOK_SECRET = ZERNIO_SECRET;
}

/** Connect an account as `user` in `ws`, through Zernio's sign-in at the fake and the callback. */
async function connect(user: string, ws: string, platform: string, username: string) {
  const who = await person(user, ws);
  const start = await call("POST", `/gms/social/connect/${platform}`, who);
  expect(start.status).toBe(200);
  const back = new URL(fake.approve(data<{ authUrl: string }>(start).authUrl, username));
  const done = await call("POST", "/gms/social/connect/callback", who, { state: back.searchParams.get("gs"), profileId: back.searchParams.get("profileId"), accountId: back.searchParams.get("accountId"), connected: back.searchParams.get("connected"), username: back.searchParams.get("username") });
  expect(done.status).toBe(201);
  return { account: data<{ id: string; platform: string; username: string }>(done), back };
}

const compose = (accountIds: string[], extra: Record<string, unknown> = {}) => ({ subject: { type: "opportunity", id: OPP }, content: "Applications are open: Community Health Grants 2027. Apply by June 30, 2027.\n\nhttps://app.gms.test/f/riverbend/o/community-health-2027?utm_source=social", accountIds, ...extra });

async function previewAndPost(who: Record<string, string>, input: Record<string, unknown>, key = crypto.randomUUID()) {
  const p = await call("POST", "/gms/social/posts/preview", who, input);
  expect(p.status).toBe(200);
  const preview = data<{ previewToken: string; body: unknown }>(p);
  const sent = await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": key }, { ...input, previewToken: preview.previewToken });
  return { preview, sent, key };
}

beforeEach(async () => {
  h = await harness();
  fake = new FakeZernio({ apiKey: ZERNIO_KEY, now: () => h.clock.now });
  vi.stubGlobal("fetch", fake.fetch);
  share.listable = false;
  share.kit = null;
  await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: OTHER_ADMIN, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: SECOND_ADMIN, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: APPLICANT_ADMIN, role: "admin" });
  const published = h.clock.now.toISOString();
  await h.repos.table("opportunities").insert({ id: OPP, workspace_id: WS_FUNDER, slug: "community-health-2027", title: "Community Health Grants 2027", status: "open", published_at: published, key_dates: { closeDate: { name: "Applications close", eventType: "singleDate", date: "2027-06-30" } } });
  await h.repos.table("opportunities").insert({ id: OTHER_OPP, workspace_id: WS_OTHER, slug: "county-call", title: "County call", status: "open", published_at: published });
  await h.repos.table("awards").insert({ id: AWARD, workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile clinic", status: "accepted" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hidden when Zernio is not set up", () => {
  it("answers 404 on every route and the webhook, and the app is told it is off", async () => {
    const admin = await person(USER_ADMIN, WS_FUNDER);
    for (const [m, p] of [["GET", "/gms/social"], ["POST", "/gms/social/connect/linkedin"], ["POST", "/gms/social/posts"], ["GET", "/gms/social/posts"]] as const) {
      expect((await call(m, p, admin, m === "POST" ? {} : undefined)).status).toBe(404);
      expect((await call(m, p, { "Content-Type": "application/json" }, m === "POST" ? {} : undefined)).status).toBe(404);
    }
    expect((await call("POST", "/webhooks/zernio", { "Content-Type": "application/json" }, { event: "post.published" })).status).toBe(404);
    expect(data<{ available: { social: boolean } }>(await call("GET", "/gms/config", {})).available.social).toBe(false);
    h.env.ZERNIO_API_KEY = ZERNIO_KEY;
    // One of the two is not enough.
    expect((await call("GET", "/gms/social", admin)).status).toBe(404);
    configure();
    expect(data<{ available: { social: boolean } }>(await call("GET", "/gms/config", {})).available.social).toBe(true);
    expect((await call("GET", "/gms/social", admin)).status).toBe(200);
    expect(fake.requests).toEqual([]);
  });
});

describe("connect", () => {
  beforeEach(configure);

  it("creates the workspace's profile on first use and records the account Zernio lists", async () => {
    const { account, back } = await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    expect(fake.profiles).toEqual([{ _id: expect.any(String), name: "Riverbend Community Foundation", externalId: WS_FUNDER }]);
    const connectReq = fake.requests.find((r) => r.path === "/v1/connect/linkedin")!;
    expect(connectReq.query.redirect_url).toMatch(new RegExp(`^${WEB}/w/riverbend/settings/social\\?gs=v1\\.`));
    expect(back.origin + back.pathname).toBe(`${WEB}/w/riverbend/settings/social`);
    expect(account).toMatchObject({ platform: "linkedin", label: "LinkedIn", username: "riverbend-cf", status: "active" });
    const settings = data<{ accounts: unknown[]; canConnect: boolean; canPost: boolean; profileCreated: boolean }>(await call("GET", "/gms/social", await person(USER_ADMIN, WS_FUNDER)));
    expect(settings).toMatchObject({ profileCreated: true, canConnect: true, canPost: true, accounts: [{ id: account.id, platform: "linkedin" }] });
    // A second account reuses the profile.
    await connect(USER_ADMIN, WS_FUNDER, "bluesky", "riverbend.bsky.social");
    expect(fake.profiles).toHaveLength(1);
    expect(h.ledger.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["social.profile.created", "social.connect.started", "social.account.connected"]));
    // Stored: ids, platform and username only.
    const rows = await h.repos.table("social_accounts").find({ workspace_id: WS_FUNDER });
    expect(Object.keys(rows[0]!).sort()).toEqual(["connected_at", "connected_by", "created_at", "disconnected_at", "id", "platform", "status", "updated_at", "username", "workspace_id", "zernio_account_id"]);
  });

  it("refuses a forged, altered, expired or someone else's state, and an account Zernio does not list", async () => {
    const who = await person(USER_ADMIN, WS_FUNDER);
    const start = data<{ authUrl: string }>(await call("POST", "/gms/social/connect/linkedin", who));
    const back = new URL(fake.approve(start.authUrl, "riverbend-cf"));
    const good = { state: back.searchParams.get("gs")!, profileId: back.searchParams.get("profileId")!, accountId: back.searchParams.get("accountId")! };
    const refuse = async (headers: Record<string, string>, body: Record<string, unknown>, status = 403) => {
      const r = await call("POST", "/gms/social/connect/callback", headers, body);
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      return r;
    };
    // Forged with another key, or altered.
    await refuse(who, { ...good, state: await sealToken("not-the-server-key", "social-connect", { w: WS_FUNDER, u: USER_ADMIN, p: "linkedin" }, new Date(h.clock.now.getTime() + 60_000)) });
    await refuse(who, { ...good, state: good.state.replace(/\.(.)/, (_m, ch: string) => `.${ch === "A" ? "B" : "A"}`) });
    // Another admin of the same workspace, and another workspace's admin.
    await refuse(await person(SECOND_ADMIN, WS_FUNDER), good);
    await connect(OTHER_ADMIN, WS_OTHER, "twitter", "cascade");
    await refuse(await person(OTHER_ADMIN, WS_OTHER), good);
    // A profile id that is not this workspace's.
    const otherProfile = fake.profiles.find((p) => p.externalId === WS_OTHER)!._id;
    await refuse(who, { ...good, profileId: otherProfile });
    // An account that is not listed under this workspace's profile.
    const otherAccount = fake.accounts.find((a) => a.profileId === otherProfile)!._id;
    expect((await refuse(who, { ...good, accountId: otherAccount }, 409)).body.message).toMatch(/does not list that LinkedIn account/);
    // Expired after ten minutes.
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60 * 1000);
    await refuse(await person(USER_ADMIN, WS_FUNDER), good);
    expect(await h.repos.table("social_accounts").find({ workspace_id: WS_FUNDER })).toEqual([]);
  });

  it("connecting and disconnecting are a person's, and an admin's", async () => {
    expect((await call("POST", "/gms/social/connect/linkedin", await person(USER_OFFICER, WS_FUNDER))).status).toBe(403);
    expect((await call("POST", "/gms/social/connect/linkedin", await agent(USER_ADMIN, WS_FUNDER, "workspace:admin"))).status).toBe(403);
    const cc = await clientCredentialsToken(h, "workspace:admin");
    expect((await call("POST", "/gms/social/connect/linkedin", json({ Authorization: `Bearer ${cc}`, "X-GMS-Workspace": WS_FUNDER }))).status).toBe(403);
    const { account } = await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    expect((await call("DELETE", `/gms/social/accounts/${account.id}`, await agent(USER_ADMIN, WS_FUNDER, "workspace:admin"))).status).toBe(403);
    expect((await call("DELETE", `/gms/social/accounts/${account.id}`, await person(OTHER_ADMIN, WS_OTHER))).status).toBe(404);
    const off = await call("DELETE", `/gms/social/accounts/${account.id}`, await person(USER_ADMIN, WS_FUNDER));
    expect(off.status).toBe(200);
    expect(data(off)).toMatchObject({ status: "disconnected" });
    expect(fake.accounts[0]!.active).toBe(false);
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });
});

describe("compose, preview and post", () => {
  beforeEach(configure);

  it("prefills from the open call: title, deadline, the shared link and its share card", async () => {
    const d = data<{ shareable: boolean; suggestions: { text: string }[]; link: string; imageUrl: string }>(await call("GET", `/gms/social/compose?subjectType=opportunity&subjectId=${OPP}`, await person(USER_OFFICER, WS_FUNDER)));
    expect(d).toMatchObject({ shareable: true, link: `${WEB}/f/riverbend/o/community-health-2027?utm_source=social`, imageUrl: `${WEB}/og/f/riverbend/o/community-health-2027.png` });
    expect(d.suggestions[0]!.text).toBe(`Applications are open: Community Health Grants 2027, from Riverbend Community Foundation. Apply by June 30, 2027.\n\n${WEB}/f/riverbend/o/community-health-2027?utm_source=social`);
    // An agent may read the draft (to help write it), never send it.
    expect((await call("GET", `/gms/social/compose?subjectType=opportunity&subjectId=${OPP}`, await agent(USER_ADMIN, WS_FUNDER, "analytics:read"))).status).toBe(200);
    // Another workspace's call is not found.
    expect((await call("GET", `/gms/social/compose?subjectType=opportunity&subjectId=${OTHER_OPP}`, await person(USER_ADMIN, WS_FUNDER))).status).toBe(404);
  });

  it("sends exactly what the preview showed, once, with the Idempotency-Key", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const bs = (await connect(USER_ADMIN, WS_FUNDER, "bluesky", "riverbend.bsky.social")).account;
    const who = await person(USER_OFFICER, WS_FUNDER);
    const { preview, sent, key } = await previewAndPost(who, compose([li.id, bs.id]));
    expect(sent.status).toBe(201);
    const posted = fake.requests.filter((r) => r.path === "/v1/posts" && r.method === "POST");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual(preview.body);
    expect(posted[0]!.idempotencyKey).toBe(key);
    expect(preview.body).toMatchObject({ mediaItems: [{ type: "image", url: `${WEB}/og/f/riverbend/o/community-health-2027.png` }], publishNow: true, platforms: [{ platform: "linkedin" }, { platform: "bluesky" }] });
    expect(data(sent)).toMatchObject({ status: "published", platforms: ["linkedin", "bluesky"], accounts: [{ platform: "linkedin", status: "published", url: expect.stringMatching(/^https:\/\/linkedin\.example\//) }, { platform: "bluesky", status: "published" }] });
    const row = (await h.repos.table("social_posts").find({ workspace_id: WS_FUNDER }))[0]!;
    // The text is not kept; its digest is.
    expect(JSON.stringify(row)).not.toContain("Applications are open");
    expect(row.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.ledger.events.find((e) => e.eventType === "social.post.published")).toMatchObject({ actor: `user:${USER_OFFICER}` });
  });

  it("refuses a post that changed after the preview, or that was never previewed", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const who = await person(USER_ADMIN, WS_FUNDER);
    const p = data<{ previewToken: string }>(await call("POST", "/gms/social/posts/preview", who, compose([li.id])));
    const changed = await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": crypto.randomUUID() }, { ...compose([li.id]), content: "Something else", previewToken: p.previewToken });
    expect(changed.status).toBe(409);
    expect(changed.body.message).toMatch(/changed after the preview/);
    const noImage = await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": crypto.randomUUID() }, { ...compose([li.id]), includeImage: false, previewToken: p.previewToken });
    expect(noImage.status).toBe(409);
    // Another person's preview token is not this person's.
    const other = await call("POST", "/gms/social/posts", { ...(await person(SECOND_ADMIN, WS_FUNDER)), "Idempotency-Key": crypto.randomUUID() }, { ...compose([li.id]), previewToken: p.previewToken });
    expect(other.status).toBe(409);
    expect((await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": crypto.randomUUID() }, { ...compose([li.id]), previewToken: "v1.bogus.token" })).status).toBe(409);
    expect((await call("POST", "/gms/social/posts", who, { ...compose([li.id]), previewToken: p.previewToken })).status).toBe(400);
    expect(fake.requests.filter((r) => r.path === "/v1/posts")).toEqual([]);
  });

  it("shows each platform's limit and holds a post that is too long or needs a picture", async () => {
    const x = (await connect(USER_ADMIN, WS_FUNDER, "twitter", "riverbendcf")).account;
    const ig = (await connect(USER_ADMIN, WS_FUNDER, "instagram", "riverbendcf")).account;
    const who = await person(USER_ADMIN, WS_FUNDER);
    const p = data<{ lengths: { platform: string; length: number; limit: number; over: boolean }[]; problems: string[]; previewToken: string | null }>(await call("POST", "/gms/social/posts/preview", who, compose([x.id, ig.id], { content: `${"a".repeat(270)} https://app.gms.test/f/riverbend/o/community-health-2027`, includeImage: false })));
    expect(p.lengths).toEqual([
      { platform: "twitter", label: "X", length: 294, limit: 280, over: true },
      { platform: "instagram", label: "Instagram", length: 327, limit: 2200, over: false },
    ]);
    expect(p.problems).toHaveLength(2);
    expect(p.previewToken).toBeNull();
  });

  it("schedules with a time and a time zone", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const { preview, sent } = await previewAndPost(await person(USER_ADMIN, WS_FUNDER), compose([li.id], { schedule: { scheduledFor: "2027-05-01T09:00", timezone: "America/Chicago" } }));
    expect(preview.body).toMatchObject({ scheduledFor: "2027-05-01T09:00:00", timezone: "America/Chicago" });
    expect(data(sent)).toMatchObject({ status: "scheduled", scheduledFor: "2027-05-01T14:00:00.000Z", timezone: "America/Chicago" });
  });

  it("is a person's click: agent and API-client tokens are refused on preview and post", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const p = data<{ previewToken: string }>(await call("POST", "/gms/social/posts/preview", await person(USER_ADMIN, WS_FUNDER), compose([li.id])));
    const delegated = await agent(USER_ADMIN, WS_FUNDER, "communications:write analytics:read");
    for (const [path, body] of [["/gms/social/posts/preview", compose([li.id])], ["/gms/social/posts", { ...compose([li.id]), previewToken: p.previewToken }]] as const) {
      const r = await call("POST", path, { ...delegated, "Idempotency-Key": crypto.randomUUID() }, body);
      expect(r.status).toBe(403);
      expect(r.body.errors?.[0]?.code ?? r.body.code).toBe("human_only");
    }
    const cc = await clientCredentialsToken(h, "workspace:admin");
    expect((await call("POST", "/gms/social/posts", json({ Authorization: `Bearer ${cc}`, "X-GMS-Workspace": WS_FUNDER, "Idempotency-Key": crypto.randomUUID() }), { ...compose([li.id]), previewToken: p.previewToken })).status).toBe(403);
    // Roles that may not post: an auditor.
    expect((await call("POST", "/gms/social/posts/preview", await person(USER_AUDITOR, WS_FUNDER), compose([li.id]))).status).toBe(403);
    expect(fake.requests.filter((r) => r.path === "/v1/posts")).toEqual([]);
  });

  it("never reaches another workspace's accounts, posts or calls", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const x = (await connect(OTHER_ADMIN, WS_OTHER, "twitter", "cascade")).account;
    const other = await person(OTHER_ADMIN, WS_OTHER);
    // Riverbend's account named from Cascade's workspace.
    const r1 = await call("POST", "/gms/social/posts/preview", other, { ...compose([li.id]), subject: { type: "opportunity", id: OTHER_OPP } });
    expect(r1.status).toBe(422);
    // Riverbend's call from Cascade's workspace, with Cascade's own account.
    expect((await call("POST", "/gms/social/posts/preview", other, compose([x.id]))).status).toBe(404);
    // Cascade's account from Riverbend's workspace.
    expect((await call("POST", "/gms/social/posts/preview", await person(USER_ADMIN, WS_FUNDER), compose([x.id]))).status).toBe(422);
    await previewAndPost(await person(USER_ADMIN, WS_FUNDER), compose([li.id]));
    const reach = data<{ posts: unknown[] }>(await call("GET", "/gms/social/posts", other));
    expect(reach.posts).toEqual([]);
    expect((await call("GET", `/gms/social/posts?subjectType=opportunity&subjectId=${OPP}`, other)).status).toBe(404);
    expect(data<{ accounts: { id: string }[] }>(await call("GET", "/gms/social", other)).accounts.map((a) => a.id)).toEqual([x.id]);
  });
});

describe("idempotent retries", () => {
  beforeEach(configure);

  it("the same key again returns the post already made, without a second post", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const who = await person(USER_ADMIN, WS_FUNDER);
    const first = await previewAndPost(who, compose([li.id]));
    const again = await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": first.key }, { ...compose([li.id]), previewToken: first.preview.previewToken });
    expect(again.status).toBe(201);
    expect(data(again).id).toBe(data(first.sent).id);
    expect(fake.posts).toHaveLength(1);
    expect(fake.requests.filter((r) => r.path === "/v1/posts" && r.method === "POST")).toHaveLength(1);
    // The same key with other content is refused.
    const p2 = data<{ previewToken: string }>(await call("POST", "/gms/social/posts/preview", who, { ...compose([li.id]), content: "Other text" }));
    expect((await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": first.key }, { ...compose([li.id]), content: "Other text", previewToken: p2.previewToken })).status).toBe(409);
  });

  it("Zernio down: the post waits as sending, and posting again goes out once", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const who = await person(USER_ADMIN, WS_FUNDER);
    fake.failNext = { status: 503, times: 1 };
    const first = await previewAndPost(who, compose([li.id]));
    expect(first.sent.status).toBe(503);
    expect(first.sent.body.message).toBe("Zernio did not confirm this post. Post again: it will not go out twice");
    expect((await h.repos.table("social_posts").find({ workspace_id: WS_FUNDER }))[0]).toMatchObject({ status: "sending" });
    const retry = await call("POST", "/gms/social/posts", { ...who, "Idempotency-Key": first.key }, { ...compose([li.id]), previewToken: first.preview.previewToken });
    expect(retry.status).toBe(201);
    expect(data(retry)).toMatchObject({ status: "published" });
    expect(fake.posts).toHaveLength(1);
    expect(fake.requests.filter((r) => r.path === "/v1/posts").map((r) => r.idempotencyKey)).toEqual([first.key, first.key]);
  });

  it("Zernio's 409 (same content to the same account within a day) counts as sent", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const who = await person(USER_ADMIN, WS_FUNDER);
    const first = await previewAndPost(who, compose([li.id]));
    const second = await previewAndPost(who, compose([li.id]));
    expect(second.sent.status).toBe(201);
    // The same post: nothing new went out, and the report lists it once.
    expect(data(second.sent)).toMatchObject({ id: data(first.sent).id, status: "published" });
    expect(fake.posts).toHaveLength(1);
    expect(await h.repos.table("social_posts").find({ workspace_id: WS_FUNDER })).toHaveLength(1);
    expect(h.ledger.events.map((e) => e.eventType).filter((t) => t.startsWith("social.post."))).toEqual(["social.post.published", "social.post.duplicate"]);
    // Sent outside the GMS first: Zernio's 409 still counts as sent, and the post is recorded.
    fake.posts[0]!.key = "made-elsewhere";
    await h.repos.table("social_posts").remove({ workspace_id: WS_FUNDER });
    const third = await previewAndPost(who, compose([li.id]));
    expect(data(third.sent)).toMatchObject({ status: "published" });
    expect((await h.repos.table("social_posts").find({ workspace_id: WS_FUNDER }))[0]!.zernio_post_id).toBe(fake.posts[0]!._id);
  });
});

describe("reach", () => {
  beforeEach(configure);

  it("per post: the links, statuses and Zernio's counts; per call: applications started from a shared link", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const { sent } = await previewAndPost(await person(USER_ADMIN, WS_FUNDER), compose([li.id]));
    const zid = (await h.repos.table("social_posts").one({ id: data(sent).id as string }))!.zernio_post_id!;
    fake.metrics.set(zid, { impressions: 1200, clicks: 48, likes: 30, comments: 4, shares: 6 });
    // Two applications started, one from the shared link.
    const comp = await h.repos.table("competitions").insert({ workspace_id: WS_FUNDER, opportunity_id: OPP, title: "Round 1", status: "open" });
    for (const utm of ["social", null]) {
      const app = await h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: comp.id, opportunity_id: OPP, stage: "full" });
      await h.repos.table("application_events").insert({ workspace_id: WS_FUNDER, application_id: app.id, type: "started", actor: `user:${USER_OFFICER}`, payload: utm ? { utmSource: utm } : {} });
    }
    // An auditor reads the report; so does an agent with the read scope (MCP's capability too).
    const r = data<{ posts: { metrics: Record<string, unknown>; accounts: { url: string }[] }[]; totals: Record<string, unknown>; applicationsFromSocial: number }>(await call("GET", `/gms/social/posts?subjectType=opportunity&subjectId=${OPP}`, await person(USER_AUDITOR, WS_FUNDER)));
    expect(r.posts[0]!.metrics).toMatchObject({ impressions: 1200, clicks: 48, engagements: 40 });
    expect(r.posts[0]!.accounts[0]!.url).toMatch(/^https:\/\//);
    expect(r.totals).toEqual({ posts: 1, impressions: 1200, clicks: 48, engagements: 40 });
    expect(r.applicationsFromSocial).toBe(1);
    // Counts are cached: a second read within half an hour does not ask Zernio again.
    const asked = fake.requests.filter((x) => x.path === "/v1/analytics").length;
    await call("GET", `/gms/social/posts?subjectType=opportunity&subjectId=${OPP}`, await agent(USER_ADMIN, WS_FUNDER, "analytics:read"));
    expect(fake.requests.filter((x) => x.path === "/v1/analytics")).toHaveLength(asked);
  });
});

describe("awards", () => {
  beforeEach(configure);

  it("are never offered while the award is not publicly listable", async () => {
    const d = data<{ shareable: boolean; reason: string; suggestions: unknown[] }>(await call("GET", `/gms/social/compose?subjectType=award&subjectId=${AWARD}`, await person(USER_OFFICER, WS_APPLICANT)));
    expect(d).toMatchObject({ shareable: false, suggestions: [] });
    expect(d.reason).toMatch(/not listed publicly/);
    const bs = (await connect(APPLICANT_ADMIN, WS_APPLICANT, "bluesky", "aldercreek.bsky.social")).account;
    const r = await call("POST", "/gms/social/posts/preview", await person(USER_OFFICER, WS_APPLICANT), { subject: { type: "award", id: AWARD }, content: "We won", accountIds: [bs.id] });
    expect(r.status).toBe(409);
  });

  it("a grantee posts its share kit when the award is listable", async () => {
    share.listable = true;
    share.kit = { posts: [{ kind: "linkedin", label: "LinkedIn", text: `Alder Creek Family Services received a grant from Riverbend. ${WEB}/f/riverbend/awards/mobile-clinic` }], link: `${WEB}/f/riverbend/awards/mobile-clinic`, imageUrl: `${WEB}/og/f/riverbend/awards/mobile-clinic.png` };
    const bs = (await connect(APPLICANT_ADMIN, WS_APPLICANT, "bluesky", "aldercreek.bsky.social")).account;
    const editor = await person(USER_OFFICER, WS_APPLICANT);
    const d = data<{ suggestions: { text: string }[] }>(await call("GET", `/gms/social/compose?subjectType=award&subjectId=${AWARD}`, editor));
    expect(d.suggestions[0]!.text).toBe(`Alder Creek Family Services received a grant from Riverbend. ${WEB}/f/riverbend/awards/mobile-clinic?utm_source=social`);
    const { sent, preview } = await previewAndPost(editor, { subject: { type: "award", id: AWARD }, content: d.suggestions[0]!.text, accountIds: [bs.id] });
    expect(sent.status).toBe(201);
    expect(fake.requests.filter((r) => r.path === "/v1/posts")[0]!.body).toEqual(preview.body);
    // The funder's posts and the grantee's are each their own workspace's.
    expect(data<{ posts: unknown[] }>(await call("GET", `/gms/social/posts?subjectType=award&subjectId=${AWARD}`, await person(USER_ADMIN, WS_FUNDER))).posts).toEqual([]);
    expect(data<{ posts: unknown[] }>(await call("GET", `/gms/social/posts?subjectType=award&subjectId=${AWARD}`, editor)).posts).toHaveLength(1);
  });
});

describe("webhook", () => {
  beforeEach(configure);

  const deliver = async (event: Record<string, unknown>, sign: (raw: string) => Promise<string> = (raw) => signZernioBody(ZERNIO_SECRET, raw)) => {
    const raw = JSON.stringify(event);
    const res = await h.request("/webhooks/zernio", { method: "POST", headers: { "Content-Type": "application/json", "X-Zernio-Signature": await sign(raw) }, body: raw });
    return { status: res.status, body: (await res.json()) as { message: string } };
  };

  async function scheduledPost() {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const { sent } = await previewAndPost(await person(USER_ADMIN, WS_FUNDER), compose([li.id], { schedule: { scheduledFor: "2027-05-01T09:00", timezone: "America/Chicago" } }));
    const row = (await h.repos.table("social_posts").one({ id: data(sent).id as string }))!;
    const zernioPost = fake.publish(row.zernio_post_id!);
    return { row, zernioPost, li };
  }

  it("applies a signed event once: valid, invalid and replayed", async () => {
    const { row, zernioPost } = await scheduledPost();
    const event = { id: "evt_pub_1", event: "post.published", timestamp: h.clock.now.toISOString(), profiles: [{ _id: fake.profiles[0]!._id, externalId: WS_FUNDER }], post: { _id: zernioPost._id, status: "published", platforms: zernioPost.platforms } };
    const bad = await deliver(event, async () => "0".repeat(64));
    expect(bad.status).toBe(401);
    expect(await h.repos.table("inbound_events").find({ provider: "zernio" })).toEqual([]);
    expect((await deliver(event, async () => "")).status).toBe(401);
    const ok = await deliver(event);
    expect(ok).toEqual({ status: 200, body: { status: 200, message: "processed" } });
    expect(await h.repos.table("social_posts").one({ id: row.id })).toMatchObject({ status: "published" });
    const replay = await deliver(event);
    expect(replay.body.message).toBe("duplicate");
    expect(h.ledger.events.filter((e) => e.eventType === "social.post.published")).toHaveLength(1);
    // Stored: the event's facts, never its body.
    expect((await h.repos.table("inbound_events").find({ provider: "zernio" }))[0]!.payload).toEqual({ type: "post.published", profileExternalId: WS_FUNDER, profileId: fake.profiles[0]!._id, accountId: null, postId: zernioPost._id });
    // An old delivery is not applied, whatever its signature.
    expect((await deliver({ ...event, id: "evt_old", timestamp: new Date(h.clock.now.getTime() - 2 * 86_400_000).toISOString() })).status).toBe(400);
  });

  it("applies an event only to the workspace whose profile it names", async () => {
    const { row, zernioPost } = await scheduledPost();
    await connect(OTHER_ADMIN, WS_OTHER, "twitter", "cascade");
    const otherProfile = fake.profiles.find((p) => p.externalId === WS_OTHER)!;
    // Cascade's profile naming Riverbend's post.
    const r = await deliver({ id: "evt_x", event: "post.failed", profiles: [{ _id: otherProfile._id, externalId: WS_OTHER }], post: { _id: zernioPost._id, status: "failed", platforms: [] } });
    expect(r.body.message).toBe("ignored");
    // Riverbend's externalId with Cascade's profile id.
    expect((await deliver({ id: "evt_y", event: "post.failed", profiles: [{ _id: otherProfile._id, externalId: WS_FUNDER }], post: { _id: zernioPost._id, status: "failed" } })).body.message).toBe("ignored");
    expect(await h.repos.table("social_posts").one({ id: row.id })).toMatchObject({ status: "scheduled" });
  });

  it("an account disconnected at Zernio shows as disconnected", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    const zid = (await h.repos.table("social_accounts").one({ id: li.id }))!.zernio_account_id;
    const r = await deliver({ id: "evt_dc", event: "account.disconnected", profiles: [{ externalId: WS_FUNDER }], account: { _id: zid, platform: "linkedin", username: "riverbend-cf" } });
    expect(r.body.message).toBe("processed");
    expect(await h.repos.table("social_accounts").one({ id: li.id })).toMatchObject({ status: "disconnected" });
    expect(data<{ accounts: unknown[] }>(await call("GET", "/gms/social", await person(USER_ADMIN, WS_FUNDER))).accounts).toEqual([]);
  });
});

describe("agents over MCP", () => {
  beforeEach(configure);

  const rpc = async (headers: Record<string, string>, method: string, params?: unknown) => {
    const res = await h.request("/mcp", { method: "POST", headers: { ...headers, Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
    return (await res.json()) as { result: { tools?: { name: string }[]; structuredContent?: Record<string, unknown> } };
  };

  it("read posts and reach, and have no tool that posts, schedules or connects", async () => {
    const li = (await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf")).account;
    await previewAndPost(await person(USER_ADMIN, WS_FUNDER), compose([li.id]));
    const token = await agent(USER_ADMIN, WS_FUNDER, "analytics:read communications:write workspace:admin");
    const tools = (await rpc(token, "tools/list")).result.tools!.map((t) => t.name);
    expect(tools.filter((n) => /social|zernio|connect_account|schedule_post/.test(n))).toEqual(["list_social_posts"]);
    const out = (await rpc(token, "tools/call", { name: "list_social_posts", arguments: { opportunityId: prefixedId("opportunity", OPP) } })).result.structuredContent!;
    expect(out).toMatchObject({ totals: { posts: 1 }, posts: [{ status: "published", platforms: ["linkedin"] }], applicationsFromSocial: 0 });
    // The same authorization as the screen: another workspace's call is not found.
    const other = await agent(OTHER_ADMIN, WS_OTHER, "analytics:read");
    expect((await rpc(other, "tools/call", { name: "list_social_posts", arguments: { opportunityId: prefixedId("opportunity", OPP) } })).result.structuredContent).toMatchObject({ error: { code: "not_found" } });
    expect((await rpc(other, "tools/call", { name: "list_social_posts", arguments: {} })).result.structuredContent).toMatchObject({ posts: [] });
  });

  it("a grantee's agent reads its own award posts", async () => {
    const token = await agent(USER_OFFICER, WS_APPLICANT, "awards:read");
    const tools = (await rpc(token, "tools/list")).result.tools!.map((t) => t.name);
    expect(tools.filter((n) => /social/.test(n))).toEqual(["list_social_posts"]);
    expect((await rpc(token, "tools/call", { name: "list_social_posts", arguments: { awardId: prefixedId("award", AWARD) } })).result.structuredContent).toMatchObject({ posts: [], applicationsFromSocial: null });
  });
});
