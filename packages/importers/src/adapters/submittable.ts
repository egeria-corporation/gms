// SPDX-License-Identifier: AGPL-3.0-only
// Submittable (classic and Next): the submission list exports Submission Data as a CSV, Submission
// PDFs as a zip of folders holding one PDF per submission, and Submission Files as a zip of each
// submission's uploaded files with its PDF (submittable.help article 904906, Next: Downloads page).
// The help pages describe the three downloads but not every column heading, so the signature and
// preset match loosely; the submitter columns and the category (Submittable's form or project)
// are what tell its export apart.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

export const SUBMITTABLE: ImportAdapter = {
  key: "submittable",
  system: "Submittable",
  via: "file",
  steps: [
    "In Submittable, open Submissions and filter to the submissions you want (for grant history, the ones you funded), or select them.",
    "Choose the gear icon, then Export Data, then Export Submissions, and download Submission Data (.csv).",
    "To bring the PDFs and files too, download Submission PDFs (.zip) or Submission Files (.zip) from the same place.",
  ],
  targetSteps: {
    history_applications: [
      "In Submittable, open Submissions and leave the status filter open (or select the submissions you want), so declined submissions come too.",
      "Choose the gear icon, then Export Data, then Export Submissions, and download Submission Data (.csv). Its form answers come as columns.",
      "To bring the PDFs and files too, download Submission PDFs (.zip) or Submission Files (.zip) from the same place.",
    ],
    history_reviews: [
      "In Submittable, open Reports and build a report with your review form's data, or on a submission open the Reviews tab and download all reviews as .csv.",
      "Keep the Submission ID column: each review finds its submission by it. Import your submissions first.",
    ],
  },
  accepts: ["csv", "xlsx"],
  attachments: { description: "Submission PDFs (.zip) or Submission Files (.zip): one folder per submission. Each file is matched to its submission by the submission's id or title.", idPattern: /(?:^|\D)(\d{5,})(?:\D|$)/ },
  signature: {
    strong: ["submitter first name", "submitter last name", "submitter email", "submitter name", "submission id", "submission title", "date submitted", "submitted date", "labels"],
    usual: ["title", "category", "project", "project name", "status", "assigned to", "average rating", "votes", "last activity", "organization", "amount awarded", "award amount"],
  },
  presets: {
    award_history: {
      sourceId: ["submission id", "submission number", "id"],
      title: ["submission title", "title", "project title"],
      recipientName: ["organization", "organization name", "organisation", "submitter organization", "applicant organization", "company"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "fund amount", "funds awarded", "total awarded", "amount distributed"],
      currency: ["currency"],
      status: ["status", "submission status"],
      programName: ["category", "project", "project name", "form name"],
      awardDate: ["decision date", "date accepted", "accepted date", "date awarded"],
      paidAmount: ["amount paid", "total paid", "paid amount"],
      paidDate: ["date paid", "payment date", "paid date"],
      startDate: ["grant start date", "project start date"],
      endDate: ["grant end date", "project end date"],
    },
    history_applications: {
      sourceId: ["submission id", "submission number", "id"],
      title: ["submission title", "title", "project title"],
      organizationName: ["organization", "organization name", "organisation", "submitter organization", "applicant organization", "company"],
      callTitle: ["category", "project", "project name", "form name"],
      submittedDate: ["date submitted", "submitted date", "submitted", "submission date"],
      outcome: ["status", "submission status"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "fund amount", "funds awarded", "total awarded"],
      currency: ["currency"],
    },
    history_reviews: {
      sourceId: ["review id"],
      applicationRef: ["submission id", "submission number"],
      applicationTitle: ["submission title", "title"],
      organizationName: ["organization", "organization name", "organisation", "organisation name", "applicant organization", "company"],
      reviewerName: ["reviewer", "reviewer name", "reviewed by", "assigned to"],
      totalScore: ["total score", "score", "total"],
      recommendation: ["recommendation", "vote"],
      comment: ["comments", "comment", "review notes", "notes"],
      reviewedDate: ["date completed", "completed date", "review date", "date reviewed"],
    },
  },
  decision: { columns: ["status", "submission status"], notAwarded: [...COMMON_NOT_AWARDED, "new", "in review", "under review", "submitted"] },
  sources: ["https://submittable.help/en/articles/904906", "https://next.support.submittable.com/hc/en-us/articles/36503809146903", "https://submittable.help/en/articles/3341187-automated-scoring-for-forms", "https://intercom.help/self-guided-implementation/en/articles/8295921-exporting-data-from-your-account"],
  headersConfirmed: false,
};
