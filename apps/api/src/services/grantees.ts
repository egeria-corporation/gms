// SPDX-License-Identifier: AGPL-3.0-only
// The grantee directory and organization changes in both directions (build spec §11.8), plus the
// CommonGrants `/orgs` routes. Passport is the identity source: the GMS shows the cached
// projection and proposes changes to Passport; it never edits a profile locally.
import { PassportApiError, PassportAuthError, PassportClient, PassportUnavailableError, type CgOrgChange } from "@gms/passport-client";
import { consentTokens } from "./passport-tokens.ts";
import { z } from "zod";
import { fundingOf, minorOf } from "./awards.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { STAFF_ROLES } from "./awards.ts";
import { audit, authorize, emit, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { passportClientFor } from "./passport-link.ts";
import { payeeFactsOf } from "./payments.ts";
import type { PageRequest } from "./programs.ts";
import { namesOf, profileSourceOf, selfDeclaredOf, verificationOf } from "./profile.ts";
import { RepoError, type Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;
type Org = Record<string, unknown>;

/** Applicant workspaces this funder has a relationship with: a submitted application or an award. */
async function relatedApplicants(ctx: ServiceContext, funderId: string): Promise<string[]> {
  const [apps, awards] = await Promise.all([ctx.repos.table("applications").find({ workspace_id: funderId }, { limit: 5000 }), ctx.repos.table("awards").find({ workspace_id: funderId }, { limit: 5000 })]);
  return [...new Set([...apps.filter((a) => a.submitted_at).map((a) => a.applicant_workspace_id), ...awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x)])];
}

const consented = async (ctx: ServiceContext, applicantId: string, funderId: string) => !!(await ctx.repos.table("consents").one({ applicant_workspace_id: applicantId, funder_workspace_id: funderId, revoked_at: null }));

function summary(w: Ws, record: Row<"grantee_records"> | undefined, counts: { applications: number; awards: number; pendingChanges: number; totalAwardedMinor?: number }) {
  const facts = payeeFactsOf(w);
  return { workspaceId: w.id, totalAwardedMinor: counts.totalAwardedMinor ?? 0, handle: w.handle, ...namesOf(w), legalName: w.legal_name, passportOrgId: w.passport_org_id, verificationLevel: verificationOf(w).level, verification: verificationOf(w), payee: { pendingDestinationChange: !!facts.pendingDestinationChange, active: facts.active !== false }, tags: record?.tags ?? [], ownerUserId: record?.owner_user_id ?? null, ...counts };
}

export async function listGrantees(ctx: ServiceContext, page: PageRequest, f: { q?: string | undefined; tag?: string | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "grantees:read", kind: "funder" });
  const ids = await relatedApplicants(ctx, ws.id);
  if (!ids.length) return { items: [], total: 0 };
  const [workspaces, records, apps, awards, inbox] = await Promise.all([
    ctx.repos.table("workspaces").find({ id: ids }),
    ctx.repos.table("grantee_records").find({ workspace_id: ws.id }),
    ctx.repos.table("applications").find({ workspace_id: ws.id }, { limit: 5000 }),
    ctx.repos.table("awards").find({ workspace_id: ws.id }, { limit: 5000 }),
    ctx.repos.table("org_change_inbox").find({ workspace_id: ws.id, status: "pending" }),
  ]);
  const q = f.q?.trim().toLowerCase();
  const all = workspaces
    .map((w) => summary(w, records.find((r) => r.applicant_workspace_id === w.id), { applications: apps.filter((a) => a.applicant_workspace_id === w.id && a.submitted_at).length, awards: awards.filter((a) => a.recipient_workspace_id === w.id).length, totalAwardedMinor: awards.filter((a) => a.recipient_workspace_id === w.id && !["cancelled", "offered"].includes(a.status)).reduce((sum, a) => sum + (minorOf(fundingOf(a).awardedAmount) ?? 0), 0), pendingChanges: inbox.filter((c) => c.passport_org_id === w.passport_org_id).length }))
    .filter((g) => (!q || `${g.name} ${g.legalName ?? ""} ${g.handle}`.toLowerCase().includes(q)) && (!f.tag || g.tags.includes(f.tag)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items: all.slice(page.offset, page.offset + page.pageSize), total: all.length };
}

async function grantee(ctx: ServiceContext, ws: ServiceWorkspace, applicantId: string): Promise<Ws> {
  const w = await ctx.repos.table("workspaces").one({ id: applicantId });
  if (!w || w.kind !== "applicant" || !(await relatedApplicants(ctx, ws.id)).includes(w.id)) throw notFound("Grantee");
  return w;
}

export async function getGrantee(ctx: ServiceContext, applicantId: string) {
  const ws = await authorize(ctx, { scope: "grantees:read", kind: "funder" });
  const w = await grantee(ctx, ws, applicantId);
  const [record, apps, awards, inbox, canRead] = await Promise.all([
    ctx.repos.table("grantee_records").one({ workspace_id: ws.id, applicant_workspace_id: w.id }),
    ctx.repos.table("applications").find({ workspace_id: ws.id, applicant_workspace_id: w.id }),
    ctx.repos.table("awards").find({ workspace_id: ws.id, recipient_workspace_id: w.id }),
    w.passport_org_id ? ctx.repos.table("org_change_inbox").find({ workspace_id: ws.id, passport_org_id: w.passport_org_id }, { orderBy: "created_at", ascending: false }) : Promise.resolve([]),
    consented(ctx, w.id, ws.id),
  ]);
  const facts = payeeFactsOf(w);
  return {
    ...summary(w, record ?? undefined, { applications: apps.filter((a) => a.submitted_at).length, awards: awards.length, pendingChanges: inbox.filter((c) => c.status === "pending").length }),
    notes: record?.notes ?? null,
    lastSyncedAt: record?.last_synced_at ?? w.org_projection_at,
    // The organization record is read by consent; without it the funder sees the name and level only.
    // A self-declared profile is the organization's own word, never a verified record: it comes separately.
    organization: canRead && profileSourceOf(w) === "passport" ? w.org_projection : null,
    selfDeclared: canRead ? selfDeclaredOf(w) : null,
    consent: canRead,
    payeeStatus: { pendingDestinationChange: facts.pendingDestinationChange ? { bankName: facts.pendingDestinationChange.bankName, last4: facts.pendingDestinationChange.last4, requestedAt: facts.pendingDestinationChange.requestedAt } : null, active: facts.active !== false },
    applicationList: apps.filter((a) => a.submitted_at).map((a) => ({ id: apiId("application", a.id), title: a.title, status: a.status, stage: a.stage, submittedAt: a.submitted_at })),
    awardList: awards.map((a) => ({ id: apiId("award", a.id), title: a.title, status: a.status })),
    orgChanges: inbox.map(changeView),
  };
}

export const granteePatch = z.object({ tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(), notes: z.string().max(20_000).nullable().optional(), ownerUserId: z.uuid().nullable().optional() }).strict();

/** Relationship notes, tags and owner: the funder's own memory about a grantee. Never profile fields. */
export async function updateGrantee(ctx: ServiceContext, applicantId: string, input: z.output<typeof granteePatch>) {
  const ws = await authorize(ctx, { scope: "grantees:write", kind: "funder", roles: STAFF_ROLES });
  const w = await grantee(ctx, ws, applicantId);
  const patch = { ...(input.tags !== undefined ? { tags: [...new Set(input.tags)] } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.ownerUserId !== undefined ? { owner_user_id: input.ownerUserId } : {}) };
  const existing = await ctx.repos.table("grantee_records").one({ workspace_id: ws.id, applicant_workspace_id: w.id });
  if (existing) await ctx.repos.table("grantee_records").update({ id: existing.id }, patch);
  else await ctx.repos.table("grantee_records").insert({ workspace_id: ws.id, applicant_workspace_id: w.id, tags: [], pending_org_changes: [] as unknown as Row<"grantee_records">["pending_org_changes"], ...patch });
  await audit(ctx, "grantee.updated", "workspace", w.id, { fields: Object.keys(input) });
  return getGrantee(ctx, w.id);
}

// ------------------------------------------------------------------------------------ org changes

const changeView = (c: Row<"org_change_inbox">) => ({ id: c.id, passportOrgId: c.passport_org_id, changeId: c.change_id, patch: c.patch, status: c.status, receivedAt: c.created_at, decidedAt: c.decided_at, decidedBy: c.decided_by });

export async function listOrgChanges(ctx: ServiceContext, page: PageRequest, f: { status?: string | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "grantees:read", kind: "funder" });
  const where = { workspace_id: ws.id, ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([ctx.repos.table("org_change_inbox").find(where, { orderBy: "created_at", ascending: false, limit: page.pageSize, offset: page.offset }), ctx.repos.table("org_change_inbox").count(where)]);
  const orgs = rows.length ? (await ctx.repos.table("workspaces").find({ passport_org_id: [...new Set(rows.map((r) => r.passport_org_id))] })).filter((w) => w.kind === "applicant") : [];
  return { items: rows.map((c) => ({ ...changeView(c), grantee: (({ w }) => (w ? { workspaceId: w.id, ...namesOf(w), handle: w.handle } : null))({ w: orgs.find((o) => o.passport_org_id === c.passport_org_id) }) })), total };
}

async function decide(ctx: ServiceContext, changeId: string, status: "accepted" | "dismissed") {
  const ws = await authorize(ctx, { scope: "grantees:write", kind: "funder", roles: STAFF_ROLES });
  const c = await ctx.repos.table("org_change_inbox").one({ id: changeId });
  if (!c || c.workspace_id !== ws.id) throw notFound("Organization change");
  if (c.status !== "pending") throw new ApiError(409, "already_decided", `This change was already ${c.status}`);
  const [saved] = await ctx.repos.table("org_change_inbox").update({ id: c.id, status: "pending" }, { status, decided_at: ctx.now().toISOString(), decided_by: ctx.actor.userId });
  await audit(ctx, `org_change.${status}`, "org_change", c.id, { passportOrgId: c.passport_org_id, changeId: c.change_id, fields: Object.keys((c.patch as Org | null) ?? {}) });
  return changeView(saved ?? c);
}

/**
 * Accept a change that arrived from Passport: the funder acknowledges it. The cached projection
 * already follows Passport (it is refreshed by the sync job), so accepting records the review.
 */
export const acceptOrgChange = (ctx: ServiceContext, changeId: string) => decide(ctx, changeId, "accepted");
export const dismissOrgChange = (ctx: ServiceContext, changeId: string) => decide(ctx, changeId, "dismissed");

export const proposeChangeInput = z.object({ patch: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, "Name at least one field"), note: z.string().trim().max(2000).optional() }).strict();

/** Keys that suggest bank or identity details. Matching is deliberately broad: a false refusal costs a retry in Passport. */
const FORBIDDEN_KEYS = /bank|routing|iban|swift|account|\bssn\b|social.?security|birth|\bdob\b|tax.?id|passport.?no|licen[cs]e/i;

/**
 * Propose a profile change to Passport on the organization's behalf (`POST
 * /common-grants/orgs/{orgId}/changes`). It arrives at Passport as `pending`; the organization
 * decides. Needs the organization's `org.changes:write` consent to this funder's client.
 */
export async function proposeOrgChange(ctx: ServiceContext, applicantId: string, input: z.output<typeof proposeChangeInput>) {
  const ws = await authorize(ctx, { scope: "grantees:write", kind: "funder", roles: STAFF_ROLES });
  const w = await grantee(ctx, ws, applicantId);
  if (Object.keys(input.patch).some((k) => FORBIDDEN_KEYS.test(k))) throw new ApiError(422, "sensitive_field", "Bank and identity details are never proposed through the GMS. The organization manages them in Passport");
  if (!w.passport_org_id) throw new ApiError(409, "not_on_passport", "This grantee is not linked to a Passport organization");
  const passport = await passportClientFor(ctx, ws.id);
  if (!passport) throw new ApiError(409, "passport_not_linked", "Connect this workspace to Passport before proposing changes");
  try {
    const { change, location } = await passport.proposeOrgChange(w.passport_org_id, input.patch);
    await audit(ctx, "org_change.proposed", "workspace", w.id, { passportOrgId: w.passport_org_id, fields: Object.keys(input.patch), changeId: change?.id ?? null });
    return { status: "pending", changeId: change?.id ?? null, location, message: "The change was sent to Passport. It takes effect only if the organization accepts it." };
  } catch (e) {
    if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport can't be reached right now. Nothing was proposed");
    if (e instanceof PassportAuthError || (e instanceof PassportApiError && (e.status === 401 || e.status === 403)))
      throw new ApiError(403, "consent_required", "This organization has not allowed your workspace to propose changes (the org.changes:write consent). Ask them to grant it under Who has access in their workspace, then try again", [{ code: "consent_required", field: "org.changes:write" }]);
    if (e instanceof PassportApiError) throw new ApiError(e.status === 422 ? 422 : 502, e.code, e.message);
    throw e;
  }
}

/**
 * Job: poll Passport for profile changes of the organizations that consented to this funder
 * (Passport has no org-change webhook) and file new ones in the inbox as `pending`.
 */
export async function pollOrgChanges(ctx: ServiceContext, funderWorkspaceId: string): Promise<{ orgs: number; added: number }> {
  const passport = await passportClientFor(ctx, funderWorkspaceId);
  if (!passport) return { orgs: 0, added: 0 };
  const consents = await ctx.repos.table("consents").find({ funder_workspace_id: funderWorkspaceId, revoked_at: null });
  const applicants = consents.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(consents.map((c) => c.applicant_workspace_id))] }) : [];
  let added = 0;
  let orgs = 0;
  for (const w of applicants) {
    if (!w.passport_org_id) continue;
    let changes: CgOrgChange[];
    try {
      changes = (await passport.listOrgChanges(w.passport_org_id)).items;
    } catch {
      continue; // Unreachable or not consented at Passport: try again next run.
    }
    orgs++;
    for (const ch of changes) {
      const c = ch as unknown as { id?: string; status?: string; patch?: unknown; changes?: unknown };
      if (!c.id) continue;
      try {
        await ctx.repos.table("org_change_inbox").insert({ workspace_id: funderWorkspaceId, passport_org_id: w.passport_org_id, change_id: c.id, patch: ((c.patch ?? c.changes ?? {}) as Row<"org_change_inbox">["patch"]), status: "pending" });
        added++;
        await emit({ ...ctx, workspace: { id: funderWorkspaceId, kind: "funder", role: null, memberScope: null } }, "org.change.pending", { passportOrgId: w.passport_org_id, changeId: c.id, applicantWorkspaceId: w.id });
      } catch (e) {
        if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
      }
    }
    const rec = await ctx.repos.table("grantee_records").one({ workspace_id: funderWorkspaceId, applicant_workspace_id: w.id });
    if (rec) await ctx.repos.table("grantee_records").update({ id: rec.id }, { last_synced_at: ctx.now().toISOString() });
  }
  return { orgs, added };
}

// ------------------------------------------------------------------------------------ CommonGrants /orgs

/** Organizations the caller may read: its own (applicant), or those that consented to it (funder). */
async function visibleOrgs(ctx: ServiceContext, ws: ServiceWorkspace): Promise<Ws[]> {
  if (ws.kind === "applicant") {
    const own = await ctx.repos.table("workspaces").one({ id: ws.id });
    return own?.org_projection ? [own] : [];
  }
  const consents = await ctx.repos.table("consents").find({ funder_workspace_id: ws.id, revoked_at: null });
  if (!consents.length) return [];
  return (await ctx.repos.table("workspaces").find({ id: [...new Set(consents.map((c) => c.applicant_workspace_id))] })).filter((w) => !!w.org_projection && !!w.passport_org_id);
}

/** The cached OrganizationBase, with `source` pointing at Passport (the system of record). */
function cgOrg(ctx: ServiceContext, w: Ws): Org {
  const org = { ...((w.org_projection as Org | null) ?? {}) };
  if (ctx.config.passportBaseUrl && w.passport_org_id) org.source = `${ctx.config.passportBaseUrl}/common-grants/orgs/${w.passport_org_id}`;
  return org;
}

export async function listCgOrgs(ctx: ServiceContext, page: PageRequest, f: { registry?: string | undefined; id?: string | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "org:read" });
  let all = await visibleOrgs(ctx, ws);
  if (f.registry || f.id) {
    if (!f.registry || !f.id) throw new ApiError(400, "bad_request", "Give both registry and id to look an organization up by identifier");
    all = all.filter((w) => ((w.org_projection as { identifiers?: Record<string, { id?: string }> } | null)?.identifiers?.[f.registry!]?.id ?? null) === f.id);
  }
  return { items: all.slice(page.offset, page.offset + page.pageSize).map((w) => cgOrg(ctx, w)), total: all.length };
}

async function visibleOrg(ctx: ServiceContext, orgId: string, scope: "org:read"): Promise<{ ws: ServiceWorkspace; w: Ws }> {
  const ws = await authorize(ctx, { scope });
  const w = (await visibleOrgs(ctx, ws)).find((x) => x.passport_org_id === orgId);
  if (!w) throw notFound("Organization");
  return { ws, w };
}

export async function getCgOrg(ctx: ServiceContext, orgId: string) {
  return cgOrg(ctx, (await visibleOrg(ctx, orgId, "org:read")).w);
}

/** A Passport client that acts with the caller's own standing: the funder's client, or the applicant's consent. */
async function callerPassport(ctx: ServiceContext, ws: ServiceWorkspace): Promise<PassportClient> {
  if (ws.kind === "funder") {
    const p = await passportClientFor(ctx, ws.id);
    if (!p) throw new ApiError(409, "passport_not_linked", "Connect this workspace to Passport first");
    return p;
  }
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  const link = await ctx.repos.table("passport_links").one({ workspace_id: ws.id, mode: "applicant_consent", revoked_at: null });
  if (!baseUrl || !key || !client || !link?.refresh_token_enc) throw new ApiError(409, "passport_not_linked", "Connect this workspace to Passport first");
  const tokens = consentTokens(ctx, link.id, { baseUrl, clientId: client.id, clientSecret: client.secret, key });
  return new PassportClient({ baseUrl, tokens, fetch: ctx.config.passportFetch });
}

const forwarded = (e: unknown): never => {
  if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport can't be reached right now");
  if (e instanceof PassportAuthError) throw new ApiError(403, "consent_required", "Passport refused this workspace for that organization");
  if (e instanceof PassportApiError) throw new ApiError(([400, 403, 404, 409, 422] as const).find((x) => x === e.status) ?? 502, e.code, e.message);
  throw e;
};

export async function listCgOrgChanges(ctx: ServiceContext, orgId: string, page: PageRequest) {
  const { ws } = await visibleOrg(ctx, orgId, "org:read");
  try {
    const res = await (await callerPassport(ctx, ws)).listOrgChanges(orgId, Math.floor(page.offset / page.pageSize) + 1, page.pageSize);
    return { items: res.items, total: res.paginationInfo?.totalItems ?? res.items.length };
  } catch (e) {
    return forwarded(e);
  }
}

export async function getCgOrgChange(ctx: ServiceContext, orgId: string, changeId: string) {
  const { ws } = await visibleOrg(ctx, orgId, "org:read");
  try {
    return await (await callerPassport(ctx, ws)).getOrgChange(orgId, changeId);
  } catch (e) {
    return forwarded(e);
  }
}

export const cgChangeInput = z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, "Name at least one field");

/** `POST /common-grants/orgs/{orgId}/changes`: forwarded to Passport with the caller's consent context. */
export async function proposeCgOrgChange(ctx: ServiceContext, orgId: string, patch: Record<string, unknown>) {
  const { ws, w } = await visibleOrg(ctx, orgId, "org:read");
  if (Object.keys(patch).some((k) => FORBIDDEN_KEYS.test(k))) throw new ApiError(422, "sensitive_field", "Bank and identity details are never sent through the GMS");
  try {
    const out = await (await callerPassport(ctx, ws)).proposeOrgChange(orgId, patch);
    await audit(ctx, "org_change.proposed", "workspace", w.id, { passportOrgId: orgId, fields: Object.keys(patch), changeId: out.change?.id ?? null });
    return out;
  } catch (e) {
    return forwarded(e);
  }
}

/**
 * `PATCH /common-grants/orgs/{orgId}`: only the organization itself may ask, and even then the GMS
 * does not edit the profile: the patch is forwarded to Passport as a proposed change.
 */
export async function patchCgOrg(ctx: ServiceContext, orgId: string, patch: Record<string, unknown>) {
  const ws = await authorize(ctx, { scope: "org:read" });
  const own = ws.kind === "applicant" ? await ctx.repos.table("workspaces").one({ id: ws.id }) : null;
  if (!own || own.passport_org_id !== orgId) throw new ApiError(403, "forbidden", "Only the organization itself can change its record, and it does so in Passport. Use POST /common-grants/orgs/{orgId}/changes to propose a change");
  return proposeCgOrgChange(ctx, orgId, patch);
}

export { required };
