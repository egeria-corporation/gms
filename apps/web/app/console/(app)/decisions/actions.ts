// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// R-05 / R-06 / R-07 server actions: recommendations, final decisions, award drafting/activation,
// amendments and agreements. Every mutation goes through act() (executor: validation, roles, RLS, audit).
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh(applicationId?: string) {
  revalidatePath('/console/decisions');
  if (applicationId) {
    revalidatePath(`/console/decisions/${applicationId}/award`);
    revalidatePath(`/console/decisions/${applicationId}/agreement`);
  }
}

export interface RecommendInput {
  applicationId: string;
  outcome: 'approve' | 'decline' | 'defer';
  reason: string | null;
  recommendedAmountCents: number | null;
}

export async function recommendAction(input: RecommendInput) {
  const r = await act<{ id: string }>('decisions.recommend', {
    applicationId: input.applicationId,
    outcome: input.outcome,
    reason: input.reason?.trim() || null,
    recommendedAmountCents: input.outcome === 'approve' ? input.recommendedAmountCents : null,
  });
  refresh(input.applicationId);
  return r;
}

export interface FinalDecisionInput {
  applicationId: string;
  outcome: 'approve' | 'decline' | 'defer';
  reason: string | null;
  amountCents: number | null;
  sendLetter: boolean;
}

/** decisions.record_final is R3 (people only); for a signed-in person it runs directly. */
export async function recordFinalAction(input: FinalDecisionInput) {
  const r = await act<{ decisionId: string; awardId: string | null }>('decisions.record_final', {
    applicationId: input.applicationId,
    outcome: input.outcome,
    reason: input.reason?.trim() || null,
    amountCents: input.outcome === 'approve' ? input.amountCents : null,
    sendLetter: input.sendLetter,
  });
  refresh(input.applicationId);
  revalidatePath('/console/pipeline');
  return r;
}

export interface DraftAwardInput {
  applicationId: string;
  amountCents: number;
  startDate: string;
  endDate: string;
  purpose: string | null;
  conditions: string[];
  installments: { dueDate: string; amountCents: number; condition: string | null }[];
  expenditureResponsibility: boolean;
  grantToIndividual: boolean;
}

export async function draftAwardAction(input: DraftAwardInput) {
  const r = await act<{ awardId: string; warnings: string[] }>('awards.draft', {
    applicationId: input.applicationId,
    amountCents: input.amountCents,
    startDate: input.startDate,
    endDate: input.endDate,
    purpose: input.purpose?.trim() || null,
    conditions: input.conditions.map((c) => c.trim()).filter(Boolean),
    installments: input.installments.map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents, condition: i.condition?.trim() || null })),
    expenditureResponsibility: input.expenditureResponsibility,
    grantToIndividual: input.grantToIndividual,
  });
  refresh(input.applicationId);
  return r;
}

/** awards.activate is R3 (people only). */
export async function activateAwardAction(applicationId: string, awardId: string) {
  const r = await act('awards.activate', { awardId });
  refresh(applicationId);
  revalidatePath(`/console/awards/${awardId}`);
  return r;
}

export interface AmendInput {
  awardId: string;
  kind: 'amendment' | 'supplement';
  amountCents: number;
  newEndDate: string | null;
  reason: string;
}

export async function amendAwardAction(applicationId: string, input: AmendInput) {
  const r = await act<{ id: string }>('awards.amend', {
    awardId: input.awardId,
    kind: input.kind,
    amountCents: input.amountCents,
    ...(input.newEndDate ? { newEndDate: input.newEndDate } : {}),
    reason: input.reason,
  });
  refresh(applicationId);
  revalidatePath(`/console/awards/${input.awardId}`);
  return r;
}

export async function generateAgreementAction(applicationId: string, awardId: string) {
  const r = await act<{ agreementId: string; documentHash: string }>('agreements.generate', { awardId });
  refresh(applicationId);
  return r;
}

/** agreements.send is R2: for a person it runs; agents would get an approval request instead. */
export async function sendAgreementAction(applicationId: string, agreementId: string) {
  const r = await act('agreements.send', { agreementId });
  refresh(applicationId);
  return r;
}
