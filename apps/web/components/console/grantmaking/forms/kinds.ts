// SPDX-License-Identifier: AGPL-3.0-only
// Form kinds (forms.kind) with display labels.

export type FormKind = 'application' | 'loi' | 'report' | 'eligibility' | 'other';

export const FORM_KINDS: { value: FormKind; label: string }[] = [
  { value: 'application', label: 'Application' },
  { value: 'loi', label: 'Letter of inquiry' },
  { value: 'report', label: 'Grantee report' },
  { value: 'eligibility', label: 'Eligibility' },
  { value: 'other', label: 'Other' },
];

export function kindLabel(k: string): string {
  return FORM_KINDS.find((x) => x.value === k)?.label ?? k;
}
