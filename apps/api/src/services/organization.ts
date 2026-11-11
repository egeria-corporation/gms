// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's link to Passport (build spec §11.2). The applicant consents on Passport's own
// screen (authorization code + PKCE, scopes org:read org.changes:read org.changes:write); the GMS
// then caches the organization and its Common App profile. Nothing here edits the profile: Passport
// is the identity source, and edits are proposed there.
import {
  APPLICANT_CONSENT_SCOPES,
  PassportApiError,
  PassportAuthError,
  PassportClient,
  PassportUnavailableError,
  buildAuthorizeUrl,
  createPkce,
  decryptSecret,
  encryptSecret,
  exchangeAuthorizationCode,
  profileSources,
  profileToObject,
  staticToken,
  type CgOrganization,
  type OrgProfile,
  type ProfileField,
  type VerifiedRepresentative,
} from "@gms/passport-client";
import { readPassportFields } from "@gms/protocol";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { audit, authorize, guardWrite, required, type ServiceContext } from "./context.ts";
import { slugify } from "./opportunities.ts";
import { consentTokens } from "./passport-tokens.ts";
import type { Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;
type CheckState = "pass" | "fail" | "unknown";
export interface ReadinessCheck {
  key: string;
  state: CheckState;
  label: string;
  reason: string;
  fixHref: string | null;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_TO = /^\/[A-Za-z0-9_\-/]{0,200}$/;

function configured(ctx: ServiceContext) {
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  if (!baseUrl || !key || !client) throw new ApiError(503, "passport_not_configured", "Passport linking is not configured on this server");
  return { baseUrl, key, client, redirectUri: `${ctx.config.baseUrl}/gms/passport/consent/callback` };
}

interface SealedState {
  u: string;
  v: string;
  w: string | null;
  r: string | null;
  exp: number;
}

export const consentStartInput = z
  .object({
    /** An applicant workspace the person administers that has no Passport organization yet. */
    workspaceId: z.uuid().optional(),
    /** Path in the web app to land on afterwards. */
    returnTo: z.string().regex(RETURN_TO).optional(),
  })
  .strict();

/**
 * Step 1: where to send the browser. The PKCE verifier and who started the flow travel in `state`,
 * sealed with the server's credentials key, so the callback needs no session and no table.
 */
/** The scopes the applicant is asked for at Passport; `payee:read` only when the install opted in. */
export const consentScopes = (ctx: Pick<ServiceContext, "config">): string[] => [...APPLICANT_CONSENT_SCOPES, ...(ctx.config.applicantPayeeRead ? ["payee:read"] : [])];

export async function startConsent(ctx: ServiceContext, input: z.output<typeof consentStartInput>) {
  await authorize(ctx, { person: true });
  const cfg = configured(ctx);
  if (input.workspaceId) {
    const m = await ctx.repos.table("workspace_members").one({ workspace_id: input.workspaceId, user_id: ctx.actor.userId!, role: "admin" });
    const w = m ? await ctx.repos.table("workspaces").one({ id: input.workspaceId, kind: "applicant" }) : null;
    if (!w) throw new ApiError(404, "not_found", "Workspace not found");
  }
  const { verifier, challenge } = await createPkce();
  const sealed: SealedState = { u: ctx.actor.userId!, v: verifier, w: input.workspaceId ?? null, r: input.returnTo ?? null, exp: ctx.now().getTime() + STATE_TTL_MS };
  const state = await encryptSecret(JSON.stringify(sealed), cfg.key);
  const scopes = consentScopes(ctx);
  return { authorizeUrl: buildAuthorizeUrl({ baseUrl: cfg.baseUrl, clientId: cfg.client.id, redirectUri: cfg.redirectUri, state, codeChallenge: challenge, scopes }), scopes, expiresInSeconds: STATE_TTL_MS / 1000 };
}

const einOf = (org: CgOrganization): string | null => {
  const id = (org.identifiers as Record<string, { id?: string } | undefined> | undefined)?.["org:us:ein"]?.id;
  return typeof id === "string" ? id : null;
};

/** What the cache holds for one organization, from Passport's two reads. */
function projectionColumns(org: CgOrganization, profile: OrgProfile | null, at: string) {
  const fields = readPassportFields(org);
  return {
    org_projection: org as unknown as Ws["org_projection"],
    org_projection_at: at,
    verification_level: profile?.level && /^L[0-3]$/.test(profile.level) ? profile.level : fields.verificationLevel,
    ...(profile ? { profile_projection: { level: profile.level ?? null, fields: profile.fields } as unknown as Ws["profile_projection"], profile_projection_at: at } : {}),
    legal_name: typeof org.name === "string" ? org.name : null,
    ein: einOf(org),
  };
}

async function readPassport(passport: PassportClient, orgId: string): Promise<{ org: CgOrganization; profile: OrgProfile | null }> {
  const org = await passport.getOrg(orgId);
  // The profile is additive: an organization that has confirmed nothing yet still links.
  const profile = await passport.getOrgProfile(orgId).catch((e: unknown) => {
    if (e instanceof PassportApiError || e instanceof PassportUnavailableError) return null;
    throw e;
  });
  return { org, profile };
}

async function uniqueHandle(ctx: ServiceContext, name: string): Promise<string> {
  const base = slugify(name).slice(0, 40) || "organization";
  for (let i = 0; i < 20; i++) {
    const handle = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await ctx.repos.table("workspaces").one({ handle }))) return handle;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export type ConsentOutcome = { ok: true; redirect: string; workspaceId: string } | { ok: false; redirect: string; reason: string };

/**
 * Step 2: Passport sends the browser back. There is no bearer on this request; the sealed `state`
 * says who started the flow. Always answers with a redirect into the web app.
 */
export async function completeConsent(ctx: Pick<ServiceContext, "repos" | "ledger" | "webhooks" | "now" | "config" | "ports">, query: { code?: string; state?: string; error?: string }): Promise<ConsentOutcome> {
  const web = ctx.config.webBaseUrl;
  const fail = (reason: string, returnTo?: string | null): ConsentOutcome => ({ ok: false, reason, redirect: `${web}${returnTo ?? "/onboarding/applicant"}?passport=error&reason=${encodeURIComponent(reason)}` });
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  if (!baseUrl || !key || !client) return fail("not_configured");
  let sealed: SealedState;
  try {
    sealed = JSON.parse(await decryptSecret(query.state ?? "", key)) as SealedState;
  } catch {
    return fail("invalid_state");
  }
  if (!sealed.u || !sealed.v || sealed.exp < ctx.now().getTime()) return fail("expired", sealed.r);
  if (query.error || !query.code) return fail(query.error === "access_denied" ? "declined" : "passport_error", sealed.r);

  const svc: ServiceContext = { ...ctx, actor: { kind: "user", userId: sealed.u, clientId: null, ledger: { kind: "user", userId: sealed.u }, id: `user:${sealed.u}` }, workspace: null, scopes: [] };
  let tokens;
  let read;
  try {
    tokens = await exchangeAuthorizationCode({ baseUrl, clientId: client.id, clientSecret: client.secret, code: query.code, codeVerifier: sealed.v, redirectUri: `${ctx.config.baseUrl}/gms/passport/consent/callback`, fetch: ctx.config.passportFetch });
    read = await readPassport(new PassportClient({ baseUrl, tokens: staticToken(tokens.accessToken), fetch: ctx.config.passportFetch }), tokens.orgId);
  } catch (e) {
    if (e instanceof PassportUnavailableError) return fail("passport_unavailable", sealed.r);
    if (e instanceof PassportAuthError || e instanceof PassportApiError) return fail("passport_refused", sealed.r);
    throw e;
  }

  const ws = await linkApplicantOrganization(svc, { userId: sealed.u, tokens, read, workspaceHint: sealed.w, via: "passport_consent" });
  return { ok: true, workspaceId: ws.id, redirect: `${web}${sealed.r ?? "/onboarding/applicant"}?passport=linked&ws=${encodeURIComponent(ws.handle)}` };
}

/** What Passport said about the organization a person just consented for. */
export type PassportRead = { org: CgOrganization; profile: OrgProfile | null };

/** Read the organization and its profile with the access token from a code exchange. */
export function readConsentedOrganization(ctx: Pick<ServiceContext, "config">, accessToken: string, orgId: string): Promise<PassportRead> {
  return readPassport(new PassportClient({ baseUrl: ctx.config.passportBaseUrl!, tokens: staticToken(accessToken), fetch: ctx.config.passportFetch }), orgId);
}

/**
 * Link the organization a person consented for at Passport to its applicant workspace: find or
 * create the workspace, cache the record, add the person, and store the refresh token encrypted.
 * Shared by the consent callback and Sign in with Passport, so both link the same way.
 */
export async function linkApplicantOrganization(
  svc: ServiceContext,
  input: { userId: string; tokens: { orgId: string; refreshToken: string; scopes: string[] }; read: PassportRead; workspaceHint: string | null; via: "passport_consent" | "passport_signin" },
): Promise<Ws> {
  const { userId, tokens, read } = input;
  const { credentialsKey: key, passportClient: client } = svc.config;
  if (!key || !client) throw new ApiError(503, "passport_not_configured", "Passport linking is not configured on this server");
  const at = svc.now().toISOString();
  const columns = projectionColumns(read.org, read.profile, at);
  let workspace = await svc.repos.table("workspaces").one({ passport_org_id: tokens.orgId, kind: "applicant" });
  if (!workspace && input.workspaceHint) {
    // Link the workspace the person named, if they still administer it and it is still unlinked.
    const m = await svc.repos.table("workspace_members").one({ workspace_id: input.workspaceHint, user_id: userId, role: "admin" });
    const named = m ? await svc.repos.table("workspaces").one({ id: input.workspaceHint, kind: "applicant" }) : null;
    if (named && !named.passport_org_id) workspace = (await svc.repos.table("workspaces").update({ id: named.id }, { passport_org_id: tokens.orgId, ...columns }))[0] ?? null;
  }
  if (workspace) {
    workspace = (await svc.repos.table("workspaces").update({ id: workspace.id }, columns))[0] ?? workspace;
  } else {
    const name = columns.legal_name ?? "Organization";
    const handle = await uniqueHandle(svc, name);
    workspace = await guardWrite("A workspace for this organization", () => svc.repos.table("workspaces").insert({ kind: "applicant", handle, display_name: name, passport_org_id: tokens.orgId, status: "active", ...columns }));
    await audit(svc, "workspace.created", "workspace", workspace.id, { kind: "applicant", handle, via: input.via }, workspace.id);
  }
  const ws = workspace!;
  // Consenting for the organization on Passport is the proof of standing: the first person in
  // becomes the workspace admin, later ones join as editors until an admin changes their role.
  if (!(await svc.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: userId }))) {
    const first = (await svc.repos.table("workspace_members").count({ workspace_id: ws.id })) === 0;
    await svc.repos.table("workspace_members").insert({ workspace_id: ws.id, user_id: userId, role: first ? "admin" : "editor" });
    await audit(svc, "member.added", "workspace", ws.id, { userId, role: first ? "admin" : "editor", via: input.via }, ws.id);
  }
  await svc.repos.table("passport_links").update({ workspace_id: ws.id, mode: "applicant_consent", revoked_at: null }, { revoked_at: at });
  const orgScopes = tokens.scopes.filter((s) => !["openid", "email", "profile"].includes(s));
  await svc.repos.table("passport_links").insert({ workspace_id: ws.id, mode: "applicant_consent", client_id: client.id, refresh_token_enc: await encryptSecret(tokens.refreshToken, key), scopes: orgScopes.length ? orgScopes : [...APPLICANT_CONSENT_SCOPES], linked_by_user_id: userId, linked_at: at, last_ok_at: at });
  await audit(svc, "passport.linked", "workspace", ws.id, { mode: "applicant_consent", passportOrgId: tokens.orgId, via: input.via }, ws.id);
  return ws;
}

// ------------------------------------------------------------------------------------ the cached record

function view(ws: Ws, linked: boolean) {
  const org = (ws.org_projection as Record<string, unknown> | null) ?? null;
  const cached = ws.profile_projection as { fields?: ProfileField[] } | null;
  const fields = readPassportFields(org);
  return {
    workspaceId: ws.id,
    handle: ws.handle,
    displayName: ws.display_name,
    passportOrgId: ws.passport_org_id,
    linked,
    level: ws.verification_level ?? (org ? fields.verificationLevel : null),
    verifiedAt: fields.verifiedAt,
    attestationUrl: fields.attestation,
    /** CommonGrants `OrganizationBase`, exactly as Passport served it. */
    organization: org,
    /** Common App profile folded into an object, with the source of each field. */
    profile: cached?.fields ? profileToObject(cached.fields) : null,
    profileSources: cached?.fields ? profileSources(cached.fields) : {},
    syncedAt: ws.org_projection_at,
  };
}

/** Profile edits happen in Passport; the GMS only links there. */
/**
 * Passport's web app, for links a person opens. PASSPORT_BASE_URL is the API and answers 404 to a
 * browser, so a link must never be built from it. Without PASSPORT_WEB_URL, the hosted layout is
 * assumed (`passport.` is the API, `app.passport.` the web app).
 */
export const passportWeb = (ctx: Pick<ServiceContext, "config">): string | null =>
  ctx.config.passportWebUrl ?? (ctx.config.passportBaseUrl ? ctx.config.passportBaseUrl.replace("//passport.", "//app.passport.") : null);

const editUrl = (ctx: ServiceContext, ws: Ws) => (ws.passport_org_id && passportWeb(ctx) ? `${passportWeb(ctx)}/orgs/${ws.passport_org_id}` : null);

async function liveLink(ctx: ServiceContext, workspaceId: string) {
  return ctx.repos.table("passport_links").one({ workspace_id: workspaceId, mode: "applicant_consent", revoked_at: null });
}

export async function getMyOrganization(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const reps = await readRepresentatives(ctx, ws.id);
  return { ...view(row, !!(await liveLink(ctx, ws.id))), editUrl: editUrl(ctx, row), representatives: { state: reps.state, items: reps.items.map(representativeView) } };
}

/** A Passport client acting with the workspace's stored consent (see passport-tokens.ts for how the refresh token is shared safely). */
async function consentedPassport(ctx: ServiceContext, workspaceId: string, row: Ws) {
  const link = await liveLink(ctx, workspaceId);
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  if (!link?.refresh_token_enc || !row.passport_org_id) throw new ApiError(409, "passport_not_linked", "Connect this workspace to Passport first");
  if (!baseUrl || !key || !client) throw new ApiError(503, "passport_not_configured", "Passport linking is not configured on this server");
  const tokens = consentTokens(ctx, link.id, { baseUrl, clientId: client.id, clientSecret: client.secret, key });
  return { link, passport: new PassportClient({ baseUrl, tokens, fetch: ctx.config.passportFetch }) };
}

/** Turn a failed Passport read into the answer the applicant should see; a withdrawn consent unlinks the workspace. */
async function passportFailure(ctx: ServiceContext, linkId: string, e: unknown): Promise<never> {
  if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport can't be reached right now");
  if (e instanceof PassportAuthError) {
    const [gone] = await ctx.repos.table("passport_links").update({ id: linkId, revoked_at: null }, { revoked_at: ctx.now().toISOString() });
    // The workspace lost its link to Passport: an access change, so it is on the ledger.
    if (gone) await audit(ctx, "passport.unlinked", "workspace", gone.workspace_id, { mode: "applicant_consent", reason: "consent_refused_by_passport" }, gone.workspace_id);
    throw new ApiError(409, "passport_consent_revoked", "Passport no longer accepts this workspace's consent. Connect to Passport again");
  }
  if (e instanceof PassportApiError) throw new ApiError(502, "passport_refused", "Passport refused the request for this organization");
  throw e;
}

/**
 * The organization's Passport locker, as references. The GMS never copies a locker document: an
 * attachment keeps the Passport document id, name and hash. Not cached, so a document removed in
 * Passport stops being offered at once.
 */
export async function listMyDocuments(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const { link, passport } = await consentedPassport(ctx, ws.id, row);
  try {
    const docs = await passport.listOrgDocuments(row.passport_org_id!);
    // A document without a recorded hash (a Drive reference) cannot be pinned to an application.
    return docs.map((d) => ({ id: d.id, kind: d.kind, name: d.name, mimeType: d.mimeType, sha256: d.sha256, source: d.source, uploadedAt: d.uploadedAt, expiresAt: d.expiresAt, attachable: d.sha256 !== null }));
  } catch (e) {
    return passportFailure(ctx, link.id, e);
  }
}

/** Re-read the organization and profile from Passport with the stored consent. */
export async function refreshMyOrganization(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const { link, passport } = await consentedPassport(ctx, ws.id, row);
  let read;
  try {
    read = await readPassport(passport, row.passport_org_id!);
  } catch (e) {
    if (e instanceof PassportUnavailableError) throw new ApiError(503, "passport_unavailable", "Passport can't be reached right now. The cached record is unchanged");
    if (e instanceof PassportAuthError) {
      await ctx.repos.table("passport_links").update({ id: link.id }, { revoked_at: ctx.now().toISOString() });
      throw new ApiError(409, "passport_consent_revoked", "Passport no longer accepts this workspace's consent. Connect to Passport again");
    }
    if (e instanceof PassportApiError) throw new ApiError(502, "passport_refused", "Passport refused the request for this organization");
    throw e;
  }
  const at = ctx.now().toISOString();
  const before = row.verification_level;
  const [updated] = (await ctx.repos.table("workspaces").update({ id: ws.id }, projectionColumns(read.org, read.profile, at))) as [Ws];
  await ctx.repos.table("passport_links").update({ id: link.id }, { last_ok_at: at });
  if (before !== updated.verification_level) await audit(ctx, "organization.level_changed", "workspace", ws.id, { from: before, to: updated.verification_level });
  return { ...view(updated, true), editUrl: editUrl(ctx, updated) };
}

const RANK: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/** The readiness checklist the dashboard and the submit dialog show. `unknown` is never folded into pass or fail. */
export async function getMyReadiness(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const linked = !!(await liveLink(ctx, ws.id));
  const org = row.org_projection as { status?: { value?: string } } | null;
  const passport = passportWeb(ctx) && row.passport_org_id ? `${passportWeb(ctx)}/orgs/${row.passport_org_id}` : null;
  const level = row.verification_level;
  const rank = level ? (RANK[level] ?? 0) : null;
  const need = (min: number, key: string, label: string, pass: string, failText: string): ReadinessCheck =>
    rank === null ? { key, state: "unknown", label, reason: "Connect Passport to see this", fixHref: passport } : rank >= min ? { key, state: "pass", label, reason: pass, fixHref: null } : { key, state: "fail", label, reason: failText, fixHref: passport };
  const checks: ReadinessCheck[] = [
    linked ? { key: "passport_linked", state: "pass", label: "Passport connected", reason: `Record last read ${row.org_projection_at?.slice(0, 10) ?? "never"}`, fixHref: null } : { key: "passport_linked", state: "fail", label: "Passport connected", reason: "Continue with Passport to bring in your organization record", fixHref: "/onboarding/applicant" },
    !org ? { key: "organization_active", state: "unknown", label: "Organization in good standing", reason: "Connect Passport to see this", fixHref: passport } : org.status?.value === "active" ? { key: "organization_active", state: "pass", label: "Organization in good standing", reason: "Active in Passport", fixHref: null } : { key: "organization_active", state: "fail", label: "Organization in good standing", reason: "Passport does not list this organization as active", fixHref: passport },
    need(1, "organization_verified", "Organization verified", "Matched to public registry records (L1)", "Claim and confirm your organization in Passport"),
    need(2, "identity_verified", "Identity verified", "Representatives confirmed (L2)", "Verify your representatives in Passport"),
    need(3, "payee_verified", "Payee verified", "A payout destination is verified (L3)", "Verify a payout destination in Passport to receive facilitated payments"),
  ];
  const failing = checks.filter((c) => c.state === "fail").length;
  const unknown = checks.filter((c) => c.state === "unknown").length;
  return { level, linked, syncedAt: row.org_projection_at, checks, summary: { pass: checks.length - failing - unknown, fail: failing, unknown, ready: failing === 0 && unknown === 0 } };
}

// ------------------------------------------------------------------------------------ payout destination

/**
 * Where Passport would pay this organization, as the grantee may see it on a grant: bank name and
 * last four digits only. Read live from Passport with the workspace's own consent and never stored.
 * `unknown` (Passport unreachable) is its own state; it is never shown as "no destination".
 */
export interface PayoutDestinationView {
  /** ok: read · none: no active destination · not_linked · not_shared: the consent does not cover payee status · unknown: Passport unreachable. */
  state: "ok" | "none" | "not_linked" | "not_shared" | "unknown";
  bankName: string | null;
  last4: string | null;
  /** Passport's status for the active destination, e.g. `active`. */
  status: string | null;
  level: string | null;
  pendingChange: { state: string | null; bankName: string | null; last4: string | null; requestedAt: string | null; coolingOffUntil: string | null } | null;
  freezeUntil: string | null;
  manageUrl: string | null;
  reason: string;
}

export async function payoutDestinationFor(ctx: ServiceContext, workspaceId: string): Promise<PayoutDestinationView> {
  const row = required(await ctx.repos.table("workspaces").one({ id: workspaceId }), "Workspace");
  const manageUrl = passportWeb(ctx) && row.passport_org_id ? `${passportWeb(ctx)}/orgs/${row.passport_org_id}` : null;
  // What Passport's own events have told the GMS: display facts only, used when the live read is not possible.
  const told = (row.settings as { passportPayee?: { pendingDestinationChange?: { bankName: string | null; last4: string | null; requestedAt: string } | null } } | null)?.passportPayee?.pendingDestinationChange ?? null;
  const toldPending = told ? { state: null, bankName: told.bankName, last4: told.last4, requestedAt: told.requestedAt, coolingOffUntil: null } : null;
  const empty = { bankName: null, last4: null, status: null, level: row.verification_level, pendingChange: toldPending, freezeUntil: null, manageUrl };
  const link = await liveLink(ctx, workspaceId);
  if (!link || !row.passport_org_id) return { ...empty, state: "not_linked", reason: "Connect this workspace to Passport to see where payments go" };
  let passport: PassportClient;
  try {
    ({ passport } = await consentedPassport(ctx, workspaceId, row));
  } catch {
    return { ...empty, state: "unknown", reason: "Passport is not configured on this server" };
  }
  try {
    const cred = await passport.getPayeeCredential(row.passport_org_id);
    const d = cred.payoutDestination;
    const p = cred.changeControl?.pendingChange ?? null;
    const pendingChange = p ? { state: p.state, bankName: p.bankName, last4: p.last4, requestedAt: p.requestedAt, coolingOffUntil: p.coolingOffUntil } : toldPending;
    const base = { level: cred.level, pendingChange, freezeUntil: cred.changeControl?.freezeUntil ?? null, manageUrl };
    if (!d) return { ...base, state: "none", bankName: null, last4: null, status: null, reason: "No payout destination is active in Passport" };
    return { ...base, state: "ok", bankName: d.bankName, last4: d.last4, status: d.status, reason: "Read from Passport just now" };
  } catch (e) {
    if (e instanceof PassportApiError && (e.status === 403 || e.status === 401)) return { ...empty, state: "not_shared", reason: "This workspace's Passport consent does not include payee status. Manage the destination in Passport" };
    if (e instanceof PassportApiError && e.status === 404) return { ...empty, state: "none", reason: "No payout destination is active in Passport" };
    if (e instanceof PassportAuthError) return { ...empty, state: "not_linked", reason: "Passport no longer accepts this workspace's consent. Connect to Passport again" };
    return { ...empty, state: "unknown", reason: "Passport can't be reached right now" };
  }
}

/** The grantee's own destination display for the workspace they are signed in to. */
export async function getMyPayoutDestination(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "applicant" });
  return payoutDestinationFor(ctx, ws.id);
}

// ------------------------------------------------------------------------------------ who has access

export async function listMyConsents(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const rows = await ctx.repos.table("consents").find({ applicant_workspace_id: ws.id }, { orderBy: "granted_at", ascending: false });
  const funders = rows.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(rows.map((r) => r.funder_workspace_id))] }) : [];
  return rows.map((r) => {
    const f = funders.find((w) => w.id === r.funder_workspace_id);
    return { id: r.id, funder: { workspaceId: r.funder_workspace_id, name: f?.display_name ?? null, handle: f?.handle ?? null }, basis: r.basis, scopes: r.scopes, grantedAt: r.granted_at, revokedAt: r.revoked_at };
  });
}

export async function revokeMyConsent(ctx: ServiceContext, consentId: string) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "applicant", roles: ["admin"], person: true });
  const row = required(await ctx.repos.table("consents").one({ id: consentId, applicant_workspace_id: ws.id }), "Consent");
  if (!row.revoked_at) {
    await ctx.repos.table("consents").update({ id: row.id }, { revoked_at: ctx.now().toISOString() });
    await audit(ctx, "consent.revoked", "workspace", ws.id, { funderWorkspaceId: row.funder_workspace_id, basis: row.basis });
  }
  return { revoked: true };
}

/** Funders this applicant has a relationship with on the GMS: anyone they applied to. */
export async function listMyFunders(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant" });
  const apps = await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id });
  const ids = [...new Set(apps.map((a) => a.workspace_id))];
  const funders = ids.length ? await ctx.repos.table("workspaces").find({ id: ids }, { orderBy: "display_name" }) : [];
  const awards = ids.length ? await ctx.repos.table("awards").find({ recipient_workspace_id: ws.id }) : [];
  return funders.map((f) => {
    const mine = apps.filter((a) => a.workspace_id === f.id);
    return {
      workspaceId: f.id,
      name: f.display_name,
      handle: f.handle,
      brand: f.brand,
      since: mine.map((a) => a.created_at).sort()[0] ?? null,
      applications: mine.length,
      awards: awards.filter((a) => a.workspace_id === f.id).length,
    };
  });
}

// ------------------------------------------------------------------------------- representatives

/** `ok`: Passport answered. `not_linked`: no consent on file. `not_shared`: the consent does not cover it. `unknown`: Passport could not be reached. */
export type RepresentativesState = "ok" | "not_linked" | "not_shared" | "unknown";

/**
 * The organization's verified representatives, read from Passport with the workspace's consent.
 * Never cached and never stored: who may sign for an organization is Passport's to say.
 */
async function readRepresentatives(ctx: ServiceContext, workspaceId: string): Promise<{ state: RepresentativesState; items: VerifiedRepresentative[] }> {
  const row = await ctx.repos.table("workspaces").one({ id: workspaceId });
  if (!row?.passport_org_id) return { state: "not_linked", items: [] };
  let passport: PassportClient;
  try {
    passport = (await consentedPassport(ctx, workspaceId, row)).passport;
  } catch (e) {
    if (e instanceof ApiError) return { state: "not_linked", items: [] };
    throw e;
  }
  try {
    return { state: "ok", items: await passport.listVerifiedRepresentatives(row.passport_org_id) };
  } catch (e) {
    if (e instanceof PassportAuthError) return { state: "not_shared", items: [] };
    if (e instanceof PassportApiError) return { state: e.status === 401 || e.status === 403 || e.status === 404 ? "not_shared" : "unknown", items: [] };
    if (e instanceof PassportUnavailableError) return { state: "unknown", items: [] };
    throw e;
  }
}

const representativeView = (r: VerifiedRepresentative) => ({ id: r.id, name: r.fullName, title: r.title || null, role: r.role, isControlOfficer: r.isControlOfficer, verified: true, verificationLevel: r.verificationLevel, verifiedAt: r.verifiedAt });

/** The people Passport has verified as able to act for this organization. No contact details. */
export async function getMyRepresentatives(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const read = await readRepresentatives(ctx, ws.id);
  return { state: read.state, items: read.items.map(representativeView), manageUrl: editUrl(ctx, row) };
}

/** Names compare without case, accents, punctuation or extra spaces. */
export const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Which rule let a person sign for the recipient organization. Stored on the signature and the ledger. */
export interface SignerAuthority {
  rule: "passport_representative" | "admin_role";
  /** Why the admin-role rule applied instead of the Passport check. */
  reason: "passport_not_linked" | "representatives_not_shared" | "passport_unavailable" | "no_verified_representatives" | null;
  representativeId: string | null;
  verificationLevel: string | null;
}

const FALLBACK_REASON = { not_linked: "passport_not_linked", not_shared: "representatives_not_shared", unknown: "passport_unavailable" } as const;

/**
 * May this typed legal name sign for the recipient organization? When Passport lists verified
 * representatives, the name must be one of theirs. When it cannot say (no consent, consent does
 * not cover it, unreachable, none verified yet), the caller's admin role, already checked, stands.
 */
export async function checkSigner(ctx: ServiceContext, workspaceId: string, typedName: string | null): Promise<SignerAuthority> {
  const read = await readRepresentatives(ctx, workspaceId);
  if (read.state !== "ok") return { rule: "admin_role", reason: FALLBACK_REASON[read.state], representativeId: null, verificationLevel: null };
  if (!read.items.length) return { rule: "admin_role", reason: "no_verified_representatives", representativeId: null, verificationLevel: null };
  if (!typedName?.trim()) throw new ApiError(422, "signer_name_required", "Type your full legal name. It must match one of your organization's verified representatives in Passport");
  const typed = normalizeName(typedName);
  const match = read.items.find((r) => normalizeName(r.fullName) === typed);
  if (!match) throw new ApiError(403, "not_a_representative", "That name is not one of your organization's verified representatives in Passport. A verified representative must sign, using their legal name as Passport has it");
  return { rule: "passport_representative", reason: null, representativeId: match.id, verificationLevel: match.verificationLevel };
}
