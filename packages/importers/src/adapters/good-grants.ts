// SPDX-License-Identifier: AGPL-3.0-only
// Good Grants: the Manage applications list exports to CSV or Excel (applications, reviews, file
// metadata, contracts), and a zip holds the PDFs of up to 100 applications per download (its links
// expire after 48 hours). An application is named by an eight-letter slug, which its API also uses;
// the decision lives in its moderation status (approved, undecided, rejected) and its grant status
// (names each funder sets). The public pages name these concepts but not the export's column
// headings, so the signature and preset match loosely.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const GOOD_GRANTS: ImportAdapter = {
  key: "good_grants",
  system: "Good Grants",
  via: "file",
  steps: [
    "In Good Grants, open Manage applications and filter to the applications you want (for grant history, the approved ones).",
    "Export the list as CSV or Excel, with the grant status, grant dates and amount columns.",
    "To bring the PDFs too, download the applications as a zip (up to 100 at a time; the link expires after 48 hours).",
  ],
  targetSteps: {
    history_applications: [
      "In Good Grants, open Manage applications and leave the moderation filter open, so declined applications come too.",
      "Export the list as CSV or Excel, with the moderation and grant status, the amounts and the questions you want to keep.",
      "To bring the PDFs too, download the applications as a zip (up to 100 at a time; the link expires after 48 hours).",
    ],
    history_reviews: [
      "In Good Grants, export the reviews (scores) of your applications as CSV or Excel, with each application's slug, the reviewer, the scores and the comments.",
      "Import your applications first, so each review finds its application by its slug.",
    ],
  },
  accepts: ["csv", "xlsx"],
  attachments: { description: "The zip of application PDFs (up to 100 per download). Each PDF is matched to its application by the application's slug or title.", idPattern: /(?:^|[^A-Za-z])([A-Za-z]{8})(?:[^A-Za-z]|$)/ },
  signature: {
    strong: ["chapter", "moderation", "moderation status", "grant status", "season", "application slug", "slug"],
    usual: ["title", "applicant", "applicant name", "applicant email", "category", "status", "tags", "grant start date", "grant end date", "created", "submitted", "local id"],
  },
  presets: {
    award_history: {
      sourceId: ["application slug", "slug", "local id", "application id", "id"],
      title: ["title", "application title", "application name", "project title"],
      recipientName: ["organisation", "organization", "organisation name", "organization name", "applicant organisation", "applicant organization", "company"],
      awardedAmount: ["grant amount", "amount awarded", "awarded amount", "approved amount", "amount approved", "funding amount", "award amount"],
      currency: ["currency", "grant currency"],
      startDate: ["grant start date", "grant start"],
      endDate: ["grant end date", "grant end"],
      status: ["grant status"],
      programName: ["category", "chapter"],
      awardDate: ["approved date", "decision date", "grant approved"],
      paidAmount: ["amount paid", "paid amount", "total paid"],
      paidDate: ["date paid", "payment date"],
      description: ["summary", "project summary", "description"],
    },
    history_applications: {
      sourceId: ["application slug", "slug", "local id", "application id"],
      title: ["title", "application title", "application name", "project title"],
      organizationName: ["organisation", "organization", "organisation name", "organization name", "applicant organisation", "applicant organization", "company"],
      callTitle: ["category", "chapter", "season"],
      submittedDate: ["submitted", "submitted date", "date submitted"],
      outcome: ["moderation status", "moderation", "grant status", "status"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["grant amount", "amount awarded", "awarded amount", "approved amount"],
      currency: ["currency", "grant currency"],
    },
    history_reviews: {
      applicationRef: ["application slug", "slug", "local id", "application id"],
      applicationTitle: ["application title", "application", "title"],
      organizationName: ["organization", "organization name", "organisation", "organisation name", "applicant organization", "company"],
      reviewerName: ["judge", "judge name", "reviewer", "reviewer name", "assessor"],
      totalScore: ["total score", "total", "weighted score", "score"],
      recommendation: ["recommendation", "decision"],
      comment: ["comment", "comments", "feedback"],
      reviewedDate: ["completed", "date completed", "scored at", "review date"],
    },
  },
  decision: { columns: ["moderation", "moderation status", "status"], notAwarded: [...COMMON_NOT_AWARDED, "undecided", "resubmission required"] },
  sources: ["https://goodgrants.com/pricing", "https://docs.goodgrants.com/api-reference"],
  headersConfirmed: false,
};
