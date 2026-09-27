// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// Review module server actions (R-01 … R-04). Every mutation goes through act() → the action executor.
import { zonedTimeToUtc } from '@gms/domain';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';
import { requireTenant } from '@/lib/tenant';

/** Wall-clock input → ISO instant in the workspace timezone (null when empty or malformed). */
function toInstant(local: string, tz: string): string | null {
  if (!local) return null;
  try {
    return zonedTimeToUtc(local, tz).toISOString();
  } catch {
    return null;
  }
}

export interface CriterionInput {
  label: string;
  guidance: string | null;
  weightPct: number;
  scaleMin: number;
  scaleMax: number;
  scaleLabels: Record<string, string>;
}

export interface RubricInput {
  rubricId?: string;
  name: string;
  description: string | null;
  criteria: CriterionInput[];
}

export async function saveRubricAction(input: RubricInput) {
  const r = await act<{ id: string }>('review.save_rubric', {
    ...(input.rubricId ? { rubricId: input.rubricId } : {}),
    name: input.name,
    description: input.description || null,
    criteria: input.criteria.map((c) => ({ ...c, guidance: c.guidance || null })),
  });
  revalidatePath('/console/review', 'layout');
  return r;
}

export interface StageInput {
  stageId?: string;
  competitionId: string;
  name: string;
  rubricId: string | null;
  blind: boolean;
  reviewersPerApplication: number;
  /** Wall-clock "YYYY-MM-DDTHH:mm" in the workspace timezone, or empty. */
  dueAt: string;
  status: 'draft' | 'active' | 'closed';
}

export async function saveStageAction(input: StageInput) {
  const tenant = await requireTenant();
  // review.save_stage parses dueAt with `new Date()`, so send an absolute ISO instant.
  const dueAt = toInstant(input.dueAt, tenant.timezone);
  const r = await act<{ id: string }>('review.save_stage', {
    ...(input.stageId ? { stageId: input.stageId } : {}),
    competitionId: input.competitionId,
    name: input.name,
    rubricId: input.rubricId,
    blind: input.blind,
    reviewersPerApplication: input.reviewersPerApplication,
    dueAt,
    status: input.status,
  });
  revalidatePath('/console/review', 'layout');
  return r;
}

export interface AutoAssignResult {
  plan: { applicationId: string; reviewerId: string; reviewerName: string | null }[];
  unassigned: { applicationId: string; reason: string }[];
  overCapacity: string[];
  created: number;
}

export async function autoAssignAction(stageId: string, dryRun: boolean) {
  const r = await act<AutoAssignResult>('review.auto_assign', { stageId, dryRun });
  if (!dryRun) revalidatePath(`/console/review/${stageId}`, 'layout');
  return r;
}

export async function assignAction(stageId: string, applicationId: string, reviewerId: string) {
  const r = await act<{ created: number }>('review.assign', { stageId, assignments: [{ applicationId, reviewerId }] });
  revalidatePath(`/console/review/${stageId}`, 'layout');
  return r;
}

export async function unassignAction(stageId: string, assignmentId: string) {
  const r = await act('review.unassign', { assignmentId });
  revalidatePath(`/console/review/${stageId}`, 'layout');
  return r;
}

export async function setCapacityAction(stageId: string, memberId: string, capacity: number | null) {
  const r = await act('team.set_review_capacity', { memberId, capacity });
  revalidatePath(`/console/review/${stageId}/assign`);
  return r;
}

export async function reopenReviewAction(stageId: string, assignmentId: string) {
  const r = await act('review.reopen', { assignmentId });
  revalidatePath(`/console/review/${stageId}`, 'layout');
  return r;
}

export async function addPanelNoteAction(stageId: string, applicationId: string, panelId: string | null, body: string) {
  const r = await act<{ id: string }>('review.panel_note', { applicationId, panelId, body });
  revalidatePath(`/console/review/${stageId}/panel`);
  return r;
}

export async function savePanelAction(input: { panelId?: string; stageId: string; name: string; meetsAt: string; status: 'scheduled' | 'live' | 'closed' }) {
  const tenant = await requireTenant();
  const meetsAt = toInstant(input.meetsAt, tenant.timezone);
  const r = await act<{ id: string }>('review.save_panel', {
    ...(input.panelId ? { panelId: input.panelId } : {}),
    stageId: input.stageId,
    name: input.name,
    meetsAt,
    status: input.status,
  });
  revalidatePath(`/console/review/${input.stageId}/panel`);
  return r;
}
