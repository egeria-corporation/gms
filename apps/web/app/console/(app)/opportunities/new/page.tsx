// SPDX-License-Identifier: AGPL-3.0-only
// C-04 New opportunity: the Details form; saving creates a draft with a first stage and opens the full editor
// (eligibility, stages & forms, distribution).
// ?state= saving-error (shows how a failed save looks)
import { Alert, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { DetailsForm } from '@/components/console/grantmaking/opportunities/details-form';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { detailsOf, loadPrograms, loadTerms } from '../data';

export const metadata: Metadata = { title: 'New opportunity' };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer'])]);
  const forced = forcedState(await searchParams);
  const { programs, terms } = await rls(async (trx) => {
    const [programs, terms] = await Promise.all([loadPrograms(trx, tenant.id), loadTerms(trx, tenant.id)]);
    return { programs, terms };
  });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="New opportunity"
        description="Start with the basics. After you save the draft you can add eligibility questions, stages and forms. Nothing is public until you publish."
        breadcrumbs={[
          { label: 'Console', href: '/console' },
          { label: 'Opportunities', href: '/console/opportunities' },
          { label: 'New' },
        ]}
        linkComponent={NextLink}
      />
      {forced === 'saving-error' ? <Alert variant="info">Demo state: this shows how a failed save looks.</Alert> : null}
      <DetailsForm opportunityId={null} initial={detailsOf(null, tenant.timezone)} programs={programs} terms={terms} timeZone={tenant.timezone} readOnly={false} forcedSaveError={forced === 'saving-error'} />
    </div>
  );
}
