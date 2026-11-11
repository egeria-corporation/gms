// SPDX-License-Identifier: AGPL-3.0-only
// Inbound webhooks (build spec §10.7, §10.10): Passport events and Resend events. Every delivery
// is verified, stored raw in `inbound_events` and deduplicated on (provider, external id) before
// anything else happens. Passport events are turned into tranche updates by `@gms/payments` and
// applied through the tranche machine by a `passport` actor.
import { matchInbound, stripQuotedReply, bareAddress } from "@gms/notify";
import { parsePassportWebhook, type AwardUpdatedData, type DestinationChangePendingData, type DestinationChangedData, type DisbursementStatusChangedData, type LevelChangedData, type OrganizationInactiveData, type PassportEvent } from "@gms/passport-client";
import { onDestinationChangePending, onDestinationChanged, onDisbursementStatusChanged, onLevelChanged, onOrganizationInactive, type EventEffects } from "@gms/payments";
import { emitFor } from "./awards.ts";
import { audit, systemContext, type BaseContext, type ServiceContext } from "./context.ts";
import { payeeFactsOf, refreshDisbursed, type PayeeFacts } from "./payments.ts";
import { RepoError, type Row } from "./repos/types.ts";
import { applyTrancheUpdate, toPaymentsTranche } from "./tranches.ts";

type Inbound = Row<"inbound_events">;

/** Store a delivery once. Returns null when this (provider, id) was already received. */
async function claim(base: BaseContext, provider: "passport" | "resend" | "mercury", externalId: string, type: string, payload: unknown): Promise<Inbound | null> {
  try {
    return await base.repos.table("inbound_events").insert({ provider, external_id: externalId, type, payload: payload as Inbound["payload"], received_at: base.now().toISOString() });
  } catch (e) {
    if (e instanceof RepoError && e.kind === "conflict") return null;
    throw e;
  }
}

const done = (base: BaseContext, id: string, error: string | null = null) => base.repos.table("inbound_events").update({ id }, { processed_at: base.now().toISOString(), error });

// ------------------------------------------------------------------------------------ Passport

export type Received = { status: 200; outcome: "processed" | "duplicate" | "queued" | "ignored" } | { status: 401 | 400 | 503; outcome: string };

const tranchesOfRecipient = async (base: BaseContext, orgId: string) => {
  const recipients = (await base.repos.table("workspaces").find({ passport_org_id: orgId })).filter((w) => w.kind === "applicant");
  const awards = recipients.length ? await base.repos.table("awards").find({ recipient_workspace_id: recipients.map((w) => w.id) }) : [];
  // Only tranches of the award's own workspace: a row elsewhere that names the award is not one of its payments.
  const tranches = awards.length ? (await base.repos.table("tranches").find({ award_id: awards.map((a) => a.id) })).filter((t) => awards.some((a) => a.id === t.award_id && a.workspace_id === t.workspace_id)) : [];
  return { recipients, awards, tranches };
};

/** Apply one verified, deduplicated Passport event. Safe to run again: every step is idempotent. */
export async function processPassportEvent(base: BaseContext, event: PassportEvent): Promise<{ trancheUpdates: number; awardsRefreshed: number }> {
  const { recipients, awards, tranches } = await tranchesOfRecipient(base, event.orgId);
  let fx: EventEffects;
  switch (event.type) {
    case "disbursement.status.changed": {
      const d = event.data as DisbursementStatusChangedData;
      const row = await base.repos.table("tranches").one({ passport_disbursement_id: d.disbursementId });
      fx = onDisbursementStatusChanged(d, row ? toPaymentsTranche(row) : null);
      break;
    }
    case "payee.destination.change_pending":
      fx = onDestinationChangePending(event.data as DestinationChangePendingData, tranches.map(toPaymentsTranche));
      break;
    case "payee.destination.changed":
      fx = onDestinationChanged(event.data as DestinationChangedData, tranches.map(toPaymentsTranche));
      break;
    case "payee.level.changed":
      fx = onLevelChanged(event.data as LevelChangedData, tranches.map(toPaymentsTranche));
      break;
    case "payee.organization.inactive":
      fx = onOrganizationInactive(event.data as OrganizationInactiveData, tranches.map(toPaymentsTranche));
      break;
    case "award.updated":
      fx = { trancheUpdates: [], recipient: null, refreshAwards: [(event.data as AwardUpdatedData).awardId], refreshCredentials: [], alerts: [], relay: [] };
      break;
  }

  // What Passport told us about the payee: display facts only (bank name, last four digits).
  if (fx.recipient) {
    for (const w of recipients) {
      const facts: PayeeFacts = { ...payeeFactsOf(w) };
      const p = fx.recipient.pendingDestinationChange;
      if (p !== undefined) facts.pendingDestinationChange = p ? { bankName: p.bankName, last4: p.last4, requestedAt: p.requestedAt } : null;
      if (fx.recipient.active !== undefined) facts.active = fx.recipient.active;
      await base.repos.table("workspaces").update({ id: w.id }, { settings: { ...((w.settings as Record<string, unknown> | null) ?? {}), passportPayee: facts } as unknown as Row<"workspaces">["settings"], ...(fx.recipient.verificationLevel ? { verification_level: fx.recipient.verificationLevel } : {}) });
    }
  }

  let applied = 0;
  for (const u of fx.trancheUpdates) {
    const row = await base.repos.table("tranches").one({ id: u.trancheId });
    if (!row) continue;
    const ctx = systemContext(base, "passport", { id: row.workspace_id, kind: "funder" });
    await applyTrancheUpdate(ctx, u, "passport");
    applied++;
  }
  for (const r of fx.relay.filter((x) => x.type === "disbursement.status.changed")) {
    const row = await base.repos.table("tranches").one({ id: r.trancheId });
    if (row) await emitFor(systemContext(base, "passport", { id: row.workspace_id, kind: "funder" }), row.workspace_id, "disbursement.status.changed", { trancheId: row.id, awardId: row.award_id, passportDisbursementId: row.passport_disbursement_id, status: row.passport_status });
  }
  for (const a of fx.alerts) {
    const funders = [...new Set(awards.filter((x) => recipients.some((w) => w.id === x.recipient_workspace_id)).map((x) => x.workspace_id))];
    for (const f of funders) await audit(systemContext(base, "passport", { id: f, kind: "funder" }), `payments.alert.${a.kind}`, "organization", a.orgId, { message: a.message, ...(a.trancheId ? { trancheId: a.trancheId } : {}) }, f);
  }
  // The disbursed amount is Passport's to state: read it back, never add it up here.
  let refreshed = 0;
  for (const passportAwardId of new Set(fx.refreshAwards)) {
    const award = await base.repos.table("awards").one({ passport_award_id: passportAwardId });
    if (award && (await refreshDisbursed(systemContext(base, "passport", { id: award.workspace_id, kind: "funder" }), award)) !== null) refreshed++;
  }
  return { trancheUpdates: applied, awardsRefreshed: refreshed };
}

/**
 * `POST /webhooks/passport`. Verify the signature, store and dedupe, then hand the event to the
 * queue (the jobs Worker processes it) or, when there is no queue, process it inline.
 */
export async function receivePassportEvent(base: BaseContext, headers: { get(name: string): string | null }, rawBody: string, enqueue?: (message: { kind: "passport_event"; inboundEventId: string }) => Promise<void>): Promise<Received> {
  const secret = base.config.passportWebhookSecret;
  if (!secret) return { status: 503, outcome: "passport_webhooks_not_configured" };
  const parsed = await parsePassportWebhook(secret, headers, rawBody, { now: base.now() });
  // An event type this version does not know is acknowledged, so Passport does not retry it for a day.
  if (!parsed.ok && parsed.reason === "unknown_event") return { status: 200, outcome: "ignored" };
  if (!parsed.ok) return parsed.reason === "bad_signature" ? { status: 401, outcome: "bad_signature" } : { status: 400, outcome: parsed.reason };
  const row = await claim(base, "passport", parsed.event.id, parsed.event.type, parsed.event);
  if (!row) return { status: 200, outcome: "duplicate" };
  if (enqueue) {
    await enqueue({ kind: "passport_event", inboundEventId: row.id });
    return { status: 200, outcome: "queued" };
  }
  await processInbound(base, row.id);
  return { status: 200, outcome: "processed" };
}

/** Process a stored inbound event (queue consumer and inline path). A failure is recorded on the row and rethrown so the queue retries. */
export async function processInbound(base: BaseContext, inboundEventId: string): Promise<void> {
  const row = await base.repos.table("inbound_events").one({ id: inboundEventId });
  if (!row || row.processed_at) return;
  try {
    if (row.provider === "passport") await processPassportEvent(base, row.payload as unknown as PassportEvent);
    await done(base, row.id);
  } catch (e) {
    await base.repos.table("inbound_events").update({ id: row.id }, { error: (e instanceof Error ? `${e.name}: ${e.message}` : "error").slice(0, 500) });
    throw e;
  }
}

// ------------------------------------------------------------------------------------ Resend

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/**
 * Resend signs webhooks with Svix: HMAC-SHA256 over `{id}.{timestamp}.{body}` with the base64
 * secret after `whsec_`; the header carries one or more space-separated `v1,<base64>` signatures.
 */
export async function verifySvixSignature(secret: string, headers: { get(name: string): string | null }, rawBody: string, now: Date, toleranceSec = 300): Promise<boolean> {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigs = headers.get("svix-signature");
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(ts)) > toleranceSec) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64(secret.replace(/^whsec_/, ""));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)));
  return sigs.split(" ").some((s) => {
    const [v, value] = s.split(",");
    if (v !== "v1" || !value || value.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ value.charCodeAt(i);
    return diff === 0;
  });
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; from?: string; to?: string[] | string; cc?: string[]; subject?: string; text?: string; headers?: { name?: string; value?: string }[] | Record<string, string>; message_id?: string };
}

const headerOf = (h: NonNullable<ResendEvent["data"]>["headers"], name: string): string | undefined => {
  if (!h) return undefined;
  if (Array.isArray(h)) return h.find((x) => x.name?.toLowerCase() === name)?.value;
  return Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
};

/**
 * `POST /webhooks/resend`. Delivery events (`email.delivered`, `email.bounced`, …) are recorded
 * against the send in the ledger; an inbound email (`email.received`) is matched to its thread by
 * the plus-address or `In-Reply-To`, and posted as a message when the sender belongs to the thread.
 */
export async function receiveResendEvent(base: BaseContext, headers: { get(name: string): string | null }, rawBody: string): Promise<Received> {
  const secret = base.config.resendInboundSecret;
  if (!secret) return { status: 503, outcome: "resend_webhooks_not_configured" };
  if (!(await verifySvixSignature(secret, headers, rawBody, base.now()))) return { status: 401, outcome: "bad_signature" };
  let e: ResendEvent;
  try {
    e = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return { status: 400, outcome: "bad_body" };
  }
  if (typeof e.type !== "string") return { status: 400, outcome: "bad_body" };
  const row = await claim(base, "resend", headers.get("svix-id")!, e.type, { type: e.type, emailId: e.data?.email_id ?? null });
  if (!row) return { status: 200, outcome: "duplicate" };
  const d = e.data ?? {};
  try {
    if (e.type === "email.received") await postReply(base, d);
    else if (e.type.startsWith("email.") && d.email_id) await recordDelivery(base, e.type, d.email_id);
    await done(base, row.id);
  } catch (err) {
    await done(base, row.id, (err instanceof Error ? err.name : "error").slice(0, 200));
  }
  return { status: 200, outcome: "processed" };
}

/** Attach a delivery outcome to the send it belongs to (found by the provider's message id in the ledger). */
async function recordDelivery(base: BaseContext, type: string, emailId: string): Promise<void> {
  const sends = await base.ledger.list({ eventType: "communication.sent", limit: 5000 });
  const sent = sends.find((s) => (s.data as { messageId?: string } | null)?.messageId === emailId);
  if (!sent?.workspaceId) return;
  const ctx: ServiceContext = systemContext(base, { job: "resend-webhook" }, { id: sent.workspaceId, kind: "funder" });
  await audit(ctx, `communication.${type.slice("email.".length)}`, sent.subjectType, sent.subjectId, { messageId: emailId }, sent.workspaceId);
}

async function postReply(base: BaseContext, d: NonNullable<ResendEvent["data"]>): Promise<void> {
  const domain = base.config.inboundDomain;
  if (!domain || !d.from) return;
  const to = Array.isArray(d.to) ? d.to : d.to ? [d.to] : [];
  const match = await matchInbound(
    { from: d.from, to, cc: d.cc ?? [], inReplyTo: headerOf(d.headers, "in-reply-to"), references: headerOf(d.headers, "references") },
    { inboundDomain: domain, findThreadByMessageId: async (id) => (await base.repos.table("messages").one({ email_message_id: id }))?.thread_id ?? null },
  );
  if (!match) return;
  const thread = await base.repos.table("threads").one({ id: match.threadId });
  if (!thread) return;
  // Only a party to the thread may post into it: the applicant organization's primary address, for now.
  const applicant = thread.applicant_workspace_id ? await base.repos.table("workspaces").one({ id: thread.applicant_workspace_id }) : null;
  const known = ((applicant?.org_projection as { emails?: { primary?: string } } | null)?.emails?.primary ?? "").toLowerCase();
  const from = bareAddress(d.from).toLowerCase();
  const ctx = systemContext(base, { job: "resend-webhook" }, { id: thread.workspace_id, kind: "funder" });
  if (!known || known !== from) {
    await audit(ctx, "message.inbound_rejected", "thread", thread.id, { reason: "sender_not_a_participant" }, thread.workspace_id);
    return;
  }
  if (thread.visibility !== "shared") return;
  const body = stripQuotedReply(d.text ?? "").trim();
  if (!body) return;
  const msg = await base.repos.table("messages").insert({ thread_id: thread.id, author: `email:${from}`, body: body.slice(0, 20_000), email_message_id: d.message_id ?? headerOf(d.headers, "message-id") ?? null });
  await audit(ctx, "message.received_by_email", "thread", thread.id, { messageId: msg.id, via: match.via }, thread.workspace_id);
}
