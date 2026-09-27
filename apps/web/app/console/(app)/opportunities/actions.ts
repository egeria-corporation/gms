// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// C-03…C-05 opportunities: details, eligibility, stages & forms, distribution, duplicate, publish, status
// changes and invitations to invite-only stages. Every mutation runs through act() (executor, RLS, audit).
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh(id?: string) {
  revalidatePath('/console/opportunities');
  if (id) {
    revalidatePath(`/console/opportunities/${id}`);
    revalidatePath(`/console/opportunities/${id}/publish`);
  }
}

export interface OpportunityInput {
  programId?: string | null;
  title?: string;
  summary?: string | null;
  descriptionMd?: string | null;
  eligibilityMd?: string | null;
  guidelinesMd?: string | null;
  faq?: { q: string; a: string }[];
  fundingTotalCents?: number | null;
  awardMinCents?: number | null;
  awardMaxCents?: number | null;
  expectedAwardCount?: number | null;
  applicantTypes?: string[];
  causeTerms?: string[];
  geographyTerms?: string[];
  populationTerms?: string[];
  forecastAt?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  decisionExpectedOn?: string | null;
  contactEmail?: string | null;
  visibility?: 'public' | 'unlisted';
  distribution?: { site: boolean; embed: boolean; cgFeed: boolean; openGrants: boolean };
}

export async function createOpportunityAction(input: OpportunityInput & { title: string }) {
  const r = await act<{ id: string; slug: string; competitionId: string }>('opportunities.create', input);
  refresh();
  return r;
}

export async function updateOpportunityAction(opportunityId: string, input: OpportunityInput) {
  const r = await act('opportunities.update', { ...input, opportunityId });
  refresh(opportunityId);
  return r;
}

export interface EligibilityRuleInput {
  question: string;
  helpText: string | null;
  kind: 'yes_no' | 'number_max' | 'number_min' | 'select_in' | 'multi_any';
  config: Record<string, unknown>;
  knockoutMessage: string;
}

export async function setEligibilityAction(opportunityId: string, rules: EligibilityRuleInput[]) {
  const r = await act('opportunities.set_eligibility', { opportunityId, rules });
  refresh(opportunityId);
  return r;
}

export async function duplicateOpportunityAction(opportunityId: string, title: string) {
  const r = await act<{ id: string; slug: string }>('opportunities.duplicate', { opportunityId, title });
  refresh();
  return r;
}

export async function publishOpportunityAction(opportunityId: string) {
  const r = await act<{ status: 'forecasted' | 'open' }>('opportunities.publish', { opportunityId });
  refresh(opportunityId);
  return r;
}

export async function setOpportunityStatusAction(opportunityId: string, status: 'draft' | 'forecasted' | 'open' | 'closed' | 'archived', reason?: string) {
  const r = await act('opportunities.set_status', { opportunityId, status, ...(reason?.trim() ? { reason: reason.trim() } : {}) });
  refresh(opportunityId);
  return r;
}

export interface StageInput {
  name: string;
  description: string | null;
  access: 'public' | 'invite';
  opensAt: string | null;
  closesAt: string | null;
  graceMinutes: number;
  submissionCap: number | null;
  perOrgLimit: number;
  allowExtensions: boolean;
}

export async function createStageAction(opportunityId: string, input: StageInput) {
  const r = await act<{ id: string }>('competitions.create', { ...input, opportunityId });
  refresh(opportunityId);
  return r;
}

export async function updateStageAction(opportunityId: string, competitionId: string, input: StageInput) {
  const r = await act('competitions.update', { ...input, competitionId });
  refresh(opportunityId);
  return r;
}

export async function attachFormAction(opportunityId: string, competitionId: string, formId: string) {
  const r = await act('competitions.attach_form', { competitionId, formId });
  refresh(opportunityId);
  return r;
}

export async function detachFormAction(opportunityId: string, competitionId: string, formId: string) {
  const r = await act('competitions.detach_form', { competitionId, formId });
  refresh(opportunityId);
  return r;
}

export async function inviteApplicantsAction(opportunityId: string, competitionId: string, applicationIds: string[], message?: string) {
  const r = await act<{ invited: number }>('competitions.invite_applicants', { competitionId, applicationIds, ...(message?.trim() ? { message: message.trim() } : {}) });
  refresh(opportunityId);
  revalidatePath('/console/pipeline');
  return r;
}
