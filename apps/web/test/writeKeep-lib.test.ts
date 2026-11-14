// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Write faster, win and keep it: the rules the screens apply before the API answers. Library
// freshness and variants, the vault's filename refusal and expiry, required documents and
// milestones, go/no-go totals, obligation series, fiscal years, draft placeholders, who approves,
// and the consulting answers cut exactly where the email (packages/notify) cuts them.
import { describe, expect, it } from "vitest";
import { consultingAnswersText } from "../../../packages/notify/src/outside.ts";
import { countText } from "../src/lib/outside.ts";
import {
  answersAsSent,
  bestVariant,
  blockedFilename,
  canApprove,
  CONSULTING_ANSWERS_MAX,
  DEFAULT_WEIGHTS,
  docTypeForLabel,
  expiryState,
  fiscalYearLabel,
  fiscalYearOf,
  goNoGoTotal,
  isStale,
  mergeRequired,
  milestonesFor,
  seriesDates,
  splitUnknowns,
  variantChoices,
} from "../src/lib/writeKeep.ts";
import { offersApply } from "../src/screens/funder/applicationsStatus.tsx";
import { takingApplications } from "../src/screens/public/OpportunityPage.tsx";

const NOW = new Date("2026-11-14T12:00:00Z");

describe("library freshness and variants", () => {
  it("flags an answer not verified in 12 months, or never", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale("2025-11-13T00:00:00Z", NOW)).toBe(true);
    expect(isStale("2025-11-15", NOW)).toBe(false);
    expect(isStale("2026-10-01T00:00:00Z", NOW)).toBe(false);
  });

  it("offers the longest version within the limit, the shortest when none fits, the full answer without a limit", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const answer = { body: words(400), variants: { short: words(45), medium: words(140), long: null } };
    const choices = variantChoices(answer);
    expect(choices.map((c) => c.key)).toEqual(["short", "medium", "full"]);
    expect(bestVariant(choices, "words", 250)?.key).toBe("medium");
    expect(bestVariant(choices, "words", 500)?.key).toBe("full");
    expect(bestVariant(choices, "words", 20)?.key).toBe("short");
    expect(bestVariant(choices, null, null)?.key).toBe("full");
    // A character limit counts characters, not words.
    expect(bestVariant(choices, "chars", countText(words(45)).chars)?.key).toBe("short");
  });
});

describe("the vault", () => {
  it("refuses file names that look like bank or tax paperwork, and only those", () => {
    for (const name of ["Bank letter.pdf", "bank_statement_2026.pdf", "ACH form.pdf", "ach-authorization.docx", "Voided check.jpg", "void.png", "routing slip.pdf", "W-9 2026.pdf", "w9.pdf"]) expect(blockedFilename(name), name).toBe(true);
    for (const name of ["Riverbank Foundation report.pdf", "Coach handbook.pdf", "attach me.pdf", "Avoid delays.docx", "Audit FY2026.pdf", "Board list.pdf"]) expect(blockedFilename(name), name).toBe(false);
  });

  it("says when a document expires", () => {
    expect(expiryState(null, NOW)).toEqual({ state: "none", days: null });
    expect(expiryState("2026-11-04", NOW)).toEqual({ state: "expired", days: -10 });
    expect(expiryState("2026-11-14", NOW)).toEqual({ state: "soon", days: 0 });
    expect(expiryState("2026-12-14", NOW)).toEqual({ state: "soon", days: 30 });
    expect(expiryState("2026-12-15", NOW)).toEqual({ state: "current", days: 31 });
  });

  it("matches a funder's document label to a vault type", () => {
    expect(docTypeForLabel("IRS determination letter")).toBe("irs_letter");
    expect(docTypeForLabel("Proof of 501(c)(3) status")).toBe("irs_letter");
    expect(docTypeForLabel("Most recent audit")).toBe("audit");
    expect(docTypeForLabel("Financial statements")).toBe("financials");
    expect(docTypeForLabel("Board of directors list")).toBe("board_list");
    expect(docTypeForLabel("Project budget")).toBe("budget");
    expect(docTypeForLabel("Letters of support")).toBeNull();
  });
});

describe("the checklist", () => {
  it("adds required documents once, case-insensitively, as needed", () => {
    const current = [{ label: "IRS determination letter", documentId: "doc_1", status: "attached" as const }];
    expect(mergeRequired(current, ["irs determination letter", "Most recent audit", " Most recent audit ", ""])).toEqual([
      { label: "IRS determination letter", documentId: "doc_1", status: "attached" },
      { label: "Most recent audit", documentId: null, status: "needed" },
    ]);
  });

  it("works the milestones back from the full deadline", () => {
    expect(milestonesFor("2027-03-01").map((m) => [m.title, m.dueOn])).toEqual([
      ["First draft due", "2027-02-15"],
      ["Team review", "2027-02-22"],
      ["Final version ready", "2027-02-27"],
    ]);
  });
});

describe("go/no-go", () => {
  it("weights each 1-5 score and says when every line is scored", () => {
    // The weighted mean, out of 5, as the API records it: (5·3 + 4·2 + 3·2 + 2·1) / 8 = 3.875.
    expect(goNoGoTotal({ fit: 5, capacity: 4, effort: 3, relationship: 2 }, DEFAULT_WEIGHTS)).toEqual({ total: 3.88, max: 5, complete: true });
    expect(goNoGoTotal({ fit: 5 }, DEFAULT_WEIGHTS)).toEqual({ total: 5, max: 5, complete: false });
    expect(goNoGoTotal({ fit: 1, capacity: 5, effort: 5, relationship: 1 }, { fit: 0, capacity: 1, effort: 1, relationship: 0 })).toEqual({ total: 5, max: 5, complete: true });
  });
});

describe("obligation series", () => {
  it("starts on the first date, keeps the day (or the month's last), and stops at the end", () => {
    expect(seriesDates("2027-01-31", "2027-12-31", 3)).toEqual(["2027-01-31", "2027-04-30", "2027-07-31", "2027-10-31"]);
    expect(seriesDates("2027-01-15", "2027-07-15", 6)).toEqual(["2027-01-15", "2027-07-15"]);
    expect(seriesDates("2027-01-15", "2027-07-14", 6)).toEqual(["2027-01-15"]);
    expect(seriesDates("2027-01-15", "2026-01-01", 1)).toEqual([]);
    expect(seriesDates("2027-01-15", "2037-01-15", 0)).toEqual([]);
  });
  it("makes at most 60", () => {
    expect(seriesDates("2020-01-01", "2040-01-01", 1)).toHaveLength(60);
    expect(seriesDates("2020-01-01", "2040-01-01", 1, 61)).toHaveLength(61);
  });
});

describe("fiscal years", () => {
  it("names a fiscal year by the calendar year it ends in", () => {
    expect(fiscalYearOf("2026-06-30", 7)).toBe(2026);
    expect(fiscalYearOf("2026-07-01", 7)).toBe(2027);
    expect(fiscalYearOf("2026-12-31", 1)).toBe(2026);
    expect(fiscalYearLabel(2027, 7)).toBe("FY 2027 (Jul 2026 to Jun 2027)");
    expect(fiscalYearLabel(2026, 1)).toBe("FY 2026");
  });
});

describe("drafts and approval", () => {
  it("marks [placeholders] in a draft", () => {
    expect(splitUnknowns("We served [number] families in [county].")).toEqual([
      { text: "We served ", unknown: false },
      { text: "[number]", unknown: true },
      { text: " families in ", unknown: false },
      { text: "[county]", unknown: true },
      { text: ".", unknown: false },
    ]);
    expect(splitUnknowns("Nothing missing.")).toEqual([{ text: "Nothing missing.", unknown: false }]);
  });
  it("lets a workspace admin or the application's owner approve", () => {
    expect(canApprove("admin", "u1", "u2")).toBe(true);
    expect(canApprove("editor", "u1", "u1")).toBe(true);
    expect(canApprove("editor", "u1", "u2")).toBe(false);
    expect(canApprove("consultant", "u1", null)).toBe(false);
    expect(canApprove(null, null, null)).toBe(false);
  });
});

describe("the consulting answers, as the email carries them", () => {
  const joined = (items: ReturnType<typeof answersAsSent>["items"]) => items.map((a) => `${a.n}. ${a.prompt}\n${a.body}`).join("\n\n");

  it("are numbered with '(no answer yet)' and not cut under the limit", () => {
    const answers = [
      { prompt: "Need?", body: "Families travel far." },
      { prompt: "Plan?", body: "" },
    ];
    const sent = answersAsSent(answers);
    expect(sent).toMatchObject({ truncated: false, omitted: 0 });
    expect(joined(sent.items)).toBe(consultingAnswersText(answers.map((a) => ({ prompt: a.prompt, answer: a.body }))));
  });

  it("are cut at the same character as the email, marked, with the questions after it counted", () => {
    const answers = [
      { prompt: "Describe the need.", body: "a".repeat(12_000) },
      { prompt: "Describe the plan.", body: "b ".repeat(6_000) },
      { prompt: "Describe the team.", body: "c".repeat(3_000) },
    ];
    const sent = answersAsSent(answers);
    const email = consultingAnswersText(answers.map((a) => ({ prompt: a.prompt, answer: a.body })));
    expect(email).toHaveLength(CONSULTING_ANSWERS_MAX);
    expect(sent.truncated).toBe(true);
    expect(sent.omitted).toBe(1);
    expect(sent.items.map((a) => a.cut)).toEqual([false, true]);
    expect(joined(sent.items)).toBe(email);
  });

  it("cut inside a prompt when that is where the limit falls", () => {
    const answers = [
      { prompt: "First", body: "x".repeat(CONSULTING_ANSWERS_MAX - 30) },
      { prompt: "A second question that runs past the end", body: "y" },
    ];
    const sent = answersAsSent(answers);
    expect(sent.items[1]).toMatchObject({ cut: true, body: "" });
    expect(`${joined(sent.items.slice(0, 1))}\n\n2. ${sent.items[1]!.prompt}`).toBe(consultingAnswersText(answers.map((a) => ({ prompt: a.prompt, answer: a.body }))));
  });
});

describe("the builder's preview follows the public page", () => {
  const comps = (status: string) => [{ id: "c1", opportunityId: "o1", status, createdAt: "2027-01-01T00:00:00Z" }] as never[];
  it.each([
    ["open", true, "open", true],
    ["open", true, "draft", false],
    ["forecasted", true, "open", false],
    ["closed", true, "open", false],
    ["open", false, "open", false],
  ] as const)("opportunity %s (published %s) with a competition %s → Apply %s", (status, published, comp, apply) => {
    const o = { id: "o1", status, published };
    expect(offersApply(o as never, comps(comp))).toBe(apply);
    // The public page's own rule agrees for every published opportunity.
    if (published) expect(takingApplications({ opportunity: o, competitions: comps(comp) } as never)).toBe(apply);
  });
});
