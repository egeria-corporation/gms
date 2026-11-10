// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the CommonGrants `/applications` routes validate against the
// compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI
// compiles it before the tests run.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { harness, type Harness } from "./helpers.ts";
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

describe.skipIf(!existsSync(SPEC))("CommonGrants applications contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;
  let appId: string;

  const schema = (path: string, method: "get" | "post" | "put", status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });

  async function expectValid(who: Record<string, string>, path: string, method: "get" | "post" | "put", url: string, status: number, body?: unknown) {
    const r = await s.call<unknown>(who, method.toUpperCase(), url, body);
    expect(r.status, url).toBe(status);
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
  });

  it("POST /common-grants/applications/start", async () => {
    const body = await expectValid(s.applicant, "/common-grants/applications/start", "post", "/common-grants/applications/start", 201, { competitionId: s.uuid.comp });
    appId = body.data.id as string;
  });
  it("GET and PUT /common-grants/applications/{appId}/forms/{formId}", async () => {
    const url = `/common-grants/applications/${appId}/forms/${s.uuid.loi}`;
    await expectValid(s.applicant, "/common-grants/applications/{appId}/forms/{formId}", "get", url, 200);
    await expectValid(s.applicant, "/common-grants/applications/{appId}/forms/{formId}", "put", url, 200, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" } } });
  });
  it("GET /common-grants/applications/{appId}", async () => {
    await expectValid(s.applicant, "/common-grants/applications/{appId}", "get", `/common-grants/applications/${appId}`, 200);
  });
  it("PUT /common-grants/applications/{appId}/submit", async () => {
    const body = await expectValid(s.applicant, "/common-grants/applications/{appId}/submit", "put", `/common-grants/applications/${appId}/submit`, 200);
    expect((body.data.status as { value: string }).value).toBe("submitted");
  });
  it("POST /common-grants/applications/search", async () => {
    await expectValid(s.funder, "/common-grants/applications/search", "post", "/common-grants/applications/search", 200, { filters: { status: { operator: "in", value: ["submitted"] } }, pagination: { page: 1, pageSize: 10 } });
  });
  it("the /gms routes around applications match their documented shapes", async () => {
    const id = `app_${appId}`;
    await expectValid(s.funder, "/gms/applications", "get", "/gms/applications", 200);
    await expectValid(s.funder, "/gms/applications/{id}", "get", `/gms/applications/${id}`, 200);
    await expectValid(s.funder, "/gms/applications/{id}/tags", "post", `/gms/applications/${id}/tags`, 200, { add: ["rural"] });
    await expectValid(s.applicant, "/gms/my/applications", "get", "/gms/my/applications", 200);
    await expectValid(s.applicant, "/gms/my/applications/{id}/status", "get", `/gms/my/applications/${id}/status`, 200);
    await expectValid(s.applicant, "/gms/my/applications/{id}/comments", "post", `/gms/my/applications/${id}/comments`, 201, { body: "Check the title", formId: s.loiFormId, fieldPath: "/projectTitle" });
    await expectValid(s.applicant, "/gms/me/organization", "get", "/gms/me/organization", 200);
    await expectValid(s.applicant, "/gms/me/readiness", "get", "/gms/me/readiness", 200);
    await expectValid(s.applicant, "/gms/discover/competitions", "get", "/gms/discover/competitions", 200);
    await expectValid(s.applicant, "/gms/discover/opengrants/search", "post", "/gms/discover/opengrants/search", 200, { query: "health" });
    await expectValid(s.applicant, "/gms/my/consents", "get", "/gms/my/consents", 200);
    await expectValid(s.applicant, "/gms/my/funders", "get", "/gms/my/funders", 200);
    await expectValid(s.funder, "/gms/threads", "post", "/gms/threads", 200, { subjectId: id });
    await expectValid(s.funder, "/gms/threads", "get", `/gms/threads?subjectId=${id}`, 200);
    await expectValid(s.funder, "/gms/tasks", "post", "/gms/tasks", 201, { title: "Screen the LOI" });
    await expectValid(s.funder, "/gms/approvals", "get", "/gms/approvals", 200);
    const me = await h.request("/gms/me", { headers: { Authorization: s.funder.Authorization! } });
    const validate = schema("/gms/me", "get", "200");
    validate(await me.json());
    expect(validate.errors ?? []).toEqual([]);
    const bulk = await expectValid(s.funder, "/gms/applications/bulk", "post", "/gms/applications/bulk", 200, { action: "decline", applicationIds: [id], params: { rationale: "Not this cycle." } });
    expect(bulk.data.succeeded).toEqual([id]);
  });
  it("answers 404 in the documented error shape", async () => {
    await expectValid(s.funder, "/common-grants/applications/{appId}", "get", "/common-grants/applications/0190a000-0000-7000-8000-00000000ffff", 404);
  });
});
