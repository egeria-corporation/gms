// SPDX-License-Identifier: AGPL-3.0-only
// S-03 Integrations: Mercury (bank), email sending domain with DNS records, SSO (flag-gated), OpenGrants
// syndication (states: dns-pending, dns-verified).
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Switch, ToneChip } from '@gms/ui';
import { CircleCheck, CircleDashed, Clock, Landmark, Lock, Mail, Share2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { EmailDomainForm, SyndicationToggle } from './integrations-forms';

export const metadata: Metadata = { title: 'Integrations' };

type DomainStatus = 'unverified' | 'pending' | 'verified';

function dnsRecords(domain: string) {
  return [
    { purpose: 'SPF', type: 'TXT', host: `send.${domain}`, value: 'v=spf1 include:amazonses.com ~all', note: 'Lets your email provider send for this domain.' },
    { purpose: 'Bounce handling', type: 'MX', host: `send.${domain}`, value: '10 feedback-smtp.us-east-1.amazonses.com', note: 'Returns bounces so GMS can mark them.' },
    { purpose: 'DKIM', type: 'TXT', host: `resend._domainkey.${domain}`, value: 'p=<public key from your email provider>', note: 'Signs every message. Copy the exact key from your provider’s dashboard.' },
    { purpose: 'DMARC', type: 'TXT', host: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`, note: 'Tells inboxes what to do with unsigned mail. Start with p=none.' },
  ];
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';
  const { settings, bank } = await rls(async (trx) => ({
    settings: await trx.selectFrom('workspace_settings').select(['email_domain', 'email_domain_status', 'sso_enabled', 'opengrants_syndication']).where('workspace_id', '=', tenant.id).executeTakeFirst(),
    bank: await trx.selectFrom('bank_connections').select(['provider', 'mode', 'environment', 'status', 'last_synced_at']).where('workspace_id', '=', tenant.id).orderBy('created_at', 'desc').executeTakeFirst(),
  }));
  let domain = settings?.email_domain ?? null;
  let status = (settings?.email_domain_status ?? 'unverified') as DomainStatus;
  if (forced === 'dns-pending' || forced === 'dns-verified') {
    domain ??= `grants.${tenant.slug}.example`;
    status = forced === 'dns-pending' ? 'pending' : 'verified';
  }
  const setupChoice = Object.entries(tenant.flags).find(([k, v]) => k.startsWith('setup_payments_') && v)?.[0]?.replace('setup_payments_', '');
  const ssoFlag = Boolean(tenant.flags.sso_enabled);
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(new Date(iso));

  return (
    <div className="grid gap-4">
      <PageHeader title="Integrations" description="Connect your bank, send email from your own domain, and choose where your opportunities appear." />
      <SettingsTabs current="/console/settings/integrations" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-base">
              <Landmark aria-hidden="true" className="size-4" /> Mercury (bank)
            </CardTitle>
            <CardDescription>Pay grantees by ACH or check from your Mercury account. Approvals always happen in GMS and again in Mercury.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {bank ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <ToneChip tone={bank.status === 'active' ? 'success' : 'warning'} icon={bank.status === 'active' ? CircleCheck : Clock} label={bank.status === 'active' ? 'Connected' : `Connection ${bank.status.replace(/_/g, ' ')}`} size="sm" />
                  <span>
                    {bank.provider === 'mercury' ? 'Mercury' : bank.provider} · {bank.environment}
                    {bank.mode ? ` · ${bank.mode.replace(/_/g, ' ')}` : ''}
                  </span>
                </p>
                <p className="text-muted-foreground">{bank.last_synced_at ? `Last synced ${fmt(bank.last_synced_at)}.` : 'Not synced yet.'}</p>
              </>
            ) : (
              <p className="flex flex-wrap items-center gap-2">
                <ToneChip tone="muted" icon={CircleDashed} label="Not connected" size="sm" />
                {setupChoice === 'manual' ? <span>During setup you chose to pay outside GMS. You can still connect later.</span> : setupChoice === 'fake' ? <span>During setup you chose the demo bank.</span> : setupChoice === 'sandbox' ? <span>During setup you chose the Mercury sandbox.</span> : null}
              </p>
            )}
            <Button asChild variant={bank ? 'outline' : 'default'} size="sm" className="justify-self-start">
              <Link href="/console/payments/connect">{bank ? 'Manage bank connection' : 'Connect Mercury'}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-base">
              <Share2 aria-hidden="true" className="size-4" /> OpenGrants directory
            </CardTitle>
            <CardDescription>Offer your published opportunities to the OpenGrants directory so more applicants find them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <SyndicationToggle enabled={settings?.opengrants_syndication ?? false} disabled={!canEdit} />
            <p className="text-muted-foreground">
              In this version the connector is a stub: your choice is saved, but nothing is sent yet. Only public fields (title, summary, dates, amounts, eligibility) would ever be shared.
            </p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-base">
              <Mail aria-hidden="true" className="size-4" /> Email sending domain
            </CardTitle>
            <CardDescription>
              Until your domain is verified, emails are sent from the GMS address with “{tenant.brand.displayName}” as the sender name and replies going to your reply-to address.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <EmailDomainForm domain={settings?.email_domain ?? null} disabled={!canEdit} />
            {domain ? (
              <>
                <p className="flex flex-wrap items-center gap-2" data-testid="dns-status">
                  <span className="font-medium">{domain}</span>
                  {status === 'verified' ? (
                    <ToneChip tone="success" icon={CircleCheck} label="Verified" size="sm" />
                  ) : status === 'pending' ? (
                    <ToneChip tone="warning" icon={Clock} label="Waiting for DNS records" size="sm" />
                  ) : (
                    <ToneChip tone="muted" icon={CircleDashed} label="Not verified" size="sm" />
                  )}
                </p>
                <p className="text-muted-foreground">
                  {status === 'verified'
                    ? 'Your records are in place. Emails now come from your domain.'
                    : 'Add these records at your DNS host (where you bought the domain). Changes can take up to 48 hours to be checked. Values in angle brackets come from your email provider.'}
                </p>
                <div className="overflow-x-auto rounded-lg border" role="region" aria-label="DNS records to add" tabIndex={0}>
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">DNS records for {domain}</caption>
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Purpose</th>
                        <th scope="col" className="px-3 py-2 font-medium">Type</th>
                        <th scope="col" className="px-3 py-2 font-medium">Host / name</th>
                        <th scope="col" className="px-3 py-2 font-medium">Value</th>
                        <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {dnsRecords(domain).map((r) => (
                        <tr key={`${r.type}-${r.host}`}>
                          <th scope="row" className="px-3 py-2 align-top font-medium">
                            {r.purpose}
                            <span className="block text-xs font-normal text-muted-foreground">{r.note}</span>
                          </th>
                          <td className="px-3 py-2 align-top font-mono">{r.type}</td>
                          <td className="px-3 py-2 align-top font-mono break-all">{r.host}</td>
                          <td className="px-3 py-2 align-top font-mono break-all">{r.value}</td>
                          <td className="px-3 py-2 align-top">
                            {status === 'verified' ? <ToneChip tone="success" icon={CircleCheck} label="Found" size="sm" /> : <ToneChip tone="warning" icon={Clock} label="Not found yet" size="sm" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-base">
              <Lock aria-hidden="true" className="size-4" /> Single sign-on (SSO)
            </CardTitle>
            <CardDescription>Let staff sign in with your organization’s identity provider (SAML 2.0, e.g. Okta, Microsoft Entra ID, Google Workspace).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="block font-medium">Require SSO for staff</span>
                <span className="block text-muted-foreground">{ssoFlag ? 'Available for this workspace. Your platform operator configures the identity provider.' : 'Not available on this deployment yet.'}</span>
              </span>
              <Switch checked={settings?.sso_enabled ?? false} disabled aria-describedby="sso-why" />
            </label>
            <p id="sso-why" className="text-muted-foreground">
              SSO uses Supabase Auth’s SAML support, which needs a paid Supabase plan. It’s turned on per workspace by your platform operator (feature flag <code className="rounded bg-muted px-1">sso_enabled</code>
              {ssoFlag ? <Badge variant="success" className="ml-1">on</Badge> : <Badge variant="neutral" className="ml-1">off</Badge>}). Until then, staff sign in with an email link and an authenticator app.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
