// SPDX-License-Identifier: AGPL-3.0-only
// SurveyMonkey Apply: Reports → Data Exports builds a CSV or XLSX from one program at a time, up to
// 100 columns; a submissions export starts with the submission title, stage and status (its help
// page), and a bulk PDF download zips the applications. Stage and the "submission title" heading
// are what tell its export apart; the other headings follow the fields each funder picks.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const SM_APPLY: ImportAdapter = {
  key: "sm_apply",
  system: "SurveyMonkey Apply",
  via: "file",
  steps: [
    "In SurveyMonkey Apply, open Reports, then Data Exports, and create an export for one program (one export per program, up to 100 columns).",
    "Add the applicant's organization, the award amount and any dates you keep, then export as CSV or XLSX.",
    "To bring the PDFs too, download the applications as a bulk PDF zip.",
  ],
  targetSteps: {
    history_applications: [
      "In SurveyMonkey Apply, open Reports, then Data Exports, and create an export for one program (one export per program, up to 100 columns).",
      "Add the application's id, title, organization, status, the amounts and the questions you want to keep, then export as CSV or XLSX.",
      "To bring the PDFs too, download the applications as a bulk PDF zip.",
    ],
  },
  accepts: ["csv", "xlsx"],
  attachments: { description: "The bulk PDF zip: one PDF per application, matched by the application's id or title.", idPattern: /(?:^|\D)(\d{4,})(?:\D|$)/ },
  signature: {
    strong: ["stage", "submission title", "application title", "stage name"],
    usual: ["status", "applicant", "applicant name", "applicant email", "applicant first name", "applicant last name", "program", "program name", "created", "submitted", "application id", "id", "award amount", "awarded amount", "ranking"],
  },
  presets: {
    award_history: {
      sourceId: ["application id", "submission id", "id"],
      title: ["submission title", "application title", "title", "name"],
      recipientName: ["organization", "organization name", "organisation", "applicant organization", "company"],
      awardedAmount: ["award amount", "awarded amount", "amount awarded", "approved amount", "grant amount"],
      currency: ["currency"],
      status: ["status"],
      programName: ["program", "program name"],
      awardDate: ["award date", "decision date", "date awarded"],
      paidAmount: ["amount paid", "paid amount", "total paid"],
      paidDate: ["date paid", "payment date"],
      startDate: ["start date", "grant start date"],
      endDate: ["end date", "grant end date"],
    },
    history_applications: {
      sourceId: ["application id", "submission id", "id"],
      title: ["submission title", "application title", "title", "name"],
      organizationName: ["organization", "organization name", "organisation", "applicant organization", "company"],
      programName: ["program", "program name"],
      callTitle: ["cycle", "cycle name", "round"],
      submittedDate: ["submitted", "date submitted", "submitted date", "submitted at"],
      outcome: ["status", "decision"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "approved amount", "amount approved", "grant amount"],
      currency: ["currency"],
    },
  },
  // Its status says how complete an application is and its stage says where it is, so only
  // explicit decisions set a row aside.
  decision: { columns: ["status", "stage"], notAwarded: [...COMMON_NOT_AWARDED] },
  sources: ["https://help.surveymonkey.com/en/apply/analyze/data-exports"],
  headersConfirmed: false,
};
