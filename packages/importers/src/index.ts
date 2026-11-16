// SPDX-License-Identifier: AGPL-3.0-only
// The import framework. Sources yield tables of named columns (./table.ts; XLSX on its own entry,
// `@gms/importers/xlsx`); sensitive columns are dropped first (./sensitive.ts); a target is a typed
// mapping with a validator (./target.ts, ./targets); a dry run gives a plan with a reconciliation
// (./plan.ts). The CSV reader, writer and the v1 column mapper are in ./csv.ts.
export * from "./csv.ts";
export * from "./plan.ts";
export * from "./sensitive.ts";
export * from "./table.ts";
export * from "./target.ts";
export * from "./targets/history.ts";
export * from "./targets/outside.ts";
export * from "./values.ts";

import type { TargetKey } from "./target.ts";
import { HISTORY_TARGET } from "./targets/history.ts";
import { OUTSIDE_TARGET } from "./targets/outside.ts";

/** Every target, by key. */
export const TARGETS = { outside_applications: OUTSIDE_TARGET, award_history: HISTORY_TARGET } as const satisfies Record<TargetKey, unknown>;
