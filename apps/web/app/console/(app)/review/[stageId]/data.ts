// SPDX-License-Identifier: AGPL-3.0-or-later
// Server reads shared by the stage pages (R-02 assign, R-03 progress, R-04 panel). All under RLS as staff.
import 'server-only';
import type { Tx } from '@gms/db';
import { sql } from '@gms/db';
import { isUuid } from '@/lib/grantmaking-data';

export interface StageInfo {
  id: string;
  name: string;
  status: string;
  blind: boolean;
  dueAt: string | null;
  reviewersPerApplication: number;
  competitionId: string;
  competitionName: string;
  opportunityTitle: string;
  rubricId: string | null;
  rubricName: string | null;
}

export interface StageApplication {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  orgId: string | null;
  orgName: string | null;
}

export interface StageAssignment {
  id: string;
  applicationId: string;
  reviewerId: string;
  reviewerName: string;
  status: string;
  conflict: { explanation: string | null } | null;
  review: { id: string; status: string; weightedScore: number | null; recommendation: string | null; submittedAt: string | null } | null;
}

export interface StageCriterion {
  id: string;
  label: string;
  weightPct: number;
  scaleMin: number;
  scaleMax: number;
}

export async function loadStage(trx: Tx, workspaceId: string, stageId: string): Promise<StageInfo | null> {
  if (!isUuid(stageId)) return null;
  const s = await trx
    .selectFrom('review_stages as s')
    .innerJoin('competitions as c', 'c.id', 's.competition_id')
    .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
    .leftJoin('rubrics as r', 'r.id', 's.rubric_id')
    .select(['s.id', 's.name', 's.status', 's.blind', 's.due_at', 's.reviewers_per_application', 's.competition_id', 'c.name as competition_name', 'o.title as opp_title', 's.rubric_id', 'r.name as rubric_name'])
    .where('s.id', '=', stageId)
    .where('s.workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    blind: s.blind,
    dueAt: s.due_at,
    reviewersPerApplication: s.reviewers_per_application,
    competitionId: s.competition_id,
    competitionName: s.competition_name,
    opportunityTitle: s.opp_title,
    rubricId: s.rubric_id,
    rubricName: s.rubric_name,
  };
}

/** Applications in the stage's competition that can be reviewed (submitted / under review), plus any already assigned. */
export async function loadStageApplications(trx: Tx, workspaceId: string, stage: StageInfo, opts: { includeAssigned?: boolean } = {}): Promise<StageApplication[]> {
  const rows = await trx
    .selectFrom('applications as a')
    .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
    .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'a.applicant_org_id', 'g.legal_name'])
    .where('a.workspace_id', '=', workspaceId)
    .where('a.competition_id', '=', stage.competitionId)
    .where((eb) =>
      opts.includeAssigned
        ? eb.or([
            eb('a.status', 'in', ['submitted', 'under_review']),
            eb.exists(eb.selectFrom('review_assignments as ra').select('ra.id').whereRef('ra.application_id', '=', 'a.id').where('ra.stage_id', '=', stage.id)),
          ])
        : eb('a.status', 'in', ['submitted', 'under_review']),
    )
    .orderBy('a.submitted_at')
    .orderBy('a.reference_number')
    .execute();
  return rows.map((r) => ({ id: r.id, reference: r.reference_number, title: r.title, status: r.status, orgId: r.applicant_org_id, orgName: r.legal_name }));
}

export async function loadStageAssignments(trx: Tx, workspaceId: string, stageId: string): Promise<StageAssignment[]> {
  const rows = await trx
    .selectFrom('review_assignments as ra')
    .innerJoin('profiles as p', 'p.id', 'ra.reviewer_id')
    .leftJoin('reviews as r', 'r.assignment_id', 'ra.id')
    .select([
      'ra.id',
      'ra.application_id',
      'ra.reviewer_id',
      'ra.status',
      'p.full_name',
      'p.email',
      'r.id as review_id',
      'r.status as review_status',
      'r.weighted_score',
      'r.recommendation',
      'r.submitted_at',
      sql<boolean | null>`(select d.has_conflict from public.coi_declarations d where d.assignment_id = ra.id order by d.declared_at desc limit 1)`.as('has_conflict'),
      sql<string | null>`(select d.explanation from public.coi_declarations d where d.assignment_id = ra.id order by d.declared_at desc limit 1)`.as('coi_explanation'),
    ])
    .where('ra.workspace_id', '=', workspaceId)
    .where('ra.stage_id', '=', stageId)
    .orderBy('p.full_name')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    reviewerId: r.reviewer_id,
    reviewerName: r.full_name || r.email,
    status: r.status,
    conflict: r.has_conflict ? { explanation: r.coi_explanation } : null,
    review: r.review_id
      ? { id: r.review_id, status: r.review_status ?? 'in_progress', weightedScore: r.weighted_score === null ? null : Number(r.weighted_score), recommendation: r.recommendation, submittedAt: r.submitted_at }
      : null,
  }));
}

export async function loadCriteria(trx: Tx, workspaceId: string, rubricId: string | null): Promise<StageCriterion[]> {
  if (!rubricId) return [];
  const rows = await trx
    .selectFrom('rubric_criteria')
    .select(['id', 'label', 'weight_pct', 'scale_min', 'scale_max'])
    .where('rubric_id', '=', rubricId)
    .where('workspace_id', '=', workspaceId)
    .orderBy('position')
    .execute();
  return rows.map((c) => ({ id: c.id, label: c.label, weightPct: Number(c.weight_pct), scaleMin: c.scale_min, scaleMax: c.scale_max }));
}

export function appLabel(a: Pick<StageApplication, 'title' | 'reference'>): string {
  return a.title ? `${a.title} (${a.reference})` : a.reference;
}
