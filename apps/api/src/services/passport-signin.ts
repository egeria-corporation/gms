// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport. One trip to Passport signs the person in (OpenID Connect: `openid email`)
// and, when they approve it for an organization, links that organization's applicant workspace.
//
// Trust: the browser is never trusted. The PKCE verifier, nonce and a browser-binding value are
// sealed in `state`; the binding must match an HttpOnly cookie set when the flow started (so a
// callback URL cannot be planted in someone else's browser); the ID token is verified against
// Passport's published keys for this client, this issuer and this nonce; and only an email Passport
// marks verified selects an account. A matching account is signed in to (owner decision,
// 2026-11-10: Passport's verified email is the same proof of control as the email code), but only
// an account whose email was itself proven: an unconfirmed one is replaced, never adopted, and an
// account already tied to a different Passport user is refused (ports.ts, `ensureUser`).
//
// The last hop is bound too. The web app makes a random value before it leaves for Passport, keeps
// it in the tab, and sends it here; it is sealed in `state` and returned in the fragment next to
// the one-time sign-in, and the web app redeems that only when the two match. A link carrying
// someone else's sign-in therefore does nothing in a browser that did not start the flow.
import {
  PassportApiError,
  PassportAuthError,
  PassportUnavailableError,
  SIGN_IN_SCOPES,
  buildAuthorizeUrl,
  createPkce,
  decryptSecret,
  encryptSecret,
  exchangeCode,
  type FetchLike,
} from "@gms/passport-client";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import { b64url, timingSafeEqual } from "../auth/crypto.ts";
import { log } from "../lib/log.ts";
import { audit, makeActor, type BaseContext, type ServiceContext } from "./context.ts";
import { consentScopes, linkApplicantOrganization, readConsentedOrganization } from "./organization.ts";
import { AccountMismatchError } from "./ports.ts";

export const SIGNIN_COOKIE = "__Host-gms_passport_signin";
const STATE_TTL_MS = 10 * 60 * 1000;
/**
 * A destination in the web app: a path of letters, digits, `_`, `-` and single slashes, with an
 * optional query string of URL-safe characters (the app passes which opportunity someone wanted
 * through sign-in that way). Anything else is ignored.
 */
export const RETURN_TO = /^\/(?!\/)[A-Za-z0-9_\-/]{0,200}(?:\?[A-Za-z0-9_\-.~%=&+]{0,300})?$/;
/** The web app's last-hop binding: base64url, long enough to be unguessable, short enough for a URL. */
const HOP = /^[A-Za-z0-9_-]{22,128}$/;
const CLOCK_SKEW_SEC = 60;

export type SignInErrorCode = "cancelled" | "no_organization" | "email_unverified" | "expired" | "state_mismatch" | "unavailable" | "not_configured" | "account_mismatch";

interface SealedSignIn {
  /** PKCE verifier */
  v: string;
  /** OIDC nonce */
  n: string;
  /** Browser binding: must equal the cookie */
  b: string;
  /** Where to land in the web app */
  r: string | null;
  /** Last-hop binding: made by the web app, echoed back to it in the fragment */
  h: string;
  exp: number;
}

const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const callbackUri = (ctx: Pick<ServiceContext, "config">) => `${ctx.config.baseUrl}/gms/passport/signin/callback`;
export const signInErrorRedirect = (ctx: Pick<ServiceContext, "config">, code: SignInErrorCode) => `${ctx.config.webBaseUrl}/signin?passport_error=${code}`;

/** `returnTo` if it is a plain path in the web app; null otherwise (never an error: the person still signs in). */
export function safeReturnTo(raw: string | undefined | null): string | null {
  return raw && RETURN_TO.test(raw) && !raw.split("?")[0]!.includes("//") ? raw : null;
}

export type SignInStart = { ok: true; redirect: string; binding: string; maxAgeSeconds: number } | { ok: false; redirect: string; code: SignInErrorCode };

/** Step 1: where to send the browser, and the binding value to set as a cookie. */
export async function startSignIn(ctx: Pick<ServiceContext, "config" | "now" | "ports">, input: { returnTo?: string | null; hop?: string | null }): Promise<SignInStart> {
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  if (!baseUrl || !key || !client || !ctx.ports.identity) return { ok: false, code: "not_configured", redirect: signInErrorRedirect(ctx, "not_configured") };
  // A flow the web app did not start cannot be finished by it, so it is not started at all.
  if (!input.hop || !HOP.test(input.hop)) return { ok: false, code: "state_mismatch", redirect: signInErrorRedirect(ctx, "state_mismatch") };
  const { verifier, challenge } = await createPkce();
  const sealed: SealedSignIn = { v: verifier, n: random(), b: random(), r: safeReturnTo(input.returnTo), h: input.hop, exp: ctx.now().getTime() + STATE_TTL_MS };
  const state = await encryptSecret(JSON.stringify(sealed), key);
  const redirect = buildAuthorizeUrl({ baseUrl, clientId: client.id, redirectUri: callbackUri(ctx), state, codeChallenge: challenge, nonce: sealed.n, scopes: [...SIGN_IN_SCOPES, ...consentScopes(ctx)] });
  return { ok: true, redirect, binding: sealed.b, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

// Passport's published keys, per base URL, for ten minutes. Not used when a test injects `passportFetch`.
const jwksCache = new Map<string, { at: number; keys: JSONWebKeySet }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Passport publishes every public key it signs with (attestations included). ID tokens are signed
 * with the OAuth family, whose key ids start `oauth-`; when the set names any such key only those
 * are kept, so a signature from another family can never verify here. A deployment that names its
 * keys differently keeps the whole set (the audience, nonce and `typ` checks still apply).
 */
export function signInKeys(set: JSONWebKeySet): JSONWebKeySet {
  const oauth = set.keys.filter((k) => typeof k.kid === "string" && k.kid.startsWith("oauth-"));
  return oauth.length ? { keys: oauth } : set;
}

async function passportJwks(ctx: Pick<ServiceContext, "config" | "now">, baseUrl: string, opts: { fresh?: boolean } = {}): Promise<JSONWebKeySet> {
  const injected = ctx.config.passportFetch;
  const cached = injected || opts.fresh ? undefined : jwksCache.get(baseUrl);
  if (cached && ctx.now().getTime() - cached.at < JWKS_TTL_MS) return cached.keys;
  const doFetch: FetchLike = injected ?? (fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/.well-known/jwks.json`, { headers: { Accept: "application/json" } });
  } catch {
    throw new PassportUnavailableError("Passport's keys could not be fetched");
  }
  const body = (await res.json().catch(() => null)) as JSONWebKeySet | null;
  if (!res.ok || !body || !Array.isArray(body.keys)) throw new PassportUnavailableError("Passport's keys could not be fetched", res.status);
  const keys = signInKeys(body);
  if (!injected) jwksCache.set(baseUrl, { at: ctx.now().getTime(), keys });
  return keys;
}

/** The key id an ID token names, without trusting anything else about it. */
function kidOf(idToken: string): string | null {
  try {
    const kid = decodeProtectedHeader(idToken).kid;
    return typeof kid === "string" ? kid : null;
  } catch {
    return null;
  }
}

export interface PassportIdentity {
  passportUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  acr: string | null;
  /** How the person signed in at Passport, as it reports it (RFC 8176 values; `mfa` = its authenticator). */
  amr: string[];
  /** When they did, in seconds since the epoch; null when Passport did not say. */
  authTime: number | null;
}

/**
 * Verify Passport's ID token: ES256 signature against its published keys, the `JWT` type (so no
 * other kind of Passport token is accepted here), issuer, audience (this client), expiry, and the
 * nonce this flow started with. Throws on any mismatch.
 */
export async function verifyIdToken(idToken: string, opts: { keys: JSONWebKeySet; issuer: string; clientId: string; nonce: string; now: Date }): Promise<PassportIdentity> {
  const { payload } = await jwtVerify(idToken, createLocalJWKSet(opts.keys), {
    algorithms: ["ES256"],
    typ: "JWT",
    issuer: opts.issuer,
    audience: opts.clientId,
    clockTolerance: CLOCK_SKEW_SEC,
    currentDate: opts.now,
    requiredClaims: ["sub", "exp", "iat", "nonce"],
  });
  if (typeof payload.nonce !== "string" || !timingSafeEqual(payload.nonce, opts.nonce)) throw new Error("nonce");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("sub");
  return {
    passportUserId: payload.sub,
    email: typeof payload.email === "string" && /^\S+@\S+\.\S+$/.test(payload.email) ? payload.email.trim().toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name.slice(0, 200) : null,
    acr: typeof payload.acr === "string" ? payload.acr : null,
    amr: Array.isArray(payload.amr) ? payload.amr.filter((m): m is string => typeof m === "string").slice(0, 10) : [],
    authTime: typeof payload.auth_time === "number" && Number.isFinite(payload.auth_time) ? payload.auth_time : null,
  };
}

// ---- Passport's authenticator as this app's second step --------------------------------------
// The owner decided (2026-11-11) that a person who passed Passport's authenticator is not asked for
// this app's as well. The ID token says so (`acr: aal2`, with `mfa` among the methods). That fact
// has to reach the session the web app is about to get, and nothing else:
//   1. the callback records it against the SHA-256 of the one-time sign-in token it hands over;
//   2. the web app redeems the token for a session, then presents the same token to
//      `POST /gms/passport/signin/second-step`;
//   3. the record is bound to that session's id, once. Only that session counts as verified, and
//      only until the trust runs out.
// An email-code session never holds the token, so it cannot claim; a second session of the same
// person does not inherit it; the record alone gives no access.

/** How long after the hand-over the session may claim. The one-time token itself is redeemed in seconds. */
export const SECOND_STEP_CLAIM_MS = 10 * 60 * 1000;
/** How long Passport's authenticator is trusted, counted from when the person passed it at Passport. */
export const SECOND_STEP_TRUST_MS = 12 * 60 * 60 * 1000;

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether Passport's ID token says the person passed its authenticator. */
export function passedPassportAuthenticator(who: Pick<PassportIdentity, "acr" | "amr">): boolean {
  return who.acr === "aal2" && who.amr.includes("mfa");
}

async function rememberSecondStep(ctx: BaseContext, userId: string, who: PassportIdentity, tokenHash: string): Promise<void> {
  const store = ctx.ports.secondSteps;
  if (!store || !passedPassportAuthenticator(who) || who.authTime === null) return;
  const now = ctx.now();
  const authTime = new Date(who.authTime * 1000);
  // A time ahead of ours (beyond clock skew) is not a time we can count from.
  if (authTime.getTime() > now.getTime() + CLOCK_SKEW_SEC * 1000) return;
  const validUntil = new Date(authTime.getTime() + SECOND_STEP_TRUST_MS);
  if (validUntil <= now) return;
  try {
    await store.record({ userId, tokenDigest: await sha256Hex(tokenHash), acr: "aal2", authTime, claimBy: new Date(now.getTime() + SECOND_STEP_CLAIM_MS), validUntil });
  } catch {
    // The sign-in still works; the person is asked for this app's own second step instead.
  }
}

/**
 * How long the session that redeemed a first Passport sign-in for an existing account has to pass
 * that account's own second step for the Passport identity to be linked. After it, nothing is
 * linked and the next Passport sign-in starts again.
 */
export const LINK_CONFIRM_WINDOW_MS = 60 * 60 * 1000;

/**
 * The account existed before this Passport user arrived (matched by verified email). Nothing is
 * linked yet and Passport's authenticator is NOT taken as this app's second step: the request is
 * remembered against the one-time sign-in token, for the one session that redeems it.
 */
async function requestLink(ctx: BaseContext, userId: string, who: PassportIdentity, tokenHash: string): Promise<void> {
  const store = ctx.ports.secondSteps;
  if (!store) return;
  const now = ctx.now();
  try {
    await store.requestLink({ userId, tokenDigest: await sha256Hex(tokenHash), passportUserId: who.passportUserId, claimBy: new Date(now.getTime() + SECOND_STEP_CLAIM_MS), validUntil: new Date(now.getTime() + LINK_CONFIRM_WINDOW_MS) });
  } catch {
    // The sign-in still works, single-step. The link is offered again at the next Passport sign-in.
  }
}

/**
 * Called for a session that has passed THIS account's own second step (Supabase `aal2`): if that
 * same session redeemed a first Passport sign-in, the Passport identity is now linked to the
 * account, once, and ledgered. Answers whether a link was recorded by this call.
 *
 * Link, then ledger, then forget the request: if the ledger write fails the request is still
 * there, and the next call writes the entry for the link that already exists.
 */
export async function confirmPassportLink(ctx: ServiceContext, sessionId: string | null, accountEmail?: string | null): Promise<boolean> {
  const store = ctx.ports.secondSteps;
  const identity = ctx.ports.identity;
  const userId = ctx.actor.userId;
  if (!store || !identity || !userId || !sessionId) return false;
  const passportUserId = await store.pendingLink(userId, sessionId, ctx.now());
  if (!passportUserId) return false;
  const outcome = await identity.linkPassportUser(userId, passportUserId, sessionId);
  // Refused (the account or the Passport user is linked elsewhere): the request runs out by itself.
  if (outcome === "refused") return false;
  const ledgered = outcome === "already" && (await ctx.ledger.count({ subjectType: "user", subjectId: userId, eventType: "auth.passport_linked" })) > 0;
  if (!ledgered) await audit(ctx, "auth.passport_linked", "user", userId, { passportUserId, confirmedBy: "own_second_step" });
  await store.settleLinks(userId);
  if (outcome !== "recorded") return false;
  // Tell the account's own address: a link the person did not make is something to act on.
  if (accountEmail && ctx.ports.mailer && ctx.config.mailFrom) {
    const text = `Your OpenGrants GMS account can now be signed in to with OpenGrants Passport.\n\nThis was set up just now, after someone signed in with Passport using this email address and then confirmed it with this account's own two-step verification. From now on, signing in with Passport is enough.\n\nIf this was not you, sign in at ${ctx.config.webBaseUrl}, end your other sessions in Account settings, and contact support so the link can be removed.`;
    await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [accountEmail], subject: "Passport sign-in was linked to your account", text, html: `<p>${text.replace(/\n\n/g, "</p><p>")}</p>`, idempotencyKey: `passport-linked:${userId}` }).catch(() => undefined);
  }
  return true;
}

/** A one-time sign-in token as Supabase issues it: URL-safe, bounded. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Step 3, called by the web app with the session it just received: bind Passport's second step to
 * this session. Answers whether the session now counts as verified; never says why not.
 */
export async function claimSecondStep(ctx: ServiceContext, input: { tokenHash: string; sessionId: string | null }): Promise<{ verified: boolean; validUntil: string | null }> {
  const none = { verified: false, validUntil: null };
  const store = ctx.ports.secondSteps;
  const userId = ctx.actor.userId;
  if (!store || !userId || !input.sessionId || !TOKEN_HASH.test(input.tokenHash)) return none;
  const digest = await sha256Hex(input.tokenHash);
  const claimed = await store.claim(userId, digest, input.sessionId, ctx.now());
  if (!claimed) {
    // A first Passport sign-in for an account that already existed: the session takes the pending
    // link, which verifies nothing until this account's own second step is passed.
    await store.claimLink(userId, digest, input.sessionId, ctx.now());
    return none;
  }
  await audit(ctx, "auth.second_step_from_passport", "user", userId, { validUntil: claimed.validUntil.toISOString() });
  return { verified: true, validUntil: claimed.validUntil.toISOString() };
}

export type SignInOutcome = { ok: true; redirect: string; userId: string; workspaceId: string | null } | { ok: false; redirect: string; code: SignInErrorCode };

/**
 * Step 2: Passport sends the browser back. Always answers with a redirect into the web app: to
 * `/auth/passport#token_hash=…` (the one-time sign-in travels in the fragment, which is never sent
 * to a server or logged) or to `/signin?passport_error=<code>`.
 */
export async function completeSignIn(ctx: BaseContext, query: { code?: string; state?: string; error?: string }, cookieBinding: string | undefined): Promise<SignInOutcome> {
  // The person sees one of a few plain messages; the log says which step stopped and why, so a
  // failed sign-in can be diagnosed. Never a token, a code or an email: the step, the error's
  // class and message, and an upstream status when there is one.
  const fail = (code: SignInErrorCode, step?: string, cause?: unknown): SignInOutcome => {
    const e = cause instanceof Error ? cause : null;
    log(code === "cancelled" ? "info" : "warn", "passport.signin_failed", {
      // Not `code`: the logger blanks any field of that name, as it does an authorization code.
      outcome: code,
      ...(step ? { step } : {}),
      ...(e ? { error: e.name, detail: e.message.slice(0, 200), ...(typeof (e as { status?: unknown }).status === "number" ? { upstreamStatus: (e as { status?: number }).status } : {}) } : {}),
    });
    return { ok: false, code, redirect: signInErrorRedirect(ctx, code) };
  };
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  const identity = ctx.ports.identity;
  if (!baseUrl || !key || !client || !identity) return fail("not_configured");

  let sealed: SealedSignIn;
  try {
    sealed = JSON.parse(await decryptSecret(query.state ?? "", key)) as SealedSignIn;
  } catch (e) {
    return fail("state_mismatch", "state", e);
  }
  if (!sealed.v || !sealed.n || !sealed.b || typeof sealed.h !== "string" || !HOP.test(sealed.h) || typeof sealed.exp !== "number") return fail("state_mismatch");
  // The flow must finish in the browser that started it.
  if (!cookieBinding || !timingSafeEqual(cookieBinding, sealed.b)) return fail("state_mismatch");
  if (sealed.exp < ctx.now().getTime()) return fail("expired");
  if (query.error) return fail(query.error === "access_denied" ? "cancelled" : "unavailable");
  if (!query.code) return fail("state_mismatch");

  let tokens;
  let who: PassportIdentity;
  try {
    tokens = await exchangeCode({ baseUrl, clientId: client.id, clientSecret: client.secret, code: query.code, codeVerifier: sealed.v, redirectUri: callbackUri(ctx), fetch: ctx.config.passportFetch });
  } catch (e) {
    if (e instanceof PassportUnavailableError) return fail("unavailable", "token_exchange", e);
    // A used, expired or foreign code: the person starts again.
    if (e instanceof PassportAuthError) return fail("expired", "token_exchange", e);
    throw e;
  }
  if (!tokens.idToken) return fail("state_mismatch");
  let keys: JSONWebKeySet;
  try {
    keys = await passportJwks(ctx, baseUrl);
    // Passport rotated its key since the set was cached: read it again, once.
    const kid = kidOf(tokens.idToken);
    if (kid && !keys.keys.some((k) => k.kid === kid)) keys = await passportJwks(ctx, baseUrl, { fresh: true });
  } catch (e) {
    return fail("unavailable", "keys", e);
  }
  try {
    who = await verifyIdToken(tokens.idToken, { keys, issuer: ctx.config.passportIssuer ?? baseUrl, clientId: client.id, nonce: sealed.n, now: ctx.now() });
  } catch (e) {
    return fail("state_mismatch", "id_token", e);
  }
  if (!who.email || !who.emailVerified) return fail("email_unverified");

  // An organization was approved only if the token names one and carries the consent to refresh.
  const org = tokens.orgId && tokens.refreshToken && tokens.scopes.includes("org:read") ? { orgId: tokens.orgId, refreshToken: tokens.refreshToken, scopes: tokens.scopes } : null;

  if (!org) {
    // Signed in at Passport without an organization. Someone who already belongs to a workspace
    // here is signed in; someone new has nothing to open yet and is sent to claim an organization.
    const existing = await identity.findByEmail(who.email);
    const memberships = existing ? await ctx.repos.table("workspace_members").count({ user_id: existing }) : 0;
    if (memberships === 0) return fail("no_organization");
  }

  // Read the organization before creating anything, so an outage leaves no half-made account.
  let read = null;
  if (org) {
    try {
      read = await readConsentedOrganization(ctx, tokens.accessToken, org.orgId);
    } catch (e) {
      if (e instanceof PassportUnavailableError || e instanceof PassportAuthError || e instanceof PassportApiError) return fail("unavailable", "organization_read", e);
      throw e;
    }
  }

  let account;
  try {
    account = await identity.ensureUser(who.email, { passportUserId: who.passportUserId, name: who.name });
  } catch (e) {
    // The email already belongs to an account tied to a different Passport user.
    if (e instanceof AccountMismatchError) return fail("account_mismatch", "account", e);
    throw e;
  }
  const { userId, created, link } = account;
  const svc: ServiceContext = { ...ctx, actor: makeActor("user", userId, null), workspace: null, scopes: [] };
  const ws = org && read ? await linkApplicantOrganization(svc, { userId, tokens: org, read, workspaceHint: null, via: "passport_signin" }) : null;
  await audit(svc, "auth.passport_signin", "user", userId, { created, linkedOrganization: !!ws, acr: who.acr, passportLink: link }, ws?.id);
  // Every link has its own ledger entry, however it was made.
  if (created && link === "recorded") await audit(svc, "auth.passport_linked", "user", userId, { passportUserId: who.passportUserId, confirmedBy: "account_created" });

  const signIn = await identity.signInToken(who.email);
  // Passport's authenticator stands in for this app's second step only for an account with a
  // recorded link to this Passport user (made before, or by this sign-in creating the account).
  // An account that merely shares the email must pass its own second step first, in the session
  // this sign-in starts; see `confirmPassportLink`.
  if (link === "recorded") await rememberSecondStep(ctx, userId, who, signIn.tokenHash);
  else await requestLink(ctx, userId, who, signIn.tokenHash);
  const next = sealed.r ?? (ws ? `/w/${ws.handle}` : null);
  const fragment = new URLSearchParams({ token_hash: signIn.tokenHash, type: signIn.type, hop: sealed.h, ...(next ? { next } : {}) });
  return { ok: true, userId, workspaceId: ws?.id ?? null, redirect: `${ctx.config.webBaseUrl}/auth/passport#${fragment.toString()}` };
}
