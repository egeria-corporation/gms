// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Reviewer workspace server actions (D-02 COI, D-03 scoring). All mutations go through act().
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function declareCoiAction(assignmentId: string, hasConflict: boolean, explanation: string) {
  const r = await act<{ status: string }>('review.declare_coi', { assignmentId, hasConflict, explanation: explanation.trim() || undefined });
  revalidatePath('/review', 'layout');
  return r;
}

export interface ReviewDraft {
  scores: { criterionId: string; score: number; comment: string | null }[];
  overallComment: string | null;
  privateNote: string | null;
  recommendation: 'fund' | 'maybe' | 'decline' | null;
}

export async function saveReviewAction(assignmentId: string, draft: ReviewDraft) {
  const r = await act<{ reviewId: string; weightedScore: number | null }>('review.save', { assignmentId, ...draft });
  revalidatePath(`/review/${assignmentId}`);
  revalidatePath('/review');
  return r;
}

/** Saves the latest draft, then submits it (review.submit checks every criterion is scored). */
export async function submitReviewAction(assignmentId: string, draft: ReviewDraft) {
  const saved = await act<{ reviewId: string; weightedScore: number | null }>('review.save', { assignmentId, ...draft });
  if (!saved.ok) return saved;
  const r = await act<{ weightedScore: number | null }>('review.submit', { assignmentId });
  revalidatePath(`/review/${assignmentId}`);
  revalidatePath('/review');
  return r;
}

export async function reviewerPanelNoteAction(assignmentId: string, applicationId: string, panelId: string | null, body: string) {
  const r = await act<{ id: string }>('review.panel_note', { applicationId, panelId, body });
  revalidatePath(`/review/${assignmentId}`);
  return r;
}
