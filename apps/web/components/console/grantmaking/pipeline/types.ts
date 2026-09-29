// SPDX-License-Identifier: AGPL-3.0-or-later
// Serializable shapes passed from the pipeline page (Server Component) to its client components.

/** Statuses shown as columns on the pipeline board (in_progress and withdrawn are left off). */
export const BOARD_STATUSES = ['submitted', 'under_review', 'invited_to_next_stage', 'awarded', 'declined', 'ineligible'] as const;

export type DuplicateReason = 'same_org_same_stage' | 'same_ein' | 'similar_title';

export const DUPLICATE_REASON_LABEL: Record<string, string> = {
  same_org_same_stage: 'same organization & stage',
  same_ein: 'same EIN',
  similar_title: 'similar title',
};

export interface PossibleDuplicate {
  otherId: string;
  otherReference: string;
  reason: string;
}

export interface PipelineRow {
  id: string;
  reference: string;
  title: string;
  orgName: string | null;
  opportunityId: string;
  opportunityTitle: string;
  competitionId: string;
  stageName: string;
  status: string;
  requestedCents: number | null;
  currency: string;
  submittedAt: string | null;
  /** Pre-formatted in the workspace timezone. */
  submittedLabel: string;
  assigned: number;
  reviewsDone: number;
  avgScore: number | null;
  tags: string[];
  viaAgent: boolean;
  duplicateOf: { id: string; reference: string } | null;
  possibleDuplicates: PossibleDuplicate[];
}

export interface ReviewStageOption {
  id: string;
  name: string;
  competitionId: string;
  status: string;
  reviewersPerApplication: number;
}

export interface InviteStageOption {
  id: string;
  name: string;
  opportunityId: string;
  status: string;
}

export interface PersonOption {
  id: string;
  name: string;
  role: string;
}

export interface Option {
  value: string;
  label: string;
  /** For stage options: the opportunity they belong to. */
  parent?: string | null;
}
