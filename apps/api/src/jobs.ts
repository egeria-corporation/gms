// SPDX-License-Identifier: AGPL-3.0-only
// Work no person asks for (build spec §6 `apps/jobs`): due evaluators, reminders, webhook
// delivery, Passport sync, the Mercury poll and the nightly ledger archive. The jobs Worker
// imports this module (`@gms/api/jobs`) and calls these functions from its cron and queue
// handlers, so scheduled work runs through the same services, machines and ledger as requests.
import { archiveDay, GENESIS_HASH, type ArchiveBucket } from "@gms/ledger";
import { PassportApiError } from "@gms/passport-client";
import { evaluateDue } from "@gms/payments";
import { deliverDue } from "@gms/webhooks";
import { DOCUMENT_EXPIRING_TEMPLATE, DOCUMENT_EXPIRY_OFFSETS, documentExpiringEmail, OBLIGATION_REMINDER_OFFSETS, OUTSIDE_NEXT_CYCLE_TEMPLATE, OUTSIDE_OBLIGATION_TEMPLATE, outsideNextCycleEmail, outsideObligationEmail, OUTSIDE_DEADLINE_OFFSETS, OUTSIDE_DEADLINE_TEMPLATE, outsideDeadlineEmail } from "@gms/notify";
import { NO_AGREEMENT_REQUIRED, OBLIGATION_STATUSES, obligationMoveRefusal, type ObligationKind, type ObligationStatus } from "@gms/workflow";
import { scopesForRole } from "./auth/scopes.ts";
import { exportBundle, importBundle } from "./services/analytics.ts";
import { latestAgreement, retryAwardMirrors } from "./services/awards.ts";
import { audit, changeStatus, systemContext, type BaseContext, type ServiceContext } from "./services/context.ts";
import { pollOrgChanges } from "./services/grantees.ts";
import { mailMembers } from "./services/member-mail.ts";
import { OUTSIDE_ROLES } from "./services/outside.ts";
import { VAULT_TYPE_LABEL, type VaultType } from "./services/vault.ts";
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

// ------------------------------------------------------------------------------------ apply anywhere

/** Stages in which each deadline still matters: a letter of inquiry before it is sent, the full application before submission. */
const OUTSIDE_REMINDABLE: Record<"loi" | "full" | "internal", readonly string[]> = {
  loi: ["prospect", "deciding", "loi"],
  full: ["prospect", "deciding", "loi", "invited", "drafting"],
  internal: ["prospect", "deciding", "loi", "invited", "drafting"],
};

/**
 * Outside application deadlines (letter of inquiry, full, internal) 14, 7 and 2 days ahead and on
 * the day: email the application's owner and the people assigned to questions not yet approved,
 * with the `outside_deadline` template, honouring each one's `outside_deadline` email preference. Runs once a day; the
 * idempotency key names the application, deadline, date and offset, so a re-run that day sends
 * nothing twice. Archived and closed applications are skipped.
 */
export async function sendOutsideReminders(base: BaseContext): Promise<{ checked: number; reminded: number; sent: number; failed: number }> {
  const now = base.now();
  let checked = 0;
  let reminded = 0;
  let sent = 0;
  const due: { row: Row<"outside_applications">; kind: "loi" | "full" | "internal"; date: string; days: number }[] = [];
  for (const days of OUTSIDE_DEADLINE_OFFSETS) {
    const date = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    for (const kind of ["loi", "full", "internal"] as const) {
      const column = kind === "loi" ? "loi_due" : kind === "full" ? "full_due" : "internal_due";
      const rows = await base.repos.table("outside_applications").find({ [column]: date, archived_at: null, stage: [...OUTSIDE_REMINDABLE[kind]] } as never, { limit: 5000 });
      for (const row of rows) due.push({ row, kind, date, days });
    }
  }
  checked = due.length;
  const failed = await each(due, async ({ row, kind, date, days }) => {
    const ws = await base.repos.table("workspaces").one({ id: row.workspace_id });
    if (!ws || ws.kind !== "applicant") return;
    const questions = await base.repos.table("outside_questions").find({ workspace_id: row.workspace_id, outside_application_id: row.id, obligation_id: null });
    const open = questions.filter((q) => q.status !== "approved");
    const people = [...new Set([row.owner_user_id, ...open.map((q) => q.assignee_user_id)].filter((x): x is string => !!x))];
    if (!people.length) return;
    const mail = outsideDeadlineEmail({ organization: ws.legal_name ?? ws.display_name, title: row.title, funder: row.funder_name, kind, dueOn: date, daysLeft: days, openQuestions: open.length, link: `${base.config.webBaseUrl}/w/${ws.handle}/outside/${row.id}` });
    const out = await mailMembers(base, { workspaceId: ws.id, category: "outside_deadline", subject: mail.subject, text: mail.text, html: mail.html, userIds: people, roles: OUTSIDE_ROLES, always: true, idempotencyKey: `${OUTSIDE_DEADLINE_TEMPLATE}:${row.id}:${kind}:${date}:${days}` });
    reminded++;
    sent += out.sent;
  });
  return { checked, reminded, sent, failed };
}

// ------------------------------------------------------------------------------------ write faster and keep it

const dayFrom = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The vault's expiry warning: 30 days before a vault document expires, email the applicant
 * workspace's admins and editors (template `document_expiring`, preference key of the same name).
 * Daily; the idempotency key names the document, its expiry date and the offset.
 */
export async function sendDocumentExpiryWarnings(base: BaseContext): Promise<{ checked: number; warned: number; sent: number; failed: number }> {
  const now = base.now();
  const due: { doc: Row<"documents">; days: number }[] = [];
  for (const days of DOCUMENT_EXPIRY_OFFSETS) {
    for (const doc of await base.repos.table("documents").find({ subject_type: "vault", expires_on: dayFrom(now, days) }, { limit: 5000 })) due.push({ doc, days });
  }
  let warned = 0;
  let sent = 0;
  const failed = await each(due, async ({ doc, days }) => {
    const ws = await base.repos.table("workspaces").one({ id: doc.workspace_id });
    if (!ws || ws.kind !== "applicant" || !doc.expires_on) return;
    const mail = documentExpiringEmail({ organization: ws.legal_name ?? ws.display_name, documentName: doc.name, typeLabel: VAULT_TYPE_LABEL[doc.doc_type as VaultType] ?? "Document", expiresOn: doc.expires_on, daysLeft: days, link: `${base.config.webBaseUrl}/w/${ws.handle}/organization/documents` });
    const out = await mailMembers(base, { workspaceId: ws.id, category: "document_expiring", subject: mail.subject, text: mail.text, html: mail.html, roles: ["admin", "editor"], always: true, idempotencyKey: `${DOCUMENT_EXPIRING_TEMPLATE}:${doc.id}:${doc.expires_on}:${days}` });
    warned++;
    sent += out.sent;
  });
  return { checked: due.length, warned, sent, failed };
}

/** An award's obligations are live while it is awarded, not archived and not closed out. */
const liveAward = (a: Row<"outside_applications"> | null): a is Row<"outside_applications"> => !!a && a.stage === "awarded" && !a.archived_at && !a.closed_out_at;

/**
 * Obligations of outside awards. First, an upcoming report, expected payment or condition whose
 * date has come becomes due (guard → write → ledger, as system:keep-reminders). Then reminders
 * for reports and conditions at 30, 14 and 7 days before, on the day, and 3 and 14 days after,
 * while not submitted or done: to the award's owner and the people on the report's open questions
 * (template `outside_obligation_due`). The idempotency key names the obligation, its date and the
 * offset, so a re-run that day sends nothing twice.
 */
export async function sendObligationReminders(base: BaseContext): Promise<{ madeDue: number; checked: number; reminded: number; sent: number; failed: number }> {
  const now = base.now();
  const today = dayFrom(now, 0);
  const awards = new Map<string, Row<"outside_applications"> | null>();
  const awardOf = async (o: Row<"outside_obligations">) => {
    if (!awards.has(o.outside_application_id)) awards.set(o.outside_application_id, await base.repos.table("outside_applications").one({ id: o.outside_application_id, workspace_id: o.workspace_id }));
    return awards.get(o.outside_application_id) ?? null;
  };
  let madeDue = 0;
  const upcoming = (await base.repos.table("outside_obligations").find({ status: "upcoming" }, { limit: 5000 })).filter((o) => !!o.due_on && o.due_on <= today && o.kind !== "payment_received");
  let failed = await each(upcoming, async (o) => {
    if (!liveAward(await awardOf(o)) || obligationMoveRefusal(o.kind as ObligationKind, "upcoming", "due")) return;
    const ctx = systemContext(base, { job: "keep-reminders" }, { id: o.workspace_id, kind: "applicant" });
    await changeStatus(ctx, {
      event: "outside_obligation.status_changed",
      subjectType: "outside_obligation",
      subjectId: o.id,
      current: o.status,
      from: OBLIGATION_STATUSES,
      to: "due",
      write: async () => void (await base.repos.table("outside_obligations").update({ id: o.id, workspace_id: o.workspace_id, status: "upcoming" }, { status: "due" as ObligationStatus })),
      data: { outsideApplicationId: o.outside_application_id, kind: o.kind },
    });
    madeDue++;
  });
  const due: { o: Row<"outside_obligations">; days: number }[] = [];
  for (const days of OBLIGATION_REMINDER_OFFSETS) {
    const rows = await base.repos.table("outside_obligations").find({ due_on: dayFrom(now, days), kind: ["report", "condition"], status: ["upcoming", "due", "missed"] }, { limit: 5000 });
    for (const o of rows) due.push({ o, days });
  }
  let reminded = 0;
  let sent = 0;
  failed += await each(due, async ({ o, days }) => {
    const award = await awardOf(o);
    if (!liveAward(award)) return;
    const ws = await base.repos.table("workspaces").one({ id: o.workspace_id });
    if (!ws || ws.kind !== "applicant") return;
    const questions = o.kind === "report" ? await base.repos.table("outside_questions").find({ workspace_id: o.workspace_id, obligation_id: o.id }) : [];
    const people = [...new Set([award.owner_user_id, ...questions.filter((q) => q.status !== "approved").map((q) => q.assignee_user_id)].filter((x): x is string => !!x))];
    if (!people.length) return;
    const mail = outsideObligationEmail({ organization: ws.legal_name ?? ws.display_name, title: award.title, funder: award.funder_name, obligationTitle: o.title, kind: o.kind as "report" | "condition", dueOn: o.due_on!, daysLeft: days, link: `${base.config.webBaseUrl}/w/${ws.handle}/outside/${award.id}` });
    const out = await mailMembers(base, { workspaceId: ws.id, category: "outside_obligation_due", subject: mail.subject, text: mail.text, html: mail.html, userIds: people, roles: OUTSIDE_ROLES, always: true, idempotencyKey: `${OUTSIDE_OBLIGATION_TEMPLATE}:${o.id}:${o.due_on}:${days}` });
    reminded++;
    sent += out.sent;
  });
  return { madeDue, checked: due.length, reminded, sent, failed };
}

/**
 * The next-cycle reminder: on the date a person gave when recording a decline (`next_cycle_on`),
 * email the application's owner (template `outside_next_cycle`). Daily; one send per application
 * and date. Archived applications, and ones reopened since, are skipped.
 */
export async function sendNextCycleReminders(base: BaseContext): Promise<{ checked: number; reminded: number; sent: number; failed: number }> {
  const today = dayFrom(base.now(), 0);
  const rows = await base.repos.table("outside_applications").find({ next_cycle_on: today, stage: "declined", archived_at: null }, { limit: 5000 });
  let reminded = 0;
  let sent = 0;
  const failed = await each(rows, async (row) => {
    const ws = await base.repos.table("workspaces").one({ id: row.workspace_id });
    if (!ws || ws.kind !== "applicant" || !row.owner_user_id || !row.next_cycle_on) return;
    const mail = outsideNextCycleEmail({ organization: ws.legal_name ?? ws.display_name, title: row.title, funder: row.funder_name, programName: row.program_name, nextCycleOn: row.next_cycle_on, link: `${base.config.webBaseUrl}/w/${ws.handle}/outside/${row.id}` });
    const out = await mailMembers(base, { workspaceId: ws.id, category: "outside_next_cycle", subject: mail.subject, text: mail.text, html: mail.html, userIds: [row.owner_user_id], roles: OUTSIDE_ROLES, always: true, idempotencyKey: `${OUTSIDE_NEXT_CYCLE_TEMPLATE}:${row.id}:${row.next_cycle_on}` });
    reminded++;
    sent += out.sent;
  });
  return { checked: rows.length, reminded, sent, failed };
}

/** The daily write-faster and keep-it reminders, in one job: vault expiry warnings, obligations and next cycles. */
export async function sendKeepReminders(base: BaseContext): Promise<Record<string, unknown>> {
  return { documents: await sendDocumentExpiryWarnings(base), obligations: await sendObligationReminders(base), nextCycles: await sendNextCycleReminders(base) };
}
