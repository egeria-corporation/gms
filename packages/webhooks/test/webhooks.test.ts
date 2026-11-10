// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  BACKOFF_SCHEDULE_SEC,
  MAX_ATTEMPTS,
  MemoryWebhookStore,
  RETRY_WINDOW_SEC,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  attemptDelivery,
  decryptSecret,
  deliverDue,
  encryptSecret,
  fanOut,
  generateWebhookSecret,
  nextAttemptAt,
  signPayload,
  verifySignature,
  type WebhookEvent,
} from "../src/index.ts";

// 32-byte AES test key: the bytes 0..31, base64url (allow-listed in .gitleaks.toml).
const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const NOW = new Date("2027-05-25T12:00:00Z");

const event: WebhookEvent = { id: "evt_1", type: "tranche.status.changed", workspaceId: "ws1", occurredAt: NOW.toISOString(), data: { trancheId: "trn_1", status: "settled" } };

describe("signing", () => {
  it("round-trips and rejects tampering, staleness and missing headers", async () => {
    const secret = generateWebhookSecret();
    const body = JSON.stringify(event);
    const ts = Math.floor(NOW.getTime() / 1000);
    const signature = await signPayload(secret, ts, body);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    const base = { secret, body, signature, timestamp: String(ts), now: NOW };
    expect(await verifySignature(base)).toEqual({ ok: true });
    expect(await verifySignature({ ...base, body: body.replace("settled", "failed") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifySignature({ ...base, secret: generateWebhookSecret() })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifySignature({ ...base, now: new Date(NOW.getTime() + 301_000) })).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySignature({ ...base, timestamp: "soon" })).toEqual({ ok: false, reason: "bad_timestamp" });
  });
});

describe("secret encryption", () => {
  it("round-trips with a fresh IV each time and fails on the wrong key", async () => {
    const a = await encryptSecret("whsec_example", KEY);
    const b = await encryptSecret("whsec_example", KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe("whsec_example");
    const other = "__8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0";
    await expect(decryptSecret(a, other)).rejects.toThrow();
  });
});

describe("backoff", () => {
  it("covers 24 hours and then gives up", () => {
    expect(RETRY_WINDOW_SEC).toBe(86_400);
    expect(nextAttemptAt(1, NOW)).toEqual(new Date(NOW.getTime() + 60_000));
    expect(nextAttemptAt(BACKOFF_SCHEDULE_SEC.length, NOW)).not.toBeNull();
    expect(nextAttemptAt(MAX_ATTEMPTS, NOW)).toBeNull();
  });
});

describe("delivery", () => {
  async function setup(eventTypes: string[] = []) {
    const store = new MemoryWebhookStore();
    const secret = generateWebhookSecret();
    store.subscriptions.push({ id: "sub_1", workspaceId: "ws1", url: "https://hooks.funder.example/gms", eventTypes, secretEnc: await encryptSecret(secret, KEY), active: true });
    store.subscriptions.push({ id: "sub_2", workspaceId: "ws2", url: "https://other.example/gms", eventTypes: [], secretEnc: await encryptSecret(secret, KEY), active: true });
    return { store, secret };
  }

  it("fans out to matching subscriptions of the workspace only", async () => {
    const { store } = await setup(["award.created"]);
    expect(await fanOut(event, { store, now: () => NOW })).toHaveLength(0);
    store.subscriptions[0]!.eventTypes = ["tranche.status.changed"];
    const created = await fanOut(event, { store, now: () => NOW });
    expect(created.map((d) => d.subscriptionId)).toEqual(["sub_1"]);
  });

  it("sends a verifiable signature and marks the delivery delivered", async () => {
    const { store, secret } = await setup();
    const [d] = await fanOut(event, { store, now: () => NOW });
    let seen: Request | undefined;
    const fetchStub = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = new Request(url, init);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const result = await attemptDelivery(d!.id, { store, secretKey: KEY, fetch: fetchStub, now: () => NOW });
    expect(result).toMatchObject({ status: "delivered", attempts: 1, lastStatusCode: 204 });
    const body = await seen!.text();
    expect(JSON.parse(body)).toEqual(event);
    expect(await verifySignature({ secret, body, signature: seen!.headers.get(SIGNATURE_HEADER), timestamp: seen!.headers.get(TIMESTAMP_HEADER), now: NOW })).toEqual({ ok: true });
  });

  it("retries on failure with backoff, then exhausts after 24 hours", async () => {
    const { store } = await setup();
    const [d] = await fanOut(event, { store, now: () => NOW });
    const failing = (async () => new Response("no", { status: 500 })) as typeof fetch;
    let clock = NOW;
    const deps = { store, secretKey: KEY, fetch: failing, now: () => clock };
    const first = await attemptDelivery(d!.id, deps);
    expect(first).toMatchObject({ status: "failed", attempts: 1, lastStatusCode: 500, nextAttemptAt: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(await deliverDue(deps)).toHaveLength(0); // not due yet
    for (let i = 0; i < BACKOFF_SCHEDULE_SEC.length; i++) {
      clock = new Date(Date.parse((await store.getDelivery(d!.id))!.nextAttemptAt!));
      await deliverDue(deps);
    }
    const last = await store.getDelivery(d!.id);
    expect(last).toMatchObject({ status: "exhausted", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(clock.getTime() - NOW.getTime()).toBe(86_400_000);
  });

  it("never posts to a non-HTTPS endpoint", async () => {
    const { store } = await setup();
    store.subscriptions[0]!.url = "http://hooks.funder.example/gms";
    const [d] = await fanOut(event, { store, now: () => NOW });
    let called = false;
    const fetchStub = (async () => ((called = true), new Response(null))) as typeof fetch;
    expect(await attemptDelivery(d!.id, { store, secretKey: KEY, fetch: fetchStub, now: () => NOW })).toMatchObject({ status: "failed", lastError: "endpoint must be https" });
    expect(called).toBe(false);
  });
});
