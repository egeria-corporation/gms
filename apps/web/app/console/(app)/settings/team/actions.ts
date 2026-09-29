// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const PATH = '/console/settings/team';

export async function inviteAction(input: { email: string; role: string }) {
  const r = await act<{ id: string }>('team.invite', input);
  revalidatePath(PATH);
  return r;
}

export async function revokeInviteAction(invitationId: string) {
  const r = await act('team.revoke_invite', { invitationId });
  revalidatePath(PATH);
  return r;
}

export async function changeRoleAction(memberId: string, role: string) {
  const r = await act('team.change_role', { memberId, role });
  revalidatePath(PATH);
  return r;
}

export async function removeMemberAction(memberId: string) {
  const r = await act('team.remove_member', { memberId });
  revalidatePath(PATH);
  return r;
}

export async function setCapacityAction(memberId: string, capacity: number | null) {
  const r = await act('team.set_review_capacity', { memberId, capacity });
  revalidatePath(PATH);
  return r;
}
