// SPDX-License-Identifier: AGPL-3.0-only
// Integration: the Supabase-backed stores and repositories against a real stack (`supabase start`),
// then one flow through the HTTP routes on top of them. Skipped unless SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set; CI's integration job exports them and runs `pnpm test:int`.
// Rows are left behind on purpose: the ledger is append-only, so a workspace with history cannot
// be deleted. Every run uses fresh handles and ids.
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore, record } from "@gms/ledger";
import { SupabaseWebhookStore, fanOut } from "@gms/webhooks";
import { createClient } from "@supabase/supabase-js";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type Deps } from "../src/app.ts";
import { hashSecret, sha256b64url } from "../src/auth/crypto.ts";
import { SupabaseAuthStore } from "../src/auth/supabase-store.ts";
import { REFRESH_TOKEN_TTL_SEC } from "../src/auth/tokens.ts";
import type { Env } from "../src/env.ts";
import { RepoMembershipStore } from "../src/services/repos/membership.ts";
import { SupabaseRepos } from "../src/services/repos/supabase.ts";
import { RepoError } from "../src/services/repos/types.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const run = Math.random().toString(36).slice(2, 10);

describe.skipIf(!URL_ || !KEY)("Supabase stores", () => {
  let db: DbClient;
  let repos: SupabaseRepos;
  let userId: string;
  let workspaceId: string;
  const now = () => new Date();

  beforeAll(async () => {
    db = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DbClient;
    repos = new SupabaseRepos(db);
    const { data, error } = await db.auth.admin.createUser({ email: `int-${run}@riverbendcf.example`, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the test user: ${error?.message}`);
    userId = data.user.id;
    const ws = await repos.table("workspaces").insert({ kind: "funder", handle: `int-${run}`, display_name: "Integration Foundation" });
    workspaceId = ws.id;
    await repos.table("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "admin" });
  });

  it("repositories: defaults, filters, conflicts and composite keys match the migrations", async () => {
    const ws = await repos.table("workspaces").one({ id: workspaceId });
    expect(ws).toMatchObject({ kind: "funder", status: "active", brand: {}, passport_org_id: null });
    await expect(repos.table("workspaces").insert({ kind: "funder", handle: `int-${run}`, display_name: "Copy" })).rejects.toMatchObject({ kind: "conflict" });
    await expect(repos.table("workspaces").insert({ kind: "funder", handle: "X", display_name: "Bad handle" })).rejects.toBeInstanceOf(RepoError);
    // An applicant role in a funder workspace is refused by the role trigger.
    await expect(repos.table("workspace_members").update({ workspace_id: workspaceId, user_id: userId }, { role: "editor" })).rejects.toMatchObject({ kind: "invalid" });

    const program = await repos.table("programs").insert({ workspace_id: workspaceId, name: "Community Health 2027", budget_amount_minor: 120_000_000 });
    expect(program).toMatchObject({ currency: "USD", defaults: {}, budget_amount_minor: 120_000_000 });

    const a = await repos.table("opportunities").insert({ workspace_id: workspaceId, program_id: program.id, slug: "community-health-2027", title: "Community Health Grants 2027" });
    expect(a).toMatchObject({ status: "forecasted", published_at: null, eligibility_rules: { all: [] }, publish: { publicPage: true, sitemap: true } });
    await expect(repos.table("opportunities").insert({ workspace_id: workspaceId, slug: "community-health-2027", title: "Same slug" })).rejects.toMatchObject({ kind: "conflict" });
    const b = await repos.table("opportunities").insert({ workspace_id: workspaceId, slug: "housing-2027", title: "Housing Stability 2027", published_at: now().toISOString(), status: "open" });

    expect(await repos.table("opportunities").count({ workspace_id: workspaceId })).toBe(2);
    expect((await repos.table("opportunities").find({ workspace_id: workspaceId }, { notNull: ["published_at"] })).map((o) => o.id)).toEqual([b.id]);
    expect((await repos.table("opportunities").find({ workspace_id: workspaceId, status: ["forecasted", "closed"] })).map((o) => o.id)).toEqual([a.id]);
    expect((await repos.table("opportunities").find({ workspace_id: workspaceId, program_id: null })).map((o) => o.id)).toEqual([b.id]);
    expect((await repos.table("opportunities").find({ workspace_id: workspaceId }, { orderBy: "slug", ascending: false, limit: 1, offset: 1 })).map((o) => o.slug)).toEqual(["community-health-2027"]);
    const [updated] = await repos.table("opportunities").update({ id: a.id, workspace_id: workspaceId }, { cg: { title: "x" }, key_dates: { closeDate: { date: "2027-04-30" } } });
    expect(updated).toMatchObject({ cg: { title: "x" } });
    expect(Date.parse(updated!.updated_at)).toBeGreaterThanOrEqual(Date.parse(a.updated_at));

    // Forms: (id, version) is the key; a published version is immutable.
    const v1 = await repos.table("forms").insert({ workspace_id: workspaceId, title: "LOI", purpose: "loi" });
    expect(v1).toMatchObject({ version: 1, json_schema: { type: "object" }, published_at: null });
    await repos.table("forms").update({ id: v1.id, version: 1 }, { published_at: now().toISOString() });
    const v2 = await repos.table("forms").insert({ id: v1.id, version: 2, workspace_id: workspaceId, title: "LOI", supersedes_form_version: 1 });
    expect(v2.id).toBe(v1.id);
    await expect(repos.table("forms").update({ id: v1.id, version: 1 }, { json_schema: { type: "object", properties: { a: { type: "string" } } } })).rejects.toMatchObject({ kind: "invalid" });
    expect((await repos.table("forms").find({ id: v1.id }, { orderBy: "version" })).map((f) => f.version)).toEqual([1, 2]);

    const comp = await repos.table("competitions").insert({ workspace_id: workspaceId, opportunity_id: a.id, title: "Community Health Grants 2027" });
    expect(comp).toMatchObject({ status: "draft", stages: [], forms: {} });
    await repos.table("competitions").update({ id: comp.id }, { stages: [{ key: "loi", label: "LOI", forms: { [v1.id]: 1 }, entryFrom: [], requiresSubmission: true, decisionRequired: true }], forms: { [v1.id]: 1 } });
    const rubric = await repos.table("rubrics").insert({ workspace_id: workspaceId, name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] });
    expect(rubric.version).toBe(1);

    const inv = await repos.table("invitations").insert({ workspace_id: workspaceId, email: `reviewer-${run}@reviewers.example`, role: "reviewer", token_hash: await sha256b64url(`inv-${run}`), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await repos.table("invitations").remove({ id: inv.id })).toBe(1);

    const link = await repos.table("passport_links").insert({ workspace_id: workspaceId, mode: "funder_client", client_id: "pc_int", client_secret_enc: "v1.ciphertext", scopes: ["org:read"] });
    await expect(repos.table("passport_links").insert({ workspace_id: workspaceId, mode: "funder_client", client_id: "pc_int_2", client_secret_enc: "v1.ciphertext" })).rejects.toMatchObject({ kind: "conflict" });
    await repos.table("passport_links").update({ id: link.id }, { revoked_at: now().toISOString() });

    const applicant = await repos.table("workspaces").insert({ kind: "applicant", handle: `int-app-${run}`, display_name: "Integration Applicant" });
    await repos.table("consents").insert({ applicant_workspace_id: applicant.id, funder_workspace_id: workspaceId, basis: "application" });
    expect(await repos.table("consents").one({ applicant_workspace_id: applicant.id, funder_workspace_id: workspaceId, revoked_at: null })).not.toBeNull();
  });

  it("memberships are read back for the auth layer", async () => {
    const members = new RepoMembershipStore(repos);
    expect(await members.getMembership(workspaceId, userId)).toMatchObject({ workspaceKind: "funder", workspaceName: "Integration Foundation", role: "admin", scope: null });
    expect((await members.listForUser(userId)).map((m) => m.workspaceId)).toContain(workspaceId);
    expect(await members.getMembership(workspaceId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("auth store: clients, codes, grants and refresh rotation with reuse detection", async () => {
    const auth = new SupabaseAuthStore(db);
    const api = await repos.table("api_clients").insert({ workspace_id: workspaceId, name: "Board dashboard sync", client_secret_hash: await hashSecret(`secret-${run}`), allowed_scopes: ["applications:read", "awards:read"] });
    expect(await auth.getClient(api.id)).toMatchObject({ workspaceId, allowedScopes: ["applications:read", "awards:read"], grantTypes: ["client_credentials"], dynamic: false, revokedAt: null });

    const clientId = crypto.randomUUID();
    await auth.createDynamicClient({ id: clientId, name: "Claude", workspaceId: null, clientSecretHash: null, allowedScopes: ["applications:read"], grantTypes: ["authorization_code", "refresh_token"], redirectUris: ["http://localhost:33418/callback"], gatedTools: null, dynamic: true, revokedAt: null });
    expect(await auth.getClient(clientId)).toMatchObject({ name: "Claude", dynamic: true, clientSecretHash: null, redirectUris: ["http://localhost:33418/callback"] });
    expect(await auth.getClient(crypto.randomUUID())).toBeNull();

    const codeHash = await sha256b64url(`code-${run}`);
    const challenge = await sha256b64url(`verifier-${run}`);
    const at = new Date();
    await auth.saveCode({ codeHash, clientId, userId, workspaceId, scopes: ["applications:read", "applications:write"], redirectUri: "http://localhost:33418/callback", codeChallenge: challenge, expiresAt: new Date(at.getTime() + 120_000).toISOString(), usedAt: null });
    const code = await auth.consumeCode(codeHash, at.toISOString());
    expect(code).toMatchObject({ clientId, userId, workspaceId, scopes: ["applications:read", "applications:write"], codeChallenge: challenge });
    expect(await auth.consumeCode(codeHash, at.toISOString())).toBeNull();

    const expiresAt = new Date(at.getTime() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
    const t1 = await sha256b64url(`rt1-${run}`);
    const t2 = await sha256b64url(`rt2-${run}`);
    await auth.saveGrant({ id: crypto.randomUUID(), tokenHash: t1, clientId, userId, workspaceId, scopes: ["applications:read", "applications:write"], expiresAt, revokedAt: null });
    const grant = await auth.getGrantByTokenHash(t1);
    expect(grant).toMatchObject({ clientId, userId, workspaceId, revokedAt: null });
    expect(Math.abs(Date.parse(grant!.expiresAt) - Date.parse(expiresAt))).toBeLessThan(2000);
    // One consent per (client, person, workspace): a second approval reuses the grant row.
    expect(await repos.table("oauth_grants").count({ client_id: clientId, user_id: userId, workspace_id: workspaceId })).toBe(1);

    expect(await auth.rotateGrant(grant!.id, t1, t2, expiresAt)).toBe(true);
    expect(await auth.rotateGrant(grant!.id, t1, await sha256b64url("other"), expiresAt)).toBe(false);
    expect(await auth.getGrantByTokenHash(t2)).toMatchObject({ id: grant!.id, revokedAt: null });
    // The rotated token shows up again: the whole consent is revoked.
    expect((await auth.getGrantByTokenHash(t1))!.revokedAt).not.toBeNull();
    expect((await auth.getGrantByTokenHash(t2))!.revokedAt).not.toBeNull();
    expect(await auth.getGrantByTokenHash(await sha256b64url("never-issued"))).toBeNull();
  });

  it("ledger store appends and reads, and the table refuses updates", async () => {
    const ledger = new SupabaseLedgerStore(db);
    const event = await record(ledger, { workspaceId, actor: { kind: "user", userId }, eventType: "program.created", subjectType: "program", subjectId: `prg-${run}`, data: { name: "Community Health 2027" } });
    expect(await ledger.count({ workspaceId, subjectId: `prg-${run}` })).toBe(1);
    expect((await ledger.list({ workspaceId, subjectType: "program", subjectId: `prg-${run}` }))[0]).toMatchObject({ id: event.id, actor: `user:${userId}`, eventType: "program.created", data: { name: "Community Health 2027" } });
    const { error } = await db.from("ledger_events").update({ actor: "passport" }).eq("id", event.id);
    expect(error).not.toBeNull();
    expect((await ledger.list({ workspaceId, subjectId: `prg-${run}` }))[0]!.actor).toBe(`user:${userId}`);
  });

  it("webhook store: subscriptions, fan-out and delivery state", async () => {
    const store = new SupabaseWebhookStore(db);
    const sub = await repos.table("webhook_subscriptions").insert({ workspace_id: workspaceId, url: "https://hooks.riverbendcf.example/gms", secret_enc: "v1.ciphertext", events: ["opportunity.published"] });
    expect(await store.listSubscriptions(workspaceId)).toMatchObject([{ id: sub.id, eventTypes: ["opportunity.published"], active: true }]);
    const [delivery] = await fanOut({ id: crypto.randomUUID(), type: "opportunity.published", workspaceId, occurredAt: now().toISOString(), data: { slug: "community-health-2027" } }, { store });
    expect(await fanOut({ id: crypto.randomUUID(), type: "award.created", workspaceId, occurredAt: now().toISOString(), data: {} }, { store })).toEqual([]);

    const stored = await store.getDelivery(delivery!.id);
    expect(stored).toMatchObject({ subscriptionId: sub.id, eventType: "opportunity.published", status: "pending", attempts: 0, lastStatusCode: null });
    expect(JSON.parse(stored!.payload)).toMatchObject({ type: "opportunity.published", data: { slug: "community-health-2027" } });
    expect((await store.listDue(new Date(Date.now() + 1000).toISOString(), 50)).map((d) => d.id)).toContain(delivery!.id);

    await store.updateDelivery(delivery!.id, { status: "failed", attempts: 1, lastStatusCode: 503, lastError: "HTTP 503", nextAttemptAt: new Date(Date.now() + 60_000).toISOString() });
    expect(await store.getDelivery(delivery!.id)).toMatchObject({ status: "failed", attempts: 1, lastStatusCode: 503, lastError: "HTTP 503" });
    await store.updateDelivery(delivery!.id, { status: "delivered", attempts: 2, lastStatusCode: 200, lastError: null, nextAttemptAt: null, deliveredAt: now().toISOString() });
    expect((await store.listDue(new Date(Date.now() + 120_000).toISOString(), 50)).map((d) => d.id)).not.toContain(delivery!.id);
  });

  it.skipIf(!JWT_SECRET)("routes over Supabase: create a workspace, publish an opportunity and read it back as CommonGrants", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const env: Env = { GMS_BASE_URL: "https://gms.test", WEB_BASE_URL: "https://app.gms.test", OAUTH_ISSUER: "https://gms.test", OAUTH_KID: "int-1", OAUTH_SIGNING_KEY_JWK: JSON.stringify(await exportJWK(privateKey)), SUPABASE_JWT_SECRET: JWT_SECRET! };
    const deps: Deps = { auth: new SupabaseAuthStore(db), members: new RepoMembershipStore(repos), ledger: new SupabaseLedgerStore(db), repos, webhooks: new SupabaseWebhookStore(db), now };
    const app = createApp(() => deps);
    const iat = Math.floor(Date.now() / 1000);
    const session = await new SignJWT({ aal: "aal2", email: `int-${run}@riverbendcf.example`, role: "authenticated" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 600).sign(new TextEncoder().encode(JWT_SECRET!));
    const call = async <T>(path: string, init: { method?: string; body?: unknown; workspace?: string } = {}) => {
      const res = await app.request(`https://gms.test${path}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json", ...(init.workspace ? { "X-GMS-Workspace": init.workspace } : {}) }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }, env);
      const json = (await res.json()) as { data: T; message?: string };
      expect(res.status, `${path}: ${json.message}`).toBeLessThan(300);
      return json.data;
    };

    const { workspace } = await call<{ workspace: { id: string } }>("/gms/workspaces", { method: "POST", body: { kind: "funder", handle: `int-http-${run}`, displayName: "Integration HTTP Foundation", brand: { accent: "#1F6F8B" } } });
    const ws = workspace.id;
    const program = await call<{ id: string }>("/gms/programs", { method: "POST", workspace: ws, body: { name: "Community Health 2027", budgetAmountMinor: 120_000_000 } });
    const opp = await call<{ id: string; slug: string }>("/gms/opportunities", {
      method: "POST",
      workspace: ws,
      body: { title: `Community Health Grants ${run}`, description: "Grants for community health navigation.", programId: program.id, funding: { maxAwardAmount: { amount: "150000.00", currency: "USD" } }, acceptedApplicantTypes: ["non_profit_with_501c3"] },
    });
    const form = await call<{ id: string }>("/gms/forms", { method: "POST", workspace: ws, body: { title: "Letter of intent", purpose: "loi", jsonSchema: { type: "object", properties: { projectTitle: { type: "string" } }, required: ["projectTitle"] }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/projectTitle" }] } } });
    await call(`/gms/forms/${form.id}/publish`, { method: "POST", workspace: ws });
    const rubric = await call<{ id: string }>("/gms/rubrics", { method: "POST", workspace: ws, body: { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] } });
    const comp = await call<{ id: string }>("/gms/competitions", { method: "POST", workspace: ws, body: { opportunityId: opp.id, title: "Community Health Grants" } });
    await call(`/gms/competitions/${comp.id}/stages`, { method: "PUT", workspace: ws, body: { stages: [{ key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T00:00:00Z", rubricId: rubric.id }] } });
    await call(`/gms/opportunities/${opp.id}/publish`, { method: "POST", workspace: ws, body: {} });
    expect(await call<{ ready: boolean }>(`/gms/competitions/${comp.id}/launch-check`, { method: "POST", workspace: ws })).toMatchObject({ ready: true });
    expect(await call<{ status: string }>(`/gms/competitions/${comp.id}/open`, { method: "POST", workspace: ws })).toMatchObject({ status: "open" });

    const uuid = opp.id.slice(4);
    const anon = async <T>(path: string) => ((await (await app.request(`https://gms.test${path}`, {}, env)).json()) as { data: T }).data;
    const details = await anon<{ id: string; competitions: { forms: { forms: Record<string, unknown> } }[] }>(`/common-grants/opportunities/${uuid}`);
    expect(details.id).toBe(uuid);
    expect(Object.keys(details.competitions[0]!.forms.forms)).toEqual([form.id.slice(4)]);
    expect(await anon<{ opportunities: { slug: string }[] }>(`/gms/public/funders/int-http-${run}`)).toMatchObject({ opportunities: [{ slug: opp.slug }] });

    const ledger = (await call<never>("/gms/ledger", { workspace: ws })) as unknown;
    void ledger;
    const events = await new SupabaseLedgerStore(db).list({ workspaceId: ws });
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["workspace.created", "program.created", "opportunity.published", "competition.opened"]));
  });
});
