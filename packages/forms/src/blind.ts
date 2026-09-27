// SPDX-License-Identifier: AGPL-3.0-only
// Blind review: which answers a reviewer on a blind stage must not see. The same rule is enforced in the
// database by gms.reviewer_submission (migration 1700), which removes these keys and hides attachment names;
// the renderer uses this to label them "Hidden for blind review" instead of "Not answered".
import { CG_PATHS } from './cg';
import type { FieldMeta } from './compile';

/** Field types whose answers identify a person or organization, whatever the form author chose. */
export const IDENTIFYING_FIELD_TYPES = ['name', 'address', 'email', 'phone', 'ein', 'uei', 'attestation'] as const;

/** CommonGrants paths whose values identify the applicant (tax ids included: they resolve to a name in public data). */
export const IDENTIFYING_CG_PATHS: readonly string[] = [...new Set([...CG_PATHS.filter((p) => p.identifying).map((p) => p.path), 'organization.ein', 'organization.uei'])];

/** True when a blind reviewer must not see this answer. */
export function hiddenInBlindReview(meta: Pick<FieldMeta, 'type' | 'blind' | 'cgMapping'>): boolean {
  if (meta.blind) return true;
  if ((IDENTIFYING_FIELD_TYPES as readonly string[]).includes(meta.type)) return true;
  return Boolean(meta.cgMapping && IDENTIFYING_CG_PATHS.includes(meta.cgMapping));
}
