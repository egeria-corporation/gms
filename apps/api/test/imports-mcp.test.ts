// SPDX-License-Identifier: AGPL-3.0-only
// Imports and agents: an agent reads a check (dry run) a person made, through MCP
// `get_import_preview` on the same service and authorization as the import screen, and sees the
// reconciliation and the names of the columns left out, never their values. Importing the rows is
// a person's: no MCP tool commits, and agent and API-client tokens are refused on the commit route
// and on the two older direct CSV imports, with the same error.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const USER_APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
/** Made at run time; no file holds such a value. */
const IDENTITY_SHAPED = ["900", "00", "0001"].join("-");
const PIPELINE = ["Grant,Funder,Stage,Ask,Contact ref", `Capacity 2026,Cascade Trust,prospect,"$20,000",${IDENTITY_SHAPED}`, "Bad row,,prospect,lots,", "Summer camp,Pine Fund,prospect,5000,"].join("\n");
const HISTORY = ["Organization,Grant,Amount,Award date", "Alder Creek Family Services,Van route,50000,2024-03-01", "Pine Valley Arts,Murals,12500,2025-01-15"].join("\n");

let h: Harness;
let seq = 0;
type ToolOut = { structuredContent?: Record<string, unknown> };

const person = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const agentToken = (user: string, ws: string, scope: string) => h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-imp-${++seq}` });
const bearerJson = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" });
async function rpc(token: string, method: string, params?: unknown) {
  const res = await h.request("/mcp", { method: "POST", headers: bearerJson(token), body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
  return (await res.json()) as { result: ToolOut & { tools?: { name: string }[] } };
}
const tool = async (token: string, name: string, args: Record<string, unknown>) => (await rpc(token, "tools/call", { name, arguments: args })).result.structuredContent as Record<string, unknown>;
async function preview(who: Record<string, string>, body: unknown): Promise<string> {
  const res = await h.request("/gms/imports/preview", { method: "POST", headers: who, body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { run: { id: string } } }).data.run.id;
}
const commit = (headers: Record<string, string>, runId: string) => h.request(`/gms/imports/runs/${runId}/commit`, { method: "POST", headers });

beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_ADMIN, role: "admin" });
});

describe("an agent and an applicant's import", () => {
  it("reads the check through MCP: the reconciliation and the dropped column's name, not its values", async () => {
    const runId = await preview(await person(USER_APPLICANT_ADMIN, WS_APPLICANT), { target: "outside_applications", source: { kind: "csv", text: PIPELINE, fileName: "pipeline.csv" }, mapping: { title: "Grant", funderName: "Funder", stage: "Stage", askAmount: "Ask" } });
    const token = await agentToken(USER_APPLICANT_ADMIN, WS_APPLICANT, "applications:read applications:write");
    const out = await tool(token, "get_import_preview", { importRunId: runId });
    expect(out).toMatchObject({ id: runId, target: "outside_applications", status: "checked", rowsTotal: 3, reconciliation: { rows: 3, create: 2, error: 1 }, droppedColumns: ["Contact ref"], progress: { toWrite: 2, written: 0 } });
    expect(JSON.stringify(out)).not.toContain(IDENTITY_SHAPED);
    // The same authorization as the screen: a read-only token is refused, and another workspace's run is not found.
    expect(await tool(await agentToken(USER_APPLICANT_ADMIN, WS_APPLICANT, "applications:read"), "get_import_preview", { importRunId: runId })).toMatchObject({ error: { code: "insufficient_scope" } });
    expect(await tool(await agentToken(USER_ADMIN, WS_FUNDER, "workspace:admin"), "get_import_preview", { importRunId: runId })).toMatchObject({ error: { code: "not_found" } });
  });

  it("cannot commit it: no tool does, and the commit route refuses agent and API-client tokens", async () => {
    const admin = await person(USER_APPLICANT_ADMIN, WS_APPLICANT);
    const runId = await preview(admin, { target: "outside_applications", source: { kind: "csv", text: PIPELINE }, mapping: { title: "Grant", funderName: "Funder" } });
    const token = await agentToken(USER_APPLICANT_ADMIN, WS_APPLICANT, "applications:read applications:write");
    const tools = (await rpc(token, "tools/list")).result.tools!.map((t) => t.name);
    expect(tools).toContain("get_import_preview");
    expect(tools.filter((n) => /import/.test(n))).toEqual(["get_import_preview"]);

    const refused = await commit(bearerJson(token), runId);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("human_only");
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(0);
    expect((await h.repos.table("import_runs").one({ id: runId }))!.committed_at).toBeNull();

    // The person imports it.
    expect((await commit(admin, runId)).status).toBe(200);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(2);
  });
});

describe("the two older direct CSV imports", () => {
  const errorOf = async (res: Response) => ({ status: res.status, ...((await res.json()) as { errors: { code: string }[]; message: string }) });
  const OUTSIDE = { csv: "title,funder\nImported grant,Elm Fund", mapping: { title: "title", funderName: "funder" }, dryRun: false };
  const AWARDS = { csv: HISTORY, mapping: { recipientName: "Organization", title: "Grant", awardedAmount: "Amount" }, dryRun: false };
  const outside = (headers: Record<string, string>) => h.request("/gms/outside-applications/import", { method: "POST", headers, body: JSON.stringify(OUTSIDE) });
  const awards = (headers: Record<string, string>) => h.request("/gms/imports/csv", { method: "POST", headers, body: JSON.stringify(AWARDS) });

  it("refuse agent and API-client tokens with the same error as the import wizard's commit, and a person imports", async () => {
    const admin = await person(USER_APPLICANT_ADMIN, WS_APPLICANT);
    const runId = await preview(admin, { target: "outside_applications", source: { kind: "csv", text: PIPELINE }, mapping: { title: "Grant", funderName: "Funder" } });
    const applicantAgent = bearerJson(await agentToken(USER_APPLICANT_ADMIN, WS_APPLICANT, "applications:read applications:write"));
    const funderAgent = bearerJson(await agentToken(USER_ADMIN, WS_FUNDER, "workspace:admin awards:read"));
    const client = { Authorization: `Bearer ${await clientCredentialsToken(h, "workspace:admin")}`, "Content-Type": "application/json" };
    // An API client of the applicant's workspace, holding the scope the route used to accept.
    h.auth.clients.push({ ...h.auth.clients.find((c) => c.grantTypes.includes("client_credentials"))!, id: "applicant-sync", name: "Pipeline sync", workspaceId: WS_APPLICANT, allowedScopes: ["applications:read", "applications:write"] });
    const applicantClient = bearerJson(await h.forge({ sub: "applicant-sync", client_id: "applicant-sync", scope: "applications:read applications:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-imp-${++seq}` }));
    const wizard = await errorOf(await commit(applicantAgent, runId));
    const refusals = [await errorOf(await outside(applicantAgent)), await errorOf(await outside(applicantClient)), await errorOf(await awards(funderAgent)), await errorOf(await awards(client))];
    for (const r of refusals) {
      expect(r.status).toBe(403);
      expect(r.errors[0]!.code, JSON.stringify(r)).toBe("human_only");
      expect(r.message).toBe(wizard.message);
    }
    expect(wizard).toMatchObject({ status: 403, errors: [{ code: "human_only" }] });
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(0);
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(0);
    // People still import.
    expect((await outside(admin)).status).toBe(200);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(1);
    expect((await awards(await person(USER_ADMIN, WS_FUNDER))).status).toBe(200);
  });
});

describe("an agent and a funder's grant history", () => {
  it("reads the check with the admin's workspace:admin grant, and cannot commit it", async () => {
    const admin = await person(USER_ADMIN, WS_FUNDER);
    const runId = await preview(admin, { target: "award_history", source: { kind: "csv", text: HISTORY }, mapping: { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date" } });
    const token = await agentToken(USER_ADMIN, WS_FUNDER, "workspace:admin awards:read");
    expect(await tool(token, "get_import_preview", { importRunId: runId })).toMatchObject({ id: runId, target: "award_history", reconciliation: { rows: 2, create: 2 }, droppedColumns: [] });
    const refused = await commit(bearerJson(token), runId);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("human_only");
    // An API client holding workspace:admin is refused too.
    const client = await clientCredentialsToken(h, "workspace:admin");
    expect((await commit({ Authorization: `Bearer ${client}`, "Content-Type": "application/json" }, runId)).status).toBe(403);
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(0);
    expect((await commit(admin, runId)).status).toBe(200);
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(2);
  });
});
