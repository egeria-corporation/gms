// SPDX-License-Identifier: AGPL-3.0-only
// Give an award directly (contract: direct awards). A funder offers an award to an organization
// that has not applied, by its name and a contact email. The award is attached to a workspace only
// when a signed-in person whose confirmed sign-in address is the invited one accepts it for an
// applicant workspace where they are an admin (review F-01: never by name or EIN). Accepting runs
// `accept_offer` through the award machine, so the Passport mirror and every effect behave as for
// any accepted award, and records the organization's consent to share its record with the funder.
import { directAwardInvitationEmail, DIRECT_AWARD_MESSAGE_MAX } from "@gms/notify";
import { toMinor } from "@gms/protocol";
import { awardCgStatus, awardEffects, awardMachine } from "@gms/workflow";
import { z } from "zod";
import { randomToken, sha256b64url } from "../auth/crypto.ts";
import { scopesForRole } from "../auth/scopes.ts";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { invitationStatus, maskEmail, type AwardInvitation } from "./award-invitations.ts";
import { awardDetail, createOfferedAward, currencyOf, fundingOf, grantPorts, humanOnly, keyDatesOf, minorOf, mirrorAward, printMoney, readDefaults, type Award } from "./awards.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { MemoryInvitationLimiter, RepoDirectAwardClaims, type ClaimOutcome, type DirectAwardClaims, type InvitationLimiter } from "./direct-award-store.ts";
import { mailMembers } from "./member-mail.ts";
import { checkSigner } from "./organization.ts";
import { verificationOf } from "./profile.ts";
import type { Repos } from "./repos/types.ts";

/** How long an invitation link works. Resending issues a new link with a new period. */
export const DIRECT_AWARD_INVITATION_TTL_DAYS = 14;
/** Invitation emails (new and resent) per funder workspace over a rolling 24 hours. */
export const DIRECT_AWARD_INVITES_PER_DAY = 25;
/** Funder roles that may give an award directly. People only: an agent's request waits for one of them. */
export const DIRECT_AWARD_ROLES = ["admin", "finance"] as const;
/** Recognizable so the log redactor and secret scanners can spot one. */
export const INVITATION_TOKEN_PREFIX = "gms_awi_";

const DAY_MS = 86_400_000;
/** Funder members emailed when an invitation is accepted or declined. */
const NOTIFIED_ROLES = ["admin", "program_officer", "finance"] as const;

// ------------------------------------------------------------------------------------ ports

const fallbackLimiters = new WeakMap<Repos, InvitationLimiter>();
const fallbackClaims = new WeakMap<Repos, DirectAwardClaims>();
const limiterFor = (ctx: ServiceContext): InvitationLimiter => {
  if (ctx.ports.invitationLimiter) return ctx.ports.invitationLimiter;
  let l = fallbackLimiters.get(ctx.repos);
  if (!l) fallbackLimiters.set(ctx.repos, (l = new MemoryInvitationLimiter()));
  return l;
};
const claimsFor = (ctx: ServiceContext): DirectAwardClaims => {
  if (ctx.ports.directAwardClaims) return ctx.ports.directAwardClaims;
  let c = fallbackClaims.get(ctx.repos);
  if (!c) fallbackClaims.set(ctx.repos, (c = new RepoDirectAwardClaims(ctx.repos)));
  return c;
};

// ------------------------------------------------------------------------------------ input

/**
 * Web and email addresses in text the funder types. The invitation email may carry no link but the
 * claim link and the GMS home, and mail programs turn written addresses into links, so funder text
 * that names one is refused rather than sent (the stricter reading of the contract).
 */
export const FUNDER_TEXT_LINK = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|us|gov|edu|info|biz|app|dev|link|xyz|me|ly|site|online|ru|cn|top|click)\b)/i;
const noLinks = (what: string) => (v: string | undefined) => !v || !FUNDER_TEXT_LINK.test(v) || { message: `${what} cannot contain a web or email address` };
const textWithoutLinks = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => noLinks(what)(v) === true, { message: `${what} cannot contain a web or email address` });

const emailInput = z
  .email()
  .max(320)
  .transform((v) => v.trim().toLowerCase());

const DECIMAL = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

export const directAwardInput = z
  .object({
    recipient: z.object({ organizationName: textWithoutLinks(200, "The organization name"), contactEmail: emailInput }).strict(),
    title: textWithoutLinks(300, "The award title"),
    amount: z.object({ value: z.string().regex(DECIMAL, "Use a decimal amount such as 25000.00"), currency: z.literal("USD") }).strict(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    programId: z.uuid().optional(),
    message: z
      .string()
      .trim()
      .max(DIRECT_AWARD_MESSAGE_MAX)
      .refine((v) => !v || !FUNDER_TEXT_LINK.test(v), { message: "The message cannot contain a web or email address. The email already links to the award" })
      .optional(),
  })
  .strict()
  .refine((i) => !!i.startDate === !!i.endDate, { path: ["endDate"], message: "Give both the start and the end of the grant period, or neither" })
  .refine((i) => !i.startDate || !i.endDate || i.startDate <= i.endDate, { path: ["endDate"], message: "The grant period ends before it starts" })
  .refine((i) => !DECIMAL.test(i.amount?.value ?? "") || toMinor({ amount: i.amount.value, currency: "USD" }) > 0, { path: ["amount", "value"], message: "The amount must be more than zero" });
export type DirectAwardInput = z.output<typeof directAwardInput>;

export const resendInput = z.object({ contactEmail: emailInput.optional() }).strict();

const TOKEN = z.string().min(40).max(200);
export const lookupInput = z.object({ token: TOKEN }).strict();
export const acceptInput = z.object({ token: TOKEN, workspaceId: z.uuid(), name: z.string().trim().min(2).max(200).optional() }).strict();
export const declineInput = z.object({ token: TOKEN, reason: z.string().trim().max(2000).optional() }).strict();

// ------------------------------------------------------------------------------------ funder side

/** Who may send: a person with one of DIRECT_AWARD_ROLES in a funder workspace. An agent's call waits for one. */
async function sender(ctx: ServiceContext) {
  // Finance holds no `awards:write`; the role list and the human gate decide here.
  const ws = await authorize(ctx, { scope: "awards:read", kind: "funder", roles: DIRECT_AWARD_ROLES, person: true });
  if (ctx.actor.kind !== "user" || !ctx.actor.userId || ws.role === null) throw humanOnly("Giving an award directly");
  if (!ctx.ports.mailer || !ctx.config.mailFrom) throw new ApiError(503, "mail_not_configured", "Outbound mail is not configured on this server, so the invitation cannot be sent. Nothing was created");
  return ws;
}

async function countSend(ctx: ServiceContext, workspaceId: string) {
  if (!(await limiterFor(ctx).claim(workspaceId, DIRECT_AWARD_INVITES_PER_DAY, ctx.now()))) {
    throw new ApiError(429, "too_many_invitations", `This workspace has sent ${DIRECT_AWARD_INVITES_PER_DAY} award invitations in the last 24 hours, the most we allow. Try again later`);
  }
}

const newToken = async () => {
  const token = randomToken(INVITATION_TOKEN_PREFIX);
  return { token, hash: await sha256b64url(token) };
};

/** The email for one invitation. The token is used for the link and dropped; it is never stored or logged. */
async function sendInvitation(ctx: ServiceContext, award: Award, inv: AwardInvitation, token: string): Promise<boolean> {
  const funder = required(await ctx.repos.table("workspaces").one({ id: award.workspace_id }), "Workspace");
  const period = keyDatesOf(award).periodOfPerformance;
  const email = directAwardInvitationEmail({
    funderName: funder.display_name,
    funderVerified: verificationOf(funder).source === "passport",
    organizationName: inv.organization_name,
    awardTitle: award.title,
    amount: printMoney(minorOf(fundingOf(award).awardedAmount) ?? 0, currencyOf(award)),
    period: period?.startDate && period.endDate ? { startDate: period.startDate, endDate: period.endDate } : null,
    message: inv.message,
    invitedEmail: inv.email,
    claimUrl: `${ctx.config.webBaseUrl}/awards/claim?token=${encodeURIComponent(token)}`,
    homeUrl: `${ctx.config.webBaseUrl}/`,
    expiresOn: inv.expires_at.slice(0, 10),
  });
  try {
    await ctx.ports.mailer!.send({ from: ctx.config.mailFrom!, to: [inv.email], subject: email.subject, text: email.text, html: email.html, idempotencyKey: `award-invitation:${inv.id}:${inv.sent_count}` });
    return true;
  } catch {
    // The invitation stands; the funder can resend it.
    await audit(ctx, "award.invitation_email_failed", "award", award.id, { invitationId: inv.id, sentCount: inv.sent_count }, award.workspace_id);
    return false;
  }
}

/** `POST /gms/awards/direct`: create the award in `offered` for a named organization and email the invitation. */
export async function createDirectAward(ctx: ServiceContext, input: DirectAwardInput) {
  const ws = await sender(ctx);
  const program = input.programId ? await ctx.repos.table("programs").one({ id: input.programId, workspace_id: ws.id }) : null;
  if (input.programId && !program) throw notFound("Program");
  await countSend(ctx, ws.id);
  const { token, hash } = await newToken();
  const now = ctx.now();
  let award: Award;
  let inv: AwardInvitation;
  try {
    award = await createOfferedAward(
      ctx,
      {
        workspaceId: ws.id,
        recipientWorkspaceId: null,
        recipientIndividual: { name: input.recipient.organizationName },
        applicationId: null,
        opportunityId: null,
        programId: program?.id ?? null,
        title: input.title,
        awardedMinor: toMinor({ amount: input.amount.value, currency: input.amount.currency }),
        currency: input.amount.currency,
        conditions: [],
        ...(input.startDate && input.endDate ? { period: { startDate: input.startDate, endDate: input.endDate } } : {}),
      },
      readDefaults(program),
    );
    inv = await ctx.repos.table("award_invitations").insert({
      workspace_id: ws.id,
      award_id: award.id,
      email: input.recipient.contactEmail,
      organization_name: input.recipient.organizationName,
      message: input.message || null,
      token_hash: hash,
      expires_at: new Date(now.getTime() + DIRECT_AWARD_INVITATION_TTL_DAYS * DAY_MS).toISOString(),
      sent_count: 1,
      last_sent_at: now.toISOString(),
      created_by: ctx.actor.userId!,
    });
  } catch (e) {
    await limiterFor(ctx).release(ws.id, now).catch(() => undefined);
    throw e;
  }
  const emailed = await sendInvitation(ctx, award, inv, token);
  await audit(ctx, "award.invitation_sent", "award", award.id, { invitationId: inv.id, email: maskEmail(inv.email), sentCount: 1, expiresAt: inv.expires_at, emailed }, ws.id);
  return { ...(await awardDetail(ctx, award)), emailed };
}

async function funderInvitation(ctx: ServiceContext, workspaceId: string, awardId: string) {
  const award = await ctx.repos.table("awards").one({ id: awardId, workspace_id: workspaceId });
  const inv = award ? await ctx.repos.table("award_invitations").one({ award_id: award.id, workspace_id: workspaceId }) : null;
  if (!award || !inv) throw notFound("Award invitation");
  return { award, inv };
}

/** `POST /gms/awards/{id}/invitation/resend`: a new link (the old one stops working), optionally to a new address. */
export async function resendInvitation(ctx: ServiceContext, awardId: string, input: z.output<typeof resendInput>) {
  const ws = await sender(ctx);
  const { award, inv } = await funderInvitation(ctx, ws.id, awardId);
  const status = invitationStatus(inv, ctx.now());
  if (status === "accepted" || status === "declined" || status === "revoked" || award.status !== "offered") {
    throw new ApiError(409, "invitation_closed", status === "accepted" ? "This award was already accepted" : status === "declined" ? "This award was declined. Withdraw it, or give a new award" : "This award was withdrawn");
  }
  await countSend(ctx, ws.id);
  const { token, hash } = await newToken();
  const now = ctx.now();
  const email = input.contactEmail ?? inv.email;
  const [updated] = await ctx.repos.table("award_invitations").update(
    { id: inv.id, token_hash: inv.token_hash, accepted_at: null, declined_at: null, revoked_at: null },
    { token_hash: hash, email, expires_at: new Date(now.getTime() + DIRECT_AWARD_INVITATION_TTL_DAYS * DAY_MS).toISOString(), sent_count: inv.sent_count + 1, last_sent_at: now.toISOString() },
  );
  if (!updated) {
    await limiterFor(ctx).release(ws.id, now).catch(() => undefined);
    throw new ApiError(409, "conflict", "This invitation changed while you were working. Reload and try again");
  }
  const emailed = await sendInvitation(ctx, award, updated, token);
  await audit(ctx, "award.invitation_resent", "award", award.id, { invitationId: inv.id, email: maskEmail(email), sentCount: updated.sent_count, addressChanged: email !== inv.email, expiresAt: updated.expires_at, emailed }, ws.id);
  return { ...(await awardDetail(ctx, award)), emailed };
}

// ------------------------------------------------------------------------------------ grantee side

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** The invitation a token names; 404 `invitation_not_found` for anything else. */
async function byToken(ctx: ServiceContext, token: string) {
  const inv = await ctx.repos.table("award_invitations").one({ token_hash: await sha256b64url(token) });
  const award = inv ? await ctx.repos.table("awards").one({ id: inv.award_id, workspace_id: inv.workspace_id }) : null;
  if (!inv || !award) throw new ApiError(404, "invitation_not_found", "This invitation link is not valid. Ask the funder to send it again");
  return { inv, award };
}

/** The invitation as the grantee sees it: a withdrawn award reads as revoked. */
function granteeStatus(inv: AwardInvitation, award: Award, now: Date): "pending" | "accepted" | "declined" | "expired" | "revoked" {
  const s = invitationStatus(inv, now);
  if (s === "sent") return award.status === "offered" ? "pending" : "revoked";
  return s;
}

/** Email the funder's staff about the invitation (their in-app notice comes from the ledger). Never fails the action. */
async function noticeToFunder(ctx: ServiceContext, award: Award, subject: string, text: string, key: string) {
  const funder = await ctx.repos.table("workspaces").one({ id: award.workspace_id });
  await mailMembers(ctx, { workspaceId: award.workspace_id, category: "award", roles: NOTIFIED_ROLES, subject, text, ...(funder ? { link: `${ctx.config.webBaseUrl}/w/${funder.handle}/awards/${apiId("award", award.id)}` } : {}), idempotencyKey: key }).catch(() => undefined);
}

/** Ledger an expired link that someone tried to use, once per link. */
async function noteExpired(ctx: ServiceContext, inv: AwardInvitation) {
  // Since the link was last sent: a resent link that expires again is recorded again.
  if ((await ctx.ledger.list({ workspaceId: inv.workspace_id, eventType: "award.invitation_expired", subjectId: inv.award_id, from: inv.last_sent_at, limit: 1 })).length) return;
  await audit(ctx, "award.invitation_expired", "award", inv.award_id, { invitationId: inv.id, sentCount: inv.sent_count }, inv.workspace_id);
}

/** Applicant workspaces where this person is a current admin: where they may accept. */
async function adminWorkspaces(ctx: ServiceContext, userId: string) {
  const now = ctx.now().getTime();
  const rows = (await ctx.repos.table("workspace_members").find({ user_id: userId, role: "admin" })).filter((m) => !m.expires_at || Date.parse(m.expires_at) > now);
  const wss = rows.length ? await ctx.repos.table("workspaces").find({ id: rows.map((m) => m.workspace_id), kind: "applicant" }, { orderBy: "display_name" }) : [];
  return wss.map((w) => ({ id: w.id, name: w.display_name, verification: verificationOf(w) }));
}

/** `POST /gms/award-invitations/lookup`: what the invitation offers, for the signed-in person. */
export async function lookupInvitation(ctx: ServiceContext, input: z.output<typeof lookupInput>, signedInEmail: string | null) {
  await authorize(ctx, { person: true });
  const { inv, award } = await byToken(ctx, input.token);
  const status = granteeStatus(inv, award, ctx.now());
  if (status === "expired") await noteExpired(ctx, inv);
  const funder = required(await ctx.repos.table("workspaces").one({ id: inv.workspace_id }), "Workspace");
  const period = keyDatesOf(award).periodOfPerformance;
  const awarded = fundingOf(award).awardedAmount;
  const emailMatches = norm(signedInEmail) === inv.email;
  return {
    status,
    funder: { name: funder.display_name, handle: funder.handle, verification: verificationOf(funder) },
    award: { title: award.title, amount: awarded ? { value: awarded.amount, currency: awarded.currency } : null, startDate: period?.startDate ?? null, endDate: period?.endDate ?? null, message: inv.message },
    organizationName: inv.organization_name,
    invitedEmail: maskEmail(inv.email),
    emailMatches,
    workspaces: status === "pending" && emailMatches ? await adminWorkspaces(ctx, ctx.actor.userId!) : [],
  };
}

const usable = (ctx: ServiceContext, inv: AwardInvitation, award: Award) => {
  const status = granteeStatus(inv, award, ctx.now());
  if (status === "accepted" || status === "declined") return new ApiError(409, "invitation_used", "This invitation was already used");
  if (status === "revoked") return new ApiError(410, "invitation_revoked", "The funder withdrew this award");
  if (status === "expired") return new ApiError(410, "invitation_expired", "This invitation has expired. Ask the funder to send it again");
  return null;
};
const mismatch = (inv: AwardInvitation) => forbidden("email_mismatch", `Sign in with the address the invitation was sent to: ${maskEmail(inv.email)}`);
const notAdmin = () => forbidden("not_workspace_admin", "You can accept only for an organization workspace where you are an admin");

function refusal(outcome: ClaimOutcome, inv: AwardInvitation): ApiError {
  switch (outcome) {
    case "not_found":
      return new ApiError(404, "invitation_not_found", "This invitation link is not valid. Ask the funder to send it again");
    case "used":
      return new ApiError(409, "invitation_used", "This invitation was already used");
    case "revoked":
      return new ApiError(410, "invitation_revoked", "The funder withdrew this award");
    case "expired":
      return new ApiError(410, "invitation_expired", "This invitation has expired. Ask the funder to send it again");
    case "email_mismatch":
      return mismatch(inv);
    case "not_workspace_admin":
      return notAdmin();
    default:
      return new ApiError(409, "conflict", "This award changed while you were working. Reload and try again");
  }
}

/**
 * `POST /gms/award-invitations/accept`. The person must be signed in with the invited address, an
 * admin of the applicant workspace (with the second step that role requires, `secondStep`), and
 * the link valid and unused. One transaction then attaches the award, records the consent and
 * marks the invitation accepted (the write of `accept_offer`); the ledger, webhooks, the Passport
 * mirror and the funder's notice follow as for any accepted award.
 */
export async function acceptInvitation(ctx: ServiceContext, input: z.output<typeof acceptInput>, signedInEmail: string | null, secondStep: () => Promise<boolean>) {
  await authorize(ctx, { person: true });
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw humanOnly("Accepting an award");
  const userId = ctx.actor.userId;
  const { inv, award } = await byToken(ctx, input.token);
  const closed = usable(ctx, inv, award);
  if (closed) {
    if (closed.code === "invitation_expired") await noteExpired(ctx, inv);
    throw closed;
  }
  if (norm(signedInEmail) !== inv.email) throw mismatch(inv);
  const member = await ctx.repos.table("workspace_members").one({ workspace_id: input.workspaceId, user_id: userId });
  const target = member ? await ctx.repos.table("workspaces").one({ id: input.workspaceId }) : null;
  if (!member || !target || member.role !== "admin" || target.kind !== "applicant" || (member.expires_at && Date.parse(member.expires_at) <= ctx.now().getTime())) throw notAdmin();
  // The role's own rule: an applicant admin acts only after two-step verification.
  if (!(await secondStep())) throw forbidden("mfa_required", "This role requires two-step verification. Verify with your authenticator app to continue");

  // From here the caller acts as that workspace's admin, as on the offer screen.
  const recipientCtx: ServiceContext = { ...ctx, workspace: { id: target.id, kind: "applicant", role: member.role, memberScope: (member.scope as Record<string, unknown> | null) ?? null }, scopes: scopesForRole("applicant", member.role) };
  // The typed legal name must be a verified representative when Passport lists any (as `acceptOffer`).
  const authority = await checkSigner(recipientCtx, target.id, input.name ?? null);

  const ports = grantPorts(recipientCtx, award.workspace_id);
  let consentId: string | null = null;
  const r = await awardMachine.transition({ id: award.id, status: award.status as "offered" }, "accept_offer", { id: ctx.actor.id, kind: "applicant" }, { now: ctx.now().toISOString() }, {
    ...ports,
    write: async (change) => {
      if (change.subjectType !== "award" || change.from !== "offered" || change.to !== "accepted") throw new Error("A direct award is claimed only by accept_offer");
      const claimed = await claimsFor(ctx).claim({ tokenHash: inv.token_hash, workspaceId: target.id, userId, email: signedInEmail ?? "", cgStatus: awardCgStatus("accepted").value }, ctx.now());
      if (claimed.outcome !== "claimed") throw refusal(claimed.outcome, inv);
      consentId = claimed.consentId;
    },
  });
  if (!r.ok) throw new ApiError(r.code === "actor_not_allowed" ? 403 : 409, r.code, r.reason);

  await audit(recipientCtx, "award.invitation_accepted", "award", award.id, { invitationId: inv.id, workspaceId: target.id, email: maskEmail(inv.email) }, award.workspace_id);
  await audit(recipientCtx, "award.claimed", "award", award.id, { invitationId: inv.id, workspaceId: target.id, consentId }, award.workspace_id);
  await audit(recipientCtx, "award.acceptance_signer_checked", "award", award.id, { rule: authority.rule, reason: authority.reason, representativeId: authority.representativeId, name: input.name ?? null }, award.workspace_id);
  if (consentId) await audit(recipientCtx, "consent.granted", "workspace", target.id, { funderWorkspaceId: award.workspace_id, basis: "award" }, target.id);
  const accepted = required(await ctx.repos.table("awards").one({ id: award.id }), "Award");
  if (awardEffects("accepted").mirrorToPassport) await mirrorAward(recipientCtx, accepted);
  await noticeToFunder(ctx, award, `${target.display_name} accepted ${award.title}`, `${target.display_name} accepted the award "${award.title}" that was offered to ${inv.organization_name}. The organization now shares its record with you, and the award follows its usual steps from here.`, `award-claimed:${award.id}`);
  return { awardId: apiId("award", award.id), workspaceId: target.id };
}

/** `POST /gms/award-invitations/decline`: only the invited person; the funder is told and decides whether to withdraw. */
export async function declineInvitation(ctx: ServiceContext, input: z.output<typeof declineInput>, signedInEmail: string | null) {
  await authorize(ctx, { person: true });
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw humanOnly("Declining an award");
  const { inv, award } = await byToken(ctx, input.token);
  const closed = usable(ctx, inv, award);
  if (closed) {
    if (closed.code === "invitation_expired") await noteExpired(ctx, inv);
    throw closed;
  }
  if (norm(signedInEmail) !== inv.email) throw mismatch(inv);
  const now = ctx.now().toISOString();
  const [declined] = await ctx.repos.table("award_invitations").update({ id: inv.id, token_hash: inv.token_hash, accepted_at: null, declined_at: null, revoked_at: null }, { declined_at: now, decline_reason: input.reason || null });
  if (!declined) throw new ApiError(409, "invitation_used", "This invitation was already used");
  // The reason is the declining person's own words for the funder; it stays on the invitation, out of the ledger.
  await audit(ctx, "award.invitation_declined", "award", award.id, { invitationId: inv.id, email: maskEmail(inv.email), reasonGiven: !!input.reason }, award.workspace_id);
  await noticeToFunder(ctx, award, `${inv.organization_name} declined ${award.title}`, `The award "${award.title}" offered to ${inv.organization_name} was declined.${input.reason ? `\n\nTheir reason: ${input.reason}` : ""}\n\nYou can withdraw the award, or keep it open.`, `award-declined:${award.id}`);
  return { status: "declined" as const };
}
