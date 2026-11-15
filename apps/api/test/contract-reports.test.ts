// SPDX-License-Identifier: AGPL-3.0-only
// Contract: the report builder's /gms routes answer as the compiled OpenAPI document says
// (`pnpm spec:compile`), CSV bodies are streamed with formula-safe cells, and saving or scheduling
// is refused to anything but a signed-in person. Skipped when the document has not been compiled;
// CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { r2ReportStore, sendScheduledReports } from "../src/services/report-builder.ts";
import { USER_ADMIN, USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

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

/** An R2 bucket as the Worker binds it, in memory. */
function memoryBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: string) => void objects.set(key, value),
    get: async (key: string) => (objects.has(key) ? { body: new Response(objects.get(key)!).body! } : null),
    delete: async (key: string) => void objects.delete(key),
  };
}

describe.skipIf(!existsSync(SPEC))("report builder contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let officer: Record<string, string>;
  let adminH: Record<string, string>;
  const bucket = memoryBucket();
  const headersFor = async (user: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" });

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function call(who: Record<string, string>, method: string, url: string, body?: unknown) {
    const res = await h.request(url, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return res;
  }
  async function valid(path: string, method: "get" | "post" | "put" | "patch" | "delete", url: string, status: number, body?: unknown, who = officer) {
    const res = await call(who, method.toUpperCase(), url, method === "get" || method === "delete" ? undefined : (body ?? {}));
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
    h.env.EXPORTS = bucket as never;
    officer = await headersFor(USER_OFFICER);
    adminH = await headersFor(USER_ADMIN);
    await h.repos.table("programs").insert({ id: "0190c000-0000-7000-8000-000000000001", workspace_id: WS_FUNDER, name: "Health" });
    await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, title: "=HYPERLINK(\"http://evil\")", program_id: "0190c000-0000-7000-8000-000000000001", status: "active", funding: { awardedAmount: { amount: "1500.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-02-01" } } });
    await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, title: "Clinic navigators", status: "completed", funding: { awardedAmount: { amount: "2500.50", currency: "USD" } } });
  });

  it("builds, saves, runs, schedules and downloads as the document says", async () => {
    const sets = (await valid("/gms/reports/data-sets", "get", "/gms/reports/data-sets", 200)) as unknown as { key: string }[];
    expect(sets.map((s) => s.key)).toEqual(["applications", "awards", "payments", "requirements", "organizations"]);
    const definition = { dataSet: "awards", columns: ["title", "program", "amount", "status"], sort: [{ column: "title", dir: "asc" }] };
    const preview = await valid("/gms/reports/preview", "post", "/gms/reports/preview", 200, definition);
    expect(preview.rows).toEqual([
      ["=HYPERLINK(\"http://evil\")", "Health", 150_000, "active"],
      ["Clinic navigators", "No program", 250_050, "completed"],
    ]);
    await valid("/gms/reports/preview", "post", "/gms/reports/preview", 200, { dataSet: "awards", columns: ["title"], groupBy: ["status"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }], filters: [{ column: "awardDate", op: "between", from: "2027-01-01", to: "endOfYear" }] });
    const unknown = await call(officer, "POST", "/gms/reports/preview", { dataSet: "awards", columns: ["title", "ein"] });
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { errors: { code: string }[] }).errors[0]?.code).toBe("unknown_column");

    const csv = await call(officer, "POST", "/gms/reports/export", { definition, name: "Board pack" });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("Content-Disposition")).toBe(`attachment; filename="board-pack-2027-04-16.csv"`);
    expect(csv.headers.get("X-Report-Rows")).toBe("2");
    expect(await csv.text()).toBe(`Award,Program,Awarded amount,Status\r\n"'=HYPERLINK(""http://evil"")",Health,1500.00,Active\r\nClinic navigators,No program,2500.50,Completed\r\n`);

    const list = (await valid("/gms/report-views", "get", "/gms/report-views", 200)) as { starters: unknown[] };
    expect(list.starters.length).toBe(6);
    const view = (await valid("/gms/report-views", "post", "/gms/report-views", 201, { name: "Board pack", visibility: "workspace", definition })) as { id: string };
    await valid("/gms/report-views/{id}", "get", `/gms/report-views/${view.id}`, 200);
    await valid("/gms/report-views/{id}", "get", "/gms/report-views/starter-overdue-reports", 200);
    await valid("/gms/report-views/{id}", "patch", `/gms/report-views/${view.id}`, 200, { description: "For the board" });
    await valid("/gms/report-views/{id}/run", "post", `/gms/report-views/${view.id}/run`, 200);
    await valid("/gms/report-views/{id}/run", "post", "/gms/report-views/starter-applications-by-stage/run", 200);
    const viewCsv = await call(officer, "GET", `/gms/report-views/${view.id}/export`);
    expect(viewCsv.status).toBe(200);
    expect((await viewCsv.text()).split("\r\n")[0]).toBe("Award,Program,Awarded amount,Status");
    const recipients = (await valid("/gms/report-views/{id}/recipients", "get", `/gms/report-views/${view.id}/recipients`, 200)) as unknown as { userId: string; role: string }[];
    // The auditor reads reports too; nobody outside the workspace is offered.
    expect(recipients.map((r) => r.role).sort()).toEqual(["admin", "auditor", "program_officer"]);
    const scheduled = (await valid("/gms/report-views/{id}/schedule", "put", `/gms/report-views/${view.id}/schedule`, 200, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: [USER_ADMIN, USER_OFFICER] })) as { schedule: { nextSendAt: string } };
    expect(scheduled.schedule.nextSendAt).toBe("2027-05-01T13:00:00.000Z");
    expect((await call(officer, "PUT", `/gms/report-views/${view.id}/schedule`, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: ["board@example.org"] })).status).toBe(400);

    // The job writes the file; the admin downloads it signed in.
    h.clock.now = new Date("2027-05-01T13:05:00Z");
    const base = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } };
    expect(await sendScheduledReports(base, r2ReportStore(bucket))).toMatchObject({ sent: 1, emails: 2 });
    // Sessions are issued against the harness clock, which moved.
    officer = await headersFor(USER_OFFICER);
    adminH = await headersFor(USER_ADMIN);
    const files = (await valid("/gms/report-files", "get", "/gms/report-files", 200, undefined, adminH)) as unknown as { id: string; period: string }[];
    expect(files.map((f) => f.period)).toEqual(["2027-05"]);
    const file = await call(adminH, "GET", `/gms/report-files/${files[0]!.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Disposition")).toBe(`attachment; filename="board-pack-2027-05.csv"`);
    expect(await file.text()).toContain(`"'=HYPERLINK(""http://evil"")"`);

    await valid("/gms/report-views/{id}/schedule", "delete", `/gms/report-views/${view.id}/schedule`, 200);
    await valid("/gms/report-views/{id}", "delete", `/gms/report-views/${view.id}`, 200);
    expect(bucket.objects.size).toBe(0);
  });

  it("refuses saving and scheduling to anything but a signed-in person", async () => {
    const token = await h.forge({ scope: "analytics:read awards:read" });
    const res = await h.request("/gms/report-views", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sync", definition: { dataSet: "awards", columns: ["title"] } }) });
    expect(res.status).toBe(403);
    const r = await call(officer, "POST", "/gms/report-views", { name: "Bad", definition: { dataSet: "awards", columns: ["title"] }, sql: "select 1" });
    expect(r.status).toBe(400);
  });
});
