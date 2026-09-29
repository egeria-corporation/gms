// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Shared grantmaking server actions: saved table views, and bulk decline with a letter preview (used by
// the pipeline C-06 and decisions R-05). Screen-specific actions live next to their pages.
import { renderEmail } from '@gms/email';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { emailBrand, isUuid } from '@/lib/grantmaking-data';
import { act } from '@/lib/server/act';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export async function saveViewAction(input: { id?: string; surface: string; name: string; query: string; shared: boolean; path: string }) {
  const r = await act<{ id: string }>('views.save', {
    ...(input.id ? { id: input.id } : {}),
    surface: input.surface,
    name: input.name,
    config: { query: input.query.replace(/^\?/, '').slice(0, 2000) },
    shared: input.shared,
  });
  if (input.path.startsWith('/console/')) revalidatePath(input.path);
  return r;
}

export interface LetterPreview {
  subject: string;
  html: string;
  text: string;
  sampleReference: string;
  recipientCount: number;
}

/** Renders the `status_change` (declined) email for the first selected application, exactly as the applicant would get it. */
export async function previewDeclineLetterAction(input: { applicationIds: string[]; reason: string }): Promise<{ ok: true; data: LetterPreview } | { ok: false; problem: { detail: string } }> {
  const tenant = await requireTenant();
  await requireStaff(['owner', 'admin', 'program_officer']);
  const ids = input.applicationIds.filter(isUuid).slice(0, 1000);
  if (!ids.length) return { ok: false, problem: { detail: 'Select at least one application.' } };
  const rows = await rls((trx) =>
    trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .leftJoin('profiles as p', 'p.id', 'a.applicant_user_id')
      .select(['a.id', 'a.title', 'a.reference_number', 'o.title as opp_title', 'p.full_name'])
      .where('a.id', 'in', ids)
      .where('a.workspace_id', '=', tenant.id)
      .orderBy('a.reference_number')
      .execute(),
  );
  const first = rows[0];
  if (!first) return { ok: false, problem: { detail: 'Those applications were not found.' } };
  const r = await renderEmail(
    'status_change',
    {
      recipientName: first.full_name,
      applicationTitle: first.title ?? 'Your application',
      opportunityName: first.opp_title,
      referenceNumber: first.reference_number,
      status: 'declined',
      note: input.reason.trim() || null,
      timeZone: tenant.timezone,
      applicationUrl: `${tenant.origin}/portal/applications/${first.id}`,
    },
    emailBrand(tenant),
  );
  return { ok: true, data: { subject: r.subject, html: r.html, text: r.text, sampleReference: first.reference_number, recipientCount: rows.length } };
}

/** Final decline for several applications (R3: people only; runs directly for a signed-in person). */
export async function bulkDeclineAction(input: { applicationIds: string[]; reason: string; sendLetter: boolean }) {
  const r = await act<{ declined: number; skipped: { id: string; reason: string }[] }>('decisions.bulk_decline', {
    applicationIds: input.applicationIds,
    reason: input.reason,
    sendLetter: input.sendLetter,
  });
  revalidatePath('/console/pipeline');
  revalidatePath('/console/decisions');
  return r;
}
