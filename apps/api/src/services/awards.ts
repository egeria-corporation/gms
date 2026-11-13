// SPDX-License-Identifier: AGPL-3.0-only
// Awards (build spec §10.1, §10.6, §11.5): the lifecycle lives here, the money lives in Passport.
// Status changes go through the award machine; `funding.disbursedAmount` is only ever the value
// last read from Passport, never a sum computed in the GMS.
import type { FunderAwardInput } from "@gms/passport-client";
import { buildSchedule, DEFAULT_PLAN, ScheduleError, type PlanItem } from "@gms/payments";
import { filtered, matchesFilter, parseSearchRequest, projectAward, ProjectionError, readPath, sortByPath, toMinor, toMoney, type AwardBase, type AwardRow, type Money } from "@gms/protocol";
import { awardCgStatus, awardEffects, awardMachine, NO_AGREEMENT_REQUIRED, trancheMachine, type AgreementStatus, type AwardAction, type AwardContext, type AwardStatus, type TrancheStatus } from "@gms/workflow";
import { fanOut, isWebhookEventType } from "@gms/webhooks";
import { DEFAULT_REMINDER_PLAN } from "@gms/notify";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { apiId } from "../lib/ids.ts";
import { invitationView, type AwardInvitation } from "./award-invitations.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { checkSigner, payoutDestinationFor } from "./organization.ts";
import { passportClientFor } from "./passport-link.ts";
import type { PageRequest } from "./programs.ts";
import { namesOf, namesShared, sharesWith, shownHoldReason, verificationShared } from "./profile.ts";
import type { Insert, Row } from "./repos/types.ts";

export type Award = Row<"awards">;
export type Agreement = Row<"agreements">;
export type Tranche = Row<"tranches">;
type Ws = Row<"workspaces">;
type Funding = { requestedAmount?: Money; awardedAmount?: Money; disbursedAmount?: Money };
type KeyDates = { awardDate?: { date?: string }; periodOfPerformance?: { startDate?: string; endDate?: string } };

export const STAFF_ROLES = ["admin", "program_officer"] as const;
const OPEN_TRANCHES: readonly string[] = ["scheduled", "due", "ready", "held", "releasing", "initiated"];

export const fundingOf = (a: Award): Funding => (a.funding as Funding | null) ?? {};
export const keyDatesOf = (a: Award): KeyDates => (a.key_dates as KeyDates | null) ?? {};
export const minorOf = (m: Money | undefined): number | null => (m ? toMinor(m) : null);
export const currencyOf = (a: Award): string => fundingOf(a).awardedAmount?.currency ?? "USD";

/** `USD 150,000.00`: how amounts are printed in letters and agreements. */
export function printMoney(minor: number, currency: string): string {
  const [whole, cents] = toMoney(minor, currency).amount.split(".");
  return `${currency} ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents ? `.${cents}` : ""}`;
}

/** Webhooks and the ledger for an award belong to the funder's workspace, whichever side acted. */
export async function emitFor(ctx: ServiceContext, workspaceId: string, type: string, data: Record<string, unknown>): Promise<void> {
  if (!isWebhookEventType(type)) return;
  await fanOut({ id: crypto.randomUUID(), type, workspaceId, occurredAt: ctx.now().toISOString(), data }, { store: ctx.webhooks, now: ctx.now });
}

/** Ports for the award, agreement and tranche machines, writing each subject to its own table. */
export function grantPorts(ctx: ServiceContext, workspaceId: string) {
  const lost = () => new ApiError(409, "conflict", "This record changed while you were working. Reload and try again");
  return {
    write: async (c: { subjectType: string; subjectId: string; from: string; to: string; patch: Record<string, unknown> }) => {
      if (c.subjectType === "award") {
        const [row] = await ctx.repos.table("awards").update({ id: c.subjectId, status: c.from }, { status: c.to, cg_status: awardCgStatus(c.to as AwardStatus).value });
        if (!row) throw lost();
      } else if (c.subjectType === "agreement") {
        const p = c.patch as { document_sha256?: string; grantee_signature?: unknown; funder_signature?: unknown; executed_at?: string | null };
        const [row] = await ctx.repos.table("agreements").update({ id: c.subjectId, status: c.from }, {
          status: c.to,
          ...(p.document_sha256 ? { document_sha256: p.document_sha256 } : {}),
          ...(p.grantee_signature ? { grantee_signature: p.grantee_signature as Agreement["grantee_signature"] } : {}),
          ...(p.funder_signature ? { funder_signature: p.funder_signature as Agreement["funder_signature"] } : {}),
          ...(p.executed_at ? { executed_at: p.executed_at } : {}),
        });
        if (!row) throw lost();
      } else if (c.subjectType === "tranche") {
        const p = c.patch as { due_at?: string | null; hold_reason?: string | null };
        const [row] = await ctx.repos.table("tranches").update({ id: c.subjectId, status: c.from }, { status: c.to, ...(p.due_at ? { due_at: p.due_at } : {}), ...("hold_reason" in p ? { hold_reason: p.hold_reason ?? null } : {}) });
        if (!row) throw lost();
      } else throw new Error(`grantPorts cannot write a ${c.subjectType}`);
    },
    ledger: (e: { eventType: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => audit(ctx, e.eventType, e.subjectType, e.subjectId, e.data, workspaceId),
    emit: (e: { type: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => emitFor(ctx, workspaceId, e.type, { subjectType: e.subjectType, subjectId: e.subjectId, ...e.data }),
  };
}

export async function transitionAward(ctx: ServiceContext, award: Award, action: AwardAction, side: "applicant" | "funder", machineCtx: AwardContext = {}): Promise<Award> {
  const r = await awardMachine.transition({ id: award.id, status: award.status as AwardStatus }, action, { id: ctx.actor.id, kind: side }, { ...machineCtx, now: ctx.now().toISOString() }, grantPorts(ctx, award.workspace_id));
  if (!r.ok) throw new ApiError(r.code === "actor_not_allowed" ? 403 : 409, r.code, r.reason);
  return required(await ctx.repos.table("awards").one({ id: award.id }), "Award");
}

/** Who may see an award, and from which side. 404 for everyone else. */
export async function accessAward(ctx: ServiceContext, awardId: string, scope: "awards:read" | "awards:write" | "agreements:write"): Promise<{ award: Award; side: "funder" | "recipient"; ws: ServiceWorkspace }> {
  const ws = await authorize(ctx, { scope });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  if (award && award.workspace_id === ws.id && ws.kind === "funder") return { award, side: "funder", ws };
  if (award && award.recipient_workspace_id === ws.id && ws.kind === "applicant") return { award, side: "recipient", ws };
  throw notFound("Award");
}

/** The award's newest agreement. Only the award's own workspace can hold one: a row elsewhere that names this award is not its agreement. */
export const latestAgreement = async (ctx: ServiceContext, award: Pick<Award, "id" | "workspace_id">): Promise<Agreement | null> => (await ctx.repos.table("agreements").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "version", ascending: false, limit: 1 }))[0] ?? null;

export const agreementSummary = (g: Agreement) => ({
  id: apiId("agreement", g.id),
  version: g.version,
  status: g.status,
  documentSha256: g.document_sha256,
  granteeSignedAt: (g.grantee_signature as { at?: string } | null)?.at ?? null,
  funderSignedAt: (g.funder_signature as { at?: string } | null)?.at ?? null,
  executedAt: g.executed_at,
});

const trancheView = (t: Tranche) => ({ id: apiId("tranche", t.id), seq: t.seq, amountMinor: t.amount_minor, currency: t.currency, condition: t.condition, status: t.status, dueAt: t.due_at, holdReason: t.hold_reason, mode: t.mode, passportStatus: t.passport_status, releasedAt: t.released_at });
const requirementView = (r: Row<"requirements">) => ({ id: apiId("requirement", r.id), type: r.type, title: r.title, formId: r.form_id ? apiId("form", r.form_id) : null, dueAt: r.due_at, status: r.status, releasesTrancheId: r.releases_tranche_id ? apiId("tranche", r.releases_tranche_id) : null });
const amendmentView = (m: Row<"amendments">) => ({ id: m.id, awardId: apiId("award", m.award_id), type: m.type, request: m.request, status: m.status, requestedBy: m.requested_by, decidedBy: m.decided_by, decidedAt: m.decided_at, childAwardId: m.child_award_id ? apiId("award", m.child_award_id) : null, createdAt: m.created_at });

function mirrorState(ctx: ServiceContext, a: Award): "synced" | "pending" | "not_applicable" | "disabled" {
  if (a.passport_award_id) return "synced";
  if (a.status === "offered" || a.status === "cancelled" || !a.recipient_workspace_id) return "not_applicable";
  return ctx.config.passportAwardWrite ? "pending" : "disabled";
}

/**
 * The recipient as a view shows it. A direct award not yet accepted names the organization as the
 * funder typed it, with no workspace and no organization data (there is none), and its invitation.
 */
function recipientView(ctx: ServiceContext, a: Award, recipient: Ws | undefined, consented: boolean, inv: AwardInvitation | undefined) {
  const invitation = inv ? { invitation: invitationView(inv, ctx.now()) } : {};
  if (a.recipient_workspace_id) {
    return { workspaceId: a.recipient_workspace_id, name: recipient ? namesShared(recipient, consented).name : null, workspaceName: recipient ? namesShared(recipient, consented).workspaceName : null, handle: recipient?.handle ?? null, level: verificationShared(recipient, consented).level, verification: verificationShared(recipient, consented), ...invitation };
  }
  return inv ? { workspaceId: null, name: inv.organization_name, workspaceName: null, handle: null, level: null, verification: null, ...invitation } : null;
}

function summary(ctx: ServiceContext, a: Award, funder: Ws | undefined, recipient: Ws | undefined, consented: boolean, inv?: AwardInvitation) {
  const f = fundingOf(a);
  return {
    id: apiId("award", a.id),
    title: a.title,
    description: a.description,
    status: a.status,
    currency: currencyOf(a),
    requestedAmountMinor: minorOf(f.requestedAmount),
    awardedAmountMinor: minorOf(f.awardedAmount),
    // The cached Passport value and when it was read. Null until Passport has reported one.
    disbursedAmountMinor: minorOf(f.disbursedAmount),
    disbursedAt: a.disbursed_at,
    keyDates: keyDatesOf(a),
    conditions: a.conditions,
    applicationId: a.application_id ? apiId("application", a.application_id) : null,
    opportunityId: a.opportunity_id ? apiId("opportunity", a.opportunity_id) : null,
    programId: a.program_id,
    parentAwardId: a.parent_award_id ? apiId("award", a.parent_award_id) : null,
    funder: { workspaceId: a.workspace_id, name: funder?.display_name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? null },
    recipient: recipientView(ctx, a, recipient, consented, inv),
    recipientIndividual: a.recipient_individual,
    passport: { awardId: a.passport_award_id, syncedAt: a.passport_synced_at, mirror: mirrorState(ctx, a) },
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

async function parties(ctx: ServiceContext, awards: Award[]) {
  const ids = [...new Set(awards.flatMap((a) => [a.workspace_id, ...(a.recipient_workspace_id ? [a.recipient_workspace_id] : [])]))];
  const rows = ids.length ? await ctx.repos.table("workspaces").find({ id: ids }) : [];
  const consents = ids.length ? await ctx.repos.table("consents").find({ applicant_workspace_id: ids, revoked_at: null }) : [];
  const invitations = awards.length ? await ctx.repos.table("award_invitations").find({ award_id: awards.map((a) => a.id) }) : [];
  return {
    ws: (id: string | null) => rows.find((w) => w.id === id),
    consented: (a: Award) => consents.some((c) => c.applicant_workspace_id === a.recipient_workspace_id && c.funder_workspace_id === a.workspace_id),
    // An invitation is the award's only when both sit in the same workspace (0020).
    invitation: (a: Award) => invitations.find((i) => i.award_id === a.id && i.workspace_id === a.workspace_id),
  };
}

export async function awardDetail(ctx: ServiceContext, a: Award) {
  const p = await parties(ctx, [a]);
  const [agreement, tranches, requirements, amendments] = await Promise.all([
    latestAgreement(ctx, a),
    ctx.repos.table("tranches").find({ award_id: a.id, workspace_id: a.workspace_id }, { orderBy: "seq" }),
    ctx.repos.table("requirements").find({ award_id: a.id, workspace_id: a.workspace_id }, { orderBy: "due_at" }),
    ctx.repos.table("amendments").find({ award_id: a.id, workspace_id: a.workspace_id }, { orderBy: "created_at" }),
  ]);
  // The recipient reads its own hold reasons; the funder, a payee fact only while the record is shared.
  const shared = ctx.workspace?.id === a.recipient_workspace_id || !a.recipient_workspace_id || p.consented(a);
  return { ...summary(ctx, a, p.ws(a.workspace_id), p.ws(a.recipient_workspace_id), p.consented(a), p.invitation(a)), agreement: agreement ? agreementSummary(agreement) : null, tranches: tranches.map((t) => ({ ...trancheView(t), holdReason: shownHoldReason(t.hold_reason, shared) })), requirements: requirements.map(requirementView), amendments: amendments.map(amendmentView) };
}

export interface AwardFilter {
  status?: string;
  programId?: string;
  recipientWorkspaceId?: string;
}

async function listFor(ctx: ServiceContext, page: PageRequest, rows: Award[], f: AwardFilter) {
  const hits = rows.filter((a) => (!f.status || f.status.split(",").includes(a.status)) && (!f.programId || a.program_id === f.programId) && (!f.recipientWorkspaceId || a.recipient_workspace_id === f.recipientWorkspaceId)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  const slice = hits.slice(page.offset, page.offset + page.pageSize);
  const p = await parties(ctx, slice);
  return { items: slice.map((a) => summary(ctx, a, p.ws(a.workspace_id), p.ws(a.recipient_workspace_id), p.consented(a), p.invitation(a))), total: hits.length };
}

export async function listAwards(ctx: ServiceContext, page: PageRequest, f: AwardFilter = {}) {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "funder" });
  return listFor(ctx, page, await ctx.repos.table("awards").find({ workspace_id: ws.id }, { limit: 5000 }), f);
}

export async function listMyAwards(ctx: ServiceContext, page: PageRequest, f: AwardFilter = {}) {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "applicant" });
  return listFor(ctx, page, await ctx.repos.table("awards").find({ recipient_workspace_id: ws.id }, { limit: 5000 }), f);
}

export async function getAward(ctx: ServiceContext, awardId: string, side?: "funder" | "recipient") {
  const found = await accessAward(ctx, awardId, "awards:read");
  if (side && found.side !== side) throw notFound("Award");
  return awardDetail(ctx, found.award);
}

/**
 * The grantee's view of one grant: the detail plus where Passport would pay it (bank name and last
 * four digits, read live with the grantee's own consent; never stored by the GMS).
 */
export async function getMyAward(ctx: ServiceContext, awardId: string) {
  const found = await accessAward(ctx, awardId, "awards:read");
  if (found.side !== "recipient" || !found.award.recipient_workspace_id) throw notFound("Award");
  const [detail, payoutDestination] = await Promise.all([awardDetail(ctx, found.award), payoutDestinationFor(ctx, found.award.recipient_workspace_id)]);
  return { ...detail, payoutDestination };
}

/** `/gms/my/awards/{id}/schedule` with the destination display the Payments tab shows beside it. */
export async function getMyPayoutDestinationForAward(ctx: ServiceContext, awardId: string) {
  const found = await accessAward(ctx, awardId, "awards:read");
  if (found.side !== "recipient" || !found.award.recipient_workspace_id) throw notFound("Award");
  return payoutDestinationFor(ctx, found.award.recipient_workspace_id);
}

// ------------------------------------------------------------------------------------ creation

/** What a program sets once so every award starts the same way. All optional. */
export const programDefaults = z
  .object({
    awardPeriod: z.object({ startDate: z.iso.date(), endDate: z.iso.date() }).optional(),
    agreementTemplateId: z.uuid().optional(),
    noAgreementRequired: z.boolean().optional(),
    schedule: z
      .array(z.object({ percent: z.number().positive().max(100).optional(), amountMinor: z.number().int().positive().optional(), condition: z.object({ type: z.enum(["onExecution", "onReportAccepted", "onDate", "manual"]), date: z.string().optional(), requirementKey: z.string().optional() }) }))
      .max(24)
      .optional(),
    requirements: z
      .array(z.object({ key: z.string().max(60).optional(), type: z.enum(["report", "document", "milestone", "site_visit", "acknowledgment"]), title: z.string().min(1).max(300), formId: z.uuid().optional(), formVersion: z.number().int().positive().optional(), dueAt: z.iso.datetime({ offset: true }).optional(), dueOffsetDays: z.number().int().min(0).max(3650).optional(), graceDays: z.number().int().min(0).max(365).optional() }))
      .max(24)
      .optional(),
    reminderPlan: z.array(z.number().int()).max(12).optional(),
  })
  .loose();
export type ProgramDefaults = z.output<typeof programDefaults>;

export function readDefaults(program: Row<"programs"> | null): ProgramDefaults {
  const r = programDefaults.safeParse(program?.defaults ?? {});
  return r.success ? r.data : {};
}

export interface NewAward {
  workspaceId: string;
  /** Null only for a direct award waiting for its recipient, which `recipientIndividual` names. */
  recipientWorkspaceId: string | null;
  /** The named recipient (`{ name }`), never an email address. */
  recipientIndividual?: { name: string } | null;
  applicationId: string | null;
  opportunityId: string | null;
  programId: string | null;
  title: string;
  description?: string | null;
  awardedMinor: number;
  requestedMinor?: number | null;
  currency: string;
  conditions: string[];
  period?: { startDate?: string; endDate?: string };
  parentAwardId?: string | null;
}

/** The rows of a new offered award, with their ids, and the ledger entries that go with them. */
export interface OfferedAwardPlan {
  award: Insert<"awards"> & { id: string };
  schedule: Insert<"payment_schedules"> & { id: string };
  tranches: (Insert<"tranches"> & { id: string })[];
  requirements: (Insert<"requirements"> & { id: string })[];
  ledger: { eventType: string; subjectType: string; subjectId: string; data: Record<string, unknown> }[];
}

/**
 * Plan an award in `offered`, with its payment schedule and requirements from the program's
 * defaults. Nothing is written: `createOfferedAward` writes the plan row by row, and a direct award
 * writes it in one transaction (services/direct-awards.ts).
 */
export function planOfferedAward(ctx: ServiceContext, input: NewAward, defaults: ProgramDefaults): OfferedAwardPlan {
  const now = ctx.now();
  const period = input.period ?? defaults.awardPeriod;
  const conditions = [...new Set([...input.conditions, ...(defaults.noAgreementRequired ? [NO_AGREEMENT_REQUIRED] : [])])];
  const awardId = crypto.randomUUID();
  const award: OfferedAwardPlan["award"] = {
    id: awardId,
    workspace_id: input.workspaceId,
    recipient_workspace_id: input.recipientWorkspaceId,
    recipient_individual: (input.recipientWorkspaceId ? null : (input.recipientIndividual ?? null)) as Award["recipient_individual"],
    application_id: input.applicationId,
    opportunity_id: input.opportunityId,
    program_id: input.programId,
    parent_award_id: input.parentAwardId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: "offered",
    cg_status: awardCgStatus("offered").value,
    conditions,
    funding: { awardedAmount: toMoney(input.awardedMinor, input.currency), ...(input.requestedMinor != null ? { requestedAmount: toMoney(input.requestedMinor, input.currency) } : {}) } as unknown as Award["funding"],
    // CommonGrants `AwdTimeline`: each entry is an Event.
    key_dates: {
      awardDate: { name: "Award date", eventType: "singleDate", date: now.toISOString().slice(0, 10) },
      ...(period?.startDate && period.endDate ? { periodOfPerformance: { name: "Period of performance", eventType: "dateRange", startDate: period.startDate, endDate: period.endDate } } : {}),
    } as Award["key_dates"],
  };
  const ledger: OfferedAwardPlan["ledger"] = [];

  // Requirements are planned first: an onReportAccepted tranche names the requirement that releases it.
  const byKey = new Map<string, string>();
  const requirements: OfferedAwardPlan["requirements"] = [];
  for (const [i, r] of (defaults.requirements ?? []).entries()) {
    const base = period?.endDate && r.dueOffsetDays === undefined && !r.dueAt ? new Date(`${period.endDate}T00:00:00Z`) : null;
    const dueAt = r.dueAt ?? (r.dueOffsetDays !== undefined ? new Date(now.getTime() + r.dueOffsetDays * 86_400_000).toISOString() : (base?.toISOString() ?? null));
    const id = crypto.randomUUID();
    requirements.push({ id, workspace_id: input.workspaceId, award_id: awardId, type: r.type, title: r.title, form_id: r.formId ?? null, form_version: r.formId ? (r.formVersion ?? 1) : null, due_at: dueAt, grace_days: r.graceDays ?? 0, reminder_plan: (defaults.reminderPlan ?? [...DEFAULT_REMINDER_PLAN]) as Row<"requirements">["reminder_plan"], status: "scheduled", releases_tranche_id: null });
    byKey.set(r.key ?? String(i), id);
  }

  const plan: PlanItem[] = (defaults.schedule?.length ? defaults.schedule : DEFAULT_PLAN).map((s) => {
    const key = "requirementKey" in s.condition ? s.condition.requirementKey : undefined;
    const requirementId = key ? byKey.get(key) : undefined;
    const condition = s.condition.type === "onReportAccepted" ? { type: "onReportAccepted" as const, ...(requirementId ? { requirementId } : {}) } : s.condition.type === "onDate" ? { type: "onDate" as const, date: ("date" in s.condition ? s.condition.date : undefined) ?? "" } : { type: s.condition.type };
    return ("amountMinor" in s && s.amountMinor !== undefined ? { amountMinor: s.amountMinor, condition } : { percent: ("percent" in s ? s.percent : undefined) ?? 100, condition }) as PlanItem;
  });
  let built;
  try {
    built = buildSchedule({ awardId, awardedMinor: input.awardedMinor, currency: input.currency, plan, newId: () => crypto.randomUUID() });
  } catch (e) {
    if (!(e instanceof ScheduleError)) throw e;
    // A program default that does not fit this amount must not lose the award: fall back to one payment on execution.
    ledger.push({ eventType: "award.schedule_default_rejected", subjectType: "award", subjectId: awardId, data: { code: e.code } });
    built = buildSchedule({ awardId, awardedMinor: input.awardedMinor, currency: input.currency, plan: DEFAULT_PLAN, newId: () => crypto.randomUUID() });
  }
  const schedule: OfferedAwardPlan["schedule"] = { id: crypto.randomUUID(), workspace_id: input.workspaceId, award_id: awardId, currency: input.currency };
  const tranches = built.map((t) => {
    const releasedBy = t.condition.type === "onReportAccepted" ? t.condition.requirementId : undefined;
    const req = releasedBy ? requirements.find((r) => r.id === releasedBy) : undefined;
    if (req) req.releases_tranche_id = t.id;
    return { id: t.id, workspace_id: input.workspaceId, award_id: awardId, schedule_id: schedule.id, seq: t.seq, amount_minor: t.amountMinor, currency: t.currency, condition: t.condition as unknown as Tranche["condition"], status: "scheduled", due_at: t.dueAt, idempotency_key: `trn_${t.id}` };
  });
  ledger.push({ eventType: "award.created", subjectType: "award", subjectId: awardId, data: { applicationId: input.applicationId, awardedMinor: input.awardedMinor, currency: input.currency, tranches: tranches.length, requirements: byKey.size } });
  return { award, schedule, tranches, requirements, ledger };
}

/**
 * Create an award in `offered`, with its payment schedule and requirements from the program's
 * defaults. The agreement draft is created by the caller (services/agreements.ts).
 */
export async function createOfferedAward(ctx: ServiceContext, input: NewAward, defaults: ProgramDefaults): Promise<Award> {
  const plan = planOfferedAward(ctx, input, defaults);
  const award = await ctx.repos.table("awards").insert(plan.award);
  await ctx.repos.table("payment_schedules").insert(plan.schedule);
  for (const t of plan.tranches) await ctx.repos.table("tranches").insert(t);
  // Each requirement names the tranche it releases, which now exists.
  for (const r of plan.requirements) await ctx.repos.table("requirements").insert(r);
  for (const e of plan.ledger) await audit(ctx, e.eventType, e.subjectType, e.subjectId, e.data, input.workspaceId);
  await emitFor(ctx, input.workspaceId, "award.created", { awardId: award.id, applicationId: input.applicationId, status: "offered" });
  return award;
}

// ------------------------------------------------------------------------------------ Passport mirror

function mirrorInput(ctx: ServiceContext, a: Award, recipientOrgId: string, parentPassportId: string | null): FunderAwardInput {
  const f = fundingOf(a);
  const k = keyDatesOf(a);
  const cg = awardCgStatus(a.status as AwardStatus);
  return {
    title: a.title,
    description: a.description,
    status: { value: cg.value as "awarded" | "completed" | "cancelled", ...(cg.customValue ? { customValue: cg.customValue } : {}) },
    funding: { awardedAmount: f.awardedAmount!, ...(f.requestedAmount ? { requestedAmount: f.requestedAmount } : {}) },
    recipientOrganizations: { primary: { id: recipientOrgId } },
    ...(k.awardDate?.date || k.periodOfPerformance ? { keyDates: { ...(k.awardDate?.date ? { awardDate: { date: k.awardDate.date } } : {}), ...(k.periodOfPerformance ? { periodOfPerformance: { ...(k.periodOfPerformance.startDate ? { startDate: k.periodOfPerformance.startDate } : {}), ...(k.periodOfPerformance.endDate ? { endDate: k.periodOfPerformance.endDate } : {}) } } : {}) } } : {}),
    ...(parentPassportId ? { parent: { id: parentPassportId } } : {}),
    source: `${ctx.config.baseUrl}/common-grants/awards/${a.id}`,
    identifiers: { systemId: { registry: { code: "org:opengrants:gms" }, id: apiId("award", a.id) } },
  };
}

export type MirrorResult = { state: "synced"; passportAwardId: string } | { state: "skipped"; reason: string } | { state: "failed"; reason: string };

/**
 * Create (or, when already mirrored, patch) the award in Passport (§10.6). Never throws: an
 * accepted award stays accepted when Passport cannot be reached, and the failure is ledgered so
 * the jobs Worker retries it (`retryAwardMirrors`).
 */
export async function mirrorAward(ctx: ServiceContext, award: Award): Promise<MirrorResult> {
  if (!ctx.config.passportAwardWrite) return { state: "skipped", reason: "Mirroring awards to Passport is not enabled on this server" };
  if (!award.recipient_workspace_id) return { state: "skipped", reason: "Awards to individuals are not mirrored to Passport" };
  const [funder, recipient] = await Promise.all([ctx.repos.table("workspaces").one({ id: award.workspace_id }), ctx.repos.table("workspaces").one({ id: award.recipient_workspace_id })]);
  if (!funder?.passport_org_id) return { state: "skipped", reason: "The funder workspace is not linked to a Passport organization" };
  if (!recipient?.passport_org_id) return { state: "skipped", reason: "The recipient is not linked to a Passport organization" };
  // A new award is recorded at Passport only for an organization that shares its record with the
  // funder (review F-01): the record would otherwise give the funder standing at Passport that the
  // organization never gave it. An award already there is kept up to date.
  if (!award.passport_award_id && !(await sharesWith(ctx, award.workspace_id, recipient.id))) return { state: "skipped", reason: "The recipient does not share its record with this funder, so the award is not recorded at Passport" };
  try {
    const passport = await passportClientFor(ctx, award.workspace_id);
    if (!passport) return { state: "skipped", reason: "Connect Passport to pay: this workspace has no Passport client" };
    const parent = award.parent_award_id ? await ctx.repos.table("awards").one({ id: award.parent_award_id }) : null;
    const input = mirrorInput(ctx, award, recipient.passport_org_id, parent?.passport_award_id ?? null);
    let passportAwardId = award.passport_award_id;
    if (passportAwardId) {
      const { recipientOrganizations: _r, identifiers: _i, parent: _p, ...patch } = input;
      await passport.patchFunderAward(funder.passport_org_id, passportAwardId, patch);
    } else passportAwardId = (await passport.createFunderAward(funder.passport_org_id, input)).award.id;
    await ctx.repos.table("awards").update({ id: award.id }, { passport_award_id: passportAwardId, passport_synced_at: ctx.now().toISOString() });
    await audit(ctx, "award.mirrored", "award", award.id, { passportAwardId }, award.workspace_id);
    return { state: "synced", passportAwardId };
  } catch (e) {
    const reason = e instanceof Error ? e.name : "error";
    const code = (e as { code?: unknown } | null)?.code;
    await audit(ctx, "award.mirror_failed", "award", award.id, { error: reason, ...(typeof code === "string" ? { code } : {}) }, award.workspace_id);
    return { state: "failed", reason: "Passport could not record this award yet. It will be retried" };
  }
}

/** Job hook: mirror every accepted or active award of a workspace that Passport does not hold yet. */
export async function retryAwardMirrors(ctx: ServiceContext, workspaceId: string): Promise<{ tried: number; synced: number }> {
  const pending = (await ctx.repos.table("awards").find({ workspace_id: workspaceId, status: ["accepted", "active", "suspended"], passport_award_id: null }, { limit: 500 })).filter((a) => a.recipient_workspace_id);
  let synced = 0;
  for (const a of pending) if ((await mirrorAward(ctx, a)).state === "synced") synced++;
  return { tried: pending.length, synced };
}

// ------------------------------------------------------------------------------------ lifecycle

export const humanOnly = (what: string) => forbidden("human_only", `${what} is a human gate: it must be done by a signed-in person in the GMS, never by an agent or API client`);

/** The recipient accepts the offer. Human-only; acceptance triggers the Passport mirror. */
export const acceptOfferInput = z.object({ name: z.string().trim().min(2).max(200).optional() }).strict();

export async function acceptOffer(ctx: ServiceContext, awardId: string, input: z.output<typeof acceptOfferInput> = {}) {
  await authorize(ctx, { scope: "awards:write", kind: "applicant", roles: ["admin"], person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Accepting an award");
  const { award, side } = await accessAward(ctx, awardId, "awards:write");
  if (side !== "recipient") throw notFound("Award");
  // The typed legal name must be a verified representative when Passport lists any.
  const authority = await checkSigner(ctx, award.recipient_workspace_id!, input.name ?? null);
  const accepted = await transitionAward(ctx, award, "accept_offer", "applicant");
  await audit(ctx, "award.acceptance_signer_checked", "award", award.id, { rule: authority.rule, reason: authority.reason, representativeId: authority.representativeId, name: input.name ?? null }, award.workspace_id);
  const mirror = awardEffects("accepted").mirrorToPassport ? await mirrorAward(ctx, accepted) : null;
  const fresh = required(await ctx.repos.table("awards").one({ id: award.id }), "Award");
  return { ...(await awardDetail(ctx, fresh)), mirror, signerAuthority: authority };
}

async function funderAward(ctx: ServiceContext, awardId: string): Promise<Award> {
  await authorize(ctx, { scope: "awards:write", kind: "funder", roles: STAFF_ROLES });
  const { award, side } = await accessAward(ctx, awardId, "awards:write");
  if (side !== "funder") throw notFound("Award");
  return award;
}

const tranchesOf = (ctx: ServiceContext, award: Pick<Award, "id" | "workspace_id">) => ctx.repos.table("tranches").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "seq" });

export async function activateAward(ctx: ServiceContext, awardId: string) {
  const award = await funderAward(ctx, awardId);
  const agreement = await latestAgreement(ctx, award);
  const active = await transitionAward(ctx, award, "activate", "funder", { agreementStatus: (agreement?.status as AgreementStatus | undefined) ?? null, conditions: award.conditions });
  // No agreement to execute: the onExecution tranches become due with activation.
  if (award.conditions.includes(NO_AGREEMENT_REQUIRED)) {
    for (const t of await tranchesOf(ctx, award)) {
      if (t.status === "scheduled" && (t.condition as { type?: string }).type === "onExecution") await trancheMachine.transition({ id: t.id, status: "scheduled" }, "mark_due", { id: "system:workflow", kind: "system" }, { conditionSatisfied: true, now: ctx.now().toISOString() }, grantPorts(ctx, award.workspace_id));
    }
  }
  return awardDetail(ctx, active);
}

export const reasonInput = z.object({ reason: z.string().trim().min(1).max(5000) }).strict();

export async function suspendAward(ctx: ServiceContext, awardId: string, input: z.output<typeof reasonInput>) {
  const award = await funderAward(ctx, awardId);
  const suspended = await transitionAward(ctx, award, "suspend", "funder", { reason: input.reason });
  for (const t of await tranchesOf(ctx, award)) {
    if (t.status === "due" || t.status === "ready") await trancheMachine.transition({ id: t.id, status: t.status as TrancheStatus }, "hold", { id: ctx.actor.id, kind: "funder" }, { holdReason: `Award suspended: ${input.reason}`, now: ctx.now().toISOString() }, grantPorts(ctx, award.workspace_id));
  }
  return awardDetail(ctx, suspended);
}

export async function resumeAward(ctx: ServiceContext, awardId: string) {
  const award = await funderAward(ctx, awardId);
  const active = await transitionAward(ctx, award, "resume", "funder");
  for (const t of await tranchesOf(ctx, award)) {
    if (t.status === "held" && t.hold_reason?.startsWith("Award suspended")) await trancheMachine.transition({ id: t.id, status: "held" }, "release_hold", { id: ctx.actor.id, kind: "funder" }, { now: ctx.now().toISOString() }, grantPorts(ctx, award.workspace_id));
  }
  return awardDetail(ctx, active);
}

export async function completeAward(ctx: ServiceContext, awardId: string) {
  const award = await funderAward(ctx, awardId);
  const open = (await tranchesOf(ctx, award)).filter((t) => OPEN_TRANCHES.includes(t.status)).length;
  const done = await transitionAward(ctx, award, "complete", "funder", { openTranches: open });
  if (done.passport_award_id) await mirrorAward(ctx, done);
  return awardDetail(ctx, done);
}

export async function cancelAward(ctx: ServiceContext, awardId: string, input: z.output<typeof reasonInput>) {
  const award = await funderAward(ctx, awardId);
  const cancelled = await transitionAward(ctx, award, "cancel", "funder", { reason: input.reason });
  for (const t of await tranchesOf(ctx, award)) {
    if (["scheduled", "due", "ready", "held", "failed"].includes(t.status)) await trancheMachine.transition({ id: t.id, status: t.status as TrancheStatus }, "cancel", { id: ctx.actor.id, kind: "funder" }, { now: ctx.now().toISOString() }, grantPorts(ctx, award.workspace_id));
  }
  if (cancelled.passport_award_id) await mirrorAward(ctx, cancelled);
  // Withdrawing a direct award also ends its invitation: the link stops working.
  const [revoked] = await ctx.repos.table("award_invitations").update({ award_id: award.id, workspace_id: award.workspace_id, accepted_at: null, declined_at: null, revoked_at: null }, { revoked_at: ctx.now().toISOString() });
  if (revoked) await audit(ctx, "award.invitation_revoked", "award", award.id, { invitationId: revoked.id }, award.workspace_id);
  return awardDetail(ctx, cancelled);
}

// ------------------------------------------------------------------------------------ amendments

export const amendmentInput = z
  .object({
    type: z.enum(["extension", "reallocation", "scope", "supplemental"]),
    /** extension: `{ newEndDate }`; supplemental: `{ amountMinor }`; reallocation and scope: free-form. */
    request: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().trim().min(1).max(5000),
  })
  .strict();

export async function requestAmendment(ctx: ServiceContext, awardId: string, input: z.output<typeof amendmentInput>) {
  const { award, side, ws } = await accessAward(ctx, awardId, "awards:write");
  if (["offered", "cancelled", "completed"].includes(award.status)) throw new ApiError(409, "invalid_status", `An award that is ${award.status} cannot be amended`);
  if (input.type === "extension" && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.request.newEndDate ?? ""))) throw new ApiError(422, "invalid", "An extension needs request.newEndDate (YYYY-MM-DD)");
  if (input.type === "supplemental" && !(Number.isSafeInteger(input.request.amountMinor) && (input.request.amountMinor as number) > 0)) throw new ApiError(422, "invalid", "A supplemental award needs request.amountMinor (minor units)");
  const row = await ctx.repos.table("amendments").insert({ workspace_id: award.workspace_id, award_id: award.id, type: input.type, request: { ...input.request, reason: input.reason, requestedFrom: side, requestedByWorkspace: ws.id } as Row<"amendments">["request"], requested_by: ctx.actor.userId, status: "requested" });
  await audit(ctx, "amendment.requested", "award", award.id, { amendmentId: row.id, type: input.type, side }, award.workspace_id);
  return amendmentView(row);
}

export const amendmentDecision = z.object({ status: z.enum(["approved", "declined"]), note: z.string().trim().max(5000).optional() }).strict();

/** Approve or decline an amendment. Approval applies it: a new end date, or a supplemental child award; Passport is patched. */
export async function decideAmendment(ctx: ServiceContext, amendmentId: string, input: z.output<typeof amendmentDecision>) {
  const ws = await authorize(ctx, { scope: "awards:write", kind: "funder", roles: STAFF_ROLES });
  const m = required(await ctx.repos.table("amendments").one({ id: amendmentId, workspace_id: ws.id }), "Amendment");
  if (m.status !== "requested") throw new ApiError(409, "invalid_transition", `This amendment is already ${m.status}`);
  // The amended award is this workspace's own: an amendment row that names another funder's award changes nothing.
  const award = await ctx.repos.table("awards").one({ id: m.award_id, workspace_id: ws.id });
  if (!award) throw notFound("Amendment");
  const req = m.request as { newEndDate?: string; amountMinor?: number; title?: string };
  let childId: string | null = null;
  let mirror: MirrorResult | null = null;
  if (input.status === "approved") {
    if (m.type === "extension" && req.newEndDate) {
      const k = keyDatesOf(award);
      const [updated] = await ctx.repos.table("awards").update({ id: award.id }, { key_dates: { ...k, periodOfPerformance: { name: "Period of performance", eventType: "dateRange", startDate: k.periodOfPerformance?.startDate ?? k.awardDate?.date ?? req.newEndDate, ...(k.periodOfPerformance ?? {}), endDate: req.newEndDate } } as Award["key_dates"] });
      if (updated?.passport_award_id) mirror = await mirrorAward(ctx, updated);
    } else if (m.type === "supplemental" && req.amountMinor) {
      const program = award.program_id ? await ctx.repos.table("programs").one({ id: award.program_id }) : null;
      const child = await createOfferedAward(ctx, { workspaceId: award.workspace_id, recipientWorkspaceId: required(award.recipient_workspace_id, "Recipient"), applicationId: award.application_id, opportunityId: award.opportunity_id, programId: award.program_id, title: req.title ?? `${award.title} (supplemental)`, awardedMinor: req.amountMinor, currency: currencyOf(award), conditions: [], period: keyDatesOf(award).periodOfPerformance, parentAwardId: award.id }, { ...readDefaults(program), requirements: [], schedule: undefined });
      childId = child.id;
    }
  }
  const [row] = await ctx.repos.table("amendments").update({ id: m.id, status: "requested" }, { status: input.status, decided_by: ctx.actor.userId, decided_at: ctx.now().toISOString(), child_award_id: childId });
  if (!row) throw new ApiError(409, "conflict", "This amendment changed while you were working. Reload and try again");
  await audit(ctx, `amendment.${input.status}`, "award", award.id, { amendmentId: m.id, type: m.type, childAwardId: childId, ...(input.note ? { note: input.note } : {}) });
  await emitFor(ctx, award.workspace_id, "award.status.changed", { subjectType: "award", subjectId: award.id, amendmentId: m.id, amendment: input.status });
  return { ...amendmentView(row), mirror };
}

export async function listAmendments(ctx: ServiceContext, awardId: string) {
  const { award } = await accessAward(ctx, awardId, "awards:read");
  return (await ctx.repos.table("amendments").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "created_at" })).map(amendmentView);
}

// ------------------------------------------------------------------------------------ CommonGrants

async function project(ctx: ServiceContext, a: Award): Promise<AwardBase> {
  const [funder, found, opp, app, parent] = await Promise.all([
    ctx.repos.table("workspaces").one({ id: a.workspace_id }),
    a.recipient_workspace_id ? ctx.repos.table("workspaces").one({ id: a.recipient_workspace_id }) : null,
    a.opportunity_id ? ctx.repos.table("opportunities").one({ id: a.opportunity_id }) : null,
    a.application_id ? ctx.repos.table("applications").one({ id: a.application_id }) : null,
    a.parent_award_id ? ctx.repos.table("awards").one({ id: a.parent_award_id }) : null,
  ]);
  // The funder names the recipient's Passport organization (id, name, EIN) only while it shares its record; the recipient always sees itself.
  const recipient = found && (ctx.workspace?.id === found.id || (await sharesWith(ctx, a.workspace_id, found.id))) ? found : null;
  const row: AwardRow = { id: a.id, title: a.title, description: a.description, status: a.status as AwardRow["status"], funding: fundingOf(a), key_dates: a.key_dates as AwardRow["key_dates"], recipient_individual: a.recipient_individual as AwardRow["recipient_individual"], parent_award_id: a.parent_award_id, created_at: a.created_at, updated_at: a.updated_at };
  return projectAward(
    {
      award: row,
      funder: funder ? { passport_org_id: funder.passport_org_id, handle: funder.handle, display_name: funder.display_name, legal_name: funder.legal_name, ein: funder.ein } : null,
      recipient: recipient?.passport_org_id ? { id: recipient.passport_org_id, name: namesOf(recipient).name, ein: recipient.ein } : null,
      opportunity: opp ? { id: opp.id, title: opp.title } : null,
      application: app ? { id: app.id, title: app.title } : null,
      parent: parent ? { id: parent.id, title: parent.title } : null,
    },
    { baseUrl: ctx.config.baseUrl },
  );
}

/**
 * Direct awards nobody has accepted yet. Their named recipient is an organization's name, which is
 * not a CommonGrants individual (and would not validate as one), and there is no recipient
 * organization yet, so they stay out of protocol output until they are claimed.
 */
async function unclaimedDirect(ctx: ServiceContext, awards: readonly Award[]): Promise<Set<string>> {
  const named = awards.filter((a) => !a.recipient_workspace_id);
  if (!named.length) return new Set();
  const open = await ctx.repos.table("award_invitations").find({ award_id: named.map((a) => a.id), accepted_at: null });
  return new Set(open.map((i) => i.award_id));
}

const visibleAwards = async (ctx: ServiceContext, ws: ServiceWorkspace) => {
  const rows = await ctx.repos.table("awards").find(ws.kind === "funder" ? { workspace_id: ws.id } : { recipient_workspace_id: ws.id }, { limit: 2000, orderBy: "created_at", ascending: false });
  const hidden = await unclaimedDirect(ctx, rows);
  return hidden.size ? rows.filter((a) => !hidden.has(a.id)) : rows;
};

/** `GET /common-grants/awards`: the caller's awards, as funder or as recipient. */
/**
 * The award as CommonGrants, or null (logged) when it does not validate: one record that cannot
 * be projected, such as a named recipient that is not a CommonGrants individual, is left out of
 * protocol output instead of failing the whole list (review DA-04).
 */
async function projectOrSkip(ctx: ServiceContext, a: Award): Promise<AwardBase | null> {
  try {
    return await project(ctx, a);
  } catch (e) {
    if (!(e instanceof ProjectionError)) throw e;
    log("warn", "award_projection_failed", { awardId: a.id, workspaceId: a.workspace_id, issues: e.issues.map((i) => i.path) });
    return null;
  }
}

const projectAll = async (ctx: ServiceContext, rows: Award[]) => (await Promise.all(rows.map((a) => projectOrSkip(ctx, a)))).filter((a): a is AwardBase => a !== null);

export async function listCgAwards(ctx: ServiceContext, page: PageRequest) {
  const ws = await authorize(ctx, { scope: "awards:read" });
  const items = await projectAll(ctx, await visibleAwards(ctx, ws));
  return { items: items.slice(page.offset, page.offset + page.pageSize), total: items.length };
}

export async function getCgAward(ctx: ServiceContext, awardId: string): Promise<AwardBase> {
  const { award } = await accessAward(ctx, awardId, "awards:read");
  if ((await unclaimedDirect(ctx, [award])).size) throw notFound("Award");
  const projected = await projectOrSkip(ctx, award);
  if (!projected) throw notFound("Award");
  return projected;
}

const FILTER_PATHS: Record<string, string> = { status: "status.value", title: "title", awardedAmount: "funding.awardedAmount.amount" };

export async function searchCgAwards(ctx: ServiceContext, body: unknown) {
  const ws = await authorize(ctx, { scope: "awards:read" });
  const req = parseSearchRequest("awards", body);
  const all = await projectAll(ctx, await visibleAwards(ctx, ws));
  const needle = req.search?.toLowerCase();
  let hits = all.filter((a) => (!needle || a.title.toLowerCase().includes(needle)) && req.parsedFilters.every((f) => matchesFilter(readPath(a, FILTER_PATHS[f.name] ?? f.name), f.operator, f.value)));
  hits = sortByPath(hits, req.sortInfo.sortBy === "custom" ? "lastModifiedAt" : req.sortInfo.sortBy, req.sortInfo.sortOrder);
  return filtered(hits.slice(req.page.offset, req.page.offset + req.page.pageSize), req.page, hits.length, req.sortInfo, req.filters);
}
