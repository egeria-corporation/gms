// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the template gallery routes validate against the compiled
// OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { STARTER_ITEMS, STARTERS_PUBLISHED_AT } from "../src/services/gallery-starters.ts";
import { USER_ADMIN, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

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

describe.skipIf(!existsSync(SPEC))("template gallery contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let admin: Record<string, string>;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(path: string, method: "get" | "post", url: string, status: number, body?: unknown, headers: Record<string, string> = admin) {
    const res = await h.request(url, { method: method.toUpperCase(), headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
    h.env.GALLERY_MODERATORS = USER_ADMIN;
    for (const s of STARTER_ITEMS) await h.repos.table("gallery_items").insert({ id: s.id, slug: s.slug, kind: s.kind, title: s.title, summary: s.summary, tags: s.tags as never, author_workspace_id: null, licence: "CC-BY-4.0", status: "approved", version: 1, snapshot: s.snapshot as never, uses_count: 0, published_at: STARTERS_PUBLISHED_AT, withdrawn_at: null });
    admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER };
  });

  it("public reads, copy, share, moderation and withdraw match the document", async () => {
    await valid("/gms/gallery", "get", "/gms/gallery?kind=program_kit", 200, undefined, {});
    await valid("/gms/gallery/{slug}", "get", "/gms/gallery/small-grants-program-kit", 200, undefined, {});
    await valid("/gms/workspaces/{workspaceId}/gallery/items/{slug}/copy", "post", `/gms/workspaces/${WS_FUNDER}/gallery/items/small-grants-program-kit/copy`, 201, {});
    const rubric = (await (await h.request("/gms/rubrics", { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Riverbend Community Foundation rubric", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] }) })).json()) as { data: { id: string } };
    const source = { type: "rubric", id: rubric.data.id };
    await valid("/gms/workspaces/{workspaceId}/gallery/preview", "post", `/gms/workspaces/${WS_FUNDER}/gallery/preview`, 200, { source });
    const sub = (await valid("/gms/workspaces/{workspaceId}/gallery/submissions", "post", `/gms/workspaces/${WS_FUNDER}/gallery/submissions`, 201, { source, title: "Fit rubric", summary: "One criterion: fit with the program.", licence: "CC-BY-4.0" })) as { id: string };
    await valid("/gms/gallery/moderation/me", "get", "/gms/gallery/moderation/me", 200);
    await valid("/gms/gallery/moderation/queue", "get", "/gms/gallery/moderation/queue", 200);
    await valid("/gms/gallery/moderation/submissions/{id}/approve", "post", `/gms/gallery/moderation/submissions/${sub.id}/approve`, 200, {});
    await valid("/gms/workspaces/{workspaceId}/gallery/submissions", "get", `/gms/workspaces/${WS_FUNDER}/gallery/submissions`, 200);
    await valid("/gms/workspaces/{workspaceId}/gallery/submissions/{id}/withdraw", "post", `/gms/workspaces/${WS_FUNDER}/gallery/submissions/${sub.id}/withdraw`, 200, {});
    const again = (await valid("/gms/workspaces/{workspaceId}/gallery/submissions", "post", `/gms/workspaces/${WS_FUNDER}/gallery/submissions`, 201, { source, title: "Fit rubric", summary: "One criterion: fit with the program.", licence: "CC-BY-4.0" })) as { id: string };
    await valid("/gms/gallery/moderation/submissions/{id}/reject", "post", `/gms/gallery/moderation/submissions/${again.id}/reject`, 200, { reason: "Add a second criterion so it is useful to others." });
  });
});
