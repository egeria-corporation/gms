// SPDX-License-Identifier: AGPL-3.0-only
// What the three imported history targets share: a funder's past applications, the reviews of
// them and the reports on its past grants, from the system it used before. History is read-only:
// it is never reviewed, decided or paid in the GMS and never feeds a live competition (the API
// keeps it in tables of its own, migration 0046). These helpers only read and clean text.
import { SENSITIVE_NUMBER_MASK, stripSensitiveNumbers } from "../sensitive.ts";
import { cleanLine, cleanText, fold } from "../values.ts";

export const PAST_TARGET_KEYS = ["history_applications", "history_reviews", "history_reports"] as const;
export type PastTargetKey = (typeof PAST_TARGET_KEYS)[number];
export const isPastTarget = (v: unknown): v is PastTargetKey => typeof v === "string" && (PAST_TARGET_KEYS as readonly string[]).includes(v);

/** What an email address in imported free text reads as. */
export const EMAIL_MASK = "[email removed]";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Free text from an export as it is kept: cleaned, bank and identity numbers removed
 * (../sensitive.ts), and email addresses removed, so no contact detail is kept in an answer, a
 * comment or a reviewer's name. Cut to `max` characters.
 */
export function historyText(raw: string, max: number, opts: { line?: boolean } = {}): string {
  const clean = opts.line ? cleanLine(raw) : cleanText(raw);
  const out = stripSensitiveNumbers(clean.replace(EMAIL, EMAIL_MASK)).text;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Whether a cleaned value is nothing but removed details (an email or a number). */
export const onlyRemoved = (v: string): boolean => !v.replaceAll(EMAIL_MASK, "").replaceAll(SENSITIVE_NUMBER_MASK, "").replace(/[\s,;:()<>[\]/|-]+/g, "");

/**
 * Columns never kept as a question and answer, read on the folded header: a person's contact
 * details and name (the submitter's email, phone, address), and the system's own bookkeeping
 * (payments and payees, who the record was assigned to, labels, votes, when it was last changed),
 * none of which is an answer. One constant to relax.
 */
export const QA_LEFT_OUT =
  /\be ?mail\b|\bphone\b|\btelephone\b|\btel\b|\bmobile\b|\bcell\b|\bfax\b|\baddress\b|\bstreet\b|\bzip\b|\bpostal\b|\bpostcode\b|\bcontact\b|\bfirst name\b|\blast name\b|\bfull name\b|\bsurname\b|\bsubmitter\b|\bpayee\b|\bpayments?\b|\bpaid\b|\bowner\b|\bassigned\b|\blabels?\b|\btags?\b|\bvotes?\b|\baverage (?:rating|score)\b|\blast activity\b|^(?:date )?(?:created|updated|modified)(?: (?:at|on|date))?$|^last (?:updated|modified)$/;
export const isLeftOutOfAnswers = (header: string): boolean => QA_LEFT_OUT.test(fold(header));

/** At most this many questions and answers per application; each answer at most this long. */
export const MAX_ANSWERS = 150;
export const MAX_ANSWER_LENGTH = 4000;
/** All of one application's answers together, in characters. */
export const MAX_ANSWERS_TOTAL = 40_000;
/** A question (a column's header) at most this long. */
export const MAX_QUESTION_LENGTH = 300;

/** A number as an export writes a score: `85`, `4.5`, `4/5`, `4 out of 5`. Blank, `n/a` and `-` are no score. */
export function readScore(raw: string | undefined): { score: number; outOf: number | null } | null | undefined {
  const v = raw?.trim();
  if (!v || /^(n\/?a|none|-+|—)$/i.test(v)) return undefined;
  const m = /^(-?\d{1,7}(?:[.,]\d{1,4})?)\s*(?:(?:\/|out of|of)\s*(\d{1,7}(?:[.,]\d{1,4})?))?\s*%?$/i.exec(v);
  if (!m) return null;
  const n = (s: string) => Number(s.replace(",", "."));
  const score = n(m[1]!);
  const outOf = m[2] ? n(m[2]) : null;
  if (!Number.isFinite(score) || Math.abs(score) > 1_000_000 || (outOf !== null && (!Number.isFinite(outOf) || outOf <= 0))) return null;
  return { score, outOf };
}

/** Folded words of a column that holds a reviewer's score for one criterion. */
const SCORE_HEADER = /\bscore\b|\bscores\b|\bscoring\b|\brating\b|\brated\b|\bcriterion\b|\bcriteria\b|\bpoints\b|\bmark\b|\bmarks\b/;
export const isScoreHeader = (header: string): boolean => SCORE_HEADER.test(fold(header));

/** The words an export uses for an application's outcome, folded, and what each means. */
export type PastOutcome = "awarded" | "declined" | "withdrawn" | "undecided" | "unknown";
const OUTCOME_WORDS: readonly [PastOutcome, RegExp][] = [
  ["withdrawn", /\bwithdr[ae]wn?\b|\bcancell?ed\b|\babandoned\b/],
  ["declined", /\bdeclined?\b|\brejected?\b|\bnot (?:funded|awarded|selected|approved|recommended)\b|\bunsuccessful\b|\bdenied\b|\bineligible\b|\bdisqualified\b|\bturned down\b/],
  ["undecided", /\bpending\b|\bin (?:review|progress)\b|\bunder review\b|\bundecided\b|\bsubmitted\b|\bnew\b|\bdraft\b|\bincomplete\b|\bwait ?list(?:ed)?\b|\bon hold\b|\bdeferred\b|\bopen\b/],
  ["awarded", /\bawarded\b|\bapproved\b|\bfunded\b|\bgranted\b|\baccepted\b|\bpaid\b|\bclosed\b|\bcompleted?\b|\bactive\b|\bawards?\b|\byes\b/],
];
export function readOutcome(raw: string | undefined): PastOutcome {
  const f = fold(raw ?? "");
  if (!f) return "unknown";
  return OUTCOME_WORDS.find(([, re]) => re.test(f))?.[0] ?? "unknown";
}

/** Where a past report stood, from the export's status words. */
export type PastReportState = "approved" | "submitted" | "late" | "not_submitted" | "unknown";
const REPORT_WORDS: readonly [PastReportState, RegExp][] = [
  ["not_submitted", /\bnot (?:submitted|received|started|completed)\b|\bmissing\b|\boutstanding\b|\bincomplete\b|\bdraft\b|\bin progress\b|\bscheduled\b|\bupcoming\b|\bnot yet\b/],
  ["late", /\blate\b|\boverdue\b|\bpast due\b/],
  ["approved", /\bapproved\b|\baccepted\b|\breviewed\b/],
  ["submitted", /\bsubmitted\b|\breceived\b|\bcompleted?\b|\bturned in\b|\bdone\b|\bfinished\b/],
  ["not_submitted", /\bdue\b|\bpending\b|\bopen\b|\bassigned\b|\bavailable\b|\breturned\b/],
];
export function readReportState(raw: string | undefined, submitted: boolean): PastReportState {
  const f = fold(raw ?? "");
  const hit = f ? REPORT_WORDS.find(([, re]) => re.test(f))?.[0] : undefined;
  return hit ?? (submitted ? "submitted" : "unknown");
}

/** A label from the export (a status word, a recommendation) kept as it was written, on one line. */
export const label = (raw: string | undefined, max = 100): string | null => (raw ? historyText(raw, max, { line: true }) || null : null);

/** An id from the export, trimmed; used only to link records and never shown. */
export const exportId = (raw: string | undefined): string | null => {
  const v = raw ? cleanLine(raw).slice(0, 200) : "";
  return v || null;
};
