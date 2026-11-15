// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the v1.7.0 draft invitation, note and AI summary routes validate
// against the compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been
// compiled; CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SESSION_SECRET, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

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

describe.skipIf(!existsSync(SPEC))("draft invitations and AI summary contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(who: Record<string, string>, path: string, method: "get" | "post", url: string, status: number, body?: unknown) {
    const r = await s.call<{ data: Record<string, unknown> }>(who, method.toUpperCase(), url, method === "get" ? undefined : (body ?? {}));
    expect(r.status, `${method} ${url} ${JSON.stringify(r.body).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(r.body);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return r.body.data;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    s = await scenario(h);
  });

  it("invitations into a draft, acceptance, the cowriter's view and the one-time note match the document", async () => {
    const oa = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind", stage: "drafting" })).body.data;
    const q = (await s.call<{ data: { id: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Describe the need." })).body.data[0]!;
    await valid(s.applicant, "/gms/draft-invitations", "post", "/gms/draft-invitations", 201, { email: "lena@fischergrants.example", draft: { kind: "outside_application", id: oa.id, questionId: q.id } });
    await valid(s.applicant, "/gms/draft-invitations", "get", `/gms/draft-invitations?kind=outside_application&id=${oa.id}`, 200);
    const token = new URL(h.mailer.sent.at(-1)!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    const iat = Math.floor(h.clock.now.getTime() / 1000);
    const jwt = await new SignJWT({ aal: "aal1", email: "lena@fischergrants.example", role: "authenticated" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject("c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0").setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
    const me = { ...bearer(jwt).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
    await valid(me, "/gms/invitations/accept", "post", "/gms/invitations/accept", 200, { token });
    await valid(me, "/gms/outside-applications/{id}", "get", `/gms/outside-applications/${oa.id}`, 200);
    await valid(s.applicant, "/gms/me/notes", "get", "/gms/me/notes", 200);
    await valid(s.applicant, "/gms/me/notes/dismiss", "post", "/gms/me/notes/dismiss", 200, { note: "invite_teammate" });
  });

  it("the AI summary matches the document", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    const uuid = started.body.data.id;
    await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." } });
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/submit`)).status).toBe(200);
    await valid(s.funder, "/gms/assist/summary", "get", `/gms/assist/summary?applicationId=app_${uuid}`, 200);
    h.llmAnswer.value = { summary: "Asks for rides.", strengths: [], openQuestions: [], quotes: [{ field: "need", text: "Families travel 46 miles." }], fromExternalSystems: [], cautions: [] };
    await valid(s.funder, "/gms/assist/summary", "post", "/gms/assist/summary", 200, { applicationId: `app_${uuid}` });
    await valid(s.funder, "/gms/assist/summary", "post", "/gms/assist/summary", 200, { applicationId: `app_${uuid}` });
  });
});
