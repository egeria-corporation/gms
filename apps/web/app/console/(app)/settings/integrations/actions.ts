// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const PATH = '/console/settings/integrations';

export async function setEmailDomainAction(domain: string | null) {
  const r = await act('integrations.set_email_domain', { domain });
  revalidatePath(PATH);
  return r;
}

export async function setSyndicationAction(enabled: boolean) {
  const r = await act('integrations.set_syndication', { enabled });
  revalidatePath(PATH);
  return r;
}
