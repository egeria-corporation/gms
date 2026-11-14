// SPDX-License-Identifier: AGPL-3.0-only
// The funding summary (v1.7.0): an applicant organization's outside and built-in applications by
// fiscal year: submitted, decided, awarded and declined, the win rate (awarded / decided) and the
// amounts asked and awarded. The fiscal year starts in the month the workspace sets (January by
// default) and is named for the calendar year it ends in. Exported as CSV and as a one-page PDF
// for the board. Private to the applicant workspace; amounts are its own records.
import { renderFundingSummary } from "@gms/documents";
import { toCsv } from "@gms/importers";
import { toMoney, type Money } from "@gms/protocol";
import { authorize, required, type ServiceContext } from "./context.ts";
import { OUTSIDE_ROLES } from "./outside.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

/** The workspace's fiscal year start month, 1-12 (January when not set). */
export function fiscalYearStartOf(settings: unknown): number {
  const m = (settings as { fiscalYearStartMonth?: unknown } | null)?.fiscalYearStartMonth;
  return typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}

/** The fiscal year a date falls in, named for the calendar year it ends in (FY 2027 = Jul 2026 to Jun 2027 when it starts in July). */
export function fiscalYearOf(iso: string, startMonth: number): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return startMonth === 1 || m < startMonth ? y : y + 1;
}

export function fiscalYearRange(fy: number, startMonth: number) {
  const startYear = startMonth === 1 ? fy : fy - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = fy;
  const end = new Date(Date.UTC(endYear, endMonth, 0)).toISOString().slice(0, 10);
  const label = startMonth === 1 ? `FY ${fy}` : `FY ${fy} (${SHORT[startMonth - 1]} ${startYear} to ${SHORT[endMonth - 1]} ${endYear})`;
  return { start, end, label };
}

type Totals = Map<string, number>;
const add = (t: Totals, currency: string, minor: number | null | undefined) => {
  if (typeof minor === "number") t.set(currency, (t.get(currency) ?? 0) + minor);
};
const monies = (t: Totals): Money[] => [...t.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => toMoney(n, c));
const printed = (ms: Money[]) => (ms.length ? ms.map((m) => `${m.currency} ${Number(m.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("; ") : "None");

interface Counts {
  submitted: number;
  decided: number;
  awarded: number;
  declined: number;
}
interface Year {
  fy: number;
  outside: Counts;
  gms: Counts;
  asked: Totals;
  awarded: Totals;
}
const zero = (): Counts => ({ submitted: 0, decided: 0, awarded: 0, declined: 0 });

/**
 * What is counted: an application is counted as submitted in the fiscal year of its submission
 * date, with its ask; as decided (awarded or declined) in the year of the decision, with the amount
 * awarded. Withdrawn applications count as submitted only. Drafts are not counted.
 */
export const SUMMARY_NOTE = "Applications are counted in the fiscal year they were submitted, with the amount asked; decisions in the year they were made, with the amount awarded. Win rate is awarded divided by decided (awarded plus declined). Includes applications to funders on this GMS and outside applications recorded here.";

export async function fundingSummary(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant", roles: OUTSIDE_ROLES });
  const w = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const startMonth = fiscalYearStartOf(w.settings);
  const years = new Map<number, Year>();
  const yearOf = (iso: string) => {
    const fy = fiscalYearOf(iso, startMonth);
    if (!years.has(fy)) years.set(fy, { fy, outside: zero(), gms: zero(), asked: new Map(), awarded: new Map() });
    return years.get(fy)!;
  };

  // Outside applications: the applicant's own records.
  for (const r of await ctx.repos.table("outside_applications").find({ workspace_id: ws.id }, { limit: 10_000 })) {
    if (r.submitted_at) {
      const y = yearOf(r.submitted_at);
      y.outside.submitted++;
      add(y.asked, r.currency, r.ask_amount_minor);
    }
    if (r.decided_at && (r.stage === "awarded" || r.stage === "declined")) {
      const y = yearOf(r.decided_at);
      y.outside.decided++;
      if (r.stage === "awarded") {
        y.outside.awarded++;
        add(y.awarded, r.currency, r.awarded_amount_minor);
      } else y.outside.declined++;
    }
  }

  // Built-in applications: the applicant's side of funders' records on this GMS.
  const apps = await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: 10_000 });
  const decisionIds = apps.map((a) => a.decision_id).filter((x): x is string => !!x);
  const decisions = decisionIds.length ? await ctx.repos.table("decisions").find({ id: decisionIds }, { notNull: ["committed_at"] }) : [];
  for (const a of apps) {
    if (a.submitted_at) {
      const y = yearOf(a.submitted_at);
      y.gms.submitted++;
      add(y.asked, a.currency, a.requested_amount_minor);
    }
    const d = decisions.find((x) => x.id === a.decision_id && x.application_id === a.id);
    if (d?.committed_at && (a.status === "accepted" || a.status === "declined") && (d.outcome === "approve" || d.outcome === "decline")) {
      const y = yearOf(d.committed_at);
      y.gms.decided++;
      if (d.outcome === "approve") {
        y.gms.awarded++;
        add(y.awarded, d.currency, d.amount_minor);
      } else y.gms.declined++;
    }
  }

  const rows = [...years.values()]
    .sort((a, b) => b.fy - a.fy)
    .map((y) => {
      const total: Counts = { submitted: y.outside.submitted + y.gms.submitted, decided: y.outside.decided + y.gms.decided, awarded: y.outside.awarded + y.gms.awarded, declined: y.outside.declined + y.gms.declined };
      const range = fiscalYearRange(y.fy, startMonth);
      return {
        fiscalYear: y.fy,
        label: range.label,
        start: range.start,
        end: range.end,
        ...total,
        winRate: total.decided ? Math.round((total.awarded / total.decided) * 1000) / 1000 : null,
        asked: monies(y.asked),
        awardedAmount: monies(y.awarded),
        bySource: { outside: y.outside, gms: y.gms },
      };
    });
  return { organization: w.legal_name ?? w.display_name, fiscalYearStartMonth: startMonth, fiscalYearStarts: MONTHS[startMonth - 1]!, generatedAt: ctx.now().toISOString(), years: rows, note: SUMMARY_NOTE };
}

const pct = (r: number | null) => (r === null ? "None decided" : `${Math.round(r * 100)}%`);

const CSV_HEADER = ["fiscal_year", "label", "start", "end", "submitted", "decided", "awarded", "declined", "win_rate", "asked", "awarded_amount", "outside_submitted", "outside_awarded", "gms_submitted", "gms_awarded"] as const;

/** The summary as CSV (one row per fiscal year) or as the one-page PDF for the board. */
export async function exportFundingSummary(ctx: ServiceContext, format: "csv" | "pdf"): Promise<{ body: string | Uint8Array; contentType: string; filename: string }> {
  const s = await fundingSummary(ctx);
  if (format === "csv") {
    const rows = s.years.map((y) => [y.fiscalYear, y.label, y.start, y.end, y.submitted, y.decided, y.awarded, y.declined, y.winRate === null ? "" : y.winRate.toFixed(3), printed(y.asked), printed(y.awardedAmount), y.bySource.outside.submitted, y.bySource.outside.awarded, y.bySource.gms.submitted, y.bySource.gms.awarded]);
    return { body: toCsv(CSV_HEADER, rows), contentType: "text/csv; charset=utf-8", filename: "funding-summary.csv" };
  }
  const bytes = await renderFundingSummary({ organization: s.organization, fiscalYearStarts: s.fiscalYearStarts, generatedAt: s.generatedAt, note: s.note, years: s.years.map((y) => ({ label: y.label, submitted: y.submitted, decided: y.decided, awarded: y.awarded, declined: y.declined, winRate: pct(y.winRate), asked: printed(y.asked), awardedAmount: printed(y.awardedAmount) })) });
  return { body: bytes, contentType: "application/pdf", filename: "funding-summary.pdf" };
}
