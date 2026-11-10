// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the implemented /common-grants routes validate against the compiled
// OpenAPI document (`pnpm spec:compile`). Skipped when the document has not been compiled; CI
// compiles it before the tests run.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const compiled = existsSync(SPEC);

const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/** Examples embed whole JSON Schemas (form examples carry their own `$id`), which Ajv would try to register. */
function withoutExamples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutExamples);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => k !== "example" && k !== "examples")
      .map(([k, v]) => [k, withoutExamples(v)]),
  );
}

describe.skipIf(!compiled)("CommonGrants contract", () => {
  let ajv: Ajv;
  let h: Harness;
  const ids = { opp: "", comp: "", form: "" };

  /** The validator for a route's JSON response, straight from the compiled document. */
  function responseSchema(path: string, method: "get" | "post", status = "200"): ValidateFunction {
    const ref = `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema`;
    return ajv.compile({ $ref: ref });
  }

  async function expectValid(path: string, method: "get" | "post", url: string, init?: RequestInit) {
    const res = await h.request(url, init);
    expect(res.status, url).toBe(200);
    const body = (await res.json()) as unknown;
    const validate = responseSchema(path, method);
    const valid = validate(body);
    expect(validate.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    expect(valid).toBe(true);
    return body;
  }

  beforeAll(async () => {
    // OpenAPI 3.0 schemas are a JSON Schema dialect: unknown keywords (`example`, `nullable`) are ignored.
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });

    h = await harness();
    const who = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    const post = async <T>(path: string, body: unknown = {}, method = "POST") => ((await (await h.request(path, { method, headers: who, body: JSON.stringify(body) })).json()) as { data: T }).data;
    const opp = await post<{ id: string }>("/gms/opportunities", {
      title: "Community Health Grants 2027",
      description: "Grants for community health navigation in Riverbend County.",
      funding: { totalAmountAvailable: { amount: "1200000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
      keyDates: { closeDate: { name: "Full proposal deadline", eventType: "singleDate", date: "2027-04-30" } },
      acceptedApplicantTypes: ["non_profit_with_501c3"],
    });
    const form = await post<{ id: string }>("/gms/forms", {
      title: "Letter of intent",
      purpose: "loi",
      jsonSchema: { type: "object", properties: { legalName: { type: "string" }, projectTitle: { type: "string" } }, required: ["projectTitle"] },
      uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/projectTitle" }] },
      mappingFromCommonGrants: { legalName: { field: "name" } },
      mappingToCommonGrants: { title: { field: "projectTitle" } },
    });
    await post(`/gms/forms/${form.id}/publish`);
    const rubric = await post<{ id: string }>("/gms/rubrics", { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] });
    const comp = await post<{ id: string }>("/gms/competitions", { opportunityId: opp.id, title: "Community Health Grants 2027", description: "One stage." });
    await post(`/gms/competitions/${comp.id}/stages`, { stages: [{ key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T00:00:00Z", rubricId: rubric.id }] }, "PUT");
    await post(`/gms/opportunities/${opp.id}/publish`);
    const opened = await post<{ status: string }>(`/gms/competitions/${comp.id}/open`);
    expect(opened.status).toBe("open");
    Object.assign(ids, { opp: opp.id.slice(4), comp: comp.id.slice(4), form: form.id.slice(4) });
  });

  it("GET /common-grants/opportunities", async () => {
    const body = (await expectValid("/common-grants/opportunities", "get", "/common-grants/opportunities")) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });
  it("GET /common-grants/opportunities/{oppId}", async () => {
    const body = (await expectValid("/common-grants/opportunities/{oppId}", "get", `/common-grants/opportunities/${ids.opp}`)) as { data: { competitions: unknown[] } };
    expect(body.data.competitions).toHaveLength(1);
  });
  it("POST /common-grants/opportunities/search", async () => {
    await expectValid("/common-grants/opportunities/search", "post", "/common-grants/opportunities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { status: { operator: "in", value: ["open"] } }, sorting: { sortBy: "lastModifiedAt" }, pagination: { page: 1, pageSize: 10 } }),
    });
  });
  it("GET /common-grants/competitions/{compId}", async () => {
    await expectValid("/common-grants/competitions/{compId}", "get", `/common-grants/competitions/${ids.comp}`);
  });
  it("GET /common-grants/forms and /forms/{formId}", async () => {
    await expectValid("/common-grants/forms", "get", "/common-grants/forms");
    await expectValid("/common-grants/forms/{formId}", "get", `/common-grants/forms/${ids.form}`);
  });
  it("answers 404 in the documented error shape", async () => {
    const res = await h.request("/common-grants/opportunities/0190a000-0000-7000-8000-00000000ffff");
    expect(res.status).toBe(404);
    const validate = responseSchema("/common-grants/opportunities/{oppId}", "get", "404");
    validate(await res.json());
    expect(validate.errors ?? []).toEqual([]);
  });
});
