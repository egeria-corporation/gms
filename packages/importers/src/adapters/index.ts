// SPDX-License-Identifier: AGPL-3.0-only
// The importer adapters, one per grants system: six whose export is a file (Good Grants,
// SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple, OpenWater) and two read through their
// API (Fluxx, Zengine). The zip reader is on its own entry, `@gms/importers/zip`.
import type { TargetKey } from "../target.ts";
import { FLUXX } from "./fluxx.ts";
import { FOUNDANT_GLM } from "./foundant-glm.ts";
import { GOOD_GRANTS } from "./good-grants.ts";
import { OPENWATER } from "./openwater.ts";
import { SMARTSIMPLE } from "./smartsimple.ts";
import { SM_APPLY } from "./sm-apply.ts";
import { SUBMITTABLE } from "./submittable.ts";
import { ADAPTER_KEYS, type AdapterKey, type ImportAdapter } from "./types.ts";
import { ZENGINE } from "./zengine.ts";

export * from "./apply.ts";
export * from "./attachments.ts";
export * from "./detect.ts";
export * from "./json.ts";
export * from "./types.ts";
export { FLUXX, FLUXX_PULL_COLUMNS } from "./fluxx.ts";
export { ZENGINE, ZENGINE_PULL_COLUMNS } from "./zengine.ts";
export { FOUNDANT_GLM, GOOD_GRANTS, OPENWATER, SMARTSIMPLE, SM_APPLY, SUBMITTABLE };

export const ADAPTERS: Readonly<Record<AdapterKey, ImportAdapter>> = { good_grants: GOOD_GRANTS, sm_apply: SM_APPLY, submittable: SUBMITTABLE, foundant_glm: FOUNDANT_GLM, smartsimple: SMARTSIMPLE, openwater: OPENWATER, fluxx: FLUXX, zengine: ZENGINE };
/** The systems whose export is a file, in the order the picker lists them. */
export const FILE_ADAPTERS: readonly ImportAdapter[] = [GOOD_GRANTS, SM_APPLY, SUBMITTABLE, FOUNDANT_GLM, SMARTSIMPLE, OPENWATER];

export const isAdapterKey = (v: unknown): v is AdapterKey => typeof v === "string" && (ADAPTER_KEYS as readonly string[]).includes(v);

/** The adapters with a preset for a target (none have one for an applicant's outside applications). */
export const adaptersFor = (target: TargetKey): ImportAdapter[] => Object.values(ADAPTERS).filter((a) => !!a.presets[target]);

/** What the picker shows of an adapter. */
export const adapterView = (a: ImportAdapter) => ({
  key: a.key,
  system: a.system,
  via: a.via,
  steps: [...a.steps],
  accepts: [...a.accepts],
  attachments: a.attachments ? a.attachments.description : null,
  headersConfirmed: a.headersConfirmed,
  sources: [...a.sources],
});
