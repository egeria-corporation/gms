// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// Application detail (C-07) server actions: messages, internal notes, request info, extensions.
// Pipeline moves (advance, mark ineligible, duplicates) live in ../pipeline/actions.ts.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const appPath = (id: string) => `/console/applications/${id}`;

export async function sendStaffMessageAction(applicationId: string, body: string) {
  const r = await act<{ threadId: string; messageId: string }>('messages.send', { applicationId, body });
  revalidatePath(appPath(applicationId));
  return r;
}

export async function markThreadReadAction(threadId: string) {
  return act<{ ok: true }>('messages.mark_read', { threadId });
}

export async function addNoteAction(entityType: 'application' | 'org', entityId: string, body: string) {
  const r = await act<{ id: string }>('notes.add', { entityType, entityId, body });
  revalidatePath(entityType === 'org' ? `/console/grantees/${entityId}` : appPath(entityId));
  return r;
}

export async function requestInfoAction(applicationId: string, note: string, reopenForEdits: boolean) {
  const r = await act<{ ok: true }>('applications.request_info', { applicationId, note, reopenForEdits });
  revalidatePath(appPath(applicationId));
  revalidatePath('/console/pipeline');
  return r;
}

/** `newDeadline` is wall-clock "YYYY-MM-DDTHH:mm" in the workspace timezone (the action converts). */
export async function grantExtensionAction(applicationId: string, newDeadline: string, reason: string) {
  const r = await act<{ ok: true }>('applications.grant_extension', { applicationId, newDeadline, reason: reason.trim() || undefined });
  revalidatePath(appPath(applicationId));
  return r;
}
