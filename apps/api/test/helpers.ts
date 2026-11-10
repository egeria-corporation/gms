// SPDX-License-Identifier: AGPL-3.0-only
import { FakeLlmClient } from "@gms/assist";
import { FixtureBankFeed, FixtureMcpDirectory, FixtureWorkspaceApps } from "@gms/connectors";
import { MemoryLedgerStore } from "@gms/ledger";
import { MemoryKv } from "@gms/mcp";
import { MemoryMailer } from "@gms/notify";
import type { FetchLike } from "@gms/passport-client";
import { MemoryWebhookStore } from "@gms/webhooks";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { createApp, type Deps } from "../src/app.ts";
import { hashSecret, sha256b64url } from "../src/auth/crypto.ts";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { MemoryAuthStore, type MembershipStore, type OAuthClient } from "../src/auth/stores.ts";
import type { Env } from "../src/env.ts";
import { FixtureOpenGrantsClient, MemoryFileStorage, MemoryUserDirectory, type OpenGrantsListing } from "../src/services/ports.ts";
import { MemoryRepos } from "../src/services/repos/memory.ts";
import { RepoMembershipStore } from "../src/services/repos/membership.ts";

export const BASE = "https://gms.test";
export const WEB = "https://app.gms.test";
// HS256 test secret for Supabase-style session tokens; not a real project secret.
export const SESSION_SECRET = "test-session-secret-not-a-real-one-0123456789";

export const WS_FUNDER = "11111111-1111-4111-8111-111111111111";
export const WS_OTHER = "22222222-2222-4222-8222-222222222222";
export const WS_APPLICANT = "33333333-3333-4333-8333-333333333333";
export const USER_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_OFFICER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const USER_AUDITOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const CLIENT_API = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const CLIENT_AGENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const CLIENT_SECRET = "gms_cs_test-client-secret-for-unit-tests-only";
export const AGENT_REDIRECT = "http://localhost:33418/callback";

export interface Harness {
  app: ReturnType<typeof createApp>;
  env: Env;
  auth: MemoryAuthStore;
  members: MembershipStore;
  repos: MemoryRepos;
  webhooks: MemoryWebhookStore;
  ledger: MemoryLedgerStore;
  /** Set to answer Passport calls from recorded fixtures. */
  passport: { fetch?: FetchLike };
  mailer: MemoryMailer;
  storage: MemoryFileStorage;
  openGrants: FixtureOpenGrantsClient;
  bank: FixtureBankFeed;
  workspaceApps: FixtureWorkspaceApps;
  mcpDirectory: FixtureMcpDirectory;
  /** The assistant's model. Off until a test sets `env.ASSISTANT_ENABLED = "true"`; `llmAnswer` is what it returns. */
  llm: FakeLlmClient;
  llmAnswer: { value: unknown };
  /** Objects written to the EXPORTS bucket, by key. */
  exported: Map<string, string>;
  /** Names and emails of people, as the auth provider would answer. */
  directory: MemoryUserDirectory;
  clock: { now: Date };
  privateKey: CryptoKey;
  kid: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  session: (userId: string, opts?: { aal?: "aal1" | "aal2"; exp?: number }) => Promise<string>;
  /** Sign an arbitrary access token with the server's key, to probe one claim at a time. */
  forge: (claims: Record<string, unknown>, opts?: { key?: CryptoKey; kid?: string; typ?: string }) => Promise<string>;
}

export const ORG_RIVERBEND = "0190a000-0000-7000-8000-000000000001";
// AES-256-GCM test key: the bytes 0..31, base64url. Not a real key.
export const TEST_CREDENTIALS_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
export const PASSPORT = "https://passport.test";
// HMAC test secrets for inbound webhooks; not real.
export const PASSPORT_WEBHOOK_SECRET = "passport-webhook-secret-for-unit-tests";
export const RESEND_WEBHOOK_SECRET = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
export const OPENGRANTS_LISTINGS: OpenGrantsListing[] = [
  { id: "og-1", title: "Rural Health Access Fund", funder: "Northwind Family Foundation", url: "https://opengrants.example/grants/og-1", summary: "Operating support for rural clinics" },
  { id: "og-2", title: "Community Health Grants 2027", funder: "Riverbend Community Foundation", url: "https://app.gms.test/f/riverbend/o/community-health-2027", summary: "Health navigation" },
];

export async function harness(): Promise<Harness> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk: JWK = await exportJWK(privateKey);
  const kid = "oauth-test-1";
  const env: Env = { GMS_BASE_URL: BASE, WEB_BASE_URL: WEB, OAUTH_ISSUER: BASE, OAUTH_KID: kid, OAUTH_SIGNING_KEY_JWK: JSON.stringify(jwk), SUPABASE_JWT_SECRET: SESSION_SECRET, PASSPORT_BASE_URL: PASSPORT, CREDENTIALS_ENCRYPTION_KEY: TEST_CREDENTIALS_KEY, PASSPORT_GMS_CLIENT_ID: "gms-test-client", PASSPORT_GMS_CLIENT_SECRET: "gms-test-client-secret-not-real", RESEND_FROM: "OpenGrants GMS <notices@gms.test>", WEBHOOK_SECRET_KEY: TEST_CREDENTIALS_KEY, PASSPORT_WEBHOOK_SECRET, RESEND_INBOUND_SECRET: RESEND_WEBHOOK_SECRET };

  const clients: OAuthClient[] = [
    {
      id: CLIENT_API,
      name: "Board dashboard sync",
      workspaceId: WS_FUNDER,
      clientSecretHash: await hashSecret(CLIENT_SECRET),
      allowedScopes: ["workspace:admin", "applications:read", "awards:read"],
      grantTypes: ["client_credentials"],
      redirectUris: [],
      gatedTools: null,
      dynamic: false,
      revokedAt: null,
    },
    {
      id: CLIENT_AGENT,
      name: "Claude",
      workspaceId: null,
      clientSecretHash: null,
      allowedScopes: ["applications:read", "applications:write", "decisions:write", "payments:release", "communications:write"],
      grantTypes: ["authorization_code"],
      redirectUris: [AGENT_REDIRECT],
      gatedTools: null,
      dynamic: true,
      revokedAt: null,
    },
  ];
  const auth = new MemoryAuthStore(clients);
  const clock = { now: new Date("2027-04-16T17:00:00Z") };
  const repos = new MemoryRepos(() => clock.now);
  const workspace = (id: string, kind: "funder" | "applicant", handle: string, name: string, extra: Record<string, unknown> = {}) => repos.table("workspaces").insert({ id, kind, handle, display_name: name, ...extra });
  await workspace(WS_FUNDER, "funder", "riverbend", "Riverbend Community Foundation", { passport_org_id: ORG_RIVERBEND, brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" } });
  await workspace(WS_OTHER, "funder", "cascade-county", "Cascade County Health Department");
  await workspace(WS_APPLICANT, "applicant", "alder-creek", "Alder Creek Family Services");
  const member = (workspaceId: string, userId: string, role: string) => repos.table("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role });
  await member(WS_FUNDER, USER_ADMIN, "admin");
  await member(WS_FUNDER, USER_OFFICER, "program_officer");
  await member(WS_FUNDER, USER_AUDITOR, "auditor");
  await member(WS_APPLICANT, USER_OFFICER, "editor");
  const members = new RepoMembershipStore(repos);
  const ledger = new MemoryLedgerStore();
  const webhooks = new MemoryWebhookStore();
  const passport: { fetch?: FetchLike } = {};
  const mailer = new MemoryMailer();
  const storage = new MemoryFileStorage();
  const openGrants = new FixtureOpenGrantsClient(OPENGRANTS_LISTINGS);
  const kv = new MemoryKv();
  const bank = new FixtureBankFeed();
  const workspaceApps = new FixtureWorkspaceApps();
  const mcpDirectory = new FixtureMcpDirectory();
  const llmAnswer: { value: unknown } = { value: {} };
  const llm = new FakeLlmClient(() => llmAnswer.value);
  const exported = new Map<string, string>();
  const directory = new MemoryUserDirectory();
  directory.users.set(USER_ADMIN, { email: "helen.ortiz@riverbendcf.example", name: "Helen Ortiz" });
  directory.users.set(USER_OFFICER, { email: "dana.ortiz@riverbendcf.example", name: "Dana Ortiz" });
  const deps: Deps = {
    auth,
    members,
    ledger,
    repos,
    webhooks,
    now: () => clock.now,
    get passportFetch() {
      return passport.fetch;
    },
    ports: () => ({ mailer, storage, openGrants, directory, bank, workspaceApps, mcpDirectory, llm, exports: { put: async (key, body) => void exported.set(key, body) } }),
    kv: () => kv,
    openapi: async () => ({ openapi: "3.0.0", info: { title: "OpenGrants GMS API" } }),
  };
  const app = createApp(() => deps);

  const iat = () => Math.floor(clock.now.getTime() / 1000);
  return {
    app,
    env,
    auth,
    members,
    repos,
    webhooks,
    ledger,
    passport,
    mailer,
    storage,
    openGrants,
    bank,
    workspaceApps,
    mcpDirectory,
    llm,
    llmAnswer,
    exported,
    directory,
    clock,
    privateKey,
    kid,
    request: async (path, init) => app.request(`${BASE}${path}`, init, env),
    session: (userId, opts = {}) =>
      new SignJWT({ aal: opts.aal ?? "aal2", email: "person@riverbendcf.example", role: "authenticated" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(userId)
        .setAudience("authenticated")
        .setIssuedAt(iat())
        .setExpirationTime(opts.exp ?? iat() + 3600)
        .sign(new TextEncoder().encode(SESSION_SECRET)),
    forge: (claims, opts = {}) =>
      new SignJWT({ iss: BASE, aud: BASE, sub: CLIENT_API, client_id: CLIENT_API, scope: "workspace:admin", [WORKSPACE_CLAIM]: WS_FUNDER, iat: iat(), exp: iat() + 600, ...claims })
        .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? kid, typ: opts.typ ?? "at+jwt" })
        .sign(opts.key ?? privateKey),
  };
}

export const form = (fields: Record<string, string>): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
export const bearer = (token: string, extra: Record<string, string> = {}) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } });

export async function clientCredentialsToken(h: Harness, scope?: string): Promise<string> {
  const res = await h.request("/oauth/token", form({ grant_type: "client_credentials", client_id: CLIENT_API, client_secret: CLIENT_SECRET, ...(scope ? { scope } : {}) }));
  return ((await res.json()) as { access_token: string }).access_token;
}

export const VERIFIER = "unit-test-code-verifier-0123456789-abcdefghijklmnop";
export const challengeOf = (verifier: string) => sha256b64url(verifier);

/** Run steps 1–3 of the authorization code flow as `userId`; returns the redirect the browser would follow. */
export async function authorizeAs(h: Harness, userId: string, opts: { scope?: string; workspaceId?: string; approve?: boolean; scopes?: string[]; aal?: "aal1" | "aal2" } = {}) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_AGENT,
    redirect_uri: AGENT_REDIRECT,
    scope: opts.scope ?? "applications:read applications:write decisions:write",
    state: "st-123",
    code_challenge: await challengeOf(VERIFIER),
    code_challenge_method: "S256",
  });
  const step1 = await h.request(`/oauth/authorize?${q}`);
  const req = new URL(step1.headers.get("Location")!).searchParams.get("req")!;
  const session = await h.session(userId, { aal: opts.aal });
  const decision = await h.request("/oauth/authorize/decision", {
    method: "POST",
    headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    body: JSON.stringify({ req, approve: opts.approve ?? true, workspaceId: opts.workspaceId ?? WS_FUNDER, ...(opts.scopes ? { scopes: opts.scopes } : {}) }),
  });
  return { step1, req, session, decision };
}
