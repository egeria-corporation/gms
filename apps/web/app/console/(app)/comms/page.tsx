// SPDX-License-Identifier: AGPL-3.0-only
// CM-00 Communications: templates, bulk messages and automatic notifications, with quick stats.
import { sql } from '@gms/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, StatTile } from '@gms/ui';
import { BellRing, FileText, Send, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Messages & email' };

export default async function CommsIndexPage() {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stats = await rls(async (trx) => {
    const [templates, drafts, sent, bounced, rules] = await Promise.all([
      trx.selectFrom('email_templates').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst(),
      trx.selectFrom('bulk_messages').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).where('status', '=', 'draft').executeTakeFirst(),
      trx
        .selectFrom('bulk_messages')
        .select([sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(recipient_count),0)::int`.as('people')])
        .where('workspace_id', '=', tenant.id)
        .where('status', 'in', ['sending', 'sent'])
        .where(sql<boolean>`coalesce(sent_at, last_modified_at) >= ${since}::timestamptz`)
        .executeTakeFirst(),
      trx
        .selectFrom('email_deliveries')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('workspace_id', '=', tenant.id)
        .where('status', '=', 'bounced')
        .where('created_at', '>=', since)
        .executeTakeFirst(),
      trx.selectFrom('notification_rules').select(sql<number>`count(*) filter (where enabled)::int`.as('n')).where('workspace_id', '=', tenant.id).executeTakeFirst(),
    ]);
    return {
      templates: Number(templates?.n ?? 0),
      drafts: Number(drafts?.n ?? 0),
      sent: Number(sent?.n ?? 0),
      people: Number(sent?.people ?? 0),
      bounced: Number(bounced?.n ?? 0),
      rules: Number(rules?.n ?? 0),
    };
  });

  const cards: { href: string; title: string; description: string; icon: LucideIcon; meta: string }[] = [
    { href: '/console/comms/templates', title: 'Email templates', description: 'Reusable subjects and messages with merge fields, previewed in your branding.', icon: FileText, meta: `${stats.templates} template${stats.templates === 1 ? '' : 's'}` },
    { href: '/console/comms/compose', title: 'Send a message', description: 'Write to applicants or grantees by opportunity, status or program. You confirm the count before anything is sent.', icon: Send, meta: stats.drafts ? `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} waiting` : 'No drafts' },
    { href: '/console/comms/rules', title: 'Notification rules', description: 'Automatic emails and in-app notices for submissions, reports, payments and more.', icon: BellRing, meta: `${stats.rules} rule${stats.rules === 1 ? '' : 's'} on` },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader title="Messages & email" description="Everything GMS sends on your behalf, in one place." />

      <section aria-label="Last 30 days" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Templates" value={stats.templates} />
        <StatTile label="Drafts" value={stats.drafts} />
        <StatTile label="Messages sent (30 days)" value={stats.sent} footnote={`${stats.people.toLocaleString('en-US')} recipients`} />
        <StatTile label="Bounces (30 days)" value={stats.bounced} footnote={stats.bounced ? 'Check addresses in the message history.' : 'No bounced emails.'} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.href} className="relative transition-colors hover:bg-muted/40">
            <CardHeader>
              <c.icon aria-hidden="true" className="mb-1 size-5 text-muted-foreground" />
              <CardTitle as="h2" className="text-base">
                <Link href={c.href} className="after:absolute after:inset-0 hover:underline">
                  {c.title}
                </Link>
              </CardTitle>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{c.meta}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
