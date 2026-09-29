// SPDX-License-Identifier: AGPL-3.0-or-later
// R-02 Assignment board: applications in the stage's competition (submitted / under review) × assigned
// reviewers, reviewer load vs capacity, the round-robin auto-assign plan (dry run → apply), manual assign /
// unassign, declared conflicts of interest highlighted.
// ?state= over-capacity (shows the first loaded reviewer with a capacity below their load) | conflicts
// (ensures a declared conflict is shown) | empty (no applications) | error
import { sql } from '@gms/db';
import { Button, Card, CardContent, EmptyState, ErrorState, NotFoundState, PageHeader, StatusChip } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AssignBoard, type BoardAssignment, type BoardConflict, type BoardReviewer } from '@/components/console/grantmaking/review/assign-board';
import { stageMeta } from '@/components/console/grantmaking/review/meta';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { teamMembers, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { appLabel, loadStage, loadStageApplications, loadStageAssignments } from '../data';

export const metadata: Metadata = { title: 'Assign reviewers' };

const EDIT_ROLES: readonly string[] = ['owner', 'admin', 'program_officer'];

export default async function AssignPage({ params, searchParams }: { params: Promise<{ stageId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const { stageId } = await params;
  const forced = forcedState(await searchParams);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));

  const data = await rls(async (trx) => {
    const stage = await loadStage(trx, tenant.id, stageId);
    if (!stage) return { stage: null } as const;
    const [apps, assignments, members, conflicts] = await Promise.all([
      loadStageApplications(trx, tenant.id, stage, { includeAssigned: true }),
      loadStageAssignments(trx, tenant.id, stage.id),
      teamMembers(trx, tenant.id, ['reviewer', 'program_officer']),
      sql<{ reviewer_id: string; applicant_org_id: string | null; application_id: string; explanation: string | null }>`
        select d.reviewer_id, a.applicant_org_id, ra.application_id, d.explanation
        from public.coi_declarations d
        join public.review_assignments ra on ra.id = d.assignment_id
        join public.applications a on a.id = ra.application_id
        where d.workspace_id = ${tenant.id}::uuid and d.has_conflict`.execute(trx),
    ]);
    return { stage, apps, assignments, members, conflicts: conflicts.rows } as const;
  }).catch((err: unknown) => {
    console.error('[review] R-02 load failed', err);
    return null;
  });

  const crumbs = [
    { label: 'Review', href: '/console/review' },
    ...(data?.stage ? [{ label: data.stage.name, href: `/console/review/${data.stage.id}` }] : []),
    { label: 'Assign' },
  ];
  if (!data || forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Assign reviewers" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load the assignment board. Nothing was changed. Refresh to try again." />
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
  const apps = forced === 'empty' ? [] : data.apps;
  let assignments: BoardAssignment[] = forced === 'empty' ? [] : data.assignments.map((a) => ({ id: a.id, applicationId: a.applicationId, reviewerId: a.reviewerId, reviewerName: a.reviewerName, status: a.status, conflict: a.conflict }));
  let conflicts: BoardConflict[] = data.conflicts.map((c) => ({ reviewerId: c.reviewer_id, orgId: c.applicant_org_id, applicationId: c.application_id, explanation: c.explanation }));
  if (forced === 'conflicts' && !assignments.some((a) => a.conflict) && assignments[0]) {
    const first = assignments[0];
    const example = { explanation: 'Example: I serve on this organization’s advisory board.' };
    assignments = assignments.map((a) => (a.id === first.id ? { ...a, status: 'recused', conflict: example } : a));
    const app = apps.find((a) => a.id === first.applicationId);
    conflicts = [...conflicts, { reviewerId: first.reviewerId, orgId: app?.orgId ?? null, applicationId: first.applicationId, ...example }];
  }

  const load = new Map<string, number>();
  for (const a of assignments) load.set(a.reviewerId, (load.get(a.reviewerId) ?? 0) + 1);
  let reviewers: BoardReviewer[] = data.members
    // Program officers only appear when they already have assignments here (auto-assign uses reviewers).
    .filter((m) => m.role === 'reviewer' || load.has(m.userId))
    .map((m) => ({ userId: m.userId, memberId: m.memberId, name: m.name, role: m.role, capacity: m.reviewCapacity, load: load.get(m.userId) ?? 0 }));
  // Assigned people who are no longer active members still show up.
  for (const a of assignments) {
    if (!reviewers.some((r) => r.userId === a.reviewerId)) reviewers.push({ userId: a.reviewerId, memberId: a.reviewerId, name: a.reviewerName, role: 'former member', capacity: null, load: load.get(a.reviewerId) ?? 0 });
  }
  if (forced === 'over-capacity') {
    const busiest = [...reviewers].sort((x, y) => y.load - x.load)[0];
    if (busiest) reviewers = reviewers.map((r) => (r.userId === busiest.userId ? { ...r, capacity: Math.max(0, r.load - 1) } : r));
  }

  const header = (
    <PageHeader
      title={`Assign reviewers · ${stage.name}`}
      description={`${stage.opportunityTitle} · ${stage.competitionName} · ${stage.reviewersPerApplication} reviewer${stage.reviewersPerApplication === 1 ? '' : 's'} per application`}
      breadcrumbs={crumbs}
      linkComponent={NextLink}
      meta={<StatusChip meta={stageMeta(stage.status)} />}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/console/review/${stage.id}`}>View progress</Link>
        </Button>
      }
    />
  );

  if (!apps.length) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent>
            <EmptyState
              title="No applications to review yet"
              description="Applications show up here once they are submitted to this competition. Move them to review from the pipeline."
              action={
                <Button asChild size="sm">
                  <Link href="/console/pipeline?status=submitted">Open the pipeline</Link>
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
      <AssignBoard
        stage={{ id: stage.id, name: stage.name, reviewersPerApplication: stage.reviewersPerApplication }}
        apps={apps.map((a) => ({ id: a.id, label: appLabel(a), orgId: a.orgId, orgName: a.orgName, status: a.status }))}
        assignments={assignments}
        reviewers={reviewers}
        conflicts={conflicts}
        canEdit={canEdit}
      />
    </div>
  );
}
