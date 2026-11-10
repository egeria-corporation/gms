// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer view of a response: fields flagged `reviewerVisible: false` are removed for every
// reviewer; fields flagged `pii` are masked for external reviewers.
import { clone, deleteAt, getAt, parsePointer, setAt } from "./pointer.ts";
import type { FieldMeta, FormDefinition, JsonObject } from "./types.ts";
import { collectControls } from "./ui-schema.ts";

export const PII_MASK = "••••••";

/** Field flags by JSON pointer: UI control options overlaid with the form's `fieldMeta`. */
export function fieldMetaFor(form: Pick<FormDefinition, "uiSchema" | "fieldMeta">): Record<string, Required<FieldMeta>> {
  const out: Record<string, Required<FieldMeta>> = {};
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
