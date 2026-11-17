// SPDX-License-Identifier: AGPL-3.0-only
// OpenWater: application data exports to Excel, CSV or JSON (and PDFs in a bulk zip). Its
// programs run in rounds, which is what tells its export apart. A JSON export is an array of
// application objects; ./json.ts reads it into the same table a CSV gives.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const OPENWATER: ImportAdapter = {
  key: "openwater",
  system: "OpenWater",
  via: "file",
  steps: [
    "In OpenWater, open the program's applications and filter to the ones you funded.",
    "Export the application data as CSV, Excel (.xlsx) or JSON, with the organization and award amount.",
    "To bring the PDFs too, download them as a bulk zip.",
  ],
  targetSteps: {
    history_applications: [
      "In OpenWater, export the program's application data as CSV, .xlsx or JSON, with every status.",
      "Include the application id, name, organization, round, status, the amounts and the questions you want to keep.",
      "To bring the PDFs too, download the bulk PDF zip.",
    ],
    history_reviews: [
      "In OpenWater, export the judging (review) data of the round as CSV, .xlsx or JSON, with each application's id, the judge, the scores and the comments.",
      "Import your applications first, so each review finds its application by its id.",
    ],
  },
  accepts: ["csv", "xlsx", "json"],
  attachments: { description: "The bulk PDF zip: one PDF per application, matched by the application's id or name.", idPattern: /(?:^|\D)(\d{4,})(?:\D|$)/ },
  signature: {
    strong: ["round", "round name", "program name", "application id", "applicationid", "roundname", "programname"],
    usual: ["name", "application name", "status", "category", "applicant first name", "applicant last name", "applicant email", "date submitted", "finalized", "award amount", "organization", "judge", "score"],
  },
  presets: {
    award_history: {
      sourceId: ["application id", "applicationid", "id"],
      title: ["application name", "name", "title"],
      recipientName: ["organization", "organization name", "organisation", "company", "company name"],
      awardedAmount: ["award amount", "awardamount", "awarded amount", "amount awarded", "grant amount"],
      currency: ["currency"],
      status: ["status"],
      programName: ["program name", "programname", "program", "round name", "roundname", "round"],
      awardDate: ["award date", "decision date"],
      startDate: ["start date", "grant start date"],
      endDate: ["end date", "grant end date"],
      paidAmount: ["amount paid", "paid amount"],
      paidDate: ["date paid", "payment date"],
    },
    history_applications: {
      sourceId: ["application id", "applicationid", "id"],
      title: ["application name", "name", "title"],
      organizationName: ["organization", "organization name", "organisation", "company", "company name"],
      programName: ["program name", "programname", "program"],
      callTitle: ["round name", "roundname", "round"],
      submittedDate: ["submitted date", "date submitted", "submitteddate", "submitted"],
      outcome: ["status", "decision"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["award amount", "awardamount", "awarded amount", "amount awarded", "grant amount"],
      currency: ["currency"],
    },
    history_reviews: {
      sourceId: ["review id", "reviewid", "evaluation id"],
      applicationRef: ["application id", "applicationid"],
      applicationTitle: ["application name", "applicationname", "application title"],
      organizationName: ["organization", "organization name", "company"],
      reviewerName: ["judge", "judge name", "judgename", "reviewer", "reviewer name", "evaluator"],
      totalScore: ["total score", "totalscore", "overall score", "score"],
      recommendation: ["recommendation"],
      comment: ["comments", "comment", "judge comments"],
      reviewedDate: ["completed date", "date completed", "review date"],
    },
  },
  decision: { columns: ["status"], notAwarded: [...COMMON_NOT_AWARDED] },
  sources: ["https://help.getopenwater.com/en/articles/3110614-openwater-rest-api"],
  headersConfirmed: false,
};
