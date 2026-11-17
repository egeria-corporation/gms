// SPDX-License-Identifier: AGPL-3.0-only
// Bonterra CyberGrants: an ad hoc report (Reports → Create Ad Hoc Report, a tabular report on a
// report topic such as requests, payments or impact reports) exports as CSV or Excel, and a
// request's snapshot or PDF version prints the whole request (help.bonterratech.com, CyberGrants
// knowledge base). A request is named by the Request ID CyberGrants assigns; it carries the
// organization, the project title, the proposal type, the grant amount and status, its payments
// and its impact reports (each with a type, a status, the date it became available and the date
// it is due). The help pages name these fields but not every export heading, so the signature and
// presets match loosely and the person confirms each field.
//
// Payment exports can carry the payee's bank fields (the payee's bank account and routing
// columns). They never get past the sensitive screen (../sensitive.ts): their headers and their
// values are dropped before any mapping is made, whatever this adapter says, and no preset names
// one.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const CYBERGRANTS: ImportAdapter = {
  key: "cybergrants",
  system: "Bonterra CyberGrants",
  via: "file",
  steps: [
    "In CyberGrants, open the Reports tab and choose Create Ad Hoc Report, on the requests (or payments) report topic.",
    "Filter to the requests you want (for grant history, the approved ones) and add the Request ID, organization, project title, grant amount, status and payment fields.",
    "Save and run the report, then export it as CSV or Excel. To bring each request's snapshot, save its PDF version and put the files in one zip.",
  ],
  targetSteps: {
    history_applications: [
      "In CyberGrants, open the Reports tab and choose Create Ad Hoc Report, on the requests report topic.",
      "Leave the status filter open so declined and withdrawn requests come too, and add the Request ID, organization, project title, proposal type, requested amount, grant amount, status and the proposal questions you want to keep.",
      "Save and run the report, then export it as CSV or Excel. To bring each request's snapshot, save its PDF version and put the files in one zip.",
    ],
    history_reports: [
      "In CyberGrants, open the Reports tab and choose Create Ad Hoc Report, on the impact reports report topic.",
      "Add the Request ID, the project title, the impact report type, its status and the dates it was due and completed.",
      "Save and run the report, then export it as CSV or Excel. To bring a report's PDF, extract it from the impact report and put the files in one zip.",
    ],
  },
  accepts: ["csv", "xlsx"],
  attachments: { description: "Request snapshots and impact report PDFs you saved, in one zip. Each file is matched by the Request ID (or report id) in its name, or by its title.", idPattern: /(?:^|\D)(\d{4,})(?:\D|$)/ },
  signature: {
    strong: ["request id", "request owner", "proposal type", "grant status", "impact report type", "impact report status", "scan status", "payee name"],
    usual: ["organization name", "project title", "grant amount", "requested amount", "amount requested", "request status", "status", "payment date", "payment amount", "due date", "program", "approved amount"],
  },
  presets: {
    award_history: {
      sourceId: ["request id", "request number", "grant id"],
      title: ["project title", "request title", "project name"],
      recipientName: ["organization name", "organization", "organization legal name", "payee name"],
      awardedAmount: ["grant amount", "approved amount", "amount approved", "amount awarded", "award amount"],
      currency: ["currency", "grant currency"],
      status: ["grant status", "request status", "status"],
      programName: ["program", "program name", "giving program", "proposal type"],
      awardDate: ["approval date", "approved date", "decision date", "date approved"],
      startDate: ["grant start date", "project start date", "start date"],
      endDate: ["grant end date", "project end date", "end date"],
      paidAmount: ["amount paid", "total paid", "payment amount", "paid amount"],
      paidDate: ["payment date", "date paid", "paid date", "check date"],
      paymentReference: ["payment id", "payment number", "check number"],
    },
    history_applications: {
      sourceId: ["request id", "request number"],
      title: ["project title", "request title", "project name"],
      organizationName: ["organization name", "organization", "organization legal name"],
      callTitle: ["proposal type", "request type", "application type"],
      programName: ["program", "program name", "giving program"],
      submittedDate: ["submitted date", "date submitted", "request date", "received date", "date received"],
      outcome: ["grant status", "request status", "status"],
      requestedAmount: ["requested amount", "amount requested", "request amount"],
      awardedAmount: ["grant amount", "approved amount", "amount approved", "amount awarded"],
      currency: ["currency", "grant currency"],
    },
    history_reports: {
      sourceId: ["impact report id", "report id"],
      awardRef: ["request id", "request number"],
      awardTitle: ["project title", "request title"],
      organizationName: ["organization name", "organization"],
      title: ["impact report type", "impact report name", "report type", "impact report"],
      dueDate: ["due date", "impact report due date", "date due"],
      submittedDate: ["completed date", "date completed", "submitted date", "date submitted"],
      status: ["impact report status", "status"],
    },
  },
  decision: { columns: ["grant status", "request status", "status"], notAwarded: [...COMMON_NOT_AWARDED, "pending", "submitted", "in review", "under review", "on hold"] },
  sources: [
    "https://bonterratech.com/pricing/corporate-social-responsibility",
    "https://help.bonterratech.com/cybergrants/articles/Knowledge/360022404614-Create-a-Tabular-Report",
    "https://help.bonterratech.com/cybergrants/articles/Knowledge/360033927354-Request-Record-Overview",
    "https://help.bonterratech.com/cybergrants/articles/Knowledge/360056876293-Print-an-Impact-Report",
  ],
  headersConfirmed: false,
};
