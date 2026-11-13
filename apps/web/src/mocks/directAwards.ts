// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/directAwards.ts. It keeps the contract's rules where a screen depends
// on them: a link works for one signed-in person (the address it was sent to) and one organization
// they administer, it works once, it expires, a resend replaces the old link, and a funder may send
// 25 a day. The "email" a real install would send is kept in an outbox the tests and the demo read
// (`outbox()`); the token is never in an API path.
import type { AwardDetail, AwardSummary, FunderApi } from "../api/funder.ts";
import type { FunderFullApi } from "../api/funderFull.ts";
import type { AwardInvitation, DirectAwardsApi, DirectAwardView, InvitationLookup, InvitationStatus } from "../api/directAwards.ts";
import type { Me } from "../api/client.ts";
import type { Verification } from "../api/types.ts";
import { directAwardProblems, FUNDER_TEXT_LINK, maskEmail, normalizeAmount, type DirectAwardForm } from "../lib/directAward.ts";
import type { MockFunderCtx } from "./funder.ts";

/** Contract constants, one place to change. */
export const DIRECT_AWARD_INVITATION_TTL_DAYS = 14;
export const DIRECT_AWARD_INVITES_PER_DAY = 25;
/** Lower for a funder that is not verified with Passport at L1 or above. */
export const DIRECT_AWARD_INVITES_PER_DAY_UNVERIFIED = 10;
const DAY = 86_400_000;

interface Rec {
  awardId: string;
  funderWorkspaceId: string;
  funder: { name: string; workspaceName: string | null; handle: string; verification: Verification; verified: boolean };
  organizationName: string;
  email: string;
  token: string;
  status: InvitationStatus;
  sentAt: string;
  expiresAt: string;
  sentCount: number;
  message: string | null;
  declineReason: string | null;
  /** Consent recorded on acceptance: the organization shares its record with this funder. */
  consent: { workspaceId: string; basis: "award"; at: string } | null;
}

export interface MockOutboxEntry {
  to: string;
  awardId: string;
  /** The claim link as the email carries it. */
  link: string;
  at: string;
  /** The funder's workspace name, exactly as it is in the email. */
  funderName: string;
  notVerifiedLine: boolean;
}

export interface MockDirectCtx extends MockFunderCtx {
  me: () => Promise<Me>;
  /** An applicant workspace the signed-in person belongs to, as the claim screen shows it. */
  applicantInfo: (workspaceId: string) => { name: string; handle: string; verification: Verification } | null;
  /** Called when a claim attaches an award to a workspace, so the grantee's own screens show it. */
  published?: (award: AwardDetail) => void;
}

type Inner = FunderApi & FunderFullApi;
export type MockDirectAwardsApi = DirectAwardsApi &
  Pick<Inner, "listAwards" | "getAward" | "cancelAward"> & {
    /** Mock only: what a real install would have emailed. */
    outbox(): MockOutboxEntry[];
    /** Mock only: make the next sends fail the way an unreachable mail service does (`emailed: false`). */
    failMail(failing: boolean): void;
    /** Mock only: where a claim hands the award to the grantee's own mock store. */
    onPublished(cb: (award: AwardDetail) => void): void;
  };

const code = (c: string) => [{ code: c }];
const norm = (e: string) => e.trim().toLowerCase();

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createMockDirectAwardsApi(ctx: MockDirectCtx, inner: Inner): MockDirectAwardsApi {
  const recs = new Map<string, Rec>(); // by token
  const awards = new Map<string, AwardDetail>(); // by award id
  const sendLog = new Map<string, number[]>();
  const outbox: MockOutboxEntry[] = [];
  let publish: ((award: AwardDetail) => void) | undefined = ctx.published;
  let n = 0;
  let mailFailing = false;

  const recOfAward = (awardId: string) => [...recs.values()].find((r) => r.awardId === awardId);
  /** An invitation that is still "sent" past its expiry reads as expired, wherever it is looked at. */
  const settle = (r: Rec): Rec => {
    if (r.status === "sent" && Date.parse(r.expiresAt) <= Date.parse(ctx.now())) r.status = "expired";
    return r;
  };
  const invitationOf = (r: Rec): AwardInvitation => ({ email: maskEmail(r.email), status: settle(r).status, sentAt: r.sentAt, expiresAt: r.expiresAt });

  /** The funder's view: the invitation rides on the recipient until a workspace has claimed the award. */
  function viewOf(a: AwardDetail, r: Rec): AwardDetail;
  function viewOf(a: AwardDetail, r: Rec, emailed: boolean): DirectAwardView;
  function viewOf(a: AwardDetail, r: Rec, emailed?: boolean): AwardDetail | DirectAwardView {
    const v = structuredClone(a);
    (v.recipient as { invitation?: AwardInvitation } | null) = { ...(v.recipient as object), invitation: invitationOf(r) } as never;
    return emailed === undefined ? v : { ...v, emailed };
  }
  const summary = (a: AwardDetail): AwardSummary => {
    const { agreement: _a, tranches: _t, requirements: _r, amendments: _m, ...rest } = a;
    return rest;
  };

  /** Creating needs `awards:write` (admin, program officer); resending also lets finance in. */
  async function funderRole(action: "create" | "resend"): Promise<{ id: string; name: string; handle: string; verification: Verification }> {
    const w = await ctx.ws();
    const me = await ctx.me();
    const role = me.workspaces.find((m) => m.id === w.record.id)?.role;
    const allowed = action === "create" ? ["admin", "program_officer"] : ["admin", "program_officer", "finance"];
    if (!role || !allowed.includes(role)) throw ctx.fail(403, action === "create" ? "This action needs the awards:write scope" : "Your role cannot resend invitations.", code(action === "create" ? "insufficient_scope" : "forbidden"));
    // A funder name that reads as a link is not sent under.
    if (FUNDER_TEXT_LINK.test(w.record.displayName)) throw ctx.fail(422, "Your workspace's name looks like a web or email address, so award invitations cannot be sent under it. Rename the workspace in its settings, then try again", code("funder_name_looks_like_link"));
    return { id: w.record.id, name: w.record.displayName, handle: w.record.handle, verification: w.record.verification };
  }

  function spend(workspaceId: string, verification: Verification) {
    const since = Date.parse(ctx.now()) - DAY;
    const recent = (sendLog.get(workspaceId) ?? []).filter((t) => t > since);
    const verified = verification.source === "passport" && /^L[1-3]$/.test(verification.level ?? "");
    if (recent.length >= (verified ? DIRECT_AWARD_INVITES_PER_DAY : DIRECT_AWARD_INVITES_PER_DAY_UNVERIFIED)) throw ctx.fail(429, "You have sent the most invitations allowed in a day. Try again tomorrow.", code("too_many_invitations"));
    sendLog.set(workspaceId, [...recent, Date.parse(ctx.now())]);
    }

  /** The invitation email. A failed send still leaves the invitation standing, as the real service does. */
  function deliver(r: Rec): boolean {
    if (mailFailing) return false;
    const link = `/awards/claim#token=${r.token}`;
    outbox.push({ to: r.email, awardId: r.awardId, link, at: ctx.now(), funderName: r.funder.name, notVerifiedLine: r.funder.verification.source !== "passport" });
    return true;
  }

  const mine = (awardId: string) => {
    const a = awards.get(awardId);
    const r = a && recOfAward(awardId);
    return a && r ? { a, r } : null;
  };

  return {
    outbox: () => structuredClone(outbox),
    failMail(failing) {
      mailFailing = failing;
    },
    onPublished(cb) {
      publish = cb;
    },

    async listAwards(filter = {}) {
      const w = await ctx.ws();
      const direct = [...awards.values()].filter((a) => recOfAward(a.id)?.funderWorkspaceId === w.record.id && (!filter.status || a.status === filter.status)).map((a) => summary(viewOf(a, recOfAward(a.id)!)));
      return [...direct, ...(await inner.listAwards(filter))];
    },
    async getAward(id) {
      const found = mine(id);
      if (!found) return inner.getAward(id);
      if (found.r.funderWorkspaceId !== (await ctx.ws()).record.id) throw ctx.fail(404, "Award not found");
      return viewOf(found.a, found.r);
    },
    async cancelAward(id, reason) {
      const found = mine(id);
      if (!found) return inner.cancelAward(id, reason);
      // Cancel keeps its existing roles: finance can give an award directly but not withdraw it.
      const role = (await ctx.me()).workspaces.find((m) => m.id === found.r.funderWorkspaceId)?.role;
      if (role !== "admin" && role !== "program_officer") throw ctx.fail(403, "Your role cannot cancel an award.");
      if (!reason.trim()) throw ctx.fail(422, "Say why you are withdrawing this award.");
      if (found.a.status === "cancelled") throw ctx.fail(409, "This award is already cancelled.");
      found.a.status = "cancelled";
      found.a.updatedAt = ctx.now();
      if (found.r.status === "sent" || found.r.status === "expired") found.r.status = "revoked";
      return viewOf(found.a, found.r);
    },

    async createDirectAward(input) {
      const funder = await funderRole("create");
      const form: DirectAwardForm = { organizationName: input.recipient.organizationName, contactEmail: input.recipient.contactEmail, title: input.title, amount: input.amount.value, startDate: input.startDate ?? "", endDate: input.endDate ?? "", programId: input.programId ?? "", message: input.message ?? "" };
      const problems = directAwardProblems(form);
      if (Object.keys(problems).length) throw ctx.fail(422, "Check the award details", Object.entries(problems).map(([path, message]) => ({ path, message })));
      const w = await ctx.ws();
      if (input.programId && !w.programs.some((p) => p.id === input.programId)) throw ctx.fail(422, "Check the award details", [{ path: "programId", message: "Choose one of your programs." }]);
      spend(funder.id, funder.verification);
      const now = ctx.now();
      const minor = Math.round(Number(normalizeAmount(input.amount.value)) * 100);
      n += 1;
      const award: AwardDetail = {
        id: `awd_f0000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
        title: input.title.trim(),
        description: null,
        status: "offered",
        currency: "USD",
        requestedAmountMinor: null,
        awardedAmountMinor: minor,
        disbursedAmountMinor: 0,
        disbursedAt: null,
        keyDates: input.startDate && input.endDate ? { periodOfPerformance: { startDate: input.startDate, endDate: input.endDate } } : {},
        conditions: [],
        applicationId: null,
        opportunityId: null,
        programId: input.programId ?? null,
        parentAwardId: null,
        funder: { workspaceId: funder.id, name: funder.name, handle: funder.handle, brand: null },
        // Pending: no workspace yet, so nothing about an organization is known beyond the name typed.
        recipient: { workspaceId: null, name: input.recipient.organizationName.trim(), handle: null, level: null, verification: null },
        recipientIndividual: { name: input.recipient.organizationName.trim() },
        passport: { awardId: null, syncedAt: null, mirror: "not_applicable" },
        createdAt: now,
        updatedAt: now,
        agreement: null,
        tranches: [],
        requirements: [],
        amendments: [],
      };
      const token = newToken();
      const rec: Rec = {
        awardId: award.id,
        funderWorkspaceId: funder.id,
        funder: { name: funder.name, workspaceName: null, handle: funder.handle, verification: funder.verification, verified: funder.verification.source === "passport" && /^L[1-3]$/.test(funder.verification.level ?? "") },
        organizationName: award.recipient!.name!,
        email: input.recipient.contactEmail.trim(),
        token,
        status: "sent",
        sentAt: now,
        expiresAt: new Date(Date.parse(now) + DIRECT_AWARD_INVITATION_TTL_DAYS * DAY).toISOString(),
        sentCount: 1,
        message: input.message?.trim() || null,
        declineReason: null,
        consent: null,
      };
      awards.set(award.id, award);
      recs.set(token, rec);
      return viewOf(award, rec, deliver(rec));
    },

    async resendInvitation(awardId, input = {}) {
      const funder = await funderRole("resend");
      const found = mine(awardId);
      if (!found || found.r.funderWorkspaceId !== funder.id) throw ctx.fail(404, "Award not found");
      const { a, r } = found;
      settle(r);
      if (r.status === "accepted" || r.status === "declined" || a.status === "cancelled" || r.status === "revoked") throw ctx.fail(409, a.status === "cancelled" || r.status === "revoked" ? "This award was withdrawn." : r.status === "declined" ? "This award was declined. Withdraw it, or give a new award." : "This award was already accepted.", code("invitation_closed"));
      const email = input.contactEmail?.trim();
      if (email !== undefined && email !== "") {
        const p = directAwardProblems({ organizationName: "x", contactEmail: email, title: "x", amount: "1", startDate: "", endDate: "", programId: "", message: "" });
        if (p.contactEmail) throw ctx.fail(422, "Check the address", [{ path: "contactEmail", message: p.contactEmail }]);
      }
      spend(funder.id, funder.verification);
      recs.delete(r.token);
      r.token = newToken();
      if (email) r.email = email;
      r.status = "sent";
      r.sentAt = ctx.now();
      r.expiresAt = new Date(Date.parse(r.sentAt) + DIRECT_AWARD_INVITATION_TTL_DAYS * DAY).toISOString();
      r.sentCount += 1;
      recs.set(r.token, r);
      return viewOf(a, r, deliver(r));
    },

    async lookupAwardInvitation(token) {
      const me = await ctx.me();
      const r = recs.get(token);
      const a = r && awards.get(r.awardId);
      if (!r || !a) throw ctx.fail(404, "This invitation link is not valid.", code("invitation_not_found"));
      settle(r);
      const minor = a.awardedAmountMinor ?? 0;
      const period = a.keyDates.periodOfPerformance as { startDate?: string; endDate?: string } | undefined;
      const emailMatches = norm(me.email) === norm(r.email);
      const workspaces = (r.status !== "sent" || !emailMatches ? [] : me.workspaces)
        .filter((m) => m.kind === "applicant" && m.role === "admin")
        .flatMap((m) => {
          const info = ctx.applicantInfo(m.id);
          return info ? [{ id: m.id, name: info.name, verification: info.verification }] : [];
        });
      const out: InvitationLookup = {
        status: r.status === "sent" ? "pending" : r.status,
        funder: r.funder,
        award: { title: a.title, amount: { value: `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`, currency: a.currency }, startDate: period?.startDate ?? null, endDate: period?.endDate ?? null, message: r.message },
        organizationName: r.organizationName,
        invitedEmail: maskEmail(r.email),
        emailMatches,
        workspaces,
      };
      return out;
    },

    async acceptAwardInvitation({ token, workspaceId, name }) {
      const me = await ctx.me();
      const r = recs.get(token);
      const a = r && awards.get(r.awardId);
      if (!r || !a) throw ctx.fail(404, "This invitation link is not valid.", code("invitation_not_found"));
      settle(r);
      if (r.status === "expired") throw ctx.fail(410, "This invitation has expired. Ask the funder to send a new one.", code("invitation_expired"));
      if (r.status === "revoked") throw ctx.fail(410, "The funder withdrew this award.", code("invitation_revoked"));
      if (r.status !== "sent") throw ctx.fail(409, "This invitation was already used.", code("invitation_used"));
      if (norm(me.email) !== norm(r.email)) throw ctx.fail(403, `Sign in with the address the invitation was sent to: ${maskEmail(r.email)}`, code("email_mismatch"));
      const membership = me.workspaces.find((m) => m.id === workspaceId && m.kind === "applicant");
      const info = membership && ctx.applicantInfo(workspaceId);
      if (!membership || !info || membership.role !== "admin") throw ctx.fail(403, "Only an admin of the organization can accept an award for it.", code("not_workspace_admin"));
      if (membership.requiresMfa && !me.mfaVerified) throw ctx.fail(403, "Finish the second step of sign-in, then accept.", code("mfa_required"));
      // Where Passport lists verified representatives, the typed legal name is required.
      if (info.verification.source === "passport" && (name ?? "").trim().length < 2) throw ctx.fail(422, "Type your full legal name. It must match one of your organization's verified representatives in Passport", code("signer_name_required"));
      const at = ctx.now();
      // One step: the award moves to the workspace, is accepted, and the organization's consent is recorded.
      r.status = "accepted";
      r.consent = { workspaceId, basis: "award", at };
      a.status = "accepted";
      a.updatedAt = at;
      a.recipient = { workspaceId, name: info.name, handle: info.handle, level: info.verification.level, verification: info.verification };
      a.recipientIndividual = null;
      a.passport = { awardId: null, syncedAt: null, mirror: "pending" };
      publish?.(structuredClone(a));
      return { awardId: a.id, workspaceId };
    },

    async declineAwardInvitation({ token, reason }) {
      const me = await ctx.me();
      const r = recs.get(token);
      if (!r) throw ctx.fail(404, "This invitation link is not valid.", code("invitation_not_found"));
      settle(r);
      if (r.status === "expired") throw ctx.fail(410, "This invitation has expired.", code("invitation_expired"));
      if (r.status === "revoked") throw ctx.fail(410, "The funder withdrew this award.", code("invitation_revoked"));
      if (r.status !== "sent") throw ctx.fail(409, "This invitation was already used.", code("invitation_used"));
      if (reason && FUNDER_TEXT_LINK.test(reason)) throw ctx.fail(400, "The reason cannot contain a web or email address", code("bad_request"));
      if (norm(me.email) !== norm(r.email)) throw ctx.fail(403, `Sign in with the address the invitation was sent to: ${maskEmail(r.email)}`, code("email_mismatch"));
      r.status = "declined";
      r.declineReason = reason?.trim() || null;
      return { status: "declined" as const };
    },
  };
}
