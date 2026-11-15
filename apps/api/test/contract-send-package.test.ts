// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the send-to-funder and guest reviewer routes (C4) validate against
// the compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI
// compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
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

describe.skipIf(!existsSync(SPEC))("send to the funder and guest reviewer contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(who: Record<string, string>, path: string, method: "get" | "post" | "put", url: string, status: number, body?: unknown) {
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
    (h.mailer as unknown as { sendsAttachments: boolean }).sendsAttachments = true;
    h.directory.users.set("ffffffff-ffff-4fff-8fff-ffffffffffff", { email: "ana.ruiz@aldercreekfs.example", name: "Ana Ruiz" });
  });

  it("the package, its email and the footer setting match the document", async () => {
    const oa = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind", fullDue: "2027-05-01", askAmount: { amount: "50000.00", currency: "USD" } })).body.data;
    await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { askByYear: [{ year: 2027, amount: { amount: "50000.00", currency: "USD" } }] });
    const qs = (await s.call<{ data: { id: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Describe the need." }, { prompt: "Who is served?" }] })).body.data;
    await s.call(s.applicant, "PUT", `/gms/outside-questions/${qs[0]!.id}/answer`, { body: "Families travel 46 miles." });
    await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/documents`, { name: "Support.pdf", mime: "application/pdf", contentBase64: btoa("%PDF-1.4") });
    await valid(s.applicant, "/gms/outside-applications/{id}/package", "get", `/gms/outside-applications/${oa.id}/package`, 200);
    const p = (await valid(s.applicant, "/gms/outside-applications/{id}/package/email/preview", "post", `/gms/outside-applications/${oa.id}/package/email/preview`, 200, { to: "lee@northwind.example", message: "Here it is." })) as { digest: string };
    await valid(s.applicant, "/gms/outside-applications/{id}/package/email", "post", `/gms/outside-applications/${oa.id}/package/email`, 200, { to: "lee@northwind.example", message: "Here it is.", digest: p.digest });
    await valid(s.applicant, "/gms/send-package/settings", "put", "/gms/send-package/settings", 200, { poweredBy: false });
    // A blocked answer is listed in the same shape.
    await s.call(s.applicant, "PUT", `/gms/outside-questions/${qs[1]!.id}/answer`, { body: "Account 000123456789." });
    await valid(s.applicant, "/gms/outside-applications/{id}/package", "get", `/gms/outside-applications/${oa.id}/package`, 200);
  });

  it("the guest reviewer welcome, done screen and offer events match the document", async () => {
    const GUEST = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
    h.directory.users.set(GUEST, { email: "jo@city-foundation.org", name: "Jo" });
    const inv = (await s.call<{ data: { token: string } }>(s.funder, "POST", "/gms/review-assignments/invite", { email: "jo@city-foundation.org", competitionId: s.compId })).body.data;
    const plain = { ...bearer(await h.session(GUEST)).headers, "Content-Type": "application/json" };
    await s.call(plain, "POST", "/gms/invitations/accept", { token: inv.token });
    const guest = { ...plain, "X-GMS-Workspace": WS_FUNDER };
    const app = await h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: s.uuid.comp, opportunity_id: s.uuid.opp, title: "Mobile Health Navigation", stage: "loi", status: "submitted", cg_status: "submitted", submitted_at: h.clock.now.toISOString() });
    const rubric = (await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER }))[0]!;
    await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: app.id, stage: "loi", reviewer_user_id: GUEST, rubric_id: rubric.id, rubric_version: rubric.version, due_at: "2027-03-10T23:59:00.000Z", status: "submitted" });
    await valid(guest, "/gms/guest-review/welcome", "get", "/gms/guest-review/welcome", 200);
    await valid(guest, "/gms/guest-review/done", "get", "/gms/guest-review/done", 200);
    await valid(guest, "/gms/guest-review/offer", "post", "/gms/guest-review/offer", 200, { event: "shown" });
    await valid(guest, "/gms/guest-review/done", "get", "/gms/guest-review/done", 200);
  });
});
