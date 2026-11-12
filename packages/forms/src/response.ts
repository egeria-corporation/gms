// SPDX-License-Identifier: AGPL-3.0-only
// Form response helpers: merge semantics for `PUT …/forms/{formId}` and status computation.
import { clone, deepEqual, formatPointer, getAt, isAtOrUnder, isPlainObject, parsePointer, setAt, deleteAt } from "./pointer.ts";
import { isPrefillSource, type FormDefinition, type Json, type JsonObject, type Provenance, type ProvenanceSource, type ResponseStatus } from "./types.ts";
import { validateResponse } from "./validate.ts";

/** Deep merge: objects merge key by key, arrays and scalars replace, `null` removes the key. */
export function deepMerge(current: JsonObject, patch: JsonObject): JsonObject {
  const out = clone(current);
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (v === null) delete out[k];
    else if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k] as JsonObject, v);
    else out[k] = clone(v);
  }
  return out;
}

function patchLeaves(patch: JsonObject, current: unknown, segs: string[], out: { path: string; value: Json }[]): void {
  for (const [k, v] of Object.entries(patch)) {
    const cur = isPlainObject(current) ? current[k] : undefined;
    if (isPlainObject(v) && isPlainObject(cur)) patchLeaves(v, cur, [...segs, k], out);
    else out.push({ path: formatPointer([...segs, k]), value: v });
  }
}

export interface MergeOptions {
  provenance?: Provenance | null;
  /** Who is writing: "user" (default) or `agent:<client>`. */
  actor?: ProvenanceSource;
  /** Read-only paths (see `passportFieldPaths`); writes at or under them are rejected. */
  lockedPaths?: readonly string[];
}
export interface MergeResult {
  response: JsonObject;
  provenance: Provenance;
  changed: string[];
  rejected: string[];
}

/**
 * Applies a partial update to a response. Changed fields take the actor's provenance (replacing
 * "passport" on the field or on the prefilled object that contains it); locked paths are untouched.
 */
export function mergeResponse(current: JsonObject | null | undefined, patch: JsonObject, opts: MergeOptions = {}): MergeResult {
  const base = clone(current ?? {});
  const provenance: Provenance = { ...(opts.provenance ?? {}) };
  const actor = opts.actor ?? "user";
  const leaves: { path: string; value: Json }[] = [];
  patchLeaves(patch, base, [], leaves);
  const response = clone(base);
  const changed: string[] = [];
  const rejected: string[] = [];
  for (const leaf of leaves) {
    const segs = parsePointer(leaf.path);
    const locked = (opts.lockedPaths ?? []).some((l) => isAtOrUnder(leaf.path, l) || isAtOrUnder(l, leaf.path));
    if (locked) {
      rejected.push(leaf.path);
      continue;
    }
    const before = getAt(base, segs);
    if (leaf.value === null) {
      if (before === undefined) continue;
      deleteAt(response, segs);
    } else {
      if (deepEqual(before, leaf.value)) continue;
      setAt(response, segs, clone(leaf.value));
    }
    changed.push(leaf.path);
    for (const p of Object.keys(provenance)) if (p !== leaf.path && isAtOrUnder(p, leaf.path)) delete provenance[p];
    const owner = Object.keys(provenance).find((p) => p !== leaf.path && isAtOrUnder(leaf.path, p));
    provenance[owner ?? leaf.path] = actor;
  }
  return { response, provenance, changed, rejected };
}

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.every(isEmptyValue);
  if (isPlainObject(v)) return Object.values(v).every(isEmptyValue);
  return false;
}

/**
 * `complete` when the response validates; `notStarted` when nothing has been entered beyond
 * Passport prefill; otherwise `inProgress`.
 */
export function computeResponseStatus(
  form: Pick<FormDefinition, "jsonSchema" | "uiSchema">,
  response: JsonObject | null | undefined,
  provenance?: Provenance | null,
): ResponseStatus {
  const data = response ?? {};
  if (validateResponse(form, data).valid) return "complete";
  if (isEmptyValue(data)) return "notStarted";
  if (provenance) {
    const sources = Object.values(provenance);
    if (sources.length > 0 && sources.every(isPrefillSource)) {
      const scratch = clone(data);
      for (const p of Object.keys(provenance)) deleteAt(scratch, parsePointer(p));
      if (isEmptyValue(scratch)) return "notStarted";
    }
  }
  return "inProgress";
}
