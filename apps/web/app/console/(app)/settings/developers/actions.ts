// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// S-07 Developers: API keys (R3, shown once) and outbound webhook endpoints (signing secret shown once).
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const PATH = '/console/settings/developers';

export async function createApiKeyAction(input: {
  name: string;
  scopes: string[];
  expiresInDays: number | null;
}) {
  const r = await act<{ id: string; key: string; prefix: string }>('api_keys.create', input);
  revalidatePath(PATH);
  return r;
}

export async function revokeApiKeyAction(id: string) {
  const r = await act('api_keys.revoke', { id });
  revalidatePath(PATH);
  return r;
}

export async function saveWebhookAction(input: {
  id?: string;
  url: string;
  description?: string;
  events: string[];
  status: 'active' | 'disabled';
}) {
  const r = await act<{ id: string; secret: string | null }>('webhooks.save_endpoint', input);
  revalidatePath(PATH);
  return r;
}

export async function deleteWebhookAction(id: string) {
  const r = await act('webhooks.delete_endpoint', { id });
  revalidatePath(PATH);
  return r;
}
