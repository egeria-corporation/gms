// SPDX-License-Identifier: AGPL-3.0-or-later
// B-03 Organization profile & document vault (expiry nudges).
import { formatMoney } from '@gms/domain';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, DescriptionList, PageHeader, Section } from '@gms/ui';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { orgDetail } from '@/lib/portal-data';
import { Vault } from './vault';

export const metadata: Metadata = { title: 'Organization profile' };

const TYPE_LABEL: Record<string, string> = {
  nonprofit_501c3: '501(c)(3) nonprofit',
  fiscally_sponsored: 'Fiscally sponsored project',
  nonprofit_other: 'Nonprofit',
  government: 'Government',
  tribal: 'Tribal',
  school: 'School',
  for_profit: 'Business',
  individual: 'Individual',
};

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const viewer = await requireViewer();
  const d = await orgDetail(orgId);
  if (!d) notFound();
  const { org, address, docs, members } = d;
  const mine = viewer.orgs.find((o) => o.orgId === orgId);
  const today = new Date().toISOString().slice(0, 10);
  const expiring = docs.filter((x) => x.expires_on && x.expires_on <= new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
  return (
    <div className="grid gap-8 pb-16">
      <PageHeader
        density="spacious"
        title={org.legal_name}
        description="Your organization profile fills in applications automatically. Keep it current."
        meta={
          <>
            <Badge variant="neutral">{TYPE_LABEL[org.org_type] ?? org.org_type}</Badge>
            {org.ein_verified_at ? (
              <Badge variant="success">
                <ShieldCheck aria-hidden="true" /> EIN verified with IRS data
              </Badge>
            ) : org.ein ? (
              <Badge variant="warning">EIN not verified</Badge>
            ) : null}
          </>
        }
      />
      {expiring.length ? (
        <Alert variant="warning" title={`${expiring.length} document${expiring.length === 1 ? '' : 's'} expiring or expired`}>
          Upload fresh copies below so your next application isn’t held up.
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { term: 'EIN', detail: org.ein },
                { term: 'UEI', detail: org.uei },
                { term: 'Annual budget', detail: org.annual_budget_cents !== null ? formatMoney(org.annual_budget_cents, 'USD', { compact: true }) : null },
                { term: 'Website', detail: org.website },
                { term: 'Counties served', detail: org.counties.length ? org.counties.join(', ') : null },
                { term: 'Fiscal sponsor', detail: org.fiscal_sponsor_name ? `${org.fiscal_sponsor_name} (${org.fiscal_sponsor_ein ?? 'EIN missing'})` : null },
                { term: 'Mailing address', detail: address ? `${address.line1}, ${address.city}, ${address.state} ${address.postal_code}` : null },
                { term: 'Mission', detail: org.mission, wide: true },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              People
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>
                    {m.full_name ?? m.email}
                    <span className="block text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <Badge variant="neutral">{m.role === 'org_admin' ? 'Admin' : 'Collaborator'}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Section title="Document vault" description="Store your determination letter, audits and budgets once. Files are private and scanned when a scanner is configured.">
        <Vault
          orgId={org.id}
          today={today}
          canEdit={mine?.role === 'org_admin'}
          docs={docs.map((x) => ({ id: x.id, title: x.title, docType: x.doc_type, sizeBytes: x.size_bytes, scanStatus: x.scan_status, expiresOn: x.expires_on, createdAt: x.created_at }))}
        />
      </Section>
    </div>
  );
}
