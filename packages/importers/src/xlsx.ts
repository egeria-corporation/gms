// SPDX-License-Identifier: AGPL-3.0-only
// XLSX upload. Read with `read-excel-file` (MIT, maintained), through its `universal` entry: it
// unzips with fflate and parses the sheet XML with saxen, both plain JavaScript, so it runs in a
// Cloudflare Worker without Node APIs, a DOM or a worker thread. Only .xlsx (Office Open XML) is
// read; the older binary .xls format is refused.
//
// Kept on its own entry (`@gms/importers/xlsx`) so the web app never bundles it.
import readXlsxFile from "read-excel-file/universal";
import { SourceTableError, tableFromGrid, type SourceTable } from "./table.ts";

/** The largest workbook read: about 50,000 ordinary cells, far beyond 5,000 grant rows. */
export const MAX_XLSX_BYTES = 4 * 1024 * 1024;

/** Every zip file starts with these bytes ("PK\x03\x04"). */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export interface Workbook {
  sheets: string[];
  table: SourceTable;
  /** The sheet read. */
  sheet: string;
}

/** Read one sheet of a workbook (the first, unless `sheet` names another) as a table. */
export async function readXlsx(bytes: Uint8Array, sheet?: string | null): Promise<Workbook> {
  if (bytes.byteLength === 0) throw new SourceTableError("empty", "The file is empty");
  if (bytes.byteLength > MAX_XLSX_BYTES) throw new SourceTableError("unreadable", "The workbook is larger than 4 MB. Save the sheet you need as a CSV file, or remove other sheets");
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw new SourceTableError("unreadable", "This is not an .xlsx workbook. Save it from your spreadsheet as .xlsx or as CSV");
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    // A copy, so the reader gets an ArrayBuffer of exactly the file (not a larger shared buffer).
    sheets = await readXlsxFile(bytes.slice().buffer as ArrayBuffer, { trim: false });
  } catch {
    throw new SourceTableError("unreadable", "The workbook could not be read. Open it in your spreadsheet, save it again as .xlsx, or save the sheet as CSV");
  }
  if (!sheets.length) throw new SourceTableError("empty", "The workbook has no sheets");
  const chosen = sheet ? sheets.find((s) => s.sheet === sheet) : sheets[0];
  if (!chosen) throw new SourceTableError("empty", `The workbook has no sheet named "${sheet}"`);
  return { sheets: sheets.map((s) => s.sheet), sheet: chosen.sheet, table: tableFromGrid(chosen.data as unknown[][]) };
}
