// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function signAgreementAction(input: { agreementId: string; typedName: string; documentHash: string; awardId: string }) {
  const r = await act<{ signedAt: string }>('agreements.sign', { agreementId: input.agreementId, typedName: input.typedName, agree: true, documentHash: input.documentHash });
  revalidatePath(`/portal/grants/${input.awardId}`);
  return r;
}

export async function requestChangeAction(input: Record<string, unknown>) {
  const r = await act<{ id: string }>('awards.request_change', input);
  revalidatePath(`/portal/grants/${String(input.awardId)}`);
  return r;
}
