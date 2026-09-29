// SPDX-License-Identifier: AGPL-3.0-or-later
// Server-side sample email in the draft brand (for the sandboxed iframe preview on S-01 and in setup).
import 'server-only';
import { previewProps, renderEmail } from '@gms/email';
import { sourceLink } from '@/lib/config';

export interface EmailBrandDraft {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  emailReplyTo: string | null;
  hasLogo: boolean;
}

export async function sampleEmailHtml(origin: string, draft: EmailBrandDraft, timeZone: string): Promise<string> {
  const email = await renderEmail(
    'status_change',
    { ...previewProps.status_change, applicationUrl: `${origin}/portal`, timeZone },
    {
      displayName: draft.displayName.trim() || 'Your foundation',
      primaryColor: draft.primaryColor,
      accentColor: draft.accentColor,
      headingFont: draft.headingFont,
      logoUrl: draft.hasLogo ? `${origin}/brand/logo` : null,
      replyTo: draft.emailReplyTo || null,
      sourceUrl: sourceLink(),
    },
  );
  return email.html;
}
