// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the v1.8.0 content digest routes validate against the compiled
// OpenAPI document (`pnpm spec:compile`), and agents read the preview over MCP but cannot change
// the choices. Skipped when the document has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { clearDiscoveryCache } from "../src/services/applicant.ts";
import { sendContentDigests } from "../src/services/content-digests.ts";
import { CLIENT_AGENT, TEST_CREDENTIALS_KEY, USER_OFFICER, WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/** As in contract-invites.test.ts: drop examples, and turn OpenAPI 3.0 `nullable` into `anyOf [schema, null]`. */
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

describe.skipIf(!existsSync(SPEC))("content digests contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;
  let seq = 0;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(who: Record<string, string>, path: string, method: "get" | "put" | "post", url: string, status: number, body?: unknown) {
    const r = await s.call<{ data: Record<string, unknown> }>(who, method.toUpperCase(), url, method === "get" ? undefined : (body ?? {}));
    expect(r.status, `${method} ${url} ${JSON.stringify(r.body).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(r.body);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return r.body.data;
  }
  const rpc = async (token: string, name: string, args: Record<string, unknown>) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }) });
    return ((await res.json()) as { result: { structuredContent?: Record<string, unknown> } }).result.structuredContent!;
  };
  const agent = (user: string, ws: string, scope: string) => h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-dig-${++seq}` });

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    clearDiscoveryCache();
    h = await harness();
    s = await scenario(h);
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
  });

  it("settings, preview and unsubscribe match the document", async () => {
    await valid(s.applicant, "/gms/digests", "get", "/gms/digests", 200);
    await valid(s.applicant, "/gms/digests", "put", "/gms/digests", 200, { new_matches: true, promptDismissed: true });
    await valid(s.applicant, "/gms/digests/preview", "get", "/gms/digests/preview?digest=new_matches", 200);
    await valid(s.applicant, "/gms/digests/preview", "get", "/gms/digests/preview?digest=deadlines", 200);
    await valid(s.funder, "/gms/digests", "put", "/gms/digests", 200, { funder_activity: true });
    await valid(s.funder, "/gms/digests/preview", "get", "/gms/digests/preview?digest=funder_activity", 200);
    await sendContentDigests({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory, openGrants: h.openGrants } });
    const token = /token=([^>]+)>/.exec(h.mailer.sent.at(-1)!.headers!["List-Unsubscribe"]!)![1]!;
    await valid({ "Content-Type": "application/json" }, "/gms/digests/unsubscribe", "post", "/gms/digests/unsubscribe", 200, { token });
    const forged = await s.call<unknown>({ "Content-Type": "application/json" }, "POST", "/gms/digests/unsubscribe", { token: token.slice(0, -2) + "AA" });
    expect(forged.status).toBe(400);
    const v = schema("/gms/digests/unsubscribe", "post", "400");
    v(forged.body);
    expect(v.errors ?? []).toEqual([]);
  });

  it("agents read the preview over MCP, the same as the screen, and cannot change the choices", async () => {
    const token = await agent(USER_APPLICANT, WS_APPLICANT, "applications:read discovery");
    const out = await rpc(token, "get_digest_preview", { digest: "deadlines" });
    expect(out).toMatchObject({ digest: "deadlines", label: "Deadlines", sendsOn: "2027-04-19" });
    const funder = await rpc(await agent(USER_OFFICER, WS_FUNDER, "applications:read"), "get_digest_preview", { digest: "funder_activity" });
    expect(funder).toMatchObject({ digest: "funder_activity", on: true });
    // The preview needs the scope the screen would: deadlines are applications:read.
    const narrow = await agent(USER_APPLICANT, WS_APPLICANT, "discovery");
    const refused = await h.request("/gms/digests/preview?digest=deadlines", { headers: { Authorization: `Bearer ${narrow}`, "X-GMS-Workspace": WS_APPLICANT } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("insufficient_scope");
    const put = await h.request("/gms/digests", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" }, body: JSON.stringify({ deadlines: true }) });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("person_required");
  });
});
