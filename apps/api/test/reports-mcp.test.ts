// SPDX-License-Identifier: AGPL-3.0-only
// The report builder over MCP: an agent lists and runs views through the same service and
// authorization as the UI. It cannot save, share or schedule one: there is no tool for that, and
// the REST routes refuse an agent's token.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import * as reports from "../src/services/report-builder.ts";
import { makeActor, type ServiceContext } from "../src/services/context.ts";
import { scopesForRole } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_FUNDER, harness, type Harness } from "./helpers.ts";

let h: Harness;
let seq = 0;

const agent = (user: string, scope: string) => h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-reports-${++seq}` });
async function rpc(token: string, method: string, params?: Record<string, unknown>) {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
  return (await res.json()) as { result: { structuredContent?: Record<string, unknown>; isError?: boolean; tools?: { name: string; _meta: Record<string, unknown> }[] } };
}
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => (await rpc(token, "tools/call", { name, arguments: args })).result;

const person = (userId: string, role: string): ServiceContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "", webBaseUrl: "", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {}, actor: makeActor("user", userId, null), workspace: { id: WS_FUNDER, kind: "funder", role, memberScope: null }, scopes: scopesForRole("funder", role) });

beforeEach(async () => {
  h = await harness();
  await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, title: "Clinic navigators", status: "active", funding: { awardedAmount: { amount: "1500.00", currency: "USD" } } });
});

describe("report tools", () => {
  it("lists and runs views; there is no tool to save or schedule one", async () => {
    const token = await agent(USER_OFFICER, "analytics:read awards:read");
    const names = (await rpc(token, "tools/list")).result.tools!.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_report_views", "run_report_view"]));
    expect(names.filter((n) => /report/.test(n) && !["list_report_views", "run_report_view"].includes(n))).toEqual([]);
    const shared = await reports.createView(person(USER_OFFICER, "program_officer"), { name: "Awards", visibility: "workspace", definition: reports.definitionInput.parse({ dataSet: "awards", columns: ["title", "amount"] }) });
    const listed = (await tool(token, "list_report_views")).structuredContent as { starters: { id: string }[]; saved: { id: string }[] };
    expect(listed.starters.length).toBe(6);
    expect(listed.saved.map((v) => v.id)).toEqual([shared.id]);
    const ran = (await tool(token, "run_report_view", { viewId: shared.id })).structuredContent as { rows: unknown[][]; columns: { label: string }[] };
    expect(ran.columns.map((c) => c.label)).toEqual(["Award", "Awarded amount"]);
    expect(ran.rows).toEqual([["Clinic navigators", 150_000]]);
    expect((await tool(token, "schedule_report_view", { viewId: shared.id })).isError).toBe(true);
  });

  it("runs only what the person and the token may read", async () => {
    const mine = await reports.createView(person(USER_ADMIN, "admin"), { name: "Mine", visibility: "private", definition: reports.definitionInput.parse({ dataSet: "awards", columns: ["title"] }) });
    const token = await agent(USER_OFFICER, "analytics:read awards:read");
    // Another member's private view is not there for this person's agent.
    expect((await tool(token, "run_report_view", { viewId: mine.id })).structuredContent).toMatchObject({ error: { code: "not_found" } });
    // A payments view needs payments:read on the token as well.
    expect((await tool(token, "run_report_view", { viewId: "starter-payments-due-90" })).structuredContent).toMatchObject({ error: { code: "forbidden" } });
    expect((await tool(await agent(USER_OFFICER, "awards:read"), "list_report_views")).structuredContent).toMatchObject({ error: { code: "insufficient_scope" } });
    // An agent's token cannot save a view over REST either.
    const res = await h.request("/gms/report-views", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Agent view", definition: { dataSet: "awards", columns: ["title"] } }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { errors: { code: string }[] }).errors[0]?.code).toBe("person_required");
  });
});
