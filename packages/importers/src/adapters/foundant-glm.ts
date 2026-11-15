// SPDX-License-Identifier: AGPL-3.0-only
// Foundant GLM: Export Data and the report builder give a CSV or Excel file per process, with a
// request's id, its organization, the process name and the amounts. "Process Name" and "Amount
// Awarded" are GLM's own headings (a GLM data set export in a public script reads exactly these);
// GLM's older Excel export is .xls, which is never read here: save it as CSV or .xlsx first.
// Payments are their own export in GLM; a file with both the award and the payment columns maps both.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const FOUNDANT_GLM: ImportAdapter = {
  key: "foundant_glm",
  system: "Foundant GLM",
  via: "file",
  steps: [
    "In GLM, use Export Data or a report for one process at a time, with the requests you approved.",
    "Include the request id, organization name, project title, amount awarded and decision date, and the payment columns if you have them.",
    "Save the file as CSV or .xlsx (an older .xls file must be saved again as one of these).",
  ],
  accepts: ["csv", "xlsx"],
  attachments: null,
  signature: {
    strong: ["process name", "process", "request id", "amount awarded", "request name", "amount requested"],
    usual: ["organization name", "project title", "decision date", "decision", "request status", "status", "payment amount", "payment date", "scheduled date", "grant amount", "award date", "project start date", "project end date"],
  },
  presets: {
    award_history: {
      sourceId: ["request id", "grant id"],
      title: ["project title", "request name", "project name", "title"],
      recipientName: ["organization name", "organization", "organisation name", "legal name"],
      recipientEin: ["ein"],
      awardedAmount: ["amount awarded", "awarded amount", "amount approved", "approved amount", "grant amount"],
      currency: ["currency"],
      status: ["request status", "status"],
      programName: ["process name", "process"],
      awardDate: ["decision date", "award date", "approved date"],
      year: ["fiscal year", "grant year"],
      startDate: ["project start date", "grant start date", "start date"],
      endDate: ["project end date", "grant end date", "end date"],
      paidAmount: ["payment amount", "amount paid", "total paid", "paid amount"],
      paidDate: ["payment date", "date paid", "paid date"],
      paymentReference: ["check number", "payment number", "payment reference"],
    },
  },
  decision: { columns: ["decision", "request status", "status"], notAwarded: [...COMMON_NOT_AWARDED, "pending", "submitted"] },
  sources: ["https://foundant.com/products/grant-management-software-for-foundations", "https://gist.github.com/paulgrammer/c09ee39cfaf1e8262348c938f5c89578"],
  headersConfirmed: false,
};
