// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the open data routes validate against the compiled OpenAPI document
// (`pnpm spec:compile`), including the CommonGrants records in the CommonGrants download. Skipped
// when the document has not been compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

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

describe.skipIf(!existsSync(SPEC))("open data contract", () => {
  let ajv: Ajv;
  let h: Harness;

  const schema = (path: string, method: string, status: string, media: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer(media)}/schema` });
  async function valid(path: string, method: "get" | "put", url: string, who: Record<string, string> | null, body?: unknown, media = "application/json") {
    const res = await h.request(url, { method: method.toUpperCase(), headers: who ?? {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status, `${method} ${url} ${JSON.stringify(json).slice(0, 300)}`).toBe(200);
    expect(res.headers.get("Content-Type") ?? "").toContain(media.split(";")[0]!);
    const v = schema(path, method, "200", media);
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return json;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    const ws = h.repos.table("workspaces");
    await ws.update({ id: WS_APPLICANT }, { passport_org_id: "0193a1c0-0000-7000-8000-0000000000a1", profile_source: "passport", legal_name: "Alder Creek Family Services", ein: "941234567", org_projection: { id: "0193a1c0-0000-7000-8000-0000000000a1", name: "Alder Creek Family Services", addresses: { primary: { street1: "418 Mill Road", city: "Alder Creek", stateOrProvince: "OR", postalCode: "97000", country: "US" } } } as never });
    await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application", granted_at: "2027-01-01T00:00:00Z" });
    const program = await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Community Health" });
    for (const [title, status] of [["Navigator program", "active"], ["Offer pending", "offered"], ["Cancelled grant", "cancelled"]] as const) {
      await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, title, status, recipient_workspace_id: WS_APPLICANT, program_id: program.id, funding: { awardedAmount: { amount: "50000.00", currency: "USD" } } as never, key_dates: { awardDate: { name: "Award date", eventType: "singleDate", date: "2027-03-01" }, periodOfPerformance: { name: "Period", eventType: "dateRange", startDate: "2027-04-01", endDate: "2028-03-31" } } as never });
    }
    await h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, slug: "community-health-2027", title: "Community Health Grants 2027", description: "Grants for community health navigation.", status: "open", published_at: "2027-02-01T12:00:00Z" });
  });

  it("the summary, settings, confidential mark, downloads and public feed match the document", async () => {
    const officer = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    const s = (await valid("/gms/open-data/summary", "get", "/gms/open-data/summary?year=2027", officer)) as { data: { awards: { awardId: string; title: string }[] } };
    const offer = s.data.awards.find((a) => a.title === "Offer pending")!;
    // The document does describe these shapes: a summary without its counts is refused.
    expect(schema("/gms/open-data/summary", "get", "200", "application/json")({ status: 200, message: "Success", data: { ...s.data, counts: undefined } })).toBe(false);
    expect(schema("/gms/open-data/{handle}/360giving.json", "get", "200", "application/json; charset=utf-8")({ grants: [{ id: "x" }] })).toBe(false);
    await valid("/gms/open-data/awards/{id}/confidential", "put", `/gms/open-data/awards/${offer.awardId}/confidential`, officer, { confidential: true });
    await valid("/gms/open-data/360giving.json", "get", "/gms/open-data/360giving.json", officer, undefined, "application/json; charset=utf-8");
    await valid("/gms/open-data/commongrants.json", "get", "/gms/open-data/commongrants.json?from=2027-01-01", officer, undefined, "application/json; charset=utf-8");
    await valid("/gms/open-data/settings", "put", "/gms/open-data/settings", admin, { threeSixtyGivingPrefix: "360G-riverbend", publishFeed: true });
    await valid("/gms/open-data/summary", "get", "/gms/open-data/summary", officer);
    await valid("/gms/open-data/{handle}/360giving.json", "get", "/gms/open-data/riverbend/360giving.json", null, undefined, "application/json; charset=utf-8");
  });
});
