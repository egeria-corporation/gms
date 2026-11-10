// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { handleOnce, memoryDedupeStore, parsePassportWebhook, signPassportPayload, verifyPassportSignature, type PassportEvent } from "../src/index.ts";

const SECRET = "whsec_fixture";
const now = new Date("2027-05-25T12:00:00Z");
const ts = Math.floor(now.getTime() / 1000);
const event: PassportEvent = { id: "evt_01", type: "disbursement.status.changed", orgId: "org-a", occurredAt: now.toISOString(), data: { disbursementId: "dsb_1", status: "settled" } };
const body = JSON.stringify(event);
const headers = async (over: Record<string, string> = {}) => new Headers({ "X-Passport-Signature": await signPassportPayload(SECRET, ts, body), "X-Passport-Timestamp": String(ts), ...over });

describe("Passport webhook verification", () => {
  it("accepts a correctly signed delivery", async () => {
    expect(await parsePassportWebhook(SECRET, await headers(), body, { now })).toEqual({ ok: true, event });
  });

  it("rejects a changed body, a wrong secret, a stale timestamp and missing headers", async () => {
    const h = await headers();
    expect(await parsePassportWebhook(SECRET, h, body.replace("settled", "failed"), { now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await parsePassportWebhook("whsec_other", h, body, { now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await parsePassportWebhook(SECRET, h, body, { now: new Date(now.getTime() + 301_000) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyPassportSignature(SECRET, null, String(ts), body, { now })).toBe(false);
    expect(await verifyPassportSignature(SECRET, h.get("X-Passport-Signature"), "not-a-number", body, { now })).toBe(false);
  });

  it("rejects an event type Passport does not send", async () => {
    const odd = JSON.stringify({ ...event, type: "payee.destination.set" });
    const h = new Headers({ "X-Passport-Signature": await signPassportPayload(SECRET, ts, odd), "X-Passport-Timestamp": String(ts) });
    expect(await parsePassportWebhook(SECRET, h, odd, { now })).toEqual({ ok: false, reason: "unknown_event" });
  });

  it("handles each event id once", async () => {
    const store = memoryDedupeStore();
    let runs = 0;
    const run = () => handleOnce(store, event, () => Promise.resolve(++runs));
    expect(await run()).toEqual({ duplicate: false, result: 1 });
    expect(await run()).toEqual({ duplicate: true });
    expect(runs).toBe(1);
  });
});
