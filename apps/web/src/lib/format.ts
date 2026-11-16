// SPDX-License-Identifier: AGPL-3.0-only
// Display formatting shared by screens. Amounts travel as CommonGrants Money (decimal string) or
// integer minor units; dates as ISO strings. Everything is in the page's language (i18n/current.ts)
// unless a `locale` is passed, as the front Worker does for each request.
import { formatCurrency, formatDateIn, type DateStyle, type Locale } from "@gms/i18n";
import type { Money, OppFunding } from "../api/types.ts";
import { getLocale, translate } from "../i18n/current.ts";

export function formatMoney(m: Money | undefined | null, locale: Locale = getLocale()): string {
  if (!m) return "—";
  const n = Number(m.amount);
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(locale, n, m.currency);
}

export function formatMinor(minor: number | null | undefined, currency = "USD", locale: Locale = getLocale()): string {
  if (minor === null || minor === undefined) return "—";
  return formatMoney({ amount: String(minor / 100), currency }, locale);
}

/** "$50,000 – $150,000", "Up to $10,000", "From $5,000" or "—". */
export function formatAwardRange(f: OppFunding | undefined | null, locale: Locale = getLocale()): string {
  const min = f?.minAwardAmount;
  const max = f?.maxAwardAmount;
  if (min && max) return translate("shared", "format.awardRange", { min: formatMoney(min, locale), max: formatMoney(max, locale) }, locale);
  if (max) return translate("shared", "format.upTo", { max: formatMoney(max, locale) }, locale);
  if (min) return translate("shared", "format.from", { min: formatMoney(min, locale) }, locale);
  return "—";
}

/** "3–5 awards", "About 4 awards", or null when the call says nothing about it. */
export function formatAwardCount(f: OppFunding | undefined | null, locale: Locale = getLocale()): string | null {
  if (f?.minAwardCount && f.maxAwardCount) return translate("shared", "format.awardCountRange", { min: f.minAwardCount, max: f.maxAwardCount }, locale);
  if (f?.estimatedAwardCount) return translate("shared", "format.awardCountAbout", { count: f.estimatedAwardCount }, locale);
  return null;
}

/** "Apr 30, 2027" / "30 abr 2027" from an ISO date or date-time; "—" when missing or unparseable. */
export function formatDate(iso: string | null | undefined): string {
  return formatDateAs(iso, "short");
}

/** A date in another style (`medium`: "April 30, 2027" / "30 de abril de 2027") or language. */
export function formatDateAs(iso: string | null | undefined, style: DateStyle, locale: Locale = getLocale()): string {
  if (!iso) return "—";
  return formatDateIn(locale, iso, style) ?? "—";
}

/** Calendar days (UTC) from `now` until the ISO date or date-time; 0 on the day itself, negative once past. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  return day(t) - day(now.getTime());
}

/** Dollars typed by a person ("1,200,000" or "$1.2m" is not accepted; digits, commas, a decimal point) → minor units. */
export function parseDollars(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** The CommonGrants applicant types, in the order the eligibility editor lists them. */
export const APPLICANT_TYPE_CODES = [
  "individual",
  "organization",
  "government_state",
  "government_county",
  "government_municipal",
  "government_special_district",
  "government_tribal",
  "organization_tribal_other",
  "school_district_independent",
  "higher_education_public",
  "higher_education_private",
  "non_profit_with_501c3",
  "nonprofit_without_501c3",
  "for_profit_small_business",
  "for_profit_not_small_business",
  "unrestricted",
  "custom",
] as const;
export type ApplicantTypeCode = (typeof APPLICANT_TYPE_CODES)[number];
const isApplicantType = (code: string): code is ApplicantTypeCode => (APPLICANT_TYPE_CODES as readonly string[]).includes(code);

/** Each code's label, read in the current language every time (shared catalog, `applicantType.*`). */
export const APPLICANT_TYPE_LABELS: Readonly<Record<string, string>> = Object.defineProperties(
  {},
  Object.fromEntries(APPLICANT_TYPE_CODES.map((code) => [code, { enumerable: true, get: () => translate("shared", `applicantType.${code}`) }])),
);
export const applicantTypeLabel = (code: string): string => applicantTypeLabelIn(code, getLocale());
export const applicantTypeLabelIn = (code: string, locale: Locale): string => (isApplicantType(code) ? translate("shared", `applicantType.${code}`, undefined, locale) : code);

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "") || "opportunity";
