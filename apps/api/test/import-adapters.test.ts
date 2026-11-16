// SPDX-License-Identifier: AGPL-3.0-only
// Importer adapters over /gms/imports (v1.8.0): a grants system's export recognised and mapped by
// its preset, never-awarded rows set aside, sensitive columns dropped first whatever the adapter;
// Fluxx and Zengine read with the funder's own credentials (checked, stored encrypted, deleted
// when the import has read the source to its end, on disconnect, or after a week unused), 5,000
// rows a run and resumable; files from a zip attached to the imported awards, funder-only.
// Fluxx and Zengine are fake instances behind a stubbed `fetch`; nothing here calls them.
import { FLUXX_COLUMNS } from "@gms/connectors";
import { FLUXX_PULL_COLUMNS } from "@gms/importers";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const USER_APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");
const LONG = ["0000", "0000", "0012"].join("");
const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/importers/test/fixtures/adapters/${name}`, import.meta.url), "utf8")
    .replace("{NINE}", NINE)
    .replace("{LONG}", LONG);

let h: Harness;
let funderAdmin: Record<string, string>;
let officer: Record<string, string>;
let applicant: Record<string, string>;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
async function call<T>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as { data: T; message?: string; errors?: { code: string; field?: string }[] } };
}
async function data<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

type Run = { id: string; status: string; adapter: { key: string; system: string } | null; nextPage: number | null; reconciliation: { rows: number; create: number; skip: number; error: number }; dropped: { column: string }[] };
type Read = { mapping: Record<string, string>; adapter: { key: string } | null; detected: { key: string; matched: string[] } | null; columns: { name: string; samples: string[] }[]; dropped: { column: string; reason: string }[]; source: { label: string; nextPage?: number | null; total?: number | null } };
type Preview = { run: Run; rows: { line: number; outcome: string; reason: string | null; title: string }[] };

async function commitAll(who: Record<string, string>, runId: string) {
  for (let i = 0; i < 400; i++) {
    const c = await data<{ done: boolean; run: Run }>(who, "POST", `/gms/imports/runs/${runId}/commit`);
    if (c.done) return c.run;
  }
  throw new Error("the import did not finish");
}

beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_ADMIN, role: "admin" });
  funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
  officer = await headers(USER_OFFICER, WS_FUNDER);
  applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
});
afterEach(() => vi.unstubAllGlobals());

describe("a grants system's export", () => {
  const source = { kind: "csv", text: fixture("submittable.csv"), fileName: "submissions.csv" };

  it("is offered as a system to pick, for grant history only", async () => {
    const s = await data<{ adapters: { key: string; system: string; via: string; steps: string[]; attachments: string | null }[]; sources: { kind: string }[] }>(funderAdmin, "GET", "/gms/imports/sources?target=award_history");
    expect(s.adapters.map((a) => a.key)).toEqual(["good_grants", "sm_apply", "submittable", "foundant_glm", "smartsimple", "openwater", "fluxx", "zengine"]);
    expect(s.adapters.find((a) => a.key === "submittable")).toMatchObject({ system: "Submittable", via: "file", attachments: expect.stringMatching(/zip/) });
    expect(s.sources.map((x) => x.kind)).toEqual(["csv", "xlsx", "google_sheets", "airtable", "fluxx", "zengine"]);
    const a = await data<{ adapters: unknown[]; sources: { kind: string }[] }>(applicant, "GET", "/gms/imports/sources?target=outside_applications");
    expect(a.adapters).toEqual([]);
    expect(a.sources.map((x) => x.kind)).not.toContain("fluxx");
  });

  it("is recognised by its header row, with the sensitive columns dropped first", async () => {
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source });
    expect(r.detected).toMatchObject({ key: "submittable" });
    expect(r.adapter).toEqual({ key: "submittable", system: "Submittable" });
    expect(r.mapping).toMatchObject({ sourceId: "Submission ID", title: "Title", recipientName: "Organization", awardedAmount: "Amount Awarded", programName: "Category", status: "Status", awardDate: "Decision Date" });
    expect(r.dropped.map((d) => [d.column, d.reason])).toEqual([
      ["Bank acct", "header"],
      ["Reference", "identity_number"],
    ]);
    expect(JSON.stringify(r)).not.toContain(NINE);
    expect(r.columns.map((c) => c.name)).not.toContain("Reference");
  });

  it("uses the system the person names, and says which one the file looks like", async () => {
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source, adapter: "good_grants" });
    expect(r.adapter).toMatchObject({ key: "good_grants" });
    expect(r.detected).toMatchObject({ key: "submittable" });
    const refused = await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source, adapter: "submittable" });
    expect([refused.status, refused.body.errors?.[0]?.code]).toEqual([422, "adapter_not_for_target"]);
    const api = await call(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source, adapter: "fluxx" });
    expect([api.status, api.body.errors?.[0]?.code]).toEqual([422, "adapter_mismatch"]);
  });

  it("imports the awarded submissions and sets aside the rest, with the reason", async () => {
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source });
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source, adapter: "submittable", mapping: r.mapping });
    expect(p.run.adapter).toEqual({ key: "submittable", system: "Submittable" });
    expect(p.run.reconciliation).toMatchObject({ rows: 5, create: 3, skip: 2, error: 0 });
    expect(p.rows.filter((x) => x.outcome === "skip").map((x) => x.reason)).toEqual(["Not awarded in Submittable (Status: Declined)", "Not awarded in Submittable (Status: In-Progress)"]);
    expect(p.run.dropped.map((d) => d.column)).toEqual(["Bank acct", "Reference"]);
    const run = (await h.repos.table("import_runs").one({ id: p.run.id }))!;
    expect(run).toMatchObject({ adapter: "submittable", source_next_page: null });
    // Nothing from a dropped column is in the run or its log.
    const log = await h.repos.table("import_rows").find({ run_id: p.run.id });
    expect(JSON.stringify([run, log])).not.toContain(NINE);
    await commitAll(funderAdmin, p.run.id);
    const awards = await h.repos.table("awards").find({ workspace_id: WS_FUNDER });
    expect(awards.map((a) => a.title).sort()).toEqual(["Clinic van", "Food pantry shelves", "Library hours"]);
    // Imported again: every row is skipped (imported, or never awarded).
    const again = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source, adapter: "submittable", mapping: r.mapping });
    expect(again.run.reconciliation).toMatchObject({ create: 0, skip: 5 });
  });

  it("lets an agent read which system a check came from (MCP get_import_preview), and nothing more", async () => {
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source });
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source, adapter: "submittable", mapping: r.mapping });
    const token = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin awards:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-adapters-1" });
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_import_preview", arguments: { importRunId: p.run.id } } }) });
    const out = ((await res.json()) as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(out).toMatchObject({ id: p.run.id, adapter: { key: "submittable", system: "Submittable" }, nextPage: null, droppedColumns: ["Bank acct", "Reference"], reconciliation: { create: 3, skip: 2 } });
    // No tool connects a grants system or attaches its files: those are a person's, on the import screen.
    const list = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    const names = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names.filter((n) => /import|fluxx|zengine|connect/.test(n))).toEqual(["get_import_preview"]);
    const connect = await h.request("/gms/imports/connections/fluxx", { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" }, body: JSON.stringify({ instanceUrl: "https://acme.fluxx.io", clientId: "x", clientSecret: "y" }) });
    expect(connect.status).toBe(403);
  });

  it("records a Foundant GLM payment as paid elsewhere", async () => {
    const glm = { kind: "csv", text: fixture("foundant-glm.csv"), fileName: "glm.csv" };
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: glm });
    expect(r.adapter).toMatchObject({ key: "foundant_glm" });
    expect(r.dropped.map((d) => d.column).sort()).toEqual(["Payee account", "TIN"]);
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: glm, adapter: "foundant_glm", mapping: r.mapping });
    await commitAll(funderAdmin, p.run.id);
    const meals = (await h.repos.table("awards").find({ workspace_id: WS_FUNDER })).find((a) => a.title === "Winter meals")!;
    const [tranche] = await h.repos.table("tranches").find({ award_id: meals.id });
    expect(tranche).toMatchObject({ status: "settled", mode: "resolve", amount_minor: 1_500_000, passport_disbursement_id: null });
  });

  it("reads an OpenWater JSON export", async () => {
    const json = { kind: "json", text: fixture("openwater.json"), fileName: "openwater.json" };
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: json });
    expect(r.adapter).toMatchObject({ key: "openwater" });
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: json, adapter: "openwater", mapping: r.mapping });
    expect(p.run.reconciliation).toMatchObject({ create: 2, skip: 1 });
  });
});

describe("files from a system's zip", () => {
  const source = { kind: "csv", text: fixture("submittable.csv"), fileName: "submissions.csv" };
  const pdf = btoa("%PDF-1.4 a made-up submission");

  async function imported() {
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source });
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source, adapter: "submittable", mapping: r.mapping });
    return p.run.id;
  }

  it("are matched by path only, and only once the import has finished", async () => {
    const id = await imported();
    const early = await call(funderAdmin, "POST", `/gms/imports/runs/${id}/files/match`, { paths: ["70012345 - Clinic van/Submission.pdf"] });
    expect([early.status, early.body.errors?.[0]?.code]).toEqual([409, "import_not_finished"]);
    await commitAll(funderAdmin, id);
    const m = await data<{ matched: { path: string; title: string; by: string }[]; unmatched: { path: string; why: string }[] }>(funderAdmin, "POST", `/gms/imports/runs/${id}/files/match`, { paths: ["70012345 - Clinic van/Submission.pdf", "Library hours/budget.xlsx", "70012346/Submission.pdf", "__MACOSX/._x"] });
    expect(m.matched.map((x) => [x.path, x.title, x.by])).toEqual([
      ["70012345 - Clinic van/Submission.pdf", "Clinic van", "id"],
      ["Library hours/budget.xlsx", "Library hours", "title"],
    ]);
    expect(m.unmatched).toEqual([{ path: "70012346/Submission.pdf", name: "Submission.pdf", why: "No imported record matches its name" }]);
  });

  it("are attached to the award they match, as the funder's own documents, once each", async () => {
    const id = await imported();
    await commitAll(funderAdmin, id);
    const first = await call<{ file: { name: string; award: string; line: number }; created: boolean }>(funderAdmin, "POST", `/gms/imports/runs/${id}/files`, { path: "70012345 - Clinic van/Submission.pdf", contentBase64: pdf });
    expect(first.status).toBe(201);
    expect(first.body.data.file).toMatchObject({ name: "Submission.pdf", line: 2 });
    const again = await call<{ created: boolean }>(funderAdmin, "POST", `/gms/imports/runs/${id}/files`, { path: "70012345 - Clinic van/Submission.pdf", contentBase64: pdf });
    expect([again.status, again.body.data.created]).toEqual([200, false]);
    const docs = await h.repos.table("documents").find({ subject_type: "imported_award_file" });
    const award = (await h.repos.table("awards").find({ workspace_id: WS_FUNDER })).find((a) => a.title === "Clinic van")!;
    expect(docs.map((d) => [d.workspace_id, d.owner_workspace_id, d.subject_id, d.mime])).toEqual([[WS_FUNDER, WS_FUNDER, award.id, "application/pdf"]]);
    expect([...h.storage.files.keys()]).toEqual([expect.stringMatching(new RegExp(`^imports/${id}/[0-9a-f]{64}$`))]);
    expect((await data<{ name: string }[]>(funderAdmin, "GET", `/gms/imports/runs/${id}/files`)).map((f) => f.name)).toEqual(["Submission.pdf"]);
    // The funder sees it on the award page; the grantee never does, even once the award is theirs.
    const listed = await call<{ name: string }[]>(funderAdmin, "GET", `/gms/awards/${first.body.data.file.award}/documents`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((d) => d.name)).toContain("Submission.pdf");
    await h.repos.table("awards").update({ id: award.id }, { recipient_workspace_id: WS_APPLICANT, recipient_individual: null });
    const grantee = await call(applicant, "GET", `/gms/my/awards/${first.body.data.file.award}/documents`);
    expect(grantee.status).toBe(200);
    expect(JSON.stringify(grantee.body)).not.toContain("Submission.pdf");
  });

  it("refuses a file that matches nothing, a bank document's name, and any caller but a person", async () => {
    const id = await imported();
    await commitAll(funderAdmin, id);
    const none = await call(funderAdmin, "POST", `/gms/imports/runs/${id}/files`, { path: "elsewhere/notes.pdf", contentBase64: pdf });
    expect([none.status, none.body.errors?.[0]?.code]).toEqual([422, "file_not_matched"]);
    const bank = await call(funderAdmin, "POST", `/gms/imports/runs/${id}/files`, { path: "70012345 - Clinic van/voided check.pdf", contentBase64: pdf });
    expect([bank.status, bank.body.errors?.[0]?.code]).toEqual([422, "sensitive_document"]);
    const token = await clientCredentialsToken(h);
    const agent = await h.request(`/gms/imports/runs/${id}/files`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" }, body: JSON.stringify({ path: "70012345 - Clinic van/Submission.pdf", contentBase64: pdf }) });
    expect(agent.status).toBe(403);
    const other = await call(officer, "POST", `/gms/imports/runs/${id}/files`, { path: "70012345 - Clinic van/Submission.pdf", contentBase64: pdf });
    expect(other.status).toBe(403);
  });
});

// ------------------------------------------------------------------ fake Fluxx and Zengine

const FLUXX_SECRET = "fluxx-secret-made-up";
const ZTOKEN = "zengine-token-made-up";

function fakeSources(opts: { grants: number; grantedEvery: number; zengine429?: boolean }) {
  const seen: { method: string; url: string }[] = [];
  const grants = Array.from({ length: opts.grants }, (_, i) => ({ id: 1000 + i, base_request_id: `R-${i}`, project_title: `Project ${i}`, amount_requested: 2000, amount_recommended: i % opts.grantedEvery === 0 ? 1500 : null, granted: i % opts.grantedEvery === 0, state: i % opts.grantedEvery === 0 ? "granted" : "declined", grant_approved_at: "2024-02-15T00:00:00Z", grant_begins_at: "2024-03-01T00:00:00Z", grant_ends_at: "2025-02-28T00:00:00Z", program_organization_id: 1 }));
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    seen.push({ method, url: url.href });
    const auth = new Headers(init?.headers).get("authorization");
    if (url.host === "acme.fluxx.io") {
      if (url.pathname === "/oauth/token") {
        const form = new URLSearchParams(String(init?.body));
        return form.get("client_secret") === FLUXX_SECRET ? json(200, { access_token: "fa" }) : json(401, { error: "invalid_client" });
      }
      if (auth !== "Bearer fa") return json(401, {});
      const q = url.searchParams;
      const page = Number(q.get("page"));
      const per = Number(q.get("per_page"));
      const model = url.pathname.split("/").pop()!;
      const rows = model === "grant_request" ? grants : model === "organization" ? [{ id: 1, name: "Harbor Food Bank" }] : grants.filter((g) => g.granted).map((g) => ({ id: g.id + 9000, request_id: g.id, amount_paid: 1000, paid_at: "2024-04-01T00:00:00Z", has_been_paid: true }));
      return json(200, { records: { [model]: rows.slice((page - 1) * per, page * per) }, total_entries: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / per)), per_page: per });
    }
    if (url.host === "api.zenginehq.com") {
      if (auth !== `Bearer ${ZTOKEN}`) return json(401, { status: 401 });
      if (opts.zengine429 && url.pathname.endsWith("/records")) return json(429, { status: 429 }, { "Retry-After": "900" });
      const list = (rows: unknown[]) => json(200, { status: 200, code: 2000, totalCount: rows.length, data: rows });
      if (url.pathname === "/v1/workspaces") return list([{ id: 7, name: "Grants" }]);
      if (url.pathname === "/v1/forms") return list([{ id: 42, name: "Awards" }]);
      if (url.pathname === "/v1/forms/42/fields") return list([{ id: 1, label: "Organization", type: "text" }, { id: 2, label: "Amount Awarded", type: "numeric" }, { id: 3, label: "Project title", type: "text" }]);
      if (url.pathname === "/v1/forms/42/records") return list([{ id: 501, name: "Rec 1", field1: "Harbor Food Bank", field2: 3000, field3: "Pantry shelves" }, { id: 502, name: "Rec 2", field1: "Pine Valley Arts", field2: null, field3: "Murals" }]);
    }
    return json(404, {});
  };
  vi.stubGlobal("fetch", fake);
  return seen;
}

const fluxxCreds = { instanceUrl: "https://acme.fluxx.io", clientId: "gms-import", clientSecret: FLUXX_SECRET };

describe("Fluxx, read with the funder's own credentials", () => {
  it("checks the credentials before saving them, and stores them encrypted", async () => {
    fakeSources({ grants: 3, grantedEvery: 1 });
    const bad = await call(funderAdmin, "POST", "/gms/imports/connections/fluxx", { ...fluxxCreds, clientSecret: "wrong" });
    expect([bad.status, bad.body.errors?.[0]?.code]).toEqual([422, "credentials_rejected"]);
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "fluxx" })).toBe(0);
    const notFluxx = await call(funderAdmin, "POST", "/gms/imports/connections/fluxx", { ...fluxxCreds, instanceUrl: "https://evil.example.com" });
    expect([notFluxx.status, notFluxx.body.errors?.[0]?.code]).toEqual([422, "invalid_instance"]);
    const ok = await call<{ connected: boolean; instance: string }>(funderAdmin, "POST", "/gms/imports/connections/fluxx", fluxxCreds);
    expect([ok.status, ok.body.data.connected, ok.body.data.instance]).toEqual([201, true, "https://acme.fluxx.io"]);
    const row = (await h.repos.table("connector_accounts").one({ workspace_id: WS_FUNDER, provider: "fluxx" }))!;
    expect(row.secret_enc).toBeTruthy();
    expect(row.secret_enc).not.toContain(FLUXX_SECRET);
    expect(JSON.stringify(ok.body)).not.toContain(FLUXX_SECRET);
    // Only a funder admin, signed in, connects.
    expect((await call(officer, "POST", "/gms/imports/connections/fluxx", fluxxCreds)).status).toBe(403);
    expect((await call(applicant, "POST", "/gms/imports/connections/fluxx", fluxxCreds)).status).toBe(403);
  });

  it("pulls through the dry run, 5,000 rows a run, resumes, and deletes the credentials when the source is read to its end", async () => {
    const seen = fakeSources({ grants: 5050, grantedEvery: 500 });
    await data(funderAdmin, "POST", "/gms/imports/connections/fluxx", fluxxCreds);
    const r1 = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "fluxx" } });
    expect(r1.adapter).toMatchObject({ key: "fluxx" });
    expect(r1.source).toMatchObject({ nextPage: 51, total: 5050 });
    expect(r1.source.label).toBe("Fluxx · acme.fluxx.io · grant requests (records 1–5,000 of 5,050)");
    expect(r1.mapping).toMatchObject({ sourceId: "Fluxx ID", title: "Project title", recipientName: "Organization", awardedAmount: "Amount awarded", paidAmount: "Amount paid", paidDate: "Last paid on" });
    const p1 = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: { kind: "fluxx" }, adapter: "fluxx", mapping: r1.mapping });
    expect(p1.run).toMatchObject({ nextPage: 51, reconciliation: { rows: 5000, create: 10, skip: 4990, error: 0 } });
    expect(p1.rows.find((x) => x.outcome === "skip")!.reason).toBe("Not awarded in Fluxx (Granted: No)");
    await commitAll(funderAdmin, p1.run.id);
    // More to read: the credentials stay.
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "fluxx" })).toBe(1);
    const p2 = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: { kind: "fluxx", startPage: 51 }, adapter: "fluxx", mapping: r1.mapping });
    expect(p2.run).toMatchObject({ nextPage: null, reconciliation: { rows: 50, create: 1, skip: 49 } });
    await commitAll(funderAdmin, p2.run.id);
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "fluxx" })).toBe(0);
    const awards = await h.repos.table("awards").find({ workspace_id: WS_FUNDER });
    expect(awards).toHaveLength(11);
    const [tranche] = await h.repos.table("tranches").find({ award_id: awards[0]!.id });
    expect(tranche).toMatchObject({ status: "settled", mode: "resolve", amount_minor: 100_000 });
    // Never a write to Fluxx: the token request is the one POST.
    expect(new Set(seen.filter((s) => s.method !== "GET").map((s) => new URL(s.url).pathname))).toEqual(new Set(["/oauth/token"]));
    // The ledger records the deletion, without the secret.
    const events = h.ledger.events.filter((e) => e.eventType === "connector.credentials_deleted");
    expect(events.map((e) => e.data)).toEqual([{ provider: "fluxx", why: "finished" }]);
    expect(JSON.stringify(h.ledger.events)).not.toContain(FLUXX_SECRET);
  }, 60_000);

  it("deletes the credentials when the person disconnects, or after a week unused", async () => {
    fakeSources({ grants: 3, grantedEvery: 1 });
    await data(funderAdmin, "POST", "/gms/imports/connections/fluxx", fluxxCreds);
    expect(await data(funderAdmin, "DELETE", "/gms/imports/connections/fluxx")).toMatchObject({ connected: false });
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "fluxx" })).toBe(0);
    await data(funderAdmin, "POST", "/gms/imports/connections/fluxx", fluxxCreds);
    h.clock.now = new Date(h.clock.now.getTime() + 8 * 24 * 3600 * 1000);
    funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
    expect(await data(funderAdmin, "GET", "/gms/imports/connections/fluxx")).toMatchObject({ connected: false });
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "fluxx" })).toBe(0);
    const read = await call(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "fluxx" } });
    expect([read.status, read.body.errors?.[0]?.code]).toEqual([409, "source_not_connected"]);
  });

  it("writes rows with exactly the columns the Fluxx adapter's preset names", () => {
    expect([...FLUXX_COLUMNS]).toEqual([...FLUXX_PULL_COLUMNS]);
  });
});

describe("Zengine, read with the funder's own token", () => {
  it("lists the forms, pulls one form's records through the dry run, and deletes the token when done", async () => {
    fakeSources({ grants: 0, grantedEvery: 1 });
    await data(funderAdmin, "POST", "/gms/imports/connections/zengine", { token: ZTOKEN });
    expect(await data(funderAdmin, "GET", "/gms/imports/zengine/forms")).toEqual([{ id: "42", name: "Awards", workspaceId: "7", workspaceName: "Grants" }]);
    const source = { kind: "zengine", formId: "42" };
    const r = await data<Read>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source });
    expect(r.mapping).toMatchObject({ sourceId: "Zengine record ID", title: "Project title", recipientName: "Organization", awardedAmount: "Amount Awarded" });
    const p = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source, adapter: "zengine", mapping: r.mapping });
    expect(p.run.reconciliation).toMatchObject({ create: 1, skip: 1 });
    await commitAll(funderAdmin, p.run.id);
    expect(await h.repos.table("connector_accounts").count({ workspace_id: WS_FUNDER, provider: "zengine" })).toBe(0);
  });

  it("says how long to wait when Zengine asks the GMS to slow down, and imports nothing", async () => {
    fakeSources({ grants: 0, grantedEvery: 1, zengine429: true });
    await data(funderAdmin, "POST", "/gms/imports/connections/zengine", { token: ZTOKEN });
    const r = await call(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "zengine", formId: "42" } });
    expect([r.status, r.body.errors?.[0]?.code]).toEqual([429, "source_rate_limited"]);
    expect(r.body.message).toMatch(/wait about 15 minutes/);
    expect(await h.repos.table("import_runs").count({ workspace_id: WS_FUNDER })).toBe(0);
  });

  it("deletes a token Zengine no longer accepts", async () => {
    fakeSources({ grants: 0, grantedEvery: 1 });
    await data(funderAdmin, "POST", "/gms/imports/connections/zengine", { token: ZTOKEN });
    const row = (await h.repos.table("connector_accounts").one({ workspace_id: WS_FUNDER, provider: "zengine" }))!;
    // Another token, as if the saved one had been revoked at Zengine.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: 401 }), { status: 401 }));
    const r = await call(funderAdmin, "GET", "/gms/imports/zengine/forms");
    expect([r.status, r.body.errors?.[0]?.code]).toEqual([409, "source_not_connected"]);
    expect(await h.repos.table("connector_accounts").one({ id: row.id })).toBeNull();
  });
});
