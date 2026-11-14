// SPDX-License-Identifier: AGPL-3.0-only
// Quick setup (v1.4.0): from a published opportunity to one that can open for applications, through
// the same services as the screens. Reuse on a second run, the launch checklist unchanged, gates held.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const as = async (h: Harness, userId: string, workspaceId = WS_FUNDER): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": workspaceId });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const errorCode = async (res: Response) => ((await res.json()) as { errors: { code: string }[] }).errors[0]!.code;

const OPP = {
  title: "The Fund",
  description: "General operating support for community organizations in Riverbend County.",
  funding: { minAwardAmount: { amount: "5000.00", currency: "USD" }, maxAwardAmount: { amount: "25000.00", currency: "USD" } },
  keyDates: { postDate: { name: "Opens", eventType: "singleDate", date: "2027-04-01" }, closeDate: { name: "Closes", eventType: "singleDate", date: "2027-06-30" } },
  acceptedApplicantTypes: ["non_profit_with_501c3"],
};

interface Setup {
  competition: { id: string; status: string; stages: { key: string; label: string; opens: string | null; closes: string | null; rubricId: string | null; forms: Record<string, number> }[] };
  form: { id: string; version: number; title: string } | null;
  rubric: { id: string; version: number; name: string } | null;
  created: { competition: boolean; form: boolean; rubric: boolean };
  checklist: { ready: boolean; items: { key: string; state: string; fixHref: string | null }[] };
}

async function published(h: Harness, who: H, over: Record<string, unknown> = {}) {
  const opp = await data<{ id: string; slug: string }>(await h.request("/gms/opportunities", json(who, { ...OPP, ...over })));
  expect((await h.request(`/gms/opportunities/${opp.id}/publish`, json(who, {}))).status).toBe(200);
  return opp;
}
const quickSetup = (h: Harness, who: H, oppId: string) => h.request(`/gms/opportunities/${oppId}/quick-setup`, json(who, {}));

describe("quick setup", () => {
  it("makes a one-stage competition, a published starter form and a starter rubric that pass the launch checklist", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);

    const res = await quickSetup(h, officer, opp.id);
    expect(res.status).toBe(200);
    const out = await data<Setup>(res);
    expect(out.created).toEqual({ competition: true, form: true, rubric: true });
    expect(out.competition.status).toBe("draft");
    expect(out.competition.stages).toHaveLength(1);
    expect(out.competition.stages[0]).toMatchObject({ key: "application", label: "Application", opens: "2027-04-01T00:00:00Z", closes: "2027-06-30T23:59:59Z", rubricId: out.rubric!.id, forms: { [out.form!.id]: 1 } });
    expect(out.checklist.ready).toBe(true);
    expect(out.checklist.items.every((i) => i.state === "pass")).toBe(true);

    // The form is published, holds the starter questions, and is the pinned version.
    const form = await data<{ status: string; title: string; purpose: string; jsonSchema: { properties: Record<string, { title: string }> }; uiSchema: unknown }>(await h.request(`/gms/forms/${out.form!.id}`, { headers: officer }));
    expect(form).toMatchObject({ status: "published", title: "The Fund application", purpose: "application" });
    expect(Object.values(form.jsonSchema.properties).map((p) => p.title)).toEqual(["Project title", "Project summary", "Amount requested", "How the funds will be used", "Expected outcomes", "Budget", "Contact name", "Contact email", "Contact phone"]);
    expect(JSON.stringify(form.uiSchema)).toContain('"widget":"fileRef"');

    const rubrics = await (await h.request("/gms/rubrics", { headers: officer })).json() as { items: { id: string; name: string; criteria: { label: string; scale: { min: number; max: number } }[] }[] };
    const rubric = rubrics.items.find((r) => r.id === out.rubric!.id)!;
    expect(rubric.name).toBe("The Fund rubric");
    expect(rubric.criteria.map((c) => c.label)).toEqual(["Alignment with the opportunity", "Feasibility", "Budget", "Community impact"]);
    expect(rubric.criteria.every((c) => c.scale.min === 1 && c.scale.max === 5)).toBe(true);

    // Opening goes through the existing, workflow-guarded route; the public page then lists it.
    const opened = await h.request(`/gms/competitions/${out.competition.id}/open`, { method: "POST", headers: officer });
    expect(await data<{ status: string }>(opened)).toMatchObject({ status: "open" });
    const page = await data<{ competitions: { status: string }[] }>(await h.request(`/gms/public/funders/riverbend/opportunities/${opp.slug}`));
    expect(page.competitions.map((c) => c.status)).toEqual(["open"]);
    expect(h.ledger.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["competition.created", "form.created", "form.published", "rubric.created", "competition.stages_set", "competition.quick_setup", "competition.opened"]));
  });

  it("reuses what it made when run again, and changes nothing", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const first = await data<Setup>(await quickSetup(h, officer, opp.id));
    const events = h.ledger.events.length;

    const second = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(second.created).toEqual({ competition: false, form: false, rubric: false });
    expect(second.competition.id).toBe(first.competition.id);
    expect(second.form).toEqual(first.form);
    expect(second.rubric).toEqual(first.rubric);
    expect(h.ledger.events.length).toBe(events);
    expect(await h.repos.table("competitions").find({ opportunity_id: opp.id.replace(/^opp_/, "") })).toHaveLength(1);
    expect(await h.repos.table("forms").find({ workspace_id: WS_FUNDER })).toHaveLength(1);
    expect(await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER })).toHaveLength(1);

    // Once open, a run reports the open competition and leaves it alone.
    await h.request(`/gms/competitions/${first.competition.id}/open`, { method: "POST", headers: officer });
    const third = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(third).toMatchObject({ competition: { id: first.competition.id, status: "open" }, created: { competition: false, form: false, rubric: false } });
  });

  it("finds its own form again when an earlier run stopped before pinning it", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const first = await data<Setup>(await quickSetup(h, officer, opp.id));
    // The stage loses its form (as if the run had stopped before saving the stages).
    await h.request(`/gms/competitions/${first.competition.id}/stages`, json(officer, { stages: [{ ...first.competition.stages[0], forms: {} }] }, "PUT"));
    const again = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(again.created.form).toBe(false);
    expect(again.form).toEqual(first.form);
  });

  it("keeps what the funder already set and fills only the gaps", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const comp = await data<{ id: string }>(await h.request("/gms/competitions", json(officer, { opportunityId: opp.id, title: "Spring round" })));
    await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages: [{ key: "loi", label: "Letter of intent", forms: {}, closes: "2027-05-15T23:59:59Z" }] }, "PUT"));

    const out = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(out.created.competition).toBe(false);
    expect(out.competition.id).toBe(comp.id);
    // The funder's stage, name and closing date stay; the opening date, form and rubric are added.
    expect(out.competition.stages[0]).toMatchObject({ key: "loi", label: "Letter of intent", opens: "2027-04-01T00:00:00Z", closes: "2027-05-15T23:59:59Z" });
    expect(out.form).not.toBeNull();
    expect(out.rubric).not.toBeNull();
  });

  it("leaves opening refused while a checklist item fails, with a link to fix it", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    // No closing date on the opportunity: the stage has no closing date either.
    const opp = await published(h, officer, { keyDates: { postDate: { name: "Opens", eventType: "singleDate", date: "2027-04-01" } } });
    const out = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(out.checklist.ready).toBe(false);
    const failing = out.checklist.items.filter((i) => i.state !== "pass");
    expect(failing.map((i) => i.key)).toEqual(["stage_dates"]);
    expect(failing[0]!.fixHref).toMatch(/^\/w\/riverbend\/competitions\/cmp_/);
    const refused = await h.request(`/gms/competitions/${out.competition.id}/open`, { method: "POST", headers: officer });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("stage dates are set");
  });

  it("works on a draft opportunity, whose checklist then asks for publishing", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await data<{ id: string }>(await h.request("/gms/opportunities", json(officer, OPP)));
    const out = await data<Setup>(await quickSetup(h, officer, opp.id));
    expect(out.checklist.items.filter((i) => i.state !== "pass").map((i) => i.key)).toEqual(["opportunity_published"]);
    expect((await h.request(`/gms/competitions/${out.competition.id}/open`, { method: "POST", headers: officer })).status).toBe(409);
  });

  it("applies every rule: scope, workspace, a closed opportunity, an empty body", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    // An auditor reads but cannot write; nothing is made.
    expect((await quickSetup(h, await as(h, USER_AUDITOR), opp.id)).status).toBe(403);
    expect(await h.repos.table("competitions").find({})).toHaveLength(0);
    // Another funder's opportunity is not found.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    expect((await quickSetup(h, await as(h, USER_OFFICER, WS_OTHER), opp.id)).status).toBe(404);
    // An applicant workspace cannot run it.
    expect((await quickSetup(h, await as(h, USER_OFFICER, WS_APPLICANT), opp.id)).status).toBe(403);
    expect((await h.request(`/gms/opportunities/${opp.id}/quick-setup`, json(officer, { stages: [] }))).status).toBe(400);
    await h.request(`/gms/opportunities/${opp.id}/close`, json(officer, {}));
    expect(await errorCode(await quickSetup(h, officer, opp.id))).toBe("opportunity_closed");
    expect(await h.repos.table("competitions").find({})).toHaveLength(0);
  });

  it("refuses a token missing one of the scopes before making anything", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const agent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "competitions:read competitions:write forms:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-quick-setup" });
    const res = await h.request(`/gms/opportunities/${opp.id}/quick-setup`, json(bearer(agent).headers, {}));
    expect(res.status).toBe(403);
    expect(await h.repos.table("competitions").find({})).toHaveLength(0);
    expect(await h.repos.table("forms").find({})).toHaveLength(0);
  });

  it("holds a workspace gate on any part (create_form) for agents over REST", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { gatedTools: ["create_form"] } });
    const agent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "competitions:read competitions:write forms:write reviews:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-quick-setup-gated" });
    const res = await h.request(`/gms/opportunities/${opp.id}/quick-setup`, json(bearer(agent).headers, {}));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("approval_required");
    expect(await h.repos.table("competitions").find({})).toHaveLength(0);
    // A person in the UI is the approval.
    expect((await quickSetup(h, officer, opp.id)).status).toBe(200);
  });
});

describe("quick_setup_competition over MCP", () => {
  interface ToolOut {
    structuredContent: Record<string, unknown>;
    isError: boolean;
  }
  const call = async (h: Harness, token: string, args: Record<string, unknown>) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "quick_setup_competition", arguments: args } }) });
    return ((await res.json()) as { result: ToolOut }).result;
  };

  it("runs the same service, and is held for approval when a workspace gates one of its parts", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const token = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "competitions:read competitions:write forms:write reviews:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mcp-quick-setup" });

    const out = await call(h, token, { opportunityId: opp.id });
    expect(out.isError).toBe(false);
    expect(JSON.stringify(out.structuredContent)).toContain('"ready":true');
    const again = await call(h, token, { opportunityId: opp.id });
    expect(JSON.stringify(again.structuredContent)).toContain('"created":{"competition":false,"form":false,"rubric":false}');

    const other = await published(h, officer, { title: "The Other Fund", slug: "the-other-fund" });
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { gatedTools: ["set_rubric"] } });
    const held = await call(h, token, { opportunityId: other.id });
    expect(JSON.stringify(held.structuredContent)).toContain("pending_approval");
    expect(await h.repos.table("competitions").find({ opportunity_id: other.id.replace(/^opp_/, "") })).toHaveLength(0);
  });
});

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const withoutExamples = (node: unknown): unknown =>
  Array.isArray(node) ? node.map(withoutExamples) : node === null || typeof node !== "object" ? node : Object.fromEntries(Object.entries(node).filter(([k]) => k !== "example" && k !== "examples").map(([k, v]) => [k, withoutExamples(v)]));

describe.skipIf(!existsSync(SPEC))("quick setup contract", () => {
  it("answers in the shape the compiled API document describes", async () => {
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    const validate = ajv.compile({ $ref: "openapi#/paths/~1gms~1opportunities~1{id}~1quick-setup/post/responses/200/content/application~1json/schema" });
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const opp = await published(h, officer);
    const body = (await (await quickSetup(h, officer, opp.id)).json()) as unknown;
    expect(validate({ status: 200, message: "Success", data: { competition: null } })).toBe(false);
    validate(body);
    expect(validate.errors ?? []).toEqual([]);
  });
});
