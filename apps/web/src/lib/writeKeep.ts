// SPDX-License-Identifier: AGPL-3.0-only
// Write faster, and win and keep it: the vocabularies and the small rules the screens apply before
// the API answers. Library freshness and the variant that fits a limit, the document vault's types,
// expiry and filename refusals, the checklist's required documents, internal milestones, the
// go/no-go scorecard, obligation series, fiscal years and the consulting email's answer cut. The
// API stays the authority on every rule; this lets the screens draw and warn without a round trip.
import { countFor, countText, type LimitKind, type TextCounts } from "./outside.ts";

// ------------------------------------------------------------------------------------ library

/** A library answer last verified longer ago than this (or never) is flagged before its figures are reused. */
export const STALE_AFTER_MONTHS = 12;

export function isStale(lastVerifiedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastVerifiedAt) return true;
  const t = Date.parse(lastVerifiedAt.length === 10 ? `${lastVerifiedAt}T00:00:00Z` : lastVerifiedAt);
  if (Number.isNaN(t)) return true;
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() - STALE_AFTER_MONTHS);
  return t < limit.getTime();
}

export type VariantKey = "short" | "medium" | "long";
export const VARIANT_KEYS: readonly VariantKey[] = ["short", "medium", "long"];
/** About how long each variant is meant to be, in words. */
export const VARIANT_WORDS: Record<VariantKey, number> = { short: 50, medium: 150, long: 500 };
export const VARIANT_LABELS: Record<VariantKey | "full", string> = { short: "Short version", medium: "Medium version", long: "Long version", full: "Full answer" };
export type Variants = Partial<Record<VariantKey, string | null>>;

export interface VariantChoice {
  key: VariantKey | "full";
  label: string;
  text: string;
  counts: TextCounts;
}

/** The answer's own text and each variant it has, shortest first. */
export function variantChoices(answer: { body: string; variants?: Variants | null }): VariantChoice[] {
  const out: VariantChoice[] = [];
  for (const key of VARIANT_KEYS) {
    const text = answer.variants?.[key];
    if (text && text.trim()) out.push({ key, label: VARIANT_LABELS[key], text, counts: countText(text) });
  }
  out.push({ key: "full", label: VARIANT_LABELS.full, text: answer.body, counts: countText(answer.body) });
  return out.sort((a, b) => a.counts.chars - b.counts.chars);
}

/**
 * The version to offer for a question: with a limit, the longest one within it (the shortest when
 * none fits); without one, the full answer.
 */
export function bestVariant(choices: VariantChoice[], limitKind: LimitKind | null | undefined, limitValue: number | null | undefined): VariantChoice | null {
  if (!choices.length) return null;
  if (!limitKind || !limitValue) return choices.find((c) => c.key === "full") ?? choices[choices.length - 1]!;
  const fits = choices.filter((c) => countFor(c.counts, limitKind) <= limitValue);
  return fits.length ? fits[fits.length - 1]! : choices[0]!;
}

// ------------------------------------------------------------------------------------ vault

export const DOC_TYPES = ["irs_letter", "audit", "financials", "board_list", "budget", "annual_report", "logo", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  irs_letter: "IRS determination letter",
  audit: "Audit",
  financials: "Financial statements",
  board_list: "Board list",
  budget: "Budget",
  annual_report: "Annual report",
  logo: "Logo",
  other: "Other",
};

/** What the upload dialog says, and what a refused file name is told. */
export const VAULT_WARNING =
  "Do not upload bank letters, voided checks, ACH or direct deposit forms, W-9s, or anything that shows a person's identity numbers. Bank details are handled only in Passport.";
/** File names that look like bank or tax-identity paperwork are refused before anything is sent. */
export const BLOCKED_FILENAME = /(?<![a-z])(bank|ach|void(?:ed)?|routing|w-?9)(?![a-z])/i;
export const blockedFilename = (name: string) => BLOCKED_FILENAME.test(name);

/** A vault document warns this many days before it expires. */
export const EXPIRY_WARN_DAYS = 30;
export type ExpiryState = "none" | "current" | "soon" | "expired";
export function expiryState(expiresOn: string | null | undefined, now: Date = new Date()): { state: ExpiryState; days: number | null } {
  if (!expiresOn) return { state: "none", days: null };
  const t = Date.parse(`${expiresOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return { state: "none", days: null };
  const days = Math.floor(t / 86_400_000) - Math.floor(now.getTime() / 86_400_000);
  return { state: days < 0 ? "expired" : days <= EXPIRY_WARN_DAYS ? "soon" : "current", days };
}

const LABEL_TYPES: Array<[RegExp, DocType]> = [
  [/\b(irs|determination|501\s*\(?c\)?|tax[- ]exempt)/i, "irs_letter"],
  [/\baudit/i, "audit"],
  [/\b(financial|balance sheet|income statement|990)/i, "financials"],
  [/\b(board|trustees|directors)/i, "board_list"],
  [/\bbudget/i, "budget"],
  [/\bannual report/i, "annual_report"],
  [/\blogo/i, "logo"],
];
/** The vault type a funder's "required document" label most likely means, or null. */
export function docTypeForLabel(label: string): DocType | null {
  for (const [re, type] of LABEL_TYPES) if (re.test(label)) return type;
  return null;
}

// ------------------------------------------------------------------------------------ checklist

export type RequiredDocStatus = "needed" | "attached" | "not_needed";
export interface RequiredDocument {
  label: string;
  /** The vault (or application) document that meets it. */
  documentId: string | null;
  status: RequiredDocStatus;
}

/** Adds labels not already on the list (case-insensitive), as needed. */
export function mergeRequired(current: RequiredDocument[], labels: string[]): RequiredDocument[] {
  const have = new Set(current.map((d) => d.label.trim().toLowerCase()));
  const out = [...current];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label || have.has(label.toLowerCase())) continue;
    have.add(label.toLowerCase());
    out.push({ label, documentId: null, status: "needed" });
  }
  return out;
}

/** Internal milestones worked back from the full deadline, offered when it is set. */
export const MILESTONES = [
  { key: "draft", title: "First draft due", offsetDays: -14 },
  { key: "review", title: "Team review", offsetDays: -7 },
  { key: "final", title: "Final version ready", offsetDays: -2 },
] as const;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const milestonesFor = (fullDue: string) => MILESTONES.map((m) => ({ key: m.key, title: m.title, dueOn: addDays(fullDue, m.offsetDays) }));

// ------------------------------------------------------------------------------------ go / no-go

export const GO_CRITERIA = ["fit", "capacity", "effort", "relationship"] as const;
export type Criterion = (typeof GO_CRITERIA)[number];
export const CRITERION_LABELS: Record<Criterion, { label: string; help: string }> = {
  fit: { label: "Fit with our work", help: "How closely the funder's priorities match the project." },
  capacity: { label: "Capacity to do it", help: "Whether the team can write it and deliver the work." },
  effort: { label: "Effort against the amount", help: "Whether the amount is worth the work of applying and reporting." },
  relationship: { label: "Relationship with the funder", help: "How well you know the funder and its staff." },
};
export const DEFAULT_WEIGHTS: Record<Criterion, number> = { fit: 3, capacity: 2, effort: 2, relationship: 1 };
export type Scores = Record<Criterion, number>;

/** Each criterion's 1-5 score times its weight, against the most it could be. */
export function goNoGoTotal(scores: Partial<Scores>, weights: Record<Criterion, number>): { total: number; max: number; complete: boolean } {
  let total = 0;
  let max = 0;
  let complete = true;
  for (const c of GO_CRITERIA) {
    const w = Math.max(0, weights[c] ?? 0);
    max += 5 * w;
    const s = scores[c];
    if (typeof s === "number" && s >= 1 && s <= 5) total += s * w;
    else complete = false;
  }
  return { total, max, complete };
}

// ------------------------------------------------------------------------------------ obligations

/** A series makes at most this many obligations. */
export const SERIES_MAX = 60;
/** The dates of "every N months from start until end": the first falls N months after the start. */
export function seriesDates(from: string, until: string, everyMonths: number, max = SERIES_MAX): string[] {
  if (!(everyMonths >= 1) || !from || !until || until < from) return [];
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 1; out.length < max; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i * everyMonths, 1));
    // The same day of the month, or the month's last day when it is shorter.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(start.getUTCDate(), last));
    const iso = d.toISOString().slice(0, 10);
    if (iso > until.slice(0, 10)) break;
    out.push(iso);
  }
  return out;
}

// ------------------------------------------------------------------------------------ fiscal years

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The fiscal year a date falls in, named by the calendar year it ends in (a January start is the calendar year). */
export function fiscalYearOf(iso: string, startMonth: number): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return startMonth <= 1 || m < startMonth ? y : y + 1;
}
export function fiscalYearLabel(fy: number, startMonth: number): string {
  if (startMonth <= 1) return String(fy);
  const short = (m: number) => MONTHS[m - 1]!.slice(0, 3);
  return `FY${fy} (${short(startMonth)} ${fy - 1} – ${short(startMonth === 1 ? 12 : startMonth - 1)} ${fy})`;
}

// ------------------------------------------------------------------------------------ drafts

/** A draft split into plain runs and [bracketed placeholders] for the person to fill in. */
export function splitUnknowns(text: string): { text: string; unknown: boolean }[] {
  const out: { text: string; unknown: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/\[[^\]\n]{1,200}\]/g)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), unknown: false });
    out.push({ text: m[0], unknown: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), unknown: false });
  return out;
}

// ------------------------------------------------------------------------------------ approval

/** Approving an answer is for a workspace admin or the application's owner (the API checks the same). */
export const canApprove = (role: string | null | undefined, userId: string | null | undefined, ownerUserId: string | null | undefined) => role === "admin" || (!!userId && userId === ownerUserId);

// ------------------------------------------------------------------------------------ consulting

/** Answer text the consulting email carries, at most this long in all (packages/notify). */
export const CONSULTING_ANSWERS_MAX = 20_000;

// The email's own cleaning (packages/notify cleanLine / cleanText), so the cut lands where the email's does.
const cleanLine = (v: string) =>
  v
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ")
    .replace(/\p{Cc}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const cleanText = (v: string) =>
  v
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\v\f]+/g, " ")
    .replace(/[^\P{Cc}\n]+/gu, "")
    .replace(/[ ]+\n/g, "\n")
    .trim();

export interface SentAnswer {
  n: number;
  prompt: string;
  /** The answer text as the email carries it, cut short on the question where the email stops. */
  body: string;
  /** The email stops inside this answer. */
  cut: boolean;
}
/**
 * The answers exactly as the consulting email carries them: numbered, "(no answer yet)" for an empty
 * one, and when the whole runs past 20,000 characters, cut at the same character with "…".
 * Questions after the cut are not in the email at all.
 */
export function answersAsSent(answers: readonly { prompt: string; body: string }[]): { items: SentAnswer[]; truncated: boolean; omitted: number } {
  const parts = answers.map((a, i) => ({ n: i + 1, head: `${i + 1}. ${cleanLine(a.prompt)}\n`, body: cleanText(a.body) || "(no answer yet)" }));
  const full = parts.map((p) => p.head + p.body).join("\n\n");
  if (full.length <= CONSULTING_ANSWERS_MAX) return { items: parts.map((p) => ({ n: p.n, prompt: p.head.slice(p.head.indexOf(" ") + 1, -1), body: p.body, cut: false })), truncated: false, omitted: 0 };
  const stop = CONSULTING_ANSWERS_MAX - 1;
  const items: SentAnswer[] = [];
  let at = 0;
  for (const p of parts) {
    if (at >= stop) break;
    const headEnd = at + p.head.length;
    const bodyEnd = headEnd + p.body.length;
    const prompt = p.head.slice(p.head.indexOf(" ") + 1, -1);
    if (bodyEnd <= stop) items.push({ n: p.n, prompt, body: p.body, cut: false });
    else if (headEnd <= stop) items.push({ n: p.n, prompt, body: `${p.body.slice(0, stop - headEnd)}…`, cut: true });
    else items.push({ n: p.n, prompt: `${prompt.slice(0, Math.max(0, stop - at - String(p.n).length - 2))}…`, body: "", cut: true });
    at = bodyEnd + 2;
  }
  return { items, truncated: true, omitted: parts.length - items.length };
}
