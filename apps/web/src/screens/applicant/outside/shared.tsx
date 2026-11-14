// SPDX-License-Identifier: AGPL-3.0-only
// Pieces the outside-application screens share: deadline phrases, money from what a person typed,
// the organization facts a writer can drop into an answer, and a few small views.
import { CalendarClock } from "lucide-react";
import type { MyOrganization } from "../../../api/applicant.ts";
import type { Deadlines, Money, OutsideStage } from "../../../api/outside.ts";
import { StatusBadge } from "../../../components/status.tsx";
import { daysUntil, formatDate, formatMoney, parseDollars } from "../../../lib/format.ts";

export const DEADLINE_LABELS = { internalDue: "Internal deadline", loiDue: "Letter of inquiry due", fullDue: "Full application due" } as const;
type DeadlineKey = keyof typeof DEADLINE_LABELS;

/** The soonest deadline still ahead (internal first on a tie), else the latest one passed. */
export function nextDeadline(d: Deadlines, now: Date = new Date()): { key: DeadlineKey; date: string } | null {
  const all = (Object.keys(DEADLINE_LABELS) as DeadlineKey[]).flatMap((key) => (d[key] ? [{ key, date: d[key]! }] : []));
  const ahead = all.filter((x) => (daysUntil(x.date, now) ?? -1) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  return ahead[0] ?? all.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** "in 9 days", "today", "3 days ago". */
export function dueIn(iso: string | null | undefined, now: Date = new Date()): string {
  const n = daysUntil(iso, now);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n > 0) return `in ${n} day${n === 1 ? "" : "s"}`;
  return `${-n} day${n === -1 ? "" : "s"} ago`;
}

export function DeadlineText({ date, urgentWithin = 7 }: { date: string | null | undefined; urgentWithin?: number }) {
  if (!date) return <span className="muted">—</span>;
  const n = daysUntil(date);
  const urgent = n !== null && n >= 0 && n <= urgentWithin;
  return (
    <span className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
      <span>{formatDate(date)}</span>
      <span className={urgent ? "small b" : "small muted"} style={urgent ? { color: "var(--s-warn-fg)" } : undefined}>
        {urgent && <CalendarClock className="ic ic-sm" aria-hidden="true" />} {dueIn(date)}
      </span>
    </span>
  );
}

export const moneyText = (m: Money | null | undefined) => (m ? formatMoney(m) : "—");
/** Dollars typed by a person → Money, or null when the text is not an amount. */
export function moneyFrom(text: string, currency = "USD"): Money | null {
  const minor = parseDollars(text);
  return minor === null ? null : { amount: (minor / 100).toFixed(2), currency };
}
export const dollarsOf = (m: Money | null | undefined) => (m ? String(Number(m.amount)) : "");

export const StageBadge = ({ stage, large = false }: { stage: OutsideStage; large?: boolean }) => <StatusBadge kind="outside" status={stage} large={large} />;

export const METHOD_LABELS = { portal: "The funder’s online portal", email: "Email", mail: "Mail or delivery", grants_gov: "Grants.gov", other: "Another way" } as const;

// ------------------------------------------------------------------------------------ facts

export interface OrgFact {
  key: string;
  label: string;
  value: string;
  /** Where the value comes from, in words. */
  from: string;
}

type Json = Record<string, unknown>;
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Json)[k] : undefined), o);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const ein = (v: string | null) => v?.replace(/-/g, "").replace(/^(\d{2})(\d{7})$/, "$1-$2") ?? null;
const address = (a: unknown) => {
  const parts = [text(at(a, "street1")), text(at(a, "street2")), [text(at(a, "city")), [text(at(a, "stateOrProvince") ?? at(a, "state")), text(at(a, "postalCode"))].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

/** The organization facts a writer can insert: from Passport when linked, else what the organization entered. */
export function orgFacts(org: MyOrganization): OrgFact[] {
  const passport = org.linked && !!org.organization;
  const from = passport ? "From Passport" : "Entered by your organization";
  const o = org.organization as unknown;
  const s = org.selfDeclared;
  const budget = num(at(org.profile, "commonApp.financials.budget"));
  const rows: [string, string, string | null][] = passport
    ? [
        ["legalName", "Legal name", text(at(o, "name"))],
        ["ein", "EIN", ein(text(at(o, "identifiers.org:us:ein.id")))],
        ["mission", "Mission", text(at(o, "mission"))],
        ["address", "Address", address(at(o, "addresses.primary"))],
        ["yearFounded", "Year founded", text(at(o, "yearFounded"))],
        ["budget", "Annual operating budget", budget === null ? null : formatMoney({ amount: String(budget), currency: "USD" })],
      ]
    : [
        ["legalName", "Legal name", text(s?.legalName)],
        ["ein", "EIN", ein(text(s?.ein))],
        ["mission", "Mission", text(s?.mission)],
        ["address", "Address", address(s?.address)],
      ];
  return rows.flatMap(([key, label, value]) => (value ? [{ key, label, value, from }] : []));
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------------------------ files

export const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
/** The design's file-type tile: pdf, xls or doc. */
export const fileKind = (name: string) => (/\.pdf$/i.test(name) ? "pdf" : /\.(xlsx?|csv)$/i.test(name) ? "xls" : /\.docx?$/i.test(name) ? "doc" : "");
export const sizeText = (n: number) => (n <= 0 ? "Held in Passport" : n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Uploads above this are refused here, before any bytes are sent. */
export const MAX_UPLOAD_BYTES = 10 * 1_048_576;
