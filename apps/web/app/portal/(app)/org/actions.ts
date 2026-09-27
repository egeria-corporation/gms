// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act, type ActionResult } from '@/lib/server/act';

export interface EinLookup {
  status: 'found' | 'not_found' | 'warning';
  ein: string;
  record: { name: string; city: string | null; state: string | null; subsection: string | null; status: string; pub78: boolean; deductibility: string | null } | null;
  message: string;
  alreadyRegistered: boolean;
}

export async function lookupEinAction(ein: string): Promise<ActionResult<EinLookup>> {
  return act('orgs.lookup_ein', { ein });
}

export async function createOrgAction(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const r = await act<{ id: string }>('orgs.create', input, { idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : null });
  if (r.ok) revalidatePath('/portal');
  return r;
}

export async function updateOrgAction(input: Record<string, unknown>): Promise<ActionResult<{ ok: true }>> {
  const r = await act<{ ok: true }>('orgs.update', input);
  if (r.ok) revalidatePath(`/portal/org/${String(input.orgId)}`);
  return r;
}

export async function requestDocUploadAction(input: Record<string, unknown>) {
  return act<{ documentId: string; uploadUrl: string; method: string; headers: Record<string, string>; expiresAt: string }>('orgs.request_document_upload', input);
}

export async function confirmDocUploadAction(documentId: string, orgId: string) {
  const r = await act<{ scanStatus: string }>('orgs.confirm_document_upload', { documentId });
  revalidatePath(`/portal/org/${orgId}`);
  return r;
}

export async function deleteDocAction(documentId: string, orgId: string) {
  const r = await act<{ ok: true }>('orgs.delete_document', { documentId });
  revalidatePath(`/portal/org/${orgId}`);
  return r;
}
