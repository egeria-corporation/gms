// SPDX-License-Identifier: AGPL-3.0-only
// The outside_application machine: every edge, every guard, reopen, archive, and what the ledger gets.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUTSIDE_EDGES, OUTSIDE_STAGES, OUTSIDE_WEBHOOK_EVENTS, checkOutside, plainMovesFrom, reopenTarget, transitionOutside, type OutsideStage, type OutsideSubject } from "../src/index.ts";
import { applicant, funder, passport, recorder, system } from "./helpers.ts";

const NOW = "2027-04-16T17:00:00.000Z";
const at = (stage: OutsideStage, extra: Partial<OutsideSubject> = {}): OutsideSubject => ({ id: "oa_1", stage, previousStage: null, archivedAt: null, ...extra });

describe("outside_application edges", () => {
  it("has exactly the contract's edges", () => {
    const edges = Object.entries(OUTSIDE_EDGES).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)).sort();
    expect(edges).toEqual(
      [
        "prospect>deciding", "prospect>loi", "prospect>drafting", "prospect>not_pursuing",
        "deciding>loi", "deciding>drafting", "deciding>not_pursuing",
        "loi>invited", "loi>declined", "loi>withdrawn", "loi>not_pursuing",
        "invited>drafting",
        "drafting>submitted", "drafting>withdrawn", "drafting>not_pursuing",
        "submitted>awarded", "submitted>declined", "submitted>withdrawn",
      ].sort(),
    );
  });

  it("allows every plain edge as a move and refuses every other pair", () => {
    for (const from of OUTSIDE_STAGES) {
      for (const to of OUTSIDE_STAGES) {
        const c = checkOutside(at(from), { action: "move", to }, applicant, NOW);
        const plain = OUTSIDE_EDGES[from].includes(to) && !["submitted", "awarded", "declined"].includes(to);
        expect(c.ok, `${from} → ${to}`).toBe(plain);
        if (plain && c.ok) expect(c.patch).toEqual({ stage: to, previous_stage: from });
      }
    }
  });

  it("lists plain moves (no submitted, awarded or declined)", () => {
    expect(plainMovesFrom("prospect")).toEqual(["deciding", "loi", "drafting", "not_pursuing"]);
    expect(plainMovesFrom("loi")).toEqual(["invited", "withdrawn", "not_pursuing"]);
    expect(plainMovesFrom("drafting")).toEqual(["withdrawn", "not_pursuing"]);
    expect(plainMovesFrom("submitted")).toEqual(["withdrawn"]);
    expect(plainMovesFrom("awarded")).toEqual([]);
  });

  it("matches the stage vocabulary of migration 0029", () => {
    const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
    const sql = readFileSync(dir + readdirSync(dir).find((f) => f.startsWith("0029_"))!, "utf8");
    const m = /stage\s+text not null default 'drafting' check \(stage in \(([^)]*)\)\)/.exec(sql);
    expect([...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([...OUTSIDE_STAGES]);
  });
});

describe("outside_application guards", () => {
  it("refuses a plain move into a recorded stage, with the reason", () => {
    expect(checkOutside(at("drafting"), { action: "move", to: "submitted" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed", reason: "Mark it submitted with the date and how it was sent." });
    expect(checkOutside(at("submitted"), { action: "move", to: "awarded" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed", reason: "Record the funder's decision instead." });
    expect(checkOutside(at("loi"), { action: "move", to: "declined" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
  });

  it("submitted needs the date and the method", () => {
    expect(checkOutside(at("drafting"), { action: "submit" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed", reason: "Give the date it was submitted." });
    expect(checkOutside(at("drafting"), { action: "submit", submittedAt: "not a date", method: "portal" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("drafting"), { action: "submit", submittedAt: "2027-04-15T12:00:00Z" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("drafting"), { action: "submit", submittedAt: "2027-04-15T12:00:00Z", method: "fax" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("prospect"), { action: "submit", submittedAt: "2027-04-15T12:00:00Z", method: "portal" }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
    const ok = checkOutside(at("drafting"), { action: "submit", submittedAt: "2027-04-15T12:00:00Z", method: "grants_gov" }, applicant, NOW);
    expect(ok).toMatchObject({ ok: true, from: "drafting", to: "submitted", eventType: "outside_application.submitted", patch: { stage: "submitted", previous_stage: "drafting", submitted_at: "2027-04-15T12:00:00.000Z", submission_method: "grants_gov" } });
  });

  it("awarded needs an amount of zero or more; declined and withdrawn follow the edges", () => {
    expect(checkOutside(at("submitted"), { action: "decide", outcome: "awarded" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed", reason: "Give the amount awarded (zero or more)." });
    expect(checkOutside(at("submitted"), { action: "decide", outcome: "awarded", awardedAmountMinor: -1 }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("submitted"), { action: "decide", outcome: "awarded", awardedAmountMinor: 1.5 }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("submitted"), { action: "decide", outcome: "awarded", awardedAmountMinor: 0 }, applicant, NOW)).toMatchObject({ ok: true, to: "awarded", patch: { awarded_amount_minor: 0, decided_at: NOW } });
    expect(checkOutside(at("loi"), { action: "decide", outcome: "declined" }, applicant, NOW)).toMatchObject({ ok: true, to: "declined" });
    expect(checkOutside(at("drafting"), { action: "decide", outcome: "withdrawn" }, applicant, NOW)).toMatchObject({ ok: true, to: "withdrawn" });
    expect(checkOutside(at("drafting"), { action: "decide", outcome: "awarded", awardedAmountMinor: 100 }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
    expect(checkOutside(at("drafting"), { action: "decide", outcome: "declined" }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
    expect(checkOutside(at("submitted"), { action: "decide", outcome: "maybe" as never }, applicant, NOW)).toMatchObject({ ok: false, code: "unknown_action" });
  });

  it("nothing moves while archived; archive and unarchive toggle", () => {
    const archived = at("drafting", { archivedAt: NOW });
    for (const req of [{ action: "move", to: "withdrawn" }, { action: "submit", submittedAt: NOW, method: "portal" }, { action: "decide", outcome: "withdrawn" }, { action: "reopen" }, { action: "archive" }] as const) {
      expect(checkOutside(archived, req, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed", reason: "This application is archived. Unarchive it first." });
    }
    expect(checkOutside(archived, { action: "unarchive" }, applicant, NOW)).toMatchObject({ ok: true, from: "drafting", to: "drafting", eventType: "outside_application.archived", patch: { archived_at: null }, data: { archived: false } });
    expect(checkOutside(at("drafting"), { action: "unarchive" }, applicant, NOW)).toMatchObject({ ok: false, code: "guard_failed" });
    expect(checkOutside(at("awarded"), { action: "archive" }, applicant, NOW)).toMatchObject({ ok: true, patch: { archived_at: NOW }, data: { archived: true } });
  });

  it("only the applicant moves its record", () => {
    for (const who of [funder, system, passport]) expect(checkOutside(at("prospect"), { action: "move", to: "deciding" }, who, NOW)).toMatchObject({ ok: false, code: "actor_not_allowed" });
  });

  it("refuses unknown actions and stages", () => {
    expect(checkOutside(at("prospect"), { action: "teleport" } as never, applicant, NOW)).toMatchObject({ ok: false, code: "unknown_action" });
    expect(checkOutside(at("prospect"), { action: "move", to: "paid" as never }, applicant, NOW)).toMatchObject({ ok: false, code: "unknown_action" });
  });
});

describe("reopen", () => {
  it("returns to the stage before the application closed and clears a decision", () => {
    expect(checkOutside(at("awarded", { previousStage: "submitted" }), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: true, from: "awarded", to: "submitted", eventType: "outside_application.reopened", patch: { stage: "submitted", previous_stage: "awarded", decided_at: null, awarded_amount_minor: null, award_by_year: [], grant_start: null, grant_end: null } });
    expect(checkOutside(at("declined", { previousStage: "loi" }), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: true, to: "loi" });
    expect(checkOutside(at("withdrawn", { previousStage: "drafting" }), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: true, to: "drafting", patch: { stage: "drafting", previous_stage: "withdrawn" } });
    expect(checkOutside(at("not_pursuing", { previousStage: "deciding" }), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: true, to: "deciding" });
  });

  it("falls back when no open earlier stage was recorded", () => {
    expect(reopenTarget({ stage: "awarded", previousStage: null })).toBe("submitted");
    expect(reopenTarget({ stage: "declined", previousStage: "withdrawn" })).toBe("submitted");
    expect(reopenTarget({ stage: "withdrawn", previousStage: null })).toBe("drafting");
    expect(reopenTarget({ stage: "not_pursuing", previousStage: null })).toBe("prospect");
  });

  it("refuses an open application", () => {
    for (const s of ["prospect", "deciding", "loi", "invited", "drafting", "submitted"] as const) expect(checkOutside(at(s), { action: "reopen" }, applicant, NOW)).toMatchObject({ ok: false, code: "invalid_from" });
  });
});

describe("transitionOutside", () => {
  it("runs guard → write → ledger, sends no webhook, and ledgers stages and dates only", async () => {
    const r = recorder();
    const ledger: Record<string, unknown>[] = [];
    const ports = { ...r.ports, ledger: async (e: { eventType: string; data: Record<string, unknown> }) => void ledger.push({ type: e.eventType, ...e.data }) };
    const res = await transitionOutside(at("submitted"), { action: "decide", outcome: "awarded", awardedAmountMinor: 2_500_000 }, applicant, ports, NOW);
    expect(res).toMatchObject({ ok: true, to: "awarded" });
    expect(r.writes).toEqual([{ id: "oa_1", from: "submitted", to: "awarded", patch: { stage: "awarded", previous_stage: "submitted", decided_at: NOW, awarded_amount_minor: 2_500_000 } }]);
    expect(ledger).toEqual([{ type: "outside_application.decided", from: "submitted", to: "awarded", decidedAt: NOW }]);
    expect(r.events).toEqual([]);
    expect(OUTSIDE_WEBHOOK_EVENTS).toEqual([]);
  });

  it("touches no port when refused", async () => {
    const r = recorder();
    expect(await transitionOutside(at("prospect"), { action: "move", to: "awarded" }, applicant, r.ports, NOW)).toMatchObject({ ok: false });
    expect(r.calls).toEqual([]);
  });

  it("names each ledger event by the contract's vocabulary", async () => {
    const seen: string[] = [];
    const ports = { write: async () => {}, emit: async () => {}, ledger: async (e: { eventType: string }) => void seen.push(e.eventType) };
    await transitionOutside(at("prospect"), { action: "move", to: "drafting" }, applicant, ports, NOW);
    await transitionOutside(at("drafting"), { action: "submit", submittedAt: NOW, method: "email" }, applicant, ports, NOW);
    await transitionOutside(at("submitted"), { action: "decide", outcome: "declined" }, applicant, ports, NOW);
    await transitionOutside(at("declined", { previousStage: "submitted" }), { action: "reopen" }, applicant, ports, NOW);
    await transitionOutside(at("drafting"), { action: "archive" }, applicant, ports, NOW);
    await transitionOutside(at("drafting", { archivedAt: NOW }), { action: "unarchive" }, applicant, ports, NOW);
    expect(seen).toEqual(["outside_application.stage_changed", "outside_application.submitted", "outside_application.decided", "outside_application.reopened", "outside_application.archived", "outside_application.archived"]);
  });
});
