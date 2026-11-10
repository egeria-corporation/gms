// SPDX-License-Identifier: AGPL-3.0-only
// OAuth 2.1 token endpoint (RFC 6749 as profiled by OAuth 2.1): client_credentials for workspace
// API clients, authorization_code + PKCE (S256) and refresh_token for agents acting for a person.
// Errors here use the RFC 6749 §5.2 shape, not the CommonGrants envelope.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { generateRefreshToken, sha256b64url, verifyPkce, verifySecret } from "../auth/crypto.ts";
import { APPROVALS_BYPASS_SCOPE, parseScopeString, scopesForRole } from "../auth/scopes.ts";
import type { OAuthClient } from "../auth/stores.ts";
import { ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_SEC, mintAccessToken } from "../auth/tokens.ts";
import { keyRing } from "../lib/keys.ts";

type OAuthErrorCode = "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope";

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    description: string,
    public readonly status: 400 | 401 = 400,
  ) {
    super(description);
  }
}

export function oauthErrorResponse(c: Context, err: OAuthError) {
  c.header("Cache-Control", "no-store");
  if (err.status === 401) c.header("WWW-Authenticate", 'Basic realm="gms"');
  return c.json({ error: err.code, error_description: err.message }, err.status);
}

async function readForm(c: Context<AppEnv>): Promise<Record<string, string>> {
  const type = c.req.header("Content-Type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "string") out[k] = v;
  } else {
    for (const [k, v] of Object.entries(await c.req.parseBody())) if (typeof v === "string") out[k] = v;
  }
  return out;
}

function basicCredentials(c: Context<AppEnv>): { id: string; secret: string } | null {
  const m = /^Basic\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!m) return null;
  try {
    const [id, ...rest] = atob(m[1]!).split(":");
    return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(":")) } : null;
  } catch {
    return null;
  }
}

/** Identify the client. Confidential clients must present their secret; public clients rely on PKCE. */
async function authenticateClient(c: Context<AppEnv>, form: Record<string, string>): Promise<OAuthClient> {
  const basic = basicCredentials(c);
  const clientId = basic?.id ?? form.client_id ?? "";
  const secret = basic?.secret ?? form.client_secret;
  const bad = new OAuthError("invalid_client", "Client authentication failed", 401);
  if (!clientId) throw bad;
  const client = await c.get("deps").auth.getClient(clientId);
  if (!client || client.revokedAt) throw bad;
  if (client.clientSecretHash) {
    if (!secret || !(await verifySecret(secret, client.clientSecretHash))) throw bad;
  } else if (secret) {
    throw bad; // a public client has no secret; sending one means the caller is confused about who it is
  }
  return client;
}

function requestedScopes(form: Record<string, string>, allowed: readonly string[]): string[] {
  const asked = parseScopeString(form.scope);
  if (!asked.length) return [...allowed];
  const bad = asked.filter((s) => !allowed.includes(s));
  if (bad.length) throw new OAuthError("invalid_scope", `Scope not allowed for this client: ${bad.join(" ")}`);
  return asked;
}

export const oauth = new Hono<AppEnv>();

oauth.post("/token", async (c) => {
  const { auth, members, now } = c.get("deps");
  const form = await readForm(c);
  const client = await authenticateClient(c, form);
  const grantType = form.grant_type ?? "";
  if (!["client_credentials", "authorization_code", "refresh_token"].includes(grantType)) throw new OAuthError("unsupported_grant_type", "Supported grants: client_credentials, authorization_code, refresh_token");
  const allowedGrant = grantType === "refresh_token" ? "authorization_code" : grantType;
  if (!client.grantTypes.includes(allowedGrant)) throw new OAuthError("unauthorized_client", `This client may not use the ${grantType} grant`);

  const ring = await keyRing(c.env);
  const at = now();
  const respond = (body: Record<string, unknown>) => {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    return c.json(body);
  };

  if (grantType === "client_credentials") {
    if (!client.clientSecretHash || !client.workspaceId) throw new OAuthError("unauthorized_client", "Only workspace API clients may use client_credentials");
    const scopes = requestedScopes(form, client.allowedScopes);
    const access = await mintAccessToken(c.env, ring, { sub: client.id, clientId: client.id, workspaceId: client.workspaceId, scopes, grantType: "client_credentials" }, at);
    return respond({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SEC, scope: scopes.join(" ") });
  }

  // A person's current role bounds what a delegated token can carry, at issue and at every refresh.
  const boundedByRole = async (workspaceId: string, userId: string, scopes: string[]) => {
    const m = await members.getMembership(workspaceId, userId);
    if (!m || (m.expiresAt && Date.parse(m.expiresAt) <= at.getTime())) throw new OAuthError("invalid_grant", "The person who granted access no longer belongs to this workspace");
    const role = new Set<string>(scopesForRole(m.workspaceKind, m.role));
    return scopes.filter((s) => role.has(s) || s === APPROVALS_BYPASS_SCOPE);
  };

  if (grantType === "authorization_code") {
    const { code, redirect_uri: redirectUri, code_verifier: verifier } = form;
    if (!code || !redirectUri || !verifier) throw new OAuthError("invalid_request", "code, redirect_uri and code_verifier are required");
    const record = await auth.consumeCode(await sha256b64url(code), at.toISOString());
    const invalid = new OAuthError("invalid_grant", "Authorization code is invalid, expired or already used");
    if (!record || record.clientId !== client.id || record.redirectUri !== redirectUri) throw invalid;
    if (Date.parse(record.expiresAt) <= at.getTime()) throw invalid;
    if (!(await verifyPkce(verifier, record.codeChallenge))) throw invalid;

    const scopes = await boundedByRole(record.workspaceId, record.userId, record.scopes);
    const refresh = generateRefreshToken();
    await auth.saveGrant({
      id: crypto.randomUUID(),
      tokenHash: await sha256b64url(refresh),
      clientId: client.id,
      userId: record.userId,
      workspaceId: record.workspaceId,
      scopes: record.scopes,
      expiresAt: new Date(at.getTime() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString(),
      revokedAt: null,
    });
    const access = await mintAccessToken(c.env, ring, { sub: record.userId, clientId: client.id, workspaceId: record.workspaceId, scopes, grantType: "authorization_code" }, at);
    return respond({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SEC, refresh_token: refresh, scope: scopes.join(" ") });
  }

  // refresh_token, with rotation: each refresh token works once.
  const presented = form.refresh_token;
  if (!presented) throw new OAuthError("invalid_request", "refresh_token is required");
  const presentedHash = await sha256b64url(presented);
  const grant = await auth.getGrantByTokenHash(presentedHash);
  const invalid = new OAuthError("invalid_grant", "Refresh token is invalid, expired or revoked");
  if (!grant || grant.clientId !== client.id || grant.revokedAt || Date.parse(grant.expiresAt) <= at.getTime()) throw invalid;
  const narrowed = parseScopeString(form.scope);
  if (narrowed.some((s) => !grant.scopes.includes(s))) throw new OAuthError("invalid_scope", "A refresh cannot widen scope");
  const scopes = await boundedByRole(grant.workspaceId, grant.userId, narrowed.length ? narrowed : grant.scopes);
  const next = generateRefreshToken();
  const rotated = await auth.rotateGrant(grant.id, presentedHash, await sha256b64url(next), new Date(at.getTime() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString());
  if (!rotated) throw invalid;
  const access = await mintAccessToken(c.env, ring, { sub: grant.userId, clientId: client.id, workspaceId: grant.workspaceId, scopes, grantType: "refresh_token" }, at);
  return respond({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SEC, refresh_token: next, scope: scopes.join(" ") });
});
