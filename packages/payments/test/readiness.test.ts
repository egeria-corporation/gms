// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { evaluateReadiness, holdBanner, holdCauseFor, missing, ok, unavailable, READINESS_KEYS, type ReadinessInput, type ReadinessKey, type CheckState } from "../src/index.ts";
import { NOW, credential, passportAward, readinessInput, source, tranche, award } from "./helpers.ts";

const stateOf = (i: ReadinessInput, key: ReadinessKey) => evaluateReadiness(i).checks.find((c) => c.key === key)!;

describe("readiness", () => {
  it("passes all seven checks for a verified payee and an executed agreement", () => {
    const s = evaluateReadiness(readinessInput());
    expect(s.checks.map((c) => c.key)).toEqual([...READINESS_KEYS]);
    expect(s.checks.every((c) => c.state === "pass" && c.fixHref === null)).toBe(true);
    expect(s).toMatchObject({ passed: 7, failed: 0, unknown: 0, releasable: true, text: "7 of 7 checks pass" });
    expect(stateOf(readinessInput(), "payee_credential").reason).toBe("L3 · River City Credit Union •••• 4821 · credential version 4");
  });

  const pending = { destinationId: "d2", state: "cooling_off", bankName: "Harbor Community Bank", last4: "7730", requestedAt: "2027-05-20T00:00:00Z", coolingOffUntil: "2027-05-27T00:00:00Z" };
  const matrix: [string, Partial<ReadinessInput>, ReadinessKey, CheckState][] = [
    ["agreement not executed", { agreementExecuted: false }, "agreement", "fail"],
    ["condition not met", { conditionSatisfied: false }, "condition", "fail"],
    ["no Passport link", { passportLinked: false }, "funder_link", "fail"],
    ["no debitable funding bank", { funderSources: ok([{ ...source, status: "pending", canDebit: false }]) }, "funder_link", "fail"],
    ["funding bank unreadable", { funderSources: unavailable }, "funder_link", "unknown"],
    ["no credential", { credential: missing }, "payee_credential", "fail"],
    ["level L2", { credential: ok(credential({ level: "L2" })) }, "payee_credential", "fail"],
    ["no active destination", { credential: ok(credential({ payoutDestination: null })) }, "payee_credential", "fail"],
    ["pending destination change", { credential: ok(credential({ changeControl: { pendingChange: pending, freezeUntil: null, lastChangedAt: null } })) }, "payee_credential", "fail"],
    ["inside a freeze window", { credential: ok(credential({ changeControl: { pendingChange: null, freezeUntil: "2027-05-30T00:00:00Z", lastChangedAt: null } })) }, "payee_credential", "fail"],
    ["freeze window over", { credential: ok(credential({ changeControl: { pendingChange: null, freezeUntil: "2027-05-01T00:00:00Z", lastChangedAt: null } })) }, "payee_credential", "pass"],
    ["Passport unreachable for the credential", { credential: unavailable }, "payee_credential", "unknown"],
    ["award not mirrored", { award: { ...award, passportAwardId: null } }, "award_headroom", "fail"],
    ["headroom too small", { passportAward: ok(passportAward("100000.00")) }, "award_headroom", "fail"],
    ["headroom exactly enough", { passportAward: ok(passportAward("75000.00")) }, "award_headroom", "pass"],
    ["Passport unreachable for the award", { passportAward: unavailable }, "award_headroom", "unknown"],
    ["same-amount tranche in flight", { siblings: [tranche({ id: "trn_0002", seq: 2, status: "initiated", releasedAt: "2027-05-24T10:00:00Z" })] }, "no_duplicate", "fail"],
    ["same-amount tranche in flight, confirmed", { siblings: [tranche({ id: "trn_0002", seq: 2, status: "initiated", releasedAt: "2027-05-24T10:00:00Z" })], duplicateConfirmed: true }, "no_duplicate", "pass"],
    ["same-amount tranche released two days ago", { siblings: [tranche({ id: "trn_0002", seq: 2, status: "initiated", releasedAt: "2027-05-22T10:00:00Z" })] }, "no_duplicate", "pass"],
    ["different amount in flight", { siblings: [tranche({ id: "trn_0002", seq: 2, status: "initiated", amountMinor: 6_000_000, releasedAt: "2027-05-24T10:00:00Z" })] }, "no_duplicate", "pass"],
    ["organization inactive", { recipientActive: false }, "recipient_standing", "fail"],
    ["standing not known", { recipientActive: null }, "recipient_standing", "unknown"],
    ["level dropped below L3 since submit", { credential: ok(credential({ level: "L2" })) }, "recipient_standing", "fail"],
  ];

  it.each(matrix)("%s", (_name, over, key, expected) => {
    const s = evaluateReadiness(readinessInput(over));
    const check = s.checks.find((c) => c.key === key)!;
    expect(check.state).toBe(expected);
    expect(check.reason.length).toBeGreaterThan(0);
    if (expected !== "pass") {
      expect(s.releasable).toBe(false);
      expect(check.fixHref).toBeTruthy();
    }
  });

  it("never collapses unknown into pass or fail", () => {
    const s = evaluateReadiness(readinessInput({ credential: unavailable, passportAward: unavailable, funderSources: unavailable }));
    expect(s).toMatchObject({ passed: 3, failed: 0, unknown: 4, releasable: false, text: "3 of 7 checks pass · 4 unknown" });
  });

  it("waives the agreement check when the award says so", () => {
    expect(stateOf(readinessInput({ agreementExecuted: false, award: { ...award, conditions: ["noAgreementRequired"] } }), "agreement").state).toBe("pass");
  });

  it("names bank data by bank name and last four digits only", () => {
    const text = evaluateReadiness(readinessInput({ credential: ok(credential({ changeControl: { pendingChange: pending, freezeUntil: null, lastChangedAt: null } })) })).checks.map((c) => c.reason).join(" ");
    expect(text).toContain("Harbor Community Bank •••• 7730");
    expect(text).not.toMatch(/\d{6,}/);
  });
});

describe("hold banner", () => {
  it("explains a pending destination change with the date that clears it", () => {
    const cred = credential({ changeControl: { pendingChange: { destinationId: "d2", state: "cooling_off", bankName: "Harbor Community Bank", last4: "7730", requestedAt: "2027-05-20T00:00:00Z", coolingOffUntil: "2027-05-27T00:00:00Z" }, freezeUntil: null, lastChangedAt: null } });
    const cause = holdCauseFor(evaluateReadiness(readinessInput({ credential: ok(cred) })), cred, NOW)!;
    expect(cause.cause).toBe("pending_destination_change");
    const b = holdBanner(cause, "Tranche 2");
    expect(b.title).toBe("Tranche 2 is on hold");
    expect(b.detail).toContain("Harbor Community Bank •••• 7730");
    expect(b.clears).toBe("Clears when the change takes effect, on or after May 27, 2027.");
  });

  it("covers the five causes and returns null when releasable", () => {
    expect(holdCauseFor(evaluateReadiness(readinessInput()), credential(), NOW)).toBeNull();
    expect(holdCauseFor(evaluateReadiness(readinessInput({ agreementExecuted: false })), credential(), NOW)).toEqual({ cause: "agreement_not_executed" });
    const frozen = credential({ changeControl: { pendingChange: null, freezeUntil: "2027-05-30T00:00:00Z", lastChangedAt: null } });
    expect(holdCauseFor(evaluateReadiness(readinessInput({ credential: ok(frozen) })), frozen, NOW)).toEqual({ cause: "freeze_window", freezeUntil: "2027-05-30T00:00:00Z" });
    const l2 = credential({ level: "L2" });
    expect(holdCauseFor(evaluateReadiness(readinessInput({ credential: ok(l2) })), l2, NOW)).toEqual({ cause: "level_below_l3", level: "L2" });
    expect(holdCauseFor(evaluateReadiness(readinessInput({ credential: unavailable })), null, NOW)).toEqual({ cause: "passport_unavailable" });
    for (const c of [{ cause: "agreement_not_executed" }, { cause: "passport_unavailable" }, { cause: "level_below_l3", level: "L1" }, { cause: "freeze_window", freezeUntil: "2027-06-01T00:00:00Z" }] as const) {
      const b = holdBanner(c);
      expect(b.title && b.detail && b.clears.startsWith("Clears")).toBeTruthy();
    }
  });
});
