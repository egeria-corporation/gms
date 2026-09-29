// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import type { ResponseError } from '@gms/forms';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function saveReportAction(requirementId: string, answers: Record<string, unknown>): Promise<{ ok: boolean; errors: ResponseError[]; message?: string }> {
  const r = await act<{ submissionId: string; errors: { pointer: string; message: string; fieldId?: string; pageId?: string }[] }>('reports.save', { requirementId, answers });
  if (!r.ok) return { ok: false, errors: [], message: r.problem.detail };
  return { ok: true, errors: r.data.errors.map((e) => ({ pointer: e.pointer, message: e.message, fieldId: e.fieldId ?? '', pageId: e.pageId ?? '', keyword: 'server' })) };
}

export async function submitReportAction(requirementId: string, awardId: string, typedName: string) {
  const r = await act<{ submittedAt: string }>('reports.submit', { requirementId, attestation: { typedName, agreed: true } });
  revalidatePath(`/portal/grants/${awardId}`);
  revalidatePath(`/portal/grants/${awardId}/reports/${requirementId}`);
  return r;
}
