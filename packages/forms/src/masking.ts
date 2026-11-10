// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer view of a response: fields flagged `reviewerVisible: false` are removed for every
// reviewer; fields flagged `pii` are masked for external reviewers.
import { clone, deleteAt, getAt, parsePointer, setAt } from "./pointer.ts";
import type { FieldMeta, FormDefinition, JsonObject } from "./types.ts";
import { collectControls } from "./ui-schema.ts";

export const PII_MASK = "••••••";

/** Field flags by JSON pointer: UI control options overlaid with the form's `fieldMeta`. */
export function fieldMetaFor(form: Pick<FormDefinition, "uiSchema" | "fieldMeta">): Record<string, Required<Pick<FieldMeta, "reviewerVisible" | "pii">>> {
  const out: Record<string, Required<Pick<FieldMeta, "reviewerVisible" | "pii">>> = {};
  for (const c of collectControls(form.uiSchema)) {
    out[c.path] = { reviewerVisible: c.options?.reviewerVisible !== false, pii: c.options?.pii === true };
  }
  for (const [path, meta] of Object.entries(form.fieldMeta ?? {})) {
    const base = out[path] ?? { reviewerVisible: true, pii: false };
    out[path] = { reviewerVisible: meta.reviewerVisible ?? base.reviewerVisible, pii: meta.pii ?? base.pii };
  }
  return out;
}

export interface MaskResult {
  response: JsonObject;
  removed: string[];
  masked: string[];
}

export function maskForReviewer(
  form: Pick<FormDefinition, "uiSchema" | "fieldMeta">,
  response: JsonObject,
  viewer: { external: boolean },
): MaskResult {
  const out = clone(response);
  const removed: string[] = [];
  const masked: string[] = [];
  // Deepest paths first so a parent rule still applies after a child was handled.
  const entries = Object.entries(fieldMetaFor(form)).sort((a, b) => b[0].length - a[0].length);
  for (const [path, meta] of entries) {
    const segs = parsePointer(path);
    if (segs.length === 0 || getAt(out, segs) === undefined) continue;
    if (!meta.reviewerVisible) {
      deleteAt(out, segs);
      removed.push(path);
    } else if (meta.pii && viewer.external) {
      setAt(out, segs, PII_MASK);
      masked.push(path);
    }
  }
  return { response: out, removed: removed.sort(), masked: masked.sort() };
}

export interface OutcomeField {
  /** JSON pointer of the field in a response. */
  path: string;
  /** The field's own name, the last segment of the pointer. */
  key: string;
  label: string;
  unit: string | null;
}

/** The fields a report form marks as outcome metrics (`outcome: true` in `fieldMeta` or the control's options). */
export function outcomeFields(form: Pick<FormDefinition, "uiSchema" | "fieldMeta">): OutcomeField[] {
  const found = new Map<string, OutcomeField>();
  const keyOf = (path: string) => parsePointer(path).at(-1) ?? path;
  const labels = new Map<string, string>();
  for (const c of collectControls(form.uiSchema)) {
    if (c.label) labels.set(c.path, c.label);
    if (c.options?.outcome === true) found.set(c.path, { path: c.path, key: keyOf(c.path), label: c.label ?? keyOf(c.path), unit: typeof c.options.unit === "string" ? c.options.unit : null });
  }
  for (const [path, meta] of Object.entries(form.fieldMeta ?? {})) {
    if (meta.outcome === true) found.set(path, { path, key: keyOf(path), label: labels.get(path) ?? keyOf(path), unit: meta.unit ?? found.get(path)?.unit ?? null });
    else if (meta.outcome === false) found.delete(path);
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}
