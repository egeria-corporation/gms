// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the CommonGrants `/awards` routes and of the review-to-award `/gms`
// routes validate against the
// compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI
// compiles it before the tests run.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Examples embed whole JSON Schemas, which Ajv would try to register. OpenAPI 3.0 also writes
 * "this, or null" as `nullable` beside `allOf`/`$ref`, where the referenced schema still refuses
 * null (and Ajv refuses `nullable` without a `type`): every nullable schema becomes `anyOf: [<the schema>, { enum: [null] }]`.
 */
function withoutExamples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutExamples);
  if (node === null || typeof node !== "object") return node;
  const out = Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => k !== "example" && k !== "examples")
      .map(([k, v]) => [k, withoutExamples(v)]),
  );
  if (out.nullable === true) {
    const { nullable: _nullable, description, ...rest } = out;
    return { ...(description === undefined ? {} : { description }), anyOf: [rest, { enum: [null] }] };
  }
  return out;
}

describe.skipIf(!existsSync(SPEC))("review-to-award contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;
  let app: string;
  let award: string; // awd_<uuid>
  let agreement: string; // agr_<uuid>
  let assignment: string;
  let admin: Record<string, string>;
  const R1 = "10000000-0000-4000-8000-000000000001";

  type Method = "get" | "post" | "put" | "patch";
  const schema = (path: string, method: Method, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });

  async function expectValid(who: Record<string, string>, path: string, method: Method, url: string, status: number, body?: unknown) {
    const r = await s.call<unknown>(who, method.toUpperCase(), url, method === "get" ? undefined : (body ?? {}));
    expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(status);
    const validate = schema(path, method, String(status));
    validate(r.body);
    expect(validate.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return r.body as { data: Record<string, unknown> };
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    s = await scenario(h);
    admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: R1, role: "reviewer" });
    const program = await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Community Health 2027", budget_amount_minor: 20_000_000, defaults: { awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" }, requirements: [{ type: "report", title: "Final report" }] } });
    await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    app = started.body.data.id;
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" } } });
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`);
  });

  it("the validator is live: a response of the wrong shape fails", () => {
    const award = schema("/gms/awards/{id}", "get", "200");
    expect(award({ status: 200, message: "Success", data: { id: "not-an-id", title: 7 } })).toBe(false);
    const members = schema("/gms/workspaces/{id}/members", "get", "200");
    expect(members({ status: 200, message: "Success", data: [] })).toBe(false);
    const program = schema("/gms/programs/{id}", "get", "200");
    expect(program({ status: 200, message: "Success", data: { id: "11111111-1111-4111-8111-111111111111", name: "x", fiscalYear: "2027" } })).toBe(false);
  });

  it("review assignments, the reviewer view, reviews and the ranking", async () => {
    const created = await expectValid(s.funder, "/gms/review-assignments", "post", "/gms/review-assignments", 201, { applicationId: `app_${app}`, reviewerUserId: R1 });
    assignment = created.data.id as string;
    const reviewer = { ...bearer(await h.session(R1)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    await expectValid(reviewer, "/gms/review-assignments/{id}", "patch", `/gms/review-assignments/${assignment}`, 200, { action: "declare_coi", hasConflict: false });
    await expectValid(reviewer, "/gms/review-assignments/{id}", "patch", `/gms/review-assignments/${assignment}`, 200, { action: "submit", scores: { fit: 4 }, narrative: "Good fit." });
    await expectValid(reviewer, "/gms/review-assignments/{id}", "get", `/gms/review-assignments/${assignment}`, 200);
    await expectValid(s.funder, "/gms/review-assignments", "get", "/gms/review-assignments", 200);
    await expectValid(s.funder, "/gms/reviews", "get", `/gms/reviews?applicationId=app_${app}`, 200);
    await expectValid(s.funder, "/gms/competitions/{id}/ranking", "get", `/gms/competitions/${s.compId}/ranking?stage=loi`, 200);
    await expectValid(s.funder, "/gms/review-assignments/auto", "post", "/gms/review-assignments/auto", 200, { competitionId: s.compId, stage: "loi", dryRun: true });
    await expectValid(s.funder, "/gms/review-assignments/invite", "post", "/gms/review-assignments/invite", 201, { email: "hollis@university.example", competitionId: s.compId });
  });

  it("decisions and the allocator", async () => {
    const proposed = await expectValid(s.funder, "/gms/decisions/propose", "post", "/gms/decisions/propose", 200, { competitionId: s.compId, decisions: [{ applicationId: `app_${app}`, outcome: "approve", amountMinor: 15_000_000, conditions: ["Quarterly calls"] }] });
    await expectValid(s.funder, "/gms/competitions/{id}/allocation", "get", `/gms/competitions/${s.compId}/allocation`, 200);
    await expectValid(s.funder, "/gms/decisions", "get", "/gms/decisions", 200);
    const id = (proposed.data.decisions as { id: string }[])[0]!.id;
    const committed = await expectValid(s.funder, "/gms/decisions/commit", "post", "/gms/decisions/commit", 200, { competitionId: s.compId, decisionIds: [id] });
    const result = (committed.data.results as { awardId: string; agreementId: string }[])[0]!;
    award = result.awardId;
    agreement = result.agreementId;
  });

  it("GMS awards, for the funder and the recipient", async () => {
    await expectValid(s.funder, "/gms/awards", "get", "/gms/awards", 200);
    await expectValid(s.funder, "/gms/awards/{id}", "get", `/gms/awards/${award}`, 200);
    await expectValid(s.applicant, "/gms/my/awards", "get", "/gms/my/awards", 200);
    await expectValid(s.applicant, "/gms/my/awards/{id}", "get", `/gms/my/awards/${award}`, 200);
    await expectValid(s.applicant, "/gms/my/awards/{id}/schedule", "get", `/gms/my/awards/${award}/schedule`, 200);
  });

  it("agreements: send, accept, sign, countersign", async () => {
    await expectValid(s.funder, "/gms/agreements/{id}", "get", `/gms/agreements/${agreement}`, 200);
    await expectValid(s.funder, "/gms/agreements/{id}/send", "post", `/gms/agreements/${agreement}/send`, 200);
    await expectValid(s.applicant, "/gms/my/awards/{id}/accept", "post", `/gms/my/awards/${award}/accept`, 200);
    await expectValid(s.applicant, "/gms/agreements/{id}/sign", "post", `/gms/agreements/${agreement}/sign`, 200, { name: "Maria Santos", attest: true });
    await expectValid(s.funder, "/gms/agreements/{id}/countersign", "post", `/gms/agreements/${agreement}/countersign`, 200, { name: "Dana Ortiz", attest: true });
    await expectValid(s.funder, "/gms/awards/{id}", "get", `/gms/awards/${award}`, 200);
  });

  it("amendments", async () => {
    const m = await expectValid(s.applicant, "/gms/my/awards/{id}/amendments", "post", `/gms/my/awards/${award}/amendments`, 201, { type: "extension", request: { newEndDate: "2028-12-31" }, reason: "Hiring delay" });
    await expectValid(s.funder, "/gms/awards/{id}/amendments", "get", `/gms/awards/${award}/amendments`, 200);
    await expectValid(s.funder, "/gms/amendments/{id}", "patch", `/gms/amendments/${m.data.id as string}`, 200, { status: "approved" });
    await expectValid(s.funder, "/gms/awards/{id}/suspend", "post", `/gms/awards/${award}/suspend`, 200, { reason: "Leadership change" });
    await expectValid(s.funder, "/gms/awards/{id}/resume", "post", `/gms/awards/${award}/resume`, 200);
  });

  it("CommonGrants /awards", async () => {
    const uuid = award.slice(4);
    for (const who of [s.funder, s.applicant]) {
      await expectValid(who, "/common-grants/awards", "get", "/common-grants/awards", 200);
      await expectValid(who, "/common-grants/awards/{awdId}", "get", `/common-grants/awards/${uuid}`, 200);
      await expectValid(who, "/common-grants/awards/search", "post", "/common-grants/awards/search", 200, { search: "mobile", pagination: { page: 1, pageSize: 10 } });
    }
  });

  it("design routes: programs, opportunities, competitions, forms, readiness, members, public pages", async () => {
    const program = await expectValid(s.funder, "/gms/programs", "post", "/gms/programs", 201, { name: "Housing Stability 2027", budgetAmountMinor: 80_000_000, fiscalYear: 2027 });
    await expectValid(s.funder, "/gms/programs", "get", "/gms/programs", 200);
    await expectValid(s.funder, "/gms/programs/{id}", "get", `/gms/programs/${program.data.id as string}`, 200);
    await expectValid(s.funder, "/gms/opportunities", "get", "/gms/opportunities", 200);
    await expectValid(s.funder, "/gms/opportunities/{id}", "get", `/gms/opportunities/${s.oppId}`, 200);
    await expectValid(s.funder, "/gms/opportunities/{id}/preview", "post", `/gms/opportunities/${s.oppId}/preview`, 200);
    await expectValid(s.funder, "/gms/competitions", "get", "/gms/competitions", 200);
    await expectValid(s.funder, "/gms/competitions/{id}", "get", `/gms/competitions/${s.compId}`, 200);
    await expectValid(s.funder, "/gms/competitions/{id}/launch-check", "post", `/gms/competitions/${s.compId}/launch-check`, 200);
    await expectValid(s.funder, "/gms/forms", "get", "/gms/forms", 200);
    await expectValid(s.funder, "/gms/forms/library", "get", "/gms/forms/library", 200);
    await expectValid(s.funder, "/gms/forms/{id}", "get", `/gms/forms/${s.loiFormId}`, 200);
    await expectValid(s.funder, "/gms/eligibility/evaluate", "post", "/gms/eligibility/evaluate", 200, { opportunityId: s.oppId, org: { orgType: { code: "EA000000" } } });
    await expectValid(admin, "/gms/workspaces/{id}/members", "get", `/gms/workspaces/${WS_FUNDER}/members`, 200);
    await expectValid(admin, "/gms/workspaces/{id}/invitations", "post", `/gms/workspaces/${WS_FUNDER}/invitations`, 201, { email: "new.officer@riverbendcf.example", role: "program_officer" });
    await expectValid(admin, "/gms/workspaces/{id}/passport/status", "get", `/gms/workspaces/${WS_FUNDER}/passport/status`, 200);
    await expectValid({}, "/gms/public/funders/{handle}", "get", "/gms/public/funders/riverbend", 200);
    await expectValid({}, "/gms/public/funders/{handle}/opportunities/{slug}", "get", "/gms/public/funders/riverbend/opportunities/community-health-grants-2027", 200);
  });

  it("templates and sends", async () => {
    const t = await expectValid(s.funder, "/gms/templates", "post", "/gms/templates", 201, { kind: "email", name: "Cycle update", subject: "An update on {{application.title}}", body: "Hello {{recipient.name}}." });
    await expectValid(s.funder, "/gms/templates", "get", "/gms/templates", 200);
    await expectValid(s.funder, "/gms/templates/{id}", "get", `/gms/templates/${t.data.id as string}`, 200);
    await expectValid(s.funder, "/gms/templates/{id}", "get", "/gms/templates/builtin:agreement", 200);
    await expectValid(s.funder, "/gms/templates/{id}/render", "post", `/gms/templates/${t.data.id as string}/render`, 200, { applicationId: `app_${app}` });
    await expectValid(s.funder, "/gms/communications/send", "post", "/gms/communications/send", 200, { templateId: t.data.id, recipients: [{ applicationId: `app_${app}` }] });
    await expectValid(s.funder, "/gms/communications", "get", "/gms/communications", 200);
  });
});
