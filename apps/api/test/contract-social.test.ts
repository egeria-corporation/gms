// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the social posting routes (against the fake Zernio) validate against
// the compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeZernio, signZernioBody } from "@gms/social";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
// Test values only; not real Zernio credentials.
const KEY = "zk_test_contract_key_not_real";
const SECRET = "zernio-webhook-secret-for-contract-tests";
const OPP = "0190c000-0000-7000-8000-0000000000c1";

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

describe.skipIf(!existsSync(SPEC))("social posting contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let fake: FakeZernio;
  let who: Record<string, string>;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(path: string, method: "get" | "post" | "delete", url: string, status: number, body?: unknown, headers: Record<string, string> = who): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
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
    h.env.ZERNIO_API_KEY = KEY;
    h.env.ZERNIO_WEBHOOK_SECRET = SECRET;
    fake = new FakeZernio({ apiKey: KEY, now: () => h.clock.now });
    vi.stubGlobal("fetch", fake.fetch);
    await h.repos.table("opportunities").insert({ id: OPP, workspace_id: WS_FUNDER, slug: "community-health-2027", title: "Community Health Grants 2027", status: "open", published_at: h.clock.now.toISOString() });
    who = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("settings, connect, compose, preview, post, reach, disconnect and the webhook match the document", async () => {
    await valid("/gms/social", "get", "/gms/social", 200);
    const start = await valid<{ authUrl: string }>("/gms/social/connect/{platform}", "post", "/gms/social/connect/linkedin", 200);
    const back = new URL(fake.approve(start.authUrl, "riverbend-cf"));
    const account = await valid<{ id: string }>("/gms/social/connect/callback", "post", "/gms/social/connect/callback", 201, { state: back.searchParams.get("gs"), profileId: back.searchParams.get("profileId"), accountId: back.searchParams.get("accountId"), connected: "linkedin", username: "riverbend-cf" });
    await valid("/gms/social/compose", "get", `/gms/social/compose?subjectType=opportunity&subjectId=${OPP}`, 200);
    const input = { subject: { type: "opportunity", id: OPP }, content: "Applications are open", accountIds: [account.id] };
    const preview = await valid<{ previewToken: string }>("/gms/social/posts/preview", "post", "/gms/social/posts/preview", 200, input);
    const post = await valid<{ id: string }>("/gms/social/posts", "post", "/gms/social/posts", 201, { ...input, previewToken: preview.previewToken }, { ...who, "Idempotency-Key": crypto.randomUUID() });
    const zid = (await h.repos.table("social_posts").one({ id: post.id }))!.zernio_post_id!;
    fake.metrics.set(zid, { impressions: 10, clicks: 1 });
    await valid("/gms/social/posts", "get", `/gms/social/posts?subjectType=opportunity&subjectId=${OPP}`, 200);
    await valid("/gms/social/posts", "get", "/gms/social/posts", 200);
    const raw = JSON.stringify({ id: "evt_c1", event: "post.published", profiles: [{ externalId: WS_FUNDER }], post: { _id: zid, status: "published", platforms: [] } });
    const res = await h.request("/webhooks/zernio", { method: "POST", headers: { "Content-Type": "application/json", "X-Zernio-Signature": await signZernioBody(SECRET, raw) }, body: raw });
    const ack = await res.json();
    const v = schema("/webhooks/zernio", "post", "200");
    v(ack);
    expect(v.errors ?? []).toEqual([]);
    await valid("/gms/social/accounts/{id}", "delete", `/gms/social/accounts/${account.id}`, 200);
  });
});
