// SPDX-License-Identifier: AGPL-3.0-only
// The report builder's words in the page's language. The server names its data sets and columns
// in English (the API is a machine interface); this screen shows them by id in the person's
// language, so a saved view (which keeps column ids) reads the same in either. A name the screen
// does not know yet (a column added on the server) shows as the server wrote it.
import type { Aggregate, ColumnInfo, DataSet, Definition, Filter, OutColumn, ReportView } from "../../api/reports.ts";
import { aggregateKey, csvCell, outColumns } from "../../lib/reports.ts";
import { getLocale, intlLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

type Words = () => string;

const DATA_SET: Record<string, { label: Words; description: Words; columns: Record<string, Words>; notes?: Record<string, Words> }> = {
  applications: {
    label: () => t("reportBuilder.ds.applications.label"),
    description: () => t("reportBuilder.ds.applications.description"),
    columns: {
      title: () => t("reportBuilder.col.applications.title"),
      applicant: () => t("reportBuilder.col.applications.applicant"),
      opportunity: () => t("reportBuilder.col.applications.opportunity"),
      competition: () => t("reportBuilder.col.applications.competition"),
      program: () => t("reportBuilder.col.applications.program"),
      fund: () => t("reportBuilder.col.applications.fund"),
      stage: () => t("reportBuilder.col.applications.stage"),
      status: () => t("reportBuilder.col.applications.status"),
      requested: () => t("reportBuilder.col.applications.requested"),
      currency: () => t("reportBuilder.col.applications.currency"),
      submittedOn: () => t("reportBuilder.col.applications.submittedOn"),
      submittedYear: () => t("reportBuilder.col.applications.submittedYear"),
      averageScore: () => t("reportBuilder.col.applications.averageScore"),
      reviews: () => t("reportBuilder.col.applications.reviews"),
      decision: () => t("reportBuilder.col.applications.decision"),
      declineReason: () => t("reportBuilder.col.applications.declineReason"),
    },
  },
  awards: {
    label: () => t("reportBuilder.ds.awards.label"),
    description: () => t("reportBuilder.ds.awards.description"),
    columns: {
      title: () => t("reportBuilder.col.awards.title"),
      program: () => t("reportBuilder.col.awards.program"),
      fund: () => t("reportBuilder.col.awards.fund"),
      recipient: () => t("reportBuilder.col.awards.recipient"),
      recipientVerified: () => t("reportBuilder.col.awards.recipientVerified"),
      status: () => t("reportBuilder.col.awards.status"),
      amount: () => t("reportBuilder.col.awards.amount"),
      currency: () => t("reportBuilder.col.awards.currency"),
      awardDate: () => t("reportBuilder.col.awards.awardDate"),
      awardYear: () => t("reportBuilder.col.awards.awardYear"),
      startDate: () => t("reportBuilder.col.awards.startDate"),
      endDate: () => t("reportBuilder.col.awards.endDate"),
      paidElsewhere: () => t("reportBuilder.col.awards.paidElsewhere"),
      scheduledRemaining: () => t("reportBuilder.col.awards.scheduledRemaining"),
      nextPaymentDate: () => t("reportBuilder.col.awards.nextPaymentDate"),
      overdueReports: () => t("reportBuilder.col.awards.overdueReports"),
      disbursedThroughPassport: () => t("reportBuilder.col.awards.disbursedThroughPassport"),
    },
    notes: {
      disbursedThroughPassport: () => t("reportBuilder.note.awards.disbursedThroughPassport"),
    },
  },
  payments: {
    label: () => t("reportBuilder.ds.payments.label"),
    description: () => t("reportBuilder.ds.payments.description"),
    columns: {
      tranche: () => t("reportBuilder.col.payments.tranche"),
      award: () => t("reportBuilder.col.payments.award"),
      program: () => t("reportBuilder.col.payments.program"),
      fund: () => t("reportBuilder.col.payments.fund"),
      recipient: () => t("reportBuilder.col.payments.recipient"),
      amount: () => t("reportBuilder.col.payments.amount"),
      currency: () => t("reportBuilder.col.payments.currency"),
      dueDate: () => t("reportBuilder.col.payments.dueDate"),
      status: () => t("reportBuilder.col.payments.status"),
      howPaid: () => t("reportBuilder.col.payments.howPaid"),
      paidElsewhere: () => t("reportBuilder.col.payments.paidElsewhere"),
      paidOn: () => t("reportBuilder.col.payments.paidOn"),
    },
  },
  requirements: {
    label: () => t("reportBuilder.ds.requirements.label"),
    description: () => t("reportBuilder.ds.requirements.description"),
    columns: {
      title: () => t("reportBuilder.col.requirements.title"),
      type: () => t("reportBuilder.col.requirements.type"),
      award: () => t("reportBuilder.col.requirements.award"),
      program: () => t("reportBuilder.col.requirements.program"),
      fund: () => t("reportBuilder.col.requirements.fund"),
      recipient: () => t("reportBuilder.col.requirements.recipient"),
      dueDate: () => t("reportBuilder.col.requirements.dueDate"),
      status: () => t("reportBuilder.col.requirements.status"),
      overdueDays: () => t("reportBuilder.col.requirements.overdueDays"),
    },
  },
  organizations: {
    label: () => t("reportBuilder.ds.organizations.label"),
    description: () => t("reportBuilder.ds.organizations.description"),
    columns: {
      name: () => t("reportBuilder.col.organizations.name"),
      verified: () => t("reportBuilder.col.organizations.verified"),
      fund: () => t("reportBuilder.col.organizations.fund"),
      location: () => t("reportBuilder.col.organizations.location"),
      region: () => t("reportBuilder.col.organizations.region"),
      applications: () => t("reportBuilder.col.organizations.applications"),
      awardCount: () => t("reportBuilder.col.organizations.awardCount"),
      totalAwarded: () => t("reportBuilder.col.organizations.totalAwarded"),
      currency: () => t("reportBuilder.col.organizations.currency"),
    },
  },
  // Imported history (v1.12.0): past applications, reviews and reports.
  history: {
    label: () => t("reportBuilder.ds.history.label"),
    description: () => t("reportBuilder.ds.history.description"),
    columns: {
      record: () => t("reportBuilder.col.history.record"),
      title: () => t("reportBuilder.col.history.title"),
      organization: () => t("reportBuilder.col.history.organization"),
      program: () => t("reportBuilder.col.history.program"),
      fund: () => t("reportBuilder.col.history.fund"),
      call: () => t("reportBuilder.col.history.call"),
      outcome: () => t("reportBuilder.col.history.outcome"),
      submittedOn: () => t("reportBuilder.col.history.submittedOn"),
      submittedYear: () => t("reportBuilder.col.history.submittedYear"),
      dueOn: () => t("reportBuilder.col.history.dueOn"),
      reviewedOn: () => t("reportBuilder.col.history.reviewedOn"),
      requested: () => t("reportBuilder.col.history.requested"),
      awarded: () => t("reportBuilder.col.history.awarded"),
      currency: () => t("reportBuilder.col.history.currency"),
      score: () => t("reportBuilder.col.history.score"),
      reviews: () => t("reportBuilder.col.history.reviews"),
      award: () => t("reportBuilder.col.history.award"),
      importedFrom: () => t("reportBuilder.col.history.importedFrom"),
    },
  },
};

/** The starter views that ship with every workspace, by id. */
const STARTER: Record<string, { name: Words; description: Words }> = {
  "starter-awards-this-year": { name: () => t("reportBuilder.starter.awardsThisYear.name"), description: () => t("reportBuilder.starter.awardsThisYear.description") },
  "starter-payments-due-90": { name: () => t("reportBuilder.starter.paymentsDue90.name"), description: () => t("reportBuilder.starter.paymentsDue90.description") },
  "starter-overdue-reports": { name: () => t("reportBuilder.starter.overdueReports.name"), description: () => t("reportBuilder.starter.overdueReports.description") },
  "starter-applications-by-stage": { name: () => t("reportBuilder.starter.applicationsByStage.name"), description: () => t("reportBuilder.starter.applicationsByStage.description") },
  "starter-grantees-by-total": { name: () => t("reportBuilder.starter.granteesByTotal.name"), description: () => t("reportBuilder.starter.granteesByTotal.description") },
  "starter-decline-reasons": { name: () => t("reportBuilder.starter.declineReasons.name"), description: () => t("reportBuilder.starter.declineReasons.description") },
};

/** A starter view named in the page's language; a saved view is named as the person wrote it. */
export const localizeView = (v: ReportView): ReportView => {
  const words = v.starter ? STARTER[v.id] : undefined;
  return words ? { ...v, name: words.name(), description: words.description() } : v;
};

/** A data set with its name, description and column names in the page's language. */
export function localizeDataSet(ds: DataSet): DataSet {
  const words = DATA_SET[ds.key];
  if (!words) return ds;
  const column = (c: ColumnInfo): ColumnInfo => ({ ...c, label: words.columns[c.key]?.() ?? c.label, ...(c.note ? { note: words.notes?.[c.key]?.() ?? c.note } : {}) });
  return { ...ds, label: words.label(), description: words.description(), columns: ds.columns.map(column) };
}

export const AGGREGATE_WORDS = (): Record<Aggregate["fn"], string> => ({ count: t("reportBuilder.aggregate.count"), sum: t("reportBuilder.aggregate.sum"), avg: t("reportBuilder.aggregate.avg") });

/** "Total awarded amount": an aggregate's column name. */
export function aggregateLabel(fn: Aggregate["fn"], column: string): string {
  if (fn === "count") return t("reportBuilder.aggregate.count");
  return fn === "sum" ? t("reportBuilder.aggregate.sumOf", { column: column.toLowerCase() }) : t("reportBuilder.aggregate.avgOf", { column: column.toLowerCase() });
}

export const OP_WORDS = (): Record<Filter["op"], string> => ({ eq: t("reportBuilder.op.eq"), in: t("reportBuilder.op.in"), between: t("reportBuilder.op.between") });

const STOPPED: Record<string, Words> = {
  owner_left: () => t("reportBuilder.stopped.ownerLeft"),
  no_recipients: () => t("reportBuilder.stopped.noRecipients"),
  view_private: () => t("reportBuilder.stopped.viewPrivate"),
};
/** Why a schedule stopped, by its reason id; the reason as written for one this screen does not know. */
export const stoppedWords = (reason: string): string => STOPPED[reason]?.() ?? reason;

/** Monday first, as the schedule numbers them (1 = Monday). 1 January 2024 was a Monday. */
export const weekdayName = (day: number): string => new Intl.DateTimeFormat(intlLocale(), { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2024, 0, day));

/** How a schedule reads: "Every Monday" or "On the 1st of every month". */
export function cadenceWords(s: { cadence: "weekly" | "monthly"; weekday: number | null; dayOfMonth: number | null }): string {
  if (s.cadence === "weekly") return t("reportBuilder.cadence.weekly", { weekday: weekdayName(s.weekday ?? 1) });
  return t("reportBuilder.cadence.monthly", { day: s.dayOfMonth ?? 1 });
}

/** The output columns of a definition, named in the page's language (`ds` already localized). */
export function localizedOutColumns(ds: DataSet, d: Definition): OutColumn[] {
  return outColumns(ds, d).map((c) => {
    if (c.key === "count") return { ...c, label: aggregateLabel("count", "") };
    const agg = d.aggregates.find((a) => a.fn !== "count" && aggregateKey(a) === c.key);
    if (!agg) return c;
    const column = ds.columns.find((x) => x.key === agg.column)?.label ?? agg.column ?? "";
    return { ...c, label: aggregateLabel(agg.fn, column) };
  });
}

/**
 * A downloaded CSV with its header row in the page's language. The server writes headers in
 * English; the row is replaced only when it is exactly the English header this definition gives,
 * so a file the screen cannot vouch for is saved as it came.
 */
export async function csvInPageLanguage(blob: Blob, english: OutColumn[], localized: OutColumn[]): Promise<Blob> {
  if (getLocale() === "en" || english.length !== localized.length) return blob;
  const text = await blob.text();
  const end = text.indexOf("\r\n");
  const bom = text.startsWith("\ufeff") ? "\ufeff" : "";
  const header = text.slice(bom.length, end);
  if (end < 0 || header !== english.map((c) => csvCell(c.label)).join(",")) return blob;
  return new Blob([bom + localized.map((c) => csvCell(c.label)).join(",") + text.slice(end)], { type: blob.type || "text/csv" });
}
