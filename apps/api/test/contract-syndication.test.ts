// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the syndication routes (E2) validate against the compiled OpenAPI
// document (`pnpm spec:compile`): the "Share this call" panel, the feeds switch, the PND preview
// and send, the JSON feed and the OpenGrants index feed. Skipped when it has not been compiled; CI
// compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const OPP = "0190e300-0000-7000-8000-0000000000a1";

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

describe.skipIf(!existsSync(SPEC))("syndication contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let officer: Record<string, string>;

  const schema = (path: string, method: string, status: string, type = "application/json"): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer(type)}/schema` });
  async function valid(path: string, method: "get" | "post" | "put", url: string, body?: unknown, type?: string, who = officer) {
    const res = await h.request(url, { method: method.toUpperCase(), headers: who, ...(method === "get" ? {} : { body: JSON.stringify(body ?? {}) }) });
    const json = (await res.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
    expect(res.status, `${method} ${url} ${JSON.stringify(json).slice(0, 300)}`).toBe(200);
    if (type) expect(res.headers.get("Content-Type")).toBe(type);
    const v = schema(path, method, "200", type);
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return json;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    officer = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { contactEmail: "grants@riverbendcf.example" } as never });
    await h.repos.table("opportunities").insert({
      id: OPP,
      workspace_id: WS_FUNDER,
      slug: "community-health-2027",
      title: "Community Health Grants 2027",
      description: "Grants for rural clinics.",
      status: "open",
      published_at: "2027-04-02T12:00:00.000Z",
      funding: { maxAwardAmount: { amount: "150000.00", currency: "USD" } },
      key_dates: { closeDate: { name: "Applications close", eventType: "singleDate", date: "2027-06-30" } },
      accepted_applicant_types: ["non_profit_with_501c3"],
    } as never);
  });

  it("the panel, the feeds switch and the PND preview and send match the document", async () => {
    await valid("/gms/opportunities/{id}/syndication", "get", `/gms/opportunities/opp_${OPP}/syndication`);
    await valid("/gms/opportunities/{id}/syndication/feeds", "put", `/gms/opportunities/opp_${OPP}/syndication/feeds`, { feeds: true });
    const p = (await valid("/gms/opportunities/{id}/syndication/pnd/preview", "post", `/gms/opportunities/opp_${OPP}/syndication/pnd/preview`)).data as { digest: string };
    await valid("/gms/opportunities/{id}/syndication/pnd", "post", `/gms/opportunities/opp_${OPP}/syndication/pnd`, { digest: p.digest });
    await valid("/gms/opportunities/{id}/syndication", "get", `/gms/opportunities/opp_${OPP}/syndication`);
  });

  it("the JSON feed and the OpenGrants index feed match the document", async () => {
    const f = await valid("/gms/public/feeds/opportunities.json", "get", "/gms/public/feeds/opportunities.json", undefined, "application/feed+json; charset=utf-8", {});
    expect((f.items as unknown[]).length).toBe(1);
    const g = await valid("/gms/public/feeds/opengrants.json", "get", "/gms/public/feeds/opengrants.json", undefined, "application/json; charset=utf-8", {});
    expect((g.items as unknown[]).length).toBe(1);
  });
});
