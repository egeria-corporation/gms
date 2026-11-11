// SPDX-License-Identifier: AGPL-3.0-only
// The refresh-token race that stranded the Passport link on the hosted site (2026-11-11).
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
  it("a page's parallel requests spend the refresh token once and leave the link working", async () => {
    const p = strictPassport();
    h.passport.fetch = p.fetch;
    const who = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_APPLICANT };
    const answers = await Promise.all(Array.from({ length: 8 }, () => h.request("/gms/me/documents", { headers: who })));
    expect(answers.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(p.state.tokenCalls).toBe(1);
    expect(p.state.revoked).toBe(false);
    expect(await stored()).toBe("rt-2");
    expect(await h.repos.table("passport_links").count({ id: linkId, revoked_at: null })).toBe(1);

    // Later requests reuse the access token; nothing is spent until it is close to expiring.
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(200);
    expect(p.state.tokenCalls).toBe(1);
    h.clock.now = new Date(h.clock.now.getTime() + 9 * 60_000 + 1000);
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(200);
    expect(p.state.tokenCalls).toBe(2);
    expect(await stored()).toBe("rt-3");
  });
});

describe("two isolates sharing one stored refresh token", () => {
  it("the loser of the swap keeps its access token and leaves the winner's refresh token stored", async () => {
    // Isolate B rotates rt-1 and stores rt-2 while isolate A is between reading the row and
    // presenting rt-1. Passport forgives A's replay and hands it a sibling token.
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
        await h.repos.table("passport_links").update({ id: linkId }, { refresh_token_enc: await encryptSecret("rt-2", TEST_CREDENTIALS_KEY) });
      },
    });
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-3");
    expect(await stored()).toBe("rt-2");
    expect(p.state.revoked).toBe(false);
  });

  it("a refused token is retried once with the token another request stored meanwhile", async () => {
    // Same interleaving against a Passport that does not forgive the replay but has not revoked
    // (the refusal is a plain invalid_grant): the row now holds a newer token, so that is used.
    let raced = false;
    const p = strictPassport({
      beforeToken: async (presented) => {
        if (raced || presented !== "rt-1") return;
        raced = true;
        p.state.live.delete("rt-1");
        p.state.live.add("rt-2");
        p.state.n = 2;
        await h.repos.table("passport_links").update({ id: linkId }, { refresh_token_enc: await encryptSecret("rt-2", TEST_CREDENTIALS_KEY) });
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

  it("invalidate() drops the cached token, as after a 401", async () => {
    const p = strictPassport();
    const tokens = consentTokens(ctx(p.fetch), linkId, OPTS);
    expect(await tokens.getToken()).toBe("at-2");
    expect(await consentTokens(ctx(p.fetch), linkId, OPTS).getToken()).toBe("at-2");
    tokens.invalidate();
    expect(await tokens.getToken()).toBe("at-3");
    clearPassportTokenCache();
    expect(await tokens.getToken()).toBe("at-4");
    expect(await stored()).toBe("rt-4");
  });
});
