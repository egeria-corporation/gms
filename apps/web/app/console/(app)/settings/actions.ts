// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';
import { invalidateTenantCache } from '@/lib/tenant';

const PATH = '/console/settings';

export interface WorkspaceSettingsInput {
  name: string;
  timezone: string;
  publicContactEmail: string | null;
  aboutMd: string | null;
  fiscalYearStartMonth: number;
  scanRequired: boolean;
  overdueReportHold: boolean;
  secondApprovalThresholdCents: number;
  transparencyEnabled: boolean;
}

export async function updateWorkspaceAction(input: WorkspaceSettingsInput) {
  const r = await act('workspace.update', input);
  if (r.ok) {
    invalidateTenantCache();
    revalidatePath('/', 'layout');
  }
  return r;
}

export async function setActionTierAction(actionId: string, tier: 'R0' | 'R1' | 'R2' | 'R3' | null) {
  const r = await act('workspace.set_action_tier', { actionId, tier });
  revalidatePath(PATH);
  return r;
}

export async function grantSupportAccessAction(input: { operatorUserId: string; reason: string; hours: number }) {
  const r = await act<{ id: string }>('operator.grant_support_access', input);
  revalidatePath(PATH);
  return r;
}

export async function revokeSupportAccessAction(id: string) {
  const r = await act('operator.revoke_support_access', { id });
  revalidatePath(PATH);
  return r;
}
