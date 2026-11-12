// SPDX-License-Identifier: AGPL-3.0-only
// Work no person asks for (build spec §6 `apps/jobs`): due evaluators, reminders, webhook
// delivery, Passport sync, the Mercury poll and the nightly ledger archive. The jobs Worker
// imports this module (`@gms/api/jobs`) and calls these functions from its cron and queue
// handlers, so scheduled work runs through the same services, machines and ledger as requests.
import { archiveDay, GENESIS_HASH, type ArchiveBucket } from "@gms/ledger";
import { PassportApiError } from "@gms/passport-client";
import { evaluateDue } from "@gms/payments";
import { deliverDue } from "@gms/webhooks";
import { NO_AGREEMENT_REQUIRED } from "@gms/workflow";
import { scopesForRole } from "./auth/scopes.ts";
import { exportBundle, importBundle } from "./services/analytics.ts";
import { latestAgreement, retryAwardMirrors } from "./services/awards.ts";
import { audit, systemContext, type BaseContext, type ServiceContext } from "./services/context.ts";
import { pollOrgChanges } from "./services/grantees.ts";
import { processInbound } from "./services/inbound.ts";
import { syncBank } from "./services/integrations.ts";
import { passportClientFor } from "./services/passport-link.ts";
import { STUCK_RELEASE_MS, payeeFactsOf, reconcileReleasing, refreshDisbursed, type PayeeFacts } from "./services/payments.ts";
import { sharingWith } from "./services/profile.ts";
import { evaluateRequirement, sendDueReminders } from "./services/requirements.ts";
import type { Row } from "./services/repos/types.ts";
import { applyTrancheUpdate, toPaymentsTranche } from "./services/tranches.ts";

export type { BaseContext } from "./services/context.ts";
export { processInbound } from "./services/inbound.ts";
export { sendDigests } from "./services/member-mail.ts";
export { SupabaseUserDirectory } from "./services/ports.ts";
export { SupabaseRepos } from "./services/repos/supabase.ts";
export { MemoryRepos } from "./services/repos/memory.ts";
export { RestOpenGrantsClient, R2FileStorage } from "./services/ports.ts";

const sys = (base: BaseContext, job: string, workspaceId: string): ServiceContext => systemContext(base, { job }, { id: workspaceId, kind: "funder" });

/** One failing workspace or record must not stop the run: failures are counted and the run goes on. */
async function each<T>(items: T[], fn: (item: T) => Promise<void>): Promise<number> {
  let failed = 0;
  for (const item of items) {
    try {
      await fn(item);
    } catch {
      failed++;
    }
  }
  return failed;
}

/** Scheduled tranches whose condition is now met become `due` (`onDate`, and `onExecution` on awards that need no agreement). */
export async function evaluateTranchesDue(base: BaseContext): Promise<{ awards: number; due: number; failed: number }> {
  const scheduled = await base.repos.table("tranches").find({ status: "scheduled" }, { limit: 5000 });
  const awardIds = [...new Set(scheduled.map((t) => t.award_id))];
  const awards = awardIds.length ? await base.repos.table("awards").find({ id: awardIds, status: "active" }) : [];
  let due = 0;
  const failed = await each(awards, async (award) => {
    const agreement = await latestAgreement(sys(base, "tranche-due", award.workspace_id), award);
    const accepted = (await base.repos.table("requirements").find({ award_id: award.id, workspace_id: award.workspace_id, status: "accepted" })).map((r) => r.id);
    const updates = evaluateDue(scheduled.filter((t) => t.award_id === award.id && t.workspace_id === award.workspace_id).map(toPaymentsTranche), { agreementExecuted: agreement?.status === "executed", noAgreementRequired: award.conditions.includes(NO_AGREEMENT_REQUIRED), awardActive: true, acceptedRequirementIds: accepted, now: base.now() });
    for (const u of updates) {
      await applyTrancheUpdate(sys(base, "tranche-due", award.workspace_id), u, "system");
      due++;
    }
  });
  return { awards: awards.length, due, failed };
}

/**
 * Payments left in `releasing` longer than the threshold are reconciled with Passport: the same
 * request under the same Idempotency-Key, so the answer is the disbursement Passport already holds
 * or the one the person released. A tranche Passport cannot confirm stays where it is for the next run.
 */
export async function reconcileStuckReleases(base: BaseContext, olderThanMs: number = STUCK_RELEASE_MS): Promise<{ stuck: number; resolved: number; unconfirmed: number; failed: number }> {
  // Reconciling repeats the release request to Passport, so it is a payment attempt: never while payments through Passport are off.
  if (!base.config.facilitatedPayments) return { stuck: 0, resolved: 0, unconfirmed: 0, failed: 0 };
  const cutoff = base.now().getTime() - olderThanMs;
  const stuck = (await base.repos.table("tranches").find({ status: "releasing" }, { limit: 500 })).filter((t) => t.mode === "facilitated" && (!t.released_at || Date.parse(t.released_at) <= cutoff));
  let resolved = 0;
  let unconfirmed = 0;
  const failed = await each(stuck, async (t) => {
    // The award of the tranche's own workspace, or nothing: a tranche that names another funder's award is never retried.
    const award = await base.repos.table("awards").one({ id: t.award_id, workspace_id: t.workspace_id });
    if (!award) return;
    const out = await reconcileReleasing(sys(base, "tranche-reconcile", t.workspace_id), t, award);
    if (out.result === "unconfirmed") unconfirmed++;
    else resolved++;
  });
  return { stuck: stuck.length, resolved, unconfirmed, failed };
}

/** Open and close reporting windows, then send whatever reminder is due. Safe to run any number of times. */
export async function evaluateRequirements(base: BaseContext): Promise<{ checked: number; due: number; overdue: number; reminders: number; failed: number }> {
  const rows = await base.repos.table("requirements").find({ status: ["scheduled", "due", "overdue", "returned"] }, { limit: 5000 });
  let due = 0;
  let overdue = 0;
  let reminders = 0;
  const failed = await each(rows, async (r) => {
    const ctx = sys(base, "requirements", r.workspace_id);
    const moved = await evaluateRequirement(ctx, r);
    if (moved === "due") due++;
    if (moved === "overdue") overdue++;
    const fresh = (await base.repos.table("requirements").one({ id: r.id })) ?? r;
    if ((await sendDueReminders(ctx, fresh)).sent !== null) reminders++;
  });
  return { checked: rows.length, due, overdue, reminders, failed };
}

/** Attempt every outbound webhook delivery that is due (24 h backoff schedule in `@gms/webhooks`). */
export async function deliverWebhooks(base: BaseContext, fetcher?: typeof fetch): Promise<{ attempted: number; delivered: number }> {
  if (!base.config.webhookSecretKey) return { attempted: 0, delivered: 0 };
  const out = await deliverDue({ store: base.webhooks, secretKey: base.config.webhookSecretKey, now: base.now, ...(fetcher ? { fetch: fetcher } : {}) });
  return { attempted: out.length, delivered: out.filter((d) => d.status === "delivered").length };
}

async function linkedFunders(base: BaseContext): Promise<string[]> {
  return [...new Set((await base.repos.table("passport_links").find({ mode: "funder_client", revoked_at: null }, { limit: 5000 })).map((l) => l.workspace_id))];
}

/**
 * Passport sync for every linked funder: retry award mirrors, read back disbursed amounts, refresh
 * each grantee's payee facts (level, pending destination change: display facts only), and poll
 * for organization changes.
 */
export async function syncPassport(base: BaseContext, opts: { orgChanges?: boolean } = {}): Promise<{ funders: number; mirrored: number; awardsRefreshed: number; payeesRefreshed: number; orgChanges: number; failed: number }> {
  const funders = await linkedFunders(base);
  const out = { funders: funders.length, mirrored: 0, awardsRefreshed: 0, payeesRefreshed: 0, orgChanges: 0, failed: 0 };
  out.failed = await each(funders, async (workspaceId) => {
    const ctx = sys(base, "passport-sync", workspaceId);
    out.mirrored += (await retryAwardMirrors(ctx, workspaceId)).synced;
    const awards = await base.repos.table("awards").find({ workspace_id: workspaceId, status: ["accepted", "active", "suspended"] }, { limit: 2000 });
    for (const a of awards.filter((x) => x.passport_award_id)) if ((await refreshDisbursed(ctx, a)) !== null) out.awardsRefreshed++;
    const passport = await passportClientFor(ctx, workspaceId);
    const recipientIds = [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))];
    const recipients = recipientIds.length ? await base.repos.table("workspaces").find({ id: recipientIds }) : [];
    // Passport is asked about a grantee, and its level change ledgered for this funder, only while it shares its record with this funder (review F-01).
    const shared = await sharingWith(base, workspaceId, recipients.map((w) => w.id));
    for (const w of recipients) {
      if (!passport || !w.passport_org_id || !shared.has(w.id)) continue;
      try {
        const c = await passport.getPayeeCredential(w.passport_org_id);
        const p = c.changeControl.pendingChange;
        const facts: PayeeFacts = { ...payeeFactsOf(w), pendingDestinationChange: p ? { bankName: p.bankName, last4: p.last4, requestedAt: p.requestedAt } : null };
        const before = w.verification_level;
        await base.repos.table("workspaces").update({ id: w.id }, { verification_level: c.level, settings: { ...((w.settings as Record<string, unknown> | null) ?? {}), passportPayee: facts } as unknown as Row<"workspaces">["settings"] });
        if (before !== c.level) await audit(ctx, "organization.level_changed", "workspace", w.id, { from: before, to: c.level }, workspaceId);
        out.payeesRefreshed++;
      } catch (e) {
        // No credential yet (404) is a fact, not a failure; anything else is retried next run.
        if (!(e instanceof PassportApiError && e.status === 404)) continue;
      }
    }
    if (opts.orgChanges) out.orgChanges += (await pollOrgChanges(ctx, workspaceId)).added;
  });
  return out;
}

/** Mercury poll (read-only): pull new outbound transactions for every workspace with an active connection. */
export async function pollBanks(base: BaseContext): Promise<{ workspaces: number; added: number; failed: number }> {
  const accounts = await base.repos.table("connector_accounts").find({ provider: "mercury", status: "active" }, { limit: 5000 });
  let added = 0;
  const failed = await each(accounts, async (a) => {
    added += (await syncBank(sys(base, "mercury-poll", a.workspace_id), a.workspace_id)).added;
  });
  return { workspaces: accounts.length, added, failed };
}

/**
 * Nightly ledger archive: one JSONL object per UTC day in R2, each line chained to the one before
 * by SHA-256, and each day chained to the previous day's last hash (`ledger_archives`).
 */
export async function archiveLedger(base: BaseContext, bucket: ArchiveBucket, day?: string): Promise<{ day: string; key: string; events: number; sha256: string } | { day: string; skipped: true }> {
  const target = day ?? new Date(base.now().getTime() - 86_400_000).toISOString().slice(0, 10);
  if (await base.repos.table("ledger_archives").one({ day: target })) return { day: target, skipped: true };
  const earlier = (await base.repos.table("ledger_archives").find({}, { orderBy: "day", ascending: false, limit: 400 })).filter((a) => a.day < target)[0];
  const result = await archiveDay(base.ledger, bucket, target, earlier?.sha256 ?? GENESIS_HASH);
  await base.repos.table("ledger_archives").insert({ day: target, object_key: result.key, events: result.count, sha256: result.lastHash, prev_sha256: earlier?.sha256 ?? null, archived_at: base.now().toISOString() });
  return { day: target, key: result.key, events: result.count, sha256: result.lastHash };
}

/** Queue consumer: one message from GMS_EVENTS. Throwing makes the queue retry the message. */
export type QueueMessage = { kind: "passport_event"; inboundEventId: string } | { kind: "webhook_delivery" };

export async function handleQueueMessage(base: BaseContext, message: QueueMessage): Promise<void> {
  if (message.kind === "passport_event") await processInbound(base, message.inboundEventId);
  else if (message.kind === "webhook_delivery") await deliverWebhooks(base);
}

// ------------------------------------------------------------------------------------ operator CLI


/**
 * The context `scripts/gms.ts` runs in: the instance operator, holding the service-role key,
 * acting on one funder workspace with an admin's scopes. Ledgered as `system:cli`.
 */
async function operatorContext(base: BaseContext, workspaceId: string): Promise<ServiceContext> {
  const ws = await base.repos.table("workspaces").one({ id: workspaceId });
  if (!ws) throw new Error(`No workspace ${workspaceId}`);
  if (ws.kind !== "funder") throw new Error("Bundles are exported from and imported into funder workspaces");
  const ctx = systemContext(base, { job: "cli" }, { id: ws.id, kind: "funder" });
  return { ...ctx, workspace: { ...ctx.workspace!, role: "admin" }, scopes: scopesForRole("funder", "admin") };
}

/** `gms export --workspace <id>`: the same bundle the Settings export writes, returned inline. */
export async function exportWorkspaceBundle(base: BaseContext, workspaceId: string) {
  return exportBundle(await operatorContext(base, workspaceId), { inline: true });
}

/** `gms import <dir> --workspace <id>`. */
export async function importWorkspaceBundle(base: BaseContext, workspaceId: string, bundle: { gms?: unknown }) {
  return importBundle(await operatorContext(base, workspaceId), bundle);
}
