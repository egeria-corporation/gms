// SPDX-License-Identifier: AGPL-3.0-only
// Programs & budgets, opportunities (Draft → Forecasted → Open → Closed → Archived), competitions (stages),
// eligibility rules, invitations to later stages, per-applicant extensions, and the schedule tick.
import { randomUUID } from 'node:crypto';
import { sql } from '@gms/db';
import { DomainError, opportunityMachine, slugify, zonedTimeToUtc } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { found, IdOut, json, Ok, recordStatus, transition, uid, uuid, ws, Slug } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

/** Accepts an ISO timestamp with offset, or a wall-clock "YYYY-MM-DDTHH:mm" in the workspace timezone. */
const WhenIn = z.string().min(10).max(40).nullable().optional();
function toUtc(v: string | null | undefined, tz: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return new Date(v).toISOString();
  return zonedTimeToUtc(v, tz).toISOString();
}

// Programs -------------------------------------------------------------------------------
export const createProgram = defineAction({
  id: 'programs.create',
  title: 'Create a program',
  description: 'Creates a grant program (a funding area with its own budget and opportunities).',
  input: z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(5000).optional().nullable(), causeArea: z.string().max(120).optional().nullable(), leadUserId: uuid.optional().nullable() }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    let slug = slugify(input.name) || 'program';
    const clash = await ctx.db.selectFrom('programs').select('slug').where('workspace_id', '=', w.id).where('slug', 'like', `${slug}%`).execute();
    if (clash.some((c) => c.slug === slug)) slug = `${slug}-${clash.length + 1}`;
    const r = await ctx.db
      .insertInto('programs')
      .values({ workspace_id: w.id, name: input.name, slug, description: input.description ?? null, cause_area: input.causeArea ?? null, lead_user_id: input.leadUserId ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'program', entityId: r.id, after: { name: input.name } });
    return { id: r.id };
  },
});

export const updateProgram = defineAction({
  id: 'programs.update',
  title: 'Update a program',
  description: 'Updates a program’s name, description, cause area, lead, or archives it.',
  input: z.object({ programId: uuid, name: z.string().trim().min(1).max(200).optional(), description: z.string().max(5000).nullable().optional(), causeArea: z.string().max(120).nullable().optional(), leadUserId: uuid.nullable().optional(), status: z.enum(['active', 'archived']).optional() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const before = found(await ctx.db.selectFrom('programs').selectAll().where('id', '=', input.programId).executeTakeFirst(), 'program');
    await ctx.db
      .updateTable('programs')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.causeArea !== undefined ? { cause_area: input.causeArea } : {}),
        ...(input.leadUserId !== undefined ? { lead_user_id: input.leadUserId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where('id', '=', input.programId)
      .execute();
    ctx.audit({ entityType: 'program', entityId: input.programId, before: { name: before.name, status: before.status }, after: input });
    return { ok: true as const };
  },
});

export const setProgramBudget = defineAction({
  id: 'programs.set_budget',
  title: 'Set a program budget',
  description: 'Sets a program’s grantmaking budget for a fiscal year (integer cents).',
  input: z.object({ programId: uuid, fiscalYear: z.number().int().min(2000).max(2100), amountCents: z.number().int().min(0) }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'finance'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const prev = await ctx.db.selectFrom('program_budgets').select('amount_cents').where('program_id', '=', input.programId).where('fiscal_year', '=', input.fiscalYear).executeTakeFirst();
    await ctx.db
      .insertInto('program_budgets')
      .values({ workspace_id: w.id, program_id: input.programId, fiscal_year: input.fiscalYear, amount_cents: input.amountCents })
      .onConflict((oc) => oc.columns(['program_id', 'fiscal_year']).doUpdateSet({ amount_cents: input.amountCents }))
      .execute();
    ctx.audit({ entityType: 'program', entityId: input.programId, action: 'programs.set_budget', before: prev ?? null, after: { fiscalYear: input.fiscalYear, amountCents: input.amountCents } });
    return { ok: true as const };
  },
});

// Opportunities -----------------------------------------------------------------------------
const Faq = z.array(z.object({ q: z.string().trim().min(1).max(500), a: z.string().trim().min(1).max(5000) })).max(50);
const Distribution = z.object({ site: z.boolean(), embed: z.boolean(), cgFeed: z.boolean(), openGrants: z.boolean() });

const OppFields = z.object({
  programId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(300),
  slug: Slug.optional(),
  summary: z.string().max(1000).nullable().optional(),
  descriptionMd: z.string().max(50000).nullable().optional(),
  eligibilityMd: z.string().max(20000).nullable().optional(),
  guidelinesMd: z.string().max(100000).nullable().optional(),
  faq: Faq.optional(),
  fundingTotalCents: z.number().int().min(0).nullable().optional(),
  awardMinCents: z.number().int().min(0).nullable().optional(),
  awardMaxCents: z.number().int().min(0).nullable().optional(),
  expectedAwardCount: z.number().int().min(0).nullable().optional(),
  applicantTypes: z.array(z.string().max(60)).max(20).optional(),
  causeTerms: z.array(z.string().max(80)).max(30).optional(),
  geographyTerms: z.array(z.string().max(80)).max(30).optional(),
  populationTerms: z.array(z.string().max(80)).max(30).optional(),
  forecastAt: WhenIn,
  opensAt: WhenIn,
  closesAt: WhenIn,
  decisionExpectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal('')),
  visibility: z.enum(['public', 'unlisted']).optional(),
  distribution: Distribution.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

function oppColumns(input: Partial<z.infer<typeof OppFields>>, tz: string) {
  const c: Record<string, unknown> = {};
  const m: [keyof typeof input, string][] = [
    ['programId', 'program_id'],
    ['title', 'title'],
    ['summary', 'summary'],
    ['descriptionMd', 'description_md'],
    ['eligibilityMd', 'eligibility_md'],
    ['guidelinesMd', 'guidelines_md'],
    ['fundingTotalCents', 'funding_total_cents'],
    ['awardMinCents', 'award_min_cents'],
    ['awardMaxCents', 'award_max_cents'],
    ['expectedAwardCount', 'expected_award_count'],
    ['applicantTypes', 'applicant_types'],
    ['causeTerms', 'cause_terms'],
    ['geographyTerms', 'geography_terms'],
    ['populationTerms', 'population_terms'],
    ['decisionExpectedOn', 'decision_expected_on'],
    ['visibility', 'visibility'],
  ];
  for (const [k, col] of m) if (input[k] !== undefined) c[col] = input[k];
  if (input.contactEmail !== undefined) c.contact_email = input.contactEmail || null;
  if (input.faq !== undefined) c.faq = json(input.faq);
  if (input.distribution !== undefined) c.distribution = json(input.distribution);
  if (input.customFields !== undefined) c.custom_fields = json(input.customFields);
  for (const [k, col] of [['forecastAt', 'forecast_at'], ['opensAt', 'opens_at'], ['closesAt', 'closes_at']] as const) {
    const v = toUtc(input[k], tz);
    if (v !== undefined) c[col] = v;
  }
  return c;
}

export const createOpportunity = defineAction({
  id: 'opportunities.create',
  title: 'Create an opportunity',
  description: 'Creates a draft funding opportunity with a first competition (stage). Nothing is public until it is published.',
  input: OppFields,
  output: z.object({ id: z.string().uuid(), slug: z.string(), competitionId: z.string().uuid() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    let slug = input.slug ?? (slugify(input.title) || 'opportunity');
    const clash = await ctx.db.selectFrom('opportunities').select('slug').where('workspace_id', '=', w.id).where('slug', 'like', `${slug}%`).execute();
    if (clash.some((c) => c.slug === slug)) slug = `${slug}-${clash.length + 1}`;
    const id = randomUUID();
    await ctx.db
      .insertInto('opportunities')
      .values({ id, workspace_id: w.id, slug, title: input.title, status: 'draft', created_by: uid(ctx), ...oppColumns(input, w.timezone) } as never)
      .execute();
    const comp = await ctx.db
      .insertInto('competitions')
      .values({
        workspace_id: w.id,
        opportunity_id: id,
        name: 'Application',
        stage_order: 1,
        access: 'public',
        status: 'draft',
        opens_at: toUtc(input.opensAt, w.timezone) ?? null,
        closes_at: toUtc(input.closesAt, w.timezone) ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'opportunity', entityId: id, after: { title: input.title, slug } });
    return { id, slug, competitionId: comp.id };
  },
});

export const updateOpportunity = defineAction({
  id: 'opportunities.update',
  title: 'Update an opportunity',
  description: 'Updates opportunity details, dates (in the workspace timezone unless an offset is given), distribution and FAQs.',
  input: OppFields.partial().extend({ opportunityId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const before = found(await ctx.db.selectFrom('opportunities').selectAll().where('id', '=', input.opportunityId).executeTakeFirst(), 'opportunity');
    if (before.status === 'archived') throw new DomainError('conflict', 'Archived opportunities cannot be edited.');
    const cols = oppColumns(input, w.timezone);
    if (input.slug && input.slug !== before.slug) cols.slug = input.slug;
    if (Object.keys(cols).length) await ctx.db.updateTable('opportunities').set(cols as never).where('id', '=', before.id).execute();
    // Keep the first stage's window in sync with the opportunity dates.
    if (cols.opens_at !== undefined || cols.closes_at !== undefined) {
      await ctx.db
        .updateTable('competitions')
        .set({ ...(cols.opens_at !== undefined ? { opens_at: cols.opens_at as string | null } : {}), ...(cols.closes_at !== undefined ? { closes_at: cols.closes_at as string | null } : {}) })
        .where('opportunity_id', '=', before.id)
        .where('stage_order', '=', 1)
        .execute();
    }
    ctx.audit({ entityType: 'opportunity', entityId: before.id, before: { title: before.title, status: before.status, opensAt: before.opens_at, closesAt: before.closes_at }, after: cols });
    ctx.emit('opportunity.updated', { type: 'opportunity', id: before.id });
    return { ok: true as const };
  },
});

const RuleIn = z.object({
  question: z.string().trim().min(1).max(500),
  helpText: z.string().max(1000).nullable().optional(),
  kind: z.enum(['yes_no', 'number_max', 'number_min', 'select_in', 'multi_any']),
  config: z.record(z.string(), z.unknown()),
  knockoutMessage: z.string().trim().min(1).max(1000),
});

export const setEligibilityRules = defineAction({
  id: 'opportunities.set_eligibility',
  title: 'Set eligibility questions',
  description: 'Replaces the eligibility pre-check questions for an opportunity. Knock-out messages should be kind and suggest alternatives.',
  input: z.object({ opportunityId: uuid, rules: z.array(RuleIn).max(20) }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    found(await ctx.db.selectFrom('opportunities').select('id').where('id', '=', input.opportunityId).executeTakeFirst(), 'opportunity');
    await ctx.db.deleteFrom('eligibility_rules').where('opportunity_id', '=', input.opportunityId).execute();
    if (input.rules.length) {
      await ctx.db
        .insertInto('eligibility_rules')
        .values(
          input.rules.map((r, i) => ({
            workspace_id: w.id,
            opportunity_id: input.opportunityId,
            position: i + 1,
            question: r.question,
            help_text: r.helpText ?? null,
            kind: r.kind,
            config: json(r.config),
            knockout_message: r.knockoutMessage,
          })),
        )
        .execute();
    }
    ctx.audit({ entityType: 'opportunity', entityId: input.opportunityId, action: 'opportunities.set_eligibility', after: { count: input.rules.length } });
    return { ok: true as const };
  },
});

export const publishOpportunity = defineAction({
  id: 'opportunities.publish',
  title: 'Publish an opportunity',
  description:
    'Publishes a draft opportunity. It becomes Forecasted until its open date, then Open (the worker opens and closes it on schedule in the workspace timezone). Requires a published form on the first stage and open/close dates.',
  input: z.object({ opportunityId: uuid }),
  output: z.object({ status: z.enum(['forecasted', 'open']) }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const opp = found(await ctx.db.selectFrom('opportunities').selectAll().where('id', '=', input.opportunityId).executeTakeFirst(), 'opportunity');
    const problems: { pointer: string; message: string }[] = [];
    if (!opp.opens_at) problems.push({ pointer: '/opensAt', message: 'Set when applications open.' });
    if (!opp.closes_at) problems.push({ pointer: '/closesAt', message: 'Set the deadline.' });
    if (!opp.summary) problems.push({ pointer: '/summary', message: 'Add a short summary for the public listing.' });
    const stage1 = await ctx.db.selectFrom('competitions').selectAll().where('opportunity_id', '=', opp.id).orderBy('stage_order').executeTakeFirst();
    if (!stage1) problems.push({ pointer: '/competitions', message: 'Add at least one stage.' });
    else {
      const forms = await ctx.db
        .selectFrom('competition_forms as cf')
        .leftJoin('form_versions as v', 'v.id', 'cf.form_version_id')
        .select(['cf.id', 'v.status'])
        .where('cf.competition_id', '=', stage1.id)
        .execute();
      if (!forms.length || forms.some((f) => f.status !== 'published')) problems.push({ pointer: '/competitions/0/forms', message: 'Attach a published form to the first stage.' });
    }
    if (problems.length) throw new DomainError('validation_failed', 'This opportunity is not ready to publish yet.', {}, problems);
    const now = ctx.now();
    const target = new Date(opp.opens_at!) <= now ? 'open' : 'forecasted';
    transition(opportunityMachine, opp.status, target);
    await ctx.db.updateTable('opportunities').set({ status: target, published_at: now.toISOString() }).where('id', '=', opp.id).execute();
    await ctx.db
      .updateTable('competitions')
      .set({ status: sql`case when stage_order = 1 and ${target} = 'open' then 'open' else 'scheduled' end` })
      .where('opportunity_id', '=', opp.id)
      .where('status', '=', 'draft')
      .execute();
    ctx.audit({ entityType: 'opportunity', entityId: opp.id, before: { status: opp.status }, after: { status: target } });
    ctx.emit('opportunity.published', { type: 'opportunity', id: opp.id }, { status: target, slug: opp.slug, title: opp.title });
    return { status: target as 'forecasted' | 'open' };
  },
});

export const setOpportunityStatus = defineAction({
  id: 'opportunities.set_status',
  title: 'Change an opportunity’s status',
  description: 'Closes, reopens, archives or returns an opportunity to draft (following the lifecycle rules).',
  input: z.object({ opportunityId: uuid, status: z.enum(['draft', 'forecasted', 'open', 'closed', 'archived']), reason: z.string().max(500).optional() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const opp = found(await ctx.db.selectFrom('opportunities').selectAll().where('id', '=', input.opportunityId).executeTakeFirst(), 'opportunity');
    transition(opportunityMachine, opp.status, input.status);
    await ctx.db.updateTable('opportunities').set({ status: input.status }).where('id', '=', opp.id).execute();
    if (input.status === 'closed') await ctx.db.updateTable('competitions').set({ status: 'closed' }).where('opportunity_id', '=', opp.id).where('status', '=', 'open').execute();
    if (input.status === 'open') await ctx.db.updateTable('competitions').set({ status: 'open' }).where('opportunity_id', '=', opp.id).where('stage_order', '=', 1).execute();
    ctx.audit({ entityType: 'opportunity', entityId: opp.id, before: { status: opp.status }, after: { status: input.status, reason: input.reason ?? null } });
    ctx.emit(`opportunity.${input.status}`, { type: 'opportunity', id: opp.id }, { slug: opp.slug });
    return { ok: true as const };
  },
});

export const duplicateOpportunity = defineAction({
  id: 'opportunities.duplicate',
  title: 'Duplicate an opportunity',
  description: 'Copies an opportunity (details, eligibility, stages and their forms) into a new draft, e.g. for next year’s cycle.',
  input: z.object({ opportunityId: uuid, title: z.string().trim().min(1).max(300) }),
  output: z.object({ id: z.string().uuid(), slug: z.string() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const src = found(await ctx.db.selectFrom('opportunities').selectAll().where('id', '=', input.opportunityId).executeTakeFirst(), 'opportunity');
    let slug = slugify(input.title) || 'opportunity';
    const clash = await ctx.db.selectFrom('opportunities').select('slug').where('workspace_id', '=', w.id).where('slug', 'like', `${slug}%`).execute();
    if (clash.some((c) => c.slug === slug)) slug = `${slug}-${clash.length + 1}`;
    const id = randomUUID();
    const { id: _i, search: _s, created_at: _c, last_modified_at: _l, published_at: _p, ...rest } = src;
    await ctx.db
      .insertInto('opportunities')
      .values({ ...rest, id, slug, title: input.title, status: 'draft', created_by: uid(ctx), faq: json(src.faq), distribution: json(src.distribution), custom_fields: json(src.custom_fields) } as never)
      .execute();
    const rules = await ctx.db.selectFrom('eligibility_rules').selectAll().where('opportunity_id', '=', src.id).execute();
    for (const r of rules) {
      await ctx.db.insertInto('eligibility_rules').values({ workspace_id: w.id, opportunity_id: id, position: r.position, question: r.question, help_text: r.help_text, kind: r.kind, config: json(r.config), knockout_message: r.knockout_message }).execute();
    }
    const comps = await ctx.db.selectFrom('competitions').selectAll().where('opportunity_id', '=', src.id).execute();
    for (const c of comps) {
      const nc = await ctx.db
        .insertInto('competitions')
        .values({ workspace_id: w.id, opportunity_id: id, name: c.name, description: c.description, stage_order: c.stage_order, access: c.access, status: 'draft', grace_minutes: c.grace_minutes, submission_cap: c.submission_cap, per_org_limit: c.per_org_limit, allow_extensions: c.allow_extensions })
        .returning('id')
        .executeTakeFirstOrThrow();
      const cfs = await ctx.db.selectFrom('competition_forms').selectAll().where('competition_id', '=', c.id).execute();
      for (const cf of cfs) await ctx.db.insertInto('competition_forms').values({ workspace_id: w.id, competition_id: nc.id, form_id: cf.form_id, form_version_id: cf.form_version_id, position: cf.position }).execute();
    }
    ctx.audit({ entityType: 'opportunity', entityId: id, after: { duplicatedFrom: src.id, title: input.title } });
    return { id, slug };
  },
});

// Competitions (stages) ---------------------------------------------------------------------------
const CompetitionFields = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  access: z.enum(['public', 'invite']),
  opensAt: WhenIn,
  closesAt: WhenIn,
  graceMinutes: z.number().int().min(0).max(1440).default(0),
  submissionCap: z.number().int().positive().nullable().optional(),
  perOrgLimit: z.number().int().min(1).max(10).default(1),
  allowExtensions: z.boolean().default(true),
});

export const createCompetition = defineAction({
  id: 'competitions.create',
  title: 'Add a stage',
  description: 'Adds a stage (competition) to an opportunity, e.g. an invite-only full proposal after a letter of inquiry.',
  input: CompetitionFields.extend({ opportunityId: uuid }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const max = await ctx.db.selectFrom('competitions').select((eb) => eb.fn.max('stage_order').as('m')).where('opportunity_id', '=', input.opportunityId).executeTakeFirst();
    const r = await ctx.db
      .insertInto('competitions')
      .values({
        workspace_id: w.id,
        opportunity_id: input.opportunityId,
        name: input.name,
        description: input.description ?? null,
        stage_order: Number(max?.m ?? 0) + 1,
        access: input.access,
        status: 'draft',
        opens_at: toUtc(input.opensAt, w.timezone) ?? null,
        closes_at: toUtc(input.closesAt, w.timezone) ?? null,
        grace_minutes: input.graceMinutes,
        submission_cap: input.submissionCap ?? null,
        per_org_limit: input.perOrgLimit,
        allow_extensions: input.allowExtensions,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'competition', entityId: r.id, after: { name: input.name, access: input.access } });
    return { id: r.id };
  },
});

export const updateCompetition = defineAction({
  id: 'competitions.update',
  title: 'Update a stage',
  description: 'Updates a stage’s name, access, dates, grace window and submission caps.',
  input: CompetitionFields.partial().extend({ competitionId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const before = found(await ctx.db.selectFrom('competitions').selectAll().where('id', '=', input.competitionId).executeTakeFirst(), 'stage');
    const opens = toUtc(input.opensAt, w.timezone);
    const closes = toUtc(input.closesAt, w.timezone);
    await ctx.db
      .updateTable('competitions')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.access !== undefined ? { access: input.access } : {}),
        ...(opens !== undefined ? { opens_at: opens } : {}),
        ...(closes !== undefined ? { closes_at: closes } : {}),
        ...(input.graceMinutes !== undefined ? { grace_minutes: input.graceMinutes } : {}),
        ...(input.submissionCap !== undefined ? { submission_cap: input.submissionCap } : {}),
        ...(input.perOrgLimit !== undefined ? { per_org_limit: input.perOrgLimit } : {}),
        ...(input.allowExtensions !== undefined ? { allow_extensions: input.allowExtensions } : {}),
      })
      .where('id', '=', before.id)
      .execute();
    ctx.audit({ entityType: 'competition', entityId: before.id, before: { opensAt: before.opens_at, closesAt: before.closes_at, access: before.access }, after: input });
    return { ok: true as const };
  },
});

export const attachForm = defineAction({
  id: 'competitions.attach_form',
  title: 'Attach a form to a stage',
  description: 'Attaches a form to a stage, pinned to the form’s current published version.',
  input: z.object({ competitionId: uuid, formId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const form = found(await ctx.db.selectFrom('forms').select(['id', 'current_version_id']).where('id', '=', input.formId).executeTakeFirst(), 'form');
    const pos = await ctx.db.selectFrom('competition_forms').select((eb) => eb.fn.max('position').as('m')).where('competition_id', '=', input.competitionId).executeTakeFirst();
    await ctx.db
      .insertInto('competition_forms')
      .values({ workspace_id: w.id, competition_id: input.competitionId, form_id: form.id, form_version_id: form.current_version_id, position: Number(pos?.m ?? 0) + 1 })
      .onConflict((oc) => oc.columns(['competition_id', 'form_id']).doUpdateSet({ form_version_id: form.current_version_id }))
      .execute();
    ctx.audit({ entityType: 'competition', entityId: input.competitionId, action: 'competitions.attach_form', after: { formId: form.id, versionId: form.current_version_id } });
    return { ok: true as const };
  },
});

export const detachForm = defineAction({
  id: 'competitions.detach_form',
  title: 'Remove a form from a stage',
  description: 'Removes a form from a stage that has not opened yet; stages that are open keep their forms.',
  input: z.object({ competitionId: uuid, formId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const c = found(await ctx.db.selectFrom('competitions').select(['status']).where('id', '=', input.competitionId).executeTakeFirst(), 'stage');
    if (c.status !== 'draft') throw new DomainError('conflict', 'Forms can only be removed from stages that have not opened.');
    await ctx.db.deleteFrom('competition_forms').where('competition_id', '=', input.competitionId).where('form_id', '=', input.formId).execute();
    return { ok: true as const };
  },
});

export const inviteToStage = defineAction({
  id: 'competitions.invite_applicants',
  title: 'Invite applicants to the next stage',
  description: 'Invites applicants from an earlier stage to an invite-only stage and marks their applications “Invited to next stage”. Applicants get an email.',
  input: z.object({ competitionId: uuid, applicationIds: z.array(uuid).min(1).max(500), message: z.string().max(5000).optional() }),
  output: z.object({ invited: z.number() }),
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const comp = found(await ctx.db.selectFrom('competitions').selectAll().where('id', '=', input.competitionId).executeTakeFirst(), 'stage');
    if (comp.access !== 'invite') throw new DomainError('precondition_failed', 'This stage is open to everyone; invitations are only for invite-only stages.');
    const apps = await ctx.db.selectFrom('applications').selectAll().where('id', 'in', input.applicationIds).execute();
    let invited = 0;
    for (const app of apps) {
      if (!['submitted', 'under_review'].includes(app.status)) continue;
      await ctx.db
        .insertInto('competition_invites')
        .values({ workspace_id: w.id, competition_id: comp.id, applicant_org_id: app.applicant_org_id, email: null, from_application_id: app.id, invited_by: uid(ctx) })
        .execute();
      if (!app.applicant_org_id) {
        const p = await ctx.db.selectFrom('profiles').select('email').where('id', '=', app.applicant_user_id).executeTakeFirst();
        if (p) await ctx.db.updateTable('competition_invites').set({ email: p.email }).where('from_application_id', '=', app.id).where('competition_id', '=', comp.id).execute();
      }
      await ctx.db.updateTable('applications').set({ status: 'invited_to_next_stage' }).where('id', '=', app.id).execute();
      await recordStatus(ctx, app, 'invited_to_next_stage', input.message ?? null);
      ctx.emit('competition.invited', { type: 'application', id: app.id }, { competitionId: comp.id, stageName: comp.name, closesAt: comp.closes_at });
      invited++;
    }
    ctx.audit({ entityType: 'competition', entityId: comp.id, action: 'competitions.invite_applicants', after: { invited } });
    return { invited };
  },
});

export const grantExtension = defineAction({
  id: 'applications.grant_extension',
  title: 'Grant a deadline extension',
  description: 'Gives one applicant more time to submit (a per-applicant deadline in the workspace timezone).',
  input: z.object({ applicationId: uuid, newDeadline: z.string().min(10), reason: z.string().max(1000).optional() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const app = found(await ctx.db.selectFrom('applications').selectAll().where('id', '=', input.applicationId).executeTakeFirst(), 'application');
    const at = toUtc(input.newDeadline, w.timezone)!;
    await ctx.db.insertInto('applicant_extensions').values({ workspace_id: w.id, application_id: app.id, new_deadline: at, reason: input.reason ?? null, granted_by: uid(ctx) }).execute();
    await ctx.db.updateTable('applications').set({ deadline_override_at: at }).where('id', '=', app.id).execute();
    ctx.audit({ entityType: 'application', entityId: app.id, action: 'applications.grant_extension', after: { newDeadline: at, reason: input.reason ?? null } });
    ctx.emit('application.extension_granted', { type: 'application', id: app.id }, { newDeadline: at });
    return { ok: true as const };
  },
});

// Schedule tick (worker cron, system actor) --------------------------------------------------------
export const tickSchedule = defineAction({
  id: 'system.tick_opportunity_schedule',
  title: 'Open and close opportunities on schedule',
  description: 'System task: opens forecasted opportunities whose open time has passed and closes open ones past their deadline (+ grace).',
  input: z.object({}),
  output: z.object({ opened: z.number(), closed: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(_input, ctx) {
    const now = ctx.now().toISOString();
    const opened = await ctx.db
      .updateTable('opportunities')
      .set({ status: 'open' })
      .where('status', '=', 'forecasted')
      .where('opens_at', '<=', now)
      .returning(['id', 'workspace_id', 'slug', 'title'])
      .execute();
    for (const o of opened) {
      await ctx.db.updateTable('competitions').set({ status: 'open' }).where('opportunity_id', '=', o.id).where('stage_order', '=', 1).execute();
      ctx.emit('opportunity.opened', { type: 'opportunity', id: o.id }, { slug: o.slug, title: o.title, workspaceId: o.workspace_id });
    }
    // Invite-only later stages open on their own dates.
    await ctx.db.updateTable('competitions').set({ status: 'open' }).where('status', '=', 'scheduled').where('opens_at', '<=', now).execute();
    const closedComps = await ctx.db
      .updateTable('competitions')
      .set({ status: 'closed' })
      .where('status', '=', 'open')
      .where(sql<boolean>`closes_at + make_interval(mins => grace_minutes) < ${now}::timestamptz`)
      .returning(['opportunity_id'])
      .execute();
    let closed = 0;
    for (const oppId of new Set(closedComps.map((c) => c.opportunity_id))) {
      const stillOpen = await ctx.db.selectFrom('competitions').select('id').where('opportunity_id', '=', oppId).where('status', 'in', ['open', 'scheduled']).executeTakeFirst();
      if (!stillOpen) {
        const r = await ctx.db.updateTable('opportunities').set({ status: 'closed' }).where('id', '=', oppId).where('status', '=', 'open').returning(['id', 'slug']).executeTakeFirst();
        if (r) {
          closed++;
          ctx.emit('opportunity.closed', { type: 'opportunity', id: r.id }, { slug: r.slug });
        }
      }
    }
    if (opened.length || closed) ctx.audit({ entityType: 'schedule', entityId: null, after: { opened: opened.length, closed } });
    return { opened: opened.length, closed };
  },
});

export const subscribeOpportunity = defineAction({
  id: 'opportunities.subscribe',
  title: 'Get notified when an opportunity opens',
  description: 'Subscribes the signed-in person to an email when a forecasted opportunity opens (or unsubscribes).',
  input: z.object({ opportunityId: uuid, subscribe: z.boolean().default(true) }),
  output: Ok,
  scopes: ['opportunities:read'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.subscribe) {
      await ctx.db
        .insertInto('opportunity_subscriptions')
        .values({ workspace_id: w.id, opportunity_id: input.opportunityId, user_id: uid(ctx) })
        .onConflict((oc) => oc.columns(['opportunity_id', 'user_id']).doNothing())
        .execute();
    } else {
      await ctx.db.deleteFrom('opportunity_subscriptions').where('opportunity_id', '=', input.opportunityId).where('user_id', '=', uid(ctx)).execute();
    }
    return { ok: true as const };
  },
});
