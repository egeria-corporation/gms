// SPDX-License-Identifier: AGPL-3.0-only
import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { AGENT_REDIRECT, BASE, CLIENT_AGENT, CLIENT_API, CLIENT_SECRET, USER_ADMIN, USER_OFFICER, VERIFIER, WEB, WS_APPLICANT, WS_FUNDER, authorizeAs, bearer, form, harness } from "./helpers.ts";

describe("client credentials", () => {
  it("issues an ES256 access token bound to the client's workspace", async () => {
    const h = await harness();
    const res = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_API, client_secret: CLIENT_SECRET, scope: "applications:read" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "applications:read" });
    expect(body.refresh_token).toBeUndefined();
    const token = body.access_token as string;
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", kid: h.kid, typ: "at+jwt" });
    expect(decodeJwt(token)).toMatchObject({ iss: BASE, aud: BASE, sub: CLIENT_API, client_id: CLIENT_API, scope: "applications:read", [WORKSPACE_CLAIM]: WS_FUNDER });
  });

  it("accepts HTTP Basic client authentication and defaults to all allowed scopes", async () => {
    const h = await harness();
    const res = await h.request("/oauth/token", { ...form({ grant_type: "client_credentials" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${CLIENT_API}:${CLIENT_SECRET}`)}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scope: string }).scope).toBe("workspace:admin applications:read awards:read");
  });

  it("rejects a wrong secret, an unknown client, a scope the client lacks and an unknown grant", async () => {
    const h = await harness();
    const wrong = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_API, client_secret: "gms_cs_wrong" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: "invalid_client" });
    const unknown = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: "nope", client_secret: CLIENT_SECRET }));
    expect(unknown.status).toBe(401);
    const scope = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_API, client_secret: CLIENT_SECRET, scope: "payments:release" }));
    expect(scope.status).toBe(400);
    expect(await scope.json()).toMatchObject({ error: "invalid_scope" });
    const grant = await h.request("/oauth/token", form({ grant_type: "password", client_id: CLIENT_API, client_secret: CLIENT_SECRET }));
    expect(await grant.json()).toMatchObject({ error: "unsupported_grant_type" });
  });

  it("refuses client_credentials for a public client and tokens for a revoked client", async () => {
    const h = await harness();
    const pub = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_AGENT }));
    expect(await pub.json()).toMatchObject({ error: "unauthorized_client" });
    h.auth.clients[0]!.revokedAt = h.clock.now.toISOString();
    const revoked = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_API, client_secret: CLIENT_SECRET }));
    expect(revoked.status).toBe(401);
  });
});

describe("authorization code + PKCE", () => {
  it("validates the request and sends the person to the consent screen with a signed request", async () => {
    const h = await harness();
    const { step1, req, session } = await authorizeAs(h, USER_OFFICER, { approve: false });
    expect(step1.status).toBe(302);
    expect(step1.headers.get("Location")!.startsWith(`${WEB}/oauth/consent?req=`)).toBe(true);

    const view = await h.request(`/oauth/authorize/request?req=${encodeURIComponent(req)}`, bearer(session));
    expect(view.status).toBe(200);
    const { data } = (await view.json()) as { data: { client: { name: string }; scopes: { scope: string }[]; gatedActions: string[]; workspaces: { id: string; grantableScopes: string[] }[] } };
    expect(data.client.name).toBe("Claude");
    expect(data.scopes.map((s) => s.scope)).toEqual(["applications:read", "applications:write", "decisions:write"]);
    expect(data.gatedActions).toContain("commit_decisions");
    // The officer is a program officer at the funder and an editor at the applicant: different grantable sets.
    expect(data.workspaces.find((w) => w.id === WS_FUNDER)!.grantableScopes).toEqual(["applications:read", "applications:write", "decisions:write"]);
    expect(data.workspaces.find((w) => w.id === WS_APPLICANT)!.grantableScopes).toEqual(["applications:read", "applications:write"]);
  });

  it("happy path: consent → code → tokens bound to user, workspace and scopes; consent is ledgered", async () => {
    const h = await harness();
    const { decision } = await authorizeAs(h, USER_OFFICER);
    expect(decision.status).toBe(200);
    const redirect = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(AGENT_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("st-123");
    const code = redirect.searchParams.get("code")!;

    const res = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(body.scope).toBe("applications:read applications:write decisions:write");
    expect(decodeJwt(body.access_token)).toMatchObject({ sub: USER_OFFICER, client_id: CLIENT_AGENT, [WORKSPACE_CLAIM]: WS_FUNDER });
    expect(body.refresh_token).toMatch(/^gms_rt_/);

    const who = await h.request("/gms/whoami", bearer(body.access_token));
    expect(((await who.json()) as { data: unknown }).data).toMatchObject({ kind: "delegated", userId: USER_OFFICER, clientId: CLIENT_AGENT, workspaceId: WS_FUNDER, role: "program_officer" });

    expect(h.ledger.events).toHaveLength(1);
    expect(h.ledger.events[0]).toMatchObject({ eventType: "access.agent_consent_granted", actor: `user:${USER_OFFICER}`, workspaceId: WS_FUNDER, subjectId: CLIENT_AGENT });

    // A code works once.
    const replay = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a wrong verifier, a different redirect_uri and an expired code", async () => {
    const h = await harness();
    const codeFor = async () => new URL(((await (await authorizeAs(h, USER_OFFICER)).decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
    const exchange = (code: string, over: Record<string, string> = {}) =>
      h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER, ...over }));

    const badVerifier = await exchange(await codeFor(), { code_verifier: "another-verifier-that-is-long-enough-0123456789abc" });
    expect(badVerifier.status).toBe(400);
    expect(await badVerifier.json()).toMatchObject({ error: "invalid_grant" });

    expect((await exchange(await codeFor(), { redirect_uri: "http://localhost:1/other" })).status).toBe(400);

    const late = await codeFor();
    h.clock.now = new Date(h.clock.now.getTime() + 121_000);
    expect((await exchange(late)).status).toBe(400);
  });

  it("grants only what the person's role allows and what they kept ticked", async () => {
    const h = await harness();
    // An editor at the applicant workspace cannot grant decisions:write.
    const { decision } = await authorizeAs(h, USER_OFFICER, { workspaceId: WS_APPLICANT });
    const code = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
    const res = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
    expect(((await res.json()) as { scope: string }).scope).toBe("applications:read applications:write");

    const unticked = await authorizeAs(h, USER_OFFICER, { scopes: ["applications:read"] });
    const code2 = new URL(((await unticked.decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
    expect(h.auth.codes.at(-1)!.scopes).toEqual(["applications:read"]);
    expect(code2).toMatch(/^gms_ac_/);
  });

  it("declining redirects with access_denied and issues nothing", async () => {
    const h = await harness();
    const { decision } = await authorizeAs(h, USER_OFFICER, { approve: false });
    const redirect = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(h.auth.codes).toHaveLength(0);
  });

  it("requires a session, membership and MFA for roles that need it", async () => {
    const h = await harness();
    const { req } = await authorizeAs(h, USER_OFFICER, { approve: false });
    const post = (token: string | null, workspaceId: string) =>
      h.request("/oauth/authorize/decision", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ req, approve: true, workspaceId }) });
    expect((await post(null, WS_FUNDER)).status).toBe(401);
    expect((await post(await h.session(USER_ADMIN), WS_APPLICANT)).status).toBe(403);
    const noMfa = await post(await h.session(USER_ADMIN, { aal: "aal1" }), WS_FUNDER);
    expect(noMfa.status).toBe(403);
    expect(await noMfa.json()).toMatchObject({ errors: [{ code: "mfa_required" }] });
    // An API token is not a person.
    const apiToken = await h.forge({});
    expect((await post(apiToken, WS_FUNDER)).status).toBe(401);
  });

  it("refuses unregistered redirects without redirecting, and requires S256", async () => {
    const h = await harness();
    const base = { response_type: "code", client_id: CLIENT_AGENT, redirect_uri: AGENT_REDIRECT, scope: "applications:read", code_challenge: "x".repeat(43), code_challenge_method: "S256" };
    const evil = await h.request(`/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: "https://evil.example/cb" })}`);
    expect(evil.status).toBe(400);
    expect(evil.headers.get("Location")).toBeNull();
    const plain = await h.request(`/oauth/authorize?${new URLSearchParams({ ...base, code_challenge_method: "plain" })}`);
    expect(plain.status).toBe(302);
    expect(new URL(plain.headers.get("Location")!).searchParams.get("error")).toBe("invalid_request");
    const scope = await h.request(`/oauth/authorize?${new URLSearchParams({ ...base, scope: "workspace:admin" })}`);
    expect(new URL(scope.headers.get("Location")!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("rejects a tampered or expired consent request", async () => {
    const h = await harness();
    const { req, session } = await authorizeAs(h, USER_OFFICER, { approve: false });
    const tampered = await h.request(`/oauth/authorize/request?req=${encodeURIComponent(req.slice(0, -4) + "AAAA")}`, bearer(session));
    expect(tampered.status).toBe(400);
    h.clock.now = new Date(h.clock.now.getTime() + 601_000);
    const expired = await h.request(`/oauth/authorize/request?req=${encodeURIComponent(req)}`, bearer(await h.session(USER_OFFICER)));
    expect(await expired.json()).toMatchObject({ errors: [{ code: "invalid_consent_request" }] });
  });
});

describe("refresh tokens", () => {
  async function tokens(h: Awaited<ReturnType<typeof harness>>) {
    const { decision } = await authorizeAs(h, USER_OFFICER);
    const code = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
    const res = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
    return (await res.json()) as { access_token: string; refresh_token: string };
  }
  const refresh = (h: Awaited<ReturnType<typeof harness>>, token: string, extra: Record<string, string> = {}) => h.request("/oauth/token", form({ grant_type: "refresh_token", client_id: CLIENT_AGENT, refresh_token: token, ...extra }));

  it("rotates on every use and the old token stops working", async () => {
    const h = await harness();
    const first = await tokens(h);
    const res = await refresh(h, first.refresh_token);
    expect(res.status).toBe(200);
    const second = (await res.json()) as { refresh_token: string; scope: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const third = await refresh(h, second.refresh_token);
    expect(third.status).toBe(200);
    expect((await refresh(h, second.refresh_token)).status).toBe(400);
  });

  it("revokes the whole consent when a rotated token is used again", async () => {
    const h = await harness();
    const first = await tokens(h);
    const second = (await (await refresh(h, first.refresh_token)).json()) as { refresh_token: string };
    // The first token already worked once. Seeing it again means it leaked, so its successor dies too.
    expect((await refresh(h, first.refresh_token)).status).toBe(400);
    expect((await refresh(h, second.refresh_token)).status).toBe(400);
    expect(h.auth.grants[0]!.revokedAt).not.toBeNull();
  });

  it("cannot widen scope, and follows the person's current role", async () => {
    const h = await harness();
    const t = await tokens(h);
    const wider = await refresh(h, t.refresh_token, { scope: "payments:release" });
    expect(await wider.json()).toMatchObject({ error: "invalid_scope" });
    // The officer is moved to observer: decisions:write and applications:write drop out at the next refresh.
    await h.repos.table("workspace_members").update({ user_id: USER_OFFICER, workspace_id: WS_FUNDER }, { role: "observer" });
    const res = await refresh(h, t.refresh_token);
    expect(((await res.json()) as { scope: string }).scope).toBe("applications:read");
    // ...and the access token already issued loses them immediately.
    const who = await h.request("/gms/whoami", bearer(t.access_token));
    expect(((await who.json()) as { data: { scopes: string[] } }).data.scopes).toEqual(["applications:read"]);
  });

  it("stops when the person leaves the workspace or the grant is revoked", async () => {
    const h = await harness();
    const t = await tokens(h);
    await h.auth.revokeGrant(h.auth.grants[0]!.id, h.clock.now.toISOString());
    expect((await refresh(h, t.refresh_token)).status).toBe(400);
    await h.repos.table("workspace_members").remove({ user_id: USER_OFFICER, workspace_id: WS_FUNDER });
    expect((await h.request("/gms/whoami", bearer(t.access_token))).status).toBe(403);
  });
});

describe("dynamic client registration", () => {
  const post = (h: Awaited<ReturnType<typeof harness>>, body: unknown) => h.request("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("registers a public client that can then run the authorization code flow", async () => {
    const h = await harness();
    const res = await post(h, { client_name: "Claude Desktop", redirect_uris: ["http://localhost:6274/oauth/callback", "https://claude.ai/api/mcp/auth_callback"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ client_name: "Claude Desktop", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(body.client_secret).toBeUndefined();
    expect(String(body.scope).split(" ")).not.toContain("workspace:admin");
    const stored = await h.auth.getClient(body.client_id as string);
    expect(stored).toMatchObject({ dynamic: true, clientSecretHash: null, workspaceId: null });

    const q = new URLSearchParams({ response_type: "code", client_id: body.client_id as string, redirect_uri: "http://localhost:6274/oauth/callback", scope: "applications:read", code_challenge: "c".repeat(43), code_challenge_method: "S256" });
    expect((await h.request(`/oauth/authorize?${q}`)).headers.get("Location")!.startsWith(WEB)).toBe(true);
  });

  it("rejects redirects off the allow-list, plain-HTTP hosts and confidential registrations", async () => {
    const h = await harness();
    for (const uri of ["https://evil.example/cb", "http://claude.ai/cb", "javascript:alert(1)", "https://claude.ai.evil.example/cb"]) {
      const res = await post(h, { client_name: "x", redirect_uris: [uri] });
      expect(res.status, uri).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
    }
    const secret = await post(h, { client_name: "x", redirect_uris: ["http://localhost:1/cb"], token_endpoint_auth_method: "client_secret_basic" });
    expect(await secret.json()).toMatchObject({ error: "invalid_client_metadata" });
    const cc = await post(h, { client_name: "x", redirect_uris: ["http://localhost:1/cb"], grant_types: ["client_credentials"] });
    expect(cc.status).toBe(400);
  });

  it("honors OAUTH_DCR_REDIRECT_HOSTS for self-hosters", async () => {
    const h = await harness();
    h.env.OAUTH_DCR_REDIRECT_HOSTS = "agents.funder.example";
    expect((await post(h, { client_name: "x", redirect_uris: ["https://agents.funder.example/cb"] })).status).toBe(201);
  });
});
