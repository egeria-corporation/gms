// SPDX-License-Identifier: AGPL-3.0-or-later
// B-12 Extension / amendment / budget-change request.
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { rls } from '@/lib/server/db';
import { ChangeRequestForm } from './change-request-form';

export const metadata: Metadata = { title: 'Request a change' };

export default async function NewChangeRequest({ params }: { params: Promise<{ awardId: string }> }) {
  const { awardId } = await params;
  const d = await rls(async (trx) => {
    const award = await trx.selectFrom('awards').select(['id', 'reference', 'title']).where('id', '=', awardId).executeTakeFirst();
    const reports = await trx.selectFrom('report_requirements').select(['id', 'title', 'due_date']).where('award_id', '=', awardId).where('status', 'not in', ['accepted', 'submitted']).orderBy('due_date').execute();
    return award ? { award, reports } : null;
  });
  if (!d) notFound();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Grants & reports', href: '/portal/grants' }, { label: d.award.reference, href: `/portal/grants/${d.award.id}` }, { label: 'Request a change' }]}
        title="Request a change"
        description="Things change — that’s normal. Tell us what you need and we’ll get back to you, usually within a week."
      />
      <ChangeRequestForm awardId={d.award.id} reports={d.reports.map((r) => ({ id: r.id, title: r.title, dueDate: r.due_date }))} />
    </div>
  );
}
