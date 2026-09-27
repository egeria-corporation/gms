// SPDX-License-Identifier: AGPL-3.0-only
// S-01 Branding: live preview across a public page, a form, an email and an award letter; colors, heading
// font, logo, email sender (states: contrast-autofix, unsaved, conflict).
import { HEADING_FONTS, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import type { BrandDraft } from './actions';
import { BrandEditor } from './brand-editor';
import { sampleEmailHtml } from './email-preview';

export const metadata: Metadata = { title: 'Branding' };

const FONT_LABELS = HEADING_FONTS.map((f) => f.label) as BrandDraft['headingFont'][];

export default async function BrandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const row = await rls((trx) => trx.selectFrom('workspace_brand').selectAll().where('workspace_id', '=', tenant.id).executeTakeFirstOrThrow());
  const font = FONT_LABELS.find((l) => l.toLowerCase() === row.heading_font.toLowerCase()) ?? 'Inter';
  const saved: BrandDraft = {
    displayName: row.display_name,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    headingFont: font,
    logoPath: row.logo_path,
    faviconPath: row.favicon_path,
    emailSenderName: row.email_sender_name ?? '',
    emailReplyTo: row.email_reply_to ?? '',
  };
  // Forced states start from an edited draft so the documented state is visible on load.
  const initial: BrandDraft =
    forced === 'contrast-autofix'
      ? { ...saved, primaryColor: '#F2D74B', accentColor: '#FDE68A' }
      : forced === 'unsaved'
        ? { ...saved, displayName: `${saved.displayName} Grants`, accentColor: '#2F7D6D' }
        : saved;
  const emailHtml = await sampleEmailHtml(
    tenant.origin,
    { displayName: initial.displayName, primaryColor: initial.primaryColor, accentColor: initial.accentColor, headingFont: initial.headingFont, emailReplyTo: initial.emailReplyTo || null, hasLogo: Boolean(initial.logoPath) },
    tenant.timezone,
  );
  return (
    <div className="grid gap-4">
      <PageHeader title="Branding" description="How your foundation looks on the public site, applicant forms, emails and documents. Colors are checked for readability automatically." />
      <SettingsTabs current="/console/settings/branding" />
      <BrandEditor
        saved={saved}
        initial={initial}
        version={row.version}
        readOnly={!viewer.role || !['owner', 'admin'].includes(viewer.role)}
        initialEmailHtml={emailHtml}
        logoUrl={row.logo_path ? `/brand/logo?v=${encodeURIComponent(row.logo_path.split('/').pop() ?? '')}` : null}
        forcedConflict={forced === 'conflict'}
        fonts={HEADING_FONTS.map((f) => ({ label: f.label, family: f.family, description: f.description }))}
        workspaceName={tenant.name}
      />
    </div>
  );
}
