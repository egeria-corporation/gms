// SPDX-License-Identifier: AGPL-3.0-only
// Passport's authenticator as this app's second step (owner's decision, 2026-11-11): the callback
// records it against the one-time sign-in token; only the session that presents that token gets
// it, once, in time; and every second-step check in the API reads the same rule.
import { fixtureFetch, type Fixture } from "@gms/passport-client";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SECOND_STEP_CLAIM_MS, SECOND_STEP_TRUST_MS, passedPassportAuthenticator, sha256Hex } from "../src/services/passport-signin.ts";
import { PASSPORT, USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, ALDER_PROFILE, ORG_ALDER } from "./scenario.ts";

const CLIENT = "gms-test-client";
const PASSPORT_USER = "7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a";
const EMAIL = "dana@aldercreek.example";
const KID = "oauth-passport-test";
const HOP = "tab-value-made-by-the-web-app-0123456789_-A";
const SESSION = "5e500000-0000-4000-8000-0000000000d1";
const OTHER_SESSION = "5e500000-0000-4000-8000-0000000000d2";

let signingKey: CryptoKey;
let publicJwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256", use: "sig" };
});

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const env = <T>(data: T) => ({ status: 200, message: "Success", data });
const fakeJwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const secs = () => Math.floor(h.clock.now.getTime() / 1000);

/** A whole Passport sign-in for Alder Creek. `claims` overrides what Passport says about how the person signed in. */
async function signIn(claims: Record<string, unknown> = {}): Promise<{ userId: string; tokenHash: string; workspaceId: string }> {
  const start = await h.request(`/gms/passport/signin/start?hop=${HOP}`);
  const location = new URL(start.headers.get("Location")!);
  const cookie = (start.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  const iat = secs();
  const id = await new SignJWT({ iss: PASSPORT, aud: CLIENT, sub: PASSPORT_USER, iat, exp: iat + 300, nonce: location.searchParams.get("nonce"), email: EMAIL, email_verified: true, acr: "aal2", amr: ["otp", "mfa"], auth_time: iat - 30, ...claims })
    .setProtectedHeader({ alg: "ES256", kid: KID, typ: "JWT" })
    .sign(signingKey);
  const fixtures: Fixture[] = [
    { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({ "https://commongrants.org/org_id": ORG_ALDER }), expires_in: 900, scope: "org:read org.changes:read org.changes:write payee:read openid email", refresh_token: "rt-signin-1", id_token: id } },
    { method: "GET", path: "/.well-known/jwks.json", status: 200, body: { keys: [publicJwk] } },
    { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}`, status: 200, body: env(ALDER_ORG) },
    { method: "GET", path: `/passport/orgs/${ORG_ALDER}/profile`, status: 200, body: env(ALDER_PROFILE) },
  ];
  h.passport.fetch = fixtureFetch(fixtures).fetch;
  const res = await h.request(`/gms/passport/signin/callback?${new URLSearchParams({ code: "the-code", state: location.searchParams.get("state")! })}`, { headers: { Cookie: cookie } });
  const fragment = new URLSearchParams(new URL(res.headers.get("Location")!).hash.slice(1));
  const tokenHash = fragment.get("token_hash")!;
  expect(tokenHash).toBeTruthy();
  const userId = h.identity.users.get(EMAIL)!.userId;
  const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
  return { userId, tokenHash, workspaceId: ws.id };
}

/** The web app's call after it redeemed the one-time token for a session. */
async function claim(userId: string, tokenHash: unknown, sessionId: string | null = SESSION) {
  const res = await h.request("/gms/passport/signin/second-step", {
    method: "POST",
    headers: { Authorization: `Bearer ${await h.session(userId, { aal: "aal1", ...(sessionId ? { sessionId } : {}) })}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tokenHash }),
  });
  return { status: res.status, body: (await res.json()) as { data?: { verified: boolean; validUntil: string | null } }, res };
}

const me = async (userId: string, sessionId: string | undefined, aal: "aal1" | "aal2" = "aal1") =>
  ((await (await h.request("/gms/me", bearer(await h.session(userId, { aal, ...(sessionId ? { sessionId } : {}) })))).json()) as { data: { mfaVerified: boolean } }).data.mfaVerified;

/** A route the applicant admin role may only use after a second step. */
const adminRoute = async (userId: string, workspaceId: string, sessionId: string | undefined) => {
  const res = await h.request("/gms/me/organization", bearer(await h.session(userId, { aal: "aal1", ...(sessionId ? { sessionId } : {}) }), { "X-GMS-Workspace": workspaceId }));
  return { status: res.status, code: res.status === 200 ? null : ((await res.json()) as { errors: { code: string }[] }).errors[0]?.code };
};

describe("recording Passport's second step at sign-in", () => {
  it("stores a digest of the one-time token, never the token, with a claim window and an end to the trust", async () => {
    const { userId, tokenHash } = await signIn();
    expect(h.secondSteps.rows).toHaveLength(1);
    const row = h.secondSteps.rows[0]!;
    expect(row).toMatchObject({ userId, acr: "aal2", sessionId: null, tokenDigest: await sha256Hex(tokenHash) });
    expect(JSON.stringify(h.secondSteps.rows)).not.toContain(tokenHash);
    expect(row.claimBy.getTime()).toBe(h.clock.now.getTime() + SECOND_STEP_CLAIM_MS);
    // Counted from when the person passed Passport's authenticator, not from now.
    expect(row.validUntil.getTime()).toBe((secs() - 30) * 1000 + SECOND_STEP_TRUST_MS);
  });

  it.each([
    ["Passport says the sign-in was single-step", { acr: "aal1", amr: ["otp"] }],
    ["the methods do not include its authenticator", { amr: ["otp"] }],
    ["the methods are missing", { amr: undefined }],
    ["Passport does not say when", { auth_time: undefined }],
    ["the authenticator was passed more than twelve hours ago", { auth_time: Math.floor(Date.parse("2027-04-16T04:59:00Z") / 1000) }],
    ["the time is in the future", { auth_time: Math.floor(Date.parse("2027-04-16T17:05:00Z") / 1000) }],
  ])("records nothing when %s: the app asks for its own second step", async (_why, claims) => {
    const { userId, tokenHash, workspaceId } = await signIn(claims);
    expect(h.secondSteps.rows).toHaveLength(0);
    expect((await claim(userId, tokenHash)).body.data).toEqual({ verified: false, validUntil: null });
    expect(await me(userId, SESSION)).toBe(false);
    expect((await adminRoute(userId, workspaceId, SESSION)).code).toBe("mfa_required");
  });

  it("reads Passport's claim strictly", () => {
    expect(passedPassportAuthenticator({ acr: "aal2", amr: ["otp", "mfa"] })).toBe(true);
    expect(passedPassportAuthenticator({ acr: "aal2", amr: ["otp"] })).toBe(false);
    expect(passedPassportAuthenticator({ acr: "AAL2", amr: ["mfa"] })).toBe(false);
    expect(passedPassportAuthenticator({ acr: null, amr: ["mfa"] })).toBe(false);
  });
});

describe("claiming it for the session that signed in", () => {
  it("makes that session two-step verified everywhere the API checks, and ledgers it once", async () => {
    const { userId, tokenHash, workspaceId } = await signIn();
    // Before the claim the session is an ordinary single-step one.
    expect(await me(userId, SESSION)).toBe(false);
    expect(await adminRoute(userId, workspaceId, SESSION)).toEqual({ status: 403, code: "mfa_required" });

    const r = await claim(userId, tokenHash);
    expect(r.status).toBe(200);
    expect(r.res.headers.get("Cache-Control")).toBe("no-store");
    expect(r.body.data).toEqual({ verified: true, validUntil: h.secondSteps.rows[0]!.validUntil.toISOString() });

    expect(await me(userId, SESSION)).toBe(true);
    expect((await adminRoute(userId, workspaceId, SESSION)).status).toBe(200);
    const events = (await h.ledger.list({})).filter((e) => e.eventType === "auth.second_step_from_passport");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectType: "user", subjectId: userId });
    expect(JSON.stringify(events[0])).not.toContain(tokenHash);
  });

  it("does not carry over to another session of the same person", async () => {
    const { userId, tokenHash, workspaceId } = await signIn();
    await claim(userId, tokenHash);
    expect(await me(userId, OTHER_SESSION)).toBe(false);
    expect((await adminRoute(userId, workspaceId, OTHER_SESSION)).code).toBe("mfa_required");
    // Nor to a token that names no session at all.
    expect(await me(userId, undefined)).toBe(false);
  });

  it("cannot be claimed twice: the second session to present the token gets nothing", async () => {
    const { userId, tokenHash } = await signIn();
    expect((await claim(userId, tokenHash, SESSION)).body.data?.verified).toBe(true);
    expect((await claim(userId, tokenHash, OTHER_SESSION)).body.data).toEqual({ verified: false, validUntil: null });
    expect(await me(userId, OTHER_SESSION)).toBe(false);
    // Presenting it again from the session that holds it changes nothing.
    expect((await claim(userId, tokenHash, SESSION)).body.data?.verified).toBe(false);
    expect(await me(userId, SESSION)).toBe(true);
    expect((await h.ledger.list({})).filter((e) => e.eventType === "auth.second_step_from_passport")).toHaveLength(1);
  });

  it("needs the token: a wrong one, a malformed one or none claims nothing, and says nothing about why", async () => {
    const { userId, tokenHash } = await signIn();
    for (const bad of [`${tokenHash}x`, "th_00000000000000000000000000000000", "not a token!", "a"]) {
      const r = await claim(userId, bad);
      expect(r.status, bad).toBe(200);
      expect(r.body.data, bad).toEqual({ verified: false, validUntil: null });
    }
    expect((await claim(userId, undefined)).status).toBe(400);
    expect((await claim(userId, 12345)).status).toBe(400);
    expect(await me(userId, SESSION)).toBe(false);
    // The right token still works afterwards: failed attempts do not burn the record.
    expect((await claim(userId, tokenHash)).body.data?.verified).toBe(true);
  });

  it("cannot be claimed by another person, even with the right token", async () => {
    const { userId, tokenHash } = await signIn();
    expect((await claim(USER_ADMIN, tokenHash)).body.data).toEqual({ verified: false, validUntil: null });
    expect(await me(USER_ADMIN, SESSION)).toBe(false);
    // And the person it belongs to can still claim it.
    expect((await claim(userId, tokenHash, OTHER_SESSION)).body.data?.verified).toBe(true);
  });

  it("cannot be claimed by a session that names no session id", async () => {
    const { userId, tokenHash } = await signIn();
    expect((await claim(userId, tokenHash, null)).body.data).toEqual({ verified: false, validUntil: null });
  });

  it("must be claimed within ten minutes of the sign-in", async () => {
    const { userId, tokenHash } = await signIn();
    h.clock.now = new Date(h.clock.now.getTime() + SECOND_STEP_CLAIM_MS + 1000);
    expect((await claim(userId, tokenHash)).body.data).toEqual({ verified: false, validUntil: null });
    expect(await me(userId, SESSION)).toBe(false);
  });

  it("stops counting when the trust runs out: twelve hours after the person passed Passport's authenticator", async () => {
    const { userId, tokenHash, workspaceId } = await signIn();
    await claim(userId, tokenHash);
    h.clock.now = new Date(h.clock.now.getTime() + SECOND_STEP_TRUST_MS - 60_000);
    expect(await me(userId, SESSION)).toBe(true);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    expect(await me(userId, SESSION)).toBe(false);
    expect((await adminRoute(userId, workspaceId, SESSION)).code).toBe("mfa_required");
  });

  it("requires a signed-in person: no bearer, or an API token, is refused", async () => {
    const res = await h.request("/gms/passport/signin/second-step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenHash: "x".repeat(40) }) });
    expect(res.status).toBe(401);
  });
});

describe("the one rule", () => {
  it("still accepts this app's own authenticator, with no Passport record at all", async () => {
    expect(await me(USER_ADMIN, SESSION, "aal2")).toBe(true);
    expect(await me(USER_ADMIN, SESSION, "aal1")).toBe(false);
  });

  it("treats an unreadable record as not verified", async () => {
    const { userId, tokenHash } = await signIn();
    await claim(userId, tokenHash);
    h.secondSteps.verified = async () => {
      throw new Error("database unavailable");
    };
    expect(await me(userId, SESSION)).toBe(false);
  });

  it("covers workspace routes for a role that needs a second step: open to the verified session only", async () => {
    // The funder admin role needs a second step; a Passport-verified session of that person has one.
    h.secondSteps.rows.push({ userId: USER_ADMIN, tokenDigest: "0".repeat(64), acr: "aal2", authTime: h.clock.now, claimBy: h.clock.now, validUntil: new Date(h.clock.now.getTime() + 3_600_000), sessionId: SESSION });
    const funder = async (sessionId: string) => (await h.request("/gms/programs", bearer(await h.session(USER_ADMIN, { aal: "aal1", sessionId }), { "X-GMS-Workspace": WS_FUNDER }))).status;
    expect(await funder(SESSION)).toBe(200);
    expect(await funder(OTHER_SESSION)).toBe(403);
  });
});
