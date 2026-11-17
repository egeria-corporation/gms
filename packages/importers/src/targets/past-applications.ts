// SPDX-License-Identifier: AGPL-3.0-only
// Target: a funder's past applications, from the system it used before. One row is one
// application: the organization, the program and call it went to, when it was submitted, what was
// decided, the amounts asked for and awarded, and its answers. The answers are every kept column
// no field is mapped to, stored as plain text questions and answers (a column's header is the
// question), except the submitter's contact details and name (./past-common.ts). Imported history
// is read-only: it is never reviewed, decided or paid here and never feeds a live competition.
// The API links each record to an award and an organization by the export's own id, then by exact
// name, and never by a guess (apps/api/src/services/history.ts).
import type { FieldSpec, ImportTarget, MoneyLine, Problem, RestCell, RowCheck } from "../target.ts";
import { cleanLine, readAmount, readCurrency, readDate } from "../values.ts";
import { exportId, historyText, isLeftOutOfAnswers, label, MAX_ANSWER_LENGTH, MAX_ANSWERS, MAX_ANSWERS_TOTAL, MAX_QUESTION_LENGTH, readOutcome, type PastOutcome } from "./past-common.ts";

export const PAST_APPLICATION_FIELDS = ["organizationName", "organizationEin", "title", "callTitle", "programName", "submittedDate", "outcome", "requestedAmount", "awardedAmount", "currency", "sourceId"] as const;
export type PastApplicationField = (typeof PAST_APPLICATION_FIELDS)[number];

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface PastApplicationRecord {
  organizationName: string;
  /** Nine digits, when given: used only to recognise an organization already connected to the funder. */
  organizationEin: string | null;
  title: string;
  /** The call, round or form it was submitted to, as the other system named it. */
  callTitle: string | null;
  /** Matched by exact name to one of the funder's programs; kept as text either way. */
  programName: string | null;
  submittedOn: string | null;
  outcome: PastOutcome;
  /** The outcome as the export wrote it. */
  outcomeLabel: string | null;
  currency: string;
  requestedAmountMinor: number | null;
  awardedAmountMinor: number | null;
  answers: QuestionAnswer[];
  /** The export's own id for the application: links it to its award and its reviews. Never stored as written. */
  sourceId: string | null;
}

const SPECS: FieldSpec<PastApplicationField>[] = [
  { key: "organizationName", label: "Organization", kind: "text", required: true, synonyms: ["organization", "organisation", "organization name", "organisation name", "applicant organization", "applicant organisation", "org", "org name", "company", "nonprofit", "grantee", "agency", "legal name"] },
  { key: "organizationEin", label: "EIN", kind: "text", synonyms: ["ein", "fein", "employer identification number"] },
  { key: "title", label: "Application title", kind: "text", required: true, synonyms: ["application title", "submission title", "project title", "proposal title", "request title", "application name", "project name", "title", "project", "name"] },
  { key: "callTitle", label: "Call or round", kind: "text", synonyms: ["call", "call title", "opportunity", "round", "cycle", "funding round", "grant cycle", "form", "form name", "process", "competition", "category", "proposal type"], help: "Optional. The call, round or form the application was sent to, as your old system named it." },
  { key: "programName", label: "Program", kind: "text", synonyms: ["program", "programme", "program name", "fund", "portfolio", "initiative", "focus area"], help: "Optional. Matched by name to one of your programs; kept as text either way." },
  { key: "submittedDate", label: "Submitted on", kind: "date", synonyms: ["submitted", "date submitted", "submitted date", "submission date", "submitted on", "date received", "received", "received date"] },
  { key: "outcome", label: "Outcome or decision", kind: "choice", synonyms: ["decision", "outcome", "status", "result", "application status", "submission status", "request status", "grant status", "moderation status"] },
  { key: "requestedAmount", label: "Amount requested", kind: "money", synonyms: ["amount requested", "requested amount", "requested", "request amount", "ask", "ask amount", "amount asked"] },
  { key: "awardedAmount", label: "Amount awarded", kind: "money", synonyms: ["amount awarded", "awarded amount", "awarded", "award amount", "grant amount", "approved amount", "amount approved", "amount granted", "funded amount"] },
  { key: "currency", label: "Currency", kind: "currency", synonyms: ["currency"] },
  { key: "sourceId", label: "Application ID", kind: "id", synonyms: ["application id", "submission id", "request id", "application number", "submission number", "request number", "application slug", "slug", "record id", "id"], help: "Optional. The id your old system gave each application. Its reviews and its award are matched to it by this id." },
];

/** The answers of one row: the rest of its kept columns, contact details and names left out. */
export function answersOf(rest: readonly RestCell[]): QuestionAnswer[] {
  const out: QuestionAnswer[] = [];
  let total = 0;
  for (const cell of rest) {
    if (out.length >= MAX_ANSWERS || total >= MAX_ANSWERS_TOTAL) break;
    if (isLeftOutOfAnswers(cell.column)) continue;
    const question = cleanLine(cell.column).slice(0, MAX_QUESTION_LENGTH);
    const answer = historyText(cell.value, Math.min(MAX_ANSWER_LENGTH, MAX_ANSWERS_TOTAL - total));
    if (!question || !answer) continue;
    out.push({ question, answer });
    total += answer.length;
  }
  return out;
}

export function checkPastApplicationRow(v: Partial<Record<PastApplicationField, string>>, rest: readonly RestCell[] = []): RowCheck<PastApplicationField, PastApplicationRecord> {
  const problems: Problem<PastApplicationField>[] = [];
  const problem = (field: PastApplicationField, message: string) => void problems.push({ field, message });
  const currency = readCurrency(v.currency) ?? "USD";
  if (readCurrency(v.currency) === null) problem("currency", "The currency is not a three-letter code");
  const organizationName = v.organizationName ? historyText(v.organizationName, 200, { line: true }) : "";
  const title = v.title ? historyText(v.title, 300, { line: true }) : "";
  if (!organizationName) problem("organizationName", "No organization");
  if (!title) problem("title", "No application title");
  const ein = v.organizationEin ? v.organizationEin.replace(/[\s-]/g, "") : "";
  if (ein && !/^\d{9}$/.test(ein)) problem("organizationEin", "The EIN is not nine digits");
  const submittedOn = readDate(v.submittedDate);
  if (submittedOn === null) problem("submittedDate", "Submitted on is not a date (use YYYY-MM-DD)");
  const requested = readAmount(v.requestedAmount, currency);
  if (requested === null) problem("requestedAmount", "The amount requested is not an amount");
  const awarded = readAmount(v.awardedAmount, currency);
  if (awarded === null) problem("awardedAmount", "The amount awarded is not an amount");
  const year = submittedOn ? +submittedOn.slice(0, 4) : null;
  const money: MoneyLine[] = [];
  if (typeof requested === "number" && requested > 0) money.push({ kind: "ask", amountMinor: requested, currency, year });
  if (typeof awarded === "number" && awarded > 0) money.push({ kind: "awarded", amountMinor: awarded, currency, year });
  const record: PastApplicationRecord | null = problems.length
    ? null
    : {
        organizationName,
        organizationEin: ein || null,
        title,
        callTitle: label(v.callTitle, 300),
        programName: label(v.programName, 300),
        submittedOn: submittedOn ?? null,
        outcome: readOutcome(v.outcome),
        outcomeLabel: label(v.outcome),
        currency,
        requestedAmountMinor: typeof requested === "number" ? requested : null,
        awardedAmountMinor: typeof awarded === "number" ? awarded : null,
        answers: answersOf(rest),
        sourceId: exportId(v.sourceId),
      };
  return { problems, record, money, title: title || "(no title)", subtitle: organizationName || null };
}

export const PAST_APPLICATIONS_TARGET: ImportTarget<PastApplicationField, PastApplicationRecord> = {
  key: "history_applications",
  noun: { one: "past application", many: "past applications" },
  fields: SPECS,
  readsRest: true,
  check: checkPastApplicationRow,
};
