// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the award sharing routes validate against the compiled OpenAPI
// document (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

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

const GRANTEE_ADMIN = "12121212-1212-4121-8121-121212121212";
const PROGRAM = "17171717-1717-4171-8171-171717171717";

describe.skipIf(!existsSync(SPEC))("award sharing contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let funder: Record<string, string>;
  let grantee: Record<string, string>;
  let award: { id: string; public_slug: string };

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(who: Record<string, string> | null, path: string, method: "get" | "put", url: string, status: number, body?: unknown): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), ...(who ? { headers: who } : {}), ...(method === "get" ? {} : { body: JSON.stringify(body ?? {}) }) });
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
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
    await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community Health" });
    award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, program_id: PROGRAM, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "150000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-03-01" } } } as never);
    funder = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    grantee = { ...bearer(await h.session(GRANTEE_ADMIN)).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
  });

  it("settings, the panels and the switches match the document", async () => {
    await valid(funder, "/gms/award-sharing/settings", "get", "/gms/award-sharing/settings", 200);
    await valid(funder, "/gms/awards/{id}/sharing", "get", `/gms/awards/awd_${award.id}/sharing`, 200);
    await valid(funder, "/gms/award-sharing/settings", "put", "/gms/award-sharing/settings", 200, { listAwards: true });
    const panel = await valid<{ kit: unknown }>(funder, "/gms/awards/{id}/sharing", "get", `/gms/awards/awd_${award.id}/sharing`, 200);
    expect(panel.kit).not.toBeNull();
    await valid(grantee, "/gms/my/awards/{id}/sharing", "get", `/gms/my/awards/awd_${award.id}/sharing`, 200);
    await valid(grantee, "/gms/my/awards/{id}/listing", "put", `/gms/my/awards/awd_${award.id}/listing`, 200, { unlisted: false });
    await valid(funder, "/gms/programs/{id}/award-sharing", "put", `/gms/programs/${PROGRAM}/award-sharing`, 200, { awardsConfidential: false });
    await valid(funder, "/gms/awards/{id}/confidential", "put", `/gms/awards/awd_${award.id}/confidential`, 200, { confidential: false });
  });

  it("the public pages match the document", async () => {
    await valid(funder, "/gms/award-sharing/settings", "put", "/gms/award-sharing/settings", 200, { listAwards: true, showAmounts: true });
    const page = await valid<{ awards: { slug: string }[] }>(null, "/gms/public/funders/{handle}/awards", "get", "/gms/public/funders/riverbend/awards", 200);
    await valid(null, "/gms/public/funders/{handle}/awards/{slug}", "get", `/gms/public/funders/riverbend/awards/${page.awards[0]!.slug}`, 200);
    await valid(null, "/gms/public/funders/{handle}/awards/{slug}", "get", "/gms/public/funders/riverbend/awards/nothing-000000000000", 404);
    await valid(funder, "/gms/award-sharing/settings", "put", "/gms/award-sharing/settings", 200, { showAmounts: false });
    await valid(null, "/gms/public/funders/{handle}/awards", "get", "/gms/public/funders/riverbend/awards", 200);
  });
});
