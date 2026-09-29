// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Pipeline (C-06) server actions: every mutation runs through act() (executor: validation, roles, RLS,
// audit). Also used by the application detail page (C-07).
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh() {
  revalidatePath('/console/pipeline');
  revalidatePath('/console/applications/[id]', 'page');
}

export async function advanceAction(applicationIds: string[]) {
  const r = await act<{ moved: number; skipped: { id: string; reason: string }[] }>('applications.advance', { applicationIds });
  refresh();
  return r;
}

export async function markIneligibleAction(applicationIds: string[], reason: string) {
  const r = await act<{ updated: number }>('applications.mark_ineligible', { applicationIds, reason });
  refresh();
  return r;
}

export async function inviteToStageAction(competitionId: string, applicationIds: string[], message: string) {
  const r = await act<{ invited: number }>('competitions.invite_applicants', { competitionId, applicationIds, message: message.trim() || undefined });
  refresh();
  return r;
}

export async function tagAction(applicationIds: string[], add: string[], remove: string[]) {
  const r = await act<{ updated: number }>('applications.tag', { applicationIds, add, remove });
  refresh();
  return r;
}

export async function markDuplicateAction(applicationId: string, duplicateOf: string | null) {
  const r = await act<{ ok: true }>('applications.mark_duplicate', { applicationId, duplicateOf });
  refresh();
  return r;
}

export async function dismissDuplicateAction(applicationId: string, otherApplicationId: string) {
  const r = await act<{ ok: true }>('applications.dismiss_duplicate', { applicationId, otherApplicationId });
  refresh();
  return r;
}

export interface AutoAssignResult {
  plan: { applicationId: string; reviewerId: string; reviewerName: string | null }[];
  unassigned: { applicationId: string; reason: string }[];
  overCapacity: string[];
  created: number;
}

export async function autoAssignAction(stageId: string, applicationIds: string[], dryRun: boolean) {
  const r = await act<AutoAssignResult>('review.auto_assign', { stageId, applicationIds, dryRun });
  if (!dryRun) refresh();
  return r;
}

export async function assignReviewersAction(stageId: string, applicationIds: string[], reviewerIds: string[]) {
  const assignments = applicationIds.flatMap((applicationId) => reviewerIds.map((reviewerId) => ({ applicationId, reviewerId })));
  const r = await act<{ created: number }>('review.assign', { stageId, assignments });
  refresh();
  return r;
}

export async function draftBulkMessageAction(applicationIds: string[], subject: string, bodyMd: string) {
  return act<{ id: string; recipientCount: number }>('comms.draft_bulk_message', { subject, bodyMd, segment: { applicationIds } });
}
