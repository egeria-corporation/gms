// SPDX-License-Identifier: AGPL-3.0-only
import { CredentialVersionStaleError, PassportApiError, PassportUnavailableError } from "@gms/passport-client";
import { describe, expect, it } from "vitest";
import { ReleaseBlockedError, evaluateReadiness, isStale, memoFor, pathTo, recordExternal, releaseFacilitated, trancheStatusFor } from "../src/index.ts";
import { award, credential, deps, disbursement, fakePassport, passportAward, readinessInput, tranche } from "./helpers.ts";

const ready = evaluateReadiness(readinessInput());
const ctx = (over = {}) => ({ tranche: tranche(), award, readiness: ready, actor: "user:dana", ...over });

describe("status mapping", () => {
  it("maps every Passport status onto a tranche status", () => {
    expect((["pending", "validated", "initiated", "settled", "failed", "returned", "held"] as const).map(trancheStatusFor)).toEqual(["releasing", "releasing", "initiated", "settled", "failed", "returned", "held"]);
  });

  it("returns a refused release to due and walks a fast settle through initiated", () => {
    expect(pathTo("releasing", "failed")).toEqual(["failed", "due"]);
    expect(pathTo("initiated", "failed")).toEqual(["failed"]);
    expect(pathTo("releasing", "settled")).toEqual(["initiated", "settled"]);
    expect(pathTo("initiated", "initiated")).toEqual([]);
  });

  it("ignores late or repeated events but lets a settled payment be returned", () => {
    expect(isStale("settled", "initiated")).toBe(true);
    expect(isStale("initiated", "releasing")).toBe(true);
    expect(isStale("initiated", "initiated")).toBe(true);
    expect(isStale("settled", "returned")).toBe(false);
    expect(isStale("initiated", "settled")).toBe(false);
    expect(isStale("cancelled", "settled")).toBe(true);
  });
});

describe("facilitated release", () => {
  it("marks the tranche releasing, then pays through Passport with the tranche id as Idempotency-Key", async () => {
    const p = fakePassport({ create: [disbursement()] });
    const d = deps(p);
    const out = await releaseFacilitated(d, ctx());
    expect(out).toMatchObject({ result: "accepted", status: "initiated" });
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.key).toBe("trn_0001");
    expect(p.creates[0]!.req).toEqual({
      awardId: award.passportAwardId,
      recipientOrgId: award.recipientOrgId,
      credentialId: "pc_01JALDERCREEK0000000000000",
      credentialVersion: 4,
      amount: { amount: "75000.00", currency: "USD" },
      rail: "auto",
      mode: "facilitated",
      memo: "Mobile Health Navigation for Rural Families — tranche 1",
      feePaidBy: "source",
    });
    expect(d.updates.map((u) => u.path)).toEqual([["releasing"], ["initiated"]]);
    expect(d.updates[0]!.patch).toMatchObject({ status: "releasing", mode: "facilitated", releasedBy: "user:dana" });
    expect(d.updates[1]!.patch).toMatchObject({ status: "initiated", passportDisbursementId: "dsb_01JFIXTURE0000000000000000", passportStatus: "initiated" });
  });

  it("does not start when readiness has a failing or unknown line, or the status is wrong", async () => {
    const p = fakePassport({ create: [disbursement()] });
    const notReady = evaluateReadiness(readinessInput({ agreementExecuted: false }));
    await expect(releaseFacilitated(deps(p), ctx({ readiness: notReady }))).rejects.toMatchObject({ code: "not_ready" });
    await expect(releaseFacilitated(deps(p), ctx({ tranche: tranche({ status: "settled" }) }))).rejects.toMatchObject({ code: "wrong_status" });
    await expect(releaseFacilitated(deps(p), ctx({ award: { ...award, passportAwardId: null } }))).rejects.toMatchObject({ code: "not_mirrored" });
    expect(p.creates).toHaveLength(0);
  });

  it("re-reads headroom at Passport and refuses to exceed the award", async () => {
    const p = fakePassport({ award: passportAward("100000.00"), create: [disbursement()] });
    const d = deps(p);
    await expect(releaseFacilitated(d, ctx())).rejects.toMatchObject({ code: "award_headroom" });
    expect(d.updates).toHaveLength(0);
    expect(p.creates).toHaveLength(0);
  });

  it("changes nothing when Passport is unreachable before the release starts", async () => {
    const d = deps(fakePassport({ award: new PassportUnavailableError("down"), create: [disbursement()] }));
    await expect(releaseFacilitated(d, ctx())).rejects.toBeInstanceOf(ReleaseBlockedError);
    expect(d.updates).toHaveLength(0);
  });

  it("re-resolves a stale credential once and retries with the same key", async () => {
    const p = fakePassport({ credentials: [credential(), credential({ version: 5 })], create: [new CredentialVersionStaleError("stale"), disbursement({ credentialVersion: 5 })] });
    const out = await releaseFacilitated(deps(p), ctx());
    expect(out.result).toBe("accepted");
    expect(p.creates.map((c) => [c.key, c.req.credentialVersion])).toEqual([["trn_0001", 4], ["trn_0001", 5]]);
    expect(p.credentialReads).toBe(2);
  });

  it("holds the tranche with a reason when the credential is stale twice", async () => {
    const p = fakePassport({ create: [new CredentialVersionStaleError("stale")] });
    const d = deps(p);
    const out = await releaseFacilitated(d, ctx());
    expect(out).toMatchObject({ result: "refused", status: "held", code: "credential_version_stale" });
    expect(p.creates).toHaveLength(2);
    // The empty path is the note of the re-resolved request, so a later retry repeats it exactly.
    expect(d.updates.map((u) => u.path)).toEqual([["releasing"], [], ["failed", "due"], ["held"]]);
    expect(d.updates[1]!.patch).toEqual({ releaseRequest: { rail: "auto", credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4 } });
    expect(d.updates[3]!.patch).toEqual({ status: "held", holdReason: "credential_version_stale" });
  });

  it("remembers what it asked Passport for, and a retry of a releasing tranche repeats exactly that", async () => {
    const first = deps(fakePassport({ create: [new PassportUnavailableError("timeout")] }));
    const unconfirmed = await releaseFacilitated(first, ctx({ rail: "instant" }));
    expect(unconfirmed).toEqual({ result: "unconfirmed", status: "releasing" });
    expect(first.updates[0]!.patch).toMatchObject({ status: "releasing", releaseRequest: { rail: "instant", credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4 } });

    // Later the credential has moved on and the workspace default rail is different: the retry still sends the first request.
    const p = fakePassport({ credentials: [credential({ version: 9 })], create: [disbursement()] });
    const d = deps(p);
    const out = await releaseFacilitated(d, ctx({ rail: "auto", tranche: tranche({ status: "releasing", mode: "facilitated", releaseRequest: { rail: "instant", credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4 } }) }));
    expect(out).toMatchObject({ result: "accepted", status: "initiated" });
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!).toMatchObject({ key: "trn_0001", req: { rail: "instant", credentialVersion: 4 } });
    expect(d.updates.map((u) => u.path)).toEqual([["initiated"]]);
  });

  it("leaves a releasing tranche alone when Passport holds a different request under its key", async () => {
    const p = fakePassport({ create: [new PassportApiError(422, "idempotency_key_reused", "This Idempotency-Key was used for a different request")] });
    const d = deps(p);
    const out = await releaseFacilitated(d, ctx({ tranche: tranche({ status: "releasing", mode: "facilitated" }) }));
    expect(out).toEqual({ result: "unconfirmed", status: "releasing" });
    expect(d.updates).toHaveLength(0);
  });

  it("returns a refused tranche to due", async () => {
    const d = deps(fakePassport({ create: [new PassportApiError(409, "funder_payments_setup_required", "Link a funding bank account first")] }));
    const out = await releaseFacilitated(d, ctx());
    expect(out).toEqual({ result: "refused", status: "due", code: "funder_payments_setup_required", message: "Link a funding bank account first" });
    expect(d.updates.map((u) => u.path)).toEqual([["releasing"], ["failed", "due"]]);
  });

  it("stays releasing when Passport does not answer, and a retry reuses the key without re-checking readiness", async () => {
    const p = fakePassport({ create: [new PassportUnavailableError("timeout"), disbursement({ status: "validated" })] });
    const d = deps(p);
    expect(await releaseFacilitated(d, ctx())).toEqual({ result: "unconfirmed", status: "releasing" });
    const retry = await releaseFacilitated(d, ctx({ tranche: tranche({ status: "releasing", mode: "facilitated" }), readiness: evaluateReadiness(readinessInput({ conditionSatisfied: false })) }));
    expect(retry).toMatchObject({ result: "accepted", status: "releasing" });
    expect(p.creates.map((c) => c.key)).toEqual(["trn_0001", "trn_0001"]);
    expect(d.updates.filter((u) => u.path.includes("releasing"))).toHaveLength(1);
  });

  it("holds the tranche when Passport holds the disbursement for a destination change", async () => {
    const d = deps(fakePassport({ create: [disbursement({ status: "held", statusReason: "destination_change_in_flight" })] }));
    const out = await releaseFacilitated(d, ctx());
    expect(out).toMatchObject({ result: "accepted", status: "held" });
    expect(d.updates[1]!.patch).toMatchObject({ status: "held", holdReason: "destination_change_in_flight", passportStatus: "held" });
  });

  it("keeps the memo within Passport's 140 characters", () => {
    expect(memoFor({ ...award, title: "x".repeat(300) }, tranche({ seq: 12 }))).toHaveLength(140);
  });
});

describe("resolve mode", () => {
  const external = { reference: "MERC-20270524-0019", paidAt: "2027-05-24T15:00:00Z", destinationLast4: "4821" };

  it("posts the external payment to Passport and settles the tranche", async () => {
    const p = fakePassport({ create: [disbursement({ mode: "resolve", status: "settled" })] });
    const d = deps(p);
    const out = await recordExternal(d, { tranche: tranche(), award, external, actor: "user:marcus" });
    expect(out.result).toBe("recorded");
    expect(p.creates[0]).toMatchObject({ key: "trn_0001", req: { mode: "resolve", external } });
    expect(p.creates[0]!.req.rail).toBeUndefined();
    expect(d.updates).toHaveLength(1);
    expect(d.updates[0]).toMatchObject({ path: ["settled"], patch: { status: "settled", mode: "resolve", passportStatus: "settled", external: { reference: "MERC-20270524-0019", last4: "4821" } } });
  });

  it("settles locally as unverified when Passport answers 422", async () => {
    const d = deps(fakePassport({ create: [new PassportApiError(422, "destination_last4_mismatch", "external.destinationLast4 does not match the credential's payout destination")] }));
    const out = await recordExternal(d, { tranche: tranche(), award, external: { ...external, destinationLast4: "0000" }, actor: "user:marcus" });
    expect(out).toMatchObject({ result: "unverified", code: "destination_last4_mismatch" });
    expect(d.updates[0]!.patch).toMatchObject({ status: "settled", mode: "resolve", passportStatus: "unverified" });
    expect(d.updates[0]!.patch).not.toHaveProperty("passportDisbursementId");
  });

  it("records nothing when Passport is unreachable, the award is not mirrored, or the digits are malformed", async () => {
    const down = deps(fakePassport({ create: [new PassportUnavailableError("down")] }));
    await expect(recordExternal(down, { tranche: tranche(), award, external, actor: "u" })).rejects.toMatchObject({ code: "passport_unavailable" });
    expect(down.updates).toHaveLength(0);
    const p = deps(fakePassport({ create: [disbursement()] }));
    await expect(recordExternal(p, { tranche: tranche(), award: { ...award, passportAwardId: null }, external, actor: "u" })).rejects.toMatchObject({ code: "not_mirrored" });
    await expect(recordExternal(p, { tranche: tranche(), award, external: { ...external, destinationLast4: "48213" }, actor: "u" })).rejects.toMatchObject({ code: "not_ready" });
  });
});
