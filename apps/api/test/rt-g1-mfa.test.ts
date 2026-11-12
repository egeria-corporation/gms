// SPDX-License-Identifier: AGPL-3.0-only
// Regression for red team G1 (2026-11-11), ported from the reviewer's proof of the same name.
//
// The proof: a person who controls only the EMAIL of a funder admin (who has this app's own
// authenticator and has never used Passport) made a Passport account for that address with their
// OWN authenticator, signed in with it, and got a session that counted as two-step verified.
//
// The rule now: the first Passport sign-in for an account that already exists links nothing and
// verifies nothing. Passport's authenticator counts only after that same session has passed the
// account's own second step, which records the link.
import { fixtureFetch, type Fixture } from "@gms/passport-client";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSPORT, USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const CLIENT = "gms-test-client";
const SOMEONES_PASSPORT_USER = "7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a";
const ACCOUNT_EMAIL = "helen.ortiz@riverbendcf.example";
const KID = "oauth-passport-test";
const HOP = "tab-value-made-by-the-web-app-0123456789_-A";
const FIRST_SESSION = "5e500000-0000-4000-8000-0000000000d1";
const LATER_SESSION = "5e500000-0000-4000-8000-0000000000d2";

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
const fakeJwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

/** An identity-only Passport sign-in for the account's address, by a Passport user holding its own authenticator. */
async function passportSignIn(): Promise<string> {
  const start = await h.request(`/gms/passport/signin/start?hop=${HOP}`);
  const location = new URL(start.headers.get("Location")!);
  const cookie = (start.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const id = await new SignJWT({ iss: PASSPORT, aud: CLIENT, sub: SOMEONES_PASSPORT_USER, iat, exp: iat + 300, nonce: location.searchParams.get("nonce"), email: ACCOUNT_EMAIL, email_verified: true, acr: "aal2", amr: ["otp", "mfa"], auth_time: iat - 30 })
    .setProtectedHeader({ alg: "ES256", kid: KID, typ: "JWT" })
    .sign(signingKey);
  const fixtures: Fixture[] = [
    { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({}), expires_in: 900, scope: "openid email", id_token: id } },
    { method: "GET", path: "/.well-known/jwks.json", status: 200, body: { keys: [publicJwk] } },
  ];
  h.passport.fetch = fixtureFetch(fixtures).fetch;
  const res = await h.request(`/gms/passport/signin/callback?${new URLSearchParams({ code: "the-code", state: location.searchParams.get("state")! })}`, { headers: { Cookie: cookie } });
  const to = new URL(res.headers.get("Location")!);
  expect(to.pathname).toBe("/auth/passport");
  return new URLSearchParams(to.hash.slice(1)).get("token_hash")!;
}

describe("RT G1: Passport's second step for an account that was never linked to Passport", () => {
  it("email control and a self-made Passport account do not make a verified admin session", async () => {
    // The account: funder admin, made by emailed code, this app's own authenticator, never used Passport.
    h.identity.users.set(ACCOUNT_EMAIL, { userId: USER_ADMIN, passportUserId: null, confirmed: true });
    const session = (aal: "aal1" | "aal2", sessionId: string) => h.session(USER_ADMIN, { aal, sessionId });
    const adminCall = async (sessionId: string) => {
      const res = await h.request(`/gms/workspaces/${WS_FUNDER}/members`, bearer(await session("aal1", sessionId)));
      return { status: res.status, code: res.ok ? null : ((await res.json()) as { errors: { code: string }[] }).errors[0]!.code };
    };
    const claim = async (tokenHash: string, sessionId: string) => {
      const res = await h.request("/gms/passport/signin/second-step", { method: "POST", headers: { Authorization: `Bearer ${await session("aal1", sessionId)}`, "Content-Type": "application/json" }, body: JSON.stringify({ tokenHash }) });
      return ((await res.json()) as { data: { verified: boolean } }).data.verified;
    };
    // With the email alone (a single-step session) the admin role is refused.
    expect(await adminCall(FIRST_SESSION)).toEqual({ status: 403, code: "mfa_required" });

    // "Continue with Passport": Passport truthfully reports a verified email and ITS OWN authenticator.
    const tokenHash = await passportSignIn();
    // The one-time sign-in is for the existing account, as an emailed code would be…
    expect(h.identity.issued.at(-1)).toMatchObject({ email: ACCOUNT_EMAIL, tokenHash });
    // …but presenting it does not make the session two-step verified,
    expect(await claim(tokenHash, FIRST_SESSION)).toBe(false);
    // the admin route still asks for this app's own second step,
    expect(await adminCall(FIRST_SESSION)).toEqual({ status: 403, code: "mfa_required" });
    // and the account is tied to no Passport user.
    expect(h.identity.users.get(ACCOUNT_EMAIL)).toMatchObject({ userId: USER_ADMIN, passportUserId: null });

    // The account's owner passes this app's own second step in that same session: now the link is recorded…
    const me = await h.request("/gms/me", bearer(await session("aal2", FIRST_SESSION)));
    expect(((await me.json()) as { data: { mfaVerified: boolean } }).data.mfaVerified).toBe(true);
    expect(h.identity.users.get(ACCOUNT_EMAIL)).toMatchObject({ userId: USER_ADMIN, passportUserId: SOMEONES_PASSPORT_USER });
    // …and a later Passport sign-in is honoured as before.
    expect(await claim(await passportSignIn(), LATER_SESSION)).toBe(true);
    expect((await adminCall(LATER_SESSION)).status).toBe(200);
  });
});
