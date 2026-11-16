// SPDX-License-Identifier: AGPL-3.0-only
// Target: a funder's grant history. One row is one past award to a named organization, with what
// was paid on it. A payment is recorded as paid elsewhere (a resolve-mode record, like "Record a
// payment made elsewhere"): it is never a disbursed amount, never goes through Passport and never
// moves money. The API writes these rows with the same award shape as the v1 CSV award import
// (apps/api/src/services/analytics.ts).
import type { FieldSpec, ImportTarget, MoneyLine, Problem, RowCheck } from "../target.ts";
import { cleanLine, cleanText, readAmount, readCurrency, readDate, readYear } from "../values.ts";

export const HISTORY_FIELDS = ["recipientName", "recipientEin", "title", "description", "awardedAmount", "currency", "awardDate", "year", "startDate", "endDate", "status", "programName", "paidAmount", "paidDate", "paymentReference", "sourceId"] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];

export interface HistoryRecord {
  recipientName: string;
  /** Nine digits, when given: used only to recognise an organization already connected to the funder. */
  recipientEin: string | null;
  title: string;
  description: string | null;
  currency: string;
  awardedAmountMinor: number;
  awardDate: string | null;
  /** The year the award counts in: the year column, else the award date, else the start date. */
  year: number | null;
  startDate: string | null;
  endDate: string | null;
  status: "active" | "completed";
  programName: string | null;
  /** What the funder paid on it, outside the GMS. */
  payment: { amountMinor: number; paidOn: string; reference: string } | null;
}

const SPECS: FieldSpec<HistoryField>[] = [
  { key: "recipientName", label: "Organization", kind: "text", required: true, synonyms: ["organization", "organisation", "recipient", "grantee", "org", "nonprofit", "organization name", "recipient name", "grantee name", "payee"] },
  { key: "recipientEin", label: "EIN", kind: "text", synonyms: ["ein", "fein", "employer identification number"] },
  { key: "title", label: "Grant title", kind: "text", required: true, synonyms: ["title", "grant", "grant title", "project", "purpose", "award title", "grant name", "project name"] },
  { key: "paidAmount", label: "Amount paid", kind: "money", synonyms: ["paid", "amount paid", "paid amount", "payments", "total paid", "paid to date"] },
  { key: "paidDate", label: "Date paid", kind: "date", synonyms: ["date paid", "paid date", "payment date", "paid on"] },
  { key: "paymentReference", label: "Payment reference", kind: "text", synonyms: ["payment reference", "check", "cheque", "check no", "transaction", "payment ref"] },
  { key: "awardedAmount", label: "Amount awarded", kind: "money", required: true, synonyms: ["amount", "awarded", "amount awarded", "award amount", "grant amount", "award", "total"] },
  { key: "currency", label: "Currency", kind: "currency", synonyms: ["currency"] },
  { key: "awardDate", label: "Award date", kind: "date", synonyms: ["award date", "date awarded", "approved", "approval date", "board date", "date"] },
  { key: "year", label: "Year", kind: "year", synonyms: ["year", "fiscal year", "fy", "grant year", "award year"] },
  { key: "startDate", label: "Grant starts", kind: "date", synonyms: ["start", "start date", "grant start", "period start"] },
  { key: "endDate", label: "Grant ends", kind: "date", synonyms: ["end", "end date", "grant end", "period end"] },
  { key: "status", label: "Status", kind: "choice", synonyms: ["status", "state", "grant status"] },
  { key: "programName", label: "Program", kind: "text", synonyms: ["program", "programme", "fund", "portfolio", "initiative", "focus area"], help: "Optional. Matched by name to one of your programs; a name that matches none is left out." },
  { key: "description", label: "Description", kind: "longtext", synonyms: ["description", "summary", "notes", "details"] },
  { key: "sourceId", label: "Row ID", kind: "id", synonyms: ["id", "grant id", "award id", "grant number", "record id", "row id"], help: "Optional. A column that names each grant once, so a row you change and import again is recognised." },
];
const LABEL = Object.fromEntries(SPECS.map((s) => [s.key, s.label])) as Record<HistoryField, string>;

const CLOSED = /closed|complete|ended|finished|expired|paid in full/i;

export function checkHistoryRow(v: Partial<Record<HistoryField, string>>): RowCheck<HistoryField, HistoryRecord> {
  const problems: Problem<HistoryField>[] = [];
  const problem = (field: HistoryField, message: string) => void problems.push({ field, message });
  const currency = readCurrency(v.currency) ?? "USD";
  if (readCurrency(v.currency) === null) problem("currency", "The currency is not a three-letter code");
  const recipientName = v.recipientName ? cleanLine(v.recipientName).slice(0, 200) : "";
  const title = v.title ? cleanLine(v.title).slice(0, 300) : "";
  if (!recipientName) problem("recipientName", "No organization");
  if (!title) problem("title", "No grant title");
  const awarded = readAmount(v.awardedAmount, currency);
  if (awarded === undefined) problem("awardedAmount", "No amount awarded");
  else if (awarded === null || awarded <= 0) problem("awardedAmount", "The amount awarded is not a positive amount");
  const ein = v.recipientEin ? v.recipientEin.replace(/[\s-]/g, "") : "";
  if (ein && !/^\d{9}$/.test(ein)) problem("recipientEin", "The EIN is not nine digits");
  const dates = { awardDate: readDate(v.awardDate), startDate: readDate(v.startDate), endDate: readDate(v.endDate), paidDate: readDate(v.paidDate) };
  for (const [k, d] of Object.entries(dates)) if (d === null) problem(k as HistoryField, `${LABEL[k as HistoryField]} is not a date (use YYYY-MM-DD)`);
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) problem("endDate", "The grant ends before it starts");
  const yearCell = readYear(v.year);
  if (yearCell === null) problem("year", "The year is not a four-digit year");
  const year = yearCell ?? (dates.awardDate ? +dates.awardDate.slice(0, 4) : dates.startDate ? +dates.startDate.slice(0, 4) : null);
  const paid = readAmount(v.paidAmount, currency);
  if (paid === null) problem("paidAmount", "The amount paid is not an amount");
  let payment: HistoryRecord["payment"] = null;
  if (typeof paid === "number" && paid > 0) {
    // No payment date: the award date stands in, as the closest date the file gives.
    const paidOn = dates.paidDate ?? dates.awardDate ?? null;
    if (!paidOn) problem("paidDate", "A payment needs the date it was paid (or an award date)");
    if (typeof awarded === "number" && awarded > 0 && paid > awarded) problem("paidAmount", "The amount paid is more than the amount awarded");
    const reference = v.paymentReference ? cleanLine(v.paymentReference).slice(0, 200) : "";
    if (paidOn) payment = { amountMinor: paid, paidOn, reference: reference || "Imported grant history" };
  } else if (paid === undefined && dates.paidDate) problem("paidAmount", "A payment date needs the amount paid");
  const money: MoneyLine[] = [];
  if (typeof awarded === "number" && awarded > 0) money.push({ kind: "awarded", amountMinor: awarded, currency, year });
  if (payment) money.push({ kind: "paid", amountMinor: payment.amountMinor, currency, year: +payment.paidOn.slice(0, 4) });
  const record: HistoryRecord | null = problems.length
    ? null
    : {
        recipientName,
        recipientEin: ein || null,
        title,
        description: v.description ? cleanText(v.description).slice(0, 5000) || null : null,
        currency,
        awardedAmountMinor: awarded as number,
        awardDate: dates.awardDate ?? null,
        year,
        startDate: dates.startDate ?? null,
        endDate: dates.endDate ?? null,
        status: CLOSED.test(v.status ?? "") ? "completed" : "active",
        programName: v.programName ? cleanLine(v.programName).slice(0, 300) || null : null,
        payment,
      };
  return { problems, record, money, title: title || "(no title)", subtitle: recipientName || null };
}

export const HISTORY_TARGET: ImportTarget<HistoryField, HistoryRecord> = {
  key: "award_history",
  noun: { one: "award", many: "awards" },
  fields: SPECS,
  check: checkHistoryRow,
};
