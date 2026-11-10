// SPDX-License-Identifier: AGPL-3.0-only
// Blind mode and external-reviewer masking (build spec §10.5).

export type ReviewVisibilityMode = "blind" | "see_after_submit" | "open";
export type ViewerRole = "admin" | "program_officer" | "finance" | "reviewer" | "external_reviewer" | "observer" | "auditor";

export interface OtherReviewsQuery {
  mode: ReviewVisibilityMode;
  viewerRole: ViewerRole;
  /** The viewer submitted their own review of this application. */
  viewerHasSubmitted: boolean;
  /** The panel for this stage has opened. */
  panelOpen: boolean;
  /** The viewer is recused or declared a conflict on this application. */
  viewerRecused?: boolean;
  /** The other review's own visibility. */
  reviewVisibility?: "panel" | "funder_only";
}

const REVIEWER_ROLES: readonly ViewerRole[] = ["reviewer", "external_reviewer"];

/** May this viewer see another reviewer's scores? Reviewers cannot see other reviews until the
 *  panel; the funder can enable "see after submit". Staff always can; the recused never can. */
export function canSeeOtherReviews(q: OtherReviewsQuery): boolean {
  if (q.viewerRecused) return false;
  if (!REVIEWER_ROLES.includes(q.viewerRole)) return q.viewerRole !== "finance";
  if (q.reviewVisibility === "funder_only") return false;
  if (q.panelOpen) return true;
  if (q.mode === "open") return true;
  if (q.mode === "see_after_submit") return q.viewerHasSubmitted;
  return false;
}

export interface FieldMeta {
  /** Default true. */
  reviewerVisible?: boolean;
  /** Default false; PII is masked for external reviewers. */
  pii?: boolean;
}

export const MASK = "••••";

export interface MaskResult {
  response: Record<string, unknown>;
  hidden: string[];
  masked: string[];
}

function setPath(obj: Record<string, unknown>, path: string[], fn: (parent: Record<string, unknown>, key: string) => void): boolean {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]!];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    cur = next as Record<string, unknown>;
  }
  const key = path[path.length - 1]!;
  if (!(key in cur)) return false;
  fn(cur, key);
  return true;
}

/** The view of a form response a reviewer may read. Fields with `reviewerVisible: false` are
 *  removed for every reviewer; `pii` fields are masked for external reviewers. `fieldMeta` is keyed
 *  by dotted field path. The input is not modified. */
export function maskForReviewer(response: Record<string, unknown>, fieldMeta: Record<string, FieldMeta>, viewer: { external: boolean }): MaskResult {
  const out = structuredClone(response);
  const hidden: string[] = [];
  const masked: string[] = [];
  for (const [path, meta] of Object.entries(fieldMeta)) {
    const parts = path.split(".");
    if (meta.reviewerVisible === false) {
      if (setPath(out, parts, (p, k) => delete p[k])) hidden.push(path);
    } else if (meta.pii && viewer.external) {
      if (setPath(out, parts, (p, k) => (p[k] = MASK))) masked.push(path);
    }
  }
  return { response: out, hidden, masked };
}

/** External reviewers never see applicant contact details. */
export function maskApplicantContact<T extends { emails?: unknown; phones?: unknown; addresses?: unknown }>(org: T, viewer: { external: boolean }): T {
  if (!viewer.external) return org;
  const { emails: _e, phones: _p, addresses: _a, ...rest } = org;
  return rest as T;
}
