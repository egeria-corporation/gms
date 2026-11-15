// SPDX-License-Identifier: AGPL-3.0-only
// Fluxx: read through the funder's own instance (REST API v2), with an OAuth client the funder
// creates in Fluxx. The puller (@gms/connectors, pullers.ts) reads grant requests, the payments on
// them and the organizations they went to, and gives one row per grant request with the columns
// below, so the preset is exact. Bank details are never asked for: the puller names every column
// it reads, and none of them is a bank or identity field.
import { COMMON_NOT_AWARDED, type ImportAdapter } from "./types.ts";

/** The columns of a Fluxx pull, in order. @gms/connectors writes rows with exactly these names. */
export const FLUXX_PULL_COLUMNS = ["Fluxx ID", "Request ID", "Organization", "Project title", "Amount requested", "Amount awarded", "Granted", "Status", "Approved on", "Grant begins", "Grant ends", "Closed on", "Amount paid", "Last paid on"] as const;

export const FLUXX: ImportAdapter = {
  key: "fluxx",
  system: "Fluxx",
  via: "api",
  steps: [
    "In Fluxx, an administrator opens your instance's /oauth/applications page and creates a new application (name it OpenGrants GMS; the redirect address is your Fluxx address; leave Scopes blank).",
    "Copy the application id and secret it shows, then Authorize it.",
    "Here, paste your Fluxx address and the id and secret. The GMS only reads grant requests, their payments and organizations, and deletes the id and secret when the import is finished.",
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
  },
  decision: { columns: ["granted", "status"], notAwarded: [...COMMON_NOT_AWARDED, "no", "false", "pending", "new", "submitted"] },
  sources: ["https://github.com/RockefellerArchiveCenter/fluxx_exporter", "https://github.com/bruin-data/ingestr/blob/main/pkg/source/fluxx/fluxx.go"],
  headersConfirmed: true,
};
