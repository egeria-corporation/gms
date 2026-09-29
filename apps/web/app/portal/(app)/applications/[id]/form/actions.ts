// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import type { ResponseError } from '@gms/forms';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export interface SaveOut {
  ok: boolean;
  etag: string;
  errors: ResponseError[];
  conflicts: { fieldId: string; theirValue: unknown; by?: string; at?: string }[];
  message?: string;
}

/** Autosave: partial update of the changed fields, revision-checked against `etag`. */
export async function saveAnswersAction(applicationId: string, formId: string, answers: Record<string, unknown>, etag: string | undefined): Promise<SaveOut> {
  const r = await act<{ etag: string; errors: { pointer: string; message: string; fieldId?: string; pageId?: string }[]; conflicts: { fieldId: string; theirValue: unknown; updatedBy: string | null; updatedAt: string }[] }>(
    'applications.save_answers',
    { applicationId, formId, answers, etag: etag ?? null },
  );
  if (!r.ok) return { ok: false, etag: etag ?? '0', errors: [], conflicts: [], message: r.problem.detail };
  return {
    ok: true,
    etag: r.data.etag,
    errors: r.data.errors.map((e) => ({ pointer: e.pointer, message: e.message, fieldId: e.fieldId ?? e.pointer.split('/')[1] ?? '', pageId: e.pageId ?? '', keyword: 'server' })),
    conflicts: r.data.conflicts.map((c) => ({ fieldId: c.fieldId, theirValue: c.theirValue, by: c.updatedBy ?? undefined, at: c.updatedAt })),
  };
}

export async function requestUploadAction(input: { applicationId: string; formId: string; fieldId: string; fileName: string; contentType: string; sizeBytes: number }) {
  return act<{ attachmentId: string; uploadUrl: string; method: string; headers: Record<string, string>; expiresAt: string }>('applications.request_upload', input);
}

export async function confirmUploadAction(attachmentId: string) {
  return act<{ attachmentId: string; scanStatus: string; fileName: string; sizeBytes: number; etag: string }>('applications.confirm_upload', { attachmentId });
}

export async function addCommentAction(applicationId: string, fieldPath: string | null, body: string) {
  const r = await act<{ id: string }>('applications.comment', { applicationId, fieldPath, body });
  revalidatePath(`/portal/applications/${applicationId}/form`);
  return r;
}

export async function resolveCommentAction(applicationId: string, commentId: string) {
  const r = await act('applications.resolve_comment', { commentId });
  revalidatePath(`/portal/applications/${applicationId}/form`);
  return r;
}
