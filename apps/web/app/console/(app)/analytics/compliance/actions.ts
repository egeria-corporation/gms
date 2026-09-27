// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export async function export990Action(taxYear: number, format: 'csv' | 'xlsx') {
  const r = await act<{ exportId: string }>('exports.request', { kind: 'form_990pf', format, params: { taxYear } });
  revalidatePath('/console/exports');
  return r;
}
