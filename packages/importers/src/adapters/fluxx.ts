// SPDX-License-Identifier: AGPL-3.0-only
// Fluxx: read through the funder's own instance (REST API v2), with an OAuth client the funder
// creates in Fluxx. The puller (@gms/connectors, pullers.ts) reads grant requests, the payments on
// them and the organizations they went to, and gives one row per grant request with the columns
// below, so the preset is exact; for past reports it reads request_report, one row per report with
// its grant request's Fluxx id, title and organization. Bank details are never asked for: the
// puller names every column it reads, and none of them is a bank or identity field.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

/** The columns of a Fluxx pull, in order. @gms/connectors writes rows with exactly these names. */
export const FLUXX_PULL_COLUMNS = ["Fluxx ID", "Request ID", "Organization", "Project title", "Amount requested", "Amount awarded", "Granted", "Status", "Approved on", "Grant begins", "Grant ends", "Closed on", "Amount paid", "Last paid on"] as const;
/** The columns of a Fluxx report pull (request_report), in order, as @gms/connectors writes them. */
export const FLUXX_REPORT_PULL_COLUMNS = ["Report Fluxx ID", "Grant Fluxx ID", "Organization", "Project title", "Report type", "Due on", "Approved on", "Status"] as const;

export const FLUXX: ImportAdapter = {
  key: "fluxx",
  system: "Fluxx",
  via: "api",
  steps: [
    "In Fluxx, an administrator opens your instance's /oauth/applications page and creates a new application (name it OpenGrants GMS; the redirect address is your Fluxx address; leave Scopes blank).",
    "Copy the application id and secret it shows, then Authorize it.",
    "Here, paste your Fluxx address and the id and secret. The GMS only reads grant requests, their payments, their reports and organizations, and deletes the id and secret when the import is finished.",
  ],
  accepts: [],
  attachments: null,
  signature: { strong: ["fluxx id"], usual: ["request id", "project title", "amount awarded", "granted"] },
  presets: {
    award_history: {
      sourceId: ["fluxx id"],
      title: ["project title"],
      recipientName: ["organization"],
      awardedAmount: ["amount awarded"],
      status: ["status"],
      awardDate: ["approved on"],
      startDate: ["grant begins"],
      endDate: ["grant ends"],
      paidAmount: ["amount paid"],
      paidDate: ["last paid on"],
    },
    history_applications: {
      sourceId: ["fluxx id"],
      title: ["project title"],
      organizationName: ["organization"],
      outcome: ["status"],
      requestedAmount: ["amount requested"],
      awardedAmount: ["amount awarded"],
    },
    // Past reports (request_report): linked to the grant a grant history pull brought by its Fluxx id.
    history_reports: {
      sourceId: ["report fluxx id"],
      awardRef: ["grant fluxx id"],
      awardTitle: ["project title"],
      organizationName: ["organization"],
      title: ["report type"],
      dueDate: ["due on"],
      status: ["status"],
    },
  },
  decision: { columns: ["granted", "status"], notAwarded: [...COMMON_NOT_AWARDED, "no", "false", "pending", "new", "submitted"] },
  sources: ["https://github.com/RockefellerArchiveCenter/fluxx_exporter", "https://github.com/bruin-data/ingestr/blob/main/pkg/source/fluxx/fluxx.go"],
  headersConfirmed: true,
};
