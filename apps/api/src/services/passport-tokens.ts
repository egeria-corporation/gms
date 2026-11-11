// SPDX-License-Identifier: AGPL-3.0-only
// Access tokens for a workspace's Passport consent, safe under concurrent requests.
//
// Passport rotates the refresh token on every use and treats a token presented twice as theft: it
// revokes the consent. A page of the web app makes several requests at once, and each used to
// read the stored refresh token, spend it, and write the new one back. Two of them spending the
// same token, or their write-backs landing out of order, stranded the link until the person
// reconnected (seen on the hosted site on 2026-11-11). Three things prevent that here:
//
//   1. The access token is kept in this isolate's memory until shortly before it expires, so most
//      requests spend no refresh token at all.
//   2. Within one request, concurrent callers for one link share a single refresh. Requests do not
//      share a pending refresh: on Workers a promise belongs to the request that created it, and
//      if that request is cancelled the others would wait on it for good. Two requests that both
//      refresh are covered by 3 and by Passport forgiving a token presented twice within seconds.
//   3. Across isolates, the write-back is a compare-and-swap on the ciphertext that was read. A
//      request that loses keeps its access token (still valid) and leaves the winner's refresh
//      token stored; a refused refresh re-reads the row once and retries with what is there now.
//
// Nothing is kept outside memory: the only KV namespace bound to the API is the rate limiter, and
// a bearer token does not belong in it.
import { PassportAuthError, decryptSecret, encryptSecret, exchangeRefreshToken, type FetchLike, type TokenProvider } from "@gms/passport-client";
import type { ServiceContext } from "./context.ts";

interface Cached {
  token: string;
  /** Epoch ms after which the token is no longer handed out. */
  goodUntil: number;
}

const cache = new Map<string, Cached>();
/** Hand a token out only while it has at least this long to live. */
const SKEW_MS = 60_000;

/** Test hook: forget every cached token. */
export function clearPassportTokenCache(): void {
  cache.clear();
}

type Ctx = Pick<ServiceContext, "repos" | "now" | "config">;

async function refresh(ctx: Ctx, linkId: string, opts: { baseUrl: string; clientId: string; clientSecret: string; key: string; fetch?: FetchLike }): Promise<string> {
  const read = () => ctx.repos.table("passport_links").one({ id: linkId, revoked_at: null });
  let link = await read();
  if (!link?.refresh_token_enc) throw new PassportAuthError("invalid_grant", "This workspace has no Passport consent");
  let spent = link.refresh_token_enc;
  let tokens;
  try {
    tokens = await exchangeRefreshToken({ ...opts, refreshToken: await decryptSecret(spent, opts.key) });
  } catch (e) {
    if (!(e instanceof PassportAuthError)) throw e;
    // Refused. If another request rotated the token since it was read, the row holds a newer one:
    // use that once. If the row is unchanged, the consent really is gone.
    link = await read();
    if (!link?.refresh_token_enc || link.refresh_token_enc === spent) throw e;
    spent = link.refresh_token_enc;
    tokens = await exchangeRefreshToken({ ...opts, refreshToken: await decryptSecret(spent, opts.key) });
  }
  // Keep the access token before the write-back, so a failed write does not throw it away.
  cache.set(linkId, { token: tokens.accessToken, goodUntil: ctx.now().getTime() + tokens.expiresIn * 1000 - SKEW_MS });
  if (tokens.refreshToken) {
    // Store the new refresh token only if the row still holds the one just spent. Losing the swap
    // means another request already stored a live token; the access token in hand is still good.
    // A write that fails is tried once more: the row would otherwise keep a spent token.
    const next = await encryptSecret(tokens.refreshToken, opts.key);
    const write = () => ctx.repos.table("passport_links").update({ id: linkId, refresh_token_enc: spent }, { refresh_token_enc: next });
    try {
      await write();
    } catch {
      await write();
    }
  }
  return tokens.accessToken;
}

/**
 * A token provider for one `passport_links` row (an applicant's consent). Create it per request:
 * the cache is shared by every provider for the same link in this isolate, the pending refresh is
 * this provider's own.
 */
export function consentTokens(ctx: Ctx, linkId: string, opts: { baseUrl: string; clientId: string; clientSecret: string; key: string }): TokenProvider {
  const withFetch = { ...opts, ...(ctx.config.passportFetch ? { fetch: ctx.config.passportFetch } : {}) };
  let pending: Promise<string> | undefined;
  return {
    invalidate() {
      cache.delete(linkId);
    },
    getToken() {
      const hit = cache.get(linkId);
      if (hit && ctx.now().getTime() < hit.goodUntil) return Promise.resolve(hit.token);
      pending ??= refresh(ctx, linkId, withFetch).finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
