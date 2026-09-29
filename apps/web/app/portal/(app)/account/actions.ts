// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function updateProfileAction(input: { fullName?: string; notificationPrefs?: { email: boolean; in_app: boolean; digest: 'off' | 'daily' | 'weekly' } }) {
  const r = await act('profile.update', input);
  revalidatePath('/portal/account');
  return r;
}

export async function requestDeletionAction() {
  return act('account.request_deletion', { confirm: true });
}

export async function createTokenAction(input: { agentName: string; scopes: string[]; expiresInDays: number }) {
  const r = await act<{ tokenId: string; token: string; clientId: string }>('agents.create_token', { ...input, workspaceBound: true });
  revalidatePath('/portal/account/agents');
  return r;
}

export async function revokeAgentAction(kind: 'token' | 'grant', id: string, action: 'pause' | 'resume' | 'revoke') {
  const r = await act('agents.revoke', { kind, id, action });
  revalidatePath('/portal/account/agents');
  return r;
}
