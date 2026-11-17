// SPDX-License-Identifier: AGPL-3.0-only
// Zengine (WizeHive, part of Submittable since August 2024): read through its REST API with an
// OAuth access token the funder gets from Zengine, 250 requests per 5 minutes per token. The
// puller (@gms/connectors, pullers.ts) reads the records of one form the person chooses; the
// columns are the record id, its name and the form's own field labels, so the preset matches the
// labels loosely and the person confirms them.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

/** The first two columns of a Zengine pull; the form's field labels follow. */
export const ZENGINE_PULL_COLUMNS = ["Zengine record ID", "Record name"] as const;

export const ZENGINE: ImportAdapter = {
  key: "zengine",
  system: "Zengine",
  via: "api",
  steps: [
    "In Zengine, get an access token for your own account (Zengine's developer settings, or your Zengine administrator).",
    "Here, paste the token and choose the workspace and the form whose records you want. The GMS only reads them, at most 250 requests every 5 minutes, and deletes the token when the import is finished.",
  ],
  accepts: [],
  attachments: null,
  signature: { strong: ["zengine record id"], usual: ["record name"] },
  presets: {
    award_history: {
      sourceId: ["zengine record id"],
      title: ["project title", "grant title", "title", "record name"],
      recipientName: ["organization", "organization name", "organisation", "grantee", "applicant organization"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "approved amount", "grant amount"],
      status: ["status", "decision"],
      awardDate: ["award date", "decision date", "approved date"],
      startDate: ["start date", "grant start date"],
      endDate: ["end date", "grant end date"],
      paidAmount: ["amount paid", "total paid"],
      paidDate: ["date paid", "payment date"],
      programName: ["program", "program name"],
    },
    history_applications: {
      sourceId: ["zengine record id"],
      title: ["project title", "application title", "title", "record name"],
      organizationName: ["organization", "organization name", "organisation", "applicant organization"],
      programName: ["program", "program name"],
      callTitle: ["cycle", "round", "form"],
      submittedDate: ["submitted date", "date submitted", "submitted"],
      outcome: ["status", "decision"],
      requestedAmount: ["amount requested", "requested amount", "request amount", "funding requested"],
      awardedAmount: ["amount awarded", "award amount", "awarded amount", "approved amount", "grant amount"],
    },
    history_reviews: {
      sourceId: ["zengine record id"],
      applicationRef: ["application id", "application record id", "submission id"],
      applicationTitle: ["application title", "project title", "application", "record name"],
      organizationName: ["organization", "organization name"],
      reviewerName: ["reviewer", "reviewer name", "evaluator"],
      totalScore: ["total score", "score"],
      recommendation: ["recommendation"],
      comment: ["comments", "comment"],
      reviewedDate: ["review date", "date reviewed", "completed date"],
    },
    history_reports: {
      sourceId: ["zengine record id"],
      awardRef: ["grant id", "application id", "application record id"],
      awardTitle: ["grant title", "project title"],
      organizationName: ["organization", "organization name"],
      title: ["report title", "report type", "record name", "title"],
      dueDate: ["due date", "report due date"],
      submittedDate: ["submitted date", "date submitted"],
      status: ["status", "report status"],
    },
  },
  decision: { columns: ["status", "decision"], notAwarded: [...COMMON_NOT_AWARDED, "submitted", "pending"] },
  sources: ["https://zenginehq.github.io/developers/rest-api/", "https://zenginehq.github.io/developers/rest-api/auth/", "https://zenginehq.github.io/developers/rest-api/conventions/querying-options/"],
  headersConfirmed: false,
};
