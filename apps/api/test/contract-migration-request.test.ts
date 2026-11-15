// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the migration request routes (switch pages) validate against the
// compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_FUNDER, harness, type Harness } from "./helpers.ts";

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

describe.skipIf(!existsSync(SPEC))("migration request contract", () => {
  let ajv: Ajv;
  let h: Harness;
  const body = { name: "Ana Ruiz", email: "ana@riverbendcf.example", organization: "Riverbend Community Foundation", system: "fluxx", programs: "6-20", pastAwards: "1000-9999", timing: "asap", note: "Two programs." };

  async function valid(path: string, method: "get" | "post", status: number, payload?: unknown, headers: Record<string, string> = {}) {
    const res = await h.request(path, { method: method.toUpperCase(), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(res.status, `${method} ${path} ${JSON.stringify(json).slice(0, 300)}`).toBe(status);
    const v = ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${path} ${status}`).toEqual([]);
    return json.data;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
  });

  it("form, preview, send and the refusals match the document", async () => {
    const form = (await valid("/gms/migration-requests/form", "get", 200)) as { formToken: string };
    await valid("/gms/migration-requests/preview", "post", 200, body);
    await valid("/gms/migration-requests/preview", "post", 200, { ...body, note: undefined });
    await valid("/gms/migration-requests", "post", 422, { ...body, formToken: form.formToken });
    h.clock.now = new Date(h.clock.now.getTime() + 10_000);
    await valid("/gms/migration-requests", "post", 200, { ...body, formToken: form.formToken });
    await valid("/gms/migration-requests/preview", "post", 400, { ...body, system: "unknown" });
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "applications:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mig-contract" });
    await valid("/gms/migration-requests", "post", 403, body, { Authorization: `Bearer ${agent}` });
    for (let i = 0; i < 2; i++) await valid("/gms/migration-requests", "post", 200, { ...body, formToken: form.formToken });
    await valid("/gms/migration-requests", "post", 429, { ...body, formToken: form.formToken });
    h.withoutPorts.add("mailer");
    await valid("/gms/migration-requests", "post", 503, { ...body, email: "other@example.org", formToken: form.formToken });
  });
});
