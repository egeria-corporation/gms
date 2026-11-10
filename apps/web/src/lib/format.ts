// SPDX-License-Identifier: AGPL-3.0-only
// Display formatting shared by screens. Amounts travel as CommonGrants Money (decimal string) or
// integer minor units; dates as ISO strings.
import type { Money, OppFunding } from "../api/types.ts";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(m: Money | undefined | null): string {
  if (!m) return "—";
  const n = Number(m.amount);
  if (!Number.isFinite(n)) return "—";
  return m.currency === "USD" ? usd0.format(n) : new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, maximumFractionDigits: 0 }).format(n);
}

export function formatMinor(minor: number | null | undefined, currency = "USD"): string {
  if (minor === null || minor === undefined) return "—";
  return formatMoney({ amount: String(minor / 100), currency });
}

/** "$50,000 – $150,000", "Up to $10,000", "From $5,000" or "—". */
export function formatAwardRange(f: OppFunding | undefined | null): string {
  const min = f?.minAwardAmount;
  const max = f?.maxAwardAmount;
  if (min && max) return `${formatMoney(min)} – ${formatMoney(max)}`;
  if (max) return `Up to ${formatMoney(max)}`;
  if (min) return `From ${formatMoney(min)}`;
  return "—";
}

export function formatAwardCount(f: OppFunding | undefined | null): string | null {
  if (f?.minAwardCount && f.maxAwardCount) return `${f.minAwardCount}–${f.maxAwardCount} awards`;
  if (f?.estimatedAwardCount) return `About ${f.estimatedAwardCount} awards`;
  return null;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Apr 30, 2027" from an ISO date or date-time; "—" when missing or unparseable. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(t) ? "—" : dateFmt.format(t);
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

export const APPLICANT_TYPE_LABELS: Record<string, string> = {
  individual: "Individuals",
  organization: "Organizations",
  government_state: "State government",
  government_county: "County government",
  government_municipal: "Local government",
  government_special_district: "Special district",
  government_tribal: "Tribal government",
  organization_tribal_other: "Tribal organization",
  school_district_independent: "School district",
  higher_education_public: "Public higher education",
  higher_education_private: "Private higher education",
  non_profit_with_501c3: "501(c)(3)",
  nonprofit_without_501c3: "Nonprofit without 501(c)(3)",
  for_profit_small_business: "Small business",
  for_profit_not_small_business: "Business",
  unrestricted: "Unrestricted",
  custom: "Other",
};
export const applicantTypeLabel = (code: string) => APPLICANT_TYPE_LABELS[code] ?? code;

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "") || "opportunity";
