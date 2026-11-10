// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN,
  ScheduleError,
  buildSchedule,
  evaluateDue,
  nameSimilarity,
  onDestinationChangePending,
  onDestinationChanged,
  onDisbursementStatusChanged,
  onLevelChanged,
  onOrganizationInactive,
  proposeMatches,
  type BankTransaction,
} from "../src/index.ts";
import { NOW, ORG, PASSPORT_AWARD, tranche } from "./helpers.ts";

let n = 0;
const newId = () => `trn_${String(++n).padStart(4, "0")}`;

describe("schedule", () => {
  it("builds 50/40/10 tranches that sum to the award, remainder on the last", () => {
    const s = buildSchedule({ awardId: "awd_1", awardedMinor: 15_000_001, currency: "USD", newId, plan: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 40, condition: { type: "onReportAccepted", requirementId: "req_1" } }, { percent: 10, condition: { type: "onDate", date: "2028-06-30" } }] });
    expect(s.map((t) => t.amountMinor)).toEqual([7_500_000, 6_000_000, 1_500_001]);
    expect(s.map((t) => t.seq)).toEqual([1, 2, 3]);
    expect(s.every((t) => t.status === "scheduled" && t.idempotencyKey === t.id)).toBe(true);
    expect(s[2]!.dueAt).toBe("2028-06-30T00:00:00.000Z");
  });

  it("defaults to one tranche on execution and rejects plans that do not add up", () => {
    expect(buildSchedule({ awardId: "a", awardedMinor: 4_000_000, currency: "USD", newId, plan: DEFAULT_PLAN }).map((t) => t.amountMinor)).toEqual([4_000_000]);
    expect(() => buildSchedule({ awardId: "a", awardedMinor: 100, currency: "USD", newId, plan: [{ amountMinor: 60, condition: { type: "manual" } }] })).toThrow(ScheduleError);
    expect(() => buildSchedule({ awardId: "a", awardedMinor: 100, currency: "USD", newId, plan: [] })).toThrow(/at least one/);
  });

  it("moves scheduled tranches to due when their condition is met", () => {
    const ts = [
      tranche({ id: "t1", condition: { type: "onExecution" }, status: "scheduled", dueAt: null }),
      tranche({ id: "t2", condition: { type: "onReportAccepted", requirementId: "req_1" }, status: "scheduled", dueAt: null }),
      tranche({ id: "t3", condition: { type: "onDate", date: "2027-05-01" }, status: "scheduled" }),
      tranche({ id: "t4", condition: { type: "manual" }, status: "scheduled" }),
      tranche({ id: "t5", condition: { type: "onExecution" }, status: "settled" }),
    ];
    const facts = { agreementExecuted: true, awardActive: true, acceptedRequirementIds: [], now: NOW };
    expect(evaluateDue(ts, facts).map((u) => u.trancheId)).toEqual(["t1", "t3"]);
    expect(evaluateDue(ts, { ...facts, acceptedRequirementIds: ["req_1"] }).map((u) => u.trancheId)).toEqual(["t1", "t2", "t3"]);
    expect(evaluateDue(ts, { ...facts, awardActive: false })).toEqual([]);
    expect(evaluateDue(ts, { ...facts, agreementExecuted: false, noAgreementRequired: true }).map((u) => u.trancheId)).toEqual(["t1", "t3"]);
  });
});

describe("Passport events", () => {
  const changed = (status: "initiated" | "settled" | "failed" | "returned" | "held", reason: string | null = null) => ({
    disbursementId: "dsb_1", awardId: PASSPORT_AWARD, funderOrgId: "funder", recipientOrgId: ORG, status, previousStatus: null, reason,
    amount: { amount: "75000.00", currency: "USD" }, fee: null, rail: "standard" as const, mode: "facilitated" as const,
  });

  it("drives a tranche to settled and always refreshes the award's disbursed amount", () => {
    const fx = onDisbursementStatusChanged(changed("settled"), tranche({ status: "initiated", passportDisbursementId: "dsb_1" }));
    expect(fx.trancheUpdates).toEqual([{ trancheId: "trn_0001", path: ["settled"], patch: { status: "settled", passportStatus: "settled", holdReason: null } }]);
    expect(fx.refreshAwards).toEqual([PASSPORT_AWARD]);
    expect(fx.relay.map((r) => r.type)).toEqual(["disbursement.status.changed", "tranche.status.changed"]);
    expect(onDisbursementStatusChanged(changed("settled"), null)).toMatchObject({ trancheUpdates: [], refreshAwards: [PASSPORT_AWARD] });
  });

  it("ignores a replayed or out-of-order event", () => {
    expect(onDisbursementStatusChanged(changed("initiated"), tranche({ status: "settled", passportStatus: "settled" })).trancheUpdates).toEqual([]);
    expect(onDisbursementStatusChanged(changed("settled"), tranche({ status: "settled", passportStatus: "settled" })).trancheUpdates).toEqual([]);
  });

  it("alerts on failure and return", () => {
    const failed = onDisbursementStatusChanged(changed("failed", "debit_failed:R01"), tranche({ status: "initiated" }));
    expect(failed.trancheUpdates[0]).toMatchObject({ path: ["failed"], reason: "debit_failed:R01" });
    expect(failed.alerts[0]!.kind).toBe("payment_failed");
    expect(onDisbursementStatusChanged(changed("returned"), tranche({ status: "settled" })).trancheUpdates[0]!.path).toEqual(["returned"]);
  });

  const mine = [tranche({ id: "t-due", status: "due" }), tranche({ id: "t-ready", status: "ready" }), tranche({ id: "t-flight", status: "initiated" }), tranche({ id: "t-sched", status: "scheduled" })];

  it("sets the banner and un-readies tranches on a pending destination change, then clears both", () => {
    const pending = onDestinationChangePending({ orgId: ORG, handle: "alder-creek", destinationId: "d2", state: "awaiting_confirmation", bankName: "Harbor Community Bank", last4: "7730", requestedAt: NOW.toISOString() }, mine);
    expect(pending.recipient?.pendingDestinationChange).toMatchObject({ bankName: "Harbor Community Bank", last4: "7730" });
    expect(pending.trancheUpdates.map((u) => [u.trancheId, u.patch.holdReason])).toEqual([["t-ready", "pending_destination_change"]]);
    expect(pending.alerts[0]!.kind).toBe("destination_change_pending");

    const held = [tranche({ id: "t-held", status: "held", holdReason: "pending_destination_change" }), tranche({ id: "t-other", status: "held", holdReason: "manual" })];
    const done = onDestinationChanged({ orgId: ORG, handle: null, destinationId: "d2", previousDestinationId: "d1", bankName: "Harbor Community Bank", last4: "7730" }, held);
    expect(done.recipient).toEqual({ orgId: ORG, pendingDestinationChange: null });
    expect(done.trancheUpdates).toEqual([{ trancheId: "t-held", path: ["due"], patch: { status: "due", holdReason: null }, reason: "pending_destination_change:cleared" }]);
    expect(done.refreshCredentials).toEqual([ORG]);
  });

  it("holds ready tranches on a downgrade below L3 and lifts the hold on return to L3", () => {
    const down = onLevelChanged({ orgId: ORG, handle: null, from: "L3", to: "L2", reason: "payee.kyb" }, mine);
    expect(down.recipient).toEqual({ orgId: ORG, verificationLevel: "L2" });
    expect(down.trancheUpdates.map((u) => u.trancheId)).toEqual(["t-ready"]);
    expect(down.alerts).toHaveLength(1);
    const up = onLevelChanged({ orgId: ORG, handle: null, from: "L2", to: "L3", reason: "payee.kyb" }, [tranche({ id: "h", status: "held", holdReason: "level_below_l3" })]);
    expect(up.trancheUpdates[0]).toMatchObject({ trancheId: "h", path: ["due"] });
  });

  it("holds everything not yet with Passport when the organization goes inactive", () => {
    const fx = onOrganizationInactive({ orgId: ORG, handle: null, reason: ["irs.revocation.absent"] }, mine);
    expect(fx.recipient).toEqual({ orgId: ORG, active: false });
    expect(fx.trancheUpdates.map((u) => u.trancheId)).toEqual(["t-due", "t-ready"]);
    expect(fx.alerts[0]!.kind).toBe("organization_inactive");
  });
});

describe("Mercury reconciliation", () => {
  const txn = (over: Partial<BankTransaction> = {}): BankTransaction => ({ id: "txn_1", amountMinor: 7_500_000, currency: "USD", postedAt: "2027-05-24T00:00:00Z", counterpartyName: "ALDER CREEK FAMILY SERVICES INC", memo: null, matchedTrancheId: null, ...over });
  const candidates = [
    { tranche: tranche({ id: "t-alder" }), recipientNames: ["Alder Creek Family Services"] },
    { tranche: tranche({ id: "t-harbor", awardId: "awd_2" }), recipientNames: ["Harbor Light Shelter"] },
    { tranche: tranche({ id: "t-settled", status: "settled" }), recipientNames: ["Alder Creek Family Services"] },
  ];

  it("scores names after normalizing case, punctuation and legal suffixes", () => {
    expect(nameSimilarity("ALDER CREEK FAMILY SERVICES INC", "Alder Creek Family Services")).toBe(1);
    expect(nameSimilarity("ALDER CREEK FAMILY SERVIC", "Alder Creek Family Services")).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Harbor Light Shelter", "Alder Creek Family Services")).toBeLessThan(0.5);
    expect(nameSimilarity("", "Alder Creek")).toBe(0);
  });

  it("proposes a match on amount within a cent and a similar name, for due or ready tranches only", () => {
    expect(proposeMatches([txn()], candidates)).toEqual([{ transactionId: "txn_1", trancheId: "t-alder", score: 1, amountDeltaMinor: 0, ambiguous: false }]);
    expect(proposeMatches([txn({ amountMinor: 7_500_001 })], candidates)).toMatchObject([{ trancheId: "t-alder", amountDeltaMinor: 1 }]);
    expect(proposeMatches([txn({ amountMinor: 7_500_002 })], candidates)).toEqual([]);
    expect(proposeMatches([txn({ counterpartyName: "Northwind Supplies" })], candidates)).toEqual([]);
    expect(proposeMatches([txn({ matchedTrancheId: "t-x" })], candidates)).toEqual([]);
    expect(proposeMatches([txn({ currency: "CAD" })], candidates)).toEqual([]);
  });

  it("flags a transaction that fits two tranches as ambiguous", () => {
    const two = [...candidates, { tranche: tranche({ id: "t-alder-2", seq: 2 }), recipientNames: ["Alder Creek Family Services"] }];
    const out = proposeMatches([txn()], two);
    expect(out.map((m) => [m.trancheId, m.ambiguous])).toEqual([["t-alder", true], ["t-alder-2", true]]);
  });
});
