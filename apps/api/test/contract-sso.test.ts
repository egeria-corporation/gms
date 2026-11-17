// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the single sign-on routes validate against the compiled OpenAPI
// document (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { SESSION_SECRET, USER_ADMIN, WS_FUNDER, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const PROVIDER = "5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a";

/** As in contract-keep.test.ts: drop examples, and turn OpenAPI 3.0 `nullable` into `anyOf [schema, null]`. */
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

describe.skipIf(!existsSync(SPEC))("single sign-on contract", () => {
  let ajv: Ajv;
  let h: Harness;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  const session = (provider?: string) => {
    const iat = Math.floor(h.clock.now.getTime() / 1000);
    return new SignJWT({ aal: "aal2", email: "helen@riverbendcf.org", role: "authenticated", amr: [provider ? { method: "sso/saml", timestamp: iat, provider } : { method: "otp", timestamp: iat }] })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(USER_ADMIN)
      .setAudience("authenticated")
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(new TextEncoder().encode(SESSION_SECRET));
  };
  async function valid(token: string, path: string, method: "get" | "post" | "put" | "delete", url: string, status: number, body?: unknown, workspace = true) {
    const res = await h.request(url, { method: method.toUpperCase(), headers: { Authorization: `Bearer ${token}`, ...(workspace ? { "X-GMS-Workspace": WS_FUNDER } : {}), "Content-Type": "application/json" }, ...(method === "get" || method === "delete" ? {} : { body: JSON.stringify(body ?? {}) }) });
    const json = (await res.json()) as { data: Record<string, unknown> };
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
    h.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
  });
  afterEach(() => vi.restoreAllMocks());

  it("settings, domains, the DNS check, the requirement and joining match the document", async () => {
    const email = await session();
    const added = (await valid(email, "/gms/sso/domains", "post", "/gms/sso/domains", 201, { domain: "riverbend.org" })) as { id: string };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ Status: 3 }), { status: 200 }));
    await valid(email, "/gms/sso/domains/{id}/check", "post", `/gms/sso/domains/${added.id}/check`, 200);
    await h.repos.table("workspace_sso_domains").insert({ workspace_id: WS_FUNDER, domain: "riverbendcf.org", status: "active", require_sso: false, provider_id: PROVIDER, verification_token: "t".repeat(43), verified_at: h.clock.now.toISOString(), activated_at: h.clock.now.toISOString(), last_checked_at: null, last_check_result: null, created_by: USER_ADMIN });
    await valid(email, "/gms/sso/settings", "get", "/gms/sso/settings", 200);
    const sso = await session(PROVIDER);
    await valid(sso, "/gms/sso/requirement", "put", "/gms/sso/requirement", 200, { require: true });
    await valid(sso, "/gms/sso/settings", "get", "/gms/sso/settings", 200);
    await valid(sso, "/gms/sso/join", "post", "/gms/sso/join", 200, {}, false);
    await valid(sso, "/gms/sso/domains/{id}", "delete", `/gms/sso/domains/${added.id}`, 200);
  });
});
