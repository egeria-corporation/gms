// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// S-04 AI agents & policy: agent accounts, pause/resume/revoke, AI-use policy, optional model key.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const PATH = '/console/settings/agents';

export async function createAgentAccountAction(input: {
  name: string;
  ownerUserId: string;
  scopes: string[];
  toolAllowlist: string[] | null;
  rateLimitPerMin: number;
}) {
  const r = await act<{ clientId: string; key: string }>('agents.create_account', input);
  revalidatePath(PATH);
  return r;
}

export async function changeAgentAccountAction(id: string, action: 'pause' | 'resume' | 'revoke') {
  const r = await act('agents.revoke', { kind: 'client', id, action });
  revalidatePath(PATH);
  return r;
}

export async function updateAiPolicyAction(input: {
  aiUse: 'allowed' | 'disclosure' | 'prohibited';
  disclosurePrompt?: string;
  reviewerAssist: boolean;
  agentSubmissionsEnabled: boolean;
  mcpEnabled: boolean;
  a2aEnabled: boolean;
}) {
  const r = await act('agents.update_policy', input);
  revalidatePath(PATH);
  return r;
}

export async function setModelKeyAction(input: { provider: 'anthropic' | 'openai' | null; apiKey?: string }) {
  const r = await act('agents.set_model_key', input);
  revalidatePath(PATH);
  return r;
}
