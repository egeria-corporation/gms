// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildPostBody,
  canonicalJson,
  checkCompose,
  FakeZernio,
  lengthCheck,
  metricsOf,
  openToken,
  parseZernioEvent,
  postDigest,
  sealToken,
  signZernioBody,
  textLength,
  verifyZernioSignature,
  ZernioClient,
  ZernioError,
  zonedToUtc,
} from "../src/index.ts";

const KEY = "zk_test_fake_key_not_real";
const NOW = new Date("2027-04-16T17:00:00Z");

const setup = () => {
  const fake = new FakeZernio({ apiKey: KEY, now: () => NOW });
  const client = new ZernioClient({ apiKey: KEY, fetch: fake.fetch });
  return { fake, client };
};

describe("platform limits", () => {
  it("counts every link on X as 23 characters", () => {
    const text = `Open call ${"https://gms.opengrants.io/f/riverbend/o/a-very-long-slug-for-a-call?utm_source=social"}`;
    expect(textLength("twitter", text)).toBe("Open call ".length + 23);
    expect(textLength("linkedin", text)).toBe(Array.from(text).length);
  });
  it("counts what a reader sees as one character on Bluesky", () => {
    expect(textLength("bluesky", "👩‍👩‍👧 grant")).toBe(7);
  });
  it("flags a post over the limit", () => {
    expect(lengthCheck("twitter", "x".repeat(281))).toMatchObject({ over: true, limit: 280, length: 281, label: "X" });
    expect(lengthCheck("linkedin", "x".repeat(281)).over).toBe(false);
  });
});

describe("compose", () => {
  const targets = [{ platform: "linkedin" as const, accountId: "acc_1" }];
  it("builds the body once, and equal bodies have equal digests", async () => {
    const a = buildPostBody({ content: "Hello", imageUrl: "https://app.test/og.png", targets, schedule: null });
    expect(a).toEqual({ content: "Hello", mediaItems: [{ type: "image", url: "https://app.test/og.png" }], platforms: [{ platform: "linkedin", accountId: "acc_1" }], publishNow: true });
    const b = JSON.parse(JSON.stringify(a));
    expect(await postDigest(b)).toBe(await postDigest(a));
    expect(await postDigest({ ...a, content: "Hello!" })).not.toBe(await postDigest(a));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it("schedules with a wall-clock time and a time zone", () => {
    const body = buildPostBody({ content: "x", imageUrl: null, targets, schedule: { scheduledFor: "2027-05-01T09:00", timezone: "America/Chicago" } });
    expect(body).toMatchObject({ scheduledFor: "2027-05-01T09:00:00", timezone: "America/Chicago" });
    expect(body).not.toHaveProperty("publishNow");
    expect(zonedToUtc("2027-05-01T09:00", "America/Chicago")?.toISOString()).toBe("2027-05-01T14:00:00.000Z");
    expect(zonedToUtc("2027-01-15T09:00", "America/Chicago")?.toISOString()).toBe("2027-01-15T15:00:00.000Z");
    expect(zonedToUtc("2027-02-30T09:00", "UTC")).toBeNull();
    expect(zonedToUtc("2027-05-01T09:00", "Not/AZone")).toBeNull();
  });
  it("says what stops a post", () => {
    const c = checkCompose({ content: "x".repeat(300), imageUrl: null, targets: [{ platform: "twitter", accountId: "a" }, { platform: "instagram", accountId: "b" }], schedule: { scheduledFor: "2027-04-16T10:00", timezone: "America/Los_Angeles" } }, NOW);
    expect(c.problems).toEqual([
      "X takes at most 280 characters; this post has 300.",
      "Instagram needs a picture. Keep the share image, or leave Instagram out.",
      "Schedule the post at least five minutes from now, or post it now.",
    ]);
    expect(checkCompose({ content: " ", imageUrl: null, targets: [], schedule: null }, NOW).problems).toEqual(["Write the post first.", "Choose at least one account to post to."]);
    expect(checkCompose({ content: "ok", imageUrl: null, targets, schedule: { scheduledFor: "2027-04-17T09:00", timezone: "UTC" } }, NOW).problems).toEqual([]);
  });
});

describe("sealed tokens", () => {
  it("opens only what it sealed, with the same label, before it expires", async () => {
    const t = await sealToken("k1", "connect", { w: "ws-1" }, new Date(NOW.getTime() + 60_000));
    expect(await openToken("k1", "connect", t, NOW)).toMatchObject({ w: "ws-1" });
    expect(await openToken("k2", "connect", t, NOW)).toBeNull();
    expect(await openToken("k1", "preview", t, NOW)).toBeNull();
    expect(await openToken("k1", "connect", t, new Date(NOW.getTime() + 61_000))).toBeNull();
    const [v, body, mac] = t.split(".");
    const forged = `${v}.${btoa(JSON.stringify({ w: "ws-2", exp: 9e9 })).replace(/=+$/, "")}.${mac}`;
    expect(await openToken("k1", "connect", forged, NOW)).toBeNull();
    expect(await openToken("k1", "connect", `${v}.${body}`, NOW)).toBeNull();
  });
});

describe("webhook signature", () => {
  const SECRET = "zernio-webhook-secret-for-tests";
  it("accepts the HMAC-SHA256 of the raw body, and nothing else", async () => {
    const raw = JSON.stringify({ event: "post.published", post: { _id: "post_1" } });
    const sig = await signZernioBody(SECRET, raw);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyZernioSignature(SECRET, raw, sig)).toBe(true);
    expect(await verifyZernioSignature(SECRET, raw, sig.toUpperCase())).toBe(true);
    expect(await verifyZernioSignature(SECRET, `${raw} `, sig)).toBe(false);
    expect(await verifyZernioSignature("other", raw, sig)).toBe(false);
    expect(await verifyZernioSignature(SECRET, raw, null)).toBe(false);
    expect(await verifyZernioSignature(SECRET, raw, "abc")).toBe(false);
  });
  it("reads only the ids, platforms, statuses and links", async () => {
    const raw = JSON.stringify({
      id: "evt_1",
      event: "post.partial",
      timestamp: "2027-04-16T17:00:00Z",
      profiles: [{ _id: "prof_1", externalId: "ws-1" }],
      post: { _id: "post_1", status: "partial", content: "text", platforms: [{ platform: "linkedin", accountId: "acc_1", status: "published", platformPostUrl: "https://linkedin.example/p/1", accessToken: "nope" }, { platform: "twitter", accountId: { _id: "acc_2" }, status: "failed" }] },
      message: { text: "an inbox message" },
    });
    const e = await parseZernioEvent(raw);
    expect(e).toEqual({
      id: "evt_1",
      type: "post.partial",
      occurredAt: "2027-04-16T17:00:00.000Z",
      profileExternalId: "ws-1",
      profileId: "prof_1",
      profiles: [{ id: "prof_1", externalId: "ws-1" }],
      account: null,
      accountId: null,
      post: { id: "post_1", status: "partial", scheduledFor: null, platforms: [{ platform: "linkedin", accountId: "acc_1", status: "published", url: "https://linkedin.example/p/1" }, { platform: "twitter", accountId: "acc_2", status: "failed", url: null }] },
    });
    // Zernio's documented shape: `id` ids, platforms by name only, every profile listed.
    const documented = await parseZernioEvent(JSON.stringify({ id: "evt_2", event: "post.cancelled", post: { id: "post_2", status: "cancelled", platforms: [{ platform: "bluesky", status: "cancelled", platformPostUrl: null }] }, profiles: [{ id: "prof_2", externalId: "ws-2" }, { id: "prof_3", externalId: "ws-3" }] }));
    expect(documented).toMatchObject({ type: "post.cancelled", profiles: [{ id: "prof_2", externalId: "ws-2" }, { id: "prof_3", externalId: "ws-3" }], post: { id: "post_2", platforms: [{ platform: "bluesky", accountId: null, status: "cancelled", url: null }] } });
    // Without an id, an exact replay of the body has the same one.
    const noId = JSON.stringify({ event: "account.disconnected", account: { _id: "acc_1", platform: "x-unknown" } });
    expect((await parseZernioEvent(noId))?.id).toBe((await parseZernioEvent(noId))?.id);
    expect((await parseZernioEvent(noId))?.accountId).toBe("acc_1");
    expect(await parseZernioEvent("not json")).toBeNull();
  });
});

describe("client against the fake", () => {
  it("creates one profile per externalId and recovers it", async () => {
    const { client, fake } = setup();
    const a = await client.ensureProfile({ name: "Riverbend", externalId: "ws-1" });
    const b = await client.ensureProfile({ name: "Riverbend", externalId: "ws-1" });
    expect(b).toEqual(a);
    expect(fake.profiles).toHaveLength(1);
    expect(await client.findProfile("ws-2")).toBeNull();
  });
  it("connects, lists and disconnects an account", async () => {
    const { client, fake } = setup();
    const { id } = await client.ensureProfile({ name: "R", externalId: "ws-1" });
    const { authUrl } = await client.connectLink("linkedin", id, "https://app.test/w/r/settings/social?gs=abc");
    const back = new URL(fake.approve(authUrl, "riverbend-cf"));
    expect(back.searchParams.get("gs")).toBe("abc");
    expect(back.searchParams.get("connected")).toBe("linkedin");
    const accounts = await client.listAccounts(id);
    expect(accounts).toEqual([{ id: back.searchParams.get("accountId"), platform: "linkedin", username: "riverbend-cf", profileId: id }]);
    await client.disconnectAccount(accounts[0]!.id);
    expect(await client.listAccounts(id)).toEqual([]);
    await client.disconnectAccount(accounts[0]!.id);
  });
  it("posts with an Idempotency-Key: a replay returns the original, a duplicate is a 409 treated as sent", async () => {
    const { client, fake } = setup();
    const { id } = await client.ensureProfile({ name: "R", externalId: "ws-1" });
    const back = new URL(fake.approve((await client.connectLink("bluesky", id, "https://app.test/cb")).authUrl, "riverbend.bsky"));
    const body = buildPostBody({ content: "Open call", imageUrl: null, targets: [{ platform: "bluesky", accountId: back.searchParams.get("accountId")! }], schedule: null });
    const first = await client.createPost(body, "key-1");
    expect(first).toMatchObject({ outcome: "accepted", post: { status: "published", platforms: [{ platform: "bluesky", status: "published" }] } });
    expect(first.post?.platforms[0]?.url).toMatch(/^https:\/\/bluesky\.example\//);
    const again = await client.createPost(body, "key-1");
    expect(again.post?.id).toBe(first.post?.id);
    const dup = await client.createPost(body, "key-2");
    expect(dup).toMatchObject({ outcome: "duplicate", post: { id: first.post?.id } });
    expect(fake.posts).toHaveLength(1);
    expect(fake.requests.filter((r) => r.path === "/v1/posts").map((r) => r.idempotencyKey)).toEqual(["key-1", "key-1", "key-2"]);
  });
  it("reads counts where Zernio gives them", async () => {
    expect(metricsOf({ analytics: { impressions: 120, clicks: 7, likes: 4, comments: 1, shares: 2 } })).toEqual({ impressions: 120, clicks: 7, engagements: 7 });
    expect(metricsOf({ platformAnalytics: [{ analytics: { views: 10, engagements: 3 } }, { analytics: { impressions: 5 } }] })).toEqual({ impressions: 15, clicks: null, engagements: 3 });
    expect(metricsOf({ analytics: {} })).toBeNull();
    const { client } = setup();
    expect(await client.postMetrics("post_none")).toBeNull();
  });
  it("names the failure without repeating Zernio's text or the key", async () => {
    const fake = new FakeZernio({ apiKey: KEY });
    const wrong = new ZernioClient({ apiKey: "zk_wrong", fetch: fake.fetch });
    const e = await wrong.findProfile("ws-1").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ZernioError);
    expect((e as ZernioError).kind).toBe("auth");
    expect(String((e as Error).message)).not.toContain("zk_wrong");
    fake.failNext = { status: 503, times: 1 };
    const client = new ZernioClient({ apiKey: KEY, fetch: fake.fetch });
    expect(((await client.findProfile("ws-1").catch((x: unknown) => x)) as ZernioError).kind).toBe("unavailable");
    const down = new ZernioClient({ apiKey: KEY, fetch: async () => Promise.reject(new Error("network")) });
    expect(((await down.listAccounts("p").catch((x: unknown) => x)) as ZernioError).kind).toBe("unavailable");
  });
});
