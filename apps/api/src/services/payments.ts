// SPDX-License-Identifier: AGPL-3.0-only
// Payments (build spec §10.7, §11.6). The GMS schedules and instructs; Passport moves the money.
// Nothing here stores a destination, sets one, or adds to `disbursedAmount`: a release is one call
// to `POST /passport/disbursements`, and the disbursed total is only ever read back from Passport.
import { PassportApiError, PassportUnavailableError, moneyToMinor, type CgAward, type FunderSource, type PassportClient, type PassportRail, type PayeeCredential } from "@gms/passport-client";
import {
  ReleaseBlockedError,
  ScheduleError,
  buildSchedule,
  evaluateReadiness,
  holdBanner,
  holdCauseFor,
  missing,
  ok as found,
  proposeMatches,
  recordExternal,
  releaseFacilitated,
  unavailable,
  type AwardForPayments,
  type HoldBanner,
  type Lookup,
  type PlanItem,
  type ReadinessSummary,
} from "@gms/payments";
import { toMoney } from "@gms/protocol";
import { NO_AGREEMENT_REQUIRED, type VerificationLevel } from "@gms/workflow";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { STAFF_ROLES, accessAward, currencyOf, fundingOf, humanOnly, latestAgreement, minorOf, type Award } from "./awards.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { passportClientFor } from "./passport-link.ts";
import type { PageRequest } from "./programs.ts";
import type { Row } from "./repos/types.ts";
import { applyTrancheUpdate, toPaymentsTranche } from "./tranches.ts";

type TrancheRow = Row<"tranches">;
type Ws = Row<"workspaces">;
const FINANCE_ROLES = ["admin", "finance"] as const;
const PAYMENT_READERS = ["admin", "finance", "program_officer", "auditor", "observer"] as const;

/** What the GMS remembers about a payee from Passport events. Display facts only: bank name and last four digits. */
export interface PayeeFacts {
  pendingDestinationChange?: { bankName: string | null; last4: string | null; requestedAt: string } | null;
  active?: boolean;
}
export const payeeFactsOf = (ws: Ws | null | undefined): PayeeFacts => ((ws?.settings as { passportPayee?: PayeeFacts } | null)?.passportPayee ?? {});

export const trancheView = (t: TrancheRow) => ({
  id: apiId("tranche", t.id),
  awardId: apiId("award", t.award_id),
  seq: t.seq,
  amountMinor: t.amount_minor,
  currency: t.currency,
  condition: t.condition,
  status: t.status,
  dueAt: t.due_at,
  holdReason: t.hold_reason,
  mode: t.mode,
  passportDisbursementId: t.passport_disbursement_id,
  passportStatus: t.passport_status,
  releasedAt: t.released_at,
  releasedBy: t.released_by,
  external: t.external,
});

async function loadTranche(ctx: ServiceContext, trancheId: string, scope: "payments:read" | "payments:release", roles: readonly string[]) {
  const ws = await authorize(ctx, { scope, kind: "funder", roles });
  const tranche = await ctx.repos.table("tranches").one({ id: trancheId, workspace_id: ws.id });
  if (!tranche) throw notFound("Tranche");
  // The award must be this workspace's too. Everything that matters in a payment follows the
  // award (whose Passport client is used, who is paid, how much is left), so a tranche row that
  // names another funder's award is not a payment of this workspace, whatever its own columns say.
  const award = await ctx.repos.table("awards").one({ id: tranche.award_id, workspace_id: ws.id });
  if (!award) throw notFound("Tranche");
  return { ws, tranche, award };
}

/**
 * A tranche and the award it is paid from are one funder's. Callers that are handed both rows (the
 * jobs, the Payments center) pass through here, so a row pair from two workspaces never reaches
 * Passport: 404, the same answer as a tranche that does not exist.
 */
export function assertTrancheOfAward(tranche: Pick<TrancheRow, "award_id" | "workspace_id">, award: Pick<Award, "id" | "workspace_id">): void {
  if (tranche.award_id !== award.id || tranche.workspace_id !== award.workspace_id) throw notFound("Tranche");
}

async function awardForPayments(ctx: ServiceContext, award: Award): Promise<{ a: AwardForPayments | null; recipient: Ws | null }> {
  const recipient = award.recipient_workspace_id ? await ctx.repos.table("workspaces").one({ id: award.recipient_workspace_id }) : null;
  if (!recipient?.passport_org_id) return { a: null, recipient };
  const app = award.application_id ? await ctx.repos.table("applications").one({ id: award.application_id }) : null;
  return { a: { id: award.id, title: award.title, recipientOrgId: recipient.passport_org_id, passportAwardId: award.passport_award_id, conditions: award.conditions, verificationLevelAtSubmit: (app?.verification_level_at_submit as VerificationLevel | null) ?? null }, recipient };
}

async function lookup<T>(read: (() => Promise<T>) | null): Promise<Lookup<T>> {
  if (!read) return missing;
  try {
    return found(await read());
  } catch (e) {
    if (e instanceof PassportApiError && e.status === 404) return missing;
    if (e instanceof PassportApiError || e instanceof PassportUnavailableError) return e instanceof PassportUnavailableError ? unavailable : missing;
    // Token and transport failures all mean the same to a person: Passport cannot be read right now.
    return unavailable;
  }
}

export interface Readiness {
  summary: ReadinessSummary;
  banner: HoldBanner | null;
  /** Bank name and last four digits of the destination Passport would pay, when it can be read. */
  destination: { bankName: string | null; last4: string | null; status: string } | null;
  credential: PayeeCredential | null;
  award: AwardForPayments | null;
  passport: PassportClient | null;
}

/** The seven readiness checks, evaluated live (§10.7). `unknown` is its own state: Passport unreachable is neither pass nor fail. */
export async function evaluateTranche(ctx: ServiceContext, tranche: TrancheRow, award: Award, opts: { duplicateConfirmed?: boolean } = {}): Promise<Readiness> {
  assertTrancheOfAward(tranche, award);
  const [{ a, recipient }, funder, agreement, siblings, link] = await Promise.all([
    awardForPayments(ctx, award),
    ctx.repos.table("workspaces").one({ id: award.workspace_id }),
    latestAgreement(ctx, award),
    ctx.repos.table("tranches").find({ award_id: award.id, workspace_id: award.workspace_id }),
    ctx.repos.table("passport_links").one({ workspace_id: award.workspace_id, mode: "funder_client", revoked_at: null }),
  ]);
  let passport: PassportClient | null = null;
  try {
    passport = await passportClientFor(ctx, award.workspace_id);
  } catch {
    passport = null;
  }
  const funderOrg = funder?.passport_org_id ?? null;
  const [funderSources, credential, passportAward] = await Promise.all([
    lookup<FunderSource[]>(passport && funderOrg ? () => passport.listFunderSources(funderOrg) : null),
    lookup<PayeeCredential>(passport && a ? () => passport.getPayeeCredential(a.recipientOrgId) : null),
    lookup<CgAward>(passport && a?.passportAwardId ? () => passport.getAward(a.passportAwardId!) : null),
  ]);
  const facts = payeeFactsOf(recipient);
  const orgStatus = (recipient?.org_projection as { status?: { value?: string } } | null)?.status?.value;
  const recipientActive = facts.active === false ? false : orgStatus ? orgStatus === "active" : null;
  const stub: AwardForPayments = a ?? { id: award.id, title: award.title, recipientOrgId: "", passportAwardId: null, conditions: award.conditions, verificationLevelAtSubmit: null };
  const summary = evaluateReadiness({
    tranche: toPaymentsTranche(tranche),
    award: stub,
    agreementExecuted: agreement?.status === "executed",
    conditionSatisfied: tranche.status !== "scheduled",
    passportLinked: !!link?.last_ok_at && !!passport,
    funderSources,
    credential,
    passportAward,
    recipientActive,
    siblings: siblings.filter((s) => s.id !== tranche.id).map(toPaymentsTranche),
    ...(opts.duplicateConfirmed ? { duplicateConfirmed: true } : {}),
    now: ctx.now(),
    links: { agreement: (id) => `/awards/${apiId("award", id)}/agreement`, award: (id) => `/awards/${apiId("award", id)}/payments`, passportSettings: "/settings/passport", grantee: () => (recipient ? `/grantees/${recipient.id}` : "/grantees") },
  });
  const cred = credential.state === "ok" ? credential.value : null;
  // A change Passport told us about blocks the release even when the credential cannot be re-read right now.
  const pending = facts.pendingDestinationChange;
  const cause = holdCauseFor(summary, cred, ctx.now()) ?? (pending ? { cause: "pending_destination_change" as const, bankName: pending.bankName, last4: pending.last4, coolingOffUntil: null } : null);
  const d = cred?.payoutDestination ?? null;
  return {
    summary: pending && summary.releasable ? { ...summary, releasable: false, text: `${summary.text} · destination change pending` } : summary,
    banner: cause ? holdBanner(cause, `Tranche ${tranche.seq}`) : tranche.status === "held" ? { cause: "passport_unavailable", tone: "warn", title: `Tranche ${tranche.seq} is on hold`, detail: `Held: ${(tranche.hold_reason ?? "manual").replace(/_/g, " ")}.`, clears: "Clears when the hold is released." } : null,
    destination: d ? { bankName: (d as { bankName?: string | null }).bankName ?? null, last4: (d as { last4?: string | null }).last4 ?? null, status: (d as { status?: string }).status ?? "unknown" } : null,
    credential: cred,
    award: a,
    passport,
  };
}

/** Why a release is refused while the install pays outside the GMS. One message for REST, MCP and the screens. */
export const FACILITATED_OFF = "Payments through Passport are switched off on this server. Pay the grantee outside the GMS, then record the payment on the tranche";
export const facilitatedDisabled = () => new ApiError(409, "facilitated_payments_disabled", FACILITATED_OFF);

/**
 * With facilitated payments off a tranche is never releasable: it is paid elsewhere and recorded
 * here. The checks still show, so the funder sees whether the grantee could be paid through Passport.
 */
const readinessView = (ctx: ServiceContext, r: Readiness) =>
  ctx.config.facilitatedPayments
    ? { ...r.summary, mode: "facilitated" as const, modeNote: null, banner: r.banner, destination: r.destination }
    : { ...r.summary, releasable: false, mode: "resolve" as const, modeNote: `${FACILITATED_OFF}.`, banner: r.banner, destination: r.destination };

export async function getTrancheReadiness(ctx: ServiceContext, trancheId: string) {
  const { tranche, award } = await loadTranche(ctx, trancheId, "payments:read", PAYMENT_READERS);
  return { tranche: trancheView(tranche), ...readinessView(ctx, await evaluateTranche(ctx, tranche, award)) };
}

// ------------------------------------------------------------------------------------ schedule

export async function getSchedule(ctx: ServiceContext, awardId: string) {
  const { award } = await accessAward(ctx, awardId, "awards:read");
  const tranches = await ctx.repos.table("tranches").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "seq" });
  const f = fundingOf(award);
  return { awardId: apiId("award", award.id), currency: currencyOf(award), awardedAmountMinor: minorOf(f.awardedAmount), disbursedAmountMinor: minorOf(f.disbursedAmount), disbursedAsOf: award.disbursed_at, tranches: tranches.map(trancheView) };
}

const conditionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("onExecution") }).strict(),
  z.object({ type: z.literal("onReportAccepted"), requirementId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("onDate"), date: z.iso.date() }).strict(),
  z.object({ type: z.literal("manual") }).strict(),
]);
export const scheduleInput = z
  .object({ tranches: z.array(z.object({ amountMinor: z.number().int().positive().optional(), percent: z.number().positive().max(100).optional(), condition: conditionInput }).strict().refine((t) => (t.amountMinor === undefined) !== (t.percent === undefined), "Give amountMinor or percent, not both")).min(1).max(60) })
  .strict();

/**
 * Replace the part of a schedule that has not started. Tranches already with Passport, settled or
 * cancelled stay as they are; the new plan must add up to what is left of the award.
 */
export async function putSchedule(ctx: ServiceContext, awardId: string, input: z.output<typeof scheduleInput>) {
  const ws = await authorize(ctx, { scope: "payments:release", kind: "funder", roles: FINANCE_ROLES });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  if (!award || award.workspace_id !== ws.id) throw notFound("Award");
  if (["completed", "cancelled"].includes(award.status)) throw new ApiError(409, "award_closed", `The schedule of a ${award.status} award cannot change`);
  const existing = await ctx.repos.table("tranches").find({ award_id: award.id, workspace_id: ws.id }, { orderBy: "seq" });
  const kept = existing.filter((t) => !["scheduled", "due", "ready"].includes(t.status));
  const replaceable = existing.filter((t) => ["scheduled", "due", "ready"].includes(t.status));
  const awarded = minorOf(fundingOf(award).awardedAmount) ?? 0;
  const remaining = awarded - kept.filter((t) => t.status !== "cancelled").reduce((sum, t) => sum + t.amount_minor, 0);
  const requirementIds = new Set((await ctx.repos.table("requirements").find({ award_id: award.id, workspace_id: ws.id })).map((r) => r.id));
  const plan: PlanItem[] = input.tranches.map((t) => {
    const condition = t.condition.type === "onReportAccepted" ? { type: "onReportAccepted" as const, requirementId: t.condition.requirementId.replace(/^req_/, "") } : t.condition;
    if (condition.type === "onReportAccepted" && !requirementIds.has(condition.requirementId)) throw new ApiError(422, "unknown_requirement", "A tranche names a requirement that is not on this award");
    return (t.amountMinor !== undefined ? { amountMinor: t.amountMinor, condition } : { percent: t.percent!, condition }) as PlanItem;
  });
  let built;
  try {
    built = buildSchedule({ awardId: award.id, awardedMinor: remaining, currency: currencyOf(award), plan, newId: () => crypto.randomUUID() });
  } catch (e) {
    if (e instanceof ScheduleError) throw new ApiError(422, e.code, e.message);
    throw e;
  }
  const schedule = (await ctx.repos.table("payment_schedules").one({ award_id: award.id })) ?? (await ctx.repos.table("payment_schedules").insert({ workspace_id: ws.id, award_id: award.id, currency: currencyOf(award) }));
  // Replaced tranches are cancelled through the machine, never deleted: the ledger keeps what was planned.
  for (const t of replaceable) await applyTrancheUpdate(ctx, { trancheId: t.id, path: ["cancelled"], patch: {}, reason: "schedule_replaced" }, "funder");
  await ctx.repos.table("requirements").update({ award_id: award.id, releases_tranche_id: replaceable.map((t) => t.id) }, { releases_tranche_id: null });
  let seq = existing.reduce((m, t) => Math.max(m, t.seq), 0);
  for (const t of built) {
    seq += 1;
    const row = await ctx.repos.table("tranches").insert({ id: t.id, workspace_id: ws.id, award_id: award.id, schedule_id: schedule.id, seq, amount_minor: t.amountMinor, currency: t.currency, condition: t.condition as unknown as TrancheRow["condition"], status: "scheduled", due_at: t.condition.type === "onDate" ? new Date(`${t.condition.date}T00:00:00Z`).toISOString() : null, idempotency_key: `trn_${t.id}` });
    if (t.condition.type === "onReportAccepted") await ctx.repos.table("requirements").update({ id: t.condition.requirementId }, { releases_tranche_id: row.id });
  }
  await audit(ctx, "schedule.replaced", "award", award.id, { cancelled: replaceable.length, created: built.length, remainingMinor: remaining });
  return getSchedule(ctx, award.id);
}

// ------------------------------------------------------------------------------------ tranches

export interface TrancheFilter {
  status?: string | undefined;
  awardId?: string;
  view?: string | undefined;
}

const VIEWS: Record<string, string[]> = { due: ["due", "ready", "held"], "in-flight": ["releasing", "initiated"], done: ["settled", "returned", "failed", "cancelled"], upcoming: ["scheduled"] };

export async function listTranches(ctx: ServiceContext, page: PageRequest, f: TrancheFilter = {}) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: PAYMENT_READERS });
  const statuses = f.status ? [f.status] : f.view ? VIEWS[f.view] : undefined;
  if (f.view && !statuses) throw new ApiError(400, "bad_request", `view must be one of ${Object.keys(VIEWS).join(", ")}`);
  const where = { workspace_id: ws.id, ...(statuses ? { status: statuses } : {}), ...(f.awardId ? { award_id: f.awardId } : {}) };
  const [rows, total] = await Promise.all([ctx.repos.table("tranches").find(where, { orderBy: "due_at", limit: page.pageSize, offset: page.offset }), ctx.repos.table("tranches").count(where)]);
  const awards = rows.length ? await ctx.repos.table("awards").find({ id: [...new Set(rows.map((t) => t.award_id))], workspace_id: ws.id }) : [];
  const recipients = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const items = rows.map((t) => {
    const a = awards.find((x) => x.id === t.award_id);
    const r = recipients.find((x) => x.id === a?.recipient_workspace_id);
    return { ...trancheView(t), award: a ? { id: apiId("award", a.id), title: a.title, status: a.status } : null, recipient: r ? { workspaceId: r.id, name: r.display_name, handle: r.handle, verificationLevel: r.verification_level, pendingDestinationChange: !!payeeFactsOf(r).pendingDestinationChange } : null };
  });
  return { items, total };
}

const blocked = (e: ReleaseBlockedError) => new ApiError(e.code === "passport_unavailable" ? 503 : 409, e.code, e.message);

export const releaseInput = z.object({ confirmDuplicate: z.boolean().optional(), rail: z.enum(["auto", "standard", "instant"]).optional() }).strict();

/**
 * Release a tranche through Passport (facilitated). A human gate: any agent or API-client token
 * is refused here, at the service, whatever its scopes. The tranche's own `trn_…` id is the
 * Idempotency-Key, so repeating the call can never pay twice.
 */
export async function releaseTranche(ctx: ServiceContext, trancheId: string, input: z.output<typeof releaseInput> = {}) {
  if (!ctx.config.facilitatedPayments) throw facilitatedDisabled();
  if (ctx.actor.kind !== "user") throw humanOnly("Releasing a payment");
  const { tranche, award, ws } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  if (award.status !== "active") throw new ApiError(409, "award_not_active", `Payments are released on active awards; this award is ${award.status}`);
  const r = await evaluateTranche(ctx, tranche, award, { duplicateConfirmed: input.confirmDuplicate === true });
  if (!r.award || !r.passport) throw new ApiError(409, "not_mirrored", "Connect Passport to pay: this workspace or its grantee is not linked to Passport");
  const funder = await ctx.repos.table("workspaces").one({ id: ws.id });
  const rail = input.rail ?? ((funder?.settings as { defaultRail?: PassportRail } | null)?.defaultRail ?? "auto");
  try {
    const outcome = await releaseFacilitated(
      { passport: r.passport, now: ctx.now, apply: async (u) => void (await applyTrancheUpdate(ctx, u, "system")) },
      { tranche: toPaymentsTranche(tranche), award: r.award, readiness: r.summary, rail, actor: ctx.actor.id },
    );
    const after = required(await ctx.repos.table("tranches").one({ id: tranche.id }), "Tranche");
    await audit(ctx, "tranche.release_requested", "tranche", tranche.id, { result: outcome.result, status: after.status, amountMinor: tranche.amount_minor, currency: tranche.currency, ...(outcome.result === "refused" ? { code: outcome.code } : {}) });
    return {
      result: outcome.result,
      tranche: trancheView(after),
      ...(outcome.result === "accepted" ? { replayed: outcome.replayed } : {}),
      ...(outcome.result === "refused" ? { code: outcome.code, message: outcome.message } : {}),
      ...(outcome.result === "unconfirmed" ? { message: "Passport did not answer. Nothing is known to have moved; release again to retry safely." } : {}),
    };
  } catch (e) {
    if (e instanceof ReleaseBlockedError) throw blocked(e);
    throw e;
  }
}

/** A release is "stuck" when it has been `releasing` this long without an answer from Passport. */
export const STUCK_RELEASE_MS = 15 * 60 * 1000;

/**
 * Resolve a tranche left in `releasing` (Passport did not answer, or the Worker stopped between the
 * two writes). It repeats the identical release request under the tranche's own Idempotency-Key:
 * Passport answers with the disbursement it already holds (never a second payment), or creates the
 * one the person asked for, or refuses. The tranche then follows that answer through the machine
 * (initiated, held at Passport, or failed and back to due). If Passport still cannot be reached,
 * nothing changes. No authorization here: callers are `reconcileTranche` (a person) and the job.
 */
export async function reconcileReleasing(ctx: ServiceContext, tranche: TrancheRow, award: Award) {
  if (tranche.status !== "releasing" || tranche.mode !== "facilitated") throw new ApiError(409, "not_releasing", `Only a payment that is releasing can be reconciled; this one is ${tranche.status.replace(/_/g, " ")}`);
  const r = await evaluateTranche(ctx, tranche, award);
  if (!r.award || !r.passport) throw new ApiError(409, "not_mirrored", "Connect Passport to reconcile this payment");
  let outcome: Awaited<ReturnType<typeof releaseFacilitated>>;
  try {
    outcome = await releaseFacilitated({ passport: r.passport, now: ctx.now, apply: async (u) => void (await applyTrancheUpdate(ctx, u, "system")) }, { tranche: toPaymentsTranche(tranche), award: r.award, readiness: r.summary, actor: ctx.actor.id });
  } catch (e) {
    // Passport unreachable before anything was sent: still unconfirmed, still safe to try again.
    if (e instanceof ReleaseBlockedError && e.code === "passport_unavailable") outcome = { result: "unconfirmed", status: "releasing" };
    else if (e instanceof ReleaseBlockedError) throw blocked(e);
    else throw e;
  }
  const after = required(await ctx.repos.table("tranches").one({ id: tranche.id }), "Tranche");
  await audit(ctx, "tranche.reconciled", "tranche", tranche.id, { result: outcome.result, status: after.status, ...(outcome.result === "accepted" ? { replayed: outcome.replayed, passportDisbursementId: outcome.disbursement.id } : {}), ...(outcome.result === "refused" ? { code: outcome.code } : {}) }, tranche.workspace_id);
  return {
    result: outcome.result,
    tranche: trancheView(after),
    ...(outcome.result === "accepted" ? { replayed: outcome.replayed } : {}),
    ...(outcome.result === "refused" ? { code: outcome.code, message: outcome.message } : {}),
    ...(outcome.result === "unconfirmed" ? { message: "Passport has not confirmed this payment. Nothing changed; reconcile again later, or check the payment in Passport." } : {}),
  };
}

/** A finance person or admin reconciles a payment stuck in `releasing`. A human gate, like the release itself. */
export async function reconcileTranche(ctx: ServiceContext, trancheId: string) {
  if (!ctx.config.facilitatedPayments) throw facilitatedDisabled();
  if (ctx.actor.kind !== "user") throw humanOnly("Reconciling a payment");
  const { tranche, award } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  return reconcileReleasing(ctx, tranche, award);
}

export const externalInput = z.object({ reference: z.string().trim().min(1).max(200), paidAt: z.iso.datetime({ offset: true }).or(z.iso.date()), destinationLast4: z.string().regex(/^[0-9]{4}$/, "Enter the last four digits only"), bankTransactionId: z.string().optional() }).strict();

/** Resolve mode: record a tranche the funder paid through its own bank, and tell Passport. */
export async function recordExternalPayment(ctx: ServiceContext, trancheId: string, input: z.output<typeof externalInput>) {
  if (ctx.actor.kind !== "user") throw humanOnly("Recording a payment");
  const { tranche, award } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  const r = await evaluateTranche(ctx, tranche, award);
  if (!r.award || !r.passport) throw new ApiError(409, "not_mirrored", "Connect Passport to record payments: this award has no mirror at Passport to record against");
  try {
    const outcome = await recordExternal(
      { passport: r.passport, now: ctx.now, apply: async (u) => void (await applyTrancheUpdate(ctx, u, "funder")) },
      { tranche: toPaymentsTranche(tranche), award: r.award, external: { reference: input.reference, paidAt: input.paidAt, destinationLast4: input.destinationLast4 }, actor: ctx.actor.id },
    );
    const after = required(await ctx.repos.table("tranches").one({ id: tranche.id }), "Tranche");
    await audit(ctx, "tranche.recorded_external", "tranche", tranche.id, { result: outcome.result, reference: input.reference, last4: input.destinationLast4 });
    return { result: outcome.result, tranche: trancheView(after), ...(outcome.result === "unverified" ? { code: outcome.code, message: "Recorded here. Passport could not verify this payment against the grantee's destination, so it is marked unverified." } : {}) };
  } catch (e) {
    if (e instanceof ReleaseBlockedError) throw blocked(e);
    throw e;
  }
}

export const holdInput = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export async function holdTranche(ctx: ServiceContext, trancheId: string, input: z.output<typeof holdInput>) {
  const { tranche } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  return trancheView(await applyTrancheUpdate(ctx, { trancheId: tranche.id, path: ["held"], patch: { holdReason: "manual" }, reason: input.reason }, "funder"));
}

/** Lift a GMS hold, or ask Passport to release a disbursement it parked itself. */
export async function unholdTranche(ctx: ServiceContext, trancheId: string) {
  const { tranche, award } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  if (tranche.status !== "held") throw new ApiError(409, "invalid_transition", "Only a held payment can be released from hold");
  if (!tranche.passport_disbursement_id) return trancheView(await applyTrancheUpdate(ctx, { trancheId: tranche.id, path: ["due"], patch: { holdReason: null }, reason: "hold_released" }, "funder"));
  if (ctx.actor.kind !== "user") throw humanOnly("Releasing a payment held at Passport");
  const passport = await passportClientFor(ctx, award.workspace_id);
  if (!passport) throw new ApiError(409, "not_mirrored", "Connect Passport to release this payment");
  try {
    const d = await passport.releaseHeldDisbursement(tranche.passport_disbursement_id);
    const target = d.status === "initiated" ? "initiated" : d.status === "settled" ? "settled" : d.status === "held" ? "held" : "releasing";
    if (target === "held") throw new ApiError(409, "still_held", "Passport is still holding this payment");
    return trancheView(await applyTrancheUpdate(ctx, { trancheId: tranche.id, path: [target], patch: { passportStatus: d.status, holdReason: null }, reason: "passport_released" }, "system"));
  } catch (e) {
    if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport could not be reached. The payment is still held");
    if (e instanceof PassportApiError) throw new ApiError(409, e.code, e.message);
    throw e;
  }
}

export async function cancelTranche(ctx: ServiceContext, trancheId: string, input: z.output<typeof holdInput>) {
  const { tranche, award } = await loadTranche(ctx, trancheId, "payments:release", FINANCE_ROLES);
  if (tranche.passport_disbursement_id && tranche.status === "held") {
    const passport = await passportClientFor(ctx, award.workspace_id);
    if (!passport) throw new ApiError(409, "not_mirrored", "Connect Passport to cancel a payment held there");
    try {
      await passport.cancelHeldDisbursement(tranche.passport_disbursement_id);
    } catch (e) {
      if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport could not be reached. The payment was not cancelled");
      if (e instanceof PassportApiError) throw new ApiError(409, e.code, e.message);
      throw e;
    }
  }
  return trancheView(await applyTrancheUpdate(ctx, { trancheId: tranche.id, path: ["cancelled"], patch: { passportStatus: tranche.passport_disbursement_id ? "cancelled" : tranche.passport_status }, reason: input.reason }, "funder"));
}

// ------------------------------------------------------------------------------- payments center

/** Readiness for every tranche that is due, ready or held (the Payments center's Due view). */
export async function paymentsReadiness(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: PAYMENT_READERS });
  const rows = await ctx.repos.table("tranches").find({ workspace_id: ws.id, status: ["due", "ready", "held"] }, { orderBy: "due_at", limit: 100 });
  const awards = rows.length ? await ctx.repos.table("awards").find({ id: [...new Set(rows.map((t) => t.award_id))], workspace_id: ws.id }) : [];
  const items = [];
  for (const t of rows) {
    const award = awards.find((a) => a.id === t.award_id);
    if (!award) continue;
    const r = await evaluateTranche(ctx, t, award);
    items.push({ tranche: trancheView(t), award: { id: apiId("award", award.id), title: award.title }, ...readinessView(ctx, r) });
  }
  return { facilitatedPayments: !!ctx.config.facilitatedPayments, items, totals: { dueMinor: rows.reduce((s, t) => s + t.amount_minor, 0), releasable: items.filter((i) => i.releasable).length, blocked: items.filter((i) => !i.releasable).length } };
}

/** Alerts for the Payments center: holds, failures, returns, unverified records and pending destination changes. */
export async function paymentAlerts(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: PAYMENT_READERS });
  const rows = await ctx.repos.table("tranches").find({ workspace_id: ws.id }, { limit: 1000 });
  const awards = rows.length ? await ctx.repos.table("awards").find({ id: [...new Set(rows.map((t) => t.award_id))], workspace_id: ws.id }) : [];
  const recipients = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const nameOf = (awardId: string) => recipients.find((r) => r.id === awards.find((a) => a.id === awardId)?.recipient_workspace_id)?.display_name ?? "The grantee";
  const alerts: { kind: string; tone: "warn" | "danger" | "neutral"; title: string; detail: string; trancheId?: string; awardId?: string; recipientWorkspaceId?: string }[] = [];
  for (const r of recipients) {
    const f = payeeFactsOf(r);
    if (f.pendingDestinationChange) {
      const b = holdBanner({ cause: "pending_destination_change", bankName: f.pendingDestinationChange.bankName, last4: f.pendingDestinationChange.last4, coolingOffUntil: null }, `Payments to ${r.display_name}`);
      alerts.push({ kind: "destination_change_pending", tone: "warn", title: `${r.display_name} · destination change pending`, detail: `${b.detail} ${b.clears}`, recipientWorkspaceId: r.id });
    }
    if (f.active === false) alerts.push({ kind: "organization_inactive", tone: "danger", title: `${r.display_name} · inactive at Passport`, detail: "Passport reports this organization as inactive. All payments to it are on hold.", recipientWorkspaceId: r.id });
    if (r.verification_level && r.verification_level !== "L3") alerts.push({ kind: "level_below_l3", tone: "danger", title: `${r.display_name} · level ${r.verification_level}`, detail: "Payments need Passport level L3. Clears when the organization completes payee verification in Passport.", recipientWorkspaceId: r.id });
  }
  for (const t of rows) {
    const base = { trancheId: apiId("tranche", t.id), awardId: apiId("award", t.award_id) };
    if (t.status === "held") alerts.push({ kind: "held", tone: "warn", title: `${nameOf(t.award_id)} · tranche ${t.seq} held`, detail: `Reason: ${(t.hold_reason ?? "manual").replace(/_/g, " ")}.`, ...base });
    if (t.status === "failed") alerts.push({ kind: "payment_failed", tone: "danger", title: `${nameOf(t.award_id)} · tranche ${t.seq} failed`, detail: "Passport does not retry on its own. Review and release again.", ...base });
    if (t.status === "returned") alerts.push({ kind: "payment_returned", tone: "danger", title: `${nameOf(t.award_id)} · tranche ${t.seq} returned`, detail: "The bank returned this payment.", ...base });
    if (t.passport_status === "unverified") alerts.push({ kind: "unverified", tone: "neutral", title: `${nameOf(t.award_id)} · tranche ${t.seq} unverified`, detail: "Recorded as paid outside Passport; Passport could not verify it against the grantee's destination.", ...base });
  }
  return alerts;
}

// --------------------------------------------------------------------------------- reconciliation

const txnView = (t: Row<"bank_transactions">) => ({ id: t.id, provider: t.provider, amountMinor: t.amount_minor, currency: t.currency, postedAt: t.posted_at, counterpartyName: t.counterparty_name, memo: t.memo, matchedTrancheId: t.matched_tranche_id ? apiId("tranche", t.matched_tranche_id) : null, matchedAt: t.matched_at });

/** Unmatched outbound bank transactions with the tranches they could be (amount ± 1 cent, name similarity ≥ 0.8). */
export async function listBankTransactions(ctx: ServiceContext, page: PageRequest, f: { matched?: boolean } = {}) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: PAYMENT_READERS });
  const all = (await ctx.repos.table("bank_transactions").find({ workspace_id: ws.id }, { orderBy: "posted_at", ascending: false, limit: 1000 })).filter((t) => f.matched === undefined || (t.matched_tranche_id !== null) === f.matched);
  const open = await ctx.repos.table("tranches").find({ workspace_id: ws.id, status: ["due", "ready"] });
  const awards = open.length ? await ctx.repos.table("awards").find({ id: [...new Set(open.map((t) => t.award_id))], workspace_id: ws.id }) : [];
  const recipients = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const candidates = open.map((t) => {
    const r = recipients.find((x) => x.id === awards.find((a) => a.id === t.award_id)?.recipient_workspace_id);
    return { tranche: toPaymentsTranche(t), recipientNames: [r?.display_name, r?.legal_name].filter((n): n is string => !!n) };
  });
  const proposals = proposeMatches(all.map((t) => ({ id: t.id, amountMinor: t.amount_minor, currency: t.currency, postedAt: t.posted_at, counterpartyName: t.counterparty_name ?? "", memo: t.memo, matchedTrancheId: t.matched_tranche_id })), candidates);
  const items = all.slice(page.offset, page.offset + page.pageSize).map((t) => ({ ...txnView(t), proposals: proposals.filter((p) => p.transactionId === t.id).map((p) => ({ trancheId: apiId("tranche", p.trancheId), score: p.score, amountDeltaMinor: p.amountDeltaMinor, ambiguous: p.ambiguous })) }));
  return { items, total: all.length };
}

export const matchInput = z.object({ trancheId: z.string().min(1), destinationLast4: z.string().regex(/^[0-9]{4}$/, "Enter the last four digits only") }).strict();

/** A person confirms a proposed match; confirming records the tranche as paid outside Passport. */
export async function matchBankTransaction(ctx: ServiceContext, transactionId: string, trancheUuid: string, destinationLast4: string) {
  if (ctx.actor.kind !== "user") throw humanOnly("Confirming a bank match");
  const ws = await authorize(ctx, { scope: "payments:release", kind: "funder", roles: FINANCE_ROLES });
  const txn = await ctx.repos.table("bank_transactions").one({ id: transactionId });
  if (!txn || txn.workspace_id !== ws.id) throw notFound("Bank transaction");
  if (txn.matched_tranche_id) throw new ApiError(409, "already_matched", "This transaction is already matched to a payment");
  const tranche = await ctx.repos.table("tranches").one({ id: trancheUuid, workspace_id: ws.id });
  if (!tranche) throw notFound("Tranche");
  if (Math.abs(tranche.amount_minor - txn.amount_minor) > 1 || tranche.currency !== txn.currency) throw new ApiError(422, "amount_mismatch", "The transaction amount does not match this tranche");
  const recorded = await recordExternalPayment(ctx, tranche.id, { reference: `${txn.provider}:${txn.external_txn_id}`, paidAt: txn.posted_at, destinationLast4 });
  await ctx.repos.table("bank_transactions").update({ id: txn.id }, { matched_tranche_id: tranche.id, matched_at: ctx.now().toISOString(), matched_by: ctx.actor.userId });
  await audit(ctx, "bank_transaction.matched", "tranche", tranche.id, { transactionId: txn.id, provider: txn.provider });
  return { transaction: txnView(required(await ctx.repos.table("bank_transactions").one({ id: txn.id }), "Bank transaction")), ...recorded };
}

// ----------------------------------------------------------------------------- Passport read-back

/** Cache what Passport says has been disbursed on an award. The GMS never computes this number. */
export async function refreshDisbursed(ctx: ServiceContext, award: Award): Promise<number | null> {
  if (!award.passport_award_id) return null;
  const passport = await passportClientFor(ctx, award.workspace_id);
  if (!passport) return null;
  let remote: CgAward;
  try {
    remote = await passport.getAward(award.passport_award_id);
  } catch {
    return null;
  }
  const disbursed = moneyToMinor(remote.funding?.disbursedAmount);
  if (disbursed === null) return null;
  const before = minorOf(fundingOf(award).disbursedAmount);
  const funding = { ...fundingOf(award), disbursedAmount: toMoney(disbursed, currencyOf(award)) };
  await ctx.repos.table("awards").update({ id: award.id }, { funding: funding as unknown as Award["funding"], disbursed_at: ctx.now().toISOString() });
  // A money figure changed on the award, so the ledger says so, and says whose number it is.
  if (before !== disbursed) await audit(ctx, "award.disbursed_refreshed", "award", award.id, { fromMinor: before, toMinor: disbursed, currency: currencyOf(award), source: "passport", passportAwardId: award.passport_award_id }, award.workspace_id);
  return disbursed;
}

export { NO_AGREEMENT_REQUIRED, STAFF_ROLES };
