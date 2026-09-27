// SPDX-License-Identifier: AGPL-3.0-only
// Review: 12 reviewers with assignments, conflict-of-interest declarations and scored reviews on the
// flagship LOIs (in progress) and the two past cycles (complete), plus a panel.
import type { Row, SeedContext } from '../context';
import { DEMO_USERS } from '../people';
import type { Rng } from '../rng';
import { between } from '../time';
import type { AppRec, Apps } from './applications';
import type { Catalog } from './catalog';

const COMMENTS = [
  'Clear plan and a real track record with this age group. The budget is modest for what they propose.',
  'Strong youth leadership piece. I would like to know more about how they will recruit beyond their current participants.',
  'The need is well documented. Activities are a bit vague for the second term.',
  'Exactly the kind of program this fund exists for. Small team, big reach.',
  'Solid, but the request seems high compared with the number of young people served.',
  'Great partnerships with the library and schools. Evaluation plan is thin.',
];

export async function reviews(ctx: SeedContext, cat: Catalog, apps: Apps): Promise<number> {
  const reviewers = DEMO_USERS.filter((u) => u.role === 'reviewer').map((u) => ctx.person(u.key));
  const ws = ctx.ws('halcyon');
  const assignments: Row<'review_assignments'>[] = [];
  const coi: Row<'coi_declarations'>[] = [];
  const reviewRows: Row<'reviews'>[] = [];
  const scores: Row<'review_scores'>[] = [];
  let reviewerCursor = 0;

  const assign = (rng: Rng, stage: string, rubricKey: string, list: AppRec[], state: (a: AppRec, slot: number) => 'not_started' | 'in_progress' | 'submitted' | 'recused', dueAt: string) => {
    const rubric = cat.rubrics[rubricKey]!;
    for (const a of list) {
      for (let slot = 0; slot < 2; slot++) {
        const reviewer = reviewers[reviewerCursor++ % reviewers.length]!;
        const id = ctx.id(`assignment:${stage}:${a.id}:${reviewer.id}`);
        const st = state(a, slot);
        const assignedAt = a.reviewAt ?? a.submittedAt ?? ctx.clock.iso(-3);
        const workedAt = between(assignedAt, dueAt < ctx.clock.iso(0) ? dueAt : ctx.clock.iso(0, -1), rng.next());
        assignments.push({ id, workspace_id: ws.id, stage_id: stage, application_id: a.id, reviewer_id: reviewer.id, status: st, assigned_by: ctx.person('jordan').id, due_at: dueAt, created_at: assignedAt, last_modified_at: workedAt });
        if (st === 'not_started') continue;
        coi.push({ id: ctx.id(`coi:${id}`), workspace_id: ws.id, assignment_id: id, reviewer_id: reviewer.id, has_conflict: st === 'recused', explanation: st === 'recused' ? 'I serve on this organization’s advisory board.' : null, declared_at: workedAt });
        if (st === 'recused') continue;
        const reviewId = ctx.id(`review:${id}`);
        const strong = a.status === 'awarded' || a.status === 'invited_to_next_stage';
        let weighted = 0;
        for (const cr of rubric.criteria) {
          const score = Math.max(1, Math.min(5, (strong ? rng.int(4, 5) : rng.int(2, 4)) + (rng.chance(0.15) ? -1 : 0)));
          weighted += (cr.weight * (score - cr.min)) / (cr.max - cr.min);
          scores.push({ id: ctx.id(`score:${reviewId}:${cr.id}`), workspace_id: ws.id, review_id: reviewId, criterion_id: cr.id, score, comment: null, created_at: workedAt });
        }
        reviewRows.push({
          id: reviewId,
          workspace_id: ws.id,
          assignment_id: id,
          status: st === 'submitted' ? 'submitted' : 'in_progress',
          overall_comment: rng.pick(COMMENTS),
          private_note: rng.chance(0.2) ? 'Worth a site visit if funded.' : null,
          recommendation: strong ? 'fund' : weighted > 55 ? 'maybe' : 'decline',
          weighted_score: Math.round(weighted * 100) / 100,
          submitted_at: st === 'submitted' ? workedAt : null,
          created_at: workedAt,
          last_modified_at: workedAt,
        });
        if (st === 'submitted') {
          ctx.audit({ workspace: 'halcyon', at: workedAt, actor: { type: 'human', id: reviewer.id, name: reviewer.name }, action: 'review.submit', entityType: 'review', entityId: reviewId, after: { weightedScore: Math.round(weighted * 100) / 100 }, riskTier: 'R2' });
        }
      }
    }
  };

  // Past cycles: every assignment submitted.
  const rngPast = ctx.stream('reviews:past');
  const yafReviewed = apps.byOpp.yaf2025.filter((a) => a.status === 'awarded' || a.status === 'declined').slice(0, 70);
  assign(rngPast, cat.reviewStages.yaf2025!, 'yaf', yafReviewed, () => 'submitted', '2025-03-15T01:00:00.000Z');
  const nfsReviewed = apps.byOpp.nfs2026.filter((a) => a.status === 'awarded' || a.status === 'declined').slice(0, 70);
  assign(rngPast, cat.reviewStages.nfs2026!, 'nfs', nfsReviewed, () => 'submitted', '2026-03-01T01:00:00.000Z');

  // Flagship LOIs: invited ones fully reviewed; under-review ones part way; a couple of recusals.
  const rngNow = ctx.stream('reviews:flagship');
  const flagship = apps.byOpp.flagship.filter((a) => a.status === 'under_review' || a.status === 'invited_to_next_stage');
  let k = 0;
  assign(
    rngNow,
    cat.reviewStages.flagship!,
    'yaf',
    flagship,
    (a) => {
      k++;
      if (a.status === 'invited_to_next_stage') return 'submitted';
      if (k === 7 || k === 33) return 'recused';
      return rngNow.weighted([
        ['submitted', 45],
        ['in_progress', 25],
        ['not_started', 30],
      ]);
    },
    ctx.clock.iso(21),
  );

  await ctx.insert('review_assignments', assignments);
  await ctx.insert('coi_declarations', coi);
  await ctx.insert('reviews', reviewRows);
  await ctx.insert('review_scores', scores);

  await ctx.insert('panels', [
    { id: ctx.id('panel:nfs2026'), workspace_id: ws.id, stage_id: cat.reviewStages.nfs2026!, name: 'Food Security panel', meets_at: '2026-03-05T18:00:00.000Z', status: 'closed' },
    { id: ctx.id('panel:flagship'), workspace_id: ws.id, stage_id: cat.reviewStages.flagship!, name: 'Youth Arts LOI panel', meets_at: ctx.clock.iso(24), status: 'scheduled' },
  ]);
  await ctx.insert(
    'panel_notes',
    nfsReviewed.slice(0, 5).map((a, i) => ({
      id: ctx.id(`panel-note:${a.id}`),
      workspace_id: ws.id,
      panel_id: ctx.id('panel:nfs2026'),
      application_id: a.id,
      author_id: ctx.person('jordan').id,
      body: ['Panel consensus: fund at the full amount.', 'Panel asked for a smaller first-year budget.', 'Strong community support letters.', 'Fund; revisit cold storage costs next year.', 'Decline this cycle; encourage a Rapid Response request.'][i]!,
      created_at: '2026-03-05T20:00:00.000Z',
    })),
  );
  return assignments.length;
}
