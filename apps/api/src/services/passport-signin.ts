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
  };
}

export type SignInOutcome = { ok: true; redirect: string; userId: string; workspaceId: string | null } | { ok: false; redirect: string; code: SignInErrorCode };

/**
 * Step 2: Passport sends the browser back. Always answers with a redirect into the web app: to
 * `/auth/passport#token_hash=…` (the one-time sign-in travels in the fragment, which is never sent
 * to a server or logged) or to `/signin?passport_error=<code>`.
 */
export async function completeSignIn(ctx: BaseContext, query: { code?: string; state?: string; error?: string }, cookieBinding: string | undefined): Promise<SignInOutcome> {
  const fail = (code: SignInErrorCode): SignInOutcome => ({ ok: false, code, redirect: signInErrorRedirect(ctx, code) });
  const { passportBaseUrl: baseUrl, credentialsKey: key, passportClient: client } = ctx.config;
  const identity = ctx.ports.identity;
  if (!baseUrl || !key || !client || !identity) return fail("not_configured");

  let sealed: SealedSignIn;
  try {
    sealed = JSON.parse(await decryptSecret(query.state ?? "", key)) as SealedSignIn;
  } catch {
    return fail("state_mismatch");
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
    if (e instanceof PassportUnavailableError) return fail("unavailable");
    // A used, expired or foreign code: the person starts again.
    if (e instanceof PassportAuthError) return fail("expired");
    throw e;
  }
  if (!tokens.idToken) return fail("state_mismatch");
  let keys: JSONWebKeySet;
  try {
    keys = await passportJwks(ctx, baseUrl);
    // Passport rotated its key since the set was cached: read it again, once.
    const kid = kidOf(tokens.idToken);
    if (kid && !keys.keys.some((k) => k.kid === kid)) keys = await passportJwks(ctx, baseUrl, { fresh: true });
  } catch {
    return fail("unavailable");
  }
  try {
    who = await verifyIdToken(tokens.idToken, { keys, issuer: ctx.config.passportIssuer ?? baseUrl, clientId: client.id, nonce: sealed.n, now: ctx.now() });
  } catch {
    return fail("state_mismatch");
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
      if (e instanceof PassportUnavailableError || e instanceof PassportAuthError || e instanceof PassportApiError) return fail("unavailable");
      throw e;
    }
  }

  let account;
  try {
    account = await identity.ensureUser(who.email, { passportUserId: who.passportUserId, name: who.name });
  } catch (e) {
    // The email already belongs to an account tied to a different Passport user.
    if (e instanceof AccountMismatchError) return fail("account_mismatch");
    throw e;
  }
  const { userId, created } = account;
  const svc: ServiceContext = { ...ctx, actor: makeActor("user", userId, null), workspace: null, scopes: [] };
  const ws = org && read ? await linkApplicantOrganization(svc, { userId, tokens: org, read, workspaceHint: null, via: "passport_signin" }) : null;
  await audit(svc, "auth.passport_signin", "user", userId, { created, linkedOrganization: !!ws, acr: who.acr }, ws?.id);

  const signIn = await identity.signInToken(who.email);
  const next = sealed.r ?? (ws ? `/w/${ws.handle}` : null);
  const fragment = new URLSearchParams({ token_hash: signIn.tokenHash, type: signIn.type, hop: sealed.h, ...(next ? { next } : {}) });
  return { ok: true, userId, workspaceId: ws?.id ?? null, redirect: `${ctx.config.webBaseUrl}/auth/passport#${fragment.toString()}` };
}
