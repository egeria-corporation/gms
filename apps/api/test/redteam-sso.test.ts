// SPDX-License-Identifier: AGPL-3.0-only
// Red team: single sign-on (v1.8.0) on every route in the compiled OpenAPI document. Two funder
// workspaces require SSO, each for its own domain and identity provider: Riverbend's domain through
// provider A, Cascade County's through provider B. A person who is a member of both, and of an
// applicant workspace, tries every GET route of a workspace with:
//   * a session from provider A for the address on Cascade's domain (an identity provider can assert
//     any address, so A's word does not count for B's domain);
//   * an email-code session.
// Both are refused on the SSO workspace (403 sso_required) and keep working everywhere else. Neither
// can join Cascade through SSO, nor turn the requirement on; agents and API clients cannot either.
// Skipped when the document has not been compiled (`pnpm spec:compile`); CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, SESSION_SECRET, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const PROVIDER_A = "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1";
const PROVIDER_B = "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2";
const RIVERBEND_DOMAIN = "riverbendcf.org";
const CASCADE_DOMAIN = "cascadecounty.example";
/** Dana's account on Cascade's domain: the person tries to reach Cascade without its provider. */
const CASCADE_EMAIL = `dana@${CASCADE_DOMAIN}`;
const SSO_DANA = "d5d5d5d5-dddd-4ddd-8ddd-d5d5d5d5d5d5";
const NOWHERE = "00000000-0000-4000-8000-00000000dead";

interface Doc {
  paths: Record<string, { get?: unknown }>;
}

/** The person's own routes: no workspace is named, so no workspace's rule applies. */
const PERSONAL = new Set(["/gms/me", "/gms/workspaces", "/gms/me/sessions", "/gms/config", "/gms/mcp-connections", "/gms/gallery/moderation/me", "/gms/gallery/moderation/queue", "/gms/passport/consent/callback"]);
/** Routes anyone may read without signing in (a calendar feed is read by its secret address), and the sign-in flow. */
const ANYONE = (path: string) => path.startsWith("/gms/public/") || path.startsWith("/gms/passport/signin/") || path.startsWith("/gms/cal/") || path === "/gms/gallery" || path === "/gms/gallery/{slug}" || path === "/gms/migration-requests/form" || path === "/gms/open-data/{handle}/360giving.json" || path === "/gms/digests/unsubscribe";

let h: Harness;
let doc: Doc;

async function session(userId: string, email: string, provider: string | null = null) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const amr = provider ? [{ method: "sso/saml", timestamp: iat, provider }] : [{ method: "otp", timestamp: iat }];
  return new SignJWT({ aal: "aal2", email, role: "authenticated", amr }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
}
async function call(token: string, method: string, path: string, ws?: string, body?: unknown) {
  const res = await h.request(path, { method, headers: { ...bearer(token).headers, ...(ws ? { "X-GMS-Workspace": ws } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  const json = (() => {
    try {
      return JSON.parse(text) as { data?: Record<string, unknown>; errors?: { code: string }[] };
    } catch {
      return {};
    }
  })();
  return { status: res.status, code: json.errors?.[0]?.code, data: json.data, text };
}
async function activeDomain(workspaceId: string, domain: string, provider: string) {
  const at = h.clock.now.toISOString();
  await h.repos.table("workspace_sso_domains").insert({ workspace_id: workspaceId, domain, status: "active", require_sso: true, provider_id: provider, verification_token: "t".repeat(43), verified_at: at, last_checked_at: at, last_check_result: "matched", activated_at: at, created_by: USER_ADMIN });
}
/**
 * Every GET route of a workspace in the document, for workspace `ws`: a path that names a workspace
 * names `ws`, and every other path parameter a value that names nothing.
 */
const workspaceGets = (ws: string = NOWHERE) =>
  Object.entries(doc.paths)
    .filter(([path, item]) => item.get && path.startsWith("/gms/") && !PERSONAL.has(path) && !ANYONE(path))
    .map(([path]) => path.replace(/^\/gms\/workspaces\/\{(id|workspaceId)\}/, `/gms/workspaces/${ws}`).replace(/\{(\w+)\}/g, (_m, p: string) => (p === "handle" ? "riverbend" : p === "provider" ? "google_workspace" : NOWHERE)));

describe.skipIf(!existsSync(SPEC))("single sign-on on every route of the document", () => {
  beforeAll(async () => {
    h = await harness();
    h.env.SUPABASE_URL = SUPABASE;
    // Social posting on (v1.9.0), so its routes reach authentication instead of answering 404 first.
    h.env.ZERNIO_API_KEY = "zk_test_made_up";
    h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
    doc = parse(readFileSync(SPEC, "utf8")) as Doc;
    await activeDomain(WS_FUNDER, RIVERBEND_DOMAIN, PROVIDER_A);
    await activeDomain(WS_OTHER, CASCADE_DOMAIN, PROVIDER_B);
    // Dana (USER_OFFICER) is a program officer at Cascade too, and an editor of Alder Creek (the harness).
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    h.directory.users.set(USER_OFFICER, { email: CASCADE_EMAIL, name: "Dana Ortiz" });
  });

  it("covers the v1.8.0 and v1.9.0 routes", () => {
    const paths = workspaceGets(WS_OTHER);
    expect(paths.length).toBeGreaterThan(150);
    for (const p of ["/gms/sso/settings", "/gms/report-views", "/gms/open-data/summary", `/gms/competitions/${NOWHERE}/coi-policy`, `/gms/workspaces/${WS_OTHER}/gallery/submissions`, "/gms/social", "/gms/funds", "/gms/digests", "/gms/award-sharing/settings", "/gms/guest-review/welcome", `/gms/outside-applications/${NOWHERE}/package`, "/gms/imports/zengine/forms"]) expect(paths).toContain(p);
  });

  it("refuses provider A's session for an address on provider B's domain on every route, and admits B's", async () => {
    const fromA = await session(USER_OFFICER, CASCADE_EMAIL, PROVIDER_A);
    const open: string[] = [];
    for (const path of workspaceGets(WS_OTHER)) {
      const r = await call(fromA, "GET", path, WS_OTHER);
      if (r.status !== 403 || r.code !== "sso_required") open.push(`${r.status} ${r.code ?? ""} ${path}`);
    }
    expect(open).toEqual([]);
    expect((await call(await session(USER_OFFICER, CASCADE_EMAIL, PROVIDER_B), "GET", "/gms/whoami", WS_OTHER)).status).toBe(200);
  });

  it("refuses an email-code session on every route of the SSO workspace, and it keeps working on the others", async () => {
    const code = await session(USER_OFFICER, CASCADE_EMAIL);
    const open: string[] = [];
    for (const path of workspaceGets(WS_OTHER)) {
      const r = await call(code, "GET", path, WS_OTHER);
      if (r.status !== 403 || r.code !== "sso_required") open.push(`${r.status} ${r.code ?? ""} ${path}`);
    }
    expect(open).toEqual([]);
    // The same session in Riverbend (whose rule names another domain) and in Alder Creek (no rule), on every route: never refused for SSO.
    for (const ws of [WS_FUNDER, WS_APPLICANT]) {
      const refused: string[] = [];
      for (const path of workspaceGets(ws)) {
        const r = await call(code, "GET", path, ws);
        if (r.code === "sso_required" || r.code === "workspace_mismatch") refused.push(`${r.status} ${r.code} ${path}`);
      }
      expect(refused, ws).toEqual([]);
      expect((await call(code, "GET", "/gms/whoami", ws)).status).toBe(200);
    }
    // The person's own routes work too.
    expect((await call(code, "GET", "/gms/me")).status).toBe(200);
  });

  it("does not let provider A's session join Cascade through SSO, nor an email-code one; B's does", async () => {
    const sso = (provider: string | null) => session(SSO_DANA, CASCADE_EMAIL, provider);
    expect((await call(await sso(null), "POST", "/gms/sso/join")).code).toBe("sso_session_required");
    expect((await call(await sso(PROVIDER_A), "POST", "/gms/sso/join")).data).toEqual({ joined: [] });
    expect(await h.repos.table("workspace_members").count({ user_id: SSO_DANA })).toBe(0);
    expect((await call(await sso(PROVIDER_B), "POST", "/gms/sso/join")).data).toMatchObject({ joined: [{ workspaceId: WS_OTHER, role: "program_officer" }] });
    // Joined through B, still refused with A's session.
    expect((await call(await sso(PROVIDER_A), "GET", "/gms/whoami", WS_OTHER)).code).toBe("sso_required");
  });

  it("refuses to turn the requirement on without a session from the domain's own provider, and for agents and API clients", async () => {
    // A fresh workspace setting: Riverbend's requirement off, its admin on Riverbend's domain.
    await h.repos.table("workspace_sso_domains").update({ workspace_id: WS_FUNDER }, { require_sso: false });
    const adminEmail = `helen@${RIVERBEND_DOMAIN}`;
    const turnOn = (token: string) => call(token, "PUT", "/gms/sso/requirement", WS_FUNDER, { require: true });
    expect(await turnOn(await session(USER_ADMIN, adminEmail))).toMatchObject({ status: 409, code: "sso_session_required" });
    expect((await turnOn(await session(USER_ADMIN, adminEmail, PROVIDER_B))).code).toBe("sso_session_required");
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-sso-redteam" });
    expect(await turnOn(agent)).toMatchObject({ status: 403, code: "human_only" });
    expect((await turnOn(await clientCredentialsToken(h, "workspace:admin"))).status).toBe(403);
    expect((await h.repos.table("workspace_sso_domains").find({ workspace_id: WS_FUNDER })).every((r) => !r.require_sso)).toBe(true);
    // Through Riverbend's own provider it goes on.
    expect((await turnOn(await session(USER_ADMIN, adminEmail, PROVIDER_A))).data).toMatchObject({ requireSso: true });
  });
});
