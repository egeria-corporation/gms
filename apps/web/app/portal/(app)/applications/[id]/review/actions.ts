// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function submitApplicationAction(input: { applicationId: string; typedName: string; aiDisclosure: string | null; idempotencyKey: string }) {
  const r = await act<{ status: 'submitted'; receiptNumber: string; submittedAt: string; referenceNumber: string }>(
    'applications.submit',
    { applicationId: input.applicationId, attestation: { typedName: input.typedName, agreed: true }, aiDisclosure: input.aiDisclosure || undefined },
    { idempotencyKey: input.idempotencyKey },
  );
  revalidatePath('/portal');
  revalidatePath(`/portal/applications/${input.applicationId}`);
  return r;
}
