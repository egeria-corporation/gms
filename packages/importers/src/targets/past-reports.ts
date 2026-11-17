// SPDX-License-Identifier: AGPL-3.0-only
// Target: the reports on a funder's past grants (interim and final reports, impact reports,
// follow-up forms). One row is one report: the grant it is for (the export's own id for it, else
// its title), its title, when it was due and submitted, and where it stood. The report's file, when
// the system's zip holds one, is attached after the import, matched by the report's id or title
// (../adapters/attachments.ts). Imported reports are history: they are not requirements of a live
// award, gate no payment and send no reminder.
import type { FieldSpec, ImportTarget, Problem, RowCheck } from "../target.ts";
import { readDate } from "../values.ts";
import { exportId, label, readReportState, type PastReportState } from "./past-common.ts";

export const PAST_REPORT_FIELDS = ["awardRef", "awardTitle", "organizationName", "title", "dueDate", "submittedDate", "status", "sourceId"] as const;
export type PastReportField = (typeof PAST_REPORT_FIELDS)[number];

export interface PastReportRecord {
  /** The export's own id for the grant the report is on. Never stored as written. */
  awardRef: string | null;
  awardTitle: string | null;
  organizationName: string | null;
  title: string;
  dueOn: string | null;
  submittedOn: string | null;
  state: PastReportState;
  /** The status as the export wrote it. */
  stateLabel: string | null;
  /** The export's own id for the report: matches its file in the zip, and recognises it when imported again. */
  sourceId: string | null;
}

const SPECS: FieldSpec<PastReportField>[] = [
  { key: "sourceId", label: "Report ID", kind: "id", synonyms: ["report id", "impact report id", "follow up id", "followup id", "requirement id", "report number"], help: "Optional. The id your old system gave each report. Its file in the zip is matched by it." },
  { key: "awardRef", label: "Grant ID", kind: "id", synonyms: ["grant id", "award id", "request id", "submission id", "application id", "grant number", "award number", "request number", "application slug", "slug"], help: "The id of the grant the report is on, as in the grant history or applications you imported. Without it, the grant's exact title is used." },
  { key: "awardTitle", label: "Grant title", kind: "text", synonyms: ["grant title", "award title", "project title", "submission title", "application title", "grant", "award", "project"] },
  { key: "organizationName", label: "Organization", kind: "text", synonyms: ["organization", "organisation", "organization name", "organisation name", "grantee", "applicant organization", "company"] },
  { key: "title", label: "Report title", kind: "text", required: true, synonyms: ["report title", "report", "report name", "report type", "impact report type", "impact report", "follow up", "follow up form", "followup form", "requirement", "form name", "title"] },
  { key: "dueDate", label: "Due on", kind: "date", synonyms: ["due", "due date", "report due", "report due date", "deadline", "due on", "date due"] },
  { key: "submittedDate", label: "Submitted on", kind: "date", synonyms: ["submitted", "date submitted", "submitted on", "submitted date", "received", "date received", "completed on", "date completed"] },
  { key: "status", label: "Status", kind: "choice", synonyms: ["status", "report status", "impact report status", "state"] },
];

export function checkPastReportRow(v: Partial<Record<PastReportField, string>>): RowCheck<PastReportField, PastReportRecord> {
  const problems: Problem<PastReportField>[] = [];
  const problem = (field: PastReportField, message: string) => void problems.push({ field, message });
  const title = label(v.title, 300) ?? "";
  if (!title) problem("title", "No report title");
  const awardRef = exportId(v.awardRef);
  const awardTitle = label(v.awardTitle, 300);
  const organizationName = label(v.organizationName, 200);
  if (!awardRef && !awardTitle && !organizationName) problem("awardTitle", "Name the grant the report is on: its ID, its title or the organization");
  const dueOn = readDate(v.dueDate);
  if (dueOn === null) problem("dueDate", "Due on is not a date (use YYYY-MM-DD)");
  const submittedOn = readDate(v.submittedDate);
  if (submittedOn === null) problem("submittedDate", "Submitted on is not a date (use YYYY-MM-DD)");
  const record: PastReportRecord | null = problems.length
    ? null
    : { awardRef, awardTitle, organizationName, title, dueOn: dueOn ?? null, submittedOn: submittedOn ?? null, state: readReportState(v.status, !!submittedOn), stateLabel: label(v.status), sourceId: exportId(v.sourceId) };
  return { problems, record, money: [], title: title || "(no title)", subtitle: awardTitle ?? organizationName };
}

export const PAST_REPORTS_TARGET: ImportTarget<PastReportField, PastReportRecord> = {
  key: "history_reports",
  noun: { one: "past report", many: "past reports" },
  fields: SPECS,
  check: checkPastReportRow,
};
