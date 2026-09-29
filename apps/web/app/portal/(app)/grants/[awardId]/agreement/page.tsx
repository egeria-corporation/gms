// SPDX-License-Identifier: AGPL-3.0-or-later
// B-10 (accept & sign): review the award letter/agreement PDF and click-to-sign.
import { agreementAttestation } from '@gms/actions/modules';
import { formatInZone } from '@gms/domain';
import { Alert, Button, PageHeader } from '@gms/ui';
import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';
import { SignForm } from './sign-form';

export const metadata: Metadata = { title: 'Sign your grant agreement' };

export default async function AgreementPage({ params }: { params: Promise<{ awardId: string }> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { awardId } = await params;
  const d = await rls(async (trx) => {
    const award = await trx.selectFrom('awards').select(['id', 'reference', 'title', 'applicant_org_id']).where('id', '=', awardId).executeTakeFirst();
    if (!award) return null;
    const agreement = await trx.selectFrom('agreements').select(['id', 'status', 'document_hash', 'sent_at']).where('award_id', '=', awardId).where('status', '!=', 'void').orderBy('created_at', 'desc').executeTakeFirst();
    const signatures = agreement
      ? await trx.selectFrom('signatures').select(['signer_role', 'typed_name', 'signed_at']).where('agreement_id', '=', agreement.id).execute()
      : [];
    return { award, agreement, signatures };
  });
  if (!d?.agreement) notFound();
  const { award, agreement, signatures } = d;
  const isAdmin = viewer.orgs.some((o) => o.orgId === award.applicant_org_id && o.role === 'org_admin');
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Grants & reports', href: '/portal/grants' }, { label: award.reference, href: `/portal/grants/${award.id}` }, { label: 'Agreement' }]}
        title="Your grant agreement"
        description={`${award.title} · ${award.reference}`}
      />
      <div className="grid gap-3 rounded-xl border bg-card p-5">
        <p>Please read the full award letter and agreement before signing.</p>
        <Button asChild variant="secondary" className="justify-self-start">
          <a href={`/portal/grants/${award.id}/agreement/pdf`} target="_blank" rel="noopener">
            <FileText aria-hidden="true" /> Open the agreement (PDF)
          </a>
        </Button>
      </div>
      {signatures.length ? (
        <ul className="grid gap-2">
          {signatures.map((s) => (
            <li key={s.signer_role} className="rounded-lg border bg-card p-3 text-sm">
              <strong>{s.signer_role === 'grantee' ? 'Signed for your organization' : `Countersigned for ${tenant.brand.displayName}`}</strong> by {s.typed_name} on {formatInZone(s.signed_at, tenant.timezone)}
            </li>
          ))}
        </ul>
      ) : null}
      {agreement.status === 'sent' && agreement.document_hash ? (
        isAdmin ? (
          <SignForm agreementId={agreement.id} awardId={award.id} documentHash={agreement.document_hash} attestation={agreementAttestation()} signerHint={`Signing as ${viewer.name}. Only an organization admin can sign.`} />
        ) : (
          <Alert variant="info" title="An organization admin needs to sign">
            Ask an admin of your organization to sign in and sign this agreement.
          </Alert>
        )
      ) : agreement.status === 'signed' ? (
        <Alert variant="success" title="You signed this agreement">The foundation will countersign it soon.</Alert>
      ) : agreement.status === 'countersigned' ? (
        <Alert variant="success" title="Fully signed">Both sides have signed. Keep a copy for your records.</Alert>
      ) : (
        <Alert variant="info" title="Not ready to sign yet">The foundation is still preparing your agreement.</Alert>
      )}
    </div>
  );
}
