// SPDX-License-Identifier: AGPL-3.0-only
// Importer adapters: each system's export is recognised by its header row, gets its preset mapping,
// has its never-awarded rows set aside, and has its bank- and identity-shaped columns dropped by
// the sensitive screen first. Zip paths match the records an import created. The fixtures are
// small, made-up exports; value-shaped sensitive cells are made at run time, so no file holds one.
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  FILE_ADAPTERS,
  FLUXX,
  FLUXX_PULL_COLUMNS,
  HISTORY_TARGET,
  ZENGINE,
  ZENGINE_PULL_COLUMNS,
  adapterMapping,
  adaptersFor,
  detectAdapter,
  idKey,
  matchAttachments,
  mimeFor,
  planImport,
  screenColumns,
  setAsideNotAwarded,
  suggestMapping,
  tableFromCsv,
  tableFromJson,
  type AdapterKey,
  type SourceTable,
} from "../src/index.ts";
import { listZip, readZipEntry } from "../src/adapters/zip.ts";

/** Nine digits in no real number's range, and a twelve-digit run, made here and nowhere in a file. */
const NINE = ["900", "00", "0001"].join("");
const LONG = ["0000", "0000", "0012"].join("");

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/adapters/${name}`, import.meta.url), "utf8")
    .replace("{NINE}", NINE)
    .replace("{LONG}", LONG);

function screened(table: SourceTable) {
  const s = screenColumns(table.header, table.rows.map((r) => r.cells));
  return { columns: s.keep.map((i) => table.header[i]!), dropped: s.dropped };
}

async function run(key: AdapterKey, table: SourceTable) {
  const adapter = ADAPTERS[key];
  const { columns, dropped } = screened(table);
  const mapping = adapterMapping(adapter, HISTORY_TARGET, columns);
  const plan = setAsideNotAwarded(await planImport({ target: HISTORY_TARGET, table, mapping, source: { kind: "csv", ref: null } }), table, adapter, HISTORY_TARGET);
  return { adapter, columns, dropped, mapping, plan };
}

const outcomes = (plan: { rows: { outcome: string }[] }) => plan.rows.map((r) => r.outcome);

interface Case {
  key: AdapterKey;
  file: string;
  mapping: Record<string, string>;
  outcomes: string[];
  dropped: string[];
  /** A row set aside, and why. */
  setAside: [number, RegExp];
}

const CASES: Case[] = [
  {
    key: "submittable",
    file: "submittable.csv",
    mapping: { sourceId: "Submission ID", title: "Title", recipientName: "Organization", awardedAmount: "Amount Awarded", status: "Status", programName: "Category", awardDate: "Decision Date" },
    outcomes: ["create", "skip", "skip", "create", "create"],
    dropped: ["Bank acct", "Reference"],
    setAside: [1, /^Not awarded in Submittable \(Status: Declined\)$/],
  },
  {
    key: "good_grants",
    file: "good-grants.csv",
    mapping: { sourceId: "Slug", title: "Title", recipientName: "Organisation", awardedAmount: "Grant amount", startDate: "Grant start date", endDate: "Grant end date", status: "Grant status", programName: "Category" },
    outcomes: ["create", "skip", "skip", "create"],
    dropped: ["IBAN", "Year of birth"],
    setAside: [1, /Moderation: rejected/],
  },
  {
    key: "sm_apply",
    file: "sm-apply.csv",
    mapping: { sourceId: "Application ID", title: "Submission Title", recipientName: "Organization", awardedAmount: "Award Amount", awardDate: "Award Date", status: "Status", programName: "Program" },
    outcomes: ["create", "skip", "skip", "create"],
    dropped: ["Payee routing", "D.O.B."],
    setAside: [1, /Stage: Declined/],
  },
  {
    key: "foundant_glm",
    file: "foundant-glm.csv",
    mapping: { sourceId: "Request ID", title: "Project Title", recipientName: "Organization Name", awardedAmount: "Amount Awarded", programName: "Process Name", awardDate: "Decision Date", paidAmount: "Payment Amount", paidDate: "Payment Date" },
    outcomes: ["create", "skip", "create", "skip"],
    dropped: ["TIN", "Payee account"],
    setAside: [3, /Decision: Pending/],
  },
  {
    key: "smartsimple",
    file: "smartsimple.csv",
    mapping: { sourceId: "Tracking ID", title: "Name", recipientName: "Company", awardedAmount: "Approved Amount", status: "Status", programName: "Type", startDate: "Start Date", endDate: "End Date" },
    outcomes: ["create", "skip", "skip", "create"],
    dropped: ["SIN"],
    setAside: [2, /Status: Under Review/],
  },
  {
    key: "openwater",
    file: "openwater.csv",
    mapping: { sourceId: "Application Id", title: "Name", recipientName: "Organization", awardedAmount: "Award Amount", status: "Status", programName: "Program Name" },
    outcomes: ["create", "skip", "create"],
    dropped: ["Driver license"],
    setAside: [1, /Status: Disqualified/],
  },
];

describe("each system's export", () => {
  for (const c of CASES) {
    describe(ADAPTERS[c.key].system, () => {
      it("is recognised by its header row, after the sensitive columns are dropped", async () => {
        const table = tableFromCsv(fixture(c.file));
        const { columns } = screened(table);
        expect(detectAdapter(columns, FILE_ADAPTERS)?.adapter.key).toBe(c.key);
      });

      it("drops the columns that look like bank or identity details before anything else", async () => {
        const { dropped, columns, plan } = await run(c.key, tableFromCsv(fixture(c.file)));
        expect(dropped.map((d) => d.column).sort()).toEqual([...c.dropped].sort());
        for (const d of c.dropped) expect(columns).not.toContain(d);
        // No value of a dropped column is anywhere in the plan.
        const text = JSON.stringify(plan);
        expect(text).not.toContain(NINE);
        expect(text).not.toContain(LONG);
        expect(text).not.toContain("on file");
      });

      it("fills the mapping from its preset", async () => {
        const { mapping } = await run(c.key, tableFromCsv(fixture(c.file)));
        expect(mapping).toMatchObject(c.mapping);
        // Every column is used once at most.
        expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
      });

      it("imports the awarded rows and sets aside the ones never awarded", async () => {
        const { plan } = await run(c.key, tableFromCsv(fixture(c.file)));
        expect(outcomes(plan)).toEqual(c.outcomes);
        expect(plan.missingRequired).toEqual([]);
        const [i, why] = c.setAside;
        expect(plan.rows[i]!.reason).toMatch(why);
        expect(plan.rows[i]!.record).toBeNull();
        expect(plan.reconciliation.create).toBe(c.outcomes.filter((o) => o === "create").length);
        expect(plan.reconciliation.error).toBe(0);
      });
    });
  }

  it("records a GLM payment as paid elsewhere on the award", async () => {
    const { plan } = await run("foundant_glm", tableFromCsv(fixture("foundant-glm.csv")));
    expect(plan.rows[0]!.record).toMatchObject({ recipientName: "Hilltop Food Shelf", awardedAmountMinor: 1_500_000, payment: { amountMinor: 1_500_000, paidOn: "2024-03-01" }, programName: "2024 - Community Fund" });
    // A free-text column whose name only starts like an account column is kept.
    expect(screened(tableFromCsv(fixture("foundant-glm.csv"))).columns).toContain("Account notes");
  });

  it("reads an OpenWater JSON export into the same rows as its CSV", async () => {
    const table = tableFromJson(fixture("openwater.json"));
    expect(table.header).toEqual(["applicationId", "name", "programName", "roundName", "status", "organization", "awardAmount", "applicant", "tags"]);
    expect(table.rows[2]!.cells).toEqual(["50003", "Mural restoration", "Neighborhood Grants", "Round 1", "Winner", "Old Town Arts", "4000", "Vic Wu", "arts, downtown"]);
    const { columns } = screened(table);
    expect(detectAdapter(columns, FILE_ADAPTERS)?.adapter.key).toBe("openwater");
    const { plan, mapping } = await run("openwater", table);
    expect(mapping).toMatchObject({ sourceId: "applicationId", title: "name", recipientName: "organization", awardedAmount: "awardAmount", programName: "programName" });
    expect(outcomes(plan)).toEqual(["create", "skip", "create"]);
    expect(() => tableFromJson("{not json")).toThrow(/not valid JSON/);
    expect(() => tableFromJson('{"a": 1}')).toThrow(/no list/);
  });
});

describe("recognising an export", () => {
  it("recognises nothing in a plain spreadsheet, so the general matching applies", () => {
    expect(detectAdapter(["Organization", "EIN", "Grant", "Amount", "Award date", "Program", "Paid", "Paid on"], FILE_ADAPTERS)).toBeNull();
    expect(detectAdapter(["Name", "Status", "Company", "Start Date", "End Date"], FILE_ADAPTERS)).toBeNull();
  });

  it("recognises nothing when two systems match equally well", () => {
    // Two strong headers of Submittable, two of Good Grants, nothing else.
    expect(detectAdapter(["Submitter Email", "Labels", "Chapter", "Season"], FILE_ADAPTERS)).toBeNull();
  });

  it("keeps the person's saved mapping for these exact columns ahead of the preset", () => {
    const columns = screened(tableFromCsv(fixture("submittable.csv"))).columns;
    const m = adapterMapping(ADAPTERS.submittable, HISTORY_TARGET, columns, { exact: { title: "Category", programName: "Title" } });
    expect(m).toMatchObject({ title: "Category", programName: "Title", awardedAmount: "Amount Awarded" });
  });

  it("falls back to the general matching for fields the preset does not name", () => {
    const m = adapterMapping(ADAPTERS.smartsimple, HISTORY_TARGET, ["Tracking ID", "Name", "Company", "Approved Amount", "Fiscal year"]);
    expect(m).toMatchObject({ sourceId: "Tracking ID", year: "Fiscal year" });
    expect(suggestMapping(HISTORY_TARGET, ["Fiscal year"]).year).toBe("Fiscal year");
  });

  it("offers adapters for funder grant history only", () => {
    expect(adaptersFor("award_history").map((a) => a.key)).toEqual(["good_grants", "sm_apply", "submittable", "foundant_glm", "smartsimple", "openwater", "cybergrants", "fluxx", "zengine"]);
    expect(adaptersFor("outside_applications")).toEqual([]);
  });

  it("maps every required field of a Fluxx pull and a Zengine pull", () => {
    const fluxx = adapterMapping(FLUXX, HISTORY_TARGET, [...FLUXX_PULL_COLUMNS]);
    expect(fluxx).toMatchObject({ sourceId: "Fluxx ID", title: "Project title", recipientName: "Organization", awardedAmount: "Amount awarded", paidAmount: "Amount paid", paidDate: "Last paid on", startDate: "Grant begins", endDate: "Grant ends", awardDate: "Approved on" });
    const zengine = adapterMapping(ZENGINE, HISTORY_TARGET, [...ZENGINE_PULL_COLUMNS, "Organization", "Amount Awarded", "Status"]);
    expect(zengine).toMatchObject({ sourceId: "Zengine record ID", title: "Record name", recipientName: "Organization", awardedAmount: "Amount Awarded" });
  });
});

describe("zip attachments", () => {
  async function createdRows() {
    const table = tableFromCsv(fixture("submittable.csv"));
    const { plan, mapping } = await run("submittable", table);
    const rows = plan.rows.filter((r) => r.outcome === "create").map((r) => ({ line: r.line, key: r.key, title: r.title }));
    return { rows, keyOf: idKey("award_history", { kind: "csv", ref: null }, mapping.sourceId ?? null) };
  }

  it("hashes an id the same way the dry run keyed its row", async () => {
    const { rows, keyOf } = await createdRows();
    expect(await keyOf("70012345")).toBe(rows[0]!.key);
  });

  it("matches files to imported records by the export's id, then by title, and only when one record fits", async () => {
    const { rows, keyOf } = await createdRows();
    const paths = [
      "70012345 - Clinic van/Submission 70012345.pdf",
      "70012348/budget.xlsx",
      "Library hours/letters of support.pdf",
      "70012346 - After-school tutors/Submission.pdf",
      "70012345 70012348/combined.pdf",
      "__MACOSX/70012345/._Submission.pdf",
      ".DS_Store",
      "70012349/",
    ];
    const r = await matchAttachments({ adapter: ADAPTERS.submittable, paths, rows, keyOf });
    expect(r.matched).toEqual([
      { path: paths[0], name: "Submission 70012345.pdf", line: 2, by: "id" },
      { path: paths[1], name: "budget.xlsx", line: 5, by: "id" },
      { path: paths[2], name: "letters of support.pdf", line: 6, by: "title" },
    ]);
    // A declined submission was not imported, so its file has nowhere to go.
    expect(r.unmatched).toEqual([
      { path: paths[3], name: "Submission.pdf", why: "no_match" },
      { path: paths[4], name: "combined.pdf", why: "ambiguous" },
    ]);
  });

  it("matches Good Grants PDFs by the application's slug", async () => {
    const table = tableFromCsv(fixture("good-grants.csv"));
    const { plan, mapping } = await run("good_grants", table);
    const rows = plan.rows.filter((r) => r.outcome === "create").map((r) => ({ line: r.line, key: r.key, title: r.title }));
    const r = await matchAttachments({ adapter: ADAPTERS.good_grants, paths: ["applications/DeFgHiJk.pdf", "applications/AbCdEfGh-coastal.pdf"], rows, keyOf: idKey("award_history", { kind: "csv", ref: null }, mapping.sourceId ?? null) });
    expect(r.matched.map((m) => [m.name, m.line])).toEqual([
      ["DeFgHiJk.pdf", 5],
      ["AbCdEfGh-coastal.pdf", 2],
    ]);
  });

  it("lists a zip's files and reads one, without reading the others", () => {
    const zip = zipSync({ "70012345 - Clinic van/Submission.pdf": strToU8("%PDF-1.4 fake"), "__MACOSX/._x": strToU8("x"), "notes/readme.txt": strToU8("hello") });
    expect(listZip(zip)).toEqual([
      { path: "70012345 - Clinic van/Submission.pdf", size: 13 },
      { path: "notes/readme.txt", size: 5 },
    ]);
    expect(new TextDecoder().decode(readZipEntry(zip, "notes/readme.txt")!)).toBe("hello");
    expect(readZipEntry(zip, "missing.pdf")).toBeNull();
    expect(() => listZip(strToU8("not a zip"))).toThrow(/could not be read/);
    expect(mimeFor("Submission.PDF")).toBe("application/pdf");
    expect(mimeFor("data.bin")).toBe("application/octet-stream");
  });
});
