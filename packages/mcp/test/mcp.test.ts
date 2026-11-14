// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";
import {
  APPLICANT_TOOLS,
  createRegistry,
  DEFAULT_GATED_TOOLS,
  Dispatcher,
  FUNDER_TOOLS,
  getPrompt,
  isScope,
  listPrompts,
  listResourceTemplates,
  llmsToolSections,
  MemoryApprovalStore,
  MemoryEvents,
  MemoryKv,
  MemoryLedger,
  NON_BYPASSABLE_TOOLS,
  parseResourceUri,
  protectedResourceMetadata,
  readResource,
  ServiceError,
  type Actor,
  type CallContext,
  type ServiceLayer,
} from "../src/index.ts";

const registry = createRegistry();

interface Call {
  method: string;
  actor: Actor;
  input: unknown;
}

function harness(options: { additionalGatedTools?: string[]; limit?: number; fail?: Record<string, Error> } = {}) {
  const calls: Call[] = [];
  const services = new Proxy(
    {},
    {
      get: (_t, method: string) => async (actor: Actor, input: unknown) => {
        calls.push({ method, actor, input });
        const err = options.fail?.[method];
        if (err) throw err;
        return { method };
      },
    },
  ) as ServiceLayer;
  const approvals = new MemoryApprovalStore();
  const ledger = new MemoryLedger();
  const events = new MemoryEvents();
  let n = 0;
  const dispatcher = new Dispatcher({
    registry,
    services,
    approvals,
    ledger,
    events,
    kv: new MemoryKv(),
    webBaseUrl: "https://gms.example/",
    gatePolicy: () => ({ additionalGatedTools: options.additionalGatedTools }),
    rateLimit: { limit: options.limit ?? 1000, windowSeconds: 60 },
    now: () => new Date("2027-04-16T12:00:00Z"),
    newId: () => `apr_test${++n}`,
  });
  return { dispatcher, calls, approvals, ledger, events };
}

const FUNDER_SCOPES = ["applications:write", "decisions:write", "payments:release", "communications:write", "programs:read", "agreements:write"];
const agent = (over: Partial<CallContext> = {}): CallContext => ({ userId: "u_dana", clientId: "cl_claude", workspaceId: "ws_riverbend", workspaceKind: "funder", scopes: FUNDER_SCOPES, approvalsBypass: false, tokenId: "tok_1", ...over });
const applicantAgent = (over: Partial<CallContext> = {}): CallContext => agent({ userId: "u_maria", workspaceId: "ws_alder", workspaceKind: "applicant", scopes: ["applications:write", "applications:submit", "awards:write", "agreements:write"], ...over });
const human = { userId: "u_dana", workspaceId: "ws_riverbend", workspaceKind: "funder" as const, scopes: FUNDER_SCOPES };

const SPEC_FUNDER = "list_programs get_program list_opportunities get_opportunity create_opportunity update_opportunity publish_opportunity list_competitions get_competition create_competition set_stage_forms set_rubric list_forms get_form create_form update_form set_prefill_mapping list_applications get_application run_eligibility advance_application request_revision decline_application tag_application list_review_assignments assign_reviewer get_scores rank_applications propose_decision commit_decisions list_awards get_award create_award_from_application amend_award close_award generate_agreement send_agreement get_agreement_status list_tranches check_payment_readiness release_tranche record_external_payment list_requirements review_submission accept_submission return_submission send_reminders list_grantees get_grantee get_passport_status list_pending_org_changes accept_org_change portfolio_summary cycle_metrics export_990pf_grant_list draft_letter summarize_application compare_to_rubric get_approval".split(" ");
const SPEC_APPLICANT = "get_my_organization get_passport_readiness find_competitions check_eligibility search_opengrants match_opengrants create_funding_alert list_applications get_application start_application fill_form_response attach_document insert_answer validate_application submit_application withdraw_application list_awards get_award accept_award sign_agreement request_amendment list_requirements draft_submission submit_requirement share_submission_with_funder list_answers save_answer adapt_answer list_messages reply list_outside_applications get_outside_application create_outside_application add_outside_questions put_outside_answer set_outside_stage record_outside_submission record_outside_decision get_approval".split(" ");

describe("registry", () => {
  it("declares every tool named in the spec", () => {
    const funder = registry.list("funder").map((t) => t.name);
    const applicant = registry.list("applicant").map((t) => t.name);
    for (const name of SPEC_FUNDER) expect(funder, name).toContain(name);
    for (const name of SPEC_APPLICANT) expect(applicant, name).toContain(name);
  });

  it("gives every tool a JSON Schema object, a known scope and a description", () => {
    for (const side of ["funder", "applicant"] as const) {
      for (const t of registry.list(side)) {
        expect(t.inputSchema.type, t.name).toBe("object");
        expect(t.inputSchema.$schema, t.name).toBe("https://json-schema.org/draft/2020-12/schema");
        expect(typeof t.inputSchema.properties, t.name).toBe("object");
        expect(isScope(t.scope), t.name).toBe(true);
        expect(t.description.length, t.name).toBeGreaterThan(20);
        expect(() => JSON.stringify(t.inputSchema)).not.toThrow();
      }
    }
  });

  it("maps each tool to a distinct service method per side", () => {
    for (const specs of [FUNDER_TOOLS, APPLICANT_TOOLS]) {
      const methods = Object.values(specs).map((s) => s.service);
      expect(new Set(methods).size).toBe(methods.length);
    }
  });

  it("marks default-gated tools as gated in tools/list, and lets a workspace add gates", () => {
    const plain = registry.describe("funder");
    for (const name of DEFAULT_GATED_TOOLS) {
      const found = [...plain, ...registry.describe("applicant")].find((t) => t.name === name);
      expect(found?.annotations.gated, name).toBe(true);
    }
    expect(plain.find((t) => t.name === "accept_org_change")?.annotations.gated).toBe(false);
    expect(registry.describe("funder", { additionalGatedTools: ["accept_org_change"] }).find((t) => t.name === "accept_org_change")?.annotations.gated).toBe(true);
    expect(plain.find((t) => t.name === "release_tranche")?.annotations.alwaysHuman).toBe(true);
  });

  it("holds quick setup when a workspace gates any tool it stands for", () => {
    const quick = (policy?: { additionalGatedTools: string[] }) => registry.describe("funder", policy).find((t) => t.name === "quick_setup_competition")?.annotations.gated;
    expect(quick()).toBe(false);
    for (const part of ["create_competition", "create_form", "set_stage_forms", "set_rubric", "quick_setup_competition"]) expect(quick({ additionalGatedTools: [part] }), part).toBe(true);
    expect(quick({ additionalGatedTools: ["accept_org_change"] })).toBe(false);
  });
});

describe("dispatch", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("runs an ungated tool and ledgers it with user/client attribution", async () => {
    const res = await h.dispatcher.call(agent(), "list_programs", {});
    expect(res).toEqual({ ok: true, result: { method: "listPrograms" } });
    expect(h.calls[0]?.input).toEqual({ page: 1, pageSize: 100 });
    expect(h.calls[0]?.actor.actor).toBe("user:u_dana/client:cl_claude");
    expect(h.ledger.events).toMatchObject([{ actor: "user:u_dana/client:cl_claude", eventType: "mcp.tool.called", subjectId: "list_programs", workspaceId: "ws_riverbend" }]);
  });

  it("rejects unknown tools and tools from the other side", async () => {
    expect(await h.dispatcher.call(agent(), "drop_tables", {})).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(await h.dispatcher.call(agent(), "submit_application", { applicationId: "app_0000001" })).toMatchObject({ ok: false, error: { code: "wrong_side" } });
    expect(await h.dispatcher.call(applicantAgent(), "release_tranche", { trancheId: "trn_0000001" })).toMatchObject({ ok: false, error: { code: "wrong_side" } });
    expect(h.calls).toHaveLength(0);
  });

  it("checks scope before anything runs; write implies read", async () => {
    expect(await h.dispatcher.call(agent({ scopes: ["programs:read"] }), "tag_application", { applicationId: "app_0000001", add: ["x"] })).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    expect(await h.dispatcher.call(agent({ scopes: ["applications:write"] }), "get_application", { applicationId: "app_0000001" })).toMatchObject({ ok: true });
    // A gated tool without its scope is refused, not queued for approval.
    expect(await h.dispatcher.call(agent({ scopes: [] }), "commit_decisions", { competitionId: "cmp_0000001", decisionIds: ["decision-1"] })).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    expect(h.approvals.rows.size).toBe(0);
  });

  it("validates input and reports field-level issues", async () => {
    const res = await h.dispatcher.call(agent(), "tag_application", { applicationId: "not-an-id" });
    expect(res).toMatchObject({ ok: false, error: { code: "invalid_input", issues: [{ field: "applicationId" }] } });
    expect(h.calls).toHaveLength(0);
  });

  it("maps service errors and hides unexpected ones", async () => {
    const f = harness({ fail: { getProgram: new ServiceError("not_found", "No such program."), listPrograms: new Error("relation programs does not exist") } });
    expect(await f.dispatcher.call(agent(), "get_program", { programId: "program-1" })).toMatchObject({ ok: false, error: { code: "not_found", message: "No such program." } });
    const hidden = await f.dispatcher.call(agent(), "list_programs", {});
    expect(hidden).toMatchObject({ ok: false, error: { code: "service_error" } });
    expect(JSON.stringify(hidden)).not.toContain("relation");
  });

  it("rate limits per token", async () => {
    const r = harness({ limit: 2 });
    expect((await r.dispatcher.call(agent(), "list_programs", {})).ok).toBe(true);
    expect((await r.dispatcher.call(agent(), "list_programs", {})).ok).toBe(true);
    expect(await r.dispatcher.call(agent(), "list_programs", {})).toMatchObject({ ok: false, error: { code: "rate_limited", retryAfterSeconds: 60 } });
    // Another token has its own bucket.
    expect((await r.dispatcher.call(agent({ tokenId: "tok_2" }), "list_programs", {})).ok).toBe(true);
  });
});

describe("human gates", () => {
  const decline = { applicationId: "app_0000001", rationale: "Outside the service area." };

  it("returns pending_approval for a gated tool and does not run it", async () => {
    const h = harness();
    const res = await h.dispatcher.call(agent(), "decline_application", decline);
    expect(res).toEqual({ ok: true, pending: { status: "pending_approval", approvalId: "apr_test1", url: "https://gms.example/approvals/apr_test1" } });
    expect(h.calls).toHaveLength(0);
    expect(h.ledger.events.map((e) => e.eventType)).toEqual(["approval.requested"]);
    expect(h.events.emitted.map((e) => e.type)).toEqual(["approval.requested"]);
    expect(await h.dispatcher.call(agent(), "get_approval", { approvalId: "apr_test1" })).toMatchObject({ ok: true, result: { status: "pending", tool: "decline_application", result: null } });
  });

  it("approve runs the original call exactly once, as the approver", async () => {
    const h = harness();
    await h.dispatcher.call(agent({ userId: "u_agent_owner" }), "decline_application", decline);
    const [first, second] = await Promise.all([h.dispatcher.resolveApproval(human, "apr_test1", "approve"), h.dispatcher.resolveApproval(human, "apr_test1", "approve")]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ method: "declineApplication", input: decline, actor: { actor: "user:u_dana", clientId: null, requestedBy: { userId: "u_agent_owner", clientId: "cl_claude" } } });
    expect(await h.dispatcher.call(agent(), "get_approval", { approvalId: "apr_test1" })).toMatchObject({ ok: true, result: { status: "executed", result: { method: "declineApplication" } } });
    expect(h.ledger.events.at(-1)).toMatchObject({ eventType: "approval.resolved", actor: "user:u_dana", data: { status: "executed", requestedBy: "user:u_agent_owner/client:cl_claude" } });
    expect(await h.dispatcher.resolveApproval(human, "apr_test1", "reject")).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("reject records the decision and never runs the call", async () => {
    const h = harness();
    await h.dispatcher.call(agent(), "decline_application", decline);
    const res = await h.dispatcher.resolveApproval(human, "apr_test1", "reject", "Not yet.");
    expect(res).toMatchObject({ ok: true, approval: { status: "rejected", decidedBy: "u_dana", note: "Not yet." } });
    expect(h.calls).toHaveLength(0);
    expect(await h.dispatcher.resolveApproval(human, "apr_test1", "approve")).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(h.calls).toHaveLength(0);
    expect(h.events.emitted.at(-1)).toMatchObject({ type: "approval.resolved", data: { status: "rejected" } });
  });

  it("records a failed execution without retrying", async () => {
    const h = harness({ fail: { declineApplication: new ServiceError("conflict", "Already declined.") } });
    await h.dispatcher.call(agent(), "decline_application", decline);
    expect(await h.dispatcher.resolveApproval(human, "apr_test1", "approve")).toMatchObject({ ok: true, approval: { status: "failed", error: "Already declined." } });
    expect(h.calls).toHaveLength(1);
  });

  it("only a person in the same workspace with the tool's scope can resolve", async () => {
    const h = harness();
    await h.dispatcher.call(agent(), "decline_application", decline);
    expect(await h.dispatcher.resolveApproval({ ...human, clientId: "cl_claude" }, "apr_test1", "approve")).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await h.dispatcher.resolveApproval({ ...human, workspaceId: "ws_other" }, "apr_test1", "approve")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await h.dispatcher.resolveApproval({ ...human, scopes: ["programs:read"] }, "apr_test1", "approve")).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    expect(await h.dispatcher.call(agent({ workspaceId: "ws_other" }), "get_approval", { approvalId: "apr_test1" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(h.calls).toHaveLength(0);
  });

  it("approvals:bypass lifts bypassable gates only", async () => {
    const h = harness();
    const bypass = agent({ approvalsBypass: true });
    expect(await h.dispatcher.call(bypass, "decline_application", decline)).toMatchObject({ ok: true, result: { method: "declineApplication" } });
    expect(await h.dispatcher.call(bypass, "commit_decisions", { competitionId: "cmp_0000001", decisionIds: ["decision-1"] })).toMatchObject({ ok: true, result: {} });
    expect(await h.dispatcher.call(bypass, "release_tranche", { trancheId: "trn_0000001" })).toMatchObject({ ok: true, pending: { status: "pending_approval" } });
    const a = applicantAgent({ approvalsBypass: true });
    expect(await h.dispatcher.call(a, "sign_agreement", { agreementId: "agr_0000001" })).toMatchObject({ ok: true, pending: { status: "pending_approval" } });
    expect(await h.dispatcher.call(a, "accept_award", { awardId: "awd_0000001" })).toMatchObject({ ok: true, pending: { status: "pending_approval" } });
    expect(await h.dispatcher.call(a, "submit_application", { applicationId: "app_0000001" })).toMatchObject({ ok: true, result: {} });
    expect(h.calls.map((c) => c.method)).toEqual(["declineApplication", "commitDecisions", "submitApplication"]);
    for (const name of NON_BYPASSABLE_TOOLS) expect(DEFAULT_GATED_TOOLS).toContain(name);
  });

  it("a workspace can gate more tools", async () => {
    const h = harness({ additionalGatedTools: ["accept_org_change"] });
    expect(await h.dispatcher.call(agent({ scopes: ["grantees:write"] }), "accept_org_change", { changeId: "change-0001" })).toMatchObject({ ok: true, pending: { status: "pending_approval" } });
    expect(h.calls).toHaveLength(0);
  });

  it("a person in the UI is never gated", async () => {
    const h = harness();
    expect(await h.dispatcher.call(agent({ clientId: null }), "release_tranche", { trancheId: "trn_0000001" })).toMatchObject({ ok: true, result: { method: "releaseTranche" } });
    expect(h.calls[0]?.actor.actor).toBe("user:u_dana");
  });
});

describe("resources, prompts and metadata", () => {
  it("parses gms:// URIs", () => {
    expect(parseResourceUri("gms://application/app_0000001")).toEqual({ kind: "application", id: "app_0000001" });
    expect(parseResourceUri("gms://tranche/trn_1")).toBeNull();
    expect(parseResourceUri("https://gms.example/application/app_1")).toBeNull();
    expect(parseResourceUri("gms://form/../etc")).toBeNull();
    expect(listResourceTemplates().map((t) => t.uriTemplate)).toContain("gms://org/{id}");
  });

  it("reads a resource through the reader with a scope check", async () => {
    const reader = { read: async (_a: Actor, kind: string, id: string) => (id === "awd_0000001" ? { kind, id } : null) };
    const ctx = applicantAgent({ scopes: ["awards:read"] });
    expect(await readResource(ctx, reader, "gms://award/awd_0000001")).toMatchObject({ ok: true, contents: { mimeType: "application/json", text: '{"kind":"award","id":"awd_0000001"}' } });
    expect(await readResource(ctx, reader, "gms://award/awd_0000002")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await readResource(ctx, reader, "gms://application/app_0000001")).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
  });

  it("serves the four prompts on the right side, referencing only that side's tools", () => {
    expect(listPrompts("funder").map((p) => p.name)).toEqual(["triage-cohort", "write-decline-letter"]);
    expect(listPrompts("applicant").map((p) => p.name)).toEqual(["prepare-report", "fill-application-from-passport"]);
    expect(getPrompt("funder", "triage-cohort", {})).toEqual({ error: "Missing required argument(s): competitionId." });
    expect(getPrompt("applicant", "triage-cohort", { competitionId: "cmp_1" })).toHaveProperty("error");
    for (const side of ["funder", "applicant"] as const) {
      const names = new Set(registry.list(side).map((t) => t.name));
      for (const p of listPrompts(side)) {
        const out = getPrompt(side, p.name, Object.fromEntries(p.arguments.map((a) => [a.name, "x"])));
        if ("error" in out) throw new Error(out.error);
        const mentioned = out.messages[0]!.content.text.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
        for (const m of mentioned.filter((x) => x !== "pending_approval")) expect(names.has(m), `${p.name} mentions ${m}`).toBe(true);
      }
    }
  });

  it("builds protected-resource metadata and llms.txt sections", () => {
    expect(protectedResourceMetadata({ gmsBaseUrl: "https://gms.opengrants.io/", issuer: "https://gms.opengrants.io" })).toMatchObject({ resource: "https://gms.opengrants.io/mcp", authorization_servers: ["https://gms.opengrants.io"] });
    const text = llmsToolSections(registry);
    expect(text).toContain("## Funder tools");
    expect(text).toContain("`release_tranche` (payments:release) — always needs a person");
    expect(text).toContain("`commit_decisions` (decisions:write) — needs a person's approval");
    expect(text).toContain("## Human gates");
    expect(llmsToolSections(registry, { full: true })).toContain('"$schema"');
  });
});
