// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's MCP tools for outside applications: the UI's capabilities over the same services,
// with recording a submission or a decision always waiting for a person, and no consulting tool.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let seq = 0;
type ToolOut = { structuredContent?: Record<string, unknown>; isError?: boolean };

const agent = (scope: string) => h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-oa-${++seq}` });
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }) });
  return ((await res.json()) as { result: ToolOut }).result.structuredContent as Record<string, unknown>;
}
async function list(token: string) {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/list" }) });
  return ((await res.json()) as { result: { tools: { name: string; _meta: Record<string, unknown> }[] } }).result.tools;
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("outside application tools", () => {
  it("creates, adds questions from text, answers and moves stages like the UI", async () => {
    const token = await agent("applications:read applications:write library:read");
    const made = (await tool(token, "create_outside_application", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-05-01", askAmount: { amount: "50000.00", currency: "USD" } })) as { created: boolean; application: { id: string; stage: string } };
    expect(made).toMatchObject({ created: true, application: { stage: "drafting" } });
    const id = made.application.id;
    const added = (await tool(token, "add_outside_questions", { outsideApplicationId: id, text: "1. Describe the need. (250 words)\n2. Budget narrative, max 1,500 characters" })) as { questions: { id: string; limit: { kind: string; value: number } }[] };
    expect(added.questions.map((q) => q.limit)).toEqual([{ kind: "words", value: 250 }, { kind: "chars", value: 1500 }]);
    const answer = (await tool(token, "put_outside_answer", { questionId: added.questions[0]!.id, body: "Families travel 46 miles." })) as { provenance: string; counts: { words: number } };
    expect(answer).toMatchObject({ provenance: `agent:${CLIENT_AGENT}`, counts: { words: 4 } });
    expect(await tool(token, "set_outside_stage", { outsideApplicationId: id, to: "withdrawn" })).toMatchObject({ stage: "withdrawn" });
    const listed = (await tool(token, "list_outside_applications", {})) as { items: { id: string }[]; total: number };
    expect(listed).toMatchObject({ total: 1, items: [{ id }] });
    expect(await tool(token, "get_outside_application", { outsideApplicationId: id })).toMatchObject({ id, questionCounts: { total: 2, approved: 0 } });
    expect(await tool(token, "set_outside_stage", { outsideApplicationId: "not-a-uuid", to: "drafting" })).toMatchObject({ error: { code: "not_found" } });
  });

  it("holds the submission and the decision for a person, even with approvals:bypass, and runs them as that person", async () => {
    const token = await agent("applications:read applications:write approvals:bypass");
    const id = ((await tool(token, "create_outside_application", { title: "Rural clinics 2027", funderName: "Northwind" })) as { application: { id: string } }).application.id;
    const pending = (await tool(token, "record_outside_submission", { outsideApplicationId: id, submittedAt: "2027-04-15", method: "portal", confirmationRef: "NW-1" })) as { status: string; approvalId: string };
    expect(pending.status).toBe("pending_approval");
    expect((await h.repos.table("outside_applications").one({ id }))!.stage).toBe("drafting");
    const approved = await s.call<{ data: { status: string } }>(s.applicant, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: true });
    expect(approved.body.data.status).toBe("executed");
    expect((await h.repos.table("outside_applications").one({ id }))).toMatchObject({ stage: "submitted", submission_method: "portal", confirmation_ref: "NW-1" });
    const decision = (await tool(token, "record_outside_decision", { outsideApplicationId: id, outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" } })) as { status: string; approvalId: string };
    expect(decision.status).toBe("pending_approval");
    await s.call(s.applicant, "POST", `/gms/approvals/${decision.approvalId}/decision`, { approve: true });
    expect((await h.repos.table("outside_applications").one({ id }))).toMatchObject({ stage: "awarded", awarded_amount_minor: 4_000_000 });
    // The ledger records the person who approved, with the agent that asked.
    expect(h.ledger.events.find((e) => e.eventType === "outside_application.decided")!.actor).toBe(`user:${USER_APPLICANT}`);
  });

  it("lists the tools with the two recorders always human, and no consulting tool", async () => {
    const tools = await list(await agent("applications:read applications:write"));
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ["list_outside_applications", "get_outside_application", "create_outside_application", "add_outside_questions", "put_outside_answer", "set_outside_stage"]) expect(byName.get(name)?._meta["gms/gated"], name).toBe(false);
    for (const name of ["record_outside_submission", "record_outside_decision"]) expect(byName.get(name)?._meta).toEqual(expect.objectContaining({ "gms/gated": true, "gms/alwaysHuman": true }));
    expect(tools.filter((t) => /consult/.test(t.name))).toEqual([]);
  });

  it("keeps the outside tools away from a funder token", async () => {
    const funderAgent = await h.forge({ sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", client_id: CLIENT_AGENT, scope: "applications:read applications:write", jti: "tok-funder-oa" });
    expect(await tool(funderAgent, "list_outside_applications", {})).toMatchObject({ error: { code: "wrong_side" } });
  });
});
