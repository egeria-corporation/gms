// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { redirect } from 'next/navigation';
import { act } from '@/lib/server/act';

export async function startApplicationAction(competitionId: string, applicantOrgId: string | null) {
  const r = await act<{ applicationId: string; resumed: boolean }>('applications.start', { competitionId, applicantOrgId });
  if (!r.ok) return r;
  redirect(`/portal/applications/${r.data.applicationId}/form`);
}
