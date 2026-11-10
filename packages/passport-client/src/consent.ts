// SPDX-License-Identifier: AGPL-3.0-only
// Applicant consent: Passport's authorization code + PKCE flow, with the GMS as the client
// ("OpenGrants GMS"). The applicant picks the organization on Passport's consent screen; the access
// token comes back bound to it (`https://commongrants.org/org_id`).
import { PassportAuthError, PassportUnavailableError } from "./errors.ts";
import type { FetchLike } from "./tokens.ts";

export const APPLICANT_CONSENT_SCOPES = ["org:read", "org.changes:read", "org.changes:write"] as const;
export const PASSPORT_ORG_CLAIM = "https://commongrants.org/org_id";

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A fresh PKCE verifier (43 characters) and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export interface AuthorizeUrlInput {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}

export function buildAuthorizeUrl(i: AuthorizeUrlInput): string {
  const url = new URL(`${i.baseUrl.replace(/\/+$/, "")}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: i.clientId,
    redirect_uri: i.redirectUri,
    scope: (i.scopes ?? APPLICANT_CONSENT_SCOPES).join(" "),
    state: i.state,
    code_challenge: i.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface CodeExchangeInput {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface ConsentTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
  /** The organization the applicant consented for. */
  orgId: string;
}

/** The org id claim of an access token we just received from Passport's token endpoint over TLS. */
export function orgIdFromAccessToken(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    const org = json[PASSPORT_ORG_CLAIM];
    return typeof org === "string" && org ? org : null;
  } catch {
    return null;
  }
}

export async function exchangeAuthorizationCode(i: CodeExchangeInput): Promise<ConsentTokens> {
  const doFetch = i.fetch ?? (fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${i.baseUrl.replace(/\/+$/, "")}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${encodeURIComponent(i.clientId)}:${encodeURIComponent(i.clientSecret)}`)}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code: i.code, code_verifier: i.codeVerifier, redirect_uri: i.redirectUri }).toString(),
    });
  } catch {
    throw new PassportUnavailableError("Passport's token endpoint could not be reached");
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (res.status >= 500) throw new PassportUnavailableError("Passport's token endpoint is unavailable", res.status);
  if (!res.ok || !body.access_token) throw new PassportAuthError(body.error ?? "invalid_grant", body.error_description ?? "Passport refused the authorization code");
  const orgId = orgIdFromAccessToken(body.access_token);
  if (!orgId || !body.refresh_token) throw new PassportAuthError("invalid_token_response", "Passport's token response did not name an organization or carry a refresh token");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in ?? 0, scopes: body.scope ? body.scope.split(/\s+/).filter(Boolean) : [], orgId };
}
