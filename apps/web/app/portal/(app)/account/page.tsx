// SPDX-License-Identifier: AGPL-3.0-only
// B-15 Account: notifications, data export, delete request.
import { Button, PageHeader, Section } from '@gms/ui';
import { Bot, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { DeleteAccount, ProfileForm } from './account-forms';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requireViewer();
  const profile = await rls((trx) => trx.selectFrom('profiles').select(['full_name', 'notification_prefs', 'deletion_requested_at']).where('id', '=', viewer.userId).executeTakeFirstOrThrow());
  const prefs = { email: true, in_app: true, digest: 'daily' as const, ...(profile.notification_prefs as object) };
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-10 pb-16">
      <PageHeader density="spacious" title="Your account" description={`Signed in as ${viewer.email}.`} />
      <Section title="Profile and notifications">
        <ProfileForm fullName={profile.full_name ?? ''} prefs={prefs as { email: boolean; in_app: boolean; digest: 'off' | 'daily' | 'weekly' }} />
      </Section>
      <Section title="AI agents" description="See which agents can act for you, and pause or remove them.">
        <Button asChild variant="secondary">
          <Link href="/portal/account/agents">
            <Bot aria-hidden="true" /> Manage connected agents
          </Link>
        </Button>
      </Section>
      <Section title="Your data" description="Download a copy of everything GMS holds about you: profile, organizations, applications, messages and agent tokens.">
        <Button asChild variant="secondary">
          <a href="/portal/account/export" download>
            <Download aria-hidden="true" /> Download my data (JSON)
          </a>
        </Button>
      </Section>
      <Section title="Delete account">
        <DeleteAccount requested={Boolean(profile.deletion_requested_at)} />
      </Section>
    </div>
  );
}
