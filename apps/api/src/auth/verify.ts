// SPDX-License-Identifier: AGPL-3.0-only
// The seven-step inbound check for GMS access tokens (the shape of Passport's check, which follows
// https://commongrants.org/protocol/auth/). Steps 1–6 are `verifyAccessToken`; step 7 is the scope
// and workspace binding, applied per route by the middleware.
//
//   1. a bearer token is present and well formed
//   2. header: alg is ES256, typ is an access token, kid is present
//   3. signature verifies against the issuer's JWKS
//   4. iss is a trusted issuer
//   5. aud is this API
//   6. exp is in the future, nbf/iat are not (60 s skew); sub is present
//   7. the token's scope covers the operation and its workspace is the one being acted on
import { compactVerify, createLocalJWKSet, decodeJwt, decodeProtectedHeader, type JWK, type JWTPayload } from "jose";
import { trimSlash } from "../env.ts";
import { ApiError } from "../lib/errors.ts";
import { ORG_ID_CLAIM, WORKSPACE_CLAIM, parseScopeString } from "./scopes.ts";

export const CLOCK_SKEW_SEC = 60;
export const ACCESS_TOKEN_TYP = "at+jwt";

export interface TokenClaims {
  issuer: string;
  sub: string;
  clientId: string;
  /** The user a delegated token acts for; null for client-credentials tokens. */
  userId: string | null;
  workspaceId: string | null;
  orgId: string | null;
  scopes: string[];
  grantType: string | null;
  jti: string | null;
}

export interface VerifyContext {
  /** Our own base URL; inbound tokens must carry it as `aud`. */
  audience: string;
  /** Issuer → the public keys that may sign its access tokens. */
  trustedIssuers: Record<string, () => Promise<{ keys: JWK[] }>>;
  now: Date;
}

const REALM = "gms";

export const authError = (code: string, message: string) =>
  new ApiError(401, code, message, [], { "WWW-Authenticate": `Bearer realm="${REALM}", error="invalid_token", error_description="${message}"` });

export const forbidden = (code: string, message: string, scope?: string) =>
  new ApiError(403, code, message, [], { "WWW-Authenticate": `Bearer realm="${REALM}", error="insufficient_scope"${scope ? `, scope="${scope}"` : ""}` });

export async function verifyAccessToken(token: string | null | undefined, ctx: VerifyContext): Promise<TokenClaims> {
  // Step 1: present and well formed.
  if (!token) throw authError("missing_token", "A bearer token is required");
  let header;
  let unverified: JWTPayload;
  try {
    header = decodeProtectedHeader(token);
    unverified = decodeJwt(token);
  } catch {
    throw authError("invalid_token", "Malformed access token");
  }

  // Step 2: header.
  if (header.alg !== "ES256") throw authError("invalid_token", "Unsupported token algorithm");
  if (header.typ !== undefined && !/^(at\+jwt|jwt)$/i.test(header.typ)) throw authError("invalid_token", "Not an access token");
  if (typeof header.kid !== "string" || !header.kid) throw authError("invalid_token", "Token has no key id");

  // The issuer selects the key set, so it is read before the signature check. An untrusted issuer
  // has no key set and is rejected here; step 4 re-checks the verified payload.
  const issuer = typeof unverified.iss === "string" ? unverified.iss : "";
  const jwks = ctx.trustedIssuers[issuer];
  if (!jwks) throw authError("untrusted_issuer", "Token issuer is not trusted");

  // Step 3: signature.
  let payload: JWTPayload;
  try {
    const { payload: raw } = await compactVerify(token, createLocalJWKSet(await jwks()), { algorithms: ["ES256"] });
    payload = JSON.parse(new TextDecoder().decode(raw)) as JWTPayload;
  } catch {
    throw authError("invalid_signature", "Token signature is invalid");
  }

  // Step 4: iss.
  if (payload.iss !== issuer) throw authError("untrusted_issuer", "Token issuer is not trusted");

  // Step 5: aud.
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!auds.map(trimSlash).includes(trimSlash(ctx.audience))) throw authError("invalid_audience", "Token audience does not match this API");

  // Step 6: time and subject.
  const now = Math.floor(ctx.now.getTime() / 1000);
  if (typeof payload.exp !== "number") throw authError("invalid_token", "Token has no expiry");
  if (now - CLOCK_SKEW_SEC >= payload.exp) throw authError("token_expired", "Token has expired");
  if (typeof payload.nbf === "number" && now + CLOCK_SKEW_SEC < payload.nbf) throw authError("invalid_token", "Token is not yet valid");
  if (typeof payload.iat === "number" && now + CLOCK_SKEW_SEC < payload.iat) throw authError("invalid_token", "Token issued in the future");
  if (typeof payload.sub !== "string" || !payload.sub) throw authError("invalid_token", "Token has no subject");

  const claim = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  const clientId = claim("client_id") ?? payload.sub;
  return {
    issuer,
    sub: payload.sub,
    clientId,
    userId: payload.sub === clientId ? null : payload.sub,
    workspaceId: claim(WORKSPACE_CLAIM),
    orgId: claim(ORG_ID_CLAIM),
    scopes: parseScopeString(claim("scope")),
    grantType: claim("grant_type"),
    jti: claim("jti"),
  };
}

/** Step 7a: the token's scope covers the operation. */
export function checkScope(scopes: readonly string[], required: string): void {
  if (!scopes.includes(required)) throw forbidden("insufficient_scope", `This request needs the ${required} scope`, required);
}

/** Step 7b: the token acts on the workspace it is bound to and no other. */
export function checkWorkspaceBinding(boundWorkspaceId: string | null, targetWorkspaceId: string): void {
  if (!boundWorkspaceId) throw forbidden("workspace_required", "Token is not bound to a workspace");
  if (boundWorkspaceId !== targetWorkspaceId) throw forbidden("workspace_mismatch", "Token is bound to a different workspace");
}
