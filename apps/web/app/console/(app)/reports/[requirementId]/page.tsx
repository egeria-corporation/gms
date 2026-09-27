// SPDX-License-Identifier: AGPL-3.0-only
// PA-02 Report review: the submitted answers (read-only, from the form version's field_meta), indicator capture,
// accept / request revisions, and this grant's change requests.
// ?state= (non-production): submitted · accepted · revisions · not-submitted · error
import { formatDateOnly, formatInZone } from '@gms/domain';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, DescriptionList, ErrorState, PageHeader, StatusChip } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnswersList, toFieldMeta } from '@/components/console/answers-list';
import { AwardHoldControl, ReportHoldSwitch } from '@/components/console/finance/award-hold';
import { can, PROGRAM_READ, PROGRAM_WRITE, type SearchParams } from '@/components/console/finance/params';
import { ChangeRequests, ReportReviewForm, type ChangeRequestView, type IndicatorInput } from '@/components/console/finance/report-review';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Report review' };

const FORCED: Record<string, string> = { submitted: 'submitted', accepted: 'accepted', revisions: 'revisions_requested', 'not-submitted': 'due' };

export default async function ReportReviewPage({ params, searchParams }: { params: Promise<{ requirementId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(PROGRAM_READ)]);
  const { requirementId } = await params;
  const forced = forcedState(await searchParams);
  const breadcrumbs = [{ label: 'Reports', href: '/console/reports' }, { label: 'Report' }];
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Report" breadcrumbs={breadcrumbs} linkComponent={NextLink} />
        <ErrorState title="We couldn’t load this report" description="Refresh to try again." />
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(requirementId)) notFound();
  const d = await rls(async (trx) => {
    const req = await trx
      .selectFrom('report_requirements as r')
      .innerJoin('awards as a', 'a.id', 'r.award_id')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('programs as p', 'p.id', 'a.program_id')
      .select([
        'r.id',
        'r.title',
        'r.kind',
        'r.due_date',
        'r.status',
        'r.holds_payments',
        'r.form_id',
        'a.id as award_id',
        'a.reference',
        'a.title as award_title',
        'a.program_id',
        'a.on_hold',
        'a.hold_reason',
        'o.legal_name',
        'p.name as program_name',
      ])
      .where('r.id', '=', requirementId)
      .where('r.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!req) return null;
    const submission = await trx
      .selectFrom('report_submissions as s')
      .leftJoin('profiles as u', 'u.id', 's.submitted_by')
      .leftJoin('profiles as rv', 'rv.id', 's.reviewer_id')
      .select(['s.id', 's.status', 's.data', 's.form_version_id', 's.submitted_at', 's.submitted_by_agent_client_id', 's.review_note', 's.reviewed_at', 'u.full_name as submitter', 'rv.full_name as reviewer'])
      .where('s.requirement_id', '=', req.id)
      .orderBy('s.created_at', 'desc')
      .executeTakeFirst();
    const versionId =
      submission?.form_version_id ??
      (req.form_id ? (await trx.selectFrom('forms').select('current_version_id').where('id', '=', req.form_id).executeTakeFirst())?.current_version_id : null) ??
      null;
    const [version, indicators, values, changes] = await Promise.all([
      versionId ? trx.selectFrom('form_versions').select(['field_meta', 'version']).where('id', '=', versionId).executeTakeFirst() : Promise.resolve(undefined),
      trx
        .selectFrom('indicators')
        .select(['id', 'name', 'unit', 'description'])
        .where('workspace_id', '=', tenant.id)
        .where((eb) => (req.program_id ? eb.or([eb('program_id', '=', req.program_id), eb('program_id', 'is', null)]) : eb('program_id', 'is', null)))
        .orderBy('name')
        .execute(),
      submission
        ? trx.selectFrom('indicator_values as v').innerJoin('indicators as i', 'i.id', 'v.indicator_id').select(['v.id', 'i.name', 'i.unit', 'v.value', 'v.period_end']).where('v.report_submission_id', '=', submission.id).execute()
        : Promise.resolve([]),
      trx
        .selectFrom('change_requests as c')
        .leftJoin('profiles as u', 'u.id', 'c.requested_by')
        .leftJoin('report_requirements as r', 'r.id', 'c.requirement_id')
        .select(['c.id', 'c.kind', 'c.reason', 'c.status', 'c.created_at', 'c.details', 'c.decision_note', 'c.requested_by_agent_client_id', 'u.full_name', 'r.title as requirement_title'])
        .where('c.award_id', '=', req.award_id)
        .orderBy('c.created_at', 'desc')
        .execute(),
    ]);
    return { req, submission, version, indicators, values, changes };
  });
  if (!d) notFound();
  const { req, submission } = d;
  const status = (forced && FORCED[forced]) || req.status;
  const hasSubmission = forced === 'not-submitted' ? false : Boolean(submission && submission.status !== 'draft');
  const fieldMeta = toFieldMeta(d.version?.field_meta);
  const data = (submission?.data ?? {}) as Record<string, unknown>;
  const attestation = data._attestation as { typedName?: string; at?: string } | undefined;
  const canReview = can(viewer.role, PROGRAM_WRITE);
  const indicators: IndicatorInput[] = d.indicators.map((i) => {
    const key = Object.entries(fieldMeta).find(([, m]) => m.indicator && (m.indicator === i.id || m.indicator.toLowerCase() === i.name.toLowerCase()))?.[0];
    const raw = key ? data[key] : undefined;
    return { id: i.id, name: i.name, unit: i.unit, description: i.description, suggested: typeof raw === 'number' ? raw : null };
  });
  const changes: ChangeRequestView[] = d.changes.map((c) => ({
    id: c.id,
    kind: c.kind,
    reason: c.reason,
    status: c.status,
    createdAt: c.created_at,
    requestedBy: c.full_name,
    viaAgent: Boolean(c.requested_by_agent_client_id),
    decisionNote: c.decision_note,
    details: (c.details ?? {}) as ChangeRequestView['details'],
    requirementTitle: c.requirement_title,
  }));
  const pendingChanges = changes.filter((c) => c.status === 'pending').length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={req.title}
        breadcrumbs={[breadcrumbs[0]!, { label: req.title }]}
        linkComponent={NextLink}
        meta={
          <>
            <StatusChip kind="report" value={status} />
            {req.on_hold ? <StatusChip kind="awardFlag" value="on_hold" /> : null}
            {pendingChanges ? <Badge variant="warning">{pendingChanges} change request{pendingChanges === 1 ? '' : 's'}</Badge> : null}
          </>
        }
        description={
          <>
            <Link href={`/console/awards/${req.award_id}`} className="hover:underline">
              {req.reference} · {req.award_title}
            </Link>{' '}
            · {req.legal_name ?? 'Grantee'} · due {formatDateOnly(req.due_date)}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle as="h2" className="text-base">
                Submitted report
              </CardTitle>
              {hasSubmission && submission?.submitted_at ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {submission.submitted_by_agent_client_id ? <Badge variant="agent">Via agent</Badge> : null}
                  Submitted {formatInZone(submission.submitted_at, tenant.timezone)}
                  {submission.submitter ? ` by ${submission.submitter}` : ''}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4">
              {hasSubmission ? (
                <>
                  <AnswersList fieldMeta={fieldMeta} data={data} />
                  {attestation?.typedName ? (
                    <p className="text-xs text-muted-foreground">
                      Attested by “{attestation.typedName}”{attestation.at ? ` on ${formatInZone(attestation.at, tenant.timezone)}` : ''}.
                    </p>
                  ) : null}
                </>
              ) : (
                <Alert variant={status === 'overdue' ? 'danger' : 'info'} title={status === 'overdue' ? 'Overdue — nothing submitted yet' : 'Not submitted yet'}>
                  {status === 'overdue'
                    ? `This report was due ${formatDateOnly(req.due_date)}. Reminders go out automatically; you can also message the grantee.`
                    : `Due ${formatDateOnly(req.due_date)}. The grantee fills it in from their portal.`}
                </Alert>
              )}
            </CardContent>
          </Card>
          {d.values.length ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">
                  Recorded indicators
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList items={d.values.map((v) => ({ term: `${v.name}${v.period_end ? ` (to ${formatDateOnly(v.period_end)})` : ''}`, detail: `${v.value.toLocaleString('en-US')} ${v.unit}`, numeric: true }))} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status === 'submitted' && hasSubmission ? (
                canReview ? (
                  <ReportReviewForm requirementId={req.id} indicators={indicators} periodEnd={req.due_date} granteeName={req.legal_name ?? 'The grantee'} />
                ) : (
                  <p className="text-sm text-muted-foreground">A program officer reviews this report.</p>
                )
              ) : status === 'accepted' ? (
                <Alert variant="success" title="Accepted">
                  {submission?.reviewer ? `${submission.reviewer} accepted it` : 'Accepted'}
                  {submission?.reviewed_at ? ` on ${formatInZone(submission.reviewed_at, tenant.timezone)}` : ''}.{submission?.review_note ? ` Note: “${submission.review_note}”` : ''}
                </Alert>
              ) : status === 'revisions_requested' ? (
                <Alert variant="warning" title="Revisions requested">
                  {submission?.review_note ? `“${submission.review_note}”` : 'Waiting for the grantee to resubmit.'}
                </Alert>
              ) : (
                <p className="text-sm text-muted-foreground">You can review the report once it’s submitted.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Payment holds
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ReportHoldSwitch requirementId={req.id} title={req.title} holdsPayments={req.holds_payments} canWrite={canReview} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Award:</span>
                {req.on_hold ? <StatusChip kind="awardFlag" value="on_hold" size="sm" /> : <Badge variant="muted">Paying normally</Badge>}
                <AwardHoldControl awardId={req.award_id} reference={req.reference} onHold={req.on_hold} reason={req.hold_reason} canWrite={canReview} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Change requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChangeRequests items={changes} canDecide={canReview} requirementId={req.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
