// SPDX-License-Identifier: AGPL-3.0-only
// Small pieces the applicant screens share: the funder chip with its accent dot, initials avatars,
// a wrapper that draws loading and error states for a query, and a few date phrases.
import type { CSSProperties, ReactNode } from "react";
import { ApiError, initialsOf } from "../api/client.ts";
import type { Query } from "../api/hooks.ts";
import { daysUntil, formatDate } from "../lib/format.ts";
import { ErrorBanner, Loading } from "./ui.tsx";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
/** A funder's name with its accent dot. The accent is the funder's own brand color, from the API. */
export function FunderChip({ name, accent, short = false, style }: { name: string | null | undefined; accent?: string | null | undefined; short?: boolean; style?: CSSProperties }) {
  const label = name ?? "Funder";
  return (
    <span className="chip" style={{ ...(accent ? ({ "--tenant": accent } as CSSProperties) : {}), ...style }}>
      <span className="tdot" aria-hidden="true"></span>
      {short ? label.split(" ").slice(0, 2).join(" ").replace(/ (Community|County)$/, "") : label}
    </span>
  );
}

export const accentOf = (brand: unknown): string | undefined => {
  const accent = brand && typeof brand === "object" ? (brand as { accent?: unknown }).accent : undefined;
  return typeof accent === "string" ? accent : undefined;
};

const TONES = ["av-t", "", "av-g", "av-n"] as const;

/** Initials avatar. The tone only tells people apart; the name is always in the title. */
export function Avatar({ name, index = 0, size, live = false, note }: { name: string; index?: number; size?: "sm" | "lg"; live?: boolean; note?: string }) {
  const cls = ["av", TONES[index % TONES.length], size ? `av-${size}` : "", live ? "live" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls} title={note ? `${name} ${note}` : name}>
      {initialsOf(name)}
    </span>
  );
}

/** Draws a query's loading and error states; calls `children` with the data once it is there. */
export function Loaded<T>({ query, label, children }: { query: Query<T>; label?: string; children: (data: T) => ReactNode }) {
  if (query.status === "loading") return <Loading {...(label ? { label } : {})} />;
  if (query.status === "error") return <ErrorBanner error={query.error} onRetry={query.reload} />;
  return <>{children(query.data)}</>;
}

export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** "Closes in 14 days · Apr 30, 2027", "Closes today", "Closed Apr 30, 2027". */
export function closesPhrase(iso: string | null | undefined, now: Date = new Date()): { text: string; urgent: boolean } | null {
  const days = daysUntil(iso, now);
  if (days === null) return null;
  if (days < 0) return { text: t("applicant.closed", { iso: formatDate(iso) }), urgent: false };
  if (days === 0) return { text: t("applicant.closesToday", { iso: formatDate(iso) }), urgent: true };
  return { text: t("applicant.closesInDays", { days, date: formatDate(iso) }), urgent: days <= 21 };
}

/** "2 h ago", "yesterday", "Apr 18, 2027". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  // A time ahead of this clock (another machine's, or seeded data) is shown as its date.
  if (ms < -60_000) return formatDate(iso);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return formatDate(iso);
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? t("applicant.goodMorning") : h < 18 ? t("applicant.goodAfternoon") : t("applicant.goodEvening");
}

/** The first name to greet someone by. An address is cut at the @; a lower-case local part is capitalised. */
export const firstName = (name: string) => {
  const first = name.replace(/@.*$/, "").split(/[\s._-]+/)[0] ?? name;
  return first && first === first.toLowerCase() ? first.charAt(0).toUpperCase() + first.slice(1) : first;
};

const SOURCE_LABELS: Record<string, string> = {
  get irs_bmf() {
    return t("applicant.sourceLabels.irs_bmf");
  },
  get irs_990() {
    return t("applicant.sourceLabels.irs_990");
  },
  get user() {
    return t("applicant.sourceLabels.user");
  },
  get member() {
    return t("applicant.sourceLabels.member");
  },
  qbo: "QuickBooks",
  sam: "SAM.gov",
};
/** Where Passport got a profile value, in words. */
export const sourceLabel = (source: string | undefined) => (source ? (SOURCE_LABELS[source] ?? source.replace(/_/g, " ")) : "Passport");
