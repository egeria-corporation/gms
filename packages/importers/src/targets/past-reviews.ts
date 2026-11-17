// SPDX-License-Identifier: AGPL-3.0-only
// Target: the reviews of a funder's past applications. One row is one review: the application it
// belongs to (the export's own id for it, else its title), the reviewer's name as text, the score
// for each criterion, the total, the recommendation and the comment. A reviewer's contact details
// are never kept: no field takes one, an email address in the name or the comment is removed, and
// a column that is not a score is not read. The criterion scores are the kept columns no field is
// mapped to whose header says score, rating, criterion or points (./past-common.ts). Imported
// reviews are history: they never count toward a live review or decision.
import type { FieldSpec, ImportTarget, Problem, RestCell, RowCheck } from "../target.ts";
import { cleanLine, readDate } from "../values.ts";
import { SENSITIVE_NUMBER_MASK } from "../sensitive.ts";
import { EMAIL_MASK, exportId, historyText, isScoreHeader, label, onlyRemoved, readScore } from "./past-common.ts";

export const PAST_REVIEW_FIELDS = ["applicationRef", "applicationTitle", "organizationName", "reviewerName", "totalScore", "recommendation", "comment", "reviewedDate", "sourceId"] as const;
export type PastReviewField = (typeof PAST_REVIEW_FIELDS)[number];

export interface CriterionScore {
  criterion: string;
  score: number;
  /** The most the criterion gives, when the export says (`4/5`). */
  outOf: number | null;
}

export interface PastReviewRecord {
  /** The export's own id for the application reviewed. Never stored as written. */
  applicationRef: string | null;
  applicationTitle: string | null;
  organizationName: string | null;
  /** The reviewer's name as text, never their contact details. */
  reviewerName: string | null;
  scores: CriterionScore[];
  totalScore: number | null;
  recommendation: string | null;
  comment: string | null;
  reviewedOn: string | null;
  /** The export's own id for the review, when it has one. */
  sourceId: string | null;
}

/** Criterion scores kept per review. */
export const MAX_CRITERIA = 50;

const SPECS: FieldSpec<PastReviewField>[] = [
  { key: "sourceId", label: "Review ID", kind: "id", synonyms: ["review id", "evaluation id", "score id", "review number"], help: "Optional. The id your old system gave each review, so a review you import again is recognised." },
  { key: "applicationRef", label: "Application ID", kind: "id", synonyms: ["application id", "submission id", "request id", "application number", "submission number", "request number", "application slug", "slug"], help: "The id of the application reviewed, as in the applications you imported. Without it, the application's exact title is used." },
  { key: "applicationTitle", label: "Application title", kind: "text", synonyms: ["application title", "submission title", "project title", "application name", "proposal title", "title", "application", "submission"] },
  { key: "organizationName", label: "Organization", kind: "text", synonyms: ["organization", "organisation", "organization name", "organisation name", "applicant organization", "company"] },
  { key: "reviewerName", label: "Reviewer", kind: "text", synonyms: ["reviewer", "reviewer name", "reviewed by", "judge", "judge name", "evaluator", "panelist", "scorer"], help: "Optional. The reviewer's name only; their email or phone is never kept." },
  { key: "totalScore", label: "Total score", kind: "text", synonyms: ["total score", "total", "overall score", "score", "final score", "overall rating", "rating"] },
  { key: "recommendation", label: "Recommendation", kind: "choice", synonyms: ["recommendation", "recommend", "recommended", "vote", "verdict", "decision recommendation"] },
  { key: "comment", label: "Comment", kind: "longtext", synonyms: ["comment", "comments", "review comments", "reviewer comments", "feedback", "notes", "summary"] },
  { key: "reviewedDate", label: "Reviewed on", kind: "date", synonyms: ["reviewed on", "date reviewed", "review date", "reviewed", "completed on", "date completed", "review submitted"] },
];

/** A reviewer's name with any contact detail taken out, or null when nothing else is left. */
export function reviewerNameOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = historyText(raw, 120, { line: true });
  if (!v || onlyRemoved(v)) return null;
  // "Lee Moss <lee@…>" keeps the name only.
  const name = v.replaceAll(EMAIL_MASK, "").replaceAll(SENSITIVE_NUMBER_MASK, "").replace(/[<([]\s*[>)\]]/g, "").replace(/\s+/g, " ").replace(/^[\s,;:|-]+|[\s,;:|-]+$/g, "");
  return name || null;
}

export function checkPastReviewRow(v: Partial<Record<PastReviewField, string>>, rest: readonly RestCell[] = []): RowCheck<PastReviewField, PastReviewRecord> {
  const problems: Problem<PastReviewField>[] = [];
  const problem = (field: PastReviewField, message: string) => void problems.push({ field, message });
  const applicationRef = exportId(v.applicationRef);
  const applicationTitle = label(v.applicationTitle, 300);
  if (!applicationRef && !applicationTitle) problem("applicationTitle", "Name the application reviewed: its ID or its title");
  const total = readScore(v.totalScore);
  if (total === null) problem("totalScore", "The total score is not a number");
  const scores: { criterion: string; score: number; outOf: number | null }[] = [];
  for (const cell of rest) {
    if (!isScoreHeader(cell.column)) continue;
    const s = readScore(cell.value);
    if (s === undefined) continue;
    if (s === null) {
      problems.push({ message: `${cleanLine(cell.column).slice(0, 80)} is not a number` });
      continue;
    }
    if (scores.length < MAX_CRITERIA) scores.push({ criterion: cleanLine(cell.column).slice(0, 200), score: s.score, outOf: s.outOf });
  }
  const recommendation = label(v.recommendation, 200);
  const comment = v.comment ? historyText(v.comment, 5000) || null : null;
  if (!total && !scores.length && !recommendation && !comment) problem("totalScore", "The review has no score, recommendation or comment");
  const reviewedOn = readDate(v.reviewedDate);
  if (reviewedOn === null) problem("reviewedDate", "Reviewed on is not a date (use YYYY-MM-DD)");
  const reviewerName = reviewerNameOf(v.reviewerName);
  const record: PastReviewRecord | null = problems.length
    ? null
    : {
        applicationRef,
        applicationTitle,
        organizationName: label(v.organizationName, 200),
        reviewerName,
        scores,
        totalScore: total ? total.score : null,
        recommendation,
        comment,
        reviewedOn: reviewedOn ?? null,
        sourceId: exportId(v.sourceId),
      };
  return { problems, record, money: [], title: applicationTitle ?? applicationRef ?? "(no title)", subtitle: reviewerName };
}

export const PAST_REVIEWS_TARGET: ImportTarget<PastReviewField, PastReviewRecord> = {
  key: "history_reviews",
  noun: { one: "past review", many: "past reviews" },
  fields: SPECS,
  readsRest: true,
  check: checkPastReviewRow,
};
