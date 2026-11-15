// SPDX-License-Identifier: AGPL-3.0-only
// Target: an applicant's outside applications (apply anywhere, v1.5.0). One row is one application
// to any funder, kept as the applicant's own record. The rules are the ones the v1.5.0 CSV import
// applied (apps/api/src/services/outside.ts uses this validator too), so a row reads the same
// through either path.
import { OUTSIDE_STAGES, type OutsideStage, type SUBMISSION_METHODS } from "@gms/workflow";
import type { FieldSpec, ImportTarget, MoneyLine, Problem, RowCheck } from "../target.ts";
import { cleanLine, cleanText, readAmount, readCurrency, readDate, readUrl, readYesNo } from "../values.ts";

export const OUTSIDE_FIELDS = ["title", "funderName", "programName", "stage", "loiDue", "fullDue", "internalDue", "rolling", "askAmount", "currency", "listingUrl", "portalUrl", "submittedAt", "submissionMethod", "confirmationRef", "awardedAmount", "grantStart", "grantEnd", "notes", "sourceId"] as const;
export type OutsideField = (typeof OUTSIDE_FIELDS)[number];

/** One outside application, ready to be written (amounts in minor units, dates YYYY-MM-DD). */
export interface OutsideRecord {
  title: string;
  funderName: string;
  programName: string | null;
  stage: OutsideStage;
  currency: string;
  askAmountMinor: number | null;
  loiDue: string | null;
  fullDue: string | null;
  internalDue: string | null;
  rolling: boolean;
  listingUrl: string | null;
  portalUrl: string | null;
  /** Kept only for a stage that has been submitted. */
  submittedOn: string | null;
  submissionMethod: (typeof SUBMISSION_METHODS)[number] | null;
  confirmationRef: string | null;
  /** Kept only for an awarded application, with the grant period. */
  awardedAmountMinor: number | null;
  grantStart: string | null;
  grantEnd: string | null;
  /** Awarded or declined: the decision is recorded as made. */
  decided: boolean;
  notes: string | null;
}

const STAGE_LABEL: Record<OutsideStage, string> = { prospect: "Prospect", deciding: "Deciding", loi: "Letter of inquiry", invited: "Invited to apply", drafting: "Drafting", submitted: "Submitted", awarded: "Awarded", declined: "Declined", withdrawn: "Withdrawn", not_pursuing: "Not pursuing" };
const STAGE_WORDS: Record<string, OutsideStage> = Object.fromEntries([
  ...OUTSIDE_STAGES.map((s) => [s, s]),
  ...Object.entries(STAGE_LABEL).map(([k, v]) => [v.toLowerCase(), k]),
  ["letter of intent", "loi"],
  ["invited", "invited"],
  ["not pursued", "not_pursuing"],
  ["pending", "submitted"],
  ["funded", "awarded"],
  ["rejected", "declined"],
  ["in progress", "drafting"],
  ["draft", "drafting"],
]) as Record<string, OutsideStage>;
const METHOD_WORDS: Record<string, OutsideRecord["submissionMethod"]> = { portal: "portal", online: "portal", "online portal": "portal", email: "email", "e-mail": "email", mail: "mail", post: "mail", "grants.gov": "grants_gov", grants_gov: "grants_gov", other: "other" };

/** The stage a cell names (`Awarded`, `not_pursuing`, `Letter of intent`…), or undefined. */
export const stageFromWord = (v: string): OutsideStage | undefined => STAGE_WORDS[v.trim().toLowerCase().replace(/_/g, " ")] ?? STAGE_WORDS[v.trim().toLowerCase()];

const SPECS: FieldSpec<OutsideField>[] = [
  { key: "title", label: "Title", kind: "text", required: true, synonyms: ["title", "application", "project", "grant", "name", "grant name", "project name", "opportunity"] },
  { key: "funderName", label: "Funder", kind: "text", required: true, synonyms: ["funder", "foundation", "grantor", "funder name", "funding source", "agency"] },
  { key: "internalDue", label: "Internal deadline", kind: "date", synonyms: ["internal", "internal deadline", "internal due"] },
  { key: "loiDue", label: "Letter of inquiry due", kind: "date", synonyms: ["loi", "loi due", "loi deadline", "inquiry", "letter of inquiry", "letter of intent", "intent"] },
  { key: "portalUrl", label: "Portal link", kind: "url", synonyms: ["portal", "portal link", "portal url", "application portal"] },
  { key: "listingUrl", label: "Listing link", kind: "url", synonyms: ["listing", "url", "link", "website", "listing url", "rfp"] },
  { key: "programName", label: "Program", kind: "text", synonyms: ["program", "programme", "funding program", "fund"] },
  { key: "stage", label: "Stage", kind: "choice", synonyms: ["stage", "status", "pipeline"] },
  { key: "submittedAt", label: "Date submitted", kind: "date", synonyms: ["submitted", "date submitted", "submitted on", "submission date"] },
  { key: "submissionMethod", label: "How it was submitted", kind: "choice", synonyms: ["how", "method", "submission method", "submitted via"] },
  { key: "confirmationRef", label: "Confirmation number", kind: "text", synonyms: ["confirmation", "confirmation number", "reference", "tracking number"] },
  { key: "awardedAmount", label: "Amount awarded", kind: "money", synonyms: ["awarded", "amount awarded", "award", "award amount", "funded amount"] },
  { key: "askAmount", label: "Ask", kind: "money", synonyms: ["ask", "amount", "request", "requested", "amount requested", "ask amount"] },
  { key: "currency", label: "Currency", kind: "currency", synonyms: ["currency"] },
  { key: "fullDue", label: "Full application due", kind: "date", synonyms: ["full", "deadline", "due", "due date", "full due", "application due"] },
  { key: "rolling", label: "Rolling deadline", kind: "yesno", synonyms: ["rolling", "rolling deadline"] },
  { key: "grantStart", label: "Grant starts", kind: "date", synonyms: ["grant start", "start", "start date", "period start"] },
  { key: "grantEnd", label: "Grant ends", kind: "date", synonyms: ["grant end", "end", "end date", "period end"] },
  { key: "notes", label: "Notes", kind: "longtext", synonyms: ["notes", "note", "comments", "decision notes"] },
  { key: "sourceId", label: "Row ID", kind: "id", synonyms: ["id", "row id", "record id"], help: "Optional. A column that names each row once, so a row you change and import again is recognised." },
];
const LABEL = Object.fromEntries(SPECS.map((s) => [s.key, s.label])) as Record<OutsideField, string>;

const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) : null);

export function checkOutsideRow(v: Partial<Record<OutsideField, string>>): RowCheck<OutsideField, OutsideRecord> {
  const problems: Problem<OutsideField>[] = [];
  const problem = (field: OutsideField, message: string) => void problems.push({ field, message });
  const currency = readCurrency(v.currency) ?? "USD";
  if (readCurrency(v.currency) === null) problem("currency", "The currency is not a three-letter code");
  const title = v.title ? cleanLine(v.title).slice(0, 300) : "";
  const funderName = v.funderName ? cleanLine(v.funderName).slice(0, 200) : "";
  if (!title) problem("title", "No title");
  if (!funderName) problem("funderName", "No funder");
  const stage = v.stage ? stageFromWord(v.stage) : "drafting";
  if (!stage) problem("stage", `"${cleanLine(v.stage!).slice(0, 60)}" is not a stage`);
  const dates = { loiDue: readDate(v.loiDue), fullDue: readDate(v.fullDue), internalDue: readDate(v.internalDue), submittedAt: readDate(v.submittedAt), grantStart: readDate(v.grantStart), grantEnd: readDate(v.grantEnd) };
  for (const [k, d] of Object.entries(dates)) if (d === null) problem(k as OutsideField, `${LABEL[k as OutsideField]} is not a date (use YYYY-MM-DD)`);
  const ask = readAmount(v.askAmount, currency);
  const awarded = readAmount(v.awardedAmount, currency);
  if (ask === null) problem("askAmount", "The ask is not an amount");
  if (awarded === null) problem("awardedAmount", "The awarded amount is not an amount");
  const method = v.submissionMethod ? METHOD_WORDS[v.submissionMethod.trim().toLowerCase()] : undefined;
  if (v.submissionMethod && !method) problem("submissionMethod", `"${cleanLine(v.submissionMethod).slice(0, 60)}" is not a way of submitting (portal, email, mail, grants.gov, other)`);
  if ((stage === "submitted" || stage === "awarded") && (!dates.submittedAt || !method)) problem("submittedAt", "A submitted application needs the date submitted and how it was sent");
  if (stage === "awarded" && (awarded === undefined || awarded === null)) problem("awardedAmount", "An awarded application needs the amount awarded");
  if (stage === "awarded" && dates.grantStart && dates.grantEnd && dates.grantEnd < dates.grantStart) problem("grantEnd", "The grant ends before it starts");
  const urls: Partial<Record<"listingUrl" | "portalUrl", string>> = {};
  for (const k of ["listingUrl", "portalUrl"] as const) {
    const u = readUrl(v[k]);
    if (u === null) problem(k, `${LABEL[k]} is not a web address`);
    else if (u) urls[k] = u;
  }
  const rolling = readYesNo(v.rolling) === true;
  const pastSubmit = stage === "submitted" || stage === "awarded" || ((stage === "declined" || stage === "withdrawn") && !!dates.submittedAt);
  const won = stage === "awarded";
  const money: MoneyLine[] = [];
  if (typeof ask === "number") money.push({ kind: "ask", amountMinor: ask, currency, year: yearOf(dates.fullDue ?? dates.loiDue ?? dates.submittedAt) });
  if (won && typeof awarded === "number") money.push({ kind: "awarded", amountMinor: awarded, currency, year: yearOf(dates.grantStart ?? dates.submittedAt ?? dates.fullDue) });
  const record: OutsideRecord | null = problems.length
    ? null
    : {
        title,
        funderName,
        programName: v.programName ? cleanLine(v.programName).slice(0, 300) || null : null,
        stage: stage!,
        currency,
        askAmountMinor: typeof ask === "number" ? ask : null,
        loiDue: dates.loiDue ?? null,
        fullDue: dates.fullDue ?? null,
        internalDue: dates.internalDue ?? null,
        rolling,
        listingUrl: urls.listingUrl ?? null,
        portalUrl: urls.portalUrl ?? null,
        submittedOn: pastSubmit ? (dates.submittedAt ?? null) : null,
        submissionMethod: pastSubmit ? (method ?? null) : null,
        confirmationRef: v.confirmationRef ? cleanLine(v.confirmationRef).slice(0, 200) || null : null,
        awardedAmountMinor: won && typeof awarded === "number" ? awarded : null,
        grantStart: won ? (dates.grantStart ?? null) : null,
        grantEnd: won ? (dates.grantEnd ?? null) : null,
        decided: stage === "awarded" || stage === "declined",
        notes: v.notes ? cleanText(v.notes).slice(0, 5000) || null : null,
      };
  return { problems, record, money, title: title || "(no title)", subtitle: funderName || null };
}

export const OUTSIDE_TARGET: ImportTarget<OutsideField, OutsideRecord> = {
  key: "outside_applications",
  noun: { one: "application", many: "applications" },
  fields: SPECS,
  check: checkOutsideRow,
};
