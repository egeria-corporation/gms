// SPDX-License-Identifier: AGPL-3.0-only
// R-01 Review stages & rubrics: stages grouped by opportunity / competition (rubric, blind, reviewers per
// application, due date, status, submitted vs assigned) with create/edit, and the rubric list (builder at
// /console/review/rubrics/new and /console/review/rubrics/[rubricId]).
// ?state= empty (no stages or rubrics) | weights-invalid (redirects to the rubric builder with weights that
// don't total 100%) | error
import { sql } from '@gms/db';
import { toLocalInputValue } from '@gms/domain';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeadlineChip,
  EmptyState,
  ErrorState,
  PageHeader,
  Progress,
  Section,
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
import { EyeOff, Lock, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { stageMeta } from '@/components/console/grantmaking/review/meta';
import { StageDialog } from '@/components/console/grantmaking/review/stage-dialog';
import { requireStaff } from '@/lib/auth';
import type { SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Review' };

const READ_ROLES = ['owner', 'admin', 'program_officer', 'auditor'] as const;
const EDIT_ROLES: readonly string[] = ['owner', 'admin', 'program_officer'];

export default async function ReviewStagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(READ_ROLES)]);
  const forced = forcedState(await searchParams);
  if (forced === 'weights-invalid') redirect('/console/review/rubrics/new?state=weights-invalid');
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));

  const data = await rls(async (trx) => {
    const [stages, progress, rubrics, competitions] = await Promise.all([
      trx
        .selectFrom('review_stages as s')
        .innerJoin('competitions as c', 'c.id', 's.competition_id')
        .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
        .leftJoin('rubrics as r', 'r.id', 's.rubric_id')
        .select([
          's.id',
          's.name',
          's.status',
          's.blind',
          's.due_at',
          's.rubric_id',
          's.reviewers_per_application',
          's.competition_id',
          'c.name as competition_name',
          'o.id as opportunity_id',
          'o.title as opportunity_title',
          'r.name as rubric_name',
        ])
        .where('s.workspace_id', '=', tenant.id)
        .orderBy('o.title')
        .orderBy('c.stage_order')
        .orderBy('s.position')
        .execute(),
      trx
        .selectFrom('review_assignments')
        .select([
          'stage_id',
          sql<number>`count(*) filter (where status <> 'recused')::int`.as('assigned'),
          sql<number>`count(*) filter (where status = 'submitted')::int`.as('submitted'),
          sql<number>`count(*) filter (where status = 'recused')::int`.as('recused'),
        ])
        .where('workspace_id', '=', tenant.id)
        .groupBy('stage_id')
        .execute(),
      trx
        .selectFrom('rubrics as r')
        .select([
          'r.id',
          'r.name',
          'r.status',
          'r.description',
          sql<number>`(select count(*)::int from public.rubric_criteria c where c.rubric_id = r.id)`.as('criteria'),
          sql<number>`(select count(*)::int from public.review_stages s where s.rubric_id = r.id)`.as('stages'),
          sql<boolean>`exists (select 1 from public.review_scores x join public.rubric_criteria c on c.id = x.criterion_id where c.rubric_id = r.id)`.as('scored'),
        ])
        .where('r.workspace_id', '=', tenant.id)
        .orderBy('r.name')
        .execute(),
      trx
        .selectFrom('competitions as c')
        .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
        .select(['c.id', 'c.name', 'o.title'])
        .where('c.workspace_id', '=', tenant.id)
        .orderBy('o.title')
        .orderBy('c.stage_order')
        .execute(),
    ]);
    return { stages, progress, rubrics, competitions };
  }).catch((err: unknown) => {
    console.error('[review] R-01 load failed', err);
    return null;
  });

  const header = (
    <PageHeader
      title="Review"
      description="Review stages for each competition, who is reviewing, and the rubrics reviewers score with."
      actions={
        canEdit && data ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/review/rubrics/new">
                <Plus aria-hidden="true" />
                New rubric
              </Link>
            </Button>
            <StageDialog
              competitions={data.competitions.map((c) => ({ id: c.id, label: `${c.title} · ${c.name}` }))}
              rubrics={data.rubrics.map((r) => ({ id: r.id, label: r.name }))}
              timeZone={tenant.timezone}
            />
          </>
        ) : null
      }
    />
  );

  if (!data || forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState description="We couldn’t load review stages. Nothing was changed. Refresh the page to try again." />
      </div>
    );
  }

  const empty = forced === 'empty';
  const stages = empty ? [] : data.stages;
  const rubrics = empty ? [] : data.rubrics;
  const prog = new Map(data.progress.map((p) => [p.stage_id, p]));
  const compOptions = data.competitions.map((c) => ({ id: c.id, label: `${c.title} · ${c.name}` }));
  const rubricOptions = data.rubrics.map((r) => ({ id: r.id, label: r.name }));

  // Group by opportunity → competition.
  const groups = new Map<string, { title: string; competitionId: string; items: typeof stages }>();
  for (const s of stages) {
    const key = s.competition_id;
    const g = groups.get(key) ?? { title: `${s.opportunity_title} · ${s.competition_name}`, competitionId: s.competition_id, items: [] };
    g.items.push(s);
    groups.set(key, g);
  }

  return (
    <div className="grid gap-6">
      {header}

      <Section title="Review stages" description="Grouped by opportunity and competition.">
        {groups.size === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No review stages yet"
                description="Create a review stage for a competition, pick a rubric, then assign reviewers."
                action={
                  canEdit && data.competitions.length ? (
                    <StageDialog competitions={compOptions} rubrics={rubricOptions} timeZone={tenant.timezone} triggerLabel="Create the first stage" />
                  ) : !data.competitions.length ? (
                    <Button asChild size="sm">
                      <Link href="/console/opportunities">Set up an opportunity first</Link>
                    </Button>
                  ) : null
                }
              />
            </CardContent>
          </Card>
        ) : (
          [...groups.values()].map((g) => (
            <Card key={g.competitionId}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle as="h3">{g.title}</CardTitle>
                {canEdit ? (
                  <StageDialog competitions={compOptions} rubrics={rubricOptions} defaultCompetitionId={g.competitionId} timeZone={tenant.timezone} triggerLabel="Add stage" />
                ) : null}
              </CardHeader>
              <CardContent>
                <Table containerLabel={`Review stages for ${g.title}`}>
                  <TableCaption className="sr-only">Review stages for {g.title}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead>Rubric</TableHead>
                      <TableHead>Reviewers / app</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-40">Progress</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((s) => {
                      const p = prog.get(s.id);
                      const assigned = p?.assigned ?? 0;
                      const submitted = p?.submitted ?? 0;
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <Link href={`/console/review/${s.id}`} className="font-medium hover:underline">
                                {s.name}
                              </Link>
                              {s.blind ? (
                                <Badge variant="info">
                                  <EyeOff aria-hidden="true" />
                                  Blind
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>{s.rubric_name ?? <span className="text-muted-foreground">No rubric</span>}</TableCell>
                          <TableCell className="tabular-nums">{s.reviewers_per_application}</TableCell>
                          <TableCell>{s.due_at ? <DeadlineChip at={s.due_at} timeZone={tenant.timezone} size="sm" hideExact pastLabel="Was due" /> : '—'}</TableCell>
                          <TableCell>
                            <StatusChip meta={stageMeta(s.status)} size="sm" />
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-1">
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {submitted} of {assigned} submitted{p?.recused ? ` · ${p.recused} recused` : ''}
                              </span>
                              <Progress value={submitted} max={Math.max(assigned, 1)} label={`${s.name}: ${submitted} of ${assigned} reviews submitted`} />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/console/review/${s.id}/assign`}>Assign</Link>
                              </Button>
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/console/review/${s.id}/panel`}>Panel</Link>
                              </Button>
                              {canEdit ? (
                                <StageDialog
                                  competitions={compOptions}
                                  rubrics={rubricOptions}
                                  timeZone={tenant.timezone}
                                  stage={{
                                    stageId: s.id,
                                    competitionId: s.competition_id,
                                    name: s.name,
                                    rubricId: s.rubric_id,
                                    blind: s.blind,
                                    reviewersPerApplication: s.reviewers_per_application,
                                    dueAt: toLocalInputValue(s.due_at, tenant.timezone),
                                    status: s.status as 'draft' | 'active' | 'closed',
                                  }}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </Section>

      <Section
        title="Rubrics"
        description="Criteria, weights (always 100%) and scales. A rubric that reviewers have scored with is locked; duplicate it to change it."
        actions={
          canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/console/review/rubrics/new">
                <Plus aria-hidden="true" />
                New rubric
              </Link>
            </Button>
          ) : null
        }
      >
        {rubrics.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                level={3}
                title="No rubrics yet"
                description="A rubric lists what reviewers score, how much each criterion counts, and the scale."
                action={
                  canEdit ? (
                    <Button asChild size="sm">
                      <Link href="/console/review/rubrics/new">Build a rubric</Link>
                    </Button>
                  ) : null
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableCaption className="sr-only">Rubrics</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rubric</TableHead>
                    <TableHead>Criteria</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead>Editing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rubrics.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/console/review/rubrics/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        {r.description ? <span className="block max-w-lg truncate text-xs text-muted-foreground">{r.description}</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">{r.criteria}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.stages} stage{r.stages === 1 ? '' : 's'}
                      </TableCell>
                      <TableCell>
                        {r.scored ? (
                          <ToneChip tone="neutral" icon={Lock} label="Locked — scored" size="sm" />
                        ) : (
                          <span className="text-xs text-muted-foreground">Editable</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Section>
    </div>
  );
}
