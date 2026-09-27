// SPDX-License-Identifier: AGPL-3.0-only
// R-04 Panel mode: live aggregates (re-rendered every 5 s while visible — see LiveRefresh), per application
// count / mean / min / max / standard deviation of submitted weighted scores (0–100) with a variance flag,
// per-criterion means, reviewer calibration (their mean offset vs the panel), recommendation tally, panel notes
// and panel sessions.
// ?threshold=<points> sets the variance flag threshold (default 15).
// ?state= variance (lowers the threshold so disagreement is flagged) | empty (no submitted reviews) | error
import { formatInZone, toLocalInputValue } from '@gms/domain';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  NotFoundState,
  PageHeader,
  StatTile,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
} from '@gms/ui';
import { ArrowDownRight, ArrowUpRight, Minus, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/console/grantmaking/review/live-refresh';
import { fmtScore, mean, RECOMMENDATION, stageMeta } from '@/components/console/grantmaking/review/meta';
import { PanelNoteForm, PanelSessions } from '@/components/console/grantmaking/review/panel-controls';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { oneParam, stddev, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { appLabel, loadCriteria, loadStage, loadStageApplications, loadStageAssignments } from '../data';

export const metadata: Metadata = { title: 'Review panel' };

const EDIT_ROLES: readonly string[] = ['owner', 'admin', 'program_officer'];
const CALIBRATION_OFFSET = 5;

export default async function PanelPage({ params, searchParams }: { params: Promise<{ stageId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const { stageId } = await params;
  const sp = await searchParams;
  const forced = forcedState(sp);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const tParam = Number(oneParam(sp, 'threshold'));
  let threshold = Number.isFinite(tParam) && tParam > 0 && tParam <= 100 ? tParam : 15;

  const data = await rls(async (trx) => {
    const stage = await loadStage(trx, tenant.id, stageId);
    if (!stage) return { stage: null } as const;
    const [apps, assignments, criteria, panels] = await Promise.all([
      loadStageApplications(trx, tenant.id, stage, { includeAssigned: true }),
      loadStageAssignments(trx, tenant.id, stage.id),
      loadCriteria(trx, tenant.id, stage.rubricId),
      trx.selectFrom('panels').select(['id', 'name', 'status', 'meets_at']).where('workspace_id', '=', tenant.id).where('stage_id', '=', stage.id).orderBy('created_at').execute(),
    ]);
    const reviewIds = assignments.filter((a) => a.review).map((a) => a.review!.id);
    const appIds = [...new Set(assignments.map((a) => a.applicationId))];
    const [scores, notes] = await Promise.all([
      reviewIds.length ? trx.selectFrom('review_scores').select(['review_id', 'criterion_id', 'score']).where('workspace_id', '=', tenant.id).where('review_id', 'in', reviewIds).execute() : Promise.resolve([]),
      appIds.length
        ? trx
            .selectFrom('panel_notes as n')
            .leftJoin('profiles as p', 'p.id', 'n.author_id')
            .select(['n.id', 'n.application_id', 'n.body', 'n.created_at', 'n.panel_id', 'p.full_name'])
            .where('n.workspace_id', '=', tenant.id)
            .where('n.application_id', 'in', appIds)
            .orderBy('n.created_at')
            .execute()
        : Promise.resolve([]),
    ]);
    return { stage, apps, assignments, criteria, panels, scores, notes } as const;
  }).catch((err: unknown) => {
    console.error('[review] R-04 load failed', err);
    return null;
  });

  const crumbs = [
    { label: 'Review', href: '/console/review' },
    ...(data?.stage ? [{ label: data.stage.name, href: `/console/review/${data.stage.id}` }] : []),
    { label: 'Panel' },
  ];
  if (!data || forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Review panel" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load the panel. Nothing was changed. Refresh to try again." />
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
  const { stage, criteria } = data;
  const renderedAt = new Date().toISOString();
  const empty = forced === 'empty';
  const submitted = empty ? [] : data.assignments.filter((a) => a.status === 'submitted' && a.review);
  const inProgress = empty ? 0 : data.assignments.filter((a) => a.status === 'in_progress' || a.status === 'not_started').length;
  const scoresByReview = new Map<string, Map<string, number>>();
  for (const s of data.scores) {
    const m = scoresByReview.get(s.review_id) ?? new Map<string, number>();
    m.set(s.criterion_id, Number(s.score));
    scoresByReview.set(s.review_id, m);
  }

  // Per application aggregates.
  const rows = data.apps
    .map((app) => {
      const revs = submitted.filter((a) => a.applicationId === app.id);
      const ws = revs.map((a) => a.review!.weightedScore).filter((x): x is number => x !== null);
      const rec = { fund: 0, maybe: 0, decline: 0 };
      for (const r of revs) if (r.review?.recommendation && r.review.recommendation in rec) rec[r.review.recommendation as keyof typeof rec]++;
      const perCriterion = criteria.map((c) => mean(revs.map((r) => scoresByReview.get(r.review!.id)?.get(c.id)).filter((x): x is number => x !== undefined)));
      return { app, count: ws.length, mean: mean(ws), min: ws.length ? Math.min(...ws) : null, max: ws.length ? Math.max(...ws) : null, sd: stddev(ws), rec, perCriterion, reviews: revs };
    })
    .filter((r) => r.reviews.length > 0 || data.assignments.some((a) => a.applicationId === r.app.id));
  if (forced === 'variance') {
    const spread = rows.filter((r) => r.count >= 2 && r.sd > 0).map((r) => r.sd);
    threshold = spread.length ? Math.max(0.1, Math.floor(Math.min(...spread) * 10) / 10) : 0.1;
  }
  const flagged = rows.filter((r) => r.count >= 2 && r.sd >= threshold);
  const meanByApp = new Map(rows.map((r) => [r.app.id, r.mean]));

  // Calibration per reviewer: their mean score and the average offset from each application's panel mean.
  const byReviewer = new Map<string, { name: string; scores: number[]; diffs: number[] }>();
  for (const a of submitted) {
    const w = a.review!.weightedScore;
    if (w === null) continue;
    const r = byReviewer.get(a.reviewerId) ?? { name: a.reviewerName, scores: [], diffs: [] };
    r.scores.push(w);
    const pm = meanByApp.get(a.applicationId);
    const others = submitted.filter((x) => x.applicationId === a.applicationId && x.review?.weightedScore !== null).length;
    if (pm !== null && pm !== undefined && others >= 2) r.diffs.push(w - pm);
    byReviewer.set(a.reviewerId, r);
  }
  const calibration = [...byReviewer.values()].sort((x, y) => x.name.localeCompare(y.name));
  const panelMean = mean(submitted.map((a) => a.review!.weightedScore).filter((x): x is number => x !== null));
  const livePanel = data.panels.find((p) => p.status === 'live') ?? null;
  const notesByApp = new Map<string, typeof data.notes>();
  for (const n of data.notes) notesByApp.set(n.application_id, [...(notesByApp.get(n.application_id) ?? []), n]);
  const panelName = new Map(data.panels.map((p) => [p.id, p.name]));
  const totalRec = rows.reduce((t, r) => ({ fund: t.fund + r.rec.fund, maybe: t.maybe + r.rec.maybe, decline: t.decline + r.rec.decline }), { fund: 0, maybe: 0, decline: 0 });

  const header = (
    <PageHeader
      title={`Panel · ${stage.name}`}
      description={`${stage.opportunityTitle} · ${stage.competitionName}. Scores are weighted 0–100 and include submitted reviews only.`}
      breadcrumbs={crumbs}
      linkComponent={NextLink}
      meta={<StatusChip meta={stageMeta(stage.status)} />}
      actions={<LiveRefresh renderedAt={renderedAt} timeZone={tenant.timezone} />}
    />
  );

  if (!submitted.length) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent>
            <EmptyState
              title="No submitted reviews yet"
              description={inProgress ? `${inProgress} review${inProgress === 1 ? ' is' : 's are'} still in progress. This page updates on its own as reviewers submit.` : 'Assign reviewers first; scores appear here as reviews are submitted.'}
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href={`/console/review/${stage.id}`}>View progress</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {header}

      <section aria-label="Panel totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Submitted reviews" value={submitted.length} footnote={inProgress ? `${inProgress} still open` : 'All in'} />
        <StatTile label="Panel mean" value={fmtScore(panelMean)} footnote="Weighted, 0–100" />
        <StatTile label="High disagreement" value={flagged.length} footnote={`σ ≥ ${threshold} points`} />
        <StatTile label="Recommendations" value={`${totalRec.fund} · ${totalRec.maybe} · ${totalRec.decline}`} footnote="Fund · Maybe · Decline" />
      </section>

      {flagged.length ? (
        <Alert variant="warning" title={`${flagged.length} application${flagged.length === 1 ? '' : 's'} with high disagreement`}>
          Reviewers’ weighted scores differ by a standard deviation of {threshold} points or more. Discuss these first. Change the threshold with <code>?threshold=</code>.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Scores by application
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table containerLabel="Scores by application">
            <TableCaption className="sr-only">Submitted weighted scores (0–100) per application, with spread and recommendations</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-right">Mean</TableHead>
                <TableHead className="text-right">Min–max</TableHead>
                <TableHead className="text-right">Std dev</TableHead>
                <TableHead>Agreement</TableHead>
                <TableHead>Recommendations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rows]
                .sort((x, y) => (y.mean ?? -1) - (x.mean ?? -1))
                .map((r) => {
                  const high = r.count >= 2 && r.sd >= threshold;
                  return (
                    <TableRow key={r.app.id} className={high ? 'bg-status-warning-bg/40' : undefined}>
                      <TableCell>
                        <Link href={`/console/applications/${r.app.id}`} className="font-medium hover:underline">
                          {appLabel(r.app)}
                        </Link>
                        {r.app.orgName ? <span className="block text-xs text-muted-foreground">{r.app.orgName}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right font-medium">{fmtScore(r.mean)}</TableCell>
                      <TableCell className="text-right">{r.min === null ? '—' : `${fmtScore(r.min)}–${fmtScore(r.max)}`}</TableCell>
                      <TableCell className="text-right">{r.count >= 2 ? fmtScore(r.sd) : '—'}</TableCell>
                      <TableCell>
                        {r.count < 2 ? (
                          <span className="text-xs text-muted-foreground">Needs 2+ reviews</span>
                        ) : high ? (
                          <ToneChip tone="warning" icon={TriangleAlert} label="High disagreement" size="sm" />
                        ) : (
                          <span className="text-xs text-muted-foreground">Within {threshold} pts</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {(['fund', 'maybe', 'decline'] as const).map((k) =>
                            r.rec[k] ? <StatusChip key={k} meta={RECOMMENDATION[k]} label={`${RECOMMENDATION[k].label} ${r.rec[k]}`} size="sm" /> : null,
                          )}
                          {!r.rec.fund && !r.rec.maybe && !r.rec.decline ? <span className="text-xs text-muted-foreground">None yet</span> : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {criteria.length ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Calibration by criterion
            </CardTitle>
            <CardDescription>Mean raw score per criterion (on each criterion’s own scale).</CardDescription>
          </CardHeader>
          <CardContent>
            <Table containerLabel="Calibration by criterion">
              <TableCaption className="sr-only">Mean score per rubric criterion for each application</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  {criteria.map((c) => (
                    <TableHead key={c.id} className="text-right">
                      {c.label}
                      <span className="block font-normal">
                        {c.weightPct}% · {c.scaleMin}–{c.scaleMax}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((r) => r.count > 0)
                  .map((r) => (
                    <TableRow key={r.app.id}>
                      <TableCell className="font-medium">{appLabel(r.app)}</TableCell>
                      {r.perCriterion.map((m, i) => (
                        <TableCell key={criteria[i]!.id} className="text-right">
                          {fmtScore(m, 2)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Reviewer calibration
          </CardTitle>
          <CardDescription>
            Each reviewer’s average offset from the panel mean on applications with 2+ submitted reviews. Offsets of {CALIBRATION_OFFSET}+ points are flagged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption className="sr-only">Reviewer mean score and offset from the panel mean</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Reviewer</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-right">Their mean</TableHead>
                <TableHead className="text-right">Offset vs panel</TableHead>
                <TableHead>Tendency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calibration.map((r) => {
                const off = mean(r.diffs);
                return (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.scores.length}</TableCell>
                    <TableCell className="text-right">{fmtScore(mean(r.scores))}</TableCell>
                    <TableCell className="text-right">{off === null ? '—' : `${off > 0 ? '+' : off < 0 ? '−' : ''}${Math.abs(off).toFixed(1)}`}</TableCell>
                    <TableCell>
                      {off === null ? (
                        <span className="text-xs text-muted-foreground">Not enough overlap</span>
                      ) : off >= CALIBRATION_OFFSET ? (
                        <ToneChip tone="info" icon={ArrowUpRight} label="Scores high" size="sm" />
                      ) : off <= -CALIBRATION_OFFSET ? (
                        <ToneChip tone="info" icon={ArrowDownRight} label="Scores low" size="sm" />
                      ) : (
                        <ToneChip tone="neutral" icon={Minus} label="In line with panel" size="sm" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Panel notes
            </CardTitle>
            <CardDescription>{livePanel ? `New notes are linked to the live panel “${livePanel.name}”.` : 'Shared with staff and the cleared reviewers of each application.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-5">
              {rows.map((r) => {
                const notes = notesByApp.get(r.app.id) ?? [];
                return (
                  <li key={r.app.id} className="grid gap-2 border-b pb-4 last:border-0 last:pb-0">
                    <h3 className="text-sm font-semibold">{appLabel(r.app)}</h3>
                    {notes.length ? (
                      <ul className="grid gap-2">
                        {notes.map((n) => (
                          <li key={n.id} className="rounded-md bg-muted/50 p-3 text-sm">
                            <p className="whitespace-pre-wrap">{n.body}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {n.full_name ?? 'Someone'} · {formatInZone(n.created_at, tenant.timezone)}
                              {n.panel_id && panelName.get(n.panel_id) ? ` · ${panelName.get(n.panel_id)}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No notes yet.</p>
                    )}
                    {canEdit ? <PanelNoteForm stageId={stage.id} applicationId={r.app.id} applicationLabel={appLabel(r.app)} panelId={livePanel?.id ?? null} /> : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Panel sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PanelSessions
              stageId={stage.id}
              canEdit={canEdit}
              timeZone={tenant.timezone}
              panels={data.panels.map((p) => ({ id: p.id, name: p.name, status: p.status, meetsAtLabel: p.meets_at ? formatInZone(p.meets_at, tenant.timezone) : null, meetsAtInput: toLocalInputValue(p.meets_at, tenant.timezone) }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
