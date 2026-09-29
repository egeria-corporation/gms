// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { act, type ActionResult } from '@/lib/server/act';
import { invalidateTenantCache, requireTenant } from '@/lib/tenant';
import { sampleEmailHtml, type EmailBrandDraft } from './email-preview';

export interface BrandDraft {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  headingFont: 'Inter' | 'Source Serif 4' | 'Atkinson Hyperlegible' | 'Figtree';
  logoPath: string | null;
  faviconPath: string | null;
  emailSenderName: string;
  emailReplyTo: string;
}

export async function saveBrandAction(draft: BrandDraft, expectedVersion: number): Promise<ActionResult<{ version: number; warnings: { message: string }[] }>> {
  const r = await act<{ version: number; warnings: { message: string }[] }>('brand.update', {
    displayName: draft.displayName,
    primaryColor: draft.primaryColor,
    accentColor: draft.accentColor,
    headingFont: draft.headingFont,
    logoPath: draft.logoPath,
    faviconPath: draft.faviconPath,
    emailSenderName: draft.emailSenderName.trim() || null,
    emailReplyTo: draft.emailReplyTo.trim() || null,
    expectedVersion,
  });
  if (r.ok) {
    invalidateTenantCache();
    revalidatePath('/', 'layout');
  }
  return r;
}

export async function requestBrandUploadAction(input: { kind: 'logo' | 'favicon'; contentType: string; sizeBytes: number }) {
  return act<{ path: string; uploadUrl: string; method: string; headers: Record<string, string>; expiresAt: string }>('brand.request_asset_upload', input);
}

/** Re-renders the sample email for the sandboxed preview (rendering stays on the server). */
export async function previewEmailAction(draft: EmailBrandDraft): Promise<string> {
  await requireStaff(['owner', 'admin', 'auditor']);
  const tenant = await requireTenant();
  return sampleEmailHtml(tenant.origin, draft, tenant.timezone);
}
