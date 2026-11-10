// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  allocation,
  autoAssign,
  canSeeOtherReviews,
  checkCommit,
  detectCoi,
  maskApplicantContact,
  maskForReviewer,
  mean,
  median,
  normalize,
  rankApplications,
  scoreReview,
  stdev,
  sumProposed,
  validateRubric,
  MASK,
  type ReviewerProfile,
  type Rubric,
  type SubmittedReview,
} from "../src/index.ts";

const rubric: Rubric = {
  id: "rub_1",
  version: 1,
  spreadThreshold: 15,
  criteria: [
    { key: "impact", label: "Impact", weight: 50, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "feasibility", label: "Feasibility", weight: 30, scale: { type: "numeric", min: 0, max: 10 } },
    { key: "budget", label: "Budget", weight: 20, scale: { type: "categorical", options: [{ value: "strong", score: 1 }, { value: "adequate", score: 0.5 }, { value: "weak", score: 0 }] } },
  ],
};

describe("scoring", () => {
  it("normalizes numeric and categorical criteria", () => {
    const [impact, feas, budget] = rubric.criteria;
    expect(normalize(impact!, 1)).toBe(0);
    expect(normalize(impact!, 4)).toBe(0.75);
    expect(normalize(feas!, 8)).toBe(0.8);
    expect(normalize(budget!, "adequate")).toBe(0.5);
    expect(typeof normalize(impact!, 6)).toBe("string");
    expect(typeof normalize(impact!, "4")).toBe("string");
    expect(typeof normalize(budget!, "great")).toBe("string");
    expect(typeof normalize(impact!, undefined)).toBe("string");
  });
  it("overall = weighted sum × 100", () => {
    // (0.5·1 + 0.3·0.8 + 0.2·1) × 100 = 94
    expect(scoreReview(rubric, { impact: 5, feasibility: 8, budget: "strong" }).overall).toBeCloseTo(94, 10);
    // accepts the stored { value, comment } shape
    expect(scoreReview(rubric, { impact: { value: 4, comment: "ok" }, feasibility: { value: 6 }, budget: "adequate" }).overall).toBeCloseTo(65.5, 10);
  });
  it("weights are relative", () => {
    const halved: Rubric = { ...rubric, criteria: rubric.criteria.map((c) => ({ ...c, weight: c.weight / 2 })) };
    expect(scoreReview(halved, { impact: 5, feasibility: 8, budget: "strong" }).overall).toBeCloseTo(94, 10);
  });
  it("an incomplete review has no overall", () => {
    const s = scoreReview(rubric, { impact: 5, budget: "strong" });
    expect(s).toMatchObject({ complete: false, overall: null });
    expect(s.issues).toEqual([{ criterion: "feasibility", message: "Feasibility has no score." }]);
  });
  it("validates rubrics", () => {
    expect(validateRubric(rubric)).toEqual([]);
    expect(validateRubric({ id: "r", version: 1, criteria: [] })).toHaveLength(1);
    const bad: Rubric = {
      id: "r",
      version: 1,
      criteria: [
        { key: "a", label: "A", weight: 0, scale: { type: "numeric", min: 5, max: 5 } },
        { key: "a", label: "A2", weight: 1, scale: { type: "categorical", options: [] } },
        { key: "b", label: "B", weight: 1, scale: { type: "categorical", options: [{ value: "x", score: 2 }] } },
      ],
    };
    expect(validateRubric(bad)).toHaveLength(5);
  });
});

describe("ranking (hand-computed fixture)", () => {
  // Overalls — A: 94, 65.5, 55 · B: 81.5, 68.5 · C: 27.5 · D: no reviews
  const reviews: SubmittedReview[] = [
    { applicationId: "app_A", reviewerId: "r1", scores: { impact: 5, feasibility: 8, budget: "strong" } },
    { applicationId: "app_A", reviewerId: "r2", scores: { impact: 4, feasibility: 6, budget: "adequate" } },
    { applicationId: "app_A", reviewerId: "r3", scores: { impact: 3, feasibility: 10, budget: "weak" } },
    { applicationId: "app_B", reviewerId: "r1", scores: { impact: 4, feasibility: 8, budget: "strong" } },
    { applicationId: "app_B", reviewerId: "r2", scores: { impact: 4, feasibility: 7, budget: "adequate" } },
    { applicationId: "app_B", reviewerId: "r3", scores: { impact: 4 } },
    { applicationId: "app_C", reviewerId: "r1", scores: { impact: 2, feasibility: 5, budget: "weak" } },
  ];
  const rows = rankApplications(rubric, ["app_A", "app_B", "app_C", "app_D"], reviews);
  const row = (id: string) => rows.find((r) => r.applicationId === id)!;
  it("orders by mean", () => {
    expect(rows.map((r) => [r.applicationId, r.rank])).toEqual([["app_B", 1], ["app_A", 2], ["app_C", 3], ["app_D", null]]);
  });
  it("computes mean, median, stdev and n", () => {
    const a = row("app_A");
    expect(a.n).toBe(3);
    expect(a.mean).toBeCloseTo(71.5, 10);
    expect(a.median).toBeCloseTo(65.5, 10);
    // deviations 22.5, −6, −16.5 → Σ² = 814.5 → /2 = 407.25 → √ = 20.1804…
    expect(a.stdev).toBeCloseTo(20.1804, 4);
    const b = row("app_B");
    expect(b.n).toBe(2);
    expect(b.mean).toBeCloseTo(75, 10);
    expect(b.median).toBeCloseTo(75, 10);
    expect(b.stdev).toBeCloseTo(Math.sqrt(84.5), 10);
    expect(b.incomplete).toEqual(["r3"]);
    expect(row("app_C")).toMatchObject({ n: 1, stdev: 0, spreadFlag: false });
    expect(row("app_C").mean).toBeCloseTo(27.5, 10);
    expect(row("app_D")).toMatchObject({ n: 0, mean: null, median: null, stdev: null, spreadFlag: false });
  });
  it("flags spread above the threshold", () => {
    expect(row("app_A").spreadFlag).toBe(true);
    expect(row("app_B").spreadFlag).toBe(false);
    expect(rankApplications(rubric, ["app_B"], reviews, { spreadThreshold: 5 })[0]!.spreadFlag).toBe(true);
  });
  it("ties share a rank", () => {
    const same = { impact: 5, feasibility: 8, budget: "strong" };
    const tied = rankApplications(rubric, ["x", "y", "z"], [
      { applicationId: "x", reviewerId: "r1", scores: same },
      { applicationId: "y", reviewerId: "r1", scores: same },
      { applicationId: "z", reviewerId: "r1", scores: { impact: 1, feasibility: 0, budget: "weak" } },
    ]);
    expect(tied.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
  it("stat helpers", () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(stdev([5])).toBe(0);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });
});

describe("assignment and COI", () => {
  const reviewers: ReviewerProfile[] = [
    { id: "priya", email: "priya@riverbendcf.example", capacity: 2, tags: ["health"] },
    { id: "hollis", email: "hollis@aldercreek.example", capacity: 2, tags: ["health", "rural"] },
    { id: "sam", email: "sam@gmail.com", capacity: 1, tags: ["arts"], conflicts: { orgIds: ["org_harbor"], programIds: ["prg_x"] } },
  ];
  it("detects declared and domain conflicts", () => {
    expect(detectCoi(reviewers[1]!, { id: "a", applicantDomains: ["AlderCreek.example"] })?.reason).toBe("same_email_domain");
    expect(detectCoi(reviewers[2]!, { id: "a", applicantOrgId: "org_harbor" })?.reason).toBe("declared_org");
    expect(detectCoi(reviewers[2]!, { id: "a", programId: "prg_x" })?.reason).toBe("declared_program");
    // public mailbox providers never flag
    expect(detectCoi(reviewers[2]!, { id: "a", applicantDomains: ["gmail.com"] })).toBeNull();
    expect(detectCoi(reviewers[0]!, { id: "a", applicantOrgId: "org_alder", applicantDomains: ["aldercreek.example"] })).toBeNull();
  });
  it("assigns by expertise then load, excluding conflicts and respecting capacity", () => {
    const res = autoAssign({
      reviewersPerApplication: 2,
      reviewers,
      applications: [
        { id: "app_1", applicantOrgId: "org_alder", applicantDomains: ["aldercreek.example"], tags: ["health", "rural"] },
        { id: "app_2", applicantOrgId: "org_harbor", applicantDomains: ["harborlight.example"], tags: ["health"] },
        { id: "app_3", applicantOrgId: "org_n", tags: ["arts"] },
      ],
    });
    expect(res.coiFlags.map((f) => `${f.applicationId}:${f.reviewerId}:${f.reason}`).sort()).toEqual(["app_1:hollis:same_email_domain", "app_2:sam:declared_org"]);
    expect(res.assignments.map((a) => `${a.applicationId}:${a.reviewerId}`)).toEqual(["app_1:priya", "app_1:sam", "app_2:hollis", "app_2:priya", "app_3:hollis"]);
    expect(res.unfilled).toEqual([{ applicationId: "app_3", missing: 1 }]);
    const perReviewer = new Map<string, number>();
    for (const a of res.assignments) perReviewer.set(a.reviewerId, (perReviewer.get(a.reviewerId) ?? 0) + 1);
    for (const r of reviewers) expect(perReviewer.get(r.id) ?? 0).toBeLessThanOrEqual(r.capacity);
  });
  it("counts existing load and assignments", () => {
    const res = autoAssign({
      reviewersPerApplication: 2,
      reviewers: [{ id: "a", email: "a@x.example", capacity: 1, load: 1 }, { id: "b", email: "b@x.example", capacity: 3 }, { id: "c", email: "c@x.example", capacity: 3 }],
      applications: [{ id: "app_1", assignedReviewerIds: ["b"] }],
    });
    expect(res.assignments).toEqual([{ applicationId: "app_1", reviewerId: "c", matchedTags: [] }]);
    expect(res.unfilled).toEqual([]);
  });
});

describe("visibility", () => {
  const base = { viewerRole: "reviewer" as const, viewerHasSubmitted: false, panelOpen: false };
  it("blind mode hides other reviews until the panel", () => {
    expect(canSeeOtherReviews({ ...base, mode: "blind" })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "blind", viewerHasSubmitted: true })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "blind", panelOpen: true })).toBe(true);
  });
  it("see-after-submit and open", () => {
    expect(canSeeOtherReviews({ ...base, mode: "see_after_submit" })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "see_after_submit", viewerHasSubmitted: true })).toBe(true);
    expect(canSeeOtherReviews({ ...base, mode: "open", viewerRole: "external_reviewer" })).toBe(true);
  });
  it("staff, recusal and funder-only reviews", () => {
    expect(canSeeOtherReviews({ ...base, mode: "blind", viewerRole: "program_officer" })).toBe(true);
    expect(canSeeOtherReviews({ ...base, mode: "blind", viewerRole: "auditor" })).toBe(true);
    expect(canSeeOtherReviews({ ...base, mode: "blind", viewerRole: "finance" })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "open", viewerRecused: true })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "open", panelOpen: true, reviewVisibility: "funder_only" })).toBe(false);
    expect(canSeeOtherReviews({ ...base, mode: "blind", viewerRole: "admin", reviewVisibility: "funder_only" })).toBe(true);
  });
  it("masks fields for reviewers without touching the input", () => {
    const response = { need: "Rural families…", contact: { name: "Maria Santos", phone: "555-0100" }, internalNote: "x", salaryTable: [1] };
    const meta = { internalNote: { reviewerVisible: false }, "contact.name": { pii: true }, "contact.phone": { pii: true }, salaryTable: { pii: true, reviewerVisible: false }, absent: { pii: true }, "a.b": { reviewerVisible: false } };
    const ext = maskForReviewer(response, meta, { external: true });
    expect(ext.response).toEqual({ need: "Rural families…", contact: { name: MASK, phone: MASK } });
    expect(ext.hidden).toEqual(["internalNote", "salaryTable"]);
    expect(ext.masked).toEqual(["contact.name", "contact.phone"]);
    const internal = maskForReviewer(response, meta, { external: false });
    expect(internal.response).toEqual({ need: "Rural families…", contact: { name: "Maria Santos", phone: "555-0100" } });
    expect(response.internalNote).toBe("x");
  });
  it("external reviewers get no applicant contact details", () => {
    const org = { name: "Alder Creek", emails: { primary: "a@b.example" }, phones: {}, addresses: {} };
    expect(maskApplicantContact(org, { external: true })).toEqual({ name: "Alder Creek" });
    expect(maskApplicantContact(org, { external: false })).toBe(org);
  });
});

describe("budget allocator", () => {
  it("available = budget − committed − proposed", () => {
    expect(allocation({ budgetMinor: 100_000_00, committedMinor: 40_000_00, proposedMinor: 35_000_00 })).toMatchObject({ availableMinor: 25_000_00, over: false, overByMinor: 0 });
    expect(allocation({ budgetMinor: 100_000_00, committedMinor: 40_000_00, proposedMinor: 60_000_00 })).toMatchObject({ availableMinor: 0, over: false });
    expect(allocation({ budgetMinor: 100_000_00, committedMinor: 40_000_00, proposedMinor: 60_000_01 })).toMatchObject({ availableMinor: -1, over: true, overByMinor: 1 });
    expect(() => allocation({ budgetMinor: 1.5, committedMinor: 0, proposedMinor: 0 })).toThrow(RangeError);
    expect(() => allocation({ budgetMinor: 1, committedMinor: -1, proposedMinor: 0 })).toThrow(RangeError);
  });
  it("sums only approvals", () => {
    expect(sumProposed([{ outcome: "approve", amountMinor: 150_000_00 }, { outcome: "decline", amountMinor: 5 }, { outcome: "waitlist" }, { outcome: "approve", amountMinor: null }])).toBe(150_000_00);
  });
  it("refuses over-allocation unless an admin overrides with a reason", () => {
    const over = { budgetMinor: 100, committedMinor: 60, proposedMinor: 50 };
    expect(checkCommit({ ...over, proposedMinor: 40 })).toMatchObject({ ok: true, override: null });
    expect(checkCommit(over)).toMatchObject({ ok: false });
    expect(checkCommit(over, { role: "program_officer", userId: "u1", reason: "board approved" })).toMatchObject({ ok: false, reason: "Only a workspace admin can override the budget allocator." });
    expect(checkCommit(over, { role: "admin", userId: "u1", reason: "  " })).toMatchObject({ ok: false });
    expect(checkCommit(over, { role: "admin", userId: "u1", reason: " Board approved a supplement " })).toMatchObject({ ok: true, override: { by: "u1", reason: "Board approved a supplement", overByMinor: 10 } });
  });
});
