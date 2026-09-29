// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function sendApplicantMessage(applicationId: string, body: string) {
  const r = await act<{ threadId: string; messageId: string }>('messages.send', { applicationId, body });
  revalidatePath(`/portal/applications/${applicationId}`);
  return r;
}

export async function markThreadRead(threadId: string) {
  return act('messages.mark_read', { threadId });
}

export async function withdrawApplication(applicationId: string, reason: string) {
  const r = await act('applications.withdraw', { applicationId, reason: reason || undefined });
  revalidatePath(`/portal/applications/${applicationId}`);
  revalidatePath('/portal');
  return r;
}
