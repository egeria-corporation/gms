// SPDX-License-Identifier: AGPL-3.0-only
// Access tokens for a workspace's Passport consent, safe under concurrent requests and workers.
//
// Passport rotates the refresh token on every use and treats a token presented twice as theft: it
// revokes the consent (it forgives a second presentation within a few seconds, and nothing here
// relies on that in the ordinary case). The API runs as many short-lived workers, and a page of
// the web app makes several requests at once. Four things keep them from spending the same
// refresh token:
//
//   1. The access token is stored with the link (`access_token_enc`, encrypted like the refresh
//      token beside it). A worker that starts cold reads it and spends nothing.
//   2. It is also kept in this worker's memory until shortly before it expires.
//   3. Within one request, concurrent callers share a single refresh. Requests do not share a
//      pending refresh: on Workers a promise belongs to the request that created it, and if that
//      request is cancelled the others would wait on it for good.
//   4. New tokens are written only if the row's `token_version` is still the one that was read.
//      A request that loses that swap adopts the winner's stored access token; a refused refresh
//      re-reads the row once and uses what another request stored meanwhile.
//
// What is left to Passport's forgiveness: two workers that both find the stored access token
// expired at the same moment both present the same refresh token.
//
// The swap compares an integer, so no ciphertext appears in a query filter. Tokens are never logged.
import { PassportAuthError, decryptSecret, encryptSecret, exchangeRefreshToken, type FetchLike, type TokenProvider } from "@gms/passport-client";
import type { ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

interface Cached {
  token: string;
  /** Epoch ms after which the token is no longer handed out. */
  goodUntil: number;
}

const cache = new Map<string, Cached>();
/** Hand a token out only while it has at least this long to live. */
const SKEW_MS = 60_000;

/** Test hook: forget every cached token, as a worker that has just started. */
export function clearPassportTokenCache(): void {
  cache.clear();
}

type Ctx = Pick<ServiceContext, "repos" | "now" | "config">;
type Link = Row<"passport_links">;
interface Opts {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  key: string;
  fetch?: FetchLike;
}

/** The access token stored on the row, if it still has long enough to live. */
async function stored(ctx: Ctx, link: Link, key: string): Promise<Cached | null> {
  if (!link.access_token_enc || !link.access_token_expires_at) return null;
  const goodUntil = Date.parse(link.access_token_expires_at) - SKEW_MS;
  if (!(ctx.now().getTime() < goodUntil)) return null;
  try {
    return { token: await decryptSecret(link.access_token_enc, key), goodUntil };
  } catch {
    // Unreadable (a rotated key, a damaged value): treat as absent and refresh.
    return null;
  }
}

async function obtain(ctx: Ctx, linkId: string, opts: Opts, skipStored: boolean): Promise<string> {
  const links = ctx.repos.table("passport_links");
  const read = () => links.one({ id: linkId, revoked_at: null });
  const keep = (c: Cached) => {
    cache.set(linkId, c);
    return c.token;
  };

  let link = await read();
  if (!link?.refresh_token_enc) throw new PassportAuthError("invalid_grant", "This workspace has no Passport consent");
  if (!skipStored) {
    const have = await stored(ctx, link, opts.key);
    if (have) return keep(have);
  }

  let tokens;
  try {
    tokens = await exchangeRefreshToken({ ...opts, refreshToken: await decryptSecret(link.refresh_token_enc, opts.key) });
  } catch (e) {
    if (!(e instanceof PassportAuthError)) throw e;
    // Refused. If another request stored new tokens since the row was read, use those: its access
    // token if there is one, otherwise its refresh token, once. An unchanged row means the consent
    // really is gone.
    const again = await read();
    if (!again?.refresh_token_enc || again.token_version === link.token_version) throw e;
    const theirs = await stored(ctx, again, opts.key);
    if (theirs) return keep(theirs);
    link = again;
    tokens = await exchangeRefreshToken({ ...opts, refreshToken: await decryptSecret(again.refresh_token_enc, opts.key) });
  }

  const expiresAt = ctx.now().getTime() + tokens.expiresIn * 1000;
  // Keep the access token before the write-back, so a failed write does not throw it away.
  const mine = keep({ token: tokens.accessToken, goodUntil: expiresAt - SKEW_MS });

  const patch = {
    ...(tokens.refreshToken ? { refresh_token_enc: await encryptSecret(tokens.refreshToken, opts.key) } : {}),
    access_token_enc: await encryptSecret(tokens.accessToken, opts.key),
    access_token_expires_at: new Date(expiresAt).toISOString(),
    token_version: link.token_version + 1,
  };
  // Stored only if nobody else has written tokens since the row was read. A write that fails is
  // tried once more: the row would otherwise keep a spent refresh token.
  const write = () => links.update({ id: linkId, token_version: link.token_version, revoked_at: null }, patch);
  let written;
  try {
    written = await write();
  } catch {
    written = await write();
  }
  if (written.length === 0) {
    // Lost the swap: another request stored a live pair. Use its access token so every worker
    // holds the same one; the token in hand is still valid if that cannot be read.
    const winner = await read();
    const theirs = winner ? await stored(ctx, winner, opts.key) : null;
    if (theirs) return keep(theirs);
  }
  return mine;
}

/**
 * A token provider for one `passport_links` row (an applicant's consent). Create it per request:
 * the stored token and the in-memory cache are shared by every provider for the same link, the
 * pending refresh is this provider's own.
 */
export function consentTokens(ctx: Ctx, linkId: string, opts: { baseUrl: string; clientId: string; clientSecret: string; key: string }): TokenProvider {
  const withFetch: Opts = { ...opts, ...(ctx.config.passportFetch ? { fetch: ctx.config.passportFetch } : {}) };
  let pending: Promise<string> | undefined;
  // Set after Passport answered 401 to the current token: the stored copy is the same token, so
  // the next call refreshes instead of reading it, and the refresh overwrites it for everyone.
  let rejected = false;
  return {
    invalidate() {
      cache.delete(linkId);
      rejected = true;
    },
    getToken() {
      if (!rejected) {
        const hit = cache.get(linkId);
        if (hit && ctx.now().getTime() < hit.goodUntil) return Promise.resolve(hit.token);
      }
      pending ??= obtain(ctx, linkId, withFetch, rejected)
        .then((token) => {
          rejected = false;
          return token;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
