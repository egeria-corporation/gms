// SPDX-License-Identifier: AGPL-3.0-only
// Post-award: grantee reports (draft → submit → accept / revisions), overdue tracking + payment holds,
// change requests (extension / amendment / budget change), site visits; due diligence (IRS status, OFAC).
import { sql } from '@gms/db';
import { DomainError, reportMachine } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { compiledFor, validate } from './forms-bridge';
import { DateOnly, found, IdOut, json, Ok, transition, uid, uuid, ws } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

// Reports ------------------------------------------------------------------------------------------
async function reportContext(ctxDb: import('@gms/db').Tx, requirementId: string) {
  const req = found(await ctxDb.selectFrom('report_requirements').selectAll().where('id', '=', requirementId).executeTakeFirst(), 'report');
  const version = req.form_id
    ? await ctxDb
        .selectFrom('forms as f')
        .innerJoin('form_versions as v', 'v.id', 'f.current_version_id')
        .select(['v.id', 'v.builder_model'])
        .where('f.id', '=', req.form_id)
        .executeTakeFirst()
    : undefined;
  return { req, version };
}

export const saveReport = defineAction({
  id: 'reports.save',
  title: 'Save a grant report draft',
  description: 'Saves answers to a grant report (partial update). Returns validation problems; nothing is submitted.',
  input: z.object({ requirementId: uuid, answers: z.record(z.string(), z.unknown()) }),
  output: z.object({ submissionId: z.string().uuid(), errors: z.array(z.object({ pointer: z.string(), message: z.string(), fieldId: z.string().optional(), pageId: z.string().optional() })) }),
  scopes: ['reports:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const { req, version } = await reportContext(ctx.db, input.requirementId);
    if (['submitted', 'accepted'].includes(req.status)) throw new DomainError('conflict', 'This report was already submitted.');
    let sub = await ctx.db.selectFrom('report_submissions').selectAll().where('requirement_id', '=', req.id).where('status', 'in', ['draft', 'revisions_requested']).orderBy('created_at', 'desc').executeTakeFirst();
    const data = { ...((sub?.data ?? {}) as Record<string, unknown>), ...input.answers };
    if (!sub) {
      sub = await ctx.db
        .insertInto('report_submissions')
        .values({ workspace_id: req.workspace_id, requirement_id: req.id, award_id: req.award_id, form_version_id: version?.id ?? null, data: json(data), status: 'draft' })
        .returningAll()
        .executeTakeFirstOrThrow();
    } else {
      await ctx.db.updateTable('report_submissions').set({ data: json(data) }).where('id', '=', sub.id).execute();
    }
    const errors = version ? validate(compiledFor({ id: version.id, builder_model: version.builder_model }), data, 'save').errors : [];
    return { submissionId: sub.id, errors };
  },
});

export const submitReport = defineAction({
  id: 'reports.submit',
  title: 'Submit a grant report',
  description: 'Submits a grant report to the foundation. Consequential: an agent gets a confirmation request that the person approves in GMS.',
  input: z.object({ requirementId: uuid, attestation: z.object({ typedName: z.string().trim().min(2).max(200), agreed: z.literal(true) }) }),
  output: z.object({ submittedAt: z.string() }),
  scopes: ['reports:write'],
  roles: ['authenticated'],
  riskTier: 'R2',
  idempotent: true,
  async preview(input, ctx) {
    const { req } = await reportContext(ctx.db, input.requirementId);
    const award = await ctx.db.selectFrom('awards').select(['reference', 'title']).where('id', '=', req.award_id).executeTakeFirst();
    return {
      title: `Submit “${req.title}”`,
      summary: `${ctx.actor.name} asked to submit the ${req.title.toLowerCase()} for grant ${award?.reference ?? ''}.`,
      fields: [
        { label: 'Grant', value: `${award?.title ?? ''} (${award?.reference ?? ''})` },
        { label: 'Report', value: req.title },
        { label: 'Due', value: req.due_date },
        { label: 'Signed as', value: input.attestation.typedName },
      ],
      entity: { type: 'report_requirement', id: req.id },
    };
  },
  async run(input, ctx) {
    const { req, version } = await reportContext(ctx.db, input.requirementId);
    transition(reportMachine, req.status, 'submitted');
    const sub = found(
      await ctx.db.selectFrom('report_submissions').selectAll().where('requirement_id', '=', req.id).where('status', 'in', ['draft', 'revisions_requested']).orderBy('created_at', 'desc').executeTakeFirst(),
      'report draft',
    );
    if (version) {
      const v = validate(compiledFor({ id: version.id, builder_model: version.builder_model }), (sub.data ?? {}) as Record<string, unknown>, 'submit');
      if (!v.valid) throw new DomainError('validation_failed', `${v.errors.length} answer(s) need attention before you can submit.`, {}, v.errors.map((e) => ({ pointer: e.pointer, message: e.message })));
    }
    const at = ctx.now().toISOString();
    await ctx.db
      .updateTable('report_submissions')
      .set({ status: 'submitted', submitted_at: at, submitted_by: uid(ctx), submitted_by_agent_client_id: ctx.actor.type === 'agent' ? (ctx.actor.agentClientId ?? null) : null, data: json({ ...(sub.data as object), _attestation: { ...input.attestation, at } }) })
      .where('id', '=', sub.id)
      .execute();
    await ctx.db.updateTable('report_requirements').set({ status: 'submitted' }).where('id', '=', req.id).execute();
    ctx.audit({ entityType: 'report_requirement', entityId: req.id, before: { status: req.status }, after: { status: 'submitted' } });
    ctx.emit('report.submitted', { type: 'report_requirement', id: req.id }, { awardId: req.award_id, title: req.title });
    return { submittedAt: at };
  },
});

export const reviewReport = defineAction({
  id: 'reports.review',
  title: 'Review a grant report',
  description: 'Accepts a submitted report (optionally recording indicator values) or requests revisions with notes for the grantee.',
  input: z.object({ requirementId: uuid, decision: z.enum(['accept', 'revise']), note: z.string().max(5000).optional(), indicators: z.array(z.object({ indicatorId: uuid, value: z.number(), periodEnd: DateOnly.optional() })).max(50).default([]) }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const { req } = await reportContext(ctx.db, input.requirementId);
    const to = input.decision === 'accept' ? 'accepted' : 'revisions_requested';
    transition(reportMachine, req.status, to);
    if (to === 'revisions_requested' && !input.note?.trim()) throw new DomainError('validation_failed', 'Tell the grantee what to change.', {}, [{ pointer: '/note', message: 'Required.' }]);
    const sub = found(await ctx.db.selectFrom('report_submissions').selectAll().where('requirement_id', '=', req.id).where('status', '=', 'submitted').orderBy('submitted_at', 'desc').executeTakeFirst(), 'submission');
    await ctx.db.updateTable('report_submissions').set({ status: to, reviewer_id: uid(ctx), review_note: input.note ?? null, reviewed_at: ctx.now().toISOString() }).where('id', '=', sub.id).execute();
    await ctx.db.updateTable('report_requirements').set({ status: to }).where('id', '=', req.id).execute();
    for (const iv of input.indicators) {
      await ctx.db.insertInto('indicator_values').values({ workspace_id: req.workspace_id, indicator_id: iv.indicatorId, award_id: req.award_id, report_submission_id: sub.id, value: iv.value, period_end: iv.periodEnd ?? req.due_date }).execute();
    }
    // Clear the overdue flag when nothing else is overdue.
    const overdue = await ctx.db.selectFrom('report_requirements').select('id').where('award_id', '=', req.award_id).where('status', '=', 'overdue').executeTakeFirst();
    if (!overdue) await ctx.db.updateTable('awards').set({ report_overdue: false }).where('id', '=', req.award_id).execute();
    ctx.audit({ entityType: 'report_requirement', entityId: req.id, before: { status: req.status }, after: { status: to, indicators: input.indicators.length } });
    ctx.emit(input.decision === 'accept' ? 'report.accepted' : 'report.revisions_requested', { type: 'report_requirement', id: req.id }, { awardId: req.award_id, note: input.note ?? null });
    return { ok: true as const };
  },
});

export const setReportHold = defineAction({
  id: 'reports.set_hold',
  title: 'Toggle the overdue-report hold',
  description: 'Chooses whether an overdue report on this requirement holds the grant’s payments.',
  input: z.object({ requirementId: uuid, holdsPayments: z.boolean() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('report_requirements').set({ holds_payments: input.holdsPayments }).where('id', '=', input.requirementId).execute();
    ctx.audit({ entityType: 'report_requirement', entityId: input.requirementId, after: { holdsPayments: input.holdsPayments } });
    return { ok: true as const };
  },
});

export const addReportRequirement = defineAction({
  id: 'reports.add_requirement',
  title: 'Add a report requirement',
  description: 'Adds a report due date to an award.',
  input: z.object({ awardId: uuid, title: z.string().trim().min(1).max(200), kind: z.enum(['interim', 'final', 'financial', 'narrative']), dueDate: DateOnly, formId: uuid.nullable().optional() }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('report_requirements')
      .values({ workspace_id: w.id, award_id: input.awardId, title: input.title, kind: input.kind, due_date: input.dueDate, form_id: input.formId ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'report_requirement', entityId: r.id, after: input });
    return { id: r.id };
  },
});

export const tickReports = defineAction({
  id: 'system.tick_reports',
  title: 'Update report due states',
  description: 'System task (daily): marks reports Due (within 30 days) and Overdue, flags awards with overdue reports, and queues reminders.',
  input: z.object({}),
  output: z.object({ due: z.number(), overdue: z.number(), reminders: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(_input, ctx) {
    const today = ctx.now().toISOString().slice(0, 10);
    const soon = new Date(ctx.now().getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const due = await ctx.db.updateTable('report_requirements').set({ status: 'due' }).where('status', '=', 'upcoming').where('due_date', '<=', soon).where('due_date', '>=', today).returning(['id']).execute();
    const overdue = await ctx.db
      .updateTable('report_requirements')
      .set({ status: 'overdue' })
      .where('status', 'in', ['upcoming', 'due', 'revisions_requested'])
      .where('due_date', '<', today)
      .returning(['id', 'award_id', 'workspace_id', 'holds_payments'])
      .execute();
    for (const r of overdue) {
      await ctx.db.updateTable('awards').set({ report_overdue: true }).where('id', '=', r.award_id).execute();
      ctx.emit('report.overdue', { type: 'report_requirement', id: r.id }, { awardId: r.award_id, workspaceId: r.workspace_id });
    }
    // Reminders: 14 days before due, once.
    const remind = await ctx.db
      .updateTable('report_requirements')
      .set({ reminder_sent_at: ctx.now().toISOString() })
      .where('reminder_sent_at', 'is', null)
      .where('status', 'in', ['upcoming', 'due'])
      .where('due_date', '<=', new Date(ctx.now().getTime() + 14 * 86400000).toISOString().slice(0, 10))
      .returning(['id', 'award_id', 'workspace_id'])
      .execute();
    for (const r of remind) ctx.emit('report.due', { type: 'report_requirement', id: r.id }, { awardId: r.award_id, workspaceId: r.workspace_id });
    return { due: due.length, overdue: overdue.length, reminders: remind.length };
  },
});

// Change requests (B-12) --------------------------------------------------------------------------------
export const requestChange = defineAction({
  id: 'awards.request_change',
  title: 'Request an extension or change',
  description: 'The grantee asks the foundation for a report extension, a grant amendment (e.g. more time), or a budget change. Staff decide.',
  input: z.object({
    awardId: uuid,
    kind: z.enum(['extension', 'amendment', 'budget_change']),
    requirementId: uuid.optional(),
    reason: z.string().trim().min(10).max(5000),
    details: z.object({ newDueDate: DateOnly.optional(), newEndDate: DateOnly.optional(), amountCents: z.number().int().optional(), budgetLines: z.array(z.object({ line: z.string(), fromCents: z.number().int(), toCents: z.number().int() })).max(50).optional() }).default({}),
  }),
  output: IdOut,
  scopes: ['reports:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('awards').select(['id', 'workspace_id']).where('id', '=', input.awardId).executeTakeFirst(), 'grant');
    if (input.kind === 'extension' && !input.details.newDueDate) throw new DomainError('validation_failed', 'Pick the new due date you are asking for.', {}, [{ pointer: '/details/newDueDate', message: 'Required.' }]);
    const r = await ctx.db
      .insertInto('change_requests')
      .values({
        workspace_id: a.workspace_id,
        award_id: a.id,
        requirement_id: input.requirementId ?? null,
        kind: input.kind,
        reason: input.reason,
        details: json(input.details),
        status: 'pending',
        requested_by: uid(ctx),
        requested_by_agent_client_id: ctx.actor.type === 'agent' ? (ctx.actor.agentClientId ?? null) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'change_request', entityId: r.id, after: { kind: input.kind } });
    ctx.emit('change_request.created', { type: 'change_request', id: r.id }, { awardId: a.id, kind: input.kind });
    return { id: r.id };
  },
});

export const decideChange = defineAction({
  id: 'awards.decide_change',
  title: 'Decide a change request',
  description: 'Approves or declines a grantee’s change request. Approving an extension moves the report due date.',
  input: z.object({ changeRequestId: uuid, approve: z.boolean(), note: z.string().max(5000).optional() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const cr = found(await ctx.db.selectFrom('change_requests').selectAll().where('id', '=', input.changeRequestId).executeTakeFirst(), 'change request');
    if (cr.status !== 'pending') throw new DomainError('conflict', 'This request was already decided.');
    const status = input.approve ? 'approved' : 'declined';
    await ctx.db.updateTable('change_requests').set({ status, decided_by: uid(ctx), decided_at: ctx.now().toISOString(), decision_note: input.note ?? null }).where('id', '=', cr.id).execute();
    const details = cr.details as { newDueDate?: string };
    if (input.approve && cr.kind === 'extension' && cr.requirement_id && details.newDueDate) {
      await ctx.db
        .updateTable('report_requirements')
        .set({ due_date: details.newDueDate, status: sql`case when status = 'overdue' then 'due' else status end` })
        .where('id', '=', cr.requirement_id)
        .execute();
    }
    ctx.audit({ entityType: 'change_request', entityId: cr.id, before: { status: 'pending' }, after: { status, note: input.note ?? null } });
    ctx.emit('change_request.decided', { type: 'change_request', id: cr.id }, { approve: input.approve, awardId: cr.award_id });
    return { ok: true as const };
  },
});

export const recordSiteVisit = defineAction({
  id: 'grantees.record_site_visit',
  title: 'Record a site visit',
  description: 'Records a site visit with a grantee: date, summary, and follow-ups.',
  input: z.object({ applicantOrgId: uuid, awardId: uuid.nullable().optional(), visitedOn: DateOnly, summary: z.string().trim().min(1).max(10000), followUps: z.string().max(5000).optional() }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('site_visits')
      .values({ workspace_id: w.id, applicant_org_id: input.applicantOrgId, award_id: input.awardId ?? null, visited_on: input.visitedOn, visited_by: uid(ctx), summary: input.summary, follow_ups: input.followUps ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'site_visit', entityId: r.id, after: { orgId: input.applicantOrgId, visitedOn: input.visitedOn } });
    return { id: r.id };
  },
});

// Due diligence ------------------------------------------------------------------------------------------
export const runDiligence = defineAction({
  id: 'diligence.run',
  title: 'Run due diligence checks',
  description: 'Checks an organization’s IRS exempt status and screens its name (and fiscal sponsor) against the OFAC SDN list with fuzzy matching. Potential matches need a person’s review.',
  input: z.object({ applicantOrgId: uuid, awardId: uuid.nullable().optional(), context: z.enum(['award', 'payment', 'manual']).default('manual') }),
  output: z.object({ irs: z.string(), ofac: z.string(), bestScore: z.number() }),
  scopes: [],
  roles: ['owner', 'admin', 'program_officer', 'finance', 'system'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const org = found(await ctx.db.selectFrom('applicant_orgs').selectAll().where('id', '=', input.applicantOrgId).executeTakeFirst(), 'organization');
    const irsRec = org.ein ? await ctx.db.selectFrom('irs_exempt_orgs').selectAll().where('ein', '=', org.ein).executeTakeFirst() : undefined;
    const sponsorRec = org.fiscal_sponsor_ein ? await ctx.db.selectFrom('irs_exempt_orgs').selectAll().where('ein', '=', org.fiscal_sponsor_ein).executeTakeFirst() : undefined;
    const effective = org.org_type === 'fiscally_sponsored' ? sponsorRec : irsRec;
    const irsStatus = !effective ? 'review' : effective.status === 'active' ? 'pass' : 'fail';
    await ctx.db
      .insertInto('diligence_checks')
      .values({
        workspace_id: w.id,
        applicant_org_id: org.id,
        award_id: input.awardId ?? null,
        kind: 'irs_status',
        status: irsStatus,
        result: json({ ein: org.ein, sponsorEin: org.fiscal_sponsor_ein, record: effective ?? null, checkedAgainst: org.org_type === 'fiscally_sponsored' ? 'fiscal_sponsor' : 'organization' }),
      })
      .execute();
    const names = [org.legal_name, org.dba_name, org.fiscal_sponsor_name].filter((n): n is string => Boolean(n));
    const matches: { name: string; score: number; programs: string[]; query: string }[] = [];
    for (const n of names) {
      const r = await sql<{ entry_id: string; name: string; score: number; programs: string[] }>`select * from gms.sanctions_search(${n}, 0.45)`.execute(ctx.db);
      for (const m of r.rows) matches.push({ name: m.name, score: Number(m.score), programs: m.programs, query: n });
    }
    const best = matches.reduce((b, m) => Math.max(b, m.score), 0);
    const status = best >= 0.45 ? 'potential_match' : 'clear';
    await ctx.db
      .insertInto('sanctions_screenings')
      .values({ workspace_id: w.id, applicant_org_id: org.id, award_id: input.awardId ?? null, context: input.context, query_name: names.join(' | '), best_score: best, matches: json(matches.sort((a, b) => b.score - a.score).slice(0, 10)), status })
      .execute();
    await ctx.db
      .insertInto('diligence_checks')
      .values({ workspace_id: w.id, applicant_org_id: org.id, award_id: input.awardId ?? null, kind: 'ofac', status: status === 'clear' ? 'pass' : 'review', result: json({ bestScore: best, matches: matches.length }) })
      .execute();
    ctx.audit({ entityType: 'applicant_org', entityId: org.id, action: 'diligence.run', after: { irs: irsStatus, ofac: status, bestScore: best } });
    if (status === 'potential_match') ctx.emit('diligence.match_found', { type: 'applicant_org', id: org.id }, { bestScore: best });
    return { irs: irsStatus, ofac: status, bestScore: best };
  },
});

export const resolveScreening = defineAction({
  id: 'diligence.resolve_screening',
  title: 'Review a sanctions match',
  description: 'A person reviews a potential OFAC match and records it as a false positive (clears the payment block) or a confirmed match (keeps payments blocked). People only (R3).',
  input: z.object({ screeningId: uuid, outcome: z.enum(['false_positive', 'confirmed_match']), note: z.string().trim().min(5).max(5000) }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'finance', 'program_officer'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const s = found(await ctx.db.selectFrom('sanctions_screenings').selectAll().where('id', '=', input.screeningId).executeTakeFirst(), 'screening');
    if (s.status !== 'potential_match') throw new DomainError('conflict', 'This screening was already reviewed.');
    await ctx.db.updateTable('sanctions_screenings').set({ status: input.outcome, reviewed_by: uid(ctx), reviewed_at: ctx.now().toISOString(), review_note: input.note }).where('id', '=', s.id).execute();
    await ctx.db
      .updateTable('diligence_checks')
      .set({ status: input.outcome === 'false_positive' ? 'pass' : 'fail', reviewed_by: uid(ctx), reviewed_at: ctx.now().toISOString(), note: input.note })
      .where('applicant_org_id', '=', s.applicant_org_id!)
      .where('kind', '=', 'ofac')
      .where('status', '=', 'review')
      .execute();
    ctx.audit({ entityType: 'sanctions_screening', entityId: s.id, before: { status: s.status }, after: { status: input.outcome, note: input.note } });
    return { ok: true as const };
  },
});

export const setDiligenceFlags = defineAction({
  id: 'diligence.set_flags',
  title: 'Set expenditure-responsibility flags',
  description: 'Marks an award as requiring expenditure responsibility, or as a grant to an individual.',
  input: z.object({ awardId: uuid, expenditureResponsibility: z.boolean(), grantToIndividual: z.boolean() }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer', 'finance'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('awards').set({ expenditure_responsibility: input.expenditureResponsibility, grant_to_individual: input.grantToIndividual }).where('id', '=', input.awardId).execute();
    ctx.audit({ entityType: 'award', entityId: input.awardId, action: 'diligence.set_flags', after: input });
    return { ok: true as const };
  },
});
