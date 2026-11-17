// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the imported history routes (v1.12.0), and of an import into each
// history target, validate against the compiled OpenAPI document (`pnpm spec:compile`). Skipped
// when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const fixture = (name: string) => readFileSync(new URL(`../../../packages/importers/test/fixtures/adapters/${name}`, import.meta.url), "utf8").replace("{NINE}", "").replace("{LONG}", "");

/** As in contract-imports.test.ts: drop examples, and turn OpenAPI 3.0 `nullable` into `anyOf [schema, null]`. */
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

describe.skipIf(!existsSync(SPEC))("imported history contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let funder: Record<string, string>;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(path: string, method: "get" | "post", url: string, status: number, body?: unknown): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), headers: funder, ...(method === "get" ? {} : { body: JSON.stringify(body ?? {}) }) });
    const json = (await res.json()) as { data: T };
    expect(res.status, `${method} ${url} ${JSON.stringify(json).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return json.data;
  }
  async function importAll(target: string, file: string) {
    const source = { kind: "csv", text: fixture(file), fileName: file };
    await valid("/gms/imports/sources", "get", `/gms/imports/sources?target=${target}`, 200);
    const read = await valid<{ mapping: Record<string, string> }>("/gms/imports/read", "post", "/gms/imports/read", 200, { target, source });
    const preview = await valid<{ run: { id: string } }>("/gms/imports/preview", "post", "/gms/imports/preview", 201, { target, source, mapping: read.mapping });
    for (let i = 0; i < 50; i++) if ((await valid<{ done: boolean }>("/gms/imports/runs/{id}/commit", "post", `/gms/imports/runs/${preview.run.id}/commit`, 200)).done) break;
    await valid("/gms/imports/runs/{id}", "get", `/gms/imports/runs/${preview.run.id}`, 200);
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    funder = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  });

  it("imports into each history target, and serves the history, as the document says", async () => {
    await importAll("award_history", "submittable.csv");
    await importAll("history_applications", "submittable-applications.csv");
    await importAll("history_reviews", "submittable-reviews.csv");
    await importAll("award_history", "cybergrants-requests.csv");
    await importAll("history_reports", "cybergrants-impact-reports.csv");
    const awards = await h.repos.table("awards").find({ workspace_id: WS_FUNDER });
    const van = awards.find((a) => a.title === "Clinic van")!;
    const storage = awards.find((a) => a.title === "Cold storage")!;
    const list = await valid<{ applications: { id: string }[] }>("/gms/history", "get", `/gms/history?award=awd_${van.id}`, 200);
    expect(list.applications).toHaveLength(1);
    const reports = await valid<{ reports: unknown[] }>("/gms/history", "get", `/gms/history?award=awd_${storage.id}`, 200);
    expect(reports.reports).toHaveLength(1);
    const detail = await valid<{ reviews: unknown[] }>("/gms/history/applications/{id}", "get", `/gms/history/applications/${list.applications[0]!.id}`, 200);
    expect(detail.reviews).toHaveLength(2);
    await valid("/gms/reports/preview", "post", "/gms/reports/preview", 200, { dataSet: "history", columns: ["record", "title", "organization", "outcome", "submittedOn", "requested", "awarded", "currency", "score"] });
  });
});
