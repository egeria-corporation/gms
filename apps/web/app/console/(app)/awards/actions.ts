// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Award (finance/program side) server actions. Every mutation goes through act().
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh(awardId?: string) {
  revalidatePath('/console/awards', 'layout');
  revalidatePath('/console/payments', 'layout');
  revalidatePath('/console/reports', 'layout');
  revalidatePath('/console/diligence', 'layout');
  if (awardId) revalidatePath(`/console/awards/${awardId}`);
}

export async function activateAwardAction(awardId: string) {
  const r = await act<{ ok: true }>('awards.activate', { awardId });
  refresh(awardId);
  return r;
}

export async function setAwardHoldAction(input: { awardId: string; onHold: boolean; reason?: string }) {
  const r = await act<{ ok: true }>('awards.set_hold', { awardId: input.awardId, onHold: input.onHold, reason: input.onHold ? (input.reason ?? '') : null });
  refresh(input.awardId);
  return r;
}

export async function closeAwardAction(input: { awardId: string; status: 'completed' | 'cancelled'; reason?: string }) {
  const r = await act<{ ok: true }>('awards.close', { awardId: input.awardId, status: input.status, ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) });
  refresh(input.awardId);
  return r;
}

export async function generateAgreementAction(awardId: string) {
  const r = await act<{ agreementId: string; documentHash: string }>('agreements.generate', { awardId });
  refresh(awardId);
  return r;
}

export async function sendAgreementAction(input: { agreementId: string; awardId: string }) {
  const r = await act<{ ok: true }>('agreements.send', { agreementId: input.agreementId });
  refresh(input.awardId);
  return r;
}

export async function countersignAction(input: { agreementId: string; awardId: string; typedName: string }) {
  const r = await act<{ ok: true }>('agreements.countersign', { agreementId: input.agreementId, typedName: input.typedName, agree: true });
  refresh(input.awardId);
  return r;
}

export async function amendAwardAction(input: { awardId: string; kind: 'amendment' | 'supplement'; amountCents: number; newEndDate?: string; reason: string }) {
  const r = await act<{ id: string }>('awards.amend', {
    awardId: input.awardId,
    kind: input.kind,
    amountCents: input.amountCents,
    reason: input.reason,
    ...(input.newEndDate ? { newEndDate: input.newEndDate } : {}),
  });
  refresh(input.awardId);
  return r;
}

export async function approveAmendmentAction(input: { amendmentId: string; parentAwardId: string; approve: boolean }) {
  const r = await act<{ newTotalCents: number }>('awards.approve_amendment', { awardId: input.amendmentId, approve: input.approve });
  refresh(input.parentAwardId);
  return r;
}

export async function setDiligenceFlagsAction(input: { awardId: string; expenditureResponsibility: boolean; grantToIndividual: boolean }) {
  const r = await act<{ ok: true }>('diligence.set_flags', input);
  refresh(input.awardId);
  return r;
}
