// SPDX-License-Identifier: AGPL-3.0-only
// B-11 Grant report submission (autosave; revisions requested; submitted/accepted read-only).
import { formatDateOnly } from '@gms/domain';
import { Alert, Button, PageHeader, StatusChip } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { ReportForm } from './report-form';

export const metadata: Metadata = { title: 'Grant report' };

export default async function ReportPage({ params }: { params: Promise<{ awardId: string; reqId: string }> }) {
  const viewer = await requireViewer();
  const { awardId, reqId } = await params;
  const d = await rls(async (trx) => {
    const req = await trx
      .selectFrom('report_requirements as r')
      .innerJoin('awards as a', 'a.id', 'r.award_id')
      .select(['r.id', 'r.title', 'r.due_date', 'r.status', 'r.form_id', 'a.reference', 'a.title as award_title'])
      .where('r.id', '=', reqId)
      .where('r.award_id', '=', awardId)
      .executeTakeFirst();
    if (!req) return null;
    const version = req.form_id
      ? await trx.selectFrom('forms as f').innerJoin('form_versions as v', 'v.id', 'f.current_version_id').select(['v.builder_model']).where('f.id', '=', req.form_id).executeTakeFirst()
      : undefined;
    const sub = await trx.selectFrom('report_submissions').select(['data', 'status', 'review_note']).where('requirement_id', '=', reqId).orderBy('created_at', 'desc').executeTakeFirst();
    return { req, version, sub };
  });
  if (!d) notFound();
  const { req, version, sub } = d;
  const readOnly = req.status === 'submitted' || req.status === 'accepted';
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[
          { label: 'Grants & reports', href: '/portal/grants' },
          { label: req.reference, href: `/portal/grants/${awardId}` },
          { label: req.title },
        ]}
        title={req.title}
        description={`${req.award_title} · due ${formatDateOnly(req.due_date)}`}
        meta={<StatusChip kind="report" value={req.status} />}
      />
      {req.status === 'revisions_requested' && sub?.review_note ? (
        <Alert variant="warning" title="The foundation asked for changes">
          <p className="whitespace-pre-wrap">{sub.review_note}</p>
        </Alert>
      ) : null}
      {req.status === 'overdue' ? (
        <Alert variant="danger" title="This report is overdue">
          Please submit it as soon as you can. Some payments wait until it’s in. Need more time?{' '}
          <Link className="underline" href={`/portal/grants/${awardId}/requests/new`}>
            Ask for an extension
          </Link>
          .
        </Alert>
      ) : null}
      {version ? (
        <ReportForm requirementId={req.id} awardId={awardId} model={version.builder_model} initialData={(sub?.data ?? {}) as Record<string, unknown>} readOnly={readOnly} signerName={viewer.name} />
      ) : (
        <Alert variant="info" title="No report form yet">
          The foundation hasn’t attached a form to this report. They’ll contact you.
          <Button asChild variant="secondary" className="mt-3">
            <Link href={`/portal/grants/${awardId}`}>Back to your grant</Link>
          </Button>
        </Alert>
      )}
    </div>
  );
}
