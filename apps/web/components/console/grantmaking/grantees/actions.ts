// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Grantee CRM (C-08) server actions: relationship profile (tags, owner, summary) and site visits.
// Internal notes on an organization use addNoteAction from ../applications/actions.ts.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function updateGranteeProfileAction(input: { applicantOrgId: string; tags?: string[]; relationshipOwnerId?: string | null; summary?: string | null }) {
  const r = await act<{ ok: true }>('grantees.update_profile', input);
  revalidatePath(`/console/grantees/${input.applicantOrgId}`);
  revalidatePath('/console/grantees');
  return r;
}

export async function recordSiteVisitAction(input: { applicantOrgId: string; awardId: string | null; visitedOn: string; summary: string; followUps: string }) {
  const r = await act<{ id: string }>('grantees.record_site_visit', {
    applicantOrgId: input.applicantOrgId,
    awardId: input.awardId,
    visitedOn: input.visitedOn,
    summary: input.summary,
    followUps: input.followUps.trim() || undefined,
  });
  revalidatePath(`/console/grantees/${input.applicantOrgId}`);
  return r;
}
