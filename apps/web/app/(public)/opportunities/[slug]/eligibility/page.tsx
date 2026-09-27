// SPDX-License-Identifier: AGPL-3.0-only
// A-04 Eligibility pre-check (no account; states: pass, kind knock-out).
import { NextLink } from '@/components/next-link';
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EligibilityCheck, type RuleView } from '@/components/public/eligibility-check';
import { eligibilityRules, getOpportunity } from '@/lib/public-data';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Check eligibility' };

export default async function EligibilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await requireTenant();
  const o = await getOpportunity(tenant, (await params).slug);
  if (!o) notFound();
  const rules = await eligibilityRules(o.id);
  const views: RuleView[] = rules.map((r) => {
    const c = (r.config ?? {}) as { options?: string[]; unit?: string };
    return { id: r.id, question: r.question, helpText: r.help_text, kind: r.kind as RuleView['kind'], options: c.options ?? [], unit: c.unit ?? null };
  });
  return (
    <div className="mx-auto grid max-w-2xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[
          { label: 'Opportunities', href: '/opportunities' },
          { label: o.title, href: `/opportunities/${o.slug}` },
          { label: 'Eligibility' },
        ]}
        title="Can we apply?"
        description={`A few quick questions about ${o.title}. No account needed, and we don’t save your answers.`}
      />
      {views.length ? (
        <EligibilityCheck opportunityId={o.id} slug={o.slug} rules={views} open={o.status === 'open'} />
      ) : (
        <p>This opportunity has no eligibility questions. Read the guidelines on the opportunity page.</p>
      )}
    </div>
  );
}
