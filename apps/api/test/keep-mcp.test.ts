// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's MCP tools for write faster and keep it: the UI's capabilities over the same
// services. Drafts never save; recording a report's submission always waits for a person.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let seq = 0;
type ToolOut = { structuredContent?: Record<string, unknown> };

const agent = (scope: string) => h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-keep-${++seq}` });
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }) });
  return ((await res.json()) as { result: ToolOut }).result.structuredContent as Record<string, unknown>;
}
async function list(token: string) {
  const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/list" }) });
  return ((await res.json()) as { result: { tools: { name: string; _meta: Record<string, unknown> }[] } }).result.tools;
}
const data = async <T>(method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T }>(s.applicant, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("write faster tools", () => {
  it("drafts and reads guidelines without saving anything", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    const token = await agent("applications:read applications:write library:read assist");
    const oa = await data<{ id: string }>("POST", "/gms/outside-applications", { title: "Clinics", funderName: "Northwind" });
    const [q] = await data<{ id: string }[]>("POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Describe the need." });
    h.llmAnswer.value = { draft: "Families travel far.", usedAnswerIds: [], unknowns: [], staleFlags: [] };
    expect(await tool(token, "draft_outside_answer", { questionId: q!.id })).toMatchObject({ draft: "Families travel far.", saved: false });
    expect(await h.repos.table("outside_answers").count({ question_id: q!.id })).toBe(0);
    h.llmAnswer.value = { questions: [{ prompt: "Budget?", limitKind: "words", limitValue: 100, phase: "full" }], requiredDocuments: ["Audit"], deadlines: { loiDue: null, fullDue: null }, cautions: [] };
    expect(await tool(token, "read_funder_guidelines", { outsideApplicationId: oa.id, text: "1. Budget? (100 words). Attach your audit." })).toMatchObject({ questions: [{ prompt: "Budget?", limitValue: 100 }], requiredDocuments: [{ label: "Audit", docType: "audit" }], saved: false });
    expect(await h.repos.table("outside_questions").count({ outside_application_id: oa.id })).toBe(1);
    // Without the assist scope the draft is refused.
    expect(await tool(await agent("applications:read applications:write library:read"), "draft_outside_answer", { questionId: q!.id })).toMatchObject({ error: { code: "insufficient_scope" } });
  });

  it("verifies library answers, lists the vault and decides go/no-go like the UI", async () => {
    const token = await agent("applications:read applications:write library:read library:write org:read");
    const a = await data<{ id: string }>("POST", "/gms/my/answers", { title: "Mission", body: "We connect rural families to care." });
    expect(await tool(token, "verify_answer", { answerId: a.id })).toMatchObject({ verification: { state: "verified" } });
    expect(await tool(token, "list_vault_documents", {})).toMatchObject({ documents: [] });
    await data("PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { goNoGoEnabled: true } });
    const oa = await data<{ id: string }>("POST", "/gms/outside-applications", { title: "Clinics", funderName: "Northwind", stage: "prospect" });
    await data("POST", `/gms/outside-applications/${oa.id}/stage`, { to: "deciding" });
    expect(await tool(token, "decide_go_no_go", { outsideApplicationId: oa.id, eligibility: "pass", scores: { fit: 4, capacity: 4, effort: 3, relationship: 2 }, decision: "go", to: "drafting" })).toMatchObject({ stage: "drafting" });
  });
});

describe("keep it tools", () => {
  it("adds obligations and holds a report's submission for a person, even with approvals:bypass", async () => {
    const token = await agent("applications:read applications:write approvals:bypass");
    const oa = await data<{ id: string }>("POST", "/gms/outside-applications", { title: "Clinics", funderName: "Northwind" });
    await data("POST", `/gms/outside-applications/${oa.id}/submit`, { submittedAt: "2027-01-10", method: "portal" });
    await data("POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "10000.00", currency: "USD" }, grantEnd: "2028-12-31" });
    const report = (await tool(token, "add_obligation", { outsideApplicationId: oa.id, kind: "report", title: "Final report", dueOn: "2028-12-31" })) as { id: string; status: string };
    expect(report.status).toBe("upcoming");
    const pending = (await tool(token, "record_report_submission", { obligationId: report.id, submittedAt: "2027-04-15", confirmationRef: "NW-9" })) as { status: string; approvalId: string };
    expect(pending.status).toBe("pending_approval");
    expect((await h.repos.table("outside_obligations").one({ id: report.id }))!.status).toBe("upcoming");
    const approved = await s.call<{ data: { status: string } }>(s.applicant, "POST", `/gms/approvals/${pending.approvalId}/decision`, { approve: true });
    expect(approved.body.data.status).toBe("executed");
    expect(await h.repos.table("outside_obligations").one({ id: report.id })).toMatchObject({ status: "submitted", confirmation_ref: "NW-9" });
    expect(await tool(token, "set_obligation_status", { obligationId: report.id, to: "done" })).toMatchObject({ status: "done" });
    expect(await tool(token, "close_out_award", { outsideApplicationId: oa.id })).toMatchObject({ stage: "awarded" });
    expect(await tool(token, "get_outside_award", { outsideApplicationId: oa.id })).toMatchObject({ label: "Outside award", closeout: { closedOutAt: expect.any(String) } });
    expect(await tool(token, "get_funding_summary", {})).toMatchObject({ years: [expect.objectContaining({ awarded: 1 })] });
  });

  it("lists the new tools, with only the report submission held for a person", async () => {
    const tools = await list(await agent("applications:read applications:write assist library:read library:write org:read discovery"));
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ["draft_outside_answer", "read_funder_guidelines", "library_for_question", "verify_answer", "list_vault_documents", "use_vault_document", "decide_go_no_go", "comment_on_question", "create_milestones", "get_outside_award", "add_obligation", "set_obligation_status", "close_out_award", "get_funding_summary", "alert_on_next_cycle"]) expect(byName.get(name)?._meta["gms/gated"], name).toBe(false);
    expect(byName.get("record_report_submission")?._meta).toEqual(expect.objectContaining({ "gms/gated": true, "gms/alwaysHuman": true }));
    // No tool uploads to the vault or reads its files, and none moves money.
    expect(tools.filter((t) => /vault/.test(t.name)).map((t) => t.name).sort()).toEqual(["list_vault_documents", "use_vault_document"]);
  });
});
