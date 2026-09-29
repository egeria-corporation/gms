// SPDX-License-Identifier: AGPL-3.0-or-later
// Serializable props shared by the opportunity editor (C-04) and publish (C-05) screens.

export const APPLICANT_TYPES = [
  { value: 'nonprofit_501c3', label: '501(c)(3) nonprofit' },
  { value: 'fiscally_sponsored', label: 'Fiscally sponsored project' },
  { value: 'nonprofit_other', label: 'Other nonprofit' },
  { value: 'government', label: 'Government agency' },
  { value: 'tribal', label: 'Tribal government or organization' },
  { value: 'school', label: 'School or school district' },
  { value: 'for_profit', label: 'For-profit business' },
  { value: 'individual', label: 'Individual' },
] as const;

export type TermKind = 'cause' | 'geography' | 'population';

export interface TaxonomyTerm {
  kind: TermKind;
  code: string;
  label: string;
}

/** Everything the Details tab edits. Dates are wall-clock "YYYY-MM-DDTHH:mm" in the workspace timezone. */
export interface OpportunityDetails {
  title: string;
  summary: string;
  descriptionMd: string;
  eligibilityMd: string;
  guidelinesMd: string;
  faq: { q: string; a: string }[];
  /** Dollars as typed (converted to cents on save). */
  fundingTotal: string;
  awardMin: string;
  awardMax: string;
  expectedAwardCount: string;
  applicantTypes: string[];
  causeTerms: string[];
  geographyTerms: string[];
  populationTerms: string[];
  programId: string | null;
  contactEmail: string;
  visibility: 'public' | 'unlisted';
  decisionExpectedOn: string;
  forecastAt: string;
  opensAt: string;
  closesAt: string;
}

export type RuleKind = 'yes_no' | 'number_max' | 'number_min' | 'select_in' | 'multi_any';

export interface EligibilityRuleView {
  question: string;
  helpText: string;
  kind: RuleKind;
  config: Record<string, unknown>;
  knockoutMessage: string;
}

export interface StageFormView {
  formId: string;
  formName: string;
  versionId: string | null;
  version: number | null;
  versionStatus: string | null;
  /** The form's newest published version (to show when the pinned one is behind). */
  currentVersion: number | null;
}

export interface StageView {
  id: string;
  name: string;
  description: string;
  order: number;
  access: 'public' | 'invite';
  status: string;
  opensAt: string;
  closesAt: string;
  opensAtIso: string | null;
  closesAtIso: string | null;
  graceMinutes: number;
  submissionCap: number | null;
  perOrgLimit: number;
  allowExtensions: boolean;
  forms: StageFormView[];
}

export interface PublishableForm {
  id: string;
  name: string;
  kind: string;
  version: number;
}

export interface Distribution {
  site: boolean;
  embed: boolean;
  cgFeed: boolean;
  openGrants: boolean;
}
