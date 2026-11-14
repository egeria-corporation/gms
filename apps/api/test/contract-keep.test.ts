// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the write-faster and keep-it routes (v1.6.0, v1.7.0) validate against
// the compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been compiled; CI
// compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WS_APPLICANT, harness, type Harness } from "./helpers.ts";
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

describe.skipIf(!existsSync(SPEC))("write faster and keep it contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let s: Scenario;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid(path: string, method: "get" | "post" | "put" | "patch" | "delete", url: string, status: number, body?: unknown) {
    const r = await s.call<{ data: Record<string, unknown> }>(s.applicant, method.toUpperCase(), url, method === "get" ? undefined : (body ?? {}));
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
    h.env.ASSISTANT_ENABLED = "true";
  });

  it("drafting, guidelines, the library, the vault, go/no-go, comments, milestones and the calendar match the document", async () => {
    await s.call(s.applicant, "PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { goNoGoEnabled: true } });
    const oa = (await valid("/gms/outside-applications", "post", "/gms/outside-applications", 201, { title: "Rural clinics 2027", funderName: "Northwind", fullDue: "2027-06-01", stage: "prospect" })) as { id: string };
    const qs = (await valid("/gms/outside-applications/{id}/questions", "post", `/gms/outside-applications/${oa.id}/questions`, 201, { prompt: "Describe the need for families.", limitKind: "words", limitValue: 50 })) as unknown as { id: string }[];
    const lib = (await valid("/gms/my/answers", "post", "/gms/my/answers", 201, { title: "Families we serve", body: "We serve 1,240 families.", variants: { short: "1,240 families." }, tags: ["need"] })) as { id: string };
    await valid("/gms/my/answers/{id}/verify", "post", `/gms/my/answers/${lib.id}/verify`, 200);
    await valid("/gms/outside-questions/{qid}/library", "get", `/gms/outside-questions/${qs[0]!.id}/library`, 200);
    h.llmAnswer.value = { draft: "We serve [number] families.", usedAnswerIds: [lib.id], unknowns: [], staleFlags: [] };
    await valid("/gms/outside-questions/{qid}/draft", "post", `/gms/outside-questions/${qs[0]!.id}/draft`, 200);
    await valid("/gms/outside-questions/{qid}/answer", "put", `/gms/outside-questions/${qs[0]!.id}/answer`, 200, { body: "We serve many families.", provenance: "assist" });
    h.llmAnswer.value = { questions: [{ prompt: "Budget?", limitKind: null, limitValue: null, phase: "full" }], requiredDocuments: ["IRS determination letter"], deadlines: { loiDue: null, fullDue: "2027-06-01" }, cautions: [] };
    await valid("/gms/outside-applications/{id}/questions/parse", "post", `/gms/outside-applications/${oa.id}/questions/parse`, 200, { text: "1. Budget?", mode: "ai" });
    await valid("/gms/outside-applications/{id}/guidelines", "post", `/gms/outside-applications/${oa.id}/guidelines`, 200, { name: "Guidelines.txt", mime: "text/plain", contentBase64: btoa("1. Budget?") });
    const doc = (await valid("/gms/vault", "post", "/gms/vault", 201, { name: "IRS letter.pdf", mime: "application/pdf", contentBase64: btoa("%PDF-1.4"), docType: "irs_letter", expiresOn: "2028-01-01" })) as { id: string };
    await valid("/gms/vault", "get", "/gms/vault", 200);
    await valid("/gms/vault/{docId}", "patch", `/gms/vault/${doc.id}`, 200, { expiresOn: null });
    await valid("/gms/outside-applications/{id}/required-documents", "put", `/gms/outside-applications/${oa.id}/required-documents`, 200, { items: [{ label: "IRS determination letter", docType: "irs_letter" }] });
    await valid("/gms/outside-applications/{id}/required-documents/use-from-vault", "post", `/gms/outside-applications/${oa.id}/required-documents/use-from-vault`, 200, { label: "IRS determination letter", documentId: doc.id });
    await valid("/gms/outside-questions/{qid}/comments", "post", `/gms/outside-questions/${qs[0]!.id}/comments`, 201, { body: "Check the number." });
    await valid("/gms/outside-applications/{id}/comments", "get", `/gms/outside-applications/${oa.id}/comments`, 200);
    await valid("/gms/outside-applications/{id}/milestones", "get", `/gms/outside-applications/${oa.id}/milestones`, 200);
    await valid("/gms/outside-applications/{id}/milestones", "post", `/gms/outside-applications/${oa.id}/milestones`, 201, { tasks: [{ title: "Draft due", dueOn: "2027-05-18" }] });
    await valid("/gms/pipeline/calendar", "get", "/gms/pipeline/calendar?month=2027-06", 200);
    await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "deciding" });
    await valid("/gms/outside-applications/{id}/go-no-go", "post", `/gms/outside-applications/${oa.id}/go-no-go`, 200, { eligibility: "pass", scores: { fit: 4, capacity: 3, effort: 3, relationship: 2 }, decision: "go", to: "drafting" });
    await valid("/gms/outside-applications/{id}", "get", `/gms/outside-applications/${oa.id}`, 200);
    await valid("/gms/vault/{docId}", "delete", `/gms/vault/${doc.id}`, 200);
  });

  it("obligations, reports, the award page, closeout, Awarded funding, the next cycle and the funding summary match the document", async () => {
    const oa = (await valid("/gms/outside-applications", "post", "/gms/outside-applications", 201, { title: "Clinic grant", funderName: "Northwind", programName: "Rural Health Fund" })) as { id: string };
    await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/submit`, { submittedAt: "2027-01-10", method: "portal" });
    await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "60000.00", currency: "USD" }, grantStart: "2027-01-01", grantEnd: "2028-12-31" });
    const report = (await valid("/gms/outside-applications/{id}/obligations", "post", `/gms/outside-applications/${oa.id}/obligations`, 201, { kind: "report", title: "Interim report", dueOn: "2027-03-01" })) as { id: string };
    const made = (await valid("/gms/outside-applications/{id}/obligations", "post", `/gms/outside-applications/${oa.id}/obligations`, 201, { kind: "report", title: "Progress report", series: { everyMonths: 6, startOn: "2027-07-01" } })) as unknown as { series: { id: string } };
    const pay = (await valid("/gms/outside-applications/{id}/obligations", "post", `/gms/outside-applications/${oa.id}/obligations`, 201, { kind: "payment_expected", title: "First payment", dueOn: "2027-02-01", amount: { amount: "30000.00", currency: "USD" } })) as { id: string };
    await valid("/gms/outside-obligations/{oid}/status", "post", `/gms/outside-obligations/${pay.id}/status`, 200, { to: "received", completedOn: "2027-02-03" });
    await valid("/gms/outside-obligations/{oid}", "patch", `/gms/outside-obligations/${report.id}`, 200, { notes: "Send to Ana." });
    const q = (await valid("/gms/outside-obligations/{oid}/questions", "post", `/gms/outside-obligations/${report.id}/questions`, 201, { prompt: "What changed?" })) as unknown as { id: string }[];
    await s.call(s.applicant, "PUT", `/gms/outside-questions/${q[0]!.id}/answer`, { body: "We opened a clinic." });
    await valid("/gms/outside-obligations/{oid}/questions", "get", `/gms/outside-obligations/${report.id}/questions`, 200);
    const other = (await s.call<{ data: { obligations: { id: string; kind: string }[] } }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}/obligations`)).body.data.obligations.find((o) => o.kind === "report" && o.id !== report.id)!;
    await valid("/gms/outside-obligations/{oid}/reuse", "get", `/gms/outside-obligations/${other.id}/reuse`, 200);
    await valid("/gms/outside-obligations/{oid}/submit", "post", `/gms/outside-obligations/${report.id}/submit`, 200, { submittedAt: "2027-03-02", confirmationRef: "NW-1" });
    await valid("/gms/outside-obligation-series/{sid}", "patch", `/gms/outside-obligation-series/${made.series.id}`, 200, { everyMonths: 12 });
    await valid("/gms/outside-applications/{id}/obligations", "get", `/gms/outside-applications/${oa.id}/obligations`, 200);
    await valid("/gms/outside-awards/{id}", "get", `/gms/outside-awards/${oa.id}`, 200);
    await valid("/gms/my/awarded-funding", "get", "/gms/my/awarded-funding", 200);
    await valid("/gms/outside-obligation-series/{sid}", "delete", `/gms/outside-obligation-series/${made.series.id}`, 200);
    await valid("/gms/funding-summary", "get", "/gms/funding-summary", 200);
    const declined = (await valid("/gms/outside-applications", "post", "/gms/outside-applications", 201, { title: "Declined one", funderName: "Southwind", programName: "Arts Fund" })) as { id: string };
    await valid("/gms/outside-applications/{id}/next-cycle-alert", "post", `/gms/outside-applications/${declined.id}/next-cycle-alert`, 201);
    await valid("/gms/outside-applications/{id}/next-cycle-alert", "post", `/gms/outside-applications/${declined.id}/next-cycle-alert`, 200);
    // Settle everything and close out.
    for (const o of (await s.call<{ data: { obligations: { id: string; status: string; kind: string }[] } }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}/obligations`)).body.data.obligations) {
      if (o.status === "submitted") await s.call(s.applicant, "POST", `/gms/outside-obligations/${o.id}/status`, { to: "done" });
      else if (o.status !== "received" && o.status !== "done") await s.call(s.applicant, "DELETE", `/gms/outside-obligations/${o.id}`);
    }
    await valid("/gms/outside-applications/{id}/close-out", "post", `/gms/outside-applications/${oa.id}/close-out`, 200);
  });
});
