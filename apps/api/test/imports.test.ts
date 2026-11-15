// SPDX-License-Identifier: AGPL-3.0-only
// Import from a spreadsheet (/gms/imports): sources, the read step with sensitive columns dropped
// first, saved mappings, the dry run with its reconciliation, batched commits that are idempotent
// per row, grant history with payments recorded as paid elsewhere (never through Passport), and
// who may do what. Google Sheets and Airtable are the connector fixtures here; the real Composio
// connectors are tested against a fake Composio in packages/connectors.
import { parseCsv } from "@gms/importers";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

const USER_APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const BASE = "appAbCdEfGhIjKlMn";
const TABLE = "tblAbCdEfGhIjKlMn";

let h: Harness;
let applicant: Record<string, string>;
let editor: Record<string, string>;
let funderAdmin: Record<string, string>;
let officer: Record<string, string>;

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

/** Made at run time from digits that pass the shape checks; no file holds such a value. */
const IDENTITY_SHAPED = ["900", "00", "0001"].join("-");

const PIPELINE = ["Grant,Funder,Stage,Deadline,Ask,Submitted,How,Awarded,Contact ref", `Capacity 2026,Cascade Trust,Awarded,2026-03-01,"$20,000",2026-02-20,portal,"$15,000",${IDENTITY_SHAPED}`, "Bad row,,Paid,03/32/2026,lots,,,,", "Summer camp,Pine Fund,prospect,6/1/2027,5000,,,,"].join("\n");
const OUTSIDE_MAPPING = { title: "Grant", funderName: "Funder", stage: "Stage", fullDue: "Deadline", askAmount: "Ask", submittedAt: "Submitted", submissionMethod: "How", awardedAmount: "Awarded" };

type Run = { id: string; status: string; reconciliation: { rows: number; create: number; skip: number; error: number; totals: { outcome: string; kind: string; year: number | null; amountMinor: number; rows: number }[] }; dropped: { column: string; reason: string; why: string }[]; progress?: { toWrite: number; written: number; skipped: number; failed: number } };
type Preview = { run: Run; rows: { line: number; outcome: string; reason: string | null; problems: { field?: string; message: string }[]; title: string }[]; unknownColumns: string[] };
type Commit = { run: Run; done: boolean; wrote: number };

const csv = (text: string, fileName = "pipeline.csv") => ({ kind: "csv", text, fileName });

async function commitAll(who: Record<string, string>, runId: string, max = 20): Promise<{ calls: number; last: Commit }> {
  for (let calls = 1; calls <= max; calls++) {
    const last = await data<Commit>(who, "POST", `/gms/imports/runs/${runId}/commit`);
    if (last.done) return { calls, last };
  }
  throw new Error("the import did not finish");
}

beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_ADMIN, role: "admin" });
  applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
  editor = await headers(USER_OFFICER, WS_APPLICANT);
  funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
  officer = await headers(USER_OFFICER, WS_FUNDER);
});

describe("sources", () => {
  it("offers files always, and Google Sheets and Airtable only where Composio is set up for them", async () => {
    const all = await data<{ sources: { kind: string; connected: boolean; canConnect: boolean }[]; maxRows: number; fields: { key: string; required: boolean }[] }>(applicant, "GET", "/gms/imports/sources?target=outside_applications");
    expect(all.sources.map((s) => s.kind)).toEqual(["csv", "xlsx", "google_sheets", "airtable"]);
    expect(all.sources.find((s) => s.kind === "google_sheets")).toMatchObject({ connected: true, canConnect: true });
    expect(all.maxRows).toBe(5000);
    expect(all.fields.filter((f) => f.required).map((f) => f.key)).toEqual(["title", "funderName"]);
    // An editor may import, but only an admin connects a source.
    expect((await data<{ sources: { kind: string; canConnect: boolean }[] }>(editor, "GET", "/gms/imports/sources?target=outside_applications")).sources.find((s) => s.kind === "airtable")!.canConnect).toBe(false);
    h.withoutPorts.add("sheets").add("airtable");
    expect((await data<{ sources: { kind: string }[] }>(applicant, "GET", "/gms/imports/sources?target=outside_applications")).sources.map((s) => s.kind)).toEqual(["csv", "xlsx"]);
    expect(((await (await h.request("/gms/config")).json()) as { data: { available: Record<string, boolean> } }).data.available).toMatchObject({ googleSheets: false, airtable: false });
  });

  it("connects Google Sheets through the integrations routes, for an applicant workspace too", async () => {
    h.sheets.connected = false;
    const started = await data<{ status: string; connectUrl: string; scopes: string[] }>(applicant, "POST", "/gms/connectors/google_sheets", { returnTo: "/w/alder-creek/import?for=applications" });
    expect(started).toMatchObject({ status: "pending", scopes: ["spreadsheets.readonly"] });
    expect(started.connectUrl).toContain("composio.invalid/connect/google_sheets");
    expect(await h.repos.table("connector_accounts").one({ workspace_id: WS_APPLICANT, provider: "google_sheets" })).toMatchObject({ status: "pending", secret_enc: null });
    expect((await call(editor, "POST", "/gms/connectors/google_sheets", {})).status).toBe(403);
    expect((await call(applicant, "POST", "/gms/connectors/airtable", { token: "a-token-pasted-here" })).status).toBe(422);
    await data(applicant, "DELETE", "/gms/connectors/google_sheets");
    expect((await h.repos.table("connector_accounts").one({ workspace_id: WS_APPLICANT, provider: "google_sheets" }))!.status).toBe("revoked");
  });
});

describe("outside applications from a CSV", () => {
  it("reads the columns with sensitive ones dropped first, and suggests a mapping", async () => {
    const read = await data<{ rows: number; columns: { name: string; samples: string[] }[]; dropped: { column: string; why: string }[]; mapping: Record<string, string>; savedMapping: string | null }>(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: csv(PIPELINE) });
    expect(read.rows).toBe(3);
    expect(read.columns.map((c) => c.name)).toEqual(["Grant", "Funder", "Stage", "Deadline", "Ask", "Submitted", "How", "Awarded"]);
    expect(read.dropped).toEqual([{ column: "Contact ref", reason: "identity_number", why: "Its values look like a person's identity number" }]);
    expect(JSON.stringify(read)).not.toContain(IDENTITY_SHAPED);
    expect(read.mapping).toMatchObject({ title: "Grant", funderName: "Funder", stage: "Stage", fullDue: "Deadline", askAmount: "Ask", submittedAt: "Submitted", awardedAmount: "Awarded" });
    expect(read.savedMapping).toBeNull();
  });

  it("checks, reconciles, commits in batches and creates the applications", async () => {
    const preview = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: { ...OUTSIDE_MAPPING, notes: "Contact ref" } });
    expect(preview.run).toMatchObject({ status: "checked", reconciliation: { rows: 3, create: 2, skip: 0, error: 1 } });
    expect(preview.unknownColumns).toEqual(["notes"]);
    expect(preview.run.dropped.map((d) => d.column)).toEqual(["Contact ref"]);
    expect(preview.rows[1]!.problems).toEqual(expect.arrayContaining([{ field: "funderName", message: "No funder" }]));
    expect(preview.run.reconciliation.totals).toEqual(
      expect.arrayContaining([
        { outcome: "create", kind: "ask", currency: "USD", year: 2026, amountMinor: 2_000_000, rows: 1 },
        { outcome: "create", kind: "ask", currency: "USD", year: 2027, amountMinor: 500_000, rows: 1 },
        { outcome: "create", kind: "awarded", currency: "USD", year: 2026, amountMinor: 1_500_000, rows: 1 },
      ]),
    );
    // A preview writes nothing but the run and its log.
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(0);
    // The run keeps the dropped column's name; its value is stored nowhere.
    const stored = JSON.stringify([await h.repos.table("import_runs").find({ workspace_id: WS_APPLICANT }), await h.repos.table("import_rows").find({ workspace_id: WS_APPLICANT }), h.ledger.events]);
    expect(stored).toContain("Contact ref");
    expect(stored).not.toContain(IDENTITY_SHAPED);

    const { last } = await commitAll(applicant, preview.run.id);
    expect(last.run).toMatchObject({ status: "done", progress: { toWrite: 0, written: 2, skipped: 0, failed: 1 } });
    const made = await h.repos.table("outside_applications").find({ workspace_id: WS_APPLICANT });
    expect(made.map((r) => [r.title, r.stage, r.source, r.awarded_amount_minor]).sort()).toEqual([["Capacity 2026", "awarded", "import", 1_500_000], ["Summer camp", "prospect", "import", null]]);
    // Each written row's record is cleared from the log once the application exists.
    expect((await h.repos.table("import_rows").find({ run_id: preview.run.id, outcome: "create" })).every((r) => r.record === null && r.entity_id && r.written_at)).toBe(true);

    const run = await data<{ run: Run; rows: { line: number; outcome: string; written: boolean; entity: { type: string; id: string } | null }[] }>(applicant, "GET", `/gms/imports/runs/${preview.run.id}`);
    expect(run.rows.filter((r) => r.entity).map((r) => r.entity!.type)).toEqual(["outside_application", "outside_application"]);
    expect(made.map((m) => m.id).sort()).toEqual(run.rows.filter((r) => r.entity).map((r) => r.entity!.id).sort());
    expect(h.ledger.events.filter((e) => e.eventType === "outside_application.created")).toHaveLength(2);
    expect(h.ledger.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["import.checked", "import.committed", "import.finished"]));
  });

  it("is idempotent: the same file again skips every row, and a finished run writes nothing more", async () => {
    const first = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: OUTSIDE_MAPPING });
    await commitAll(applicant, first.run.id);
    expect((await data<Commit>(applicant, "POST", `/gms/imports/runs/${first.run.id}/commit`)).wrote).toBe(0);
    // The same rows from another file name, in another order.
    const lines = PIPELINE.split("\n");
    const again = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv([lines[0], lines[3], lines[1]].join("\n"), "pipeline (1).csv"), mapping: OUTSIDE_MAPPING });
    expect(again.run.reconciliation).toMatchObject({ create: 0, skip: 2 });
    expect(again.rows[0]!.reason).toMatch(/^Imported already on \d{4}-\d{2}-\d{2}$/);
    await commitAll(applicant, again.run.id);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(2);
  });

  it("writes a row once when two checks of the same file are both imported", async () => {
    const a = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: OUTSIDE_MAPPING });
    const b = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: OUTSIDE_MAPPING });
    await commitAll(applicant, a.run.id);
    const { last } = await commitAll(applicant, b.run.id);
    expect(last.run.progress).toMatchObject({ written: 0, skipped: 2 });
    expect((await data<{ rows: { reason: string | null }[] }>(applicant, "GET", `/gms/imports/runs/${b.run.id}`)).rows.filter((r) => r.reason === "Imported already by another import")).toHaveLength(2);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(2);
  });

  it("saves the mapping and offers it for the next file with the same columns", async () => {
    await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: { ...OUTSIDE_MAPPING, programName: "How" } });
    const saved = await h.repos.table("import_mappings").find({ workspace_id: WS_APPLICANT });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ target: "outside_applications", source: "csv", mapping: { ...OUTSIDE_MAPPING, programName: "How" } });
    expect(saved[0]!.source_ref).toMatch(/^columns:[0-9a-f]{32}$/);
    const next = await data<{ mapping: Record<string, string>; savedMapping: string | null }>(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: csv(PIPELINE.replace("Capacity 2026", "Capacity 2027"), "next-year.csv") });
    expect(next).toMatchObject({ savedMapping: "this_source", mapping: { programName: "How" } });
    // Not saved when asked not to.
    await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv("Name,Org\nA,B\n"), mapping: { title: "Name", funderName: "Org" }, saveMapping: false });
    expect(await h.repos.table("import_mappings").count({ workspace_id: WS_APPLICANT })).toBe(1);
  });

  it("refuses an incomplete mapping, more than 5,000 rows, and a check older than a day", async () => {
    const incomplete = await call(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: { title: "Grant" } });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.errors![0]!.code).toBe("mapping_incomplete");
    expect(incomplete.body.message).toBe("Choose a column for: Funder");
    const big = ["t,f", ...Array.from({ length: 5001 }, (_, i) => `T${i},F`)].join("\n");
    expect((await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: csv(big) })).body.errors![0]!.code).toBe("too_many_rows");
    const p = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv(PIPELINE), mapping: OUTSIDE_MAPPING });
    h.clock.now = new Date(h.clock.now.getTime() + 25 * 3600 * 1000);
    applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
    const expired = await call(applicant, "POST", `/gms/imports/runs/${p.run.id}/commit`);
    expect(expired.status).toBe(410);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(0);
    // The next check clears it away with its rows.
    await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: csv("Name,Org\nA,B\n"), mapping: { title: "Name", funderName: "Org" } });
    expect(await h.repos.table("import_runs").one({ id: p.run.id })).toBeNull();
    expect(await h.repos.table("import_rows").count({ run_id: p.run.id })).toBe(0);
  });

  it("reads an XLSX workbook, any sheet of it", async () => {
    const base64 = readFileSync(new URL("../../../packages/importers/test/fixtures/history.xlsx", import.meta.url)).toString("base64");
    const read = await data<{ source: { sheets: string[]; sheet: string }; columns: { name: string }[] }>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "xlsx", base64, fileName: "history.xlsx" } });
    expect(read.source).toMatchObject({ sheets: ["Grants 2024", "Notes"], sheet: "Grants 2024" });
    expect(read.columns.map((c) => c.name)).toEqual(["Organization", "Grant", "Amount", "Award date", "Program", "Paid"]);
    const notes = await data<{ columns: { name: string }[] }>(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "xlsx", base64, sheet: "Notes" } });
    expect(notes.columns.map((c) => c.name)).toEqual(["Note"]);
    expect((await call(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "xlsx", base64: btoa("Organization,Grant\n") } })).body.errors![0]!.code).toBe("unreadable_file");
  });
});

describe("grant history for a funder", () => {
  const HISTORY = ["Organization,Grant,Amount,Award date,Program,Paid,Paid on,Check", "Alder Creek Family Services,Van route,50000,2024-03-01,Youth,25000,2024-04-01,CHK-1001", "Pine Valley Arts,Murals,12500,2025-01-15,Nothing like it,,,", "River Clinic,Dental van,80000,2025-02-01,,90000,2025-03-01,"].join("\n");
  const MAPPING = { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date", programName: "Program", paidAmount: "Paid", paidDate: "Paid on", paymentReference: "Check" };

  it("imports past awards, with payments recorded as paid elsewhere and never through Passport", async () => {
    await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Youth" });
    let passportCalls = 0;
    h.passport.fetch = async () => {
      passportCalls++;
      return new Response("{}", { status: 500 });
    };
    const preview = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: csv(HISTORY, "history.csv"), mapping: MAPPING });
    expect(preview.run.reconciliation).toMatchObject({ create: 2, error: 1 });
    expect(preview.rows[2]!.problems).toEqual([{ field: "paidAmount", message: "The amount paid is more than the amount awarded" }]);
    expect(preview.run.reconciliation.totals.filter((t) => t.outcome === "create")).toEqual([
      { outcome: "create", kind: "awarded", currency: "USD", year: 2024, amountMinor: 5_000_000, rows: 1 },
      { outcome: "create", kind: "awarded", currency: "USD", year: 2025, amountMinor: 1_250_000, rows: 1 },
      { outcome: "create", kind: "paid", currency: "USD", year: 2024, amountMinor: 2_500_000, rows: 1 },
    ]);
    await commitAll(funderAdmin, preview.run.id);
    const awards = await h.repos.table("awards").find({ workspace_id: WS_FUNDER });
    expect(awards.map((a) => [a.title, a.status, a.conditions]).sort()).toEqual([["Murals", "active", ["imported"]], ["Van route", "active", ["imported"]]]);
    const van = awards.find((a) => a.title === "Van route")!;
    expect(van.program_id).not.toBeNull();
    expect(awards.find((a) => a.title === "Murals")!.program_id).toBeNull();
    // The awarded amount only: never a disbursed amount.
    expect(JSON.stringify(awards.map((a) => a.funding))).not.toMatch(/disbursed/i);
    expect(van.recipient_individual).toEqual({ name: "Alder Creek Family Services", imported: true });
    const [tranche] = await h.repos.table("tranches").find({ award_id: van.id });
    expect(tranche).toMatchObject({ status: "settled", mode: "resolve", amount_minor: 2_500_000, passport_disbursement_id: null, external: { reference: "CHK-1001", paidAt: "2024-04-01" } });
    expect(Object.keys(tranche!.external as object).sort()).toEqual(["paidAt", "reference"]);
    expect(await h.repos.table("tranches").count({ award_id: awards.find((a) => a.title === "Murals")!.id })).toBe(0);
    // Walked through the tranche machine: due, then settled by recording it, ledgered as imported.
    const trancheEvents = h.ledger.events.filter((e) => e.subjectId === tranche!.id).map((e) => e.eventType);
    expect(trancheEvents).toEqual(["tranche.mark_due", "tranche.record_external"]);
    expect(h.ledger.events.filter((e) => e.subjectId === tranche!.id).every((e) => (e.data as { reason?: string }).reason === "imported")).toBe(true);
    expect(passportCalls).toBe(0);
  });

  it("commits a long history in batches", async () => {
    const rows = ["Organization,Grant,Amount,Award date", ...Array.from({ length: 45 }, (_, i) => `Org ${i},Grant ${i},${1000 + i},2023-0${(i % 9) + 1}-01`)].join("\n");
    const preview = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: csv(rows), mapping: { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date" } });
    const first = await data<Commit>(funderAdmin, "POST", `/gms/imports/runs/${preview.run.id}/commit`);
    expect(first).toMatchObject({ done: false, wrote: 20, run: { status: "importing", progress: { toWrite: 25, written: 20 } } });
    const { calls, last } = await commitAll(funderAdmin, preview.run.id);
    expect(calls).toBe(2);
    expect(last.run.progress).toMatchObject({ toWrite: 0, written: 45 });
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(45);
  });

  it("is for funder workspace admins only, and runs stay in their workspace", async () => {
    expect((await call(officer, "POST", "/gms/imports/read", { target: "award_history", source: csv(HISTORY) })).status).toBe(403);
    expect((await call(applicant, "POST", "/gms/imports/read", { target: "award_history", source: csv(HISTORY) })).status).toBe(403);
    expect((await call(funderAdmin, "POST", "/gms/imports/read", { target: "outside_applications", source: csv(PIPELINE) })).status).toBe(403);
    const preview = await data<Preview>(funderAdmin, "POST", "/gms/imports/preview", { target: "award_history", source: csv(HISTORY), mapping: MAPPING });
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    const other = await headers(USER_ADMIN, WS_OTHER);
    expect((await call(other, "GET", `/gms/imports/runs/${preview.run.id}`)).status).toBe(404);
    expect((await call(other, "POST", `/gms/imports/runs/${preview.run.id}/commit`)).status).toBe(404);
    expect((await call(applicant, "GET", `/gms/imports/runs/${preview.run.id}`)).status).toBe(404);
  });
});

describe("Google Sheets and Airtable", () => {
  it("reads a sheet from a pasted link, any tab of it", async () => {
    h.sheets.spreadsheets[SHEET_ID] = { "Pipeline 2026": parseCsv(PIPELINE), Other: [["x"], ["y"]] };
    const read = await data<{ source: { kind: string; label: string; sheets: string[]; sheet: string }; dropped: { column: string }[] }>(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "google_sheets", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0` } });
    expect(read.source).toMatchObject({ kind: "google_sheets", label: "Google Sheets · Pipeline 2026", sheets: ["Pipeline 2026", "Other"], sheet: "Pipeline 2026" });
    expect(read.dropped.map((d) => d.column)).toEqual(["Contact ref"]);
    expect(h.sheets.reads.at(-1)).toEqual({ entityId: WS_APPLICANT, spreadsheetId: SHEET_ID, sheet: "Pipeline 2026" });
    expect((await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "google_sheets", url: "https://example.org/sheet" } })).body.errors![0]!.code).toBe("invalid_link");
    expect((await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "google_sheets", url: SHEET_ID, sheet: "Missing" } })).body.errors![0]!.code).toBe("sheet_not_found");
    h.sheets.connected = false;
    const notConnected = await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "google_sheets", url: SHEET_ID } });
    expect([notConnected.status, notConnected.body.errors![0]!.code, notConnected.body.message]).toEqual([409, "source_not_connected", "Connect Google Sheets first"]);
    h.withoutPorts.add("sheets");
    expect((await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "google_sheets", url: SHEET_ID } })).status).toBe(503);
  });

  it("keys Airtable rows by record id, so an edited record is still recognised", async () => {
    const records = [
      { id: "recAAAAAAAAAAAAA1", fields: { Name: "Capacity 2026", Funder: "Cascade Trust" } },
      { id: "recAAAAAAAAAAAAA2", fields: { Name: "Summer camp", Funder: "Pine Fund" } },
    ];
    h.airtable.bases[BASE] = { tables: [{ id: TABLE, name: "Pipeline", fields: ["Name", "Funder"] }], records: { [TABLE]: records } };
    const source = { kind: "airtable", url: `https://airtable.com/${BASE}/${TABLE}/viwAbCdEfGhIjKlMn` };
    const first = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source, mapping: { title: "Name", funderName: "Funder" } });
    await commitAll(applicant, first.run.id);
    records[0]!.fields.Name = "Capacity 2026 (renamed)";
    records.push({ id: "recAAAAAAAAAAAAA3", fields: { Name: "Fall drive", Funder: "Oak Fund" } });
    const second = await data<Preview>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source, mapping: { title: "Name", funderName: "Funder" } });
    expect(second.rows.map((r) => r.outcome)).toEqual(["skip", "skip", "create"]);
    expect(await h.repos.table("import_mappings").one({ workspace_id: WS_APPLICANT, source: "airtable" })).toMatchObject({ source_ref: `${BASE}/${TABLE}` });
  });
});
