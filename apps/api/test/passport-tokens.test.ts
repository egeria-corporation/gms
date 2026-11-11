// SPDX-License-Identifier: AGPL-3.0-only
// The refresh-token race that stranded the Passport link on the hosted site (2026-11-11), and the
// stored access token that keeps cold workers from refreshing at all.
// The fake token endpoint below behaves as Passport does: a refresh token works once, and a token
// presented again withdraws the consent for good (optionally forgiving a replay, as Passport does
// for a few seconds after a rotation).
import { PassportAuthError, decryptSecret, encryptSecret, type FetchLike } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { clearPassportTokenCache, consentTokens } from "../src/services/passport-tokens.ts";
import { PASSPORT, TEST_CREDENTIALS_KEY, USER_OFFICER, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER } from "./scenario.ts";

const OPTS = { baseUrl: PASSPORT, clientId: "gms-test-client", clientSecret: "gms-test-client-secret-not-real", key: TEST_CREDENTIALS_KEY };

/** Passport's token endpoint and document list, with single-use refresh tokens and reuse detection. */
function strictPassport(opts: { forgiveReplay?: boolean; beforeToken?: (presented: string) => Promise<void> } = {}) {
  const state = { live: new Set(["rt-1"]), spent: new Set<string>(), revoked: false, n: 1, tokenCalls: 0, presented: [] as string[] };
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/oauth/token") {
      state.tokenCalls++;
      const presented = new URLSearchParams(String(init?.body)).get("refresh_token") ?? "";
      state.presented.push(presented);
      await opts.beforeToken?.(presented);
      const replay = state.spent.has(presented);
      if (state.revoked || (!state.live.has(presented) && !(replay && opts.forgiveReplay))) {
        if (replay) state.revoked = true;
        return Response.json({ error: "invalid_grant", error_description: "Refresh token is invalid or revoked" }, { status: 400 });
      }
      state.live.delete(presented);
      state.spent.add(presented);
      const next = `rt-${++state.n}`;
      state.live.add(next);
      return Response.json({ access_token: `at-${state.n}`, refresh_token: next, expires_in: 600, scope: "org:read" });
    }
    if (state.revoked) return Response.json({ status: 401, message: "Unauthorized", errors: [{ code: "invalid_token" }] }, { status: 401 });
    return Response.json({ status: 200, message: "Success", items: [], paginationInfo: { page: 1, pageSize: 0, totalItems: 0, totalPages: 0 } });
  };
  return { state, fetch };
}

let h: Harness;
let linkId: string;
beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: ORG_ALDER });
  const link = await h.repos.table("passport_links").insert({ workspace_id: WS_APPLICANT, mode: "applicant_consent", client_id: "gms-test-client", refresh_token_enc: await encryptSecret("rt-1", TEST_CREDENTIALS_KEY), scopes: ["org:read"], linked_by_user_id: USER_OFFICER, linked_at: "2027-02-03T00:00:00Z", last_ok_at: "2027-02-03T00:00:00Z" });
  linkId = link.id;
});

const stored = async () => decryptSecret((await h.repos.table("passport_links").one({ id: linkId }))!.refresh_token_enc!, TEST_CREDENTIALS_KEY);
const ctx = (fetch: FetchLike) => ({ repos: h.repos, now: () => h.clock.now, config: { passportFetch: fetch } }) as unknown as Parameters<typeof consentTokens>[0];

describe("requests through the API", () => {
  it("a page's parallel requests leave the link working", async () => {
    // Each request refreshes for itself (requests never wait on each other's promises), so
    // Passport sees rt-1 several times within a moment and forgives it, as the real one does.
    const p = strictPassport({ forgiveReplay: true });
    h.passport.fetch = p.fetch;
    const who = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_APPLICANT };
    const answers = await Promise.all(Array.from({ length: 8 }, () => h.request("/gms/me/documents", { headers: who })));
    expect(answers.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(p.state.revoked).toBe(false);
    // Only rt-1 was ever presented, and exactly one of the answers was stored.
    expect(new Set(p.state.presented)).toEqual(new Set(["rt-1"]));
    const kept = await stored();
    expect(p.state.live.has(kept)).toBe(true);
    expect(await h.repos.table("passport_links").count({ id: linkId, revoked_at: null })).toBe(1);

    // Later requests reuse the access token; nothing is spent until it is close to expiring.
    const calls = p.state.tokenCalls;
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(200);
    expect(p.state.tokenCalls).toBe(calls);
    h.clock.now = new Date(h.clock.now.getTime() + 9 * 60_000 + 1000);
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(200);
    expect(p.state.tokenCalls).toBe(calls + 1);
    expect(p.state.presented.at(-1)).toBe(kept);
    expect(p.state.revoked).toBe(false);
  });

  it("concurrent callers within one request share a single refresh", async () => {
    const p = strictPassport();
    const tokens = consentTokens(ctx(p.fetch), linkId, OPTS);
    expect(await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()])).toEqual(["at-2", "at-2", "at-2"]);
    expect(p.state.tokenCalls).toBe(1);
    expect(await stored()).toBe("rt-2");
  });

  it("a write-back that fails once is retried, and the access token is kept", async () => {
    const p = strictPassport();
    const table = h.repos.table.bind(h.repos);
    let failed = false;
    const repos = {
      table: (name: string) => {
        const t = table(name as "passport_links");
        if (name !== "passport_links") return t;
        return new Proxy(t, {
          get(target, prop, receiver) {
            if (prop === "update" && !failed) {
              return async () => {
                failed = true;
                throw new Error("write failed");
              };
            }
            return Reflect.get(target, prop, receiver) as unknown;
          },
        });
      },
    };
    const c = { repos, now: () => h.clock.now, config: { passportFetch: p.fetch } } as unknown as Parameters<typeof consentTokens>[0];
    expect(await consentTokens(c, linkId, OPTS).getToken()).toBe("at-2");
    expect(failed).toBe(true);
    expect(await stored()).toBe("rt-2");
  });
});

/** What another worker does when it wins: store a new refresh token (and maybe an access token) and bump the version. */
async function otherWorkerStores(refresh: string, access?: { token: string; expiresAt: Date }) {
  const row = (await h.repos.table("passport_links").one({ id: linkId }))!;
  await h.repos.table("passport_links").update(
    { id: linkId },
    {
      refresh_token_enc: await encryptSecret(refresh, TEST_CREDENTIALS_KEY),
      access_token_enc: access ? await encryptSecret(access.token, TEST_CREDENTIALS_KEY) : null,
      access_token_expires_at: access ? access.expiresAt.toISOString() : null,
      token_version: row.token_version + 1,
    },
  );
}
const row = async () => (await h.repos.table("passport_links").one({ id: linkId }))!;
const inTenMinutes = () => new Date(h.clock.now.getTime() + 600_000);

describe("workers sharing one stored access token", () => {
  it("cold workers read the stored access token: one token call for all of them", async () => {
    const p = strictPassport();
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    const saved = await row();
    expect(saved.access_token_enc).not.toContain("at-2");
    expect(await decryptSecret(saved.access_token_enc!, TEST_CREDENTIALS_KEY)).toBe("at-2");
    expect(saved.token_version).toBe(1);
    for (let i = 0; i < 6; i++) {
      clearPassportTokenCache(); // a worker that has just started
      expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    }
    expect(p.state.tokenCalls).toBe(1);
    expect(await stored()).toBe("rt-2");
  });

  it("a stored token is not used in its last minute, and one refresh replaces it", async () => {
    const p = strictPassport();
    await consentTokens(ctx(p.fetch), linkId, OPTS).getToken();
    h.clock.now = new Date(h.clock.now.getTime() + 9 * 60_000 + 1000);
    clearPassportTokenCache();
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    clearPassportTokenCache();
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    expect(p.state.tokenCalls).toBe(2);
    expect((await row()).token_version).toBe(2);
  });

  it("cold workers that find the token expired one after another refresh once between them", async () => {
    // Sequential cold starts against the strict Passport (no forgiveness): the first refreshes
    // and stores, the rest read. Truly simultaneous expiry is the one case left to Passport's
    // replay window; see the next test.
    const p = strictPassport();
    await consentTokens(ctx(p.fetch), linkId, OPTS).getToken();
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    for (let i = 0; i < 5; i++) {
      clearPassportTokenCache();
      expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    }
    expect(p.state.tokenCalls).toBe(2);
    expect(p.state.revoked).toBe(false);
  });

  it("workers that refresh at the same instant end up holding the same stored token", async () => {
    // Needs Passport's forgiveness: both present rt-1. The loser of the swap adopts the winner's
    // access token, so the row and every worker agree.
    const p = strictPassport({ forgiveReplay: true });
    const got = await Promise.all([consentTokens(ctx(p.fetch), linkId, OPTS).getToken(), consentTokens(ctx(p.fetch), linkId, OPTS).getToken(), consentTokens(ctx(p.fetch), linkId, OPTS).getToken()]);
    const saved = await row();
    const kept = await decryptSecret(saved.access_token_enc!, TEST_CREDENTIALS_KEY);
    expect(saved.token_version).toBe(1);
    expect(got).toContain(kept);
    clearPassportTokenCache();
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe(kept);
    expect(p.state.live.has(await stored())).toBe(true);
    expect(p.state.revoked).toBe(false);
  });

  it("the loser of the swap adopts the winner's access token and leaves its refresh token stored", async () => {
    // Worker B rotates rt-1 and stores its pair while worker A is between reading the row and
    // presenting rt-1. Passport forgives A's replay; A's write finds the version moved on.
    let raced = false;
    const p = strictPassport({
      forgiveReplay: true,
      beforeToken: async () => {
        if (raced) return;
        raced = true;
        p.state.live.delete("rt-1");
        p.state.spent.add("rt-1");
        p.state.live.add("rt-2");
        p.state.n = 2;
        await otherWorkerStores("rt-2", { token: "at-2", expiresAt: inTenMinutes() });
      },
    });
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    expect(await stored()).toBe("rt-2");
    expect((await row()).token_version).toBe(1);
    expect(p.state.revoked).toBe(false);
  });

  it("a refused token uses the access token another worker stored meanwhile, without a second call", async () => {
    let raced = false;
    const p = strictPassport({
      beforeToken: async (presented) => {
        if (raced || presented !== "rt-1") return;
        raced = true;
        p.state.live.delete("rt-1");
        p.state.live.add("rt-2");
        p.state.n = 2;
        await otherWorkerStores("rt-2", { token: "at-2", expiresAt: inTenMinutes() });
      },
    });
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    expect(p.state.presented).toEqual(["rt-1"]);
    expect(await stored()).toBe("rt-2");
  });

  it("a refused token is retried once with the refresh token another worker stored, when no access token came with it", async () => {
    let raced = false;
    const p = strictPassport({
      beforeToken: async (presented) => {
        if (raced || presented !== "rt-1") return;
        raced = true;
        p.state.live.delete("rt-1");
        p.state.live.add("rt-2");
        p.state.n = 2;
        await otherWorkerStores("rt-2");
      },
    });
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    expect(p.state.presented).toEqual(["rt-1", "rt-2"]);
    expect(await stored()).toBe("rt-3");
  });

  it("a refusal with nothing newer stored is reported, and only one retry is ever made", async () => {
    const p = strictPassport();
    p.state.live.clear();
    await expect(consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).rejects.toBeInstanceOf(PassportAuthError);
    expect(p.state.tokenCalls).toBe(1);
    // A failed refresh is not cached: the next caller asks again.
    await expect(consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).rejects.toBeInstanceOf(PassportAuthError);
    expect(p.state.tokenCalls).toBe(2);
  });

  it("invalidate() skips the stored token, as after a 401, and the refresh replaces it for everyone", async () => {
    const p = strictPassport();
    const tokens = consentTokens(ctx(p.fetch), linkId, OPTS);
    expect(await tokens.getToken()).toBe("at-2");
    tokens.invalidate();
    expect(await tokens.getToken()).toBe("at-3");
    expect(await decryptSecret((await row()).access_token_enc!, TEST_CREDENTIALS_KEY)).toBe("at-3");
    // A worker that never saw the 401 now reads the replacement, not the rejected token.
    clearPassportTokenCache();
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    expect(await tokens.getToken()).toBe("at-3");
    expect(p.state.tokenCalls).toBe(2);
  });

  it("a stored token that cannot be decrypted is ignored and replaced", async () => {
    const p = strictPassport();
    await h.repos.table("passport_links").update({ id: linkId }, { access_token_enc: "v1.not.ciphertext", access_token_expires_at: inTenMinutes().toISOString() });
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    expect(await decryptSecret((await row()).access_token_enc!, TEST_CREDENTIALS_KEY)).toBe("at-2");
  });

  it("a revoked link is never written to and hands out nothing", async () => {
    const p = strictPassport();
    await h.repos.table("passport_links").update({ id: linkId }, { revoked_at: h.clock.now.toISOString() });
    await expect(consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).rejects.toBeInstanceOf(PassportAuthError);
    expect(p.state.tokenCalls).toBe(0);
  });

  it("a consent Passport refuses unlinks the workspace and clears the stored tokens' access copy", async () => {
    const p = strictPassport();
    h.passport.fetch = p.fetch;
    const who = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_APPLICANT };
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(200);
    expect((await row()).access_token_enc).not.toBeNull();
    p.state.revoked = true;
    clearPassportTokenCache();
    const refused = await h.request("/gms/me/documents", { headers: who });
    expect(refused.status).toBe(409);
    const after = await row();
    expect(after.revoked_at).not.toBeNull();
    expect(after.access_token_enc).toBeNull();
    expect(after.access_token_expires_at).toBeNull();
  });
});
