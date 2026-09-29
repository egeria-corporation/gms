'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// O-01 decisions. The pending request id comes from the form; the person comes from the session (never the form).
import { completeAuthorization, denyAuthorization } from '@gms/agents';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { agentEnv } from '@/lib/server/agent-env';
import { humanContext } from '@/lib/server/act';

export async function approveConsent(formData: FormData): Promise<void> {
  await requireViewer();
  const requestId = String(formData.get('requestId') ?? '');
  const approvedScopes = formData.getAll('scope').map(String);
  // The consent is recorded by `oauth.grant_consent`, run as the signed-in person (see completeAuthorization).
  const { redirectUrl } = await completeAuthorization(await agentEnv(), { requestId, person: await humanContext(), approvedScopes });
  redirect(redirectUrl);
}

export async function denyConsent(formData: FormData): Promise<void> {
  await requireViewer();
  const requestId = String(formData.get('requestId') ?? '');
  const { redirectUrl } = await denyAuthorization(await agentEnv(), { requestId });
  redirect(redirectUrl);
}
