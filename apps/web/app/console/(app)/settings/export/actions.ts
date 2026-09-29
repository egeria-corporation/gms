// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// S-09 Workspace export: queue a full export (JSON tables + CommonGrants bundle, zipped).
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function requestWorkspaceExportAction() {
  const r = await act<{ exportId: string }>('exports.request', {
    kind: 'workspace',
    format: 'zip',
    params: {},
  });
  revalidatePath('/console/settings/export');
  revalidatePath('/console/exports');
  return r;
}
