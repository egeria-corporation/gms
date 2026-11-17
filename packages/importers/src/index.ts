// SPDX-License-Identifier: AGPL-3.0-only
// The import framework. Sources yield tables of named columns (./table.ts; XLSX on its own entry,
// `@gms/importers/xlsx`); sensitive columns are dropped first (./sensitive.ts); a target is a typed
// mapping with a validator (./target.ts, ./targets); a dry run gives a plan with a reconciliation
// (./plan.ts). The CSV reader, writer and the v1 column mapper are in ./csv.ts. Importer adapters,
// one per grants system, are in ./adapters (the zip reader on its own entry, `@gms/importers/zip`).
export * from "./adapters/index.ts";
export * from "./csv.ts";
export * from "./plan.ts";
export * from "./sensitive.ts";
export * from "./sources/salesforce.ts";
export * from "./table.ts";
export * from "./target.ts";
export * from "./targets/history.ts";
export * from "./targets/outside.ts";
export * from "./targets/past-applications.ts";
export * from "./targets/past-common.ts";
export * from "./targets/past-reports.ts";
export * from "./targets/past-reviews.ts";
export * from "./values.ts";

import type { TargetKey } from "./target.ts";
import { HISTORY_TARGET } from "./targets/history.ts";
import { OUTSIDE_TARGET } from "./targets/outside.ts";
import { PAST_APPLICATIONS_TARGET } from "./targets/past-applications.ts";
import { PAST_REPORTS_TARGET } from "./targets/past-reports.ts";
import { PAST_REVIEWS_TARGET } from "./targets/past-reviews.ts";

/** Every target, by key. */
export const TARGETS = {
  outside_applications: OUTSIDE_TARGET,
  award_history: HISTORY_TARGET,
  // Imported history (v1.12.0): a funder's past applications, reviews and reports, read-only.
  history_applications: PAST_APPLICATIONS_TARGET,
  history_reviews: PAST_REVIEWS_TARGET,
  history_reports: PAST_REPORTS_TARGET,
} as const satisfies Record<TargetKey, unknown>;
