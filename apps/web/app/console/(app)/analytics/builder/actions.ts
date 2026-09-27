// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';
import { parseConfig, type ReportConfig } from './datasets';

export async function saveReportAction(input: { id?: string; name: string; shared: boolean; config: ReportConfig }) {
  const config = parseConfig({ ...input.config });
  const r = await act<{ id: string }>('views.save', { ...(input.id ? { id: input.id } : {}), surface: 'report_builder', name: input.name, shared: input.shared, config: { ...config } });
  revalidatePath('/console/analytics/builder');
  return r;
}

export async function exportReportAction(input: { config: ReportConfig; format: 'csv' | 'xlsx'; name: string | null; savedViewId: string | null }) {
  const config = parseConfig({ ...input.config });
  const r = await act<{ exportId: string }>('exports.request', {
    kind: 'report_definition',
    format: input.format,
    params: { ...config, name: input.name, savedViewId: input.savedViewId },
  });
  revalidatePath('/console/exports');
  return r;
}
