// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport: the redirect out, the callback's checks (state, browser binding, ID token),
// account selection by verified email, and linking the organization in the same trip. Passport is a
// fake: its token endpoint, its published keys and the two organization reads.
import { fixtureFetch, type Fixture } from "@gms/passport-client";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SIGNIN_COOKIE, safeReturnTo, signInKeys } from "../src/services/passport-signin.ts";
import { PASSPORT, USER_OFFICER, WEB, WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, ALDER_PROFILE, ORG_ALDER } from "./scenario.ts";

const CLIENT = "gms-test-client";
const PASSPORT_USER = "7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a";
const EMAIL = "dana@aldercreek.example";
const KID = "oauth-passport-test";

let signingKey: CryptoKey;
let publicJwk: JWK;
let otherKey: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256", use: "sig" };
  otherKey = (await generateKeyPair("ES256", { extractable: true })).privateKey;
});

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const env = <T>(data: T) => ({ status: 200, message: "Success", data });
const fakeJwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const JWKS: Fixture = { method: "GET", path: "/.well-known/jwks.json", status: 200, body: { keys: [] } };
const ORG: Fixture = { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}`, status: 200, body: env(ALDER_ORG) };
const PROFILE: Fixture = { method: "GET", path: `/passport/orgs/${ORG_ALDER}/profile`, status: 200, body: env(ALDER_PROFILE) };

/** The value the web app makes in the tab before leaving for Passport. */
const HOP = "tab-value-made-by-the-web-app-0123456789_-A";

interface Flow {
  location: URL;
  state: string;
  nonce: string;
  cookie: string;
}

async function start(returnTo?: string): Promise<Flow> {
  const res = await h.request(`/gms/passport/signin/start?hop=${HOP}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("Location")!);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  return { location, state: location.searchParams.get("state") ?? "", nonce: location.searchParams.get("nonce") ?? "", cookie: setCookie.split(";")[0] ?? "" };
}

async function idToken(flow: Flow, over: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string; typ?: string } = {}) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  return new SignJWT({ iss: PASSPORT, aud: CLIENT, sub: PASSPORT_USER, iat, exp: iat + 300, nonce: flow.nonce, email: EMAIL, email_verified: true, acr: "aal2", ...over })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? KID, typ: opts.typ ?? "JWT" })
    .sign(opts.key ?? signingKey);
}

/** Passport's answer to the code exchange. `org: true` is a sign-in approved for Alder Creek. */
function passport(id: string | null, opts: { org?: boolean; tokenStatus?: number; extra?: Fixture[] } = {}) {
  const org = opts.org !== false;
  const token: Fixture =
    opts.tokenStatus && opts.tokenStatus !== 200
      ? { method: "POST", path: "/oauth/token", status: opts.tokenStatus, body: { error: "invalid_grant", error_description: "Authorization code is invalid, expired, or already used" } }
      : {
          method: "POST",
          path: "/oauth/token",
          status: 200,
          body: {
            access_token: fakeJwt(org ? { "https://commongrants.org/org_id": ORG_ALDER } : {}),
            expires_in: 900,
            scope: org ? "org:read org.changes:read org.changes:write payee:read openid email" : "openid email",
            ...(org ? { refresh_token: "rt-signin-1" } : {}),
            ...(id ? { id_token: id } : {}),
          },
        };
  const fx = fixtureFetch([token, { ...JWKS, body: { keys: [publicJwk] } }, ORG, PROFILE, ...(opts.extra ?? [])]);
  h.passport.fetch = fx.fetch;
  return fx;
}

async function callback(flow: Flow, over: { query?: Record<string, string>; cookie?: string | null } = {}) {
  const qs = new URLSearchParams({ code: "the-code", state: flow.state, ...over.query });
  const cookie = over.cookie === undefined ? flow.cookie : over.cookie;
  const res = await h.request(`/gms/passport/signin/callback?${qs}`, cookie ? { headers: { Cookie: cookie } } : {});
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("Location")!);
  return { res, location, error: location.searchParams.get("passport_error"), fragment: new URLSearchParams(location.hash.slice(1)) };
}

const expectRefused = async (r: Awaited<ReturnType<typeof callback>>, code: string) => {
  expect(r.location.origin + r.location.pathname).toBe(`${WEB}/signin`);
  expect(r.error).toBe(code);
  expect(r.location.hash).toBe("");
  expect(h.identity.issued).toHaveLength(0);
};

describe("starting a Passport sign-in", () => {
  it("sends the browser to Passport with PKCE, a nonce, sign-in and organization scopes, and binds the flow to this browser", async () => {
    const res = await h.request(`/gms/passport/signin/start?hop=${HOP}&returnTo=/w/alder-creek/applications`);
    const url = new URL(res.headers.get("Location")!);
    expect(url.origin + url.pathname).toBe(`${PASSPORT}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLIENT,
      redirect_uri: "https://gms.test/gms/passport/signin/callback",
      scope: "openid email org:read org.changes:read org.changes:write payee:read",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(new RegExp(`^${SIGNIN_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`));
    // Neither the binding nor the PKCE verifier is readable from the URL.
    expect(url.toString()).not.toContain(cookie.split("=")[1]!.split(";")[0]!);
    // Nor is the web app's own value: it travels sealed inside `state`.
    expect(url.toString()).not.toContain(HOP);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not start a flow the web app could not finish: no value from the tab, or a malformed one", async () => {
    for (const hop of ["", "?hop=short", `?hop=${"a".repeat(200)}`, "?hop=has%20space%20and%2Fslash-0123456789abcdef"]) {
      const res = await h.request(`/gms/passport/signin/start${hop}`);
      expect(res.headers.get("Location")).toBe(`${WEB}/signin?passport_error=state_mismatch`);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("says so when Passport sign-in is not configured", async () => {
    delete h.env.PASSPORT_GMS_CLIENT_SECRET;
    const res = await h.request(`/gms/passport/signin/start?hop=${HOP}`);
    expect(res.headers.get("Location")).toBe(`${WEB}/signin?passport_error=not_configured`);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("only honors a plain path in the web app as the return address", () => {
    expect(safeReturnTo("/w/alder-creek/applications")).toBe("/w/alder-creek/applications");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/a//b", "/w/x?next=https://evil.example", "/w/x#frag", "javascript:alert(1)", "w/x", "/" + "a".repeat(300), "", undefined]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });
});

describe("finishing a Passport sign-in", () => {
  it("creates the account, links the organization's workspace and hands the web app a one-time sign-in in the fragment", async () => {
    const flow = await start();
    const fx = passport(await idToken(flow));
    const r = await callback(flow);
    expect(r.location.origin + r.location.pathname).toBe(`${WEB}/auth/passport`);
    expect(r.location.search).toBe("");
    expect(r.fragment.get("token_hash")).toBe(h.identity.issued[0]!.tokenHash);
    expect(r.fragment.get("type")).toBe("magiclink");
    expect(h.identity.issued).toEqual([{ email: EMAIL, tokenHash: r.fragment.get("token_hash") }]);

    const account = h.identity.users.get(EMAIL)!;
    expect(account.passportUserId).toBe(PASSPORT_USER);
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
    expect(ws).toMatchObject({ kind: "applicant", display_name: "Alder Creek Family Services", verification_level: "L3" });
    expect(r.fragment.get("next")).toBe(`/w/${ws.handle}`);
    expect(await h.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: account.userId })).toMatchObject({ role: "admin" });
    const link = (await h.repos.table("passport_links").one({ workspace_id: ws.id, mode: "applicant_consent" }))!;
    expect(link.scopes).toEqual(["org:read", "org.changes:read", "org.changes:write", "payee:read"]);
    expect(link.refresh_token_enc).not.toContain("rt-signin-1");

    expect(String(fx.calls[0]!.body)).toMatch(/grant_type=authorization_code.*code_verifier=.*redirect_uri=https%3A%2F%2Fgms\.test%2Fgms%2Fpassport%2Fsignin%2Fcallback/);
    const events = await h.ledger.list({ workspaceId: ws.id });
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["workspace.created", "member.added", "passport.linked", "auth.passport_signin"]));
    expect(events.find((e) => e.eventType === "auth.passport_signin")!.data).toEqual({ created: true, linkedOrganization: true, acr: "aal2", passportLink: "recorded" });

    // The binding cookie is cleared and nothing about the sign-in is cacheable or sent as a referrer.
    expect(r.res.headers.get("Set-Cookie")).toMatch(new RegExp(`^${SIGNIN_COOKIE}=; Path=/; Max-Age=0;`));
    expect(r.res.headers.get("Cache-Control")).toBe("no-store");
    expect(r.res.headers.get("Referrer-Policy")).toBe("no-referrer");
    // The tab's own value comes back next to the one-time sign-in, for the web app to compare.
    expect(r.fragment.get("hop")).toBe(HOP);
  });

  it("signs in to the existing account when the verified email matches one (owner decision)", async () => {
    h.identity.users.set(EMAIL, { userId: USER_OFFICER, passportUserId: null });
    const flow = await start("/w/alder-creek/applications");
    passport(await idToken(flow, { email: "Dana@AlderCreek.example" }));
    const r = await callback(flow);
    expect(r.fragment.get("next")).toBe("/w/alder-creek/applications");
    expect(h.identity.users.size).toBe(1);
    // The person is signed in to their account, but the Passport user is not linked to it yet and
    // Passport's authenticator is not taken as this app's second step: that waits for the account's
    // own second step (red team G1; test/passport-link-confirmation.test.ts).
    expect(h.identity.users.get(EMAIL)).toEqual({ userId: USER_OFFICER, passportUserId: null });
    expect(h.identity.issued.at(-1)).toMatchObject({ email: EMAIL });
    expect(h.secondSteps.rows).toHaveLength(0);
    expect(h.secondSteps.links).toHaveLength(1);
    expect(h.secondSteps.links[0]).toMatchObject({ userId: USER_OFFICER, passportUserId: PASSPORT_USER, sessionId: null });
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
    expect(await h.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: USER_OFFICER })).toBeTruthy();
    const events = await h.ledger.list({ workspaceId: ws.id });
    expect(events.find((e) => e.eventType === "auth.passport_signin")!.data).toMatchObject({ created: false, passportLink: "pending" });
  });

  it("replaces an account nobody ever confirmed instead of adopting it: a stranger's sign-up for this email gets nothing", async () => {
    const STRANGERS = "99999999-9999-4999-8999-999999999999";
    h.identity.users.set(EMAIL, { userId: STRANGERS, passportUserId: null, confirmed: false });
    const flow = await start();
    passport(await idToken(flow));
    const r = await callback(flow);
    expect(r.error).toBeNull();
    const account = h.identity.users.get(EMAIL)!;
    expect(account.userId).not.toBe(STRANGERS);
    expect(account).toMatchObject({ confirmed: true, passportUserId: PASSPORT_USER });
    expect(h.identity.deleted).toEqual([STRANGERS]);
    // The workspace belongs to the new account, never to the one the stranger made.
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
    expect(await h.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: account.userId })).toBeTruthy();
    expect(await h.repos.table("workspace_members").count({ user_id: STRANGERS })).toBe(0);
  });

  it("keeps an account tied to the Passport user it was first linked with", async () => {
    h.identity.users.set(EMAIL, { userId: USER_OFFICER, passportUserId: PASSPORT_USER });
    // The same Passport user again: signed in.
    let flow = await start();
    passport(await idToken(flow));
    expect((await callback(flow)).error).toBeNull();
    // A different Passport user presenting the same verified email: nobody is signed in, nothing is linked or changed.
    const issued = h.identity.issued.length;
    flow = await start();
    passport(await idToken(flow, { sub: "8b8b8b8b-8b8b-48b8-88b8-8b8b8b8b8b8b" }));
    const r = await callback(flow);
    expect(r.error).toBe("account_mismatch");
    expect(r.location.hash).toBe("");
    expect(h.identity.issued).toHaveLength(issued);
    expect(h.identity.users.get(EMAIL)).toMatchObject({ userId: USER_OFFICER, passportUserId: PASSPORT_USER });
  });

  it("signs in a person who approved no organization when they already belong to a workspace, without linking", async () => {
    h.identity.users.set(EMAIL, { userId: USER_OFFICER, passportUserId: null });
    const flow = await start();
    const fx = passport(await idToken(flow), { org: false });
    const r = await callback(flow);
    expect(r.location.pathname).toBe("/auth/passport");
    expect(r.fragment.get("next")).toBeNull();
    expect(await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER })).toBeNull();
    expect(await h.repos.table("workspaces").one({ id: WS_APPLICANT })).toMatchObject({ passport_org_id: null });
    // No organization read was attempted.
    expect(fx.calls.map((c) => c.path)).toEqual(["/oauth/token", "/.well-known/jwks.json"]);
  });

  it("sends a new person with no organization to claim one, and creates no account", async () => {
    const flow = await start();
    passport(await idToken(flow), { org: false });
    await expectRefused(await callback(flow), "no_organization");
    expect(h.identity.users.size).toBe(0);
  });

  it("refuses an email Passport has not verified, or a token with no email", async () => {
    for (const over of [{ email_verified: false }, { email_verified: "true" }, { email: undefined }, { email: "not-an-email" }]) {
      const flow = await start();
      passport(await idToken(flow, over));
      await expectRefused(await callback(flow), "email_unverified");
    }
    expect(h.identity.users.size).toBe(0);
  });
});

describe("what the callback refuses", () => {
  it("a forged or tampered ID token: wrong key, issuer, audience or nonce, expired, or unsigned", async () => {
    const iat = () => Math.floor(h.clock.now.getTime() / 1000);
    const forgeries: ((f: Flow) => Promise<string>)[] = [
      (f) => idToken(f, {}, { key: otherKey }),
      (f) => idToken(f, { iss: "https://evil.example" }),
      (f) => idToken(f, { aud: "another-client" }),
      (f) => idToken(f, { nonce: "someone-elses-nonce" }),
      (f) => idToken(f, { nonce: undefined }),
      (f) => idToken(f, { iat: iat() - 7200, exp: iat() - 3600 }),
      // Another kind of Passport token (an access token is `at+jwt`), even correctly signed for this client.
      (f) => idToken(f, {}, { typ: "at+jwt" }),
      // Signed by a key Passport does not publish under that id.
      (f) => idToken(f, {}, { kid: "oauth-unknown" }),
      async (f) => `${btoa(JSON.stringify({ alg: "none", typ: "JWT" }))}.${btoa(JSON.stringify({ iss: PASSPORT, aud: CLIENT, sub: PASSPORT_USER, nonce: f.nonce, email: EMAIL, email_verified: true, exp: iat() + 300, iat: iat() }))}.`,
      async () => "not-a-token",
    ];
    for (const forge of forgeries) {
      const flow = await start();
      passport(await forge(flow));
      await expectRefused(await callback(flow), "state_mismatch");
    }
    expect(h.identity.users.size).toBe(0);
    expect(await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER })).toBeNull();
  });

  it("a token signed by a Passport key outside the sign-in family, such as the attestation key", async () => {
    const attest = await generateKeyPair("ES256", { extractable: true });
    const attestJwk: JWK = { ...(await exportJWK(attest.publicKey)), kid: "attest-passport-test", alg: "ES256", use: "sig" };
    const flow = await start();
    // Passport really publishes this key, and the token is otherwise perfect.
    h.passport.fetch = fixtureFetch([
      { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({ "https://commongrants.org/org_id": ORG_ALDER }), expires_in: 900, scope: "org:read openid email", refresh_token: "rt", id_token: await idToken(flow, {}, { key: attest.privateKey, kid: "attest-passport-test" }) } },
      { ...JWKS, body: { keys: [publicJwk, attestJwk] } },
      ORG,
      PROFILE,
    ]).fetch;
    await expectRefused(await callback(flow), "state_mismatch");
    // The filter itself: sign-in keys only when the set names any; the whole set otherwise.
    expect(signInKeys({ keys: [publicJwk, attestJwk] }).keys.map((k) => k.kid)).toEqual([KID]);
    expect(signInKeys({ keys: [attestJwk] }).keys.map((k) => k.kid)).toEqual(["attest-passport-test"]);
  });

  it("an answer with no ID token at all", async () => {
    const flow = await start();
    passport(null);
    await expectRefused(await callback(flow), "state_mismatch");
  });

  it("a callback in a browser that did not start the flow (login CSRF): no cookie, another flow's cookie, or a forged state", async () => {
    const flow = await start();
    const other = await start();
    passport(await idToken(flow));
    await expectRefused(await callback(flow, { cookie: null }), "state_mismatch");
    await expectRefused(await callback(flow, { cookie: other.cookie }), "state_mismatch");
    await expectRefused(await callback(flow, { cookie: `${SIGNIN_COOKIE}=` }), "state_mismatch");
    await expectRefused(await callback(flow, { query: { state: "not-a-sealed-state" } }), "state_mismatch");
    await expectRefused(await callback(flow, { query: { state: flow.state.slice(0, -4) + "AAAA" } }), "state_mismatch");
    // Another flow's state with this flow's cookie does not match either.
    await expectRefused(await callback(flow, { query: { state: other.state } }), "state_mismatch");
  });

  it("a flow that took longer than ten minutes", async () => {
    const flow = await start();
    passport(await idToken(flow));
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    await expectRefused(await callback(flow), "expired");
  });

  it("a replayed code: Passport refuses the second exchange and nobody is signed in", async () => {
    const flow = await start();
    passport(await idToken(flow), { tokenStatus: 400 });
    await expectRefused(await callback(flow), "expired");
  });

  it("a cancellation or an error from Passport, and a callback with no code", async () => {
    const flow = await start();
    passport(await idToken(flow));
    const cancelled = await h.request(`/gms/passport/signin/callback?error=access_denied&state=${encodeURIComponent(flow.state)}`, { headers: { Cookie: flow.cookie } });
    expect(cancelled.headers.get("Location")).toBe(`${WEB}/signin?passport_error=cancelled`);
    const failed = await h.request(`/gms/passport/signin/callback?error=server_error&error_description=${encodeURIComponent("boom <script>")}&state=${encodeURIComponent(flow.state)}`, { headers: { Cookie: flow.cookie } });
    expect(failed.headers.get("Location")).toBe(`${WEB}/signin?passport_error=unavailable`);
    const noCode = await h.request(`/gms/passport/signin/callback?state=${encodeURIComponent(flow.state)}`, { headers: { Cookie: flow.cookie } });
    expect(noCode.headers.get("Location")).toBe(`${WEB}/signin?passport_error=state_mismatch`);
  });

  it("a Passport outage at the token endpoint, the key set or the organization read, leaving no account behind", async () => {
    let flow = await start();
    passport(await idToken(flow), { tokenStatus: 503 });
    await expectRefused(await callback(flow), "unavailable");

    flow = await start();
    h.passport.fetch = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({ "https://commongrants.org/org_id": ORG_ALDER }), refresh_token: "rt", expires_in: 900, scope: "openid email org:read", id_token: await idToken(flow) } }, { method: "GET", path: "/.well-known/jwks.json", status: 502, body: {} }]).fetch;
    await expectRefused(await callback(flow), "unavailable");

    flow = await start();
    h.passport.fetch = fixtureFetch([
      { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({ "https://commongrants.org/org_id": ORG_ALDER }), refresh_token: "rt", expires_in: 900, scope: "openid email org:read", id_token: await idToken(flow) } },
      { ...JWKS, body: { keys: [publicJwk] } },
      { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}`, status: 503, body: {} },
    ]).fetch;
    await expectRefused(await callback(flow), "unavailable");
    expect(h.identity.users.size).toBe(0);
  });

  it("an organization claim without the consent to back it: no refresh token means no link", async () => {
    const flow = await start();
    h.passport.fetch = fixtureFetch([
      { method: "POST", path: "/oauth/token", status: 200, body: { access_token: fakeJwt({ "https://commongrants.org/org_id": ORG_ALDER }), expires_in: 900, scope: "openid email org:read", id_token: await idToken(flow) } },
      { ...JWKS, body: { keys: [publicJwk] } },
      ORG,
      PROFILE,
    ]).fetch;
    await expectRefused(await callback(flow), "no_organization");
    expect(await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER })).toBeNull();
  });

  it("an open redirect in returnTo: the person still signs in, to the default place", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/w/x?to=//evil.example"]) {
      h = await harness();
      const flow = await start(bad);
      passport(await idToken(flow));
      const r = await callback(flow);
      expect(r.location.origin).toBe(WEB);
      expect(r.fragment.get("next")).toMatch(/^\/w\/alder-creek-family-services$/);
    }
  });

  it("more than thirty attempts from one address in ten minutes", async () => {
    const from = (headers: Record<string, string>) => h.request(`/gms/passport/signin/start?hop=${HOP}`, { headers });
    const hit = () => from({ "CF-Connecting-IP": "203.0.113.9" });
    for (let i = 0; i < 30; i++) expect(new URL((await hit()).headers.get("Location")!).origin).toBe(PASSPORT);
    expect((await hit()).headers.get("Location")).toBe(`${WEB}/signin?passport_error=unavailable`);
    // Another address is unaffected.
    expect(new URL((await from({ "CF-Connecting-IP": "203.0.113.10" })).headers.get("Location")!).origin).toBe(PASSPORT);
    // So is the callback for the same address: the two routes are counted apart, so starting
    // thirty sign-ins cannot stop the one that is coming back.
    const flow = await start();
    passport(await idToken(flow));
    const res = await h.request(`/gms/passport/signin/callback?${new URLSearchParams({ code: "the-code", state: flow.state })}`, { headers: { Cookie: flow.cookie, "CF-Connecting-IP": "203.0.113.9" } });
    expect(new URL(res.headers.get("Location")!).pathname).toBe("/auth/passport");
    // Behind another proxy the first forwarded address is the one counted.
    for (let i = 0; i < 30; i++) await from({ "X-Forwarded-For": "198.51.100.7, 10.0.0.1" });
    expect((await from({ "X-Forwarded-For": "198.51.100.7, 10.0.0.2" })).headers.get("Location")).toBe(`${WEB}/signin?passport_error=unavailable`);
    expect(new URL((await from({ "X-Forwarded-For": "198.51.100.8" })).headers.get("Location")!).origin).toBe(PASSPORT);
  });

  it("requests with no network address at all share one large allowance, not one person's", async () => {
    // Forty with no address (more than a person's thirty) still go through.
    for (let i = 0; i < 40; i++) expect(new URL((await h.request(`/gms/passport/signin/start?hop=${HOP}`)).headers.get("Location")!).origin).toBe(PASSPORT);
  });
});
