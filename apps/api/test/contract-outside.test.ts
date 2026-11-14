// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the apply-anywhere routes validate against the compiled OpenAPI
// document (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
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

/** As in contract-applications.test.ts: drop examples, and turn OpenAPI 3.0 `nullable` into `anyOf [schema, null]`. */
function withoutExamples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutExamples);
  if (node === null || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).filter(([k]) => k !== "example" && k !== "examples").map(([k, v]) => [k, withoutExamples(v)]));
  if (out.nullable === true) {
    const { nullable: _nullable, description, ...rest } = out;
    return { ...(description === undefined ? {} : { description }), anyOf: [rest, { enum: [null] }] };
  }
  return out;
}

describe.skipIf(!existsSync(SPEC))("apply anywhere contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(path: string, method: "get" | "post" | "put" | "patch" | "delete", url: string, status: number, body?: unknown) {
    const r = await s.call<{ data: Record<string, unknown> }>(s.applicant, method.toUpperCase(), url, method === "get" ? undefined : (body ?? {}));
    expect(r.status, `${method} ${url} ${JSON.stringify(r.body).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(r.body);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return r.body.data;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    s = await scenario(h);
  });

  it("outside applications, questions, answers, submission and decision match the document", async () => {
    const made = (await valid("/gms/outside-applications", "post", "/gms/outside-applications", 201, { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-05-01", askAmount: { amount: "50000.00", currency: "USD" }, listingUrl: "https://northwind.example/grants" })) as { id: string };
    await valid("/gms/outside-applications", "get", "/gms/outside-applications", 200);
    await valid("/gms/outside-applications/{id}", "patch", `/gms/outside-applications/${made.id}`, 200, { askByYear: [{ year: 2027, amount: { amount: "50000.00", currency: "USD" } }], customFields: { region: "Valley", priority: 2, renewal: true } });
    const qs = (await valid("/gms/outside-applications/{id}/questions", "post", `/gms/outside-applications/${made.id}/questions`, 201, { questions: [{ prompt: "Describe the need.", limitKind: "words", limitValue: 250 }] })) as unknown as { id: string }[];
    await valid("/gms/outside-applications/{id}/questions/parse", "post", `/gms/outside-applications/${made.id}/questions/parse`, 200, { text: "1. A (100 words)\n2. B" });
    await valid("/gms/outside-questions/{qid}/answer", "put", `/gms/outside-questions/${qs[0]!.id}/answer`, 200, { body: "Families travel 46 miles." });
    await valid("/gms/outside-questions/{qid}/answers", "get", `/gms/outside-questions/${qs[0]!.id}/answers`, 200);
    await valid("/gms/outside-questions/{qid}", "patch", `/gms/outside-questions/${qs[0]!.id}`, 200, { status: "approved" });
    await valid("/gms/outside-applications/{id}/questions", "get", `/gms/outside-applications/${made.id}/questions`, 200);
    await valid("/gms/outside-applications/{id}/documents", "post", `/gms/outside-applications/${made.id}/documents`, 201, { name: "budget.txt", mime: "text/plain", contentBase64: btoa("Budget") });
    await valid("/gms/outside-applications/{id}/submit", "post", `/gms/outside-applications/${made.id}/submit`, 200, { submittedAt: "2027-04-15", method: "portal" });
    await valid("/gms/outside-applications/{id}/decision", "post", `/gms/outside-applications/${made.id}/decision`, 200, { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, grantStart: "2027-07-01", grantEnd: "2028-06-30" });
    await valid("/gms/outside-applications/{id}/reopen", "post", `/gms/outside-applications/${made.id}/reopen`, 200);
    await valid("/gms/outside-applications/{id}", "get", `/gms/outside-applications/${made.id}`, 200);
    await valid("/gms/outside-applications/{id}/consulting-request/preview", "post", `/gms/outside-applications/${made.id}/consulting-request/preview`, 200, { contactName: "Ana Ruiz", contactEmail: "ana@aldercreekfs.example", includeAnswers: true });
    await valid("/gms/outside-applications/{id}/consulting-request", "post", `/gms/outside-applications/${made.id}/consulting-request`, 200, { contactName: "Ana Ruiz", contactEmail: "ana@aldercreekfs.example" });
    await valid("/gms/outside-applications/import", "post", "/gms/outside-applications/import", 200, { csv: "t,f\nA,B\n", mapping: { title: "t", funderName: "f" } });
    await valid("/gms/outside-questions/{qid}", "delete", `/gms/outside-questions/${qs[0]!.id}`, 200);
  });

  it("the pipeline, funder records, calendar feed and discovery match the document", async () => {
    await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    await valid("/gms/pipeline", "get", "/gms/pipeline", 200);
    const r = (await valid("/gms/funder-records", "post", "/gms/funder-records", 201, { name: "Riverbend Community Foundation", contacts: [{ name: "Ana", email: "ana@riverbend.example" }], portalLoginHolder: "Dana Ortiz" })) as { id: string };
    await valid("/gms/funder-records", "get", "/gms/funder-records", 200);
    await valid("/gms/funder-records/{id}", "get", `/gms/funder-records/${r.id}`, 200);
    await valid("/gms/funder-records/{id}", "patch", `/gms/funder-records/${r.id}`, 200, { notes: "x" });
    await valid("/gms/funder-records/{id}", "delete", `/gms/funder-records/${r.id}`, 200);
    await valid("/gms/calendar-feed", "get", "/gms/calendar-feed", 200);
    await valid("/gms/calendar-feed", "post", "/gms/calendar-feed", 200);
    await valid("/gms/calendar-feed", "delete", "/gms/calendar-feed", 200);
    await valid("/gms/discover/competitions", "get", "/gms/discover/competitions", 200);
    await valid("/gms/discover/saved", "post", "/gms/discover/saved", 201, { source: "opengrants", externalId: "og-1", title: "Rural Health Access Fund", url: "https://opengrants.example/grants/og-1" });
    await valid("/gms/discover/opengrants/{listingId}", "get", "/gms/discover/opengrants/og-1", 200);
  });
});
