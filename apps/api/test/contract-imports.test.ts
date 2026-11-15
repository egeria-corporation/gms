// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the import routes validate against the compiled OpenAPI document
// (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/** As in contract-outside.test.ts: drop examples, and turn OpenAPI 3.0 `nullable` into `anyOf [schema, null]`. */
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

const APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
const PIPELINE = "Grant,Funder,Deadline,Ask\nCapacity 2026,Cascade Trust,2026-03-01,20000\nBad row,,,\n";
const HISTORY = "Organization,Grant,Amount,Award date,Paid,Paid on\nAlder Creek Family Services,Van route,50000,2024-03-01,25000,2024-04-01\n";

describe.skipIf(!existsSync(SPEC))("import contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let applicant: Record<string, string>;
  let funder: Record<string, string>;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(who: Record<string, string>, path: string, method: "get" | "post", url: string, status: number, body?: unknown): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), headers: who, ...(method === "get" ? {} : { body: JSON.stringify(body ?? {}) }) });
    const json = (await res.json()) as { data: T };
    expect(res.status, `${method} ${url} ${JSON.stringify(json).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return json.data;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: APPLICANT_ADMIN, role: "admin" });
    applicant = { ...bearer(await h.session(APPLICANT_ADMIN)).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
    funder = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  });

  it("outside applications: sources, read, preview, commit and the run match the document", async () => {
    await valid(applicant, "/gms/imports/sources", "get", "/gms/imports/sources?target=outside_applications", 200);
    const source = { kind: "csv", text: PIPELINE, fileName: "pipeline.csv" };
    await valid(applicant, "/gms/imports/read", "post", "/gms/imports/read", 200, { target: "outside_applications", source });
    const preview = await valid<{ run: { id: string } }>(applicant, "/gms/imports/preview", "post", "/gms/imports/preview", 201, { target: "outside_applications", source, mapping: { title: "Grant", funderName: "Funder", fullDue: "Deadline", askAmount: "Ask" } });
    await valid(applicant, "/gms/imports/runs/{id}/commit", "post", `/gms/imports/runs/${preview.run.id}/commit`, 200);
    await valid(applicant, "/gms/imports/runs/{id}", "get", `/gms/imports/runs/${preview.run.id}`, 200);
    await valid(applicant, "/gms/imports/runs", "get", "/gms/imports/runs?target=outside_applications", 200);
    await valid(applicant, "/gms/connectors/{provider}", "post", "/gms/connectors/google_sheets", 200, { returnTo: "/w/alder-creek/import" });
  });

  it("grant history with a payment recorded as paid elsewhere matches the document", async () => {
    const source = { kind: "csv", text: HISTORY };
    const preview = await valid<{ run: { id: string } }>(funder, "/gms/imports/preview", "post", "/gms/imports/preview", 201, { target: "award_history", source, mapping: { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date", paidAmount: "Paid", paidDate: "Paid on" } });
    await valid(funder, "/gms/imports/runs/{id}/commit", "post", `/gms/imports/runs/${preview.run.id}/commit`, 200);
    await valid(funder, "/gms/imports/runs/{id}", "get", `/gms/imports/runs/${preview.run.id}`, 200);
  });
});
