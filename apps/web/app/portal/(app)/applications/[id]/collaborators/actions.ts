// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function inviteCollaboratorAction(applicationId: string, email: string, role: 'editor' | 'viewer') {
  const r = await act<{ id: string }>('applications.invite_collaborator', { applicationId, email, role });
  revalidatePath(`/portal/applications/${applicationId}/collaborators`);
  return r;
}

export async function removeCollaboratorAction(applicationId: string, collaboratorId: string) {
  const r = await act('applications.remove_collaborator', { collaboratorId });
  revalidatePath(`/portal/applications/${applicationId}/collaborators`);
  return r;
}
