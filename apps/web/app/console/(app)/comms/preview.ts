// SPDX-License-Identifier: AGPL-3.0-only
// Server-side branded preview for staff-written messages (templates and bulk messages).
import 'server-only';
import { findMergeTokens, MERGE_FIELDS, renderEmail } from '@gms/email';
import { sourceLink } from '@/lib/config';
import type { Tenant } from '@/lib/tenant';

export interface MessagePreview {
  html: string;
  subject: string;
  /** Merge tokens found in the subject and body; `known: false` ones will be sent as typed. */
  tokens: { key: string; known: boolean }[];
}

const EXAMPLES: Record<string, string> = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.example]));

export function mergeTokens(subject: string, bodyMd: string) {
  return findMergeTokens(`${subject}\n${bodyMd}`);
}

export async function renderMessagePreview(tenant: Tenant, senderName: string, subject: string, bodyMd: string): Promise<MessagePreview> {
  const values = { ...EXAMPLES, 'foundation.name': tenant.brand.displayName, 'sender.name': senderName };
  const rendered = await renderEmail(
    'bulk_message',
    {
      subject: subject.trim() || '(No subject yet)',
      markdown: bodyMd.trim() || '_Start writing to see your message here._',
      mergeValues: values,
      senderName,
      reason: `you applied to or have a grant with ${tenant.brand.displayName}.`,
    },
    {
      displayName: tenant.brand.displayName,
      primaryColor: tenant.brand.primaryColor,
      accentColor: tenant.brand.accentColor,
      headingFont: tenant.brand.headingFont,
      logoUrl: tenant.brand.logoPath ? `${tenant.origin}/brand/logo` : null,
      replyTo: null,
      sourceUrl: sourceLink(),
    },
  );
  return { html: rendered.html, subject: rendered.subject, tokens: mergeTokens(subject, bodyMd) };
}
