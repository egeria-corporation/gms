// SPDX-License-Identifier: AGPL-3.0-only
// The MCP endpoint: discovery on 401, JSON-RPC over POST, tools through the service layer, and
// the human gate resolved by a person in /gms/approvals.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { AGENT_REDIRECT, CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, VERIFIER, WEB, WS_APPLICANT, WS_FUNDER, authorizeAs, bearer, clientCredentialsToken, form, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let appUuid: string;
let agent: string; // a real delegated token from the authorization code flow (funder, program officer)

const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." };

interface Rpc<T = Record<string, unknown>> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}
interface ToolOut {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

let seq = 0;
async function rpc<T = Record<string, unknown>>(token: string, method: string, params?: unknown): Promise<{ status: number; body: Rpc<T> }> {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params === undefined ? {} : { params }) }) });
  return { status: res.status, body: (await res.json()) as Rpc<T> };
}
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => (await rpc<ToolOut>(token, "tools/call", { name, arguments: args })).body.result!;

const applicantAgent = (scope: string) => h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-applicant-agent" });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appUuid = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: COMPLETE });
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`);
  h.mailer.sent.length = 0;

  const { decision } = await authorizeAs(h, USER_OFFICER, { scope: "applications:read applications:write" });
  const code = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
  const res = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
  agent = ((await res.json()) as { access_token: string }).access_token;
});

describe("transport and auth", () => {
  it("answers 401 with the protected-resource metadata pointer", async () => {
    const res = await h.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer resource_metadata="https://gms.test/.well-known/oauth-protected-resource"');
  });

  it("is stateless: GET is not allowed, and a client-credentials token has no person to act for", async () => {
    expect((await h.request("/mcp", { headers: bearer(agent).headers })).status).toBe(405);
    const res = await h.request("/mcp", { method: "POST", headers: { ...bearer(await clientCredentialsToken(h)).headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(res.status).toBe(403);
  });

  it("initializes, pings, accepts notifications and rejects unknown methods", async () => {
    const init = await rpc<{ protocolVersion: string; capabilities: Record<string, unknown>; serverInfo: { name: string } }>(agent, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "opengrants-gms" } });
    expect(Object.keys(init.body.result!.capabilities)).toEqual(["tools", "resources", "prompts"]);
    expect((await rpc(agent, "ping")).body.result).toEqual({});
    const note = await h.request("/mcp", { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    expect((await rpc(agent, "nope/nothing")).body.error).toMatchObject({ code: -32601 });
    const bad = await h.request("/mcp", { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json" }, body: "{not json" });
    expect(((await bad.json()) as Rpc).error).toMatchObject({ code: -32700 });
  });

  it("lists the side's tools with schemas and gate marks, plus resources and prompts", async () => {
    const tools = (await rpc<{ tools: { name: string; inputSchema: { type: string }; _meta: Record<string, unknown> }[] }>(agent, "tools/list")).body.result!.tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_applications", "decline_application", "release_tranche", "get_approval"]));
    expect(names).not.toContain("start_application");
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.find((t) => t.name === "decline_application")!._meta).toMatchObject({ "gms/gated": true, "gms/alwaysHuman": false });
    expect(tools.find((t) => t.name === "release_tranche")!._meta).toMatchObject({ "gms/alwaysHuman": true });
    expect((await rpc<{ resourceTemplates: unknown[] }>(agent, "resources/templates/list")).body.result!.resourceTemplates.length).toBeGreaterThan(3);
    expect((await rpc<{ prompts: { name: string }[] }>(agent, "prompts/list")).body.result!.prompts.map((p) => p.name)).toContain("triage-cohort");
  });
});

describe("funder agent", () => {
  it("lists and reads applications through the same services as the UI", async () => {
    const list = await tool(agent, "list_applications", { eligibility: "eligible", minVerificationLevel: "L2" });
    expect(list.isError).toBe(false);
    expect(list.structuredContent).toMatchObject({ total: 1, items: [{ id: `app_${appUuid}`, status: "submitted" }] });
    expect((await tool(agent, "list_applications", { minVerificationLevel: "L3", eligibility: "ineligible" })).structuredContent).toMatchObject({ total: 0 });
    const one = await tool(agent, "get_application", { applicationId: `app_${appUuid}` });
    expect(one.structuredContent).toMatchObject({ title: COMPLETE.projectTitle, applicant: { name: "Alder Creek Family Services" } });
    const resource = await rpc<{ contents: { uri: string; text: string }[] }>(agent, "resources/read", { uri: `gms://application/app_${appUuid}` });
    expect(JSON.parse(resource.body.result!.contents[0]!.text)).toMatchObject({ id: appUuid, status: { value: "submitted" } });
    // Every call is attributed to the person and the client.
    const calls = h.ledger.events.filter((e) => e.eventType === "mcp.tool.called");
    expect(calls.length).toBe(3);
    expect(calls[0]!.actor).toBe(`user:${USER_OFFICER}/client:${CLIENT_AGENT}`);
  });

  it("reports scope, input and not-yet-available errors as tool errors", async () => {
    const noScope = await tool(agent, "list_programs");
    expect(noScope).toMatchObject({ isError: true, structuredContent: { error: { code: "insufficient_scope" } } });
    const badInput = await tool(agent, "get_application", { applicationId: "nope" });
    expect(badInput.structuredContent).toMatchObject({ error: { code: "invalid_input" } });
    const other = await tool(agent, "get_application", { applicationId: "app_0190a000-0000-7000-8000-00000000ffff" });
    expect(other.structuredContent).toMatchObject({ error: { code: "not_found" } });
    const wrongSide = await tool(agent, "start_application", { competitionId: s.compId });
    expect(wrongSide.structuredContent).toMatchObject({ error: { code: "wrong_side" } });
  });

  it("parks a decline for a person; approving runs it once as the approver and sends the letter", async () => {
    const out = await tool(agent, "decline_application", { applicationId: `app_${appUuid}`, rationale: "Outside this cycle's focus." });
    expect(out.isError).toBe(false);
    const pending = out.structuredContent as { status: string; approvalId: string; url: string };
    expect(pending.status).toBe("pending_approval");
    expect(pending.url).toBe(`${WEB}/approvals/${pending.approvalId}`);
    // Nothing happened yet.
    expect((await h.repos.table("applications").one({ id: appUuid }))!.status).toBe("submitted");
    expect(h.mailer.sent).toHaveLength(0);
    expect((await tool(agent, "get_approval", { approvalId: pending.approvalId })).structuredContent).toMatchObject({ status: "pending" });

    const list = await s.call<{ items: { id: string; tool: string; status: string; requestedBy: { clientId: string } }[] }>(s.funder, "GET", "/gms/approvals?status=pending");
    expect(list.body.items).toEqual([expect.objectContaining({ id: pending.approvalId, tool: "decline_application", status: "pending", requestedBy: { userId: USER_OFFICER, clientId: CLIENT_AGENT } })]);

    // Who may read it: the people who could approve it, admins and auditors, and the agent that asked.
    // A reviewer (no decisions scope) and another agent see nothing; a guess answers 404.
    const reviewerId = "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: reviewerId, role: "reviewer" });
    const reviewer = { ...bearer(await h.session(reviewerId)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    expect((await s.call<{ items: unknown[] }>(reviewer, "GET", "/gms/approvals")).body.items).toEqual([]);
    expect((await s.call(reviewer, "GET", `/gms/approvals/${pending.approvalId}`)).status).toBe(404);
    const auditorRead = { ...bearer(await h.session(USER_AUDITOR)).headers, "X-GMS-Workspace": WS_FUNDER };
    expect((await s.call<{ items: unknown[] }>(auditorRead, "GET", "/gms/approvals")).body.items).toHaveLength(1);
    expect((await h.request(`/gms/approvals/${pending.approvalId}`, { headers: bearer(agent).headers })).status).toBe(200);
    expect((await h.request("/gms/approvals", { headers: bearer(agent).headers })).status).toBe(403);
    const otherAgent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "applications:read", [WORKSPACE_CLAIM]: WS_FUNDER });
    expect((await h.request(`/gms/approvals/${pending.approvalId}`, { headers: bearer(otherAgent).headers })).status).toBe(404);

    // An agent cannot approve its own request, and a role without the scope cannot either.
    const self = await h.request(`/gms/approvals/${pending.approvalId}/decision`, { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json" }, body: JSON.stringify({ approve: true }) });
    expect(self.status).toBe(403);
    const auditor = { ...bearer(await h.session(USER_AUDITOR)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    expect((await s.call(auditor, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: true })).status).toBe(403);

    const ok = await s.call<{ data: { status: string; decidedBy: string } }>(s.funder, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: true, note: "Agreed" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "executed", decidedBy: USER_OFFICER });
    expect((await h.repos.table("applications").one({ id: appUuid }))!.status).toBe("declined");
    expect(h.mailer.sent).toHaveLength(1);
    // The decline itself is ledgered under the person who approved it.
    expect(h.ledger.events.find((e) => e.eventType === "application.decline")!.actor).toBe(`user:${USER_OFFICER}`);
    expect((await tool(agent, "get_approval", { approvalId: pending.approvalId })).structuredContent).toMatchObject({ status: "executed" });
    // Resolved once.
    expect((await s.call(s.funder, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: true })).status).toBe(409);
  });

  it("rejecting an approval changes nothing", async () => {
    const pending = (await tool(agent, "decline_application", { applicationId: `app_${appUuid}`, rationale: "No." })).structuredContent as { approvalId: string };
    const r = await s.call<{ data: { status: string } }>(s.funder, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: false });
    expect(r.body.data.status).toBe("rejected");
    expect((await h.repos.table("applications").one({ id: appUuid }))!.status).toBe("submitted");
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("rate-limits a token", async () => {
    const hot = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "applications:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-hot" });
    const call = () => tool(hot, "get_approval", { approvalId: "apr_0190a000-0000-7000-8000-00000000ffff" });
    for (let i = 0; i < 120; i++) await call();
    expect((await call()).structuredContent).toMatchObject({ error: { code: "rate_limited" } });
    // Another token is unaffected.
    expect((await tool(agent, "get_approval", { approvalId: "apr_0190a000-0000-7000-8000-00000000ffff" })).structuredContent).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("applicant agent", () => {
  it("starts, fills, validates and has submit held for a person", async () => {
    // A fresh applicant workspace state: withdraw the submitted one so the agent starts its own.
    await s.call(s.applicant, "POST", `/gms/my/applications/app_${appUuid}/withdraw`);
    const token = await applicantAgent("applications:read applications:write applications:submit org:read discovery library:read library:write");

    expect((await tool(token, "get_my_organization")).structuredContent).toMatchObject({ level: "L3", displayName: "Alder Creek Family Services" });
    const found = (await tool(token, "find_competitions", { eligibleOnly: true })).structuredContent as { items: { competitionId: string }[] };
    expect(found.items).toHaveLength(1);

    const started = (await tool(token, "start_application", { competitionId: s.compId })).structuredContent as { id: string; formResponses: Record<string, { response: Record<string, unknown> }> };
    expect(started.formResponses[s.uuid.loi]!.response.legalName).toBe("Alder Creek Family Services");
    const id = `app_${started.id}`;

    const early = (await tool(token, "validate_application", { applicationId: id })).structuredContent as { ready: boolean };
    expect(early.ready).toBe(false);

    const filled = (await tool(token, "fill_form_response", { applicationId: id, formId: s.loiFormId, response: { projectTitle: COMPLETE.projectTitle, requestedAmount: COMPLETE.requestedAmount } })).structuredContent as { customFields: { gms: { value: { provenance: Record<string, string> } } } };
    // What the agent wrote is marked as the agent's.
    expect(filled.customFields.gms.value.provenance["/projectTitle"]).toBe(`agent:${CLIENT_AGENT}`);

    const answer = (await tool(token, "save_answer", { title: "Need statement", body: "Families travel 46 miles to reach primary care." })).structuredContent as { id: string };
    await tool(token, "insert_answer", { applicationId: id, formId: s.loiFormId, field: "need", answerId: answer.id });
    const ready = (await tool(token, "validate_application", { applicationId: id })).structuredContent as { ready: boolean; eligibility: { eligible: unknown } };
    expect(ready).toMatchObject({ ready: true, eligibility: { eligible: true } });

    const submit = (await tool(token, "submit_application", { applicationId: id })).structuredContent as { status: string; approvalId: string };
    expect(submit.status).toBe("pending_approval");
    expect((await h.repos.table("applications").one({ id: started.id }))!.status).toBe("draft");

    const approved = await s.call<{ data: { status: string } }>(s.applicant, "POST", `/gms/approvals/${submit.approvalId}/decision`, { approve: true });
    expect(approved.body.data.status).toBe("executed");
    expect((await h.repos.table("applications").one({ id: started.id }))!.status).toBe("submitted");
    expect((await h.repos.table("approvals").one({ workspace_id: WS_APPLICANT }))).toMatchObject({ side: "applicant", status: "executed" });
  });

  it("keeps funder tools away from an applicant token", async () => {
    const token = await applicantAgent("applications:read applications:write");
    expect((await tool(token, "decline_application", { applicationId: `app_${appUuid}`, rationale: "x" })).structuredContent).toMatchObject({ error: { code: "wrong_side" } });
  });
});

describe("agent docs", () => {
  it("generates the tool list and gate marks from the registry", async () => {
    const txt = await (await h.request("/llms.txt")).text();
    expect(txt).toContain("decline_application");
    expect(txt).toContain("fill_form_response");
    const full = await (await h.request("/llms-full.txt")).text();
    expect(full).toContain("`release_tranche` (payments:release) — always needs a person");
    expect(full).toContain('"$schema"');
  });
});

describe("release_tranche without facilitated payments", () => {
  it("answers the same refusal as the REST route and files no approval", async () => {
    h.env.PAYMENTS_FACILITATED = "false";
    const token = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "payments:read payments:release", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-release-off" });
    const out = await tool(token, "release_tranche", { trancheId: "trn_00000000-0000-4000-8000-000000000000" });
    expect(out.isError).toBe(true);
    expect(out.structuredContent).toMatchObject({ error: { code: "conflict" } });
    expect(JSON.stringify(out.structuredContent)).toContain("facilitated_payments_disabled");
    expect(await h.repos.table("approvals").count({})).toBe(0);
  });
});
