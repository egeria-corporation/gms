// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  acceptRequirement,
  advanceStage,
  agreementMachine,
  applicationCgStatus,
  applicationMachine,
  awardCgStatus,
  awardEffects,
  awardMachine,
  executeAgreement,
  planAdvance,
  requirementMachine,
  submissionMachine,
  trancheMachine,
  tranchesDueOnExecution,
  voidRefusal,
  APPLICATION_STATUSES,
  AWARD_STATUSES,
  type SignatureRecord,
  type StageDef,
  type TrancheRef,
} from "../src/index.ts";
import { applicant, edges, funder, passport, recorder, system } from "./helpers.ts";

describe("engine", () => {
  it("runs guard → write → ledger → webhook in order", async () => {
    const r = recorder();
    const res = await applicationMachine.transition({ id: "app_1", status: "draft" }, "submit", applicant, { requiredFormsComplete: true, now: "2027-04-16T00:00:00Z" }, r.ports);
    expect(res).toMatchObject({ ok: true, from: "draft", to: "submitted" });
    expect(r.calls).toEqual(["write", "ledger:application.submit:user:a1", "emit:application.submitted", "emit:application.status.changed"]);
    expect(r.writes[0]?.patch).toEqual({ submitted_at: "2027-04-16T00:00:00Z" });
  });
  it("touches no port when refused", async () => {
    const r = recorder();
    const res = await applicationMachine.transition({ id: "app_1", status: "draft" }, "submit", applicant, {}, r.ports);
    expect(res).toMatchObject({ ok: false, code: "guard_failed" });
    expect(r.calls).toEqual([]);
  });
  it("reports refusal codes", () => {
    expect(applicationMachine.check("draft", "screen", funder, {})).toMatchObject({ ok: false, code: "invalid_from" });
    expect(applicationMachine.check("draft", "submit", funder, { requiredFormsComplete: true })).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(applicationMachine.check("draft", "nope" as never, funder, {})).toMatchObject({ ok: false, code: "unknown_action" });
    expect(applicationMachine.actionsFrom("recommended").sort()).toEqual(["accept", "decline", "waitlist", "withdraw"]);
  });
});

describe("application machine", () => {
  it("has exactly the specified edges", () => {
    expect(edges(applicationMachine)).toEqual(
      [
        "draft>submit>submitted",
        "revision_requested>submit>submitted",
        "submitted>screen>screening",
        "submitted>start_review>under_review",
        "screening>start_review>under_review",
        "under_review>recommend>recommended",
        "interview>recommend>recommended",
        "recommended>accept>accepted",
        "waitlisted>accept>accepted",
        "submitted>decline>declined",
        "screening>decline>declined",
        "under_review>decline>declined",
        "interview>decline>declined",
        "recommended>decline>declined",
        "waitlisted>decline>declined",
        "recommended>waitlist>waitlisted",
        "submitted>request_revision>revision_requested",
        "screening>request_revision>revision_requested",
        "under_review>request_revision>revision_requested",
        "screening>schedule_interview>interview",
        "under_review>schedule_interview>interview",
        "interview>resume_review>under_review",
        ...["draft", "submitted", "screening", "under_review", "recommended", "waitlisted", "revision_requested", "interview"].map((s) => `${s}>withdraw>withdrawn`),
      ].sort(),
    );
  });
  it("guards submit, decisions and revision requests", () => {
    expect(applicationMachine.check("draft", "submit", applicant, { requiredFormsComplete: true, stageOpen: false })).toMatchObject({ ok: false, reason: "This stage is closed to submissions." });
    expect(applicationMachine.check("recommended", "accept", funder, {})).toMatchObject({ ok: false, code: "guard_failed" });
    expect(applicationMachine.check("recommended", "accept", funder, { decisionId: "d1" })).toMatchObject({ ok: true, to: "accepted" });
    expect(applicationMachine.check("recommended", "waitlist", funder, {})).toMatchObject({ ok: false });
    expect(applicationMachine.check("screening", "decline", funder, {})).toMatchObject({ ok: false });
    expect(applicationMachine.check("submitted", "request_revision", funder, { revisionNote: " " })).toMatchObject({ ok: false });
    expect(applicationMachine.check("submitted", "request_revision", funder, { revisionNote: "Fix budget" })).toMatchObject({ ok: true });
  });
  it("only the applicant withdraws, and never from a terminal status", () => {
    expect(applicationMachine.check("under_review", "withdraw", funder, {})).toMatchObject({ ok: false, code: "actor_not_allowed" });
    for (const s of ["accepted", "declined", "withdrawn"] as const) {
      expect(applicationMachine.isTerminal(s)).toBe(true);
      expect(applicationMachine.check(s, "withdraw", applicant, {})).toMatchObject({ ok: false, code: "invalid_from" });
    }
  });
  it("projects to CommonGrants without inventing enum values", () => {
    const cg = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, applicationCgStatus(s)]));
    expect(cg).toEqual({
      draft: { value: "inProgress" },
      submitted: { value: "submitted" },
      accepted: { value: "accepted" },
      declined: { value: "rejected" },
      screening: { value: "custom", customValue: "screening" },
      under_review: { value: "custom", customValue: "underReview" },
      recommended: { value: "custom", customValue: "recommended" },
      waitlisted: { value: "custom", customValue: "waitlisted" },
      revision_requested: { value: "custom", customValue: "revisionRequested" },
      interview: { value: "custom", customValue: "interview" },
      withdrawn: { value: "custom", customValue: "withdrawn" },
    });
  });
});

describe("stages", () => {
  const stages: StageDef[] = [
    { key: "loi", forms: { frm_a: 3 }, entryFrom: [], requiresSubmission: true },
    { key: "full", forms: { frm_b: 1, frm_budget: 2 }, entryFrom: ["loi"], requiresSubmission: true },
    { key: "interview", forms: {}, entryFrom: ["full"], requiresSubmission: false },
  ];
  it("advances only along entryFrom", () => {
    expect(planAdvance({ id: "a", status: "under_review", stage: "loi" }, stages, "interview", funder)).toMatchObject({ ok: false, code: "invalid_from" });
    expect(planAdvance({ id: "a", status: "under_review", stage: "full" }, stages, "loi", funder)).toMatchObject({ ok: false, code: "invalid_from" });
    expect(planAdvance({ id: "a", status: "under_review", stage: "loi" }, stages, "nope", funder)).toMatchObject({ ok: false, code: "unknown_stage" });
    expect(planAdvance({ id: "a", status: "under_review", stage: "loi" }, stages, "full", applicant)).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(planAdvance({ id: "a", status: "draft", stage: "loi" }, stages, "full", funder)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(planAdvance({ id: "a", status: "declined", stage: "loi" }, stages, "full", funder)).toMatchObject({ ok: false, code: "guard_failed" });
  });
  it("a stage that requires submission resets to draft, locks prior responses and creates new ones", async () => {
    const r = recorder();
    const fx: unknown[] = [];
    const res = await advanceStage({ id: "a", status: "under_review", stage: "loi" }, stages, "full", funder, { ...r.ports, applyStageEffects: async (e) => void fx.push(e) });
    expect(res).toMatchObject({ ok: true, status: "draft", toStage: "full", lockResponsesOfStage: "loi" });
    expect(fx).toEqual([{ applicationId: "a", lockResponsesOfStage: "loi", createFormResponses: [{ formId: "frm_b", formVersion: 1 }, { formId: "frm_budget", formVersion: 2 }] }]);
    expect(r.writes[0]).toMatchObject({ from: "under_review", to: "draft", patch: { stage: "full" } });
    expect(r.calls).toEqual(["write", "ledger:application.advance:user:f1", "emit:application.status.changed"]);
  });
  it("a stage without submission keeps the status and locks nothing", () => {
    expect(planAdvance({ id: "a", status: "under_review", stage: "full" }, stages, "interview", funder)).toMatchObject({ ok: true, status: "under_review", lockResponsesOfStage: null, createFormResponses: [] });
  });
});

describe("award machine", () => {
  it("has exactly the specified edges", () => {
    expect(edges(awardMachine)).toEqual(
      [
        "offered>accept_offer>accepted",
        "accepted>activate>active",
        "active>suspend>suspended",
        "suspended>resume>active",
        "active>complete>completed",
        "offered>cancel>cancelled",
        "accepted>cancel>cancelled",
        "active>cancel>cancelled",
        "suspended>cancel>cancelled",
      ].sort(),
    );
  });
  it("active requires an executed agreement or noAgreementRequired", () => {
    expect(awardMachine.check("accepted", "activate", funder, { agreementStatus: "countersigned" })).toMatchObject({ ok: false, code: "guard_failed" });
    expect(awardMachine.check("accepted", "activate", funder, {})).toMatchObject({ ok: false });
    expect(awardMachine.check("accepted", "activate", funder, { agreementStatus: "executed" })).toMatchObject({ ok: true });
    expect(awardMachine.check("accepted", "activate", funder, { conditions: ["noAgreementRequired"] })).toMatchObject({ ok: true });
  });
  it("guards accept, suspend, cancel and complete", () => {
    expect(awardMachine.check("offered", "accept_offer", funder, {})).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(awardMachine.check("offered", "accept_offer", applicant, {})).toMatchObject({ ok: true });
    expect(awardMachine.check("active", "suspend", funder, {})).toMatchObject({ ok: false });
    expect(awardMachine.check("active", "suspend", funder, { reason: "audit" })).toMatchObject({ ok: true });
    expect(awardMachine.check("active", "cancel", funder, {})).toMatchObject({ ok: false });
    expect(awardMachine.check("active", "complete", funder, { openTranches: 1 })).toMatchObject({ ok: false });
    expect(awardMachine.check("active", "complete", funder, { openTranches: 0 })).toMatchObject({ ok: true });
    expect(awardMachine.check("completed", "cancel", funder, { reason: "x" })).toMatchObject({ ok: false, code: "invalid_from" });
  });
  it("accepted triggers the Passport mirror; CG projection carries the GMS status", () => {
    expect(awardEffects("accepted").mirrorToPassport).toBe(true);
    expect(awardEffects("active").mirrorToPassport).toBe(false);
    expect(awardEffects("suspended").holdOpenTranches).toBe(true);
    expect(awardEffects("cancelled").cancelOpenTranches).toBe(true);
    expect(AWARD_STATUSES.map((s) => awardCgStatus(s).value)).toEqual(["awarded", "awarded", "awarded", "awarded", "completed", "cancelled"]);
    expect(awardCgStatus("suspended")).toEqual({ value: "awarded", customValue: "suspended" });
  });
});

describe("agreement machine", () => {
  const sig: SignatureRecord = { name: "Maria Santos", userId: "u1", attested: true, ip: "203.0.113.7", at: "2027-05-21T10:00:00Z", documentSha256: "abc" };
  it("has exactly the specified edges", () => {
    expect(edges(agreementMachine)).toEqual(
      [
        "draft>send>sent",
        "sent>sign>signed_by_grantee",
        "signed_by_grantee>countersign>countersigned",
        "countersigned>execute>executed",
        "draft>void>voided",
        "sent>void>voided",
        "signed_by_grantee>void>voided",
        "countersigned>void>voided",
      ].sort(),
    );
  });
  it("refuses voiding an executed agreement", () => {
    expect(agreementMachine.check("executed", "void", funder, { reason: "mistake" })).toMatchObject({ ok: false, code: "invalid_from" });
    expect(voidRefusal("executed")).toMatch(/amendment/);
    expect(voidRefusal("voided")).toMatch(/already/);
    expect(voidRefusal("sent")).toBeNull();
    expect(agreementMachine.check("sent", "void", funder, {})).toMatchObject({ ok: false, code: "guard_failed" });
    expect(agreementMachine.check("sent", "void", funder, { reason: "wrong amount" })).toMatchObject({ ok: true });
  });
  it("click-to-sign needs name, attestation, IP, time and a matching hash", () => {
    const ok = { documentSha256: "abc", signature: sig };
    expect(agreementMachine.check("sent", "sign", applicant, ok)).toMatchObject({ ok: true });
    expect(agreementMachine.check("sent", "sign", funder, ok)).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(agreementMachine.check("sent", "sign", applicant, { documentSha256: "abc" })).toMatchObject({ ok: false });
    expect(agreementMachine.check("sent", "sign", applicant, { ...ok, signature: { ...sig, name: " " } })).toMatchObject({ ok: false });
    expect(agreementMachine.check("sent", "sign", applicant, { ...ok, signature: { ...sig, attested: false } })).toMatchObject({ ok: false });
    expect(agreementMachine.check("sent", "sign", applicant, { ...ok, signature: { ...sig, ip: "" } })).toMatchObject({ ok: false });
    expect(agreementMachine.check("sent", "sign", applicant, { ...ok, signature: { ...sig, documentSha256: "zzz" } })).toMatchObject({ ok: false });
    expect(agreementMachine.check("signed_by_grantee", "countersign", funder, ok)).toMatchObject({ ok: true });
    expect(agreementMachine.check("draft", "send", funder, {})).toMatchObject({ ok: false });
    expect(agreementMachine.check("draft", "send", funder, { documentSha256: "abc" })).toMatchObject({ ok: true });
  });
});

describe("tranche machine", () => {
  it("has exactly the specified edges", () => {
    expect(edges(trancheMachine)).toEqual(
      [
        "scheduled>mark_due>due",
        "due>mark_ready>ready",
        "due>hold>held",
        "ready>hold>held",
        "held>release_hold>due",
        "ready>release>releasing",
        "releasing>initiated>initiated",
        "releasing>refused>failed",
        "releasing>passport_hold>held",
        "held>resume_release>releasing",
        "held>passport_released>initiated",
        "failed>retry>due",
        "initiated>settle>settled",
        "initiated>fail>failed",
        "initiated>return>returned",
        "due>record_external>settled",
        "ready>record_external>settled",
        "scheduled>cancel>cancelled",
        "due>cancel>cancelled",
        "ready>cancel>cancelled",
        "held>cancel>cancelled",
        "failed>cancel>cancelled",
      ].sort(),
    );
  });
  it("guards due, ready, release, hold and external payments", () => {
    expect(trancheMachine.check("scheduled", "mark_due", system, {})).toMatchObject({ ok: false });
    expect(trancheMachine.check("scheduled", "mark_due", system, { conditionSatisfied: true })).toMatchObject({ ok: true });
    expect(trancheMachine.check("due", "mark_ready", system, { readinessReason: "Pending destination change" })).toMatchObject({ ok: false, reason: "Pending destination change" });
    expect(trancheMachine.check("ready", "release", funder, { readinessPassed: true })).toMatchObject({ ok: false, reason: "A release needs an idempotency key." });
    expect(trancheMachine.check("ready", "release", funder, { readinessPassed: false, idempotencyKey: "trn_1" })).toMatchObject({ ok: false });
    expect(trancheMachine.check("ready", "release", system, { readinessPassed: true, idempotencyKey: "trn_1" })).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(trancheMachine.check("ready", "release", funder, { readinessPassed: true, idempotencyKey: "trn_1" })).toMatchObject({ ok: true });
    expect(trancheMachine.check("ready", "hold", passport, {})).toMatchObject({ ok: false });
    expect(trancheMachine.check("ready", "hold", passport, { holdReason: "Level below L3" })).toMatchObject({ ok: true });
    expect(trancheMachine.check("releasing", "initiated", passport, {})).toMatchObject({ ok: false });
    expect(trancheMachine.check("due", "record_external", funder, { external: { reference: "", paidAt: "" } })).toMatchObject({ ok: false });
    expect(trancheMachine.check("initiated", "cancel", funder, {})).toMatchObject({ ok: false, code: "invalid_from" });
    expect(trancheMachine.check("releasing", "cancel", funder, {})).toMatchObject({ ok: false, code: "invalid_from" });
  });
  it("walks the facilitated and resolve paths with the right patches", async () => {
    const r = recorder();
    await trancheMachine.transition({ id: "trn_1", status: "ready" }, "release", funder, { readinessPassed: true, idempotencyKey: "trn_1", now: "t" }, r.ports);
    await trancheMachine.transition({ id: "trn_1", status: "releasing" }, "initiated", passport, { passportDisbursementId: "dsb_1", passportStatus: "initiated" }, r.ports);
    await trancheMachine.transition({ id: "trn_1", status: "initiated" }, "settle", passport, {}, r.ports);
    await trancheMachine.transition({ id: "trn_2", status: "due" }, "record_external", funder, { external: { reference: "CHK-1", paidAt: "2027-05-01", destinationLast4: "4821" } }, r.ports);
    expect(r.writes.map((w) => w.to)).toEqual(["releasing", "initiated", "settled", "settled"]);
    expect(r.writes[0]?.patch).toMatchObject({ mode: "facilitated", idempotency_key: "trn_1", released_by: "user:f1" });
    expect(r.writes[1]?.patch).toMatchObject({ passport_disbursement_id: "dsb_1" });
    expect(r.writes[3]?.patch).toMatchObject({ mode: "resolve", external: { reference: "CHK-1" } });
  });
  it("follows a hold that Passport places on a disbursement during a destination change", async () => {
    const r = recorder();
    const held = { holdReason: "Destination change in flight", passportDisbursementId: "dsb_9", passportStatus: "held" };
    expect(trancheMachine.check("releasing", "passport_hold", passport, {})).toMatchObject({ ok: false, reason: "A hold needs a reason." });
    expect(trancheMachine.check("releasing", "passport_hold", funder, held)).toMatchObject({ ok: false, code: "actor_not_allowed" });
    await trancheMachine.transition({ id: "trn_3", status: "releasing" }, "passport_hold", passport, held, r.ports);
    // A GMS hold has no disbursement at Passport, so it cannot resume straight into flight.
    expect(trancheMachine.check("held", "resume_release", funder, {})).toMatchObject({ ok: false, code: "guard_failed" });
    expect(trancheMachine.check("held", "passport_released", passport, {})).toMatchObject({ ok: false, code: "guard_failed" });
    await trancheMachine.transition({ id: "trn_3", status: "held" }, "resume_release", funder, { passportDisbursementId: "dsb_9" }, r.ports);
    await trancheMachine.transition({ id: "trn_4", status: "held" }, "passport_released", passport, { passportDisbursementId: "dsb_10", passportStatus: "initiated" }, r.ports);
    expect(r.writes.map((w) => `${w.from}>${w.to}`)).toEqual(["releasing>held", "held>releasing", "held>initiated"]);
    expect(r.writes[0]?.patch).toMatchObject({ hold_reason: "Destination change in flight", passport_disbursement_id: "dsb_9", passport_status: "held" });
    expect(r.writes[1]?.patch).toMatchObject({ hold_reason: null });
    expect(r.writes[2]?.patch).toMatchObject({ hold_reason: null, passport_disbursement_id: "dsb_10" });
  });
});

describe("requirement and submission machines", () => {
  it("have exactly the specified edges", () => {
    expect(edges(requirementMachine)).toEqual(
      [
        "scheduled>mark_due>due",
        "due>mark_overdue>overdue",
        "due>submit>submitted",
        "overdue>submit>submitted",
        "submitted>start_review>under_review",
        "under_review>accept>accepted",
        "under_review>return>returned",
        "returned>reopen>due",
        ...["scheduled", "due", "overdue", "submitted", "under_review", "returned"].map((s) => `${s}>waive>waived`),
      ].sort(),
    );
    expect(edges(submissionMachine)).toEqual(
      ["draft>submit>submitted", "submitted>start_review>under_review", "under_review>accept>accepted", "under_review>return>returned", "returned>revise>draft"].sort(),
    );
  });
  it("guards waive, return and submit", () => {
    expect(requirementMachine.check("due", "waive", funder, {})).toMatchObject({ ok: false });
    expect(requirementMachine.check("due", "waive", funder, { reason: "Merged into final" })).toMatchObject({ ok: true });
    expect(requirementMachine.check("accepted", "waive", funder, { reason: "x" })).toMatchObject({ ok: false, code: "invalid_from" });
    expect(requirementMachine.check("under_review", "return", funder, {})).toMatchObject({ ok: false });
    expect(requirementMachine.check("due", "submit", funder, {})).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(submissionMachine.check("draft", "submit", applicant, {})).toMatchObject({ ok: false });
    expect(submissionMachine.check("draft", "submit", applicant, { formsComplete: true })).toMatchObject({ ok: true });
    expect(submissionMachine.check("under_review", "return", funder, {})).toMatchObject({ ok: false });
    expect(submissionMachine.check("under_review", "return", funder, { reviewNote: "Add actuals" })).toMatchObject({ ok: true });
  });
});

describe("cross-machine effects", () => {
  const tranches: TrancheRef[] = [
    { id: "trn_1", status: "scheduled", condition: { type: "onExecution" } },
    { id: "trn_2", status: "scheduled", condition: { type: "onReportAccepted", requirementId: "req_1" } },
    { id: "trn_3", status: "cancelled", condition: { type: "onExecution" } },
  ];
  it("executing the agreement activates the award and makes onExecution tranches due", async () => {
    expect(tranchesDueOnExecution(tranches).map((t) => t.id)).toEqual(["trn_1"]);
    const r = recorder();
    const res = await executeAgreement({ agreement: { id: "agr_1", status: "countersigned" }, award: { id: "awd_1", status: "accepted" }, tranches }, funder, { now: "t" }, r.ports);
    expect(res.agreement.ok && res.award?.ok).toBe(true);
    expect(res.tranchesDue).toEqual(["trn_1"]);
    expect(r.writes.map((w) => `${w.id}:${w.to}`)).toEqual(["agr_1:executed", "awd_1:active", "trn_1:due"]);
    expect(r.events).toEqual(["agreement.executed", "award.status.changed", "tranche.due", "tranche.status.changed"]);
  });
  it("does nothing downstream when the agreement cannot execute", async () => {
    const r = recorder();
    const res = await executeAgreement({ agreement: { id: "agr_1", status: "sent" }, award: { id: "awd_1", status: "accepted" }, tranches }, funder, {}, r.ports);
    expect(res).toMatchObject({ agreement: { ok: false }, award: null, tranchesDue: [] });
    expect(r.calls).toEqual([]);
  });
  it("accepting a requirement releases its linked tranche", async () => {
    const r = recorder();
    const res = await acceptRequirement({ requirement: { id: "req_1", status: "under_review", releasesTrancheId: "trn_2" }, tranche: tranches[1] }, funder, {}, r.ports);
    expect(res.trancheDue).toBe("trn_2");
    expect(r.writes.map((w) => `${w.id}:${w.to}`)).toEqual(["req_1:accepted", "trn_2:due"]);
    expect(r.events).toEqual(["submission.accepted", "tranche.due", "tranche.status.changed"]);
  });
  it("leaves the tranche alone when unlinked, mismatched or not scheduled", async () => {
    const r = recorder();
    expect((await acceptRequirement({ requirement: { id: "req_1", status: "under_review" }, tranche: tranches[1] }, funder, {}, r.ports)).trancheDue).toBeNull();
    expect((await acceptRequirement({ requirement: { id: "req_1", status: "under_review", releasesTrancheId: "trn_9" }, tranche: tranches[1] }, funder, {}, r.ports)).trancheDue).toBeNull();
    expect((await acceptRequirement({ requirement: { id: "req_1", status: "under_review", releasesTrancheId: "trn_3" }, tranche: tranches[2] }, funder, {}, r.ports)).trancheDue).toBeNull();
    expect((await acceptRequirement({ requirement: { id: "req_1", status: "due", releasesTrancheId: "trn_2" }, tranche: tranches[1] }, funder, {}, r.ports)).requirement.ok).toBe(false);
  });
});
