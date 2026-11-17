// SPDX-License-Identifier: AGPL-3.0-only
// Red team: an import whose columns are named or shaped like bank details (the routing and the
// account digits), identity numbers and when a person was born stores none of those values
// anywhere: not the records it writes, not the import run or its log, not the saved mappings, not
// the ledger, mail, files or webhooks, and no answer carries them. Run for both targets, from a CSV,
// an Excel workbook (made at run time, ./xlsx-writer.ts), Google Sheets and Airtable, with a mapping
// that tries to use the dropped columns, through the two older direct imports, and (v1.9.0) through
// every importer adapter: each grants system's export, as a file and as an Excel workbook.
//
// Every sensitive-looking value is made up at run time, and the headers are put together from
// parts, so no file in the repository holds one (`pnpm gate:sensitive`).
import { readFileSync } from "node:fs";
import { TABLE_NAMES } from "@gms/db";
import { parseCsv } from "@gms/importers";
import { beforeEach, describe, expect, it } from "vitest";
import { USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { base64Of, xlsxOf } from "./xlsx-writer.ts";

const USER_APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const BASE = "appAbCdEfGhIjKlMn";
const TABLE = "tblAbCdEfGhIjKlMn";

/** Nine digits that pass the routing checksum: eight chosen digits and the check digit that fits. */
function checksumValid(prefix8: string): string {
  const d = [...prefix8].map(Number);
  const partial = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]!);
  return prefix8 + String((10 - (partial % 10)) % 10);
}
const ROUTING_A = checksumValid("0110" + "0002");
const ROUTING_B = checksumValid("0210" + "0004");
const ACCOUNT_A = "4" + "0".repeat(9) + "17";
const ACCOUNT_B = ["4000", "0000", "0000", "0028"].join(" ");
const IDENTITY_A = ["900", "00", "0011"].join("-");
const IDENTITY_B = ["900", "00", "0012"].join("");
const IDENTITY_C = ["900", "00", "0013"].join("-");
const BORN_A = ["1971", "04", "12"].join("-");
const BORN_B = ["1983", "11", "29"].join("-");
const SECRETS = [ROUTING_A, ROUTING_B, ACCOUNT_A, ACCOUNT_B, ACCOUNT_B.replace(/ /g, ""), IDENTITY_A, IDENTITY_B, IDENTITY_C, IDENTITY_A.replace(/-/g, ""), IDENTITY_C.replace(/-/g, ""), BORN_A, BORN_B];

/** Named like the data (dropped by header) and shaped like it under ordinary names (dropped by value). */
const SENSITIVE_COLUMNS: [string, string][] = [
  ["Rout" + "ing number", ROUTING_A],
  ["Acc" + "ount number", ACCOUNT_A],
  ["S" + "SN", IDENTITY_A],
  ["Date of bir" + "th", BORN_A],
  ["D" + "OB", BORN_B],
  ["Ref", ROUTING_B],
  ["Code", ACCOUNT_B],
  ["ID", IDENTITY_B],
  ["Contact", IDENTITY_C],
];
const DROPPED = SENSITIVE_COLUMNS.map(([name]) => name);

const OUTSIDE_COLUMNS = ["Grant", "Funder"];
const outsideRow = (i: number) => [`Clinic grant ${i}`, `Birch Fund ${i}`];
const HISTORY_COLUMNS = ["Organization", "Grant", "Amount", "Award date"];
const historyRow = (i: number) => [`Pine Valley Arts ${i}`, `Murals ${i}`, String(10000 + i), "2025-01-15"];

function grid(columns: string[], row: (i: number) => string[]): string[][] {
  return [[...columns, ...DROPPED], ...[1, 2].map((i) => [...row(i), ...SENSITIVE_COLUMNS.map(([, v]) => v)])];
}
const toCsv = (g: string[][]) => g.map((r) => r.map((c) => (/[",\s]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");

let h: Harness;
let answers: string[];

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
async function call<T>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  answers.push(text);
  return { status: res.status, data: (JSON.parse(text) as { data: T }).data, text };
}
async function ok<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${r.text.slice(0, 300)}`);
  return r.data;
}

/** Everything the server keeps: every table, the ledger, mail, files, exports and webhook deliveries. */
async function everythingStored(): Promise<string> {
  const tables = await Promise.all(TABLE_NAMES.map(async (t) => [t, await h.repos.table(t).find({})] as const));
  const ledger = [...(await h.ledger.list({ workspaceId: WS_APPLICANT })), ...(await h.ledger.list({ workspaceId: WS_FUNDER }))];
  const files = [...h.storage.files.values()].map((f) => new TextDecoder().decode(f.bytes));
  return JSON.stringify({ tables, ledger, mail: h.mailer.sent, files, exported: [...h.exported.values()], webhooks: h.webhooks });
}
const found = (text: string) => SECRETS.filter((s) => text.includes(s));

/** Read, check (with a mapping that also names the dropped columns), commit, and read the run back. */
async function importThrough(who: Record<string, string>, target: "outside_applications" | "award_history", source: Record<string, unknown>, mapping: Record<string, string>, tryDropped: string[]) {
  const read = await ok<{ columns: { name: string }[]; dropped: { column: string }[]; mapping: Record<string, string> }>(who, "POST", "/gms/imports/read", { target, source });
  expect(read.dropped.map((d) => d.column).sort()).toEqual([...DROPPED].sort());
  expect(read.columns.map((c) => c.name).filter((n) => DROPPED.includes(n))).toEqual([]);
  expect(Object.values(read.mapping).filter((c) => DROPPED.includes(c))).toEqual([]);
  // A mapping that asks for the dropped columns gets none of their values.
  const sneaky = Object.fromEntries(tryDropped.map((field, i) => [field, DROPPED[i % DROPPED.length]!]));
  const checked = await call<{ run: { id: string } }>(who, "POST", "/gms/imports/preview", { target, source, mapping: { ...sneaky, ...mapping }, saveMapping: true });
  expect(checked.status, checked.text.slice(0, 300)).toBe(201);
  const runId = checked.data.run.id;
  for (let i = 0; i < 10; i++) if ((await ok<{ done: boolean }>(who, "POST", `/gms/imports/runs/${runId}/commit`)).done) break;
  await ok(who, "GET", `/gms/imports/runs/${runId}`);
  await ok(who, "GET", `/gms/imports/runs?target=${target}`);
  return runId;
}

beforeEach(async () => {
  h = await harness();
  answers = [];
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_ADMIN, role: "admin" });
});

describe("an import with bank and identity data in it", () => {
  it("drops those columns from every source and both targets, and keeps none of their values anywhere", async () => {
    const applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
    const funder = await headers(USER_ADMIN, WS_FUNDER);
    const outside = grid(OUTSIDE_COLUMNS, outsideRow);
    const history = grid(HISTORY_COLUMNS, historyRow);
    expect(parseCsv(toCsv(outside))).toEqual(outside);

    h.sheets.spreadsheets[SHEET_ID] = { Pipeline: outside, History: history };
    const records = (g: string[][]) => g.slice(1).map((r, i) => ({ id: `rec${String(i).padStart(14, "0")}`, fields: Object.fromEntries(g[0]!.map((c, j) => [c, r[j]])) }));
    h.airtable.bases[BASE] = { tables: [{ id: TABLE, name: "Pipeline", fields: outside[0]! }, { id: "tblZyXwVuTsRqPoNm", name: "History", fields: history[0]! }], records: { [TABLE]: records(outside), tblZyXwVuTsRqPoNm: records(history) } };

    const outsideMapping = { title: "Grant", funderName: "Funder" };
    const outsideSneaky = ["notes", "programName", "confirmationRef", "listingUrl", "portalUrl"];
    const historyMapping = { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date" };
    const historySneaky = ["description", "programName", "recipientEin", "paidReference"];

    const runs: string[] = [];
    runs.push(await importThrough(applicant, "outside_applications", { kind: "csv", text: toCsv(outside), fileName: "pipeline.csv" }, outsideMapping, outsideSneaky));
    runs.push(await importThrough(applicant, "outside_applications", { kind: "google_sheets", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, sheet: "Pipeline" }, outsideMapping, outsideSneaky));
    runs.push(await importThrough(applicant, "outside_applications", { kind: "airtable", url: `https://airtable.com/${BASE}/${TABLE}` }, outsideMapping, outsideSneaky));
    // An Excel workbook with both sheets; each target reads its own.
    const workbook = base64Of(xlsxOf({ Pipeline: outside, History: history }));
    runs.push(await importThrough(applicant, "outside_applications", { kind: "xlsx", base64: workbook, sheet: "Pipeline", fileName: "grants.xlsx" }, outsideMapping, outsideSneaky));
    runs.push(await importThrough(funder, "award_history", { kind: "csv", text: toCsv(history), fileName: "history.csv" }, historyMapping, historySneaky));
    runs.push(await importThrough(funder, "award_history", { kind: "google_sheets", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, sheet: "History" }, historyMapping, historySneaky));
    runs.push(await importThrough(funder, "award_history", { kind: "xlsx", base64: workbook, sheet: "History", fileName: "grants.xlsx" }, historyMapping, historySneaky));

    // The imports did their work: the ordinary columns came in (a CSV, a sheet and a workbook with
    // the same rows write them once; Airtable rows are keyed by their record ids).
    expect((await h.repos.table("outside_applications").find({ workspace_id: WS_APPLICANT })).map((o) => o.title).sort()).toEqual(["Clinic grant 1", "Clinic grant 1", "Clinic grant 2", "Clinic grant 2"]);
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(2);
    // Each run names what it left out, by column name only.
    for (const id of runs) expect(((await h.repos.table("import_runs").one({ id }))!.dropped_columns as { column: string }[]).map((d) => d.column).sort()).toEqual([...DROPPED].sort());
    // Saved mappings never point at a dropped column.
    for (const m of await h.repos.table("import_mappings").find({})) expect(Object.values(m.mapping as Record<string, string>).filter((c) => DROPPED.includes(c)), JSON.stringify(m.mapping)).toEqual([]);

    expect(found(await everythingStored())).toEqual([]);
    expect(found(answers.join("\n"))).toEqual([]);
  });

  it("keeps none of them through any grants system's export, read with that system's adapter", async () => {
    const funder = await headers(USER_ADMIN, WS_FUNDER);
    const fixture = (name: string) => readFileSync(new URL(`../../../packages/importers/test/fixtures/adapters/${name}`, import.meta.url), "utf8");
    /** The export with the sensitive columns added to every row, made up at run time. */
    const withSensitive = (csv: string) => {
      const g = parseCsv(csv).filter((r) => r.some((c) => c !== ""));
      return toCsv([[...g[0]!, ...DROPPED], ...g.slice(1).map((r) => [...r, ...SENSITIVE_COLUMNS.map(([, v]) => v)])]);
    };
    const exports: [string, Record<string, unknown>][] = [
      ["good_grants", { kind: "csv", text: withSensitive(fixture("good-grants.csv")), fileName: "good-grants.csv" }],
      ["sm_apply", { kind: "csv", text: withSensitive(fixture("sm-apply.csv")), fileName: "sm-apply.csv" }],
      ["submittable", { kind: "csv", text: withSensitive(fixture("submittable.csv")), fileName: "submittable.csv" }],
      ["foundant_glm", { kind: "csv", text: withSensitive(fixture("foundant-glm.csv")), fileName: "foundant.csv" }],
      ["smartsimple", { kind: "csv", text: withSensitive(fixture("smartsimple.csv")), fileName: "smartsimple.csv" }],
      ["openwater", { kind: "csv", text: withSensitive(fixture("openwater.csv")), fileName: "openwater.csv" }],
      ["submittable", { kind: "xlsx", base64: base64Of(xlsxOf({ Submissions: parseCsv(withSensitive(fixture("submittable.csv"))) })), sheet: "Submissions", fileName: "submittable.xlsx" }],
    ];
    // OpenWater's JSON export, each record given the sensitive fields too.
    const ow = JSON.parse(fixture("openwater.json")) as { applications: Record<string, unknown>[] };
    for (const r of ow.applications) for (const [name, v] of SENSITIVE_COLUMNS) r[name] = v;
    exports.push(["openwater", { kind: "json", text: JSON.stringify(ow), fileName: "openwater.json" }]);

    for (const [adapter, source] of exports) {
      const read = await ok<{ columns: { name: string }[]; dropped: { column: string }[]; mapping: Record<string, string> }>(funder, "POST", "/gms/imports/read", { target: "award_history", source, adapter });
      // Every sensitive column is dropped (the export's own IBAN or birth-year columns too), and none is offered or mapped.
      expect(read.dropped.map((d) => d.column), adapter).toEqual(expect.arrayContaining(DROPPED));
      expect(read.columns.map((c) => c.name).filter((n) => DROPPED.includes(n)), adapter).toEqual([]);
      expect(Object.values(read.mapping).filter((c) => DROPPED.includes(c)), adapter).toEqual([]);
      // The system's preset, plus a mapping that asks for the dropped columns.
      const sneaky = Object.fromEntries(["description", "programName", "recipientEin", "paidReference"].map((field, i) => [field, DROPPED[i]!]));
      const checked = await call<{ run: { id: string } }>(funder, "POST", "/gms/imports/preview", { target: "award_history", source, adapter, mapping: { ...sneaky, ...read.mapping }, saveMapping: true });
      expect(checked.status, `${adapter} ${checked.text.slice(0, 300)}`).toBe(201);
      for (let i = 0; i < 10; i++) if ((await ok<{ done: boolean }>(funder, "POST", `/gms/imports/runs/${checked.data.run.id}/commit`)).done) break;
      await ok(funder, "GET", `/gms/imports/runs/${checked.data.run.id}`);
    }
    // The imports did their work, and kept none of the values anywhere.
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBeGreaterThan(0);
    expect(found(await everythingStored())).toEqual([]);
    expect(found(answers.join("\n"))).toEqual([]);
  });

  it("keeps none of them through the older direct imports either", async () => {
    const applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
    const funder = await headers(USER_ADMIN, WS_FUNDER);
    const outside = toCsv(grid(OUTSIDE_COLUMNS, outsideRow));
    const history = toCsv(grid(HISTORY_COLUMNS, historyRow));
    // The v1.5.0 applications import, mapping fields to the dropped columns as well.
    for (const dryRun of [true, false]) await call(applicant, "POST", "/gms/outside-applications/import", { csv: outside, mapping: { title: "Grant", funderName: "Funder", notes: DROPPED[0], confirmationRef: DROPPED[5], programName: DROPPED[7] }, dryRun });
    // The v1 award import, likewise.
    for (const dryRun of [true, false]) await call(funder, "POST", "/gms/imports/csv", { csv: history, mapping: { recipientName: "Organization", title: "Grant", awardedAmount: "Amount", awardDate: "Award date", programName: DROPPED[2], recipientEin: DROPPED[7] }, dryRun });
    expect(found(await everythingStored())).toEqual([]);
    expect(found(answers.join("\n"))).toEqual([]);
  });
});
