// SPDX-License-Identifier: AGPL-3.0-only
// R-01 rubric builder — new rubric.
// ?state= weights-invalid (starts with criteria whose weights total 90%, so the live total warns and Save is blocked)
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { NextLink } from '@/components/next-link';
import { RubricBuilder, type RubricBuilderValue } from '@/components/console/grantmaking/review/rubric-builder';
import { requireStaff } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'New rubric' };

export default async function NewRubricPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer'])]);
  const forced = forcedState(await searchParams);
  const initial: RubricBuilderValue =
    forced === 'weights-invalid'
      ? {
          name: 'Full proposal rubric',
          description: '',
          criteria: [
            { label: 'Alignment with the fund’s priorities', guidance: null, weightPct: 50, scaleMin: 1, scaleMax: 5, scaleLabels: { '1': 'Weak', '5': 'Strong' } },
            { label: 'Budget is realistic', guidance: null, weightPct: 40, scaleMin: 1, scaleMax: 5, scaleLabels: {} },
          ],
        }
      : { name: '', description: '', criteria: [] };
  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="New rubric"
        description="List what reviewers score. Weights must add up to 100%."
        breadcrumbs={[{ label: 'Review', href: '/console/review' }, { label: 'New rubric' }]}
        linkComponent={NextLink}
      />
      <RubricBuilder initial={initial} locked={false} canEdit />
    </div>
  );
}
