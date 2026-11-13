// SPDX-License-Identifier: AGPL-3.0-only
// The "New award" form: what the funder types, the checks that run before anything is sent, and the
// request it becomes. Messages are plain words; each names the field it belongs to.
import type { DirectAwardInput } from "../api/directAwards.ts";

export const MESSAGE_MAX = 2000;
export const TITLE_MAX = 300;
export const ORG_NAME_MAX = 200;

export interface DirectAwardForm {
  organizationName: string;
  contactEmail: string;
  title: string;
  /** Dollars as typed, e.g. "25,000" or "25000.50". */
  amount: string;
  startDate: string;
  endDate: string;
  programId: string;
  message: string;
}

export const EMPTY_DIRECT_AWARD: DirectAwardForm = { organizationName: "", contactEmail: "", title: "", amount: "", startDate: "", endDate: "", programId: "", message: "" };

export type DirectAwardField = keyof DirectAwardForm;
export type DirectAwardProblems = Partial<Record<DirectAwardField, string>>;

/** Web and email addresses are refused in funder text: the invitation email links only to the claim page and the GMS home. Mirrors the API. */
export const FUNDER_TEXT_LINK = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|us|gov|edu|info|biz|app|dev|link|xyz|me|ly|site|online|ru|cn|top|click)\b)/i;
const noLink = (what: string, v: string) => (FUNDER_TEXT_LINK.test(v) ? `${what} cannot contain a web or email address.` : null);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "25,000" or "$25000.5" to "25000.50"; null when it is not a plain dollar amount. */
export function normalizeAmount(text: string): string | null {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole = "0", cents = ""] = t.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${cents.padEnd(2, "0")}`;
}

export function directAwardProblems(f: DirectAwardForm): DirectAwardProblems {
  const p: DirectAwardProblems = {};
  const org = f.organizationName.trim();
  if (!org) p.organizationName = "Enter the organization's name.";
  else if (org.length > ORG_NAME_MAX) p.organizationName = `Use ${ORG_NAME_MAX} characters or fewer.`;
  else p.organizationName = noLink("The organization name", org) ?? undefined;
  const email = f.contactEmail.trim();
  if (!email) p.contactEmail = "Enter the contact's email address.";
  else if (!EMAIL.test(email)) p.contactEmail = "Enter a full email address, like name@example.org.";
  const title = f.title.trim();
  if (!title) p.title = "Give the award a title.";
  else if (title.length > TITLE_MAX) p.title = `Use ${TITLE_MAX} characters or fewer.`;
  else p.title = noLink("The award title", title) ?? undefined;
  const amount = normalizeAmount(f.amount);
  if (!f.amount.trim()) p.amount = "Enter the amount in dollars.";
  else if (amount === null) p.amount = "Enter dollars and cents only, like 25000 or 25000.50.";
  else if (Number(amount) <= 0) p.amount = "The amount must be more than zero.";
  if (f.startDate && !DATE.test(f.startDate)) p.startDate = "Enter a valid date.";
  if (f.endDate && !DATE.test(f.endDate)) p.endDate = "Enter a valid date.";
  if (!p.startDate && !p.endDate && f.startDate && f.endDate && f.endDate < f.startDate) p.endDate = "The end date must be on or after the start date.";
  if (f.message.length > MESSAGE_MAX) p.message = `Use ${MESSAGE_MAX} characters or fewer. This is ${f.message.length}.`;
  else if (FUNDER_TEXT_LINK.test(f.message)) p.message = "The message cannot contain a web or email address. The email already links to the award.";
  if (!p.startDate && !p.endDate && !f.startDate !== !f.endDate) p[f.startDate ? "endDate" : "startDate"] = "Give both the start and the end of the grant period, or neither.";
  for (const k of Object.keys(p) as DirectAwardField[]) if (p[k] === undefined) delete p[k];
  return p;
}

/** The request for a form that has no problems. Optional fields left empty are left out. */
export function toDirectAwardInput(f: DirectAwardForm): DirectAwardInput {
  const message = f.message.trim();
  return {
    recipient: { organizationName: f.organizationName.trim(), contactEmail: f.contactEmail.trim() },
    title: f.title.trim(),
    amount: { value: normalizeAmount(f.amount) ?? "0.00", currency: "USD" },
    ...(f.startDate ? { startDate: f.startDate } : {}),
    ...(f.endDate ? { endDate: f.endDate } : {}),
    ...(f.programId ? { programId: f.programId } : {}),
    ...(message ? { message } : {}),
  };
}

/** `j…@example.org`: the first letter and the domain, nothing else. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().split("@");
  return local && domain ? `${local[0]}…@${domain.toLowerCase()}` : "…";
}

/** Days from `now` until `iso`, rounded up; 0 when it is past. */
export function daysLeft(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000));
}

/** "25000.50" as "$25,000.50"; whole dollars lose the cents. An amount that is not a number shows as "—". */
export function formatDecimalAmount(value: string, currency = "USD"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
}
