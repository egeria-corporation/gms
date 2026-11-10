// SPDX-License-Identifier: AGPL-3.0-only
// Decisions (build spec §10.5 allocator, §11.5): propose in the panel, then commit. Committing an
// approval creates the award in `offered` with its agreement draft, payment schedule and
// requirements from the program's defaults, and queues the letter. Over-allocating the program is
// refused unless a workspace admin overrides with a reason, which is ledgered.
import { allocation, checkCommit, type Allocation } from "@gms/review";
import type { ApplicationStatus } from "@gms/workflow";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { draftAgreement, awardFields } from "./agreements.ts";
import { passportFacts, primaryEmail, sendLetter, transitionApp, type App } from "./apply.ts";
import { STAFF_ROLES, createOfferedAward, emitFor, fundingOf, humanOnly, minorOf, readDefaults, type Award } from "./awards.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { Row } from "./repos/types.ts";

type Decision = Row<"decisions">;
const OUTCOMES = ["approve", "decline", "waitlist", "defer"] as const;
/** Awards that still count against a program's budget: everything that was not cancelled. */
const COMMITTED: readonly string[] = ["offered", "accepted", "active", "suspended", "completed"];

const view = (d: Decision) => ({
  id: d.id,
  competitionId: apiId("competition", d.competition_id),
  applicationId: apiId("application", d.application_id),
  stage: d.stage,
  outcome: d.outcome,
  amountMinor: d.amount_minor,
  currency: d.currency,
  conditions: d.conditions,
  rationale: d.rationale,
  letterTemplateId: d.letter_template_id,
  proposedBy: d.proposed_by,
  decidedBy: d.decided_by,
  committedAt: d.committed_at,
  createdAt: d.created_at,
});

async function competitionOf(ctx: ServiceContext, ws: ServiceWorkspace, competitionId: string) {
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionId, workspace_id: ws.id }), "Competition");
  const opportunity = required(await ctx.repos.table("opportunities").one({ id: competition.opportunity_id }), "Opportunity");
  const program = opportunity.program_id ? await ctx.repos.table("programs").one({ id: opportunity.program_id }) : null;
  return { competition, opportunity, program };
}

export interface AllocationView {
  programId: string | null;
  currency: string;
  /** Null when the program has no budget set: nothing can be over-allocated, and the meter says so. */
  budgetMinor: number | null;
  committedMinor: number;
  /** Approvals proposed in this competition and not yet committed. */
  proposedMinor: number;
  availableMinor: number | null;
  over: boolean;
  overByMinor: number;
}

async function committedMinor(ctx: ServiceContext, ws: ServiceWorkspace, programId: string | null): Promise<number> {
  if (!programId) return 0;
  const awards = await ctx.repos.table("awards").find({ workspace_id: ws.id, program_id: programId, status: [...COMMITTED] }, { limit: 5000 });
  return awards.reduce((s, a) => s + (minorOf(fundingOf(a).awardedAmount) ?? 0), 0);
}

function meter(program: Row<"programs"> | null, committed: number, proposed: number): AllocationView {
  const currency = program?.currency ?? "USD";
  if (!program || program.budget_amount_minor === null) return { programId: program?.id ?? null, currency, budgetMinor: null, committedMinor: committed, proposedMinor: proposed, availableMinor: null, over: false, overByMinor: 0 };
  const a: Allocation = allocation({ budgetMinor: program.budget_amount_minor, committedMinor: committed, proposedMinor: proposed });
  return { programId: program.id, currency, budgetMinor: a.budgetMinor, committedMinor: a.committedMinor, proposedMinor: a.proposedMinor, availableMinor: a.availableMinor, over: a.over, overByMinor: a.overByMinor };
}

const approvals = (ds: readonly Decision[]) => ds.reduce((s, d) => s + (d.outcome === "approve" ? (d.amount_minor ?? 0) : 0), 0);

/** `GET /competitions/{id}/allocation`: the allocator meter for the panel's sticky header. */
export async function getAllocation(ctx: ServiceContext, competitionId: string): Promise<AllocationView> {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: [...STAFF_ROLES, "finance", "observer", "auditor"] });
  const { competition, program } = await competitionOf(ctx, ws, competitionId);
  const open = await ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id, committed_at: null });
  return meter(program, await committedMinor(ctx, ws, program?.id ?? null), approvals(open));
}

export const proposeInput = z
  .object({
    competitionId: z.string(),
    decisions: z
      .array(
        z
          .object({
            applicationId: z.string(),
            outcome: z.enum(OUTCOMES),
            amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
            conditions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
            rationale: z.string().trim().max(5000).optional(),
            letterTemplateId: z.uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export interface ProposedDecision {
  applicationUuid: string;
  outcome: (typeof OUTCOMES)[number];
  amountMinor?: number;
  conditions: string[];
  rationale?: string;
  letterTemplateId?: string;
}

/** Record proposals (not decisions yet). A new proposal for an application replaces its uncommitted one. */
export async function proposeDecisions(ctx: ServiceContext, competitionId: string, proposals: ProposedDecision[]) {
  const ws = await authorize(ctx, { scope: "decisions:write", kind: "funder", roles: STAFF_ROLES });
  const { competition, program } = await competitionOf(ctx, ws, competitionId);
  const out: Decision[] = [];
  for (const p of proposals) {
    const app = required(await ctx.repos.table("applications").one({ id: p.applicationUuid, workspace_id: ws.id, competition_id: competition.id }), "Application");
    if (!app.submitted_at) required(null, "Application");
    if (p.outcome === "approve" && !p.amountMinor) throw new ApiError(422, "amount_required", `An approval needs an amount (${app.title})`, [{ code: "invalid_field", field: "amountMinor" }]);
    const committed = (await ctx.repos.table("decisions").find({ application_id: app.id, stage: app.stage }, { notNull: ["committed_at"] })).filter((d) => d.outcome !== "defer" && d.outcome !== "waitlist");
    if (committed.length) throw new ApiError(409, "already_decided", `${app.title} already has a committed decision for this stage`);
    await ctx.repos.table("decisions").remove({ application_id: app.id, stage: app.stage, committed_at: null });
    out.push(await ctx.repos.table("decisions").insert({ workspace_id: ws.id, competition_id: competition.id, application_id: app.id, stage: app.stage, outcome: p.outcome, amount_minor: p.outcome === "approve" ? p.amountMinor! : null, currency: app.currency ?? program?.currency ?? "USD", conditions: p.conditions, rationale: p.rationale ?? null, letter_template_id: p.letterTemplateId ?? null, proposed_by: ctx.actor.id }));
  }
  await audit(ctx, "decisions.proposed", "competition", competition.id, { count: out.length, approvals: out.filter((d) => d.outcome === "approve").length });
  const open = await ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id, committed_at: null });
  return { decisions: out.map(view), allocation: meter(program, await committedMinor(ctx, ws, program?.id ?? null), approvals(open)) };
}

export async function listDecisions(ctx: ServiceContext, f: { competitionId?: string; applicationId?: string; committed?: boolean } = {}) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: [...STAFF_ROLES, "finance", "observer", "auditor"] });
  const rows = await ctx.repos.table("decisions").find({ workspace_id: ws.id, ...(f.competitionId ? { competition_id: f.competitionId } : {}), ...(f.applicationId ? { application_id: f.applicationId } : {}) }, { orderBy: "created_at", ascending: false, limit: 5000 });
  return rows.filter((d) => f.committed === undefined || (d.committed_at !== null) === f.committed).map(view);
}

export const commitInput = z
  .object({
    competitionId: z.string(),
    decisionIds: z.array(z.uuid()).min(1).max(200),
    /** A workspace admin may commit past the program's budget by giving a reason; it is ledgered. */
    override: z.object({ reason: z.string().trim().min(1).max(2000) }).strict().optional(),
  })
  .strict();

/** A proposal to approve is the recommendation: bring the application to `recommended` first. */
async function recommend(ctx: ServiceContext, app: App): Promise<App> {
  let a = app;
  if (a.status === "submitted" || a.status === "screening") a = await transitionApp(ctx, a, "start_review", "funder", {});
  if (a.status === "under_review" || a.status === "interview") a = await transitionApp(ctx, a, "recommend", "funder", {});
  return a;
}

/**
 * Commit proposals. Checked against the allocator first, as one batch; then each decision is
 * applied on its own, so one application that changed underneath does not undo the others.
 */
export async function commitDecisions(ctx: ServiceContext, competitionId: string, input: { decisionIds: string[]; override?: { reason: string } }) {
  const ws = await authorize(ctx, { scope: "decisions:write", kind: "funder", roles: STAFF_ROLES, person: true });
  // A human gate (§10.9): an agent proposes, and its commit runs only after a person approves it in the GMS.
  if (ctx.actor.kind !== "user") throw humanOnly("Committing decisions");
  const { competition, opportunity, program } = await competitionOf(ctx, ws, competitionId);
  const ids = [...new Set(input.decisionIds)];
  const decisions = await ctx.repos.table("decisions").find({ id: ids, workspace_id: ws.id, competition_id: competition.id });
  if (decisions.length !== ids.length) required(null, "Decision");
  const already = decisions.filter((d) => d.committed_at);
  if (already.length) throw new ApiError(409, "already_committed", `${already.length} of these decisions are already committed`);

  // The allocator: budget − committed awards − the approvals in this commit.
  const committed = await committedMinor(ctx, ws, program?.id ?? null);
  let overridden: { by: string; reason: string; overByMinor: number } | null = null;
  if (program && program.budget_amount_minor !== null) {
    const check = checkCommit({ budgetMinor: program.budget_amount_minor, committedMinor: committed, proposedMinor: approvals(decisions) }, input.override ? { role: ws.role ?? "", userId: ctx.actor.userId!, reason: input.override.reason } : null);
    if (!check.ok) throw new ApiError(409, "over_allocation", check.reason, [{ code: "over_allocation", field: "decisionIds", detail: `Over by ${check.allocation.overByMinor} ${program.currency} minor units` }]);
    overridden = check.override;
    if (overridden) await audit(ctx, "decision.allocation_override", "competition", competition.id, { programId: program.id, by: overridden.by, reason: overridden.reason, overByMinor: overridden.overByMinor });
  }

  const defaults = readDefaults(program);
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const at = ctx.now().toISOString();
  const results: { decisionId: string; applicationId: string; outcome: string; ok: boolean; awardId?: string; agreementId?: string; letterSent?: boolean; message?: string }[] = [];
  for (const d of decisions) {
    const base = { decisionId: d.id, applicationId: apiId("application", d.application_id), outcome: d.outcome };
    try {
      let app = required(await ctx.repos.table("applications").one({ id: d.application_id }), "Application");
      const applicant = required(await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }), "Applicant");
      const email = primaryEmail(passportFacts(applicant).org);
      const letterBase = { recipient: { name: applicant.display_name }, funder: { name: funder.display_name }, application: { title: app.title }, opportunity: { title: opportunity.title }, links: { application: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/${apiId("application", app.id)}/edit`, status: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/${apiId("application", app.id)}` } };
      let award: Award | null = null;
      let agreementId: string | undefined;
      let letter: { sent: boolean } = { sent: false };
      if (d.outcome === "approve") {
        app = await recommend(ctx, app);
        app = await transitionApp(ctx, app, "accept", "funder", { decisionId: d.id }, { amountMinor: d.amount_minor });
        award = await createOfferedAward(ctx, { workspaceId: ws.id, recipientWorkspaceId: app.applicant_workspace_id, applicationId: app.id, opportunityId: app.opportunity_id, programId: program?.id ?? null, title: app.title, awardedMinor: d.amount_minor!, requestedMinor: app.requested_amount_minor, currency: d.currency, conditions: d.conditions }, defaults);
        const draft = defaults.noAgreementRequired ? null : await draftAgreement(ctx, award, null);
        agreementId = draft ? apiId("agreement", draft.id) : undefined;
        letter = await sendLetter(ctx, "award_agreement", email, (await awardFields(ctx, award)).fields, { type: "award", id: award.id, workspaceId: ws.id });
      } else if (d.outcome === "decline") {
        app = await transitionApp(ctx, app, "decline", "funder", { decisionId: d.id }, { rationale: d.rationale });
        letter = await sendLetter(ctx, "decline", email, { ...letterBase, decision: { message: d.rationale ?? "" } }, { type: "application", id: app.id, workspaceId: ws.id });
      } else if (d.outcome === "waitlist") {
        app = await recommend(ctx, app);
        app = await transitionApp(ctx, app, "waitlist", "funder", { decisionId: d.id });
      }
      // `defer` records the panel's choice and leaves the application where it is.
      await ctx.repos.table("decisions").update({ id: d.id, committed_at: null }, { committed_at: at, decided_by: ctx.actor.userId });
      await audit(ctx, "decision.committed", "decision", d.id, { applicationId: d.application_id, outcome: d.outcome, amountMinor: d.amount_minor, awardId: award?.id ?? null });
      await emitFor(ctx, ws.id, "decision.committed", { decisionId: d.id, applicationId: d.application_id, outcome: d.outcome, awardId: award?.id ?? null });
      results.push({ ...base, ok: true, ...(award ? { awardId: apiId("award", award.id) } : {}), ...(agreementId ? { agreementId } : {}), letterSent: letter.sent });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      results.push({ ...base, ok: false, message: e.message });
    }
  }
  const done = results.filter((r) => r.ok);
  await audit(ctx, "decisions.committed", "competition", competition.id, { requested: decisions.length, committed: done.length, awards: done.filter((r) => r.awardId).length, lettersSent: done.filter((r) => r.letterSent).length });
  const open = await ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id, committed_at: null });
  return { committed: done.length, failed: results.length - done.length, results, override: overridden, allocation: meter(program, await committedMinor(ctx, ws, program?.id ?? null), approvals(open)) };
}

export const awardFromApplicationInput = z
  .object({ applicationId: z.string(), amountMinor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/).default("USD"), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), conditions: z.array(z.string().trim().min(1).max(500)).max(20).default([]) })
  .strict()
  .refine((i) => !!i.startDate === !!i.endDate, { path: ["endDate"], message: "Give both the start and the end of the grant period, or neither" });

/** Create an award for an application that was accepted without one (e.g. an imported decision). */
export async function createAwardFromApplication(ctx: ServiceContext, applicationUuid: string, input: Omit<z.output<typeof awardFromApplicationInput>, "applicationId">) {
  const ws = await authorize(ctx, { scope: "awards:write", kind: "funder", roles: STAFF_ROLES });
  const app = required(await ctx.repos.table("applications").one({ id: applicationUuid, workspace_id: ws.id }), "Application");
  if (app.status !== ("accepted" satisfies ApplicationStatus)) throw new ApiError(409, "not_accepted", "Only an accepted application can get an award. Commit an approval for it first");
  if (await ctx.repos.table("awards").one({ application_id: app.id, parent_award_id: null })) throw new ApiError(409, "award_exists", "This application already has an award");
  const { program } = await competitionOf(ctx, ws, app.competition_id);
  const defaults = readDefaults(program);
  const award = await createOfferedAward(ctx, { workspaceId: ws.id, recipientWorkspaceId: app.applicant_workspace_id, applicationId: app.id, opportunityId: app.opportunity_id, programId: program?.id ?? null, title: app.title, awardedMinor: input.amountMinor, requestedMinor: app.requested_amount_minor, currency: input.currency, conditions: input.conditions, ...(input.startDate && input.endDate ? { period: { startDate: input.startDate, endDate: input.endDate } } : {}) }, defaults);
  const draft = defaults.noAgreementRequired ? null : await draftAgreement(ctx, award, null);
  return { awardId: apiId("award", award.id), agreementId: draft ? apiId("agreement", draft.id) : null, status: award.status };
}
