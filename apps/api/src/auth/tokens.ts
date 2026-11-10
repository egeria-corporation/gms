// SPDX-License-Identifier: AGPL-3.0-only
// Minting: access tokens (ES256, `at+jwt`) and the short-lived signed consent request that carries
// an authorization request from /oauth/authorize to the web consent screen and back.
import { SignJWT, compactVerify, type JWTPayload } from "jose";
import { createLocalJWKSet } from "jose";
import type { Env } from "../env.ts";
import type { KeyRing } from "../lib/keys.ts";
import { ORG_ID_CLAIM, WORKSPACE_CLAIM } from "./scopes.ts";
import { ACCESS_TOKEN_TYP } from "./verify.ts";

export const ACCESS_TOKEN_TTL_SEC = 3600;
export const REFRESH_TOKEN_TTL_SEC = 30 * 86_400;
export const CODE_TTL_SEC = 120;
export const CONSENT_REQUEST_TTL_SEC = 600;
const CONSENT_TYP = "gms-authz-request+jwt";
const CONSENT_AUD = "gms-consent";

export interface AccessTokenInput {
  /** The user for delegated tokens, the client id for client-credentials tokens. */
  sub: string;
  clientId: string;
  workspaceId: string;
  orgId?: string | null;
  scopes: string[];
  grantType: "client_credentials" | "authorization_code" | "refresh_token";
}

export async function mintAccessToken(env: Env, ring: KeyRing, input: AccessTokenInput, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: JWTPayload = {
    client_id: input.clientId,
    scope: input.scopes.join(" "),
    grant_type: input.grantType,
    [WORKSPACE_CLAIM]: input.workspaceId,
    ...(input.orgId ? { [ORG_ID_CLAIM]: input.orgId } : {}),
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: ring.kid, typ: ACCESS_TOKEN_TYP })
    .setIssuer(env.OAUTH_ISSUER)
    .setAudience(env.GMS_BASE_URL)
    .setSubject(input.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SEC)
    .setJti(crypto.randomUUID())
    .sign(ring.privateKey);
}

export interface ConsentRequest {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge: string;
}

export async function signConsentRequest(env: Env, ring: KeyRing, req: ConsentRequest, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ ...req })
    .setProtectedHeader({ alg: "ES256", kid: ring.kid, typ: CONSENT_TYP })
    .setIssuer(env.OAUTH_ISSUER)
    .setAudience(CONSENT_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CONSENT_REQUEST_TTL_SEC)
    .setJti(crypto.randomUUID())
    .sign(ring.privateKey);
}

/** Returns null for anything that is not a live consent request we signed. The `typ` keeps it from ever being accepted as an access token, and vice versa. */
export async function readConsentRequest(env: Env, ring: KeyRing, token: string, now: Date): Promise<ConsentRequest | null> {
  try {
    const { payload: raw, protectedHeader } = await compactVerify(token, createLocalJWKSet(ring.jwks), { algorithms: ["ES256"] });
    if (protectedHeader.typ !== CONSENT_TYP) return null;
    const p = JSON.parse(new TextDecoder().decode(raw)) as JWTPayload & Partial<ConsentRequest>;
    if (p.iss !== env.OAUTH_ISSUER || p.aud !== CONSENT_AUD) return null;
    if (typeof p.exp !== "number" || Math.floor(now.getTime() / 1000) >= p.exp) return null;
    if (!p.client_id || !p.redirect_uri || !p.scope || !p.code_challenge) return null;
    return { client_id: p.client_id, redirect_uri: p.redirect_uri, scope: p.scope, code_challenge: p.code_challenge, ...(p.state !== undefined ? { state: p.state } : {}) };
  } catch {
    return null;
  }
}
