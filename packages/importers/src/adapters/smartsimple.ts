// SPDX-License-Identifier: AGPL-3.0-only
// SmartSimple (part of Foundant): any list view exports to Excel or CSV. Applications are level 1
// records; reviews and payments are level 2 records under them, each its own list. A list's columns
// are the ones the funder put on it, so only SmartSimple's standard names (tracking or reference
// id, owner, the organization as "Company" or "Client", level labels) tell it apart; the person
// confirms every field.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const SMARTSIMPLE: ImportAdapter = {
  key: "smartsimple",
  system: "SmartSimple",
  via: "file",
  steps: [
    "In SmartSimple, open the list view of your applications (level 1) and filter to the ones you funded.",
    "Add the organization, the approved amount and the dates to the list, then export it to CSV or Excel (.xlsx).",
    "Payments are level 2 records: export their list too if you want what was paid, and import it after the applications.",
  ],
  targetSteps: {
    history_applications: [
      "In SmartSimple, open the list view of your applications (level 1) with every status, and export it to CSV or Excel.",
      "Add the tracking id, application name, organization, type, status, the amounts and the questions you want to keep.",
    ],
    history_reviews: [
      "In SmartSimple, open the list view of the reviews (the level 2 records under each application) and export it to CSV or Excel.",
      "Keep the application's tracking id on each review: each review finds its application by it. Import your applications first.",
    ],
  },
  accepts: ["csv", "xlsx"],
  attachments: null,
  signature: {
    strong: ["tracking id", "tracking number", "level 1", "level 2", "uta", "smartsimple id"],
    usual: ["reference number", "client", "customer", "company name", "name", "application name", "status", "type", "owner", "company", "start date", "end date", "requested amount", "approved amount", "amount approved", "description"],
  },
  presets: {
    award_history: {
      sourceId: ["tracking id", "tracking number", "reference number", "smartsimple id", "application id", "id"],
      title: ["application name", "name", "project title", "title"],
      recipientName: ["company", "company name", "organization", "organization name", "client", "customer"],
      awardedAmount: ["approved amount", "amount approved", "awarded amount", "amount awarded", "grant amount"],
      currency: ["currency"],
      status: ["status"],
      programName: ["type", "program", "funding program"],
      awardDate: ["approval date", "approved date", "decision date"],
      startDate: ["start date", "grant start date"],
      endDate: ["end date", "grant end date"],
      paidAmount: ["amount paid", "paid amount", "payment amount"],
      paidDate: ["payment date", "date paid"],
      description: ["description"],
    },
    history_applications: {
      sourceId: ["tracking id", "tracking number", "reference number", "smartsimple id", "application id", "id"],
      title: ["application name", "name", "project title", "title"],
      organizationName: ["company", "company name", "organization", "organization name", "client"],
      programName: ["program", "funding program"],
      callTitle: ["type", "round", "template"],
      submittedDate: ["submitted date", "submission date", "date submitted"],
      outcome: ["status", "decision"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "approved amount", "amount approved", "grant amount"],
      currency: ["currency"],
    },
    history_reviews: {
      sourceId: ["review id", "level 2 tracking id", "tracking id"],
      applicationRef: ["parent tracking id", "application tracking id", "level 1 tracking id", "parent id", "application id"],
      applicationTitle: ["application name", "parent name", "name"],
      organizationName: ["company", "company name", "organization", "organization name"],
      reviewerName: ["reviewer", "reviewer name", "owner", "assigned to"],
      totalScore: ["total score", "overall score", "score"],
      recommendation: ["recommendation", "decision"],
      comment: ["comments", "comment", "reviewer comments"],
      reviewedDate: ["completed date", "review date", "date completed"],
    },
  },
  decision: { columns: ["status"], notAwarded: [...COMMON_NOT_AWARDED, "submitted", "under review", "in review"] },
  sources: ["https://wiki.smartsimple.com/wiki/SmartConnect_-_RESTful_API"],
  headersConfirmed: false,
};
