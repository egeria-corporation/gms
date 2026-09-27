// SPDX-License-Identifier: AGPL-3.0-only
// B-08 Submission receipt (reference number + timestamp; receipt email sent).
import { formatInZone } from '@gms/domain';
import { Alert, Button, Card, CardContent, DescriptionList, PageHeader } from '@gms/ui';
import { CheckCircle2, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Application submitted' };

export default async function SubmittedPage({ params }: { params: Promise<{ id: string }> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { id } = await params;
  const d = await rls(async (trx) => {
    const app = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'o.title as opp_title', 'o.decision_expected_on'])
      .where('a.id', '=', id)
      .executeTakeFirst();
    const sub = await trx.selectFrom('application_submissions').select(['receipt_number', 'submitted_at', 'content_hash']).where('application_id', '=', id).orderBy('submitted_at', 'desc').executeTakeFirst();
    return app && sub ? { app, sub } : null;
  });
  if (!d) notFound();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-8 pb-16">
      <PageHeader density="spacious" title="Your application is in" description={`${d.app.opp_title} · ${tenant.brand.displayName}`} />
      <Alert variant="success" title="Submitted — thank you" icon={<CheckCircle2 aria-hidden="true" />}>
        We sent a receipt to {viewer.email}. Keep your receipt number in case you need to contact us.
      </Alert>
      <Card>
        <CardContent className="pt-6">
          <DescriptionList
            items={[
              { term: 'Receipt number', detail: <span className="font-mono text-lg" data-testid="receipt-number">{d.sub.receipt_number}</span> },
              { term: 'Reference', detail: d.app.reference_number },
              { term: 'Submitted', detail: formatInZone(d.sub.submitted_at, tenant.timezone) },
              { term: 'Document fingerprint', detail: <code className="break-all text-xs">{d.sub.content_hash}</code> },
            ]}
          />
        </CardContent>
      </Card>
      <section className="grid gap-2">
        <h2 className="font-heading text-lg font-semibold">What happens next</h2>
        <ol className="grid list-decimal gap-1 pl-5">
          <li>Staff check that your application is complete.</li>
          <li>Reviewers read it and score it against the published criteria.</li>
          <li>We email you when your status changes{d.app.decision_expected_on ? ` — decisions are expected by ${d.app.decision_expected_on}` : ''}.</li>
        </ol>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={`/portal/applications/${id}`}>See your application status</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <a href={`/portal/applications/${id}/packet`} download>
            <Download aria-hidden="true" /> Download a copy (PDF)
          </a>
        </Button>
      </div>
    </div>
  );
}
