// SPDX-License-Identifier: AGPL-3.0-only
// Linking a Passport identity to an account that already exists here (red team G1, 2026-11-11).
//
// Before: the first Passport sign-in for an existing account linked the Passport user by verified
// email and, in the same breath, accepted Passport's authenticator as this app's second step. So
// whoever controlled the mailbox could make a Passport account for that address with their own
// authenticator and get a two-step verified session, without the account's own authenticator.
//
// Now: that first sign-in records no link. The session is single-step until it passes this
// account's own second step; only then is the link recorded (and ledgered), and only for a
// recorded link does Passport's authenticator count. An account a Passport sign-in creates is
// linked from the start. A link is never re-pointed, whatever happens to an email on either side.
import { fixtureFetch, type Fixture } from "@gms/passport-client";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LINK_CONFIRM_WINDOW_MS } from "../src/services/passport-signin.ts";
import { AccountMismatchError } from "../src/services/ports.ts";
import { PASSPORT, USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const CLIENT = "gms-test-client";
const SOMEONES_PASSPORT_USER = "7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a";
const OTHER_PASSPORT_USER = "8b8b8b8b-8b8b-48b8-88b8-8b8b8b8b8b8b";
const EMAIL = "helen.ortiz@riverbendcf.example";
const KID = "oauth-passport-test";
const HOP = "tab-value-made-by-the-web-app-0123456789_-A";
const SESSION = "5e500000-0000-4000-8000-0000000000d1";
const OWN_SESSION = "5e500000-0000-4000-8000-0000000000d2";
const LATER_SESSION = "5e500000-0000-4000-8000-0000000000d3";

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
  // A funder admin with an account made by emailed code, who has never used Passport.
  h.identity.users.set(EMAIL, { userId: USER_ADMIN, passportUserId: null, confirmed: true });
});
const fakeJwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

/** An identity-only Passport sign-in (no organization). Returns where the callback sent the browser. */
async function passportSignIn(opts: { email?: string; passportUser?: string; claims?: Record<string, unknown> } = {}): Promise<{ to: URL; tokenHash: string | null; error: string | null }> {
  const start = await h.request(`/gms/passport/signin/start?hop=${HOP}`);
  const location = new URL(start.headers.get("Location")!);
  const cookie = (start.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const id = await new SignJWT({ iss: PASSPORT, aud: CLIENT, sub: opts.passportUser ?? SOMEONES_PASSPORT_USER, iat, exp: iat + 300, nonce: location.searchParams.get("nonce"), email: opts.email ?? EMAIL, email_verified: true, acr: "aal2", amr: ["otp", "mfa"], auth_time: iat - 30, ...opts.claims })
    .setProtectedHeader({ alg: "ES256", kid: KID, typ: "JWT" })
    .sign(signingKey);
  const fixtures: Fixture[] = [
    { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({}), expires_in: 900, scope: "openid email", id_token: id } },
    { method: "GET", path: "/.well-known/jwks.json", status: 200, body: { keys: [publicJwk] } },
  ];
  h.passport.fetch = fixtureFetch(fixtures).fetch;
  const res = await h.request(`/gms/passport/signin/callback?${new URLSearchParams({ code: "the-code", state: location.searchParams.get("state")! })}`, { headers: { Cookie: cookie } });
  const to = new URL(res.headers.get("Location")!);
  const fragment = new URLSearchParams(to.hash.slice(1));
  return { to, tokenHash: fragment.get("token_hash"), error: to.searchParams.get("passport_error") };
}

const session = (aal: "aal1" | "aal2", sessionId: string) => h.session(USER_ADMIN, { aal, sessionId });
async function claim(tokenHash: string, sessionId: string, aal: "aal1" | "aal2" = "aal1") {
  const res = await h.request("/gms/passport/signin/second-step", { method: "POST", headers: { Authorization: `Bearer ${await session(aal, sessionId)}`, "Content-Type": "application/json" }, body: JSON.stringify({ tokenHash }) });
  return ((await res.json()) as { data: { verified: boolean; validUntil: string | null } }).data;
}
const adminRoute = async (aal: "aal1" | "aal2", sessionId: string) => (await h.request(`/gms/workspaces/${WS_FUNDER}/members`, bearer(await session(aal, sessionId)))).status;
const me = async (aal: "aal1" | "aal2", sessionId: string) => ((await (await h.request("/gms/me", bearer(await session(aal, sessionId)))).json()) as { data: { mfaVerified: boolean; signInMethod: string } }).data;
const linked = () => h.identity.users.get(EMAIL)!.passportUserId;
const ledgerOf = async (eventType: string) => (await h.ledger.list({})).filter((e) => e.eventType === eventType);

describe("the first Passport sign-in for an account that already exists", () => {
  it("signs the person in but records no link and no second step: the mailbox alone gets nothing more than an emailed code would", async () => {
    expect(await adminRoute("aal1", SESSION)).toBe(403);
    const { to, tokenHash } = await passportSignIn();
    expect(to.pathname).toBe("/auth/passport");
    // The one-time sign-in is for the existing account, which is still tied to no Passport user.
    expect(h.identity.issued.at(-1)).toMatchObject({ email: EMAIL, tokenHash });
    expect(linked()).toBeNull();
    // Presenting the token binds the pending link to this session, and verifies nothing.
    expect(await claim(tokenHash!, SESSION)).toEqual({ verified: false, validUntil: null });
    expect((await me("aal1", SESSION)).mfaVerified).toBe(false);
    expect(await adminRoute("aal1", SESSION)).toBe(403);
    expect(linked()).toBeNull();
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(0);
    expect(await ledgerOf("auth.second_step_from_passport")).toHaveLength(0);
  });

  it("records the link once that same session passes this account's own second step, and ledgers it", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    // The person enters this app's authenticator code: Supabase upgrades the same session to aal2.
    expect((await me("aal2", SESSION)).mfaVerified).toBe(true);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
    const events = await ledgerOf("auth.passport_linked");
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ confirmedBy: "own_second_step" });
    expect(events[0]!.actor).toBe(`user:${USER_ADMIN}`);
    // The account's address (the one on its session) is told, in fixed words.
    const notice = h.mailer.sent.filter((m) => m.subject === "Passport sign-in was linked to your account");
    expect(notice).toHaveLength(1);
    expect(notice[0]!.to).toEqual(["person@riverbendcf.example"]);
    expect(h.secondSteps.links).toHaveLength(0);
    // Asking again changes nothing.
    await me("aal2", SESSION);
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(1);

    // From now on Passport's authenticator is enough, as the owner decided.
    const again = await passportSignIn();
    expect(await claim(again.tokenHash!, LATER_SESSION)).toMatchObject({ verified: true });
    expect(await adminRoute("aal1", LATER_SESSION)).toBe(200);
  });

  it("is not confirmed by any other session of the account, verified or not", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    // The account's owner is working in their own verified session meanwhile.
    expect((await me("aal2", OWN_SESSION)).mfaVerified).toBe(true);
    expect(linked()).toBeNull();
    // Nor does a verified session get to claim the other sign-in's token after the fact.
    expect(await claim(tokenHash!, OWN_SESSION, "aal2")).toEqual({ verified: false, validUntil: null });
    await me("aal2", OWN_SESSION);
    expect(linked()).toBeNull();
    expect(await adminRoute("aal1", SESSION)).toBe(403);
  });

  it("is not confirmed after the window has passed: the next sign-in starts again", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    h.clock.now = new Date(h.clock.now.getTime() + LINK_CONFIRM_WINDOW_MS + 1000);
    expect((await me("aal2", SESSION)).mfaVerified).toBe(true);
    expect(linked()).toBeNull();
  });

  it("an unclaimed pending link gives a verified session nothing either", async () => {
    await passportSignIn();
    await me("aal2", OWN_SESSION);
    expect(linked()).toBeNull();
  });

  it("a session verified by Passport for one account confirms nothing: only this app's own second step does", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    // Still single-step in Supabase's terms, however often it asks.
    await me("aal1", SESSION);
    await me("aal1", SESSION);
    expect(linked()).toBeNull();
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(0);
  });

  it("writes the ledger entry on the next request when the first attempt could not, and never twice", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    const append = h.ledger.append.bind(h.ledger);
    let fail = true;
    h.ledger.append = async (event) => {
      if (fail && event.eventType === "auth.passport_linked") throw new Error("ledger unavailable");
      return append(event);
    };
    // The link is made, the entry is not, and the request is kept so the entry can still be written.
    expect((await me("aal2", SESSION)).mfaVerified).toBe(true);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(0);
    expect(h.secondSteps.links).toHaveLength(1);
    fail = false;
    await me("aal2", SESSION);
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(1);
    expect(h.secondSteps.links).toHaveLength(0);
    await me("aal2", SESSION);
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(1);
  });
});

describe("a link cannot be re-pointed", () => {
  it("a second Passport user with the same email is refused once a link is recorded", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    await me("aal2", SESSION);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
    const other = await passportSignIn({ passportUser: OTHER_PASSPORT_USER });
    expect(other.tokenHash).toBeNull();
    expect(other.error).toBe("account_mismatch");
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
  });

  it("a Passport user already linked to one account cannot be linked to, or create, another by changing its email at Passport", async () => {
    const { tokenHash } = await passportSignIn();
    await claim(tokenHash!, SESSION);
    await me("aal2", SESSION);
    const before = h.identity.users.size;
    // The same Passport user now presents a different verified email: one with no account here…
    // (an identity-only sign-in for an unknown email stops earlier; with an organization it would
    // reach the account step, which refuses as well)
    const fresh = await passportSignIn({ email: "someone.new@example.org" });
    expect(fresh.error).toBe("no_organization");
    expect(fresh.tokenHash).toBeNull();
    await expect(h.identity.ensureUser("someone.new@example.org", { passportUserId: SOMEONES_PASSPORT_USER })).rejects.toBeInstanceOf(AccountMismatchError);
    expect(h.identity.users.size).toBe(before);
    // …and one that belongs to somebody else's account.
    h.identity.users.set("priya.shah@riverbendcf.example", { userId: "00000000-0000-4000-8000-0000000000aa", passportUserId: null, confirmed: true });
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: "00000000-0000-4000-8000-0000000000aa", role: "staff" });
    const theirs = await passportSignIn({ email: "priya.shah@riverbendcf.example" });
    expect(theirs.error).toBe("account_mismatch");
    expect(theirs.tokenHash).toBeNull();
    expect(h.identity.users.get("priya.shah@riverbendcf.example")!.passportUserId).toBeNull();
  });

  it("two pending sign-ins by different Passport users: only the one whose session passed the account's own second step is linked", async () => {
    const a = await passportSignIn({ passportUser: OTHER_PASSPORT_USER });
    await claim(a.tokenHash!, SESSION);
    const b = await passportSignIn();
    await claim(b.tokenHash!, OWN_SESSION);
    await me("aal2", OWN_SESSION);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
    // The other pending link is now dead: its session passing a second step later changes nothing.
    await me("aal2", SESSION);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
  });
});

describe("accounts Passport sign-in creates, and accounts already linked", () => {
  it("a brand-new account is linked from the start, so Passport's second step counts at once", async () => {
    const account = await h.identity.ensureUser("new.person@example.org", { passportUserId: OTHER_PASSPORT_USER });
    expect(account).toMatchObject({ created: true, link: "recorded" });
    expect(h.identity.users.get("new.person@example.org")!.passportUserId).toBe(OTHER_PASSPORT_USER);
  });

  it("an account with a recorded link keeps working exactly as it did", async () => {
    h.identity.users.set(EMAIL, { userId: USER_ADMIN, passportUserId: SOMEONES_PASSPORT_USER, confirmed: true });
    const { tokenHash } = await passportSignIn();
    expect(await claim(tokenHash!, SESSION)).toMatchObject({ verified: true });
    expect(await adminRoute("aal1", SESSION)).toBe(200);
    expect((await me("aal1", SESSION)).signInMethod).toBe("passport");
    // Nothing waits to be confirmed, and no second link entry is written.
    expect(h.secondSteps.links).toHaveLength(0);
    expect(await ledgerOf("auth.passport_linked")).toHaveLength(0);
  });
});

describe("an account tied to a Passport user before links were recorded, and never confirmed", () => {
  // Its app metadata names the Passport user (the old first sign-in wrote it), but there is no
  // link record: migration 0023 did not find a reason to make one.
  beforeEach(() => {
    h.identity.users.set(EMAIL, { userId: USER_ADMIN, passportUserId: null, tiedTo: SOMEONES_PASSPORT_USER, confirmed: true });
  });

  it("is still signed in to by that Passport user, single-step, until its own second step records the link", async () => {
    const { tokenHash } = await passportSignIn();
    expect(await claim(tokenHash!, SESSION)).toEqual({ verified: false, validUntil: null });
    expect(await adminRoute("aal1", SESSION)).toBe(403);
    expect((await me("aal2", SESSION)).mfaVerified).toBe(true);
    expect(linked()).toBe(SOMEONES_PASSPORT_USER);
    const again = await passportSignIn();
    expect(await claim(again.tokenHash!, LATER_SESSION)).toMatchObject({ verified: true });
  });

  it("is never linked to anyone else", async () => {
    const other = await passportSignIn({ passportUser: OTHER_PASSPORT_USER });
    expect(other.error).toBe("account_mismatch");
    expect(other.tokenHash).toBeNull();
    expect(linked()).toBeNull();
  });
});
