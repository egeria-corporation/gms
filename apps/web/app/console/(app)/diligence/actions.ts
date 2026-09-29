// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Due diligence server actions: run IRS + OFAC checks, review potential sanctions matches, set ER flags.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh() {
  revalidatePath('/console/diligence', 'layout');
  revalidatePath('/console/awards', 'layout');
  revalidatePath('/console/payments', 'layout');
}

export async function runDiligenceAction(input: { applicantOrgId: string; awardId?: string | null }) {
  const r = await act<{ irs: string; ofac: string; bestScore: number }>('diligence.run', { applicantOrgId: input.applicantOrgId, awardId: input.awardId ?? null, context: 'manual' });
  refresh();
  return r;
}

export async function resolveScreeningAction(input: { screeningId: string; outcome: 'false_positive' | 'confirmed_match'; note: string }) {
  const r = await act<{ ok: true }>('diligence.resolve_screening', input);
  refresh();
  return r;
}

export async function setFlagsAction(input: { awardId: string; expenditureResponsibility: boolean; grantToIndividual: boolean }) {
  const r = await act<{ ok: true }>('diligence.set_flags', input);
  refresh();
  return r;
}
