// SPDX-License-Identifier: AGPL-3.0-only
// D-02 Conflict-of-interest gate. Shows only what gms.reviewer_queue returns (title, organization unless
// blind, opportunity) — never application content — and records the declaration (review.declare_coi).
// Already declared → no conflict: redirect to the review; conflict: the recusal confirmation.
// ?state= conflict (the "I have a conflict" choice pre-selected) | recused (the recusal confirmation)
import { sql } from '@gms/db';
import { Alert, Button, Card, CardContent, DescriptionList, NotFoundState, PageHeader } from '@gms/ui';
import { EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ReviewerFrame } from '../../frame';
import { requireReviewer, type QueueRow } from '../../guard';
import { CoiForm } from './coi-form';

export const metadata: Metadata = { title: 'Declare conflicts of interest' };

export default async function CoiPage({ params, searchParams }: { params: Promise<{ assignmentId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireReviewer()]);
  const { assignmentId } = await params;
  const forced = forcedState(await searchParams);
  if (!isUuid(assignmentId)) notFound();
  const row = await rls(async (trx) => (await sql<QueueRow>`select * from gms.reviewer_queue(${tenant.id}::uuid) where assignment_id = ${assignmentId}::uuid`.execute(trx)).rows[0] ?? null);
  const exit = { href: '/review', label: 'All assignments' };

  if (!row) {
    return (
      <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit}>
        <h1 className="sr-only">Assignment not found</h1>
        <NotFoundState variant="page" title="We couldn’t find that assignment" description="It may have been reassigned. Go back to your assignments to see what’s left." />
      </ReviewerFrame>
    );
  }

  const recused = forced === 'recused' || (forced !== 'conflict' && (row.status === 'recused' || (row.coi_declared && row.has_conflict)));
  if (!recused && row.coi_declared && !forced) redirect(`/review/${row.assignment_id}`);
  const title = row.application_title ?? row.reference_number;
  const org = row.blind || !row.organization_name ? (
    <span className="inline-flex items-center gap-1">
      <EyeOff aria-hidden="true" className="size-4" />
      Identity hidden (blind review)
    </span>
  ) : (
    row.organization_name
  );

  return (
    <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit} context={`${row.stage_name} · ${row.opportunity_title}`}>
      <PageHeader density="spacious" title={recused ? 'You’re recused from this application' : 'Before you read: any conflicts of interest?'} />
      <div className="grid gap-6">
        <Card>
          <CardContent className="pt-6">
            <DescriptionList
              items={[
                { term: 'Application', detail: title },
                { term: 'Organization', detail: org },
                { term: 'Opportunity', detail: `${row.opportunity_title} · ${row.competition_name}` },
                { term: 'Reference', detail: row.reference_number },
              ]}
            />
          </CardContent>
        </Card>

        {recused ? (
          <>
            <Alert variant="success" role="status" title="Thanks for telling us">
              You won’t see this application. The program officer has been told and will assign another reviewer. There’s nothing else you need to do.
            </Alert>
            <div>
              <Button asChild size="lg">
                <Link href="/review">Back to my assignments</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <section aria-labelledby="coi-what" className="grid gap-2 text-base leading-relaxed">
              <h2 id="coi-what" className="font-heading text-lg font-semibold">
                What counts as a conflict
              </h2>
              <p>You have a conflict if you, a family member or someone close to you could gain or lose from this decision, or if people might reasonably think so. For example, you:</p>
              <ul className="list-disc pl-6">
                <li>work for, volunteer with, or serve on the board of the organization;</li>
                <li>have a close personal or financial relationship with its staff or leaders;</li>
                <li>helped write or advise on the application, or compete with the organization for funding.</li>
              </ul>
              <p className="text-muted-foreground">When in doubt, declare it. Declaring a conflict is normal and protects you and the applicant.</p>
            </section>
            <CoiForm assignmentId={row.assignment_id} initialChoice={forced === 'conflict' ? 'conflict' : undefined} />
          </>
        )}
      </div>
    </ReviewerFrame>
  );
}
