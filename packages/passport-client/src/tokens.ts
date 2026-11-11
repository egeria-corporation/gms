// SPDX-License-Identifier: AGPL-3.0-only
// Access tokens for Passport. Two grants:
//   - client credentials: the funder workspace's own Passport OAuth client (per tenant);
//   - refresh token: an applicant's consent to the GMS client (Passport rotates it on every use).
// Tokens are cached in memory and renewed `skewSec` before they expire.
import { PassportAuthError, PassportUnavailableError } from "./errors.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenProvider {
  getToken(): Promise<string>;
  /** Drop the cached token (after a 401) so the next call fetches a new one. */
  invalidate(): void;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

interface CommonOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => Date;
  /** Renew this many seconds before expiry. Default 60. */
  skewSec?: number;
}

export interface ClientCredentialsOptions extends CommonOptions {
  scopes?: string[];
}

export interface RefreshTokenOptions extends CommonOptions {
  refreshToken: string;
  /** Called with the rotated refresh token before the access token is used. Persist it (encrypted). */
  onRotate: (refreshToken: string) => Promise<void> | void;
}

function basic(id: string, secret: string): string {
  return `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;
}

async function requestToken(o: CommonOptions, form: Record<string, string>): Promise<TokenResponse> {
  const doFetch = o.fetch ?? (fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${o.baseUrl.replace(/\/+$/, "")}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: basic(o.clientId, o.clientSecret) },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new PassportUnavailableError("Passport's token endpoint could not be reached");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (res.status >= 500) throw new PassportUnavailableError("Passport's token endpoint is unavailable", res.status);
  if (!res.ok) throw new PassportAuthError(body.error ?? "invalid_request", body.error_description ?? `Token request refused (${res.status})`);
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") throw new PassportUnavailableError("Passport's token endpoint returned no token", res.status);
  return body as TokenResponse;
}

function cached(o: CommonOptions, obtain: () => Promise<TokenResponse>): TokenProvider {
  const now = o.now ?? (() => new Date());
  const skewMs = (o.skewSec ?? 60) * 1000;
  let token: string | null = null;
  let expiresAt = 0;
  let inFlight: Promise<string> | null = null;
  return {
    invalidate() {
      token = null;
      expiresAt = 0;
    },
    getToken() {
      if (token && now().getTime() < expiresAt - skewMs) return Promise.resolve(token);
      // One request at a time: concurrent callers share it (a refresh token can be used only once).
      inFlight ??= obtain()
        .then((t) => {
          token = t.access_token;
          expiresAt = now().getTime() + t.expires_in * 1000;
          return t.access_token;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}

export function clientCredentialsTokens(o: ClientCredentialsOptions): TokenProvider {
  return cached(o, () => requestToken(o, { grant_type: "client_credentials", ...(o.scopes?.length ? { scope: o.scopes.join(" ") } : {}) }));
}

export function refreshTokenTokens(o: RefreshTokenOptions): TokenProvider {
  let current = o.refreshToken;
  return cached(o, async () => {
    const t = await requestToken(o, { grant_type: "refresh_token", refresh_token: current });
    if (t.refresh_token && t.refresh_token !== current) {
      current = t.refresh_token;
      await o.onRotate(current);
    }
    return t;
  });
}

export interface RefreshExchange {
  accessToken: string;
  /** Seconds the access token lives. */
  expiresIn: number;
  /** The rotated refresh token; null if Passport sent none. */
  refreshToken: string | null;
}

/**
 * Spend a refresh token once and return what Passport answered. No caching and no persistence:
 * the caller decides where the rotated token goes. Use this when several requests (or several
 * Workers isolates) share one stored refresh token and must coordinate around the store.
 */
export async function exchangeRefreshToken(o: CommonOptions & { refreshToken: string }): Promise<RefreshExchange> {
  const t = await requestToken(o, { grant_type: "refresh_token", refresh_token: o.refreshToken });
  return { accessToken: t.access_token, expiresIn: t.expires_in, refreshToken: typeof t.refresh_token === "string" && t.refresh_token ? t.refresh_token : null };
}

/** A fixed token (tests, or a token obtained elsewhere). */
export function staticToken(token: string): TokenProvider {
  return { getToken: () => Promise.resolve(token), invalidate: () => {} };
}
