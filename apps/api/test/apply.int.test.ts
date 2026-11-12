// SPDX-License-Identifier: AGPL-3.0-only
// Integration: applying, the funder inbox and the approval store over the real schema
// (`supabase start`). Skipped unless SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// SUPABASE_JWT_SECRET are set; CI's integration job exports them and runs `pnpm test:int`.
// Rows are left behind on purpose (the ledger is append-only); every run uses fresh handles.
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore } from "@gms/ledger";
import { MemoryMailer } from "@gms/notify";
import { SupabaseWebhookStore } from "@gms/webhooks";
import { createClient } from "@supabase/supabase-js";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type Deps } from "../src/app.ts";
import { SupabaseAuthStore } from "../src/auth/supabase-store.ts";
import type { Env } from "../src/env.ts";
import { RepoApprovalStore } from "../src/services/mcp-layer.ts";
import { MemoryFileStorage } from "../src/services/ports.ts";
import { RepoMembershipStore } from "../src/services/repos/membership.ts";
import { SupabaseRepos } from "../src/services/repos/supabase.ts";
import { ALDER_ORG, ALDER_PROFILE } from "./scenario.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const run = Math.random().toString(36).slice(2, 10);

describe.skipIf(!URL_ || !KEY || !JWT_SECRET)("applying over Supabase", () => {
  let db: DbClient;
  let repos: SupabaseRepos;
  let app: ReturnType<typeof createApp>;
  let env: Env;
  const mailer = new MemoryMailer();
  const users = { funder: "", applicant: "" };
  const ws = { funder: "", applicant: "" };

  const session = (userId: string) => {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ aal: "aal2", email: `int-${run}@riverbendcf.example`, role: "authenticated" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(JWT_SECRET!));
  };
  async function call<T>(as: "funder" | "applicant", method: string, path: string, body?: unknown): Promise<{ status: number; data: T; body: Record<string, unknown> }> {
    const res = await app.request(`https://gms.test${path}`, { method, headers: { Authorization: `Bearer ${await session(users[as])}`, "Content-Type": "application/json", "X-GMS-Workspace": ws[as] }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, data: json.data as T, body: json };
  }
  const ok = async <T>(as: "funder" | "applicant", method: string, path: string, body?: unknown) => {
    const r = await call<T>(as, method, path, body ?? {});
    expect(r.status, `${method} ${path}: ${String(r.body.message)}`).toBeLessThan(300);
    return r.data;
  };

  beforeAll(async () => {
    db = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DbClient;
    repos = new SupabaseRepos(db);
    for (const who of ["funder", "applicant"] as const) {
      const { data, error } = await db.auth.admin.createUser({ email: `int-apply-${who}-${run}@riverbendcf.example`, email_confirm: true });
      if (error || !data.user) throw new Error(`could not create the test user: ${error?.message}`);
      users[who] = data.user.id;
    }
    ws.funder = (await repos.table("workspaces").insert({ kind: "funder", handle: `int-fund-${run}`, display_name: "Integration Foundation" })).id;
    ws.applicant = (
      await repos.table("workspaces").insert({ kind: "applicant", handle: `int-app-${run}`, display_name: "Alder Creek Family Services", passport_org_id: crypto.randomUUID(), profile_source: "passport", org_projection: ALDER_ORG, org_projection_at: new Date().toISOString(), profile_projection: { level: "L3", fields: ALDER_PROFILE.fields }, verification_level: "L3" })
    ).id;
    await repos.table("workspace_members").insert({ workspace_id: ws.funder, user_id: users.funder, role: "program_officer" });
    await repos.table("workspace_members").insert({ workspace_id: ws.applicant, user_id: users.applicant, role: "admin" });

    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    env = { GMS_BASE_URL: "https://gms.test", WEB_BASE_URL: "https://app.gms.test", OAUTH_ISSUER: "https://gms.test", OAUTH_KID: "int-1", OAUTH_SIGNING_KEY_JWK: JSON.stringify(await exportJWK(privateKey)), SUPABASE_JWT_SECRET: JWT_SECRET!, RESEND_FROM: "OpenGrants GMS <notices@gms.test>" };
    const deps: Deps = { auth: new SupabaseAuthStore(db), members: new RepoMembershipStore(repos), ledger: new SupabaseLedgerStore(db), repos, webhooks: new SupabaseWebhookStore(db), now: () => new Date(), ports: () => ({ mailer, storage: new MemoryFileStorage() }) };
    app = createApp(() => deps);
  });

  it("start with prefill → fill → submit → inbox → revision → decline, on the real schema", { timeout: 120_000 }, async () => {
    const opp = await ok<{ id: string }>("funder", "POST", "/gms/opportunities", {
      title: `Community Health Grants ${run}`,
      description: "Grants for community health navigation.",
      funding: { maxAwardAmount: { amount: "150000.00", currency: "USD" } },
      acceptedApplicantTypes: ["non_profit_with_501c3"],
      eligibilityRules: { all: [{ path: "profile.commonApp.irs.subsection", op: "in", value: ["03"], missing: "unknown", label: "Nonprofit organization" }, { path: "profile.commonApp.financials.budget", op: "lt", value: 5_000_000, missing: "unknown", label: "Budget under $5M" }] },
    });
    const form = await ok<{ id: string }>("funder", "POST", "/gms/forms", {
      title: "Letter of intent",
      purpose: "loi",
      jsonSchema: { type: "object", properties: { legalName: { type: "string" }, projectTitle: { type: "string", minLength: 3 }, requestedAmount: { type: "object", properties: { amount: { type: "string" }, currency: { type: "string" } }, required: ["amount", "currency"] } }, required: ["legalName", "projectTitle", "requestedAmount"] },
      uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } }, { type: "Control", scope: "#/properties/projectTitle" }, { type: "Control", scope: "#/properties/requestedAmount" }] },
      mappingFromCommonGrants: { legalName: { field: "name" } },
      mappingToCommonGrants: { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } },
    });
    await ok("funder", "POST", `/gms/forms/${form.id}/publish`);
    const rubric = await ok<{ id: string }>("funder", "POST", "/gms/rubrics", { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] });
    const comp = await ok<{ id: string }>("funder", "POST", "/gms/competitions", { opportunityId: opp.id, title: "Community Health Grants" });
    const closes = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await ok("funder", "PUT", `/gms/competitions/${comp.id}/stages`, { stages: [{ key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, opens: new Date(Date.now() - 86_400_000).toISOString(), closes, rubricId: rubric.id }] });
    await ok("funder", "POST", `/gms/opportunities/${opp.id}/publish`);
    await ok("funder", "POST", `/gms/competitions/${comp.id}/open`);
    const formUuid = form.id.slice(4);

    const started = await ok<{ id: string; formResponses: Record<string, { response: Record<string, unknown> }>; customFields: { gms: { value: { eligibility: { eligible: unknown } } } } }>("applicant", "POST", "/common-grants/applications/start", { competitionId: comp.id.slice(4) });
    expect(started.formResponses[formUuid]!.response).toEqual({ legalName: "Alder Creek Family Services" });
    expect(started.customFields.gms.value.eligibility.eligible).toBe(true);
    const id = started.id;

    await ok("applicant", "PUT", `/common-grants/applications/${id}/forms/${formUuid}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" } } });
    const comment = await ok<{ id: string; fieldPath: string }>("applicant", "POST", `/gms/my/applications/app_${id}/comments`, { body: "Cite the county assessment?", formId: form.id, fieldPath: "/projectTitle" });
    expect(comment.fieldPath).toBe("/projectTitle");
    await ok("applicant", "POST", `/gms/my/applications/app_${id}/comments/${comment.id}/resolve`);

    const submitted = await ok<{ status: { value: string }; customFields: Record<string, { value: unknown }> }>("applicant", "PUT", `/common-grants/applications/${id}/submit`);
    expect(submitted.status.value).toBe("submitted");
    expect(submitted.customFields.verificationLevel!.value).toBe("L3");
    expect(await repos.table("consents").one({ applicant_workspace_id: ws.applicant, funder_workspace_id: ws.funder, revoked_at: null })).toMatchObject({ basis: "application" });
    expect(mailer.sent.at(-1)!.subject).toContain("We received your application");

    const inbox = await call<never>("funder", "GET", "/gms/applications?eligibility=true&level=L3");
    expect((inbox.body.items as { id: string }[]).map((a) => a.id)).toEqual([`app_${id}`]);

    const revision = await ok<{ status: string }>("funder", "POST", `/gms/applications/app_${id}/request-revision`, { message: "Add a source for the need." });
    expect(revision.status).toBe("revision_requested");
    await ok("applicant", "PUT", `/common-grants/applications/${id}/forms/${formUuid}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families" } });
    await ok("applicant", "PUT", `/common-grants/applications/${id}/submit`);

    const declined = await ok<{ status: string; decisionId: string }>("funder", "POST", `/gms/applications/app_${id}/decline`, { rationale: "Outside this cycle's focus." });
    expect(declined.status).toBe("declined");
    expect(await repos.table("decisions").one({ id: declined.decisionId })).toMatchObject({ outcome: "decline", application_id: id });
    expect(await repos.table("applications").one({ id })).toMatchObject({ status: "declined", cg_status: "rejected", cg_custom_value: null, decision_id: declined.decisionId });

    const events = (await repos.table("application_events").find({ application_id: id }, { orderBy: "created_at" })).map((e) => e.type);
    expect(events).toEqual(["started", "submit", "request_revision", "submit", "decline"]);
    const ledger = (await new SupabaseLedgerStore(db).list({ workspaceId: ws.funder, subjectId: id })).map((e) => e.eventType);
    expect(ledger).toEqual(expect.arrayContaining(["application.started", "application.submit", "application.request_revision", "application.decline"]));
  });

  it("approval store: one caller claims a pending approval, and outcomes fit the schema's checks", async () => {
    const store = new RepoApprovalStore(repos);
    const id = `apr_${crypto.randomUUID()}`;
    const requestedBy = { userId: users.funder, clientId: crypto.randomUUID() };
    await store.create({ id, workspaceId: ws.funder, side: "funder", tool: "decline_application", input: { applicationId: "app_x", rationale: "r" }, requestedBy, status: "pending", createdAt: new Date().toISOString() });
    expect(await store.get(id)).toMatchObject({ status: "pending", side: "funder", requestedBy });
    const decidedAt = new Date().toISOString();
    const claims = await Promise.all([store.transition(id, "pending", { status: "approved", decidedBy: users.funder, decidedAt }), store.transition(id, "pending", { status: "approved", decidedBy: users.funder, decidedAt })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.transition(id, "approved", { status: "failed", error: "The application is already declined." })).toBe(true);
    expect(await store.get(id)).toMatchObject({ status: "failed", error: "The application is already declined.", decidedBy: users.funder });
    expect(await store.get(`apr_${crypto.randomUUID()}`)).toBeNull();
  });
});
