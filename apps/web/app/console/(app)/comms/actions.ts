// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Communications server actions: every mutation goes through act() (the action executor); previews render
// the tenant-branded email on the server.
import { DomainError, toProblem } from '@gms/domain';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { act, type ActionResult } from '@/lib/server/act';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';
import { mergeTokens, renderMessagePreview, type MessagePreview } from './preview';

const READERS = ['owner', 'admin', 'program_officer', 'auditor'] as const;

function fail(code: 'validation_failed' | 'conflict' | 'not_found', detail: string): ActionResult<never> {
  return { ok: false, problem: toProblem(new DomainError(code, detail)) };
}

export async function previewMessageAction(input: { subject: string; bodyMd: string }): Promise<MessagePreview> {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(READERS)]);
  return renderMessagePreview(tenant, viewer.name, String(input.subject ?? '').slice(0, 300), String(input.bodyMd ?? '').slice(0, 50000));
}

export async function saveTemplateAction(input: { key: string; name: string; subject: string; bodyMd: string; isNew: boolean }): Promise<ActionResult<{ id: string }>> {
  if (input.isNew) {
    const tenant = await requireTenant();
    const existing = await rls((trx) => trx.selectFrom('email_templates').select('id').where('workspace_id', '=', tenant.id).where('key', '=', input.key).executeTakeFirst());
    if (existing) return fail('conflict', `A template with the key “${input.key}” already exists. Choose another key or edit that template.`);
  }
  const mergeFields = mergeTokens(input.subject, input.bodyMd)
    .map((t) => t.key)
    .slice(0, 50);
  const r = await act<{ id: string }>('comms.save_template', { key: input.key, name: input.name, subject: input.subject, bodyMd: input.bodyMd, mergeFields });
  revalidatePath('/console/comms', 'layout');
  return r;
}

export interface SegmentInput {
  opportunityId?: string;
  competitionId?: string;
  applicationStatuses?: string[];
  awardStatuses?: string[];
  programId?: string;
  reportOverdue?: boolean;
}

export async function draftBulkMessageAction(input: { bulkMessageId?: string; subject: string; bodyMd: string; segment: SegmentInput; templateKey?: string }): Promise<ActionResult<{ id: string; recipientCount: number }>> {
  const r = await act<{ id: string; recipientCount: number }>('comms.draft_bulk_message', input);
  revalidatePath('/console/comms', 'layout');
  return r;
}

export async function sendBulkMessageAction(input: { bulkMessageId: string; confirmRecipientCount: number }): Promise<ActionResult<{ queued: number }>> {
  const r = await act<{ queued: number }>('comms.send_bulk_message', input);
  revalidatePath('/console/comms', 'layout');
  return r;
}

export interface RecipientRow {
  id: string;
  email: string;
  status: string;
  error: string | null;
  updatedAt: string;
}

/** Read-only: the recipients of one bulk message and their delivery status (RLS-scoped to staff who can read deliveries). */
export async function loadRecipientsAction(bulkMessageId: string): Promise<ActionResult<RecipientRow[]>> {
  const tenant = await requireTenant();
  await requireStaff(READERS);
  if (!/^[0-9a-f-]{36}$/i.test(bulkMessageId)) return fail('not_found', 'We couldn’t find that message.');
  const rows = await rls((trx) =>
    trx
      .selectFrom('email_deliveries')
      .select(['id', 'to_email', 'status', 'error', 'last_modified_at'])
      .where('workspace_id', '=', tenant.id)
      .where('bulk_message_id', '=', bulkMessageId)
      .orderBy('status')
      .orderBy('to_email')
      .limit(1000)
      .execute(),
  );
  return { ok: true, data: rows.map((d) => ({ id: d.id, email: d.to_email, status: d.status, error: d.error, updatedAt: d.last_modified_at })) };
}

export async function saveRuleAction(input: {
  ruleId?: string;
  eventType: string;
  channel: 'email' | 'in_app';
  audience: 'applicant' | 'program_officer' | 'finance' | 'admins' | 'reviewers' | 'board';
  templateKey: string | null;
  offsetDays: number | null;
  enabled: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const r = await act<{ id: string }>('comms.save_rule', input);
  revalidatePath('/console/comms', 'layout');
  return r;
}
