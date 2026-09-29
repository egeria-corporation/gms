// SPDX-License-Identifier: AGPL-3.0-or-later
// Application lifecycle (applicant side): start, autosave with revision-based conflict detection,
// validation, attachments, submission snapshot + receipt, withdrawal, collaborators, comments.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql, type Tx } from '@gms/db';
import { applicationMachine, deadlineState, DomainError, evaluateEligibility, formatInZone, type FieldIssue } from '@gms/domain';
import { z } from 'zod';
import { defineAction, type RunContext } from '../define';
import { compiledFor, prefill, projectTitle, requestedAmountCents, validate, type FieldError } from './forms-bridge';
import { agentClientId, Email, found, json, nextReference, Ok, recordStatus, transition, uid, uuid, ws, yearInZone } from './lib';
import { assertUploadAllowed, safeFileName } from './orgs';

// Loaders ----------------------------------------------------------------------------
async function loadApp(trx: Tx, id: string) {
  return found(await trx.selectFrom('applications').selectAll().where('id', '=', id).executeTakeFirst(), 'application');
}

async function competitionForms(trx: Tx, competitionId: string) {
  return trx
    .selectFrom('competition_forms as cf')
    .innerJoin('form_versions as fv', 'fv.id', 'cf.form_version_id')
    .innerJoin('forms as f', 'f.id', 'cf.form_id')
    .select(['cf.form_id', 'cf.form_version_id', 'cf.position', 'fv.id as version_id', 'fv.builder_model', 'fv.status as version_status', 'f.name'])
    .where('cf.competition_id', '=', competitionId)
    .orderBy('cf.position')
    .execute();
}

/** The applicant's saved profile, CommonGrants-shaped (used for prefill and the submission snapshot). */
async function orgProfile(trx: Tx, orgId: string | null, userId: string) {
  const person = await trx.selectFrom('profiles').select(['full_name', 'email']).where('id', '=', userId).executeTakeFirst();
  const [firstName, ...rest] = (person?.full_name ?? '').split(' ');
  const contact = { name: { firstName: firstName || null, lastName: rest.join(' ') || null }, email: person?.email ?? null };
  if (!orgId) return { organization: null, contact };
  const org = await trx.selectFrom('applicant_orgs').selectAll().where('id', '=', orgId).executeTakeFirst();
  const addr = await trx.selectFrom('org_addresses').selectAll().where('org_id', '=', orgId).where('kind', '=', 'mailing').executeTakeFirst();
  return {
    organization: org
      ? {
          id: org.id,
          name: org.legal_name,
          ein: org.ein,
          uei: org.uei,
          mission: org.mission,
          type: org.org_type,
          annualBudget: org.annual_budget_cents !== null ? { amount: (org.annual_budget_cents / 100).toFixed(2), currency: 'USD' } : null,
          website: org.website,
          phone: org.phone,
          email: org.email,
          counties: org.counties,
          fiscalSponsor: org.fiscal_sponsor_name ? { name: org.fiscal_sponsor_name, ein: org.fiscal_sponsor_ein } : null,
          einVerified: Boolean(org.ein_verified_at),
          address: addr
            ? { street1: addr.line1, street2: addr.line2, city: addr.city, stateOrProvince: addr.state, postalCode: addr.postal_code, county: addr.county, country: addr.country }
            : null,
        }
      : null,
    contact,
  };
}

function deadlineFor(comp: { opens_at: string | null; closes_at: string | null; grace_minutes: number }, extensionAt: string | null, now: Date) {
  return deadlineState(now, { opensAt: comp.opens_at, closesAt: comp.closes_at, graceMinutes: comp.grace_minutes, extensionAt });
}

async function latestExtension(trx: Tx, applicationId: string): Promise<string | null> {
  const r = await trx
    .selectFrom('applicant_extensions')
    .select('new_deadline')
    .where('application_id', '=', applicationId)
    .orderBy('new_deadline', 'desc')
    .executeTakeFirst();
  return r?.new_deadline ?? null;
}

// Start ------------------------------------------------------------------------------------
export const startApplication = defineAction({
  id: 'applications.start',
  title: 'Start an application',
  description:
    'Starts (or resumes) an application to an open competition for one of your organizations. Answers from your organization profile are prefilled. Returns the application id; then call get_application_form and save_answers. Does not submit anything.',
  input: z.object({ competitionId: uuid, applicantOrgId: uuid.optional().nullable() }),
  output: z.object({ applicationId: z.string().uuid(), referenceNumber: z.string(), resumed: z.boolean() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const me = uid(ctx);
    const comp = found(
      await ctx.db.selectFrom('competitions').selectAll().where('id', '=', input.competitionId).where('workspace_id', '=', w.id).executeTakeFirst(),
      'competition',
    );
    const opp = found(await ctx.db.selectFrom('opportunities').selectAll().where('id', '=', comp.opportunity_id).executeTakeFirst(), 'opportunity');
    if (opp.status !== 'open' || comp.status === 'draft' || comp.status === 'closed') {
      throw new DomainError('precondition_failed', 'This opportunity is not accepting applications right now.');
    }
    const dl = deadlineFor(comp, null, ctx.now());
    if (!dl.open) {
      throw new DomainError('deadline_passed', comp.closes_at && new Date(comp.closes_at) < ctx.now()
        ? `Applications closed ${formatInZone(comp.closes_at, w.timezone)}.`
        : `Applications open ${formatInZone(comp.opens_at, w.timezone)}.`);
    }
    if (input.applicantOrgId) {
      const member = await ctx.db.selectFrom('applicant_org_members').select('id').where('org_id', '=', input.applicantOrgId).where('user_id', '=', me).executeTakeFirst();
      if (!member) throw new DomainError('forbidden', 'You are not a member of that organization.');
    }
    if (comp.access === 'invite') {
      const invited = await ctx.db
        .selectFrom('competition_invites')
        .select('id')
        .where('competition_id', '=', comp.id)
        .where('status', 'in', ['pending', 'accepted'])
        .where((eb) =>
          eb.or([
            ...(input.applicantOrgId ? [eb('applicant_org_id', '=', input.applicantOrgId)] : []),
            eb(sql`lower(email)`, '=', (ctx.claims.email ?? '').toLowerCase()),
          ]),
        )
        .executeTakeFirst();
      if (!invited) throw new DomainError('forbidden', 'This stage is by invitation only.');
    }
    // Resume an existing in-progress application for the same applicant.
    let existingQ = ctx.db.selectFrom('applications').select(['id', 'reference_number', 'status']).where('competition_id', '=', comp.id).where('status', 'not in', ['withdrawn']);
    existingQ = input.applicantOrgId ? existingQ.where('applicant_org_id', '=', input.applicantOrgId) : existingQ.where('applicant_user_id', '=', me).where('applicant_org_id', 'is', null);
    const existing = await existingQ.execute();
    const inProgress = existing.find((a) => a.status === 'in_progress');
    if (inProgress) return { applicationId: inProgress.id, referenceNumber: inProgress.reference_number, resumed: true };
    if (existing.length >= comp.per_org_limit) {
      throw new DomainError('conflict', 'Your organization has already applied to this opportunity.', { applicationId: existing[0]!.id });
    }

    const forms = await competitionForms(ctx.db, comp.id);
    if (!forms.length || forms.some((f) => f.version_status !== 'published')) {
      throw new DomainError('precondition_failed', 'This opportunity’s application form is not published yet.');
    }
    const id = randomUUID();
    const ref = await nextReference(ctx.db, w, 'application', yearInZone(ctx.now(), w.timezone));
    await ctx.db
      .insertInto('applications')
      .values({
        id,
        workspace_id: w.id,
        opportunity_id: opp.id,
        competition_id: comp.id,
        applicant_org_id: input.applicantOrgId ?? null,
        applicant_user_id: me,
        reference_number: ref,
        title: opp.title,
        status: 'in_progress',
        created_via: ctx.actor.type === 'agent' ? 'agent' : ctx.channel === 'api' || ctx.channel === 'cg' ? 'api' : 'human',
      })
      .execute();
    const profile = await orgProfile(ctx.db, input.applicantOrgId ?? null, me);
    for (const f of forms) {
      const compiled = compiledFor({ id: f.version_id, builder_model: f.builder_model });
      const data = prefill(compiled, profile);
      await ctx.db
        .insertInto('form_responses')
        .values({
          workspace_id: w.id,
          application_id: id,
          form_id: f.form_id,
          form_version_id: f.version_id,
          data: json(data),
          etag: '0',
          updated_by: me,
        })
        .execute();
    }
    ctx.audit({ entityType: 'application', entityId: id, after: { competitionId: comp.id, orgId: input.applicantOrgId ?? null, reference: ref } });
    ctx.emit('application.started', { type: 'application', id }, { competitionId: comp.id });
    return { applicationId: id, referenceNumber: ref, resumed: false };
  },
});

// Save answers (autosave) --------------------------------------------------------------------
const ConflictOut = z.object({ fieldId: z.string(), theirValue: z.unknown(), updatedBy: z.string().nullable(), updatedAt: z.string() });

export const saveAnswers = defineAction({
  id: 'applications.save_answers',
  title: 'Save answers',
  description:
    'Saves answers to one form of an in-progress application (a partial update: only the fields you send change). Pass the etag you last saw; if someone else changed the same field since then, that field is returned in `conflicts` and not overwritten. Returns the new etag and any validation problems as JSON Pointers (drafts may be incomplete). Never submits.',
  input: z.object({
    applicationId: uuid,
    formId: uuid,
    answers: z.record(z.string(), z.unknown()),
    etag: z.string().max(40).optional().nullable(),
  }),
  output: z.object({
    etag: z.string(),
    errors: z.array(z.object({ pointer: z.string(), message: z.string(), fieldId: z.string().optional(), pageId: z.string().optional() })),
    conflicts: z.array(ConflictOut),
    savedAt: z.string(),
  }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const me = uid(ctx);
    const app = await loadApp(ctx.db, input.applicationId);
    if (app.status !== 'in_progress') throw new DomainError('conflict', 'This application was already submitted, so answers can no longer change.');
    const resp = found(
      await ctx.db
        .selectFrom('form_responses as r')
        .innerJoin('form_versions as v', 'v.id', 'r.form_version_id')
        .select(['r.id', 'r.data', 'r.etag', 'r.field_updated_at', 'v.id as version_id', 'v.builder_model'])
        .where('r.application_id', '=', app.id)
        .where('r.form_id', '=', input.formId)
        .forUpdate('r')
        .executeTakeFirst(),
      'form',
    );
    const compiled = compiledFor({ id: resp.version_id, builder_model: resp.builder_model });
    const current = (resp.data ?? {}) as Record<string, unknown>;
    const meta = (resp.field_updated_at ?? {}) as Record<string, { rev: number; by: string | null; byName?: string; at: string }>;
    const currentRev = Number(resp.etag) || 0;
    const baseRev = input.etag != null && input.etag !== '' ? Number(input.etag) : currentRev;
    const known = new Set(Object.keys((compiled.jsonSchema as { properties?: Record<string, unknown> }).properties ?? {}));
    const conflicts: z.infer<typeof ConflictOut>[] = [];
    const next = { ...current };
    const newRev = currentRev + 1;
    const now = ctx.now().toISOString();
    let changed = 0;
    for (const [key, value] of Object.entries(input.answers)) {
      if (known.size && !known.has(key)) continue; // ignore unknown keys rather than storing arbitrary data
      const m = meta[key];
      const same = JSON.stringify(current[key]) === JSON.stringify(value);
      if (same) continue;
      if (m && m.rev > baseRev && m.by !== me) {
        conflicts.push({ fieldId: key, theirValue: current[key], updatedBy: m.byName ?? null, updatedAt: m.at });
        continue;
      }
      next[key] = value;
      meta[key] = { rev: newRev, by: me, byName: ctx.actor.onBehalfOfName ? `${ctx.actor.name} for ${ctx.actor.onBehalfOfName}` : ctx.actor.name, at: now };
      changed++;
    }
    let etag = String(currentRev);
    if (changed) {
      etag = String(newRev);
      await ctx.db
        .updateTable('form_responses')
        .set({ data: json(next), field_updated_at: json(meta), etag, updated_by: me })
        .where('id', '=', resp.id)
        .execute();
      ctx.audit({ entityType: 'form_response', entityId: resp.id, after: { applicationId: app.id, fields: Object.keys(input.answers).slice(0, 50) } });
    }
    const v = validate(compiled, next, 'save');
    return { etag, errors: v.errors, conflicts, savedAt: now };
  },
});

// Validate ----------------------------------------------------------------------------------
export async function validateApplication(trx: Tx, applicationId: string) {
  const rows = await trx
    .selectFrom('form_responses as r')
    .innerJoin('form_versions as v', 'v.id', 'r.form_version_id')
    .innerJoin('forms as f', 'f.id', 'r.form_id')
    .select(['r.form_id', 'r.data', 'v.id as version_id', 'v.builder_model', 'f.name'])
    .where('r.application_id', '=', applicationId)
    .execute();
  const errors: (FieldError & { formId: string; formName: string })[] = [];
  for (const r of rows) {
    const compiled = compiledFor({ id: r.version_id, builder_model: r.builder_model });
    const v = validate(compiled, (r.data ?? {}) as Record<string, unknown>, 'submit');
    for (const e of v.errors) errors.push({ ...e, formId: r.form_id, formName: r.name });
  }
  return { rows, errors };
}

export const validateApplicationAction = defineAction({
  id: 'applications.validate',
  title: 'Check an application',
  description: 'Checks every form of an application against the submission rules and returns problems (JSON Pointer + plain-language fix). Read-only.',
  input: z.object({ applicationId: uuid }),
  output: z.object({
    ready: z.boolean(),
    errors: z.array(z.object({ formId: z.string(), formName: z.string(), pointer: z.string(), message: z.string(), fieldId: z.string().optional(), pageId: z.string().optional() })),
    deadline: z.object({ open: z.boolean(), inGrace: z.boolean(), closesAt: z.string().nullable() }),
  }),
  scopes: ['applications:read'],
  roles: ['authenticated'],
  riskTier: 'R0',
  idempotent: true,
  async run(input, ctx) {
    const app = await loadApp(ctx.db, input.applicationId);
    const comp = await ctx.db.selectFrom('competitions').selectAll().where('id', '=', app.competition_id).executeTakeFirstOrThrow();
    const dl = deadlineFor(comp, app.deadline_override_at ?? (await latestExtension(ctx.db, app.id)), ctx.now());
    const { errors } = await validateApplication(ctx.db, app.id);
    return {
      ready: errors.length === 0 && dl.open && app.status === 'in_progress',
      errors,
      deadline: { open: dl.open, inGrace: dl.inGrace, closesAt: dl.effectiveCloseAt?.toISOString() ?? null },
    };
  },
});

// Submit ---------------------------------------------------------------------------------------
const SubmitIn = z.object({
  applicationId: uuid,
  attestation: z.object({ typedName: z.string().trim().min(2).max(200), agreed: z.literal(true) }),
  aiDisclosure: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Everything that must hold for a submission to succeed (state, deadline, cap, agent protections, AI-use policy,
 * form validation). Runs at submit time and before an agent's confirmation request is created, so an agent learns
 * about problems immediately instead of the person hitting them when they confirm.
 */
async function submitPreconditions(input: z.infer<typeof SubmitIn>, ctx: RunContext) {
  const w = ws(ctx);
  const app = await loadApp(ctx.db, input.applicationId);
  transition(applicationMachine, app.status, 'submitted');
  const comp = await ctx.db.selectFrom('competitions').selectAll().where('id', '=', app.competition_id).executeTakeFirstOrThrow();
  const opp = await ctx.db.selectFrom('opportunities').select(['id', 'title', 'status']).where('id', '=', app.opportunity_id).executeTakeFirstOrThrow();

  // Deadline (server-side, workspace timezone).
  const dl = deadlineFor(comp, app.deadline_override_at ?? (await latestExtension(ctx.db, app.id)), ctx.now());
  if (!dl.open && comp.opens_at && ctx.now() < new Date(comp.opens_at)) {
    throw new DomainError('precondition_failed', `Submissions open ${formatInZone(comp.opens_at, w.timezone)}. You can keep working on your answers until then.`, { opensAt: comp.opens_at });
  }
  if (!dl.open) {
    throw new DomainError('deadline_passed', `The deadline was ${formatInZone(comp.closes_at, w.timezone)}. Contact the foundation if you need an extension.`, {
      closesAt: comp.closes_at,
    });
  }
  // Submission cap.
  if (comp.submission_cap) {
    const n = await sql<{ n: number }>`select count(*)::int as n from public.applications where competition_id = ${comp.id}::uuid and submitted_at is not null`.execute(ctx.db);
    if ((n.rows[0]?.n ?? 0) >= comp.submission_cap) {
      throw new DomainError('precondition_failed', 'This opportunity has reached its limit on applications.');
    }
  }
  // Agent protections: kill switch + verified EIN.
  const policy = await ctx.db.selectFrom('agent_policies').select(['ai_use', 'disclosure_prompt', 'agent_submissions_enabled']).where('workspace_id', '=', w.id).executeTakeFirst();
  if (ctx.actor.type === 'agent') {
    if (policy && !policy.agent_submissions_enabled) throw new DomainError('forbidden', 'This foundation has paused submissions made through AI agents.');
    if (app.applicant_org_id) {
      const org = await ctx.db.selectFrom('applicant_orgs').select(['ein_verified_at']).where('id', '=', app.applicant_org_id).executeTakeFirst();
      if (!org?.ein_verified_at) throw new DomainError('precondition_failed', 'Submissions made through an agent need a verified EIN on the organization profile.');
    }
  }
  // AI-use policy.
  const disclosure = input.aiDisclosure?.trim() || null;
  if (policy?.ai_use === 'disclosure' && !disclosure) {
    throw new DomainError('validation_failed', 'Tell the foundation whether you used AI tools, and how.', {}, [
      { pointer: '/aiDisclosure', message: policy.disclosure_prompt },
    ]);
  }

  // Validate every form in submit mode.
  const { rows, errors } = await validateApplication(ctx.db, app.id);
  if (errors.length) {
    const issues: FieldIssue[] = errors.map((e) => ({ pointer: `/forms/${e.formId}${e.pointer}`, message: e.message }));
    throw new DomainError('validation_failed', `${errors.length} answer${errors.length === 1 ? ' needs' : 's need'} attention before you can submit.`, { errors }, issues);
  }

  return { w, app, comp, opp, rows, disclosure };
}

async function submitPreview(input: z.infer<typeof SubmitIn>, ctx: RunContext) {
  await submitPreconditions(input, ctx);
  const app = await loadApp(ctx.db, input.applicationId);
  const org = app.applicant_org_id
    ? await ctx.db.selectFrom('applicant_orgs').select(['legal_name']).where('id', '=', app.applicant_org_id).executeTakeFirst()
    : null;
  const opp = await ctx.db.selectFrom('opportunities').select(['title']).where('id', '=', app.opportunity_id).executeTakeFirst();
  const { rows } = await validateApplication(ctx.db, app.id);
  const summaryText = rows
    .map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return Object.entries(d)
        .filter(([, v]) => typeof v === 'string' && (v as string).length > 40)
        .slice(0, 2)
        .map(([k, v]) => ({ label: k.replace(/_/g, ' '), text: String(v).slice(0, 600) }));
    })
    .flat();
  return {
    title: `Submit application ${app.reference_number}`,
    summary: `${ctx.actor.name} asked to submit ${org?.legal_name ?? 'your'} application to “${opp?.title ?? 'this opportunity'}”. Once submitted, answers can’t be changed.`,
    fields: [
      { label: 'Opportunity', value: opp?.title ?? '' },
      { label: 'Organization', value: org?.legal_name ?? 'Individual applicant' },
      { label: 'Reference', value: app.reference_number },
      { label: 'Signed as', value: input.attestation.typedName },
      ...(input.aiDisclosure ? [{ label: 'AI-assistance disclosure', value: input.aiDisclosure }] : []),
    ],
    quotedContent: summaryText,
    entity: { type: 'application', id: app.id },
    attestation: 'I confirm the information in this application is true and complete to the best of my knowledge.',
  };
}

export const submitApplication = defineAction({
  id: 'applications.submit',
  title: 'Submit an application',
  description:
    'Submits an application. This is consequential (R2): when an AI agent calls it, GMS does not submit — it creates a confirmation request and returns approval_required with a confirmUrl; the person must confirm inside GMS. Requires every form to pass validation, an attestation (typed name + agreed), and — when the foundation’s AI policy asks for it — an AI-assistance disclosure.',
  input: SubmitIn,
  output: z.object({ status: z.literal('submitted'), receiptNumber: z.string(), submittedAt: z.string(), referenceNumber: z.string() }),
  scopes: ['applications:submit'],
  roles: ['authenticated'],
  riskTier: 'R2',
  idempotent: true,
  preview: submitPreview,
  async run(input, ctx) {
    const me = uid(ctx);
    const { w, app, comp, opp, rows, disclosure } = await submitPreconditions(input, ctx);

    // Snapshot (immutable) + receipt.
    const profile = await orgProfile(ctx.db, app.applicant_org_id, app.applicant_user_id);
    const responses: Record<string, unknown> = {};
    const versions: { formId: string; formVersionId: string }[] = [];
    let requested: number | null = null;
    let title: string | null = null;
    for (const r of rows) {
      responses[r.form_id] = r.data;
      versions.push({ formId: r.form_id, formVersionId: r.version_id });
      const compiled = compiledFor({ id: r.version_id, builder_model: r.builder_model });
      requested ??= requestedAmountCents(compiled, (r.data ?? {}) as Record<string, unknown>);
      title ??= projectTitle(compiled, (r.data ?? {}) as Record<string, unknown>);
    }
    const submittedAt = ctx.now().toISOString();
    const attestation = { typedName: input.attestation.typedName, agreed: true, at: submittedAt, ip: ctx.ip ?? null, via: ctx.actor.type };
    const content = json({ responses, profile, versions, attestation });
    const hash = createHash('sha256').update(content).digest('hex');
    const prior = await sql<{ n: number }>`select count(*)::int as n from public.application_submissions where application_id = ${app.id}::uuid`.execute(ctx.db);
    const receipt = `${app.reference_number}-R${(prior.rows[0]?.n ?? 0) + 1}`;
    await ctx.db
      .insertInto('application_submissions')
      .values({
        workspace_id: w.id,
        application_id: app.id,
        competition_id: comp.id,
        submitted_at: submittedAt,
        submitted_by: me,
        submitted_by_agent_client_id: agentClientId(ctx),
        responses: json(responses),
        org_profile: json(profile),
        form_versions: json(versions),
        attestation: json(attestation),
        receipt_number: receipt,
        content_hash: hash,
      })
      .execute();
    await ctx.db
      .updateTable('applications')
      .set({
        status: 'submitted',
        submitted_at: submittedAt,
        submitted_via: ctx.actor.type === 'agent' ? 'agent' : ctx.channel === 'api' || ctx.channel === 'cg' ? 'api' : 'human',
        submitted_by_agent_client_id: agentClientId(ctx),
        ai_disclosure: disclosure,
        ...(requested !== null ? { requested_amount_cents: requested } : {}),
        ...(title ? { title } : {}),
        info_requested_at: null,
      })
      .where('id', '=', app.id)
      .execute();
    await recordStatus(ctx, app, 'submitted', null);
    ctx.audit({ entityType: 'application', entityId: app.id, before: { status: app.status }, after: { status: 'submitted', receipt, contentHash: hash } });
    ctx.emit('application.submitted', { type: 'application', id: app.id }, {
      receiptNumber: receipt,
      referenceNumber: app.reference_number,
      opportunityTitle: opp.title,
      submittedAt,
      submittedBy: me,
      viaAgent: ctx.actor.type === 'agent',
    });
    return { status: 'submitted' as const, receiptNumber: receipt, submittedAt, referenceNumber: app.reference_number };
  },
});

export const withdrawApplication = defineAction({
  id: 'applications.withdraw',
  title: 'Withdraw an application',
  description: 'Withdraws an application. The foundation keeps the record but will not review it. When an agent calls this, the person confirms inside GMS first.',
  input: z.object({ applicationId: uuid, reason: z.string().trim().max(1000).optional() }),
  output: Ok,
  scopes: ['applications:submit'],
  roles: ['authenticated'],
  riskTier: 'R2',
  idempotent: true,
  async preview(input, ctx) {
    const app = await loadApp(ctx.db, input.applicationId);
    return {
      title: `Withdraw application ${app.reference_number}`,
      summary: 'The foundation will stop considering this application. This cannot be undone.',
      fields: [{ label: 'Reason', value: input.reason ?? '—' }],
      entity: { type: 'application', id: app.id },
    };
  },
  async run(input, ctx) {
    const app = await loadApp(ctx.db, input.applicationId);
    transition(applicationMachine, app.status, 'withdrawn');
    await ctx.db.updateTable('applications').set({ status: 'withdrawn' }).where('id', '=', app.id).execute();
    await recordStatus(ctx, app, 'withdrawn', input.reason ?? null);
    ctx.audit({ entityType: 'application', entityId: app.id, before: { status: app.status }, after: { status: 'withdrawn' } });
    return { ok: true as const };
  },
});

// Attachments --------------------------------------------------------------------------------
export const requestAttachmentUpload = defineAction({
  id: 'applications.request_upload',
  title: 'Upload an attachment',
  description:
    'Returns a short-lived signed URL for uploading a file to an application field (PUT the bytes with the given headers), then call applications.confirm_upload. Allowed types and size limits come from the form field (default: PDF, DOCX, XLSX, CSV, PNG, JPEG up to 25 MB).',
  input: z.object({ applicationId: uuid, formId: uuid, fieldId: z.string().min(1).max(100), fileName: z.string().min(1).max(200), contentType: z.string(), sizeBytes: z.number().int().positive() }),
  output: z.object({ attachmentId: z.string().uuid(), uploadUrl: z.string(), method: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const app = await loadApp(ctx.db, input.applicationId);
    if (app.status !== 'in_progress') throw new DomainError('conflict', 'This application was already submitted.');
    const resp = found(
      await ctx.db
        .selectFrom('form_responses as r')
        .innerJoin('form_versions as v', 'v.id', 'r.form_version_id')
        .select(['v.id as version_id', 'v.builder_model'])
        .where('r.application_id', '=', app.id)
        .where('r.form_id', '=', input.formId)
        .executeTakeFirst(),
      'form',
    );
    const compiled = compiledFor({ id: resp.version_id, builder_model: resp.builder_model });
    const field = (compiled.fieldMeta as Record<string, { type?: string; accept?: string[]; maxBytes?: number }>)[input.fieldId];
    if (!field || (field.type && field.type !== 'file_upload')) throw new DomainError('validation_failed', 'That question does not take files.');
    assertUploadAllowed(input.contentType, input.sizeBytes, { accept: field.accept, maxBytes: field.maxBytes });
    const id = randomUUID();
    const key = `${w.id}/applications/${app.id}/${id}/${safeFileName(input.fileName)}`;
    await ctx.db
      .insertInto('attachments')
      .values({
        id,
        workspace_id: w.id,
        application_id: app.id,
        field_path: `${input.formId}/${input.fieldId}`,
        file_name: input.fileName.slice(0, 200),
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        storage_path: key,
        status: 'pending_upload',
        uploaded_by: uid(ctx),
      })
      .execute();
    const signed = await ctx.deps.storage.createSignedUploadUrl('applications', key, { contentType: input.contentType, maxBytes: input.sizeBytes });
    const url = signed.url.startsWith('/') ? `${ctx.deps.origin(w.slug)}${signed.url}` : signed.url;
    ctx.audit({ entityType: 'attachment', entityId: id, after: { applicationId: app.id, fieldId: input.fieldId, fileName: input.fileName } });
    return { attachmentId: id, uploadUrl: url, method: signed.method, headers: signed.headers, expiresAt: signed.expiresAt };
  },
});

export const confirmAttachmentUpload = defineAction({
  id: 'applications.confirm_upload',
  title: 'Confirm an attachment upload',
  description: 'Confirms a finished upload, scans it when a scanner is configured, and records the file as the answer to its question.',
  input: z.object({ attachmentId: uuid }),
  output: z.object({ attachmentId: z.string(), scanStatus: z.string(), fileName: z.string(), sizeBytes: z.number(), etag: z.string() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const att = found(await ctx.db.selectFrom('attachments').selectAll().where('id', '=', input.attachmentId).executeTakeFirst(), 'attachment');
    if (!att.application_id) throw new DomainError('precondition_failed', 'Not an application attachment.');
    const head = await ctx.deps.storage.head('applications', att.storage_path);
    if (!head) throw new DomainError('precondition_failed', 'We did not receive the file. Try uploading again.');
    const bytes = await ctx.deps.storage.get('applications', att.storage_path);
    const scan = bytes ? await ctx.deps.scanner.scan(bytes) : { status: 'not_scanned' as const };
    if (att.scan_status === 'pending') {
      const digest = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
      await sql`select gms_private.record_scan('attachment', ${att.id}::uuid, ${scan.status}, ${digest}, ${head.size})`.execute(ctx.db);
    }
    if (scan.status === 'infected') {
      await ctx.deps.storage.delete('applications', att.storage_path);
      throw new DomainError('validation_failed', 'This file looks unsafe, so we removed it. Try a different copy.');
    }
    const [formId, fieldId] = (att.field_path ?? '').split('/');
    let etag = '0';
    if (formId && fieldId) {
      const resp = await ctx.db.selectFrom('form_responses').select(['id', 'data', 'etag', 'field_updated_at']).where('application_id', '=', att.application_id).where('form_id', '=', formId).forUpdate().executeTakeFirst();
      if (resp) {
        const data = { ...((resp.data ?? {}) as Record<string, unknown>) };
        const ref = { fileId: att.id, name: att.file_name, size: head.size, mimeType: att.content_type };
        const prev = data[fieldId];
        data[fieldId] = Array.isArray(prev) ? [...prev.filter((p) => (p as { fileId?: string })?.fileId !== att.id), ref] : ref;
        const rev = (Number(resp.etag) || 0) + 1;
        const meta = { ...((resp.field_updated_at ?? {}) as Record<string, unknown>), [fieldId]: { rev, by: uid(ctx), byName: ctx.actor.name, at: ctx.now().toISOString() } };
        etag = String(rev);
        await ctx.db.updateTable('form_responses').set({ data: json(data), field_updated_at: json(meta), etag }).where('id', '=', resp.id).execute();
      }
    }
    ctx.audit({ entityType: 'attachment', entityId: att.id, after: { scanStatus: scan.status } });
    return { attachmentId: att.id, scanStatus: scan.status, fileName: att.file_name, sizeBytes: head.size, etag };
  },
});

// Collaborators --------------------------------------------------------------------------------
export const inviteCollaborator = defineAction({
  id: 'applications.invite_collaborator',
  title: 'Invite a collaborator',
  description: 'Invites someone by email to help with an application (editor or viewer). They get an email link.',
  input: z.object({ applicationId: uuid, email: Email, role: z.enum(['editor', 'viewer']).default('editor') }),
  output: z.object({ id: z.string().uuid() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const app = await loadApp(ctx.db, input.applicationId);
    const token = randomBytes(24).toString('base64url');
    const row = await ctx.db
      .insertInto('application_collaborators')
      .values({
        workspace_id: app.workspace_id,
        application_id: app.id,
        email: input.email,
        role: input.role,
        status: 'invited',
        token_hash: createHash('sha256').update(token).digest('hex'),
        invited_by: uid(ctx),
      })
      .onConflict((oc) => oc.columns(['application_id', 'email']).doUpdateSet({ role: input.role, status: 'invited', token_hash: createHash('sha256').update(token).digest('hex') }))
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'application_collaborator', entityId: row.id, after: { email: input.email, role: input.role } });
    ctx.emit('collaborator.invited', { type: 'application', id: app.id }, { email: input.email, role: input.role, token, invitedBy: ctx.actor.name, sensitive: ['token'] });
    return { id: row.id };
  },
});

export const acceptCollaborator = defineAction({
  id: 'applications.accept_collaboration',
  title: 'Join an application',
  description: 'Accepts a collaborator invitation for the signed-in person (email must match).',
  input: z.object({ token: z.string().min(10) }),
  output: z.object({ applicationId: z.string().uuid() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const hash = createHash('sha256').update(input.token).digest('hex');
    const r = await sql<{ application_id: string }>`select * from gms.accept_collaborator_invite(${hash})`.execute(ctx.db);
    const row = r.rows[0];
    if (!row) throw new DomainError('not_found', 'This invitation link is not valid, was already used, or is for a different email address.');
    ctx.audit({ entityType: 'application', entityId: row.application_id, after: { collaboratorJoined: uid(ctx) } });
    return { applicationId: row.application_id };
  },
});

export const removeCollaborator = defineAction({
  id: 'applications.remove_collaborator',
  title: 'Remove a collaborator',
  description: 'Removes a collaborator from an in-progress application so they can no longer see or edit it.',
  input: z.object({ collaboratorId: uuid }),
  output: Ok,
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const r = await ctx.db.updateTable('application_collaborators').set({ status: 'removed', token_hash: null }).where('id', '=', input.collaboratorId).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new DomainError('not_found', 'Collaborator not found.');
    ctx.audit({ entityType: 'application_collaborator', entityId: input.collaboratorId, after: { status: 'removed' } });
    return { ok: true as const };
  },
});

export const addComment = defineAction({
  id: 'applications.comment',
  title: 'Add a team comment',
  description: 'Adds a comment for the applicant team on an application (not visible to the foundation).',
  input: z.object({ applicationId: uuid, fieldPath: z.string().max(200).optional().nullable(), body: z.string().trim().min(1).max(5000) }),
  output: z.object({ id: z.string().uuid() }),
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const app = await loadApp(ctx.db, input.applicationId);
    const r = await ctx.db
      .insertInto('application_comments')
      .values({ workspace_id: app.workspace_id, application_id: app.id, author_id: uid(ctx), field_path: input.fieldPath ?? null, body: input.body })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: r.id };
  },
});

export const resolveComment = defineAction({
  id: 'applications.resolve_comment',
  title: 'Resolve a team comment',
  description: 'Marks an applicant-team comment on an application as resolved (the foundation never sees these comments).',
  input: z.object({ commentId: uuid }),
  output: Ok,
  scopes: ['applications:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('application_comments').set({ resolved_at: ctx.now().toISOString() }).where('id', '=', input.commentId).execute();
    return { ok: true as const };
  },
});

// Public eligibility pre-check ------------------------------------------------------------------
export const checkEligibility = defineAction({
  id: 'opportunities.check_eligibility',
  title: 'Check eligibility',
  description:
    'Checks the published eligibility questions for an opportunity against your answers (no account needed). Returns eligible true/false, or null plus the questions still missing — ask the person those questions and call again. Answers are keyed by question id.',
  input: z.object({ opportunityId: uuid, answers: z.record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.string()), z.null()])).default({}) }),
  output: z.object({
    eligible: z.boolean().nullable(),
    outcomes: z.array(z.object({ ruleId: z.string(), question: z.string(), passed: z.boolean().nullable(), message: z.string().optional() })),
    missing: z.array(z.object({ ruleId: z.string(), question: z.string(), kind: z.string(), options: z.array(z.string()).optional() })),
  }),
  scopes: ['opportunities:read'],
  roles: ['public'],
  riskTier: 'R0',
  idempotent: true,
  async run(input, ctx) {
    const rules = await ctx.db.selectFrom('eligibility_rules').selectAll().where('opportunity_id', '=', input.opportunityId).orderBy('position').execute();
    if (!rules.length) {
      const opp = await ctx.db.selectFrom('opportunities').select('id').where('id', '=', input.opportunityId).executeTakeFirst();
      found(opp, 'opportunity');
    }
    return evaluateEligibility(
      rules.map((r) => ({
        id: r.id,
        position: r.position,
        question: r.question,
        helpText: r.help_text,
        kind: r.kind as 'yes_no',
        config: r.config as Record<string, unknown>,
        knockoutMessage: r.knockout_message,
      })),
      input.answers,
    );
  },
});
