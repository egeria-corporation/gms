// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Post-award server actions: report review, report payment holds, change-request decisions.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

function refresh(requirementId?: string) {
  revalidatePath('/console/reports', 'layout');
  revalidatePath('/console/awards', 'layout');
  revalidatePath('/console/payments', 'layout');
  if (requirementId) revalidatePath(`/console/reports/${requirementId}`);
}

export async function setReportHoldAction(input: { requirementId: string; holdsPayments: boolean }) {
  const r = await act<{ ok: true }>('reports.set_hold', input);
  refresh(input.requirementId);
  return r;
}

export async function reviewReportAction(input: { requirementId: string; decision: 'accept' | 'revise'; note?: string; indicators: { indicatorId: string; value: number; periodEnd?: string }[] }) {
  const r = await act<{ ok: true }>('reports.review', {
    requirementId: input.requirementId,
    decision: input.decision,
    indicators: input.indicators,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  });
  refresh(input.requirementId);
  return r;
}

export async function decideChangeAction(input: { changeRequestId: string; approve: boolean; note?: string; requirementId?: string }) {
  const r = await act<{ ok: true }>('awards.decide_change', { changeRequestId: input.changeRequestId, approve: input.approve, ...(input.note?.trim() ? { note: input.note.trim() } : {}) });
  refresh(input.requirementId);
  return r;
}
