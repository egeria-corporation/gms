// SPDX-License-Identifier: AGPL-3.0-or-later
// Decisions (recommend vs. final), awards (drafts, activation, amendments/supplements, schedules, holds),
// agreements (generate → send → click-to-sign → countersign), board dockets and votes.
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Tx } from '@gms/db';
import { applicationMachine, awardMachine, DomainError, formatMoney, splitInstallments, sumCents } from '@gms/domain';
import { documentHash, renderPdf, type GrantAgreementProps } from '@gms/pdf';
import { z } from 'zod';
import { defineAction, type RunContext } from '../define';
import { DateOnly, found, IdOut, Ok, recordStatus, transition, uid, uuid, ws, yearInZone, nextReference } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

// Decisions --------------------------------------------------------------------------------
export const recommendDecision = defineAction({
  id: 'decisions.recommend',
  title: 'Recommend a decision',
  description: 'Records a (non-final) recommendation for an application: approve with an amount, decline, or defer. Recommendations feed the board docket; they do not notify the applicant.',
  input: z.object({ applicationId: uuid, outcome: z.enum(['approve', 'decline', 'defer']), reason: z.string().max(5000).optional().nullable(), recommendedAmountCents: z.number().int().min(0).optional().nullable() }),
  output: IdOut,
  scopes: ['awards:draft'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const app = found(await ctx.db.selectFrom('applications').select(['id', 'status']).where('id', '=', input.applicationId).executeTakeFirst(), 'application');
    if (['awarded', 'declined', 'withdrawn'].includes(app.status)) throw new DomainError('conflict', 'A final decision was already recorded.');
    const r = await ctx.db
      .insertInto('decisions')
      .values({ workspace_id: w.id, application_id: app.id, outcome: input.outcome, reason: input.reason ?? null, recommended_amount_cents: input.recommendedAmountCents ?? null, is_final: false, recorded_by: uid(ctx) })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'decision', entityId: r.id, after: { applicationId: app.id, outcome: input.outcome, amount: input.recommendedAmountCents ?? null, final: false } });
    return { id: r.id };
  },
});

async function recordFinal(ctx: RunContext, applicationId: string, outcome: 'approve' | 'decline' | 'defer', reason: string | null, amountCents: number | null, notify: boolean) {
  const w = ws(ctx);
  const app = found(await ctx.db.selectFrom('applications').selectAll().where('id', '=', applicationId).executeTakeFirst(), 'application');
  const target = outcome === 'approve' ? 'awarded' : outcome === 'decline' ? 'declined' : null;
  if (target) transition(applicationMachine, app.status, target);
  const d = await ctx.db
    .insertInto('decisions')
    .values({ workspace_id: w.id, application_id: app.id, outcome, reason, recommended_amount_cents: amountCents, is_final: true, recorded_by: uid(ctx), letter_sent_at: notify && target ? ctx.now().toISOString() : null })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (target) {
    await ctx.db.updateTable('applications').set({ status: target }).where('id', '=', app.id).execute();
    await recordStatus(ctx, app, target, outcome === 'decline' ? reason : null);
  }
  ctx.audit({ entityType: 'decision', entityId: d.id, after: { applicationId: app.id, outcome, amountCents, final: true } });
  ctx.emit('decision.recorded', { type: 'application', id: app.id }, { outcome, decisionId: d.id, notify });
  return { app, decisionId: d.id };
}

export const recordFinalDecision = defineAction({
  id: 'decisions.record_final',
  title: 'Record the final decision',
  description: 'Records the final decision on an application (approve → Awarded with a draft award; decline → Declined, with an optional letter). People only (R3).',
  input: z.object({ applicationId: uuid, outcome: z.enum(['approve', 'decline', 'defer']), reason: z.string().max(5000).optional().nullable(), amountCents: z.number().int().positive().optional().nullable(), sendLetter: z.boolean().default(true) }),
  output: z.object({ decisionId: z.string().uuid(), awardId: z.string().uuid().nullable() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    if (input.outcome === 'approve' && !input.amountCents) {
      throw new DomainError('validation_failed', 'Enter the award amount.', {}, [{ pointer: '/amountCents', message: 'Enter the amount to award.' }]);
    }
    const { app, decisionId } = await recordFinal(ctx, input.applicationId, input.outcome, input.reason ?? null, input.amountCents ?? null, input.sendLetter);
    let awardId: string | null = null;
    if (input.outcome === 'approve') awardId = await createDraftAward(ctx, app, input.amountCents!, {});
    return { decisionId, awardId };
  },
});

export const bulkDecline = defineAction({
  id: 'decisions.bulk_decline',
  title: 'Decline applications',
  description: 'Records a final decline for several applications, with one reason and an optional letter to each applicant. People only (R3).',
  input: z.object({ applicationIds: z.array(uuid).min(1).max(1000), reason: z.string().trim().min(1).max(5000), sendLetter: z.boolean().default(true) }),
  output: z.object({ declined: z.number(), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    let declined = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of input.applicationIds) {
      try {
        await recordFinal(ctx, id, 'decline', input.reason, null, input.sendLetter);
        declined++;
      } catch (e) {
        skipped.push({ id, reason: (e as Error).message });
      }
    }
    return { declined, skipped };
  },
});

// Awards -----------------------------------------------------------------------------------------
const InstallmentIn = z.object({ dueDate: DateOnly, amountCents: z.number().int().positive(), condition: z.string().max(500).optional().nullable() });

async function programOf(trx: Tx, opportunityId: string) {
  return trx.selectFrom('opportunities').select(['program_id']).where('id', '=', opportunityId).executeTakeFirst();
}

async function createDraftAward(
  ctx: RunContext,
  app: { id: string; opportunity_id: string; applicant_org_id: string | null; title: string | null; reference_number: string },
  amountCents: number,
  opts: { startDate?: string; endDate?: string; purpose?: string | null; installments?: z.infer<typeof InstallmentIn>[] },
): Promise<string> {
  const w = ws(ctx);
  const existing = await ctx.db.selectFrom('awards').select('id').where('application_id', '=', app.id).where('kind', '=', 'original').executeTakeFirst();
  if (existing) return existing.id;
  const program = await programOf(ctx.db, app.opportunity_id);
  const id = randomUUID();
  const now = ctx.now();
  const ref = await nextReference(ctx.db, w, 'award', yearInZone(now, w.timezone));
  const start = opts.startDate ?? now.toISOString().slice(0, 10);
  const end = opts.endDate ?? new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  await ctx.db
    .insertInto('awards')
    .values({
      id,
      workspace_id: w.id,
      application_id: app.id,
      program_id: program?.program_id ?? null,
      opportunity_id: app.opportunity_id,
      applicant_org_id: app.applicant_org_id,
      kind: 'original',
      reference: ref,
      title: app.title ?? `Award for ${app.reference_number}`,
      purpose: opts.purpose ?? null,
      amount_cents: amountCents,
      start_date: start,
      end_date: end,
      fiscal_year: Number(start.slice(0, 4)),
      status: 'draft',
      created_by: uid(ctx),
    })
    .execute();
  const sched = await ctx.db.insertInto('payment_schedules').values({ workspace_id: w.id, award_id: id, created_by: uid(ctx) }).returning('id').executeTakeFirstOrThrow();
  const inst = opts.installments?.length
    ? opts.installments
    : splitInstallments(amountCents, amountCents >= 1_000_000 ? 2 : 1).map((a, i) => ({
        dueDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i * 6, Math.min(now.getUTCDate(), 28))).toISOString().slice(0, 10),
        amountCents: a,
        condition: i === 0 ? 'On signed agreement' : 'After the interim report is accepted',
      }));
  await ctx.db
    .insertInto('installments')
    .values(inst.map((x, i) => ({ workspace_id: w.id, schedule_id: sched.id, award_id: id, position: i + 1, due_date: x.dueDate, amount_cents: x.amountCents, condition: x.condition ?? null })))
    .execute();
  ctx.audit({ entityType: 'award', entityId: id, after: { reference: ref, amountCents, status: 'draft', applicationId: app.id } });
  return id;
}

async function budgetCheck(trx: Tx, programId: string | null, fiscalYear: number, extraCents: number, excludeAwardId?: string) {
  if (!programId) return { warnings: [] as string[], budgetCents: null, committedCents: 0 };
  const b = await trx.selectFrom('program_budgets').select('amount_cents').where('program_id', '=', programId).where('fiscal_year', '=', fiscalYear).executeTakeFirst();
  let q = trx
    .selectFrom('awards')
    .select(sql<number>`coalesce(sum(amount_cents), 0)::bigint`.as('c'))
    .where('program_id', '=', programId)
    .where('fiscal_year', '=', fiscalYear)
    .where('status', 'in', ['active', 'completed'])
    .where((eb) => eb.or([eb('kind', '=', 'original'), eb('amendment_status', '=', 'approved')]));
  if (excludeAwardId) q = q.where('id', '!=', excludeAwardId);
  const c = await q.executeTakeFirst();
  const committed = Number(c?.c ?? 0);
  const warnings: string[] = [];
  if (!b) warnings.push(`No FY${fiscalYear} budget is set for this program.`);
  else if (committed + extraCents > b.amount_cents) {
    warnings.push(`This award would bring FY${fiscalYear} commitments to ${formatMoney(committed + extraCents)}, over the ${formatMoney(b.amount_cents)} budget by ${formatMoney(committed + extraCents - b.amount_cents)}.`);
  }
  return { warnings, budgetCents: b?.amount_cents ?? null, committedCents: committed };
}

export const draftAward = defineAction({
  id: 'awards.draft',
  title: 'Draft an award',
  description: 'Creates or updates a draft award for an application: amount, period, purpose, conditions and payment schedule. Returns budget warnings. A person activates it (awards.activate).',
  input: z.object({
    applicationId: uuid,
    amountCents: z.number().int().positive(),
    startDate: DateOnly.optional(),
    endDate: DateOnly.optional(),
    purpose: z.string().max(5000).optional().nullable(),
    conditions: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    installments: z.array(InstallmentIn).min(1).max(24).optional(),
    expenditureResponsibility: z.boolean().optional(),
    grantToIndividual: z.boolean().optional(),
  }),
  output: z.object({ awardId: z.string().uuid(), warnings: z.array(z.string()) }),
  scopes: ['awards:draft'],
  roles: ['owner', 'admin', 'program_officer', 'finance'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const app = found(await ctx.db.selectFrom('applications').selectAll().where('id', '=', input.applicationId).executeTakeFirst(), 'application');
    if (input.installments && sumCents(input.installments.map((i) => i.amountCents)) !== input.amountCents) {
      throw new DomainError('validation_failed', `The payment schedule totals ${formatMoney(sumCents(input.installments.map((i) => i.amountCents)))}, but the award is ${formatMoney(input.amountCents)}. Make them match.`, {}, [
        { pointer: '/installments', message: 'Installments must add up to the award amount.' },
      ]);
    }
    let awardId = (await ctx.db.selectFrom('awards').select(['id', 'status']).where('application_id', '=', app.id).where('kind', '=', 'original').executeTakeFirst())?.id;
    if (!awardId) {
      awardId = await createDraftAward(ctx, app, input.amountCents, input);
    } else {
      const a = await ctx.db.selectFrom('awards').selectAll().where('id', '=', awardId).executeTakeFirstOrThrow();
      if (a.status !== 'draft') throw new DomainError('conflict', 'This award is active. Use an amendment to change it.');
      await ctx.db
        .updateTable('awards')
        .set({ amount_cents: input.amountCents, ...(input.startDate ? { start_date: input.startDate, fiscal_year: Number(input.startDate.slice(0, 4)) } : {}), ...(input.endDate ? { end_date: input.endDate } : {}), ...(input.purpose !== undefined ? { purpose: input.purpose } : {}) })
        .where('id', '=', awardId)
        .execute();
      if (input.installments) await replaceSchedule(ctx, awardId, input.installments);
    }
    const flags = {
      ...(input.expenditureResponsibility !== undefined ? { expenditure_responsibility: input.expenditureResponsibility } : {}),
      ...(input.grantToIndividual !== undefined ? { grant_to_individual: input.grantToIndividual } : {}),
    };
    if (Object.keys(flags).length) await ctx.db.updateTable('awards').set(flags).where('id', '=', awardId).execute();
    if (input.conditions) {
      await ctx.db.deleteFrom('award_conditions').where('award_id', '=', awardId).where('status', '=', 'open').execute();
      if (input.conditions.length) await ctx.db.insertInto('award_conditions').values(input.conditions.map((c) => ({ workspace_id: app.workspace_id, award_id: awardId!, body: c }))).execute();
    }
    const a = await ctx.db.selectFrom('awards').select(['program_id', 'fiscal_year']).where('id', '=', awardId).executeTakeFirstOrThrow();
    const check = await budgetCheck(ctx.db, a.program_id, a.fiscal_year ?? new Date().getUTCFullYear(), input.amountCents, awardId);
    ctx.audit({ entityType: 'award', entityId: awardId, after: { amountCents: input.amountCents, draft: true } });
    return { awardId, warnings: check.warnings };
  },
});

async function replaceSchedule(ctx: RunContext, awardId: string, installments: z.infer<typeof InstallmentIn>[]) {
  const w = ws(ctx);
  let sched = await ctx.db.selectFrom('payment_schedules').select('id').where('award_id', '=', awardId).executeTakeFirst();
  if (!sched) sched = await ctx.db.insertInto('payment_schedules').values({ workspace_id: w.id, award_id: awardId, created_by: uid(ctx) }).returning('id').executeTakeFirstOrThrow();
  const paid = await ctx.db
    .selectFrom('installments as i')
    .innerJoin('payments as p', 'p.installment_id', 'i.id')
    .select('i.id')
    .where('i.schedule_id', '=', sched.id)
    .where('p.status', 'not in', ['failed', 'cancelled'])
    .execute();
  if (paid.length) throw new DomainError('conflict', 'Some installments already have payments. Change the remaining installments only, or amend the award.');
  await ctx.db.deleteFrom('installments').where('schedule_id', '=', sched.id).execute();
  await ctx.db
    .insertInto('installments')
    .values(installments.map((x, i) => ({ workspace_id: w.id, schedule_id: sched!.id, award_id: awardId, position: i + 1, due_date: x.dueDate, amount_cents: x.amountCents, condition: x.condition ?? null })))
    .execute();
}

export const setSchedule = defineAction({
  id: 'awards.set_schedule',
  title: 'Set the payment schedule',
  description: 'Replaces an award’s installments. They must add up to the award total (original + approved amendments).',
  input: z.object({ awardId: uuid, installments: z.array(InstallmentIn).min(1).max(24) }),
  output: Ok,
  scopes: ['awards:draft'],
  roles: ['owner', 'admin', 'program_officer', 'finance'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('awards').selectAll().where('id', '=', input.awardId).executeTakeFirst(), 'award');
    const ceiling = await sql<{ c: number }>`select gms_private.award_ceiling_cents(${a.id}::uuid) as c`.execute(ctx.db);
    const total = sumCents(input.installments.map((i) => i.amountCents));
    if (total !== Number(ceiling.rows[0]!.c)) {
      throw new DomainError('validation_failed', `Installments total ${formatMoney(total)}, but the award total is ${formatMoney(Number(ceiling.rows[0]!.c))}.`, {}, [{ pointer: '/installments', message: 'Make the installments match the award total.' }]);
    }
    await replaceSchedule(ctx, a.id, input.installments);
    ctx.audit({ entityType: 'award', entityId: a.id, action: 'awards.set_schedule', after: { installments: input.installments.length, total } });
    return { ok: true as const };
  },
});

export const activateAward = defineAction({
  id: 'awards.activate',
  title: 'Activate an award',
  description: 'Makes a draft award active: generates reporting requirements, prepares the agreement, and runs a sanctions screening. People only (R3).',
  input: z.object({ awardId: uuid }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const a = found(await ctx.db.selectFrom('awards').selectAll().where('id', '=', input.awardId).executeTakeFirst(), 'award');
    transition(awardMachine, a.status, 'active');
    const inst = await ctx.db.selectFrom('installments').select('amount_cents').where('award_id', '=', a.id).execute();
    if (sumCents(inst.map((i) => i.amount_cents)) !== a.amount_cents) {
      throw new DomainError('validation_failed', 'The payment schedule must add up to the award amount before activating.');
    }
    await ctx.db.updateTable('awards').set({ status: 'active', agreement_pending: true }).where('id', '=', a.id).execute();
    // Reporting requirements: interim at the midpoint, final 30 days after the end date.
    const reportForm = await ctx.db.selectFrom('forms').select(['id', 'name']).where('workspace_id', '=', w.id).where('kind', '=', 'report').where('status', '=', 'active').orderBy('created_at').execute();
    if (a.start_date && a.end_date) {
      const s = Date.parse(a.start_date);
      const e = Date.parse(a.end_date);
      const mid = new Date(s + (e - s) / 2).toISOString().slice(0, 10);
      const fin = new Date(e + 30 * 86400000).toISOString().slice(0, 10);
      const interim = reportForm.find((f) => /interim/i.test(f.name)) ?? reportForm[0];
      const final = reportForm.find((f) => /final/i.test(f.name)) ?? reportForm[0];
      await ctx.db
        .insertInto('report_requirements')
        .values([
          { workspace_id: w.id, award_id: a.id, form_id: interim?.id ?? null, title: 'Interim report', kind: 'interim', due_date: mid },
          { workspace_id: w.id, award_id: a.id, form_id: final?.id ?? null, title: 'Final report', kind: 'final', due_date: fin },
        ])
        .execute();
    }
    ctx.audit({ entityType: 'award', entityId: a.id, before: { status: a.status }, after: { status: 'active' } });
    ctx.emit('award.created', { type: 'award', id: a.id }, { reference: a.reference, amountCents: a.amount_cents, applicantOrgId: a.applicant_org_id });
    return { ok: true as const };
  },
});

export const amendAward = defineAction({
  id: 'awards.amend',
  title: 'Draft an amendment or supplement',
  description: 'Drafts a change to an active award as a child award: an amendment (amount change, positive or negative, and/or a new end date) or a supplement (additional funds). A person approves it.',
  input: z.object({ awardId: uuid, kind: z.enum(['amendment', 'supplement']), amountCents: z.number().int(), newEndDate: DateOnly.optional(), reason: z.string().trim().min(1).max(5000) }),
  output: IdOut,
  scopes: ['awards:draft'],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const parent = found(await ctx.db.selectFrom('awards').selectAll().where('id', '=', input.awardId).where('kind', '=', 'original').executeTakeFirst(), 'award');
    if (parent.status !== 'active') throw new DomainError('conflict', 'Only active awards can be amended.');
    if (input.kind === 'supplement' && input.amountCents <= 0) throw new DomainError('validation_failed', 'A supplement adds money; enter a positive amount.');
    const n = await ctx.db.selectFrom('awards').select('id').where('parent_award_id', '=', parent.id).execute();
    const id = randomUUID();
    await ctx.db
      .insertInto('awards')
      .values({
        id,
        workspace_id: w.id,
        application_id: parent.application_id,
        program_id: parent.program_id,
        opportunity_id: parent.opportunity_id,
        applicant_org_id: parent.applicant_org_id,
        parent_award_id: parent.id,
        kind: input.kind,
        amendment_status: 'draft',
        reference: `${parent.reference}-${input.kind === 'amendment' ? 'A' : 'S'}${n.length + 1}`,
        title: `${input.kind === 'amendment' ? 'Amendment' : 'Supplement'} to ${parent.reference}`,
        purpose: input.reason,
        amount_cents: input.amountCents,
        start_date: parent.start_date,
        end_date: input.newEndDate ?? parent.end_date,
        fiscal_year: parent.fiscal_year,
        status: 'draft',
        agreement_pending: false,
        created_by: uid(ctx),
      })
      .execute();
    ctx.audit({ entityType: 'award', entityId: id, after: { parent: parent.id, kind: input.kind, amountCents: input.amountCents } });
    return { id };
  },
});

export const approveAmendment = defineAction({
  id: 'awards.approve_amendment',
  title: 'Approve an amendment',
  description: 'Approves (or rejects) a drafted amendment/supplement; approved amounts raise the payment ceiling. People only (R3).',
  input: z.object({ awardId: uuid, approve: z.boolean() }),
  output: z.object({ newTotalCents: z.number() }),
  scopes: [],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const child = found(await ctx.db.selectFrom('awards').selectAll().where('id', '=', input.awardId).executeTakeFirst(), 'amendment');
    if (child.kind === 'original' || child.amendment_status !== 'draft') throw new DomainError('conflict', 'This is not a pending amendment.');
    const parent = await ctx.db.selectFrom('awards').selectAll().where('id', '=', child.parent_award_id!).executeTakeFirstOrThrow();
    if (input.approve) {
      const newTotal = Number((await sql<{ c: number }>`select gms_private.award_ceiling_cents(${parent.id}::uuid) as c`.execute(ctx.db)).rows[0]!.c) + child.amount_cents;
      const paid = await sql<{ s: number }>`select coalesce(sum(amount_cents),0)::bigint as s from public.payments where award_id = ${parent.id}::uuid and status not in ('failed','cancelled')`.execute(ctx.db);
      if (newTotal < Number(paid.rows[0]!.s)) throw new DomainError('invariant_violated', `The new total ${formatMoney(newTotal)} would be less than what is already paid or scheduled for payment.`);
      await ctx.db.updateTable('awards').set({ amendment_status: 'approved', status: 'active' }).where('id', '=', child.id).execute();
      if (child.end_date && child.end_date !== parent.end_date) await ctx.db.updateTable('awards').set({ end_date: child.end_date }).where('id', '=', parent.id).execute();
      ctx.audit({ entityType: 'award', entityId: parent.id, action: 'awards.approve_amendment', after: { amendment: child.id, amountCents: child.amount_cents, newTotal } });
      ctx.emit('award.amended', { type: 'award', id: parent.id }, { amendmentId: child.id, amountCents: child.amount_cents, newTotalCents: newTotal });
      return { newTotalCents: newTotal };
    }
    await ctx.db.updateTable('awards').set({ amendment_status: 'rejected', status: 'cancelled' }).where('id', '=', child.id).execute();
    ctx.audit({ entityType: 'award', entityId: child.id, action: 'awards.reject_amendment' });
    return { newTotalCents: Number((await sql<{ c: number }>`select gms_private.award_ceiling_cents(${parent.id}::uuid) as c`.execute(ctx.db)).rows[0]!.c) };
  },
});

export const setAwardHold = defineAction({
  id: 'awards.set_hold',
  title: 'Put an award on hold',
  description: 'Places or releases a payment hold on an award (with a reason). Held awards cannot have payments batched.',
  input: z.object({ awardId: uuid, onHold: z.boolean(), reason: z.string().max(1000).optional().nullable() }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer', 'finance'],
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('awards').select(['id', 'on_hold', 'hold_reason']).where('id', '=', input.awardId).executeTakeFirst(), 'award');
    if (input.onHold && !input.reason?.trim()) throw new DomainError('validation_failed', 'Say why the award is on hold.', {}, [{ pointer: '/reason', message: 'Enter a reason.' }]);
    await ctx.db.updateTable('awards').set({ on_hold: input.onHold, hold_reason: input.onHold ? input.reason! : null }).where('id', '=', a.id).execute();
    if (input.onHold) {
      await ctx.db.updateTable('payments').set({ status: 'held', hold_reason: input.reason! }).where('award_id', '=', a.id).where('status', '=', 'scheduled').execute();
    } else {
      await ctx.db.updateTable('payments').set({ status: 'scheduled', hold_reason: null }).where('award_id', '=', a.id).where('status', '=', 'held').execute();
    }
    ctx.audit({ entityType: 'award', entityId: a.id, before: { onHold: a.on_hold, reason: a.hold_reason }, after: { onHold: input.onHold, reason: input.reason ?? null } });
    ctx.emit(input.onHold ? 'award.held' : 'award.released', { type: 'award', id: a.id }, { reason: input.reason ?? null });
    return { ok: true as const };
  },
});

export const closeAward = defineAction({
  id: 'awards.close',
  title: 'Close or cancel an award',
  description: 'Marks an award completed (all reports accepted) or cancelled (remaining scheduled payments are cancelled).',
  input: z.object({ awardId: uuid, status: z.enum(['completed', 'cancelled']), reason: z.string().max(2000).optional() }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('awards').selectAll().where('id', '=', input.awardId).executeTakeFirst(), 'award');
    transition(awardMachine, a.status, input.status);
    await ctx.db.updateTable('awards').set({ status: input.status }).where('id', '=', a.id).execute();
    if (input.status === 'cancelled') {
      await ctx.db.updateTable('payments').set({ status: 'cancelled' }).where('award_id', '=', a.id).where('status', 'in', ['scheduled', 'held', 'in_batch']).execute();
      await ctx.db.updateTable('installments').set({ status: 'cancelled' }).where('award_id', '=', a.id).where('status', '=', 'scheduled').execute();
    }
    ctx.audit({ entityType: 'award', entityId: a.id, before: { status: a.status }, after: { status: input.status, reason: input.reason ?? null } });
    ctx.emit(`award.${input.status}`, { type: 'award', id: a.id });
    return { ok: true as const };
  },
});

// Agreements ------------------------------------------------------------------------------------------
async function brandFor(ctx: RunContext) {
  const w = ws(ctx);
  const b = await ctx.db.selectFrom('workspace_brand').selectAll().where('workspace_id', '=', w.id).executeTakeFirstOrThrow();
  return {
    displayName: b.display_name,
    logoUrl: null,
    primaryColor: b.primary_color,
    accentColor: b.accent_color,
    headingFont: b.heading_font,
    replyTo: b.email_reply_to,
    sourceUrl: process.env.NEXT_PUBLIC_GMS_SOURCE_URL ?? 'https://github.com/egeria-corporation/gms',
  };
}

/** Standard terms printed in every grant agreement (numbered sections after the award-specific terms). */
export const STANDARD_AGREEMENT_TERMS: readonly { heading: string; body: string }[] = [
  { heading: 'Use of funds', body: 'The Grantee will use the grant only for the purpose in this agreement and will keep records of how it was spent for at least three years after the grant ends.' },
  { heading: 'Reports', body: 'The Grantee will submit the reports listed above through the Foundation’s grantee portal by their due dates. The Foundation may pause payments while a report is overdue.' },
  { heading: 'Changes', body: 'The Grantee will ask the Foundation in writing before making significant changes to the budget, timeline or purpose. Changes take effect only when the Foundation approves them.' },
  { heading: 'Unspent funds', body: 'Funds not used for the purpose of this grant by the end of the grant period will be returned to the Foundation unless the Foundation agrees otherwise in writing.' },
  { heading: 'Ending the grant', body: 'Either party may end this agreement with 30 days’ written notice. The Foundation may end it sooner if funds are used for anything other than the purpose above.' },
  { heading: 'Electronic signatures', body: 'The parties agree that typed electronic signatures on this agreement are binding, just like handwritten ones.' },
];

/** Date-only (YYYY-MM-DD) for `at` in the workspace timezone. */
function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Props for the H-02 grant agreement (`renderPdf('agreement', …)`), built from the award as it stands now. */
export async function agreementProps(ctx: RunContext, awardId: string): Promise<GrantAgreementProps> {
  const w = ws(ctx);
  const a = await ctx.db.selectFrom('awards').selectAll().where('id', '=', awardId).executeTakeFirstOrThrow();
  const org = a.applicant_org_id ? await ctx.db.selectFrom('applicant_orgs').select(['legal_name', 'ein']).where('id', '=', a.applicant_org_id).executeTakeFirst() : null;
  const opp = a.opportunity_id ? await ctx.db.selectFrom('opportunities').select(['title']).where('id', '=', a.opportunity_id).executeTakeFirst() : null;
  const inst = await ctx.db.selectFrom('installments').selectAll().where('award_id', '=', a.id).orderBy('position').execute();
  const conds = await ctx.db.selectFrom('award_conditions').select(['body']).where('award_id', '=', a.id).execute();
  const reqs = await ctx.db.selectFrom('report_requirements').select(['title', 'due_date', 'kind']).where('award_id', '=', a.id).orderBy('due_date').execute();
  const granteeName = org?.legal_name ?? 'Grantee';
  return {
    awardReference: a.reference,
    opportunityName: opp?.title ?? '',
    projectTitle: a.title,
    amountCents: a.amount_cents,
    currency: a.currency,
    periodStart: a.start_date ?? '',
    periodEnd: a.end_date ?? '',
    purpose: a.purpose ?? '',
    installments: inst.map((i) => ({ label: `Installment ${i.position}`, dueDate: i.due_date, condition: i.condition, amountCents: i.amount_cents })),
    conditions: conds.map((c) => c.body),
    reportingRequirements: reqs.map((r) => ({ name: r.title, dueDate: r.due_date, description: r.kind })),
    agreementDate: dateInZone(ctx.now(), w.timezone),
    foundation: { legalName: w.name },
    grantee: { legalName: granteeName, ein: org?.ein ?? null },
    terms: [...STANDARD_AGREEMENT_TERMS],
    signatures: [
      { party: 'For the grantee', organizationName: granteeName },
      { party: 'For the foundation', organizationName: w.name },
    ],
    timeZone: w.timezone,
  };
}

export const generateAgreement = defineAction({
  id: 'agreements.generate',
  title: 'Generate the award letter and agreement',
  description: 'Generates the award letter + grant agreement PDF for an active award and stores its SHA-256 hash (signatures bind to this hash).',
  input: z.object({ awardId: uuid }),
  output: z.object({ agreementId: z.string().uuid(), documentHash: z.string() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const a = found(await ctx.db.selectFrom('awards').select(['id', 'status', 'reference']).where('id', '=', input.awardId).executeTakeFirst(), 'award');
    if (a.status !== 'active') throw new DomainError('precondition_failed', 'Activate the award before generating its agreement.');
    const existing = await ctx.db.selectFrom('agreements').select(['id', 'status']).where('award_id', '=', a.id).where('status', '!=', 'void').executeTakeFirst();
    if (existing && existing.status !== 'draft') throw new DomainError('conflict', 'The agreement was already sent. Void it to issue a new one.');
    const props = await agreementProps(ctx, a.id);
    const bytes = await renderPdf('agreement', props, await brandFor(ctx));
    const hash = documentHash(bytes);
    const key = `${w.id}/agreements/${a.id}/${hash.slice(0, 16)}.pdf`;
    await ctx.deps.storage.put('agreements', key, bytes, 'application/pdf');
    let id = existing?.id;
    if (id) await ctx.db.updateTable('agreements').set({ document_path: key, document_hash: hash }).where('id', '=', id).execute();
    else id = (await ctx.db.insertInto('agreements').values({ workspace_id: w.id, award_id: a.id, status: 'draft', document_path: key, document_hash: hash, created_by: uid(ctx) }).returning('id').executeTakeFirstOrThrow()).id;
    ctx.audit({ entityType: 'agreement', entityId: id, after: { documentHash: hash } });
    return { agreementId: id, documentHash: hash };
  },
});

export const sendAgreement = defineAction({
  id: 'agreements.send',
  title: 'Send the agreement for signature',
  description: 'Sends the generated agreement to the grantee organization’s admins to review and sign in GMS.',
  input: z.object({ agreementId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const g = found(await ctx.db.selectFrom('agreements').selectAll().where('id', '=', input.agreementId).executeTakeFirst(), 'agreement');
    if (g.status !== 'draft' || !g.document_hash) throw new DomainError('conflict', 'Generate the agreement before sending it.');
    await ctx.db.updateTable('agreements').set({ status: 'sent', sent_at: ctx.now().toISOString() }).where('id', '=', g.id).execute();
    ctx.audit({ entityType: 'agreement', entityId: g.id, before: { status: 'draft' }, after: { status: 'sent' } });
    ctx.emit('agreement.sent', { type: 'agreement', id: g.id }, { awardId: g.award_id });
    return { ok: true as const };
  },
});

const ATTESTATION =
  'I am authorized to sign for this organization. By typing my name, I agree to the terms of this grant agreement, and I understand this is a legally binding electronic signature.';

export const signAgreement = defineAction({
  id: 'agreements.sign',
  title: 'Sign the grant agreement',
  description: 'Signs a grant agreement as the grantee (typed name + attestation; GMS records the time, IP address and the document’s SHA-256 hash). People only (R3).',
  input: z.object({ agreementId: uuid, typedName: z.string().trim().min(2).max(200), agree: z.literal(true), documentHash: z.string().length(64) }),
  output: z.object({ signedAt: z.string() }),
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const g = found(await ctx.db.selectFrom('agreements').selectAll().where('id', '=', input.agreementId).executeTakeFirst(), 'agreement');
    if (g.status !== 'sent') throw new DomainError('conflict', g.status === 'signed' || g.status === 'countersigned' ? 'This agreement is already signed.' : 'This agreement is not ready to sign.');
    if (g.document_hash !== input.documentHash) throw new DomainError('precondition_failed', 'The agreement changed since you opened it. Reload and review it again.');
    const at = ctx.now().toISOString();
    await ctx.db
      .insertInto('signatures')
      .values({ workspace_id: g.workspace_id, agreement_id: g.id, signer_id: uid(ctx), signer_role: 'grantee', typed_name: input.typedName, attestation: ATTESTATION, signed_at: at, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null, document_hash: g.document_hash })
      .execute();
    await ctx.db.updateTable('agreements').set({ status: 'signed' }).where('id', '=', g.id).execute();
    ctx.audit({ entityType: 'agreement', entityId: g.id, before: { status: 'sent' }, after: { status: 'signed', typedName: input.typedName, documentHash: g.document_hash } });
    ctx.emit('agreement.signed', { type: 'agreement', id: g.id }, { awardId: g.award_id });
    return { signedAt: at };
  },
});

export const countersignAgreement = defineAction({
  id: 'agreements.countersign',
  title: 'Countersign the agreement',
  description: 'Countersigns a grantee-signed agreement for the foundation. Clears “Agreement pending” and starts payee onboarding. People only (R3).',
  input: z.object({ agreementId: uuid, typedName: z.string().trim().min(2).max(200), agree: z.literal(true) }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const g = found(await ctx.db.selectFrom('agreements').selectAll().where('id', '=', input.agreementId).executeTakeFirst(), 'agreement');
    if (g.status !== 'signed') throw new DomainError('conflict', 'The grantee has not signed yet.');
    await ctx.db
      .insertInto('signatures')
      .values({ workspace_id: g.workspace_id, agreement_id: g.id, signer_id: uid(ctx), signer_role: 'foundation', typed_name: input.typedName, attestation: 'Countersigned for the foundation.', ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null, document_hash: g.document_hash! })
      .execute();
    await ctx.db.updateTable('agreements').set({ status: 'countersigned' }).where('id', '=', g.id).execute();
    await ctx.db.updateTable('awards').set({ agreement_pending: false }).where('id', '=', g.award_id).execute();
    ctx.audit({ entityType: 'agreement', entityId: g.id, before: { status: 'signed' }, after: { status: 'countersigned' } });
    ctx.emit('agreement.countersigned', { type: 'agreement', id: g.id }, { awardId: g.award_id });
    return { ok: true as const };
  },
});

// Board dockets & votes ---------------------------------------------------------------------------------
export const createDocket = defineAction({
  id: 'board.create_docket',
  title: 'Create a board docket',
  description: 'Creates a board docket for a meeting; optionally auto-assembles it from pending approve recommendations.',
  input: z.object({ name: z.string().trim().min(1).max(200), meetingAt: z.string().nullable().optional(), quorum: z.number().int().min(1).max(50).default(3), autoAssemble: z.boolean().default(true), opportunityId: uuid.optional() }),
  output: z.object({ id: z.string().uuid(), items: z.number() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const d = await ctx.db
      .insertInto('dockets')
      .values({ workspace_id: w.id, name: input.name, meeting_at: input.meetingAt ? new Date(input.meetingAt).toISOString() : null, quorum: input.quorum, status: 'draft', created_by: uid(ctx) })
      .returning('id')
      .executeTakeFirstOrThrow();
    let items = 0;
    if (input.autoAssemble) {
      let q = ctx.db
        .selectFrom('decisions as dc')
        .innerJoin('applications as a', 'a.id', 'dc.application_id')
        .select(['dc.application_id', 'dc.recommended_amount_cents', 'dc.reason'])
        .where('dc.workspace_id', '=', w.id)
        .where('dc.is_final', '=', false)
        .where('dc.outcome', '=', 'approve')
        .where('a.status', 'in', ['submitted', 'under_review', 'invited_to_next_stage'])
        .where('dc.application_id', 'not in', (eb) => eb.selectFrom('docket_items').select('application_id'))
        .distinctOn('dc.application_id')
        .orderBy('dc.application_id')
        .orderBy('dc.recorded_at', 'desc');
      if (input.opportunityId) q = q.where('a.opportunity_id', '=', input.opportunityId);
      const recs = await q.execute();
      if (recs.length) {
        await ctx.db
          .insertInto('docket_items')
          .values(recs.map((r, i) => ({ workspace_id: w.id, docket_id: d.id, application_id: r.application_id, position: i + 1, recommended_amount_cents: r.recommended_amount_cents, recommendation: r.reason })))
          .execute();
      }
      items = recs.length;
    }
    ctx.audit({ entityType: 'docket', entityId: d.id, after: { name: input.name, items } });
    return { id: d.id, items };
  },
});

export const setDocketStatus = defineAction({
  id: 'board.set_docket_status',
  title: 'Publish, open or close a docket',
  description: 'Publishes a docket to the board, opens voting (in session), or closes it and tallies outcomes against the quorum.',
  input: z.object({ docketId: uuid, status: z.enum(['published', 'in_session', 'closed']) }),
  output: z.object({ outcomes: z.array(z.object({ applicationId: z.string(), outcome: z.string(), approve: z.number(), decline: z.number(), abstain: z.number() })) }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const d = found(await ctx.db.selectFrom('dockets').selectAll().where('id', '=', input.docketId).executeTakeFirst(), 'docket');
    const order = ['draft', 'published', 'in_session', 'closed'];
    if (order.indexOf(input.status) <= order.indexOf(d.status)) throw new DomainError('invalid_transition', `This docket is already ${d.status.replace('_', ' ')}.`);
    await ctx.db.updateTable('dockets').set({ status: input.status }).where('id', '=', d.id).execute();
    const outcomes: { applicationId: string; outcome: string; approve: number; decline: number; abstain: number }[] = [];
    if (input.status === 'closed') {
      const items = await ctx.db.selectFrom('docket_items').selectAll().where('docket_id', '=', d.id).execute();
      for (const it of items) {
        const votes = await ctx.db.selectFrom('votes').select('vote').where('docket_item_id', '=', it.id).execute();
        const approve = votes.filter((v) => v.vote === 'approve').length;
        const decline = votes.filter((v) => v.vote === 'decline').length;
        const abstain = votes.filter((v) => v.vote === 'abstain').length;
        const present = approve + decline + abstain;
        const outcome = present < d.quorum ? 'no_quorum' : approve > decline ? 'approved' : decline > approve ? 'declined' : 'deferred';
        await ctx.db.updateTable('docket_items').set({ outcome }).where('id', '=', it.id).execute();
        outcomes.push({ applicationId: it.application_id, outcome, approve, decline, abstain });
      }
    }
    ctx.audit({ entityType: 'docket', entityId: d.id, before: { status: d.status }, after: { status: input.status, outcomes } });
    ctx.emit(`docket.${input.status}`, { type: 'docket', id: d.id }, { outcomes });
    return { outcomes };
  },
});

export const castVote = defineAction({
  id: 'board.vote',
  title: 'Cast a vote',
  description: 'Records a board member’s vote on a docket item (approve, decline, abstain, or recuse). The time and voter are recorded. People only (R3).',
  input: z.object({ docketItemId: uuid, vote: z.enum(['approve', 'decline', 'abstain', 'recuse']) }),
  output: z.object({ recordedAt: z.string() }),
  scopes: [],
  roles: ['board'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('votes')
      .values({ workspace_id: w.id, docket_item_id: input.docketItemId, voter_id: uid(ctx), vote: input.vote })
      .onConflict((oc) => oc.columns(['docket_item_id', 'voter_id']).doUpdateSet({ vote: input.vote, recorded_at: sql`clock_timestamp()` }))
      .returning('recorded_at')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'docket_item', entityId: input.docketItemId, action: 'board.vote', after: { vote: input.vote } });
    return { recordedAt: r.recorded_at };
  },
});

export function agreementAttestation(): string {
  return ATTESTATION;
}

export function hashBytes(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}
