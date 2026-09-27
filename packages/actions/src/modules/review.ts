// SPDX-License-Identifier: AGPL-3.0-only
// Staff pipeline actions and the review process: rubrics, stages, assignment (manual + round-robin with
// load balancing), COI declarations, scoring, panels.
import type { Tx } from '@gms/db';
import { applicationMachine, DomainError, reviewMachine } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { found, IdOut, json, Ok, recordStatus, transition, uid, uuid, ws } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

// Pipeline -----------------------------------------------------------------------------------
export const advanceApplications = defineAction({
  id: 'applications.advance',
  title: 'Move applications to review',
  description: 'Moves submitted applications to “Under review” (bulk). Consequential: agents get a confirmation request.',
  input: z.object({ applicationIds: z.array(uuid).min(1).max(500), reason: z.string().max(1000).optional() }),
  output: z.object({ moved: z.number(), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) }),
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const apps = await ctx.db.selectFrom('applications').selectAll().where('id', 'in', input.applicationIds).execute();
    let moved = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const app of apps) {
      if (app.status === 'under_review') continue;
      if (!['submitted', 'ineligible'].includes(app.status)) {
        skipped.push({ id: app.id, reason: `Status is ${app.status.replace(/_/g, ' ')}` });
        continue;
      }
      await ctx.db.updateTable('applications').set({ status: 'under_review' }).where('id', '=', app.id).execute();
      await recordStatus(ctx, app, 'under_review', input.reason ?? null);
      moved++;
    }
    ctx.audit({ entityType: 'application', entityId: null, action: 'applications.advance', after: { moved, skipped: skipped.length, ids: input.applicationIds.slice(0, 100) } });
    return { moved, skipped };
  },
});

export const markIneligible = defineAction({
  id: 'applications.mark_ineligible',
  title: 'Mark ineligible',
  description: 'Marks applications ineligible with a reason the applicant will see.',
  input: z.object({ applicationIds: z.array(uuid).min(1).max(500), reason: z.string().trim().min(1).max(2000) }),
  output: z.object({ updated: z.number() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const apps = await ctx.db.selectFrom('applications').selectAll().where('id', 'in', input.applicationIds).execute();
    let updated = 0;
    for (const app of apps) {
      if (app.status === 'ineligible') continue;
      transition(applicationMachine, app.status, 'ineligible');
      await ctx.db.updateTable('applications').set({ status: 'ineligible' }).where('id', '=', app.id).execute();
      await recordStatus(ctx, app, 'ineligible', input.reason);
      updated++;
    }
    ctx.audit({ entityType: 'application', entityId: null, action: 'applications.mark_ineligible', after: { updated } });
    return { updated };
  },
});

export const requestInfo = defineAction({
  id: 'applications.request_info',
  title: 'Request more information',
  description: 'Asks an applicant for more information. Optionally reopens the application so they can edit answers and resubmit.',
  input: z.object({ applicationId: uuid, note: z.string().trim().min(1).max(5000), reopenForEdits: z.boolean().default(false) }),
  output: Ok,
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const app = found(await ctx.db.selectFrom('applications').selectAll().where('id', '=', input.applicationId).executeTakeFirst(), 'application');
    const patch: Record<string, unknown> = { info_requested_at: ctx.now().toISOString(), info_request_note: input.note };
    if (input.reopenForEdits) {
      transition(applicationMachine, app.status, 'in_progress');
      patch.status = 'in_progress';
    }
    await ctx.db.updateTable('applications').set(patch).where('id', '=', app.id).execute();
    if (input.reopenForEdits) await recordStatus(ctx, app, 'in_progress', `More information requested: ${input.note}`);
    // Post the request in the application thread so the applicant can reply.
    let thread = await ctx.db.selectFrom('threads').select('id').where('application_id', '=', app.id).executeTakeFirst();
    if (!thread) {
      thread = await ctx.db
        .insertInto('threads')
        .values({ workspace_id: w.id, application_id: app.id, subject: `${app.title ?? 'Application'} (${app.reference_number})`, created_by: uid(ctx) })
        .returning('id')
        .executeTakeFirstOrThrow();
    }
    await ctx.db.insertInto('messages').values({ workspace_id: w.id, thread_id: thread.id, author_id: uid(ctx), author_side: 'staff', body: input.note, read_by_staff_at: ctx.now().toISOString() }).execute();
    await ctx.db.updateTable('threads').set({ last_message_at: ctx.now().toISOString() }).where('id', '=', thread.id).execute();
    ctx.audit({ entityType: 'application', entityId: app.id, action: 'applications.request_info', after: { reopen: input.reopenForEdits } });
    ctx.emit('application.info_requested', { type: 'application', id: app.id }, { note: input.note, reopened: input.reopenForEdits });
    return { ok: true as const };
  },
});

export const tagApplications = defineAction({
  id: 'applications.tag',
  title: 'Tag applications',
  description: 'Adds or removes tags on applications (staff-only labels).',
  input: z.object({ applicationIds: z.array(uuid).min(1).max(500), add: z.array(z.string().trim().min(1).max(40)).default([]), remove: z.array(z.string()).default([]) }),
  output: z.object({ updated: z.number() }),
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const apps = await ctx.db.selectFrom('applications').select(['id', 'tags']).where('id', 'in', input.applicationIds).execute();
    for (const a of apps) {
      const tags = [...new Set([...a.tags.filter((t) => !input.remove.includes(t)), ...input.add])];
      await ctx.db.updateTable('applications').set({ tags }).where('id', '=', a.id).execute();
    }
    return { updated: apps.length };
  },
});

export const markDuplicate = defineAction({
  id: 'applications.mark_duplicate',
  title: 'Mark as duplicate',
  description: 'Links an application to the one it duplicates (or clears the link).',
  input: z.object({ applicationId: uuid, duplicateOf: uuid.nullable() }),
  output: Ok,
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    if (input.applicationId === input.duplicateOf) throw new DomainError('validation_failed', 'An application cannot duplicate itself.');
    await ctx.db.updateTable('applications').set({ duplicate_of: input.duplicateOf }).where('id', '=', input.applicationId).execute();
    ctx.audit({ entityType: 'application', entityId: input.applicationId, after: { duplicateOf: input.duplicateOf } });
    return { ok: true as const };
  },
});

export const screenEligibility = defineAction({
  id: 'applications.screen_eligibility',
  title: 'Record an eligibility screening',
  description: 'Records an eligibility screening result for an application as a suggestion for staff (it never changes the application status).',
  input: z.object({ applicationId: uuid, results: z.array(z.object({ question: z.string().max(500), passed: z.boolean(), note: z.string().max(2000).optional() })).min(1).max(30) }),
  output: z.object({ recorded: z.number() }),
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    for (const r of input.results) {
      await ctx.db
        .insertInto('eligibility_results')
        .values({ workspace_id: w.id, application_id: input.applicationId, question: r.question, passed: r.passed, answer: json({ note: r.note ?? null }), source: ctx.actor.type === 'agent' ? 'agent' : 'staff' })
        .execute();
    }
    ctx.audit({ entityType: 'application', entityId: input.applicationId, action: 'applications.screen_eligibility', after: { count: input.results.length } });
    return { recorded: input.results.length };
  },
});

// Rubrics & stages ------------------------------------------------------------------------------
const CriterionIn = z.object({
  label: z.string().trim().min(1).max(200),
  guidance: z.string().max(3000).nullable().optional(),
  weightPct: z.number().positive().max(100),
  scaleMin: z.number().int().default(1),
  scaleMax: z.number().int().default(5),
  scaleLabels: z.record(z.string(), z.string()).optional(),
});

export const saveRubric = defineAction({
  id: 'review.save_rubric',
  title: 'Save a rubric',
  description: 'Creates or replaces a scoring rubric. Criterion weights must total exactly 100%.',
  input: z.object({ rubricId: uuid.optional(), name: z.string().trim().min(1).max(200), description: z.string().max(3000).nullable().optional(), criteria: z.array(CriterionIn).min(1).max(20) }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const total = Math.round(input.criteria.reduce((s, c) => s + c.weightPct, 0) * 100) / 100;
    if (total !== 100) {
      throw new DomainError('validation_failed', `Weights add up to ${total}%. Adjust them so they total 100%.`, { total }, [{ pointer: '/criteria', message: `Weights total ${total}%, not 100%.` }]);
    }
    for (const [i, c] of input.criteria.entries()) {
      if (c.scaleMin >= c.scaleMax) throw new DomainError('validation_failed', 'Each scale needs a lower minimum than maximum.', {}, [{ pointer: `/criteria/${i}/scaleMax`, message: 'Max must be above min.' }]);
    }
    let id = input.rubricId;
    if (id) {
      const inUse = await ctx.db.selectFrom('review_scores as s').innerJoin('rubric_criteria as c', 'c.id', 's.criterion_id').select('s.id').where('c.rubric_id', '=', id).executeTakeFirst();
      if (inUse) throw new DomainError('conflict', 'Reviewers have already scored with this rubric. Duplicate it to make changes.');
      await ctx.db.updateTable('rubrics').set({ name: input.name, description: input.description ?? null }).where('id', '=', id).execute();
      await ctx.db.deleteFrom('rubric_criteria').where('rubric_id', '=', id).execute();
    } else {
      id = (await ctx.db.insertInto('rubrics').values({ workspace_id: w.id, name: input.name, description: input.description ?? null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await ctx.db
      .insertInto('rubric_criteria')
      .values(
        input.criteria.map((c, i) => ({
          workspace_id: w.id,
          rubric_id: id!,
          position: i + 1,
          label: c.label,
          guidance: c.guidance ?? null,
          weight_pct: c.weightPct,
          scale_min: c.scaleMin,
          scale_max: c.scaleMax,
          scale_labels: json(c.scaleLabels ?? {}),
        })),
      )
      .execute();
    ctx.audit({ entityType: 'rubric', entityId: id, after: { name: input.name, criteria: input.criteria.length } });
    return { id: id! };
  },
});

export const saveReviewStage = defineAction({
  id: 'review.save_stage',
  title: 'Save a review stage',
  description: 'Creates or updates a review stage for a competition: rubric, blind mode, reviewers per application, due date, and status.',
  input: z.object({
    stageId: uuid.optional(),
    competitionId: uuid,
    name: z.string().trim().min(1).max(200),
    rubricId: uuid.nullable(),
    blind: z.boolean().default(false),
    reviewersPerApplication: z.number().int().min(1).max(20).default(2),
    dueAt: z.string().nullable().optional(),
    status: z.enum(['draft', 'active', 'closed']).default('draft'),
  }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const values = {
      competition_id: input.competitionId,
      name: input.name,
      rubric_id: input.rubricId,
      blind: input.blind,
      reviewers_per_application: input.reviewersPerApplication,
      due_at: input.dueAt ? new Date(input.dueAt).toISOString() : null,
      status: input.status,
    };
    if (input.stageId) {
      await ctx.db.updateTable('review_stages').set(values).where('id', '=', input.stageId).execute();
      ctx.audit({ entityType: 'review_stage', entityId: input.stageId, after: values });
      return { id: input.stageId };
    }
    const pos = await ctx.db.selectFrom('review_stages').select((eb) => eb.fn.countAll<number>().as('n')).where('competition_id', '=', input.competitionId).executeTakeFirst();
    const r = await ctx.db.insertInto('review_stages').values({ ...values, workspace_id: w.id, position: Number(pos?.n ?? 0) + 1 }).returning('id').executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'review_stage', entityId: r.id, after: values });
    return { id: r.id };
  },
});

// Assignment -----------------------------------------------------------------------------------------
const PlanItem = z.object({ applicationId: z.string(), reviewerId: z.string(), reviewerName: z.string().nullable() });

export const autoAssign = defineAction({
  id: 'review.auto_assign',
  title: 'Assign reviewers automatically',
  description:
    'Plans reviewer assignments round-robin with load balancing: each application gets the stage’s reviewers-per-application, never a reviewer with a declared conflict for that applicant, respecting reviewer capacity. With dryRun (default true) it only returns the plan; set dryRun false to create the assignments.',
  input: z.object({ stageId: uuid, applicationIds: z.array(uuid).max(2000).optional(), reviewerIds: z.array(uuid).max(200).optional(), dryRun: z.boolean().default(true) }),
  output: z.object({ plan: z.array(PlanItem), unassigned: z.array(z.object({ applicationId: z.string(), reason: z.string() })), overCapacity: z.array(z.string()), created: z.number() }),
  scopes: ['reviews:write'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const stage = found(await ctx.db.selectFrom('review_stages').selectAll().where('id', '=', input.stageId).executeTakeFirst(), 'review stage');
    let appsQ = ctx.db.selectFrom('applications').select(['id', 'applicant_org_id']).where('competition_id', '=', stage.competition_id).where('status', 'in', ['submitted', 'under_review']);
    if (input.applicationIds?.length) appsQ = appsQ.where('id', 'in', input.applicationIds);
    const apps = await appsQ.orderBy('submitted_at').execute();
    let revQ = ctx.db
      .selectFrom('workspace_members as m')
      .innerJoin('profiles as p', 'p.id', 'm.user_id')
      .select(['m.user_id', 'm.review_capacity', 'p.full_name'])
      .where('m.workspace_id', '=', w.id)
      .where('m.status', '=', 'active')
      .where('m.role', 'in', ['reviewer', 'program_officer']);
    if (input.reviewerIds?.length) revQ = revQ.where('m.user_id', 'in', input.reviewerIds);
    else revQ = revQ.where('m.role', '=', 'reviewer');
    const reviewers = await revQ.orderBy('p.full_name').execute();
    if (!reviewers.length) throw new DomainError('precondition_failed', 'There are no reviewers on the team yet. Invite reviewers first.');
    const existing = await ctx.db.selectFrom('review_assignments').select(['application_id', 'reviewer_id', 'status']).where('stage_id', '=', stage.id).execute();
    const conflicts = await ctx.db
      .selectFrom('coi_declarations as d')
      .innerJoin('review_assignments as ra', 'ra.id', 'd.assignment_id')
      .innerJoin('applications as a', 'a.id', 'ra.application_id')
      .select(['d.reviewer_id', 'a.applicant_org_id', 'ra.application_id'])
      .where('d.has_conflict', '=', true)
      .where('d.workspace_id', '=', w.id)
      .execute();
    const conflictKey = new Set(conflicts.map((c) => `${c.reviewer_id}:${c.applicant_org_id ?? c.application_id}`));
    const load = new Map<string, number>(reviewers.map((r) => [r.user_id, 0]));
    // Recused assignments count neither as coverage nor as reviewer load (the recused pair is still never re-proposed).
    const totals = await ctx.db.selectFrom('review_assignments').select(['reviewer_id']).select((eb) => eb.fn.countAll<number>().as('n')).where('stage_id', '=', stage.id).where('status', '<>', 'recused').groupBy('reviewer_id').execute();
    for (const t of totals) if (load.has(t.reviewer_id)) load.set(t.reviewer_id, Number(t.n));
    const has = new Set(existing.map((e) => `${e.application_id}:${e.reviewer_id}`));
    const plan: z.infer<typeof PlanItem>[] = [];
    const unassigned: { applicationId: string; reason: string }[] = [];
    const overCapacity = new Set<string>();
    const nameOf = new Map(reviewers.map((r) => [r.user_id, r.full_name]));
    for (const app of apps) {
      const already = existing.filter((e) => e.application_id === app.id && e.status !== 'recused').length;
      let need = stage.reviewers_per_application - already;
      if (need <= 0) continue;
      const candidates = reviewers
        .filter((r) => !has.has(`${app.id}:${r.user_id}`) && !conflictKey.has(`${r.user_id}:${app.applicant_org_id ?? app.id}`))
        .sort((a, b) => (load.get(a.user_id)! - load.get(b.user_id)!) || a.user_id.localeCompare(b.user_id));
      for (const r of candidates) {
        if (need <= 0) break;
        const cap = r.review_capacity;
        if (cap !== null && load.get(r.user_id)! >= cap) {
          overCapacity.add(r.user_id);
          continue;
        }
        plan.push({ applicationId: app.id, reviewerId: r.user_id, reviewerName: nameOf.get(r.user_id) ?? null });
        load.set(r.user_id, load.get(r.user_id)! + 1);
        has.add(`${app.id}:${r.user_id}`);
        need--;
      }
      if (need > 0) unassigned.push({ applicationId: app.id, reason: `Needs ${need} more reviewer${need === 1 ? '' : 's'} without conflicts or capacity limits.` });
    }
    let created = 0;
    if (!input.dryRun && plan.length) {
      await ctx.db
        .insertInto('review_assignments')
        .values(plan.map((p) => ({ workspace_id: w.id, stage_id: stage.id, application_id: p.applicationId, reviewer_id: p.reviewerId, assigned_by: uid(ctx), due_at: stage.due_at })))
        .onConflict((oc) => oc.doNothing())
        .execute();
      created = plan.length;
      ctx.audit({ entityType: 'review_stage', entityId: stage.id, action: 'review.auto_assign', after: { created, unassigned: unassigned.length } });
      ctx.emit('review.assigned', { type: 'review_stage', id: stage.id }, { count: created, reviewerIds: [...new Set(plan.map((p) => p.reviewerId))] });
    }
    return { plan, unassigned, overCapacity: [...overCapacity], created };
  },
});

export const assignReviewers = defineAction({
  id: 'review.assign',
  title: 'Assign reviewers',
  description: 'Assigns specific reviewers to applications in a review stage.',
  input: z.object({ stageId: uuid, assignments: z.array(z.object({ applicationId: uuid, reviewerId: uuid })).min(1).max(2000) }),
  output: z.object({ created: z.number() }),
  scopes: ['reviews:write'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const stage = found(await ctx.db.selectFrom('review_stages').select(['id', 'due_at']).where('id', '=', input.stageId).executeTakeFirst(), 'review stage');
    const r = await ctx.db
      .insertInto('review_assignments')
      .values(input.assignments.map((a) => ({ workspace_id: w.id, stage_id: stage.id, application_id: a.applicationId, reviewer_id: a.reviewerId, assigned_by: uid(ctx), due_at: stage.due_at })))
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .execute();
    ctx.audit({ entityType: 'review_stage', entityId: stage.id, action: 'review.assign', after: { created: r.length } });
    ctx.emit('review.assigned', { type: 'review_stage', id: stage.id }, { count: r.length, reviewerIds: [...new Set(input.assignments.map((a) => a.reviewerId))] });
    return { created: r.length };
  },
});

export const unassignReviewer = defineAction({
  id: 'review.unassign',
  title: 'Remove a reviewer assignment',
  description: 'Removes a reviewer assignment; only allowed while the reviewer has not submitted a review for it.',
  input: z.object({ assignmentId: uuid }),
  output: Ok,
  scopes: ['reviews:write'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('review_assignments').selectAll().where('id', '=', input.assignmentId).executeTakeFirst(), 'assignment');
    if (a.status === 'submitted') throw new DomainError('conflict', 'This reviewer already submitted a review.');
    await ctx.db.deleteFrom('review_assignments').where('id', '=', a.id).execute();
    ctx.audit({ entityType: 'review_assignment', entityId: a.id, before: { reviewerId: a.reviewer_id, applicationId: a.application_id } });
    return { ok: true as const };
  },
});

// Reviewer side -----------------------------------------------------------------------------------------
export const declareCoi = defineAction({
  id: 'review.declare_coi',
  title: 'Declare conflicts of interest',
  description: 'The reviewer declares whether they have a conflict of interest with an assigned application. A conflict recuses them; no conflict unlocks the application.',
  input: z.object({ assignmentId: uuid, hasConflict: z.boolean(), explanation: z.string().max(2000).optional() }),
  output: z.object({ status: z.string() }),
  scopes: ['reviews:write'],
  roles: ['reviewer', 'program_officer', 'admin', 'owner'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('review_assignments').selectAll().where('id', '=', input.assignmentId).where('reviewer_id', '=', uid(ctx)).executeTakeFirst(), 'assignment');
    if (input.hasConflict && !input.explanation?.trim()) {
      throw new DomainError('validation_failed', 'Briefly describe the conflict so staff can reassign fairly.', {}, [{ pointer: '/explanation', message: 'Describe the conflict.' }]);
    }
    // A declaration is a permanent record: repeating the same answer is a no-op; changing it goes through staff.
    const prior = await ctx.db.selectFrom('coi_declarations').select(['has_conflict']).where('assignment_id', '=', a.id).executeTakeFirst();
    if (prior) {
      if (prior.has_conflict === input.hasConflict) return { status: a.status };
      throw new DomainError('conflict', prior.has_conflict ? 'You already declared a conflict and were recused from this application.' : 'You already declared no conflict for this application. If that has changed, ask the program officer to reassign it.');
    }
    await ctx.db
      .insertInto('coi_declarations')
      .values({ workspace_id: a.workspace_id, assignment_id: a.id, reviewer_id: uid(ctx), has_conflict: input.hasConflict, explanation: input.explanation ?? null })
      .execute();
    let status = a.status;
    if (input.hasConflict) {
      transition(reviewMachine, a.status, 'recused');
      await ctx.db.updateTable('review_assignments').set({ status: 'recused' }).where('id', '=', a.id).execute();
      status = 'recused';
      ctx.emit('review.recused', { type: 'review_assignment', id: a.id }, { applicationId: a.application_id });
    }
    ctx.audit({ entityType: 'review_assignment', entityId: a.id, action: 'review.declare_coi', after: { hasConflict: input.hasConflict } });
    return { status };
  },
});

const ScoreIn = z.object({ criterionId: uuid, score: z.number(), comment: z.string().max(5000).optional().nullable() });

export const saveReview = defineAction({
  id: 'review.save',
  title: 'Save a review draft',
  description: 'Saves scores and comments for an assigned application without submitting.',
  input: z.object({
    assignmentId: uuid,
    scores: z.array(ScoreIn).max(30).default([]),
    overallComment: z.string().max(20000).nullable().optional(),
    privateNote: z.string().max(20000).nullable().optional(),
    recommendation: z.enum(['fund', 'maybe', 'decline']).nullable().optional(),
  }),
  output: z.object({ reviewId: z.string().uuid(), weightedScore: z.number().nullable() }),
  scopes: ['reviews:write'],
  roles: ['reviewer', 'program_officer', 'admin', 'owner'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('review_assignments').selectAll().where('id', '=', input.assignmentId).where('reviewer_id', '=', uid(ctx)).executeTakeFirst(), 'assignment');
    if (a.status === 'recused') throw new DomainError('conflict', 'You recused yourself from this application.');
    const stage = await ctx.db.selectFrom('review_stages').select(['rubric_id', 'status']).where('id', '=', a.stage_id).executeTakeFirstOrThrow();
    if (stage.status === 'closed') throw new DomainError('conflict', 'This review stage is closed.');
    const criteria = stage.rubric_id ? await ctx.db.selectFrom('rubric_criteria').selectAll().where('rubric_id', '=', stage.rubric_id).execute() : [];
    for (const [i, s] of input.scores.entries()) {
      const c = criteria.find((x) => x.id === s.criterionId);
      if (!c) throw new DomainError('validation_failed', 'Unknown rubric criterion.', {}, [{ pointer: `/scores/${i}/criterionId`, message: 'Not part of this rubric.' }]);
      if (s.score < c.scale_min || s.score > c.scale_max) {
        throw new DomainError('validation_failed', `Scores for “${c.label}” go from ${c.scale_min} to ${c.scale_max}.`, {}, [{ pointer: `/scores/${i}/score`, message: `Use ${c.scale_min}–${c.scale_max}.` }]);
      }
    }
    let review = await ctx.db.selectFrom('reviews').selectAll().where('assignment_id', '=', a.id).executeTakeFirst();
    if (review?.status === 'submitted') throw new DomainError('conflict', 'This review was submitted. Ask the program officer to reopen it.');
    if (!review) {
      review = await ctx.db.insertInto('reviews').values({ workspace_id: a.workspace_id, assignment_id: a.id, status: 'in_progress' }).returningAll().executeTakeFirstOrThrow();
    }
    await ctx.db
      .updateTable('reviews')
      .set({
        ...(input.overallComment !== undefined ? { overall_comment: input.overallComment } : {}),
        ...(input.privateNote !== undefined ? { private_note: input.privateNote } : {}),
        ...(input.recommendation !== undefined ? { recommendation: input.recommendation } : {}),
      })
      .where('id', '=', review.id)
      .execute();
    for (const s of input.scores) {
      await ctx.db
        .insertInto('review_scores')
        .values({ workspace_id: a.workspace_id, review_id: review.id, criterion_id: s.criterionId, score: s.score, comment: s.comment ?? null })
        .onConflict((oc) => oc.columns(['review_id', 'criterion_id']).doUpdateSet({ score: s.score, comment: s.comment ?? null }))
        .execute();
    }
    if (a.status === 'not_started') await ctx.db.updateTable('review_assignments').set({ status: 'in_progress' }).where('id', '=', a.id).execute();
    const weighted = await computeWeighted(ctx.db, review.id);
    await ctx.db.updateTable('reviews').set({ weighted_score: weighted }).where('id', '=', review.id).execute();
    return { reviewId: review.id, weightedScore: weighted };
  },
});

/** Weighted score on a 0–100 scale: Σ weight × (score − min)/(max − min). */
async function computeWeighted(db: Tx, reviewId: string): Promise<number | null> {
  const rows = await db
    .selectFrom('review_scores as s')
    .innerJoin('rubric_criteria as c', 'c.id', 's.criterion_id')
    .select(['s.score', 'c.weight_pct', 'c.scale_min', 'c.scale_max'])
    .where('s.review_id', '=', reviewId)
    .execute();
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + (Number(r.weight_pct) * (Number(r.score) - r.scale_min)) / (r.scale_max - r.scale_min), 0);
  return Math.round(total * 100) / 100;
}

export const submitReview = defineAction({
  id: 'review.submit',
  title: 'Submit a review',
  description: 'Submits a completed review (every rubric criterion scored). Consequential: agents get a confirmation request.',
  input: z.object({ assignmentId: uuid }),
  output: z.object({ weightedScore: z.number().nullable() }),
  scopes: ['reviews:write'],
  roles: ['reviewer', 'program_officer', 'admin', 'owner'],
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('review_assignments').selectAll().where('id', '=', input.assignmentId).where('reviewer_id', '=', uid(ctx)).executeTakeFirst(), 'assignment');
    transition(reviewMachine, a.status, 'submitted');
    const review = found(await ctx.db.selectFrom('reviews').selectAll().where('assignment_id', '=', a.id).executeTakeFirst(), 'review draft');
    const stage = await ctx.db.selectFrom('review_stages').select(['rubric_id']).where('id', '=', a.stage_id).executeTakeFirstOrThrow();
    if (stage.rubric_id) {
      const criteria = await ctx.db.selectFrom('rubric_criteria').select(['id', 'label']).where('rubric_id', '=', stage.rubric_id).execute();
      const scored = new Set((await ctx.db.selectFrom('review_scores').select('criterion_id').where('review_id', '=', review.id).execute()).map((s) => s.criterion_id));
      const missing = criteria.filter((c) => !scored.has(c.id));
      if (missing.length) {
        throw new DomainError('validation_failed', `Score every criterion before submitting (${missing.length} left).`, {}, missing.map((m) => ({ pointer: `/scores/${m.id}`, message: `Score “${m.label}”.` })));
      }
    }
    const weighted = await computeWeighted(ctx.db, review.id);
    await ctx.db.updateTable('reviews').set({ status: 'submitted', submitted_at: ctx.now().toISOString(), weighted_score: weighted }).where('id', '=', review.id).execute();
    await ctx.db.updateTable('review_assignments').set({ status: 'submitted' }).where('id', '=', a.id).execute();
    ctx.audit({ entityType: 'review', entityId: review.id, before: { status: review.status }, after: { status: 'submitted', weightedScore: weighted } });
    ctx.emit('review.submitted', { type: 'review', id: review.id }, { applicationId: a.application_id, weightedScore: weighted });
    return { weightedScore: weighted };
  },
});

export const reopenReview = defineAction({
  id: 'review.reopen',
  title: 'Reopen a review',
  description: 'Reopens a submitted review so the reviewer can change their scores or comments.',
  input: z.object({ assignmentId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('review_assignments').selectAll().where('id', '=', input.assignmentId).executeTakeFirst(), 'assignment');
    transition(reviewMachine, a.status, 'in_progress');
    await ctx.db.updateTable('review_assignments').set({ status: 'in_progress' }).where('id', '=', a.id).execute();
    await ctx.db.updateTable('reviews').set({ status: 'in_progress', submitted_at: null }).where('assignment_id', '=', a.id).execute();
    ctx.audit({ entityType: 'review_assignment', entityId: a.id, action: 'review.reopen' });
    return { ok: true as const };
  },
});

export const addPanelNote = defineAction({
  id: 'review.panel_note',
  title: 'Add a panel note',
  description: 'Adds a note about an application that other panel reviewers and program staff can read (never the applicant).',
  input: z.object({ applicationId: uuid, panelId: uuid.nullable().optional(), body: z.string().trim().min(1).max(10000) }),
  output: IdOut,
  scopes: ['reviews:write'],
  roles: ['reviewer', 'program_officer', 'admin', 'owner'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('panel_notes')
      .values({ workspace_id: w.id, application_id: input.applicationId, panel_id: input.panelId ?? null, author_id: uid(ctx), body: input.body })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.emit('panel.note_added', { type: 'application', id: input.applicationId }, { panelId: input.panelId ?? null });
    return { id: r.id };
  },
});

export const savePanel = defineAction({
  id: 'review.save_panel',
  title: 'Schedule a review panel',
  description: 'Creates or updates a review panel meeting for a stage and sets whether it is live.',
  input: z.object({ panelId: uuid.optional(), stageId: uuid, name: z.string().trim().min(1).max(200), meetsAt: z.string().nullable().optional(), status: z.enum(['scheduled', 'live', 'closed']).default('scheduled') }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const values = { stage_id: input.stageId, name: input.name, meets_at: input.meetsAt ? new Date(input.meetsAt).toISOString() : null, status: input.status };
    if (input.panelId) {
      await ctx.db.updateTable('panels').set(values).where('id', '=', input.panelId).execute();
      return { id: input.panelId };
    }
    const r = await ctx.db.insertInto('panels').values({ ...values, workspace_id: w.id }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id };
  },
});
