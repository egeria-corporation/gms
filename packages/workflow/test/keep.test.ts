// SPDX-License-Identifier: AGPL-3.0-only
// v1.6.0 and v1.7.0 on the outside_application machine: the go/no-go decision and the closeout.
import { describe, expect, it } from "vitest";
import { checkOutside, transitionOutside, type OutsideStage, type OutsideSubject } from "../src/index.ts";
import { applicant, funder, recorder } from "./helpers.ts";

const NOW = "2027-04-16T17:00:00.000Z";
const at = (stage: OutsideStage, extra: Partial<OutsideSubject> = {}): OutsideSubject => ({ id: "oa_1", stage, previousStage: null, archivedAt: null, ...extra });

describe("go/no-go", () => {
  it("go moves a deciding application to a letter of inquiry or drafting; no go to not pursuing", async () => {
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "go", to: "loi", eligible: true }, applicant, NOW)).toMatchObject({ ok: true, to: "loi", eventType: "outside_application.go_no_go_decided", patch: { stage: "loi", previous_stage: "deciding" }, data: { decision: "go" } });
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "go", to: "drafting", eligible: true }, applicant, NOW)).toMatchObject({ ok: true, to: "drafting" });
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "no_go", eligible: false }, applicant, NOW)).toMatchObject({ ok: true, to: "not_pursuing", data: { decision: "no_go" } });
    const r = recorder();
    await transitionOutside(at("deciding"), { action: "go_no_go", decision: "go", to: "drafting", eligible: true }, { id: "user:u1", kind: "applicant" }, r.ports, NOW);
    expect(r.writes).toEqual([{ id: "oa_1", from: "deciding", to: "drafting", patch: { stage: "drafting", previous_stage: "deciding" } }]);
    expect(r.calls).toEqual(["write", "ledger:outside_application.go_no_go_decided:user:u1"]);
  });

  it("refuses go when not eligible, without a target, outside deciding, archived, or for a funder", () => {
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "go", to: "loi", eligible: false }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "go", to: null, eligible: true }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "go", to: "submitted" as never, eligible: true }, applicant, NOW)).toMatchObject({ ok: false });
    for (const stage of ["prospect", "loi", "drafting", "submitted", "awarded"] as const) expect(checkOutside(at(stage), { action: "go_no_go", decision: "no_go", eligible: true }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
    expect(checkOutside(at("deciding", { archivedAt: NOW }), { action: "go_no_go", decision: "no_go", eligible: true }, applicant, NOW)).toMatchObject({ ok: false });
    expect(checkOutside(at("deciding"), { action: "go_no_go", decision: "no_go", eligible: true }, funder, NOW)).toMatchObject({ ok: false, code: "actor_not_allowed" });
  });
});

describe("closeout", () => {
  it("closes out an awarded application once everything is settled; the stage stays awarded", () => {
    expect(checkOutside(at("awarded"), { action: "close_out", settled: true }, applicant, NOW)).toMatchObject({ ok: true, from: "awarded", to: "awarded", eventType: "outside_application.closed_out", patch: { closed_out_at: NOW } });
  });

  it("refuses with obligations open, twice, or for an application that is not awarded", () => {
    expect(checkOutside(at("awarded"), { action: "close_out", settled: false }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("awarded", { closedOutAt: NOW }), { action: "close_out", settled: true }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("submitted"), { action: "close_out", settled: true }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
  });

  it("reopening an award clears its closeout", () => {
    expect(checkOutside(at("awarded", { previousStage: "submitted", closedOutAt: NOW }), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: true, patch: { closed_out_at: null } });
  });
});
