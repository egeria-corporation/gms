// SPDX-License-Identifier: AGPL-3.0-or-later
// D-01 Reviewer queue: my assignments (gms.reviewer_queue) grouped by review stage, with due dates, status and
// the next step (declare conflicts → start → continue → view submitted).
// ?state= empty (no assignments) | all-done (every assignment shown as submitted) | error
import { sql } from '@gms/db';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DeadlineChip, EmptyState, ErrorState, PageHeader, Progress, StatusChip } from '@gms/ui';
import { EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtScore, stageMeta } from '@/components/console/grantmaking/review/meta';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ReviewerFrame } from './frame';
import { requireReviewer, type QueueRow } from './guard';

export const metadata: Metadata = { title: 'Your review assignments' };

function nextStep(r: QueueRow): { label: string; href: string; variant: 'default' | 'outline' } | null {
  if (r.status === 'recused' || r.has_conflict) return null;
  if (!r.coi_declared) return { label: 'Declare conflicts', href: `/review/${r.assignment_id}/coi`, variant: 'default' };
  if (r.status === 'submitted') return { label: 'View submitted', href: `/review/${r.assignment_id}`, variant: 'outline' };
  if (r.status === 'in_progress') return { label: 'Continue', href: `/review/${r.assignment_id}`, variant: 'default' };
  return { label: 'Start review', href: `/review/${r.assignment_id}`, variant: 'default' };
}

export default async function ReviewerQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireReviewer()]);
  const forced = forcedState(await searchParams);
  const rows = await rls(async (trx) => (await sql<QueueRow>`select * from gms.reviewer_queue(${tenant.id}::uuid)`.execute(trx)).rows).catch((err: unknown) => {
    console.error('[review] D-01 load failed', err);
    return null;
  });

  let queue = rows ?? [];
  if (forced === 'empty') queue = [];
  if (forced === 'all-done') queue = queue.map((r) => (r.status === 'recused' ? r : { ...r, status: 'submitted', coi_declared: true, review_status: 'submitted' }));
  const active = queue.filter((r) => r.status !== 'recused');
  const done = active.filter((r) => r.status === 'submitted').length;

  const groups = new Map<string, { name: string; blind: boolean; status: string; context: string; items: QueueRow[] }>();
  for (const r of queue) {
    const g = groups.get(r.stage_id) ?? { name: r.stage_name, blind: r.blind, status: r.stage_status, context: `${r.opportunity_title} · ${r.competition_name}`, items: [] };
    g.items.push(r);
    groups.set(r.stage_id, g);
  }

  return (
    <ReviewerFrame tenant={tenant} viewer={viewer} context="Review assignments" progress={active.length ? `${done} of ${active.length} submitted` : undefined}>
      <PageHeader
        density="spacious"
        title="Your review assignments"
        description="Declare any conflicts of interest first; then read each application and score it with the rubric."
      />
      {!rows || forced === 'error' ? (
        <ErrorState description="We couldn’t load your assignments. Your saved reviews are safe. Refresh to try again." />
      ) : !queue.length ? (
        <EmptyState variant="page" title="No assignments yet" description="When a program officer assigns applications to you, they appear here. You’ll also get an email." />
      ) : (
        <div className="grid gap-8">
          {active.length > 0 && done === active.length ? (
            <Alert variant="success" title="You’re all done">
              Every review assigned to you is submitted. Thank you! If a program officer reopens one, it will show up here again.
            </Alert>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-medium" id="queue-progress">
                {done} of {active.length} submitted
              </p>
              <Progress value={done} max={Math.max(active.length, 1)} aria-labelledby="queue-progress" />
            </div>
          )}
          {[...groups.entries()].map(([stageId, g]) => (
            <section key={stageId} aria-labelledby={`stage-${stageId}`} className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`stage-${stageId}`} className="font-heading text-xl font-semibold">
                  {g.name}
                </h2>
                <StatusChip meta={stageMeta(g.status)} size="sm" />
                {g.blind ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <EyeOff aria-hidden="true" className="size-4" />
                    Blind review
                  </span>
                ) : null}
                <span className="basis-full text-sm text-muted-foreground">{g.context}</span>
              </div>
              <ul className="grid gap-3">
                {g.items.map((r) => {
                  const step = nextStep(r);
                  const title = r.application_title ?? r.reference_number;
                  return (
                    <li key={r.assignment_id}>
                      <Card>
                        <CardHeader className="gap-2">
                          <CardTitle as="h3" className="text-lg">
                            {title}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {r.blind || !r.organization_name ? (
                              <span className="inline-flex items-center gap-1">
                                <EyeOff aria-hidden="true" className="size-3.5" />
                                Identity hidden (blind review)
                              </span>
                            ) : (
                              r.organization_name
                            )}
                            <span aria-hidden="true"> · </span>
                            {r.reference_number}
                          </p>
                        </CardHeader>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip kind="review" value={r.status} />
                            {!r.coi_declared && r.status !== 'recused' ? <span className="text-sm text-muted-foreground">Conflicts not declared yet</span> : null}
                            {r.due_at && r.status !== 'submitted' && r.status !== 'recused' ? <DeadlineChip at={r.due_at} timeZone={tenant.timezone} pastLabel="Was due" /> : null}
                            {r.status === 'submitted' && r.weighted_score !== null ? <span className="text-sm tabular-nums text-muted-foreground">Your score: {fmtScore(Number(r.weighted_score))} / 100</span> : null}
                            {r.status === 'recused' ? <span className="text-sm text-muted-foreground">You declared a conflict. Staff will reassign it.</span> : null}
                          </div>
                          {step ? (
                            <Button asChild size="lg" variant={step.variant}>
                              <Link href={step.href} aria-label={`${step.label}: ${title}`}>
                                {step.label}
                              </Link>
                            </Button>
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </ReviewerFrame>
  );
}
