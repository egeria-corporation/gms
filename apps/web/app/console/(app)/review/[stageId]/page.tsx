// SPDX-License-Identifier: AGPL-3.0-only
// R-03 Review stage progress: per reviewer (assigned, not started, in progress, submitted, recused) and per
// application (each reviewer's status and weighted score, the average); reopen a submitted review.
// ?state= empty (no assignments) | complete (every review shown as submitted) | error
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DeadlineChip, EmptyState, ErrorState, NotFoundState, PageHeader, Progress, StatTile, StatusChip, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { EyeOff, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmActionButton } from '@/components/console/grantmaking/run-action';
import { fmtScore, mean, stageMeta } from '@/components/console/grantmaking/review/meta';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { reopenReviewAction } from '../actions';
import { appLabel, loadStage, loadStageApplications, loadStageAssignments, type StageAssignment } from './data';

export const metadata: Metadata = { title: 'Review progress' };

const EDIT_ROLES: readonly string[] = ['owner', 'admin', 'program_officer'];

export default async function StageProgressPage({ params, searchParams }: { params: Promise<{ stageId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const { stageId } = await params;
  const forced = forcedState(await searchParams);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));

  const data = await rls(async (trx) => {
    const stage = await loadStage(trx, tenant.id, stageId);
    if (!stage) return { stage: null } as const;
    const [apps, assignments] = await Promise.all([loadStageApplications(trx, tenant.id, stage, { includeAssigned: true }), loadStageAssignments(trx, tenant.id, stage.id)]);
    return { stage, apps, assignments } as const;
  }).catch((err: unknown) => {
    console.error('[review] R-03 load failed', err);
    return null;
  });

  const crumbs = [{ label: 'Review', href: '/console/review' }, { label: data?.stage?.name ?? 'Stage' }];
  if (!data || forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Review progress" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load this review stage. Nothing was changed. Refresh to try again." />
      </div>
    );
  }
  if (!data.stage) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Stage not found" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState title="We couldn’t find that review stage" description="It may have been removed." />
      </div>
    );
  }
  const { stage } = data;
  let assignments: StageAssignment[] = forced === 'empty' ? [] : data.assignments;
  if (forced === 'complete') {
    assignments = assignments
      .filter((a) => a.status !== 'recused')
      .map((a) => ({ ...a, status: 'submitted', review: a.review ? { ...a.review, status: 'submitted' } : { id: a.id, status: 'submitted', weightedScore: null, recommendation: null, submittedAt: null } }));
  }

  const active = assignments.filter((a) => a.status !== 'recused');
  const submitted = active.filter((a) => a.status === 'submitted').length;
  const complete = active.length > 0 && submitted === active.length;

  // Per reviewer.
  const byReviewer = new Map<string, { name: string; counts: Record<string, number> }>();
  for (const a of assignments) {
    const r = byReviewer.get(a.reviewerId) ?? { name: a.reviewerName, counts: { not_started: 0, in_progress: 0, submitted: 0, recused: 0 } };
    r.counts[a.status] = (r.counts[a.status] ?? 0) + 1;
    byReviewer.set(a.reviewerId, r);
  }
  const reviewers = [...byReviewer.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name));

  // Per application (only apps with assignments, in application order).
  const assignedApps = data.apps.filter((a) => assignments.some((x) => x.applicationId === a.id));

  const header = (
    <PageHeader
      title={stage.name}
      description={`${stage.opportunityTitle} · ${stage.competitionName}${stage.rubricName ? ` · Rubric: ${stage.rubricName}` : ' · No rubric'}`}
      breadcrumbs={crumbs}
      linkComponent={NextLink}
      meta={
        <>
          <StatusChip meta={stageMeta(stage.status)} />
          {stage.blind ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <EyeOff aria-hidden="true" className="size-3.5" />
              Blind
            </span>
          ) : null}
          {stage.dueAt ? <DeadlineChip at={stage.dueAt} timeZone={tenant.timezone} pastLabel="Was due" /> : null}
        </>
      }
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={`/console/review/${stage.id}/assign`}>Assign reviewers</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/console/review/${stage.id}/panel`}>Open panel view</Link>
          </Button>
        </>
      }
    />
  );

  if (!assignments.length) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent>
            <EmptyState
              title="No reviewers assigned yet"
              description="Assign reviewers to the applications in this competition to start the review."
              action={
                <Button asChild size="sm">
                  <Link href={`/console/review/${stage.id}/assign`}>Assign reviewers</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const recusedCount = assignments.length - active.length;
  return (
    <div className="grid gap-6">
      {header}
      {complete ? (
        <Alert variant="success" title="Every review is in">
          All {submitted} assigned reviews are submitted. Use the <Link href={`/console/review/${stage.id}/panel`}>panel view</Link> to compare scores and spot disagreements.
        </Alert>
      ) : null}

      <section aria-label="Stage totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Applications" value={assignedApps.length} />
        <StatTile label="Assigned reviews" value={active.length} footnote={recusedCount ? `${recusedCount} recused` : undefined} />
        <StatTile label="Submitted" value={submitted} />
        <StatTile label="Complete" value={`${active.length ? Math.round((submitted / active.length) * 100) : 0}%`} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Progress by reviewer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption className="sr-only">Assignments per reviewer by status</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Reviewer</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Not started</TableHead>
                <TableHead className="text-right">In progress</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Recused</TableHead>
                <TableHead className="min-w-40">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewers.map(([id, r]) => {
                const total = (r.counts.not_started ?? 0) + (r.counts.in_progress ?? 0) + (r.counts.submitted ?? 0);
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{total}</TableCell>
                    <TableCell className="text-right">{r.counts.not_started ?? 0}</TableCell>
                    <TableCell className="text-right">{r.counts.in_progress ?? 0}</TableCell>
                    <TableCell className="text-right">{r.counts.submitted ?? 0}</TableCell>
                    <TableCell className="text-right">{r.counts.recused ?? 0}</TableCell>
                    <TableCell>
                      <Progress value={r.counts.submitted ?? 0} max={Math.max(total, 1)} label={`${r.name}: ${r.counts.submitted ?? 0} of ${total} submitted`} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Progress by application
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table containerLabel="Progress by application">
            <TableCaption className="sr-only">Each reviewer’s status and weighted score (0–100) per application</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Reviews</TableHead>
                <TableHead className="text-right">Average</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignedApps.map((app) => {
                const rows = assignments.filter((a) => a.applicationId === app.id);
                const scores = rows.filter((a) => a.status === 'submitted' && a.review?.weightedScore !== null && a.review?.weightedScore !== undefined).map((a) => a.review!.weightedScore!);
                const avg = mean(scores);
                return (
                  <TableRow key={app.id}>
                    <TableCell className="align-top">
                      <Link href={`/console/applications/${app.id}`} className="font-medium hover:underline">
                        {appLabel(app)}
                      </Link>
                      {app.orgName ? <span className="block text-xs text-muted-foreground">{app.orgName}</span> : null}
                    </TableCell>
                    <TableCell>
                      <ul className="grid gap-1.5">
                        {rows.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-28">{a.reviewerName}</span>
                            <StatusChip kind="review" value={a.status} size="sm" />
                            <span className="tabular-nums text-muted-foreground">{a.review?.weightedScore !== null && a.review?.weightedScore !== undefined ? `${fmtScore(a.review.weightedScore)} / 100` : ''}</span>
                            {canEdit && a.status === 'submitted' && forced !== 'complete' ? (
                              <ConfirmActionButton
                                label="Reopen"
                                icon={<RotateCcw aria-hidden="true" />}
                                variant="ghost"
                                title={`Reopen ${a.reviewerName}’s review?`}
                                description="The reviewer can change scores and comments, then must submit again. Their current scores stay until they do."
                                confirmLabel="Reopen review"
                                success="Review reopened."
                                action={reopenReviewAction.bind(null, stage.id, a.id)}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      {fmtScore(avg)}
                      <span className="block text-xs text-muted-foreground">
                        {scores.length} of {rows.filter((r) => r.status !== 'recused').length} scored
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
