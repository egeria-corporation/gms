// SPDX-License-Identifier: AGPL-3.0-only
// Import applications tracked somewhere else (a spreadsheet) from a CSV file: choose which column
// fills which field, check every row before anything is created, then import the rows that pass.
import { useMemo, useState } from "react";
import { CircleCheck, TriangleExclamationPoint, Upload, X } from "lucide-react";
import { IMPORT_FIELDS, type ImportField, type ImportResult } from "../../../api/outside.ts";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, Notice } from "../../../components/ui.tsx";
import { parseCsv } from "../../../lib/csv.ts";

export const MAX_IMPORT_ROWS = 500;

const FIELD_LABELS: Record<ImportField, string> = {
  title: "Title",
  funderName: "Funder",
  programName: "Program",
  stage: "Stage",
  loiDue: "Letter of inquiry due",
  fullDue: "Full application due",
  internalDue: "Internal deadline",
  askAmount: "Ask (USD)",
  listingUrl: "Listing link",
  portalUrl: "Portal link",
};
const GUESS: Record<ImportField, RegExp> = {
  title: /^(title|application|project|grant|name)$/i,
  funderName: /funder|foundation|grantor/i,
  programName: /program/i,
  stage: /stage|status/i,
  loiDue: /loi|inquiry|intent/i,
  fullDue: /full|deadline|due/i,
  internalDue: /internal/i,
  askAmount: /ask|amount|request/i,
  listingUrl: /listing|url|link|website/i,
  portalUrl: /portal/i,
};

/** A first guess at which header fills which field; each header is used once. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const used = new Set<string>();
  const out: Partial<Record<ImportField, string>> = {};
  // Specific fields first, so "Internal deadline" is not taken by the full deadline.
  for (const f of ["internalDue", "loiDue", "portalUrl", "funderName", "programName", "title", "stage", "askAmount", "fullDue", "listingUrl"] as ImportField[]) {
    const h = headers.find((x) => !used.has(x) && GUESS[f].test(x.trim()));
    if (h) {
      out[f] = h;
      used.add(h);
    }
  }
  return out;
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (n: number) => void }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const rows = useMemo(() => (csv.trim() ? parseCsv(csv) : []), [csv]);
  const headers = rows[0] ?? [];
  const count = Math.max(0, rows.length - 1);
  const tooMany = count > MAX_IMPORT_ROWS;
  const check = useOutsideMutation((api) => api.importCsv({ csv, mapping, dryRun: true }));
  const run = useOutsideMutation((api) => api.importCsv({ csv, mapping, dryRun: false }));
  const ready = checked?.rows.filter((r) => r.problems.length === 0).length ?? 0;
  const take = (text: string, name: string | null) => {
    setCsv(text);
    setFileName(name);
    setChecked(null);
    setMapping(guessMapping(parseCsv(text)[0] ?? []));
  };

  return (
    <Dialog open onClose={onClose} labelledBy="imp-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="imp-title" style={{ fontSize: "16px" }}>
            Import applications from a spreadsheet
          </h3>
          <p className="small muted">A CSV file with a header row, up to {MAX_IMPORT_ROWS} applications. Every row is checked before anything is created.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            <Upload className="ic" aria-hidden="true" />
            Choose a CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr"
              aria-label="Choose a CSV file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) take(await f.text(), f.name);
                e.target.value = "";
              }}
            />
          </label>
          {fileName && <span className="small">{fileName}</span>}
        </div>
        <Field id="imp-text" label="Or paste the CSV" help={count ? `${count} row${count === 1 ? "" : "s"} after the header` : undefined}>
          <textarea id="imp-text" className="ta mono" style={{ minHeight: "90px", fontSize: "12px" }} value={csv} onChange={(e) => take(e.target.value, null)} />
        </Field>
        {tooMany && (
          <Notice tone="warn" title={`This file has ${count} rows`}>
            Import at most {MAX_IMPORT_ROWS} at a time. Split the file and import each part.
          </Notice>
        )}
        {headers.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl">Which column fills each field</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", marginTop: "6px" }}>
              {IMPORT_FIELDS.map((f) => (
                <Field key={f} id={`imp-map-${f}`} label={FIELD_LABELS[f]} required={f === "title" || f === "funderName"}>
                  <select
                    id={`imp-map-${f}`}
                    className="sel"
                    value={mapping[f] ?? ""}
                    onChange={(e) => {
                      setChecked(null);
                      setMapping({ ...mapping, [f]: e.target.value || undefined });
                    }}
                  >
                    <option value="">Not in the file</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        {checked && (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Rows checked, scrollable" style={{ maxHeight: "240px", overflow: "auto" }}>
            <table className="tbl tbl-compact" aria-label="Rows checked">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Title</th>
                  <th>Funder</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {checked.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td>{r.values.title ?? "—"}</td>
                    <td>{r.values.funderName ?? "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {r.problems.length === 0 ? (
                        <span className="bdg bdg-ok">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Ready
                        </span>
                      ) : (
                        <span className="bdg bdg-warn" title={r.problems.map((p) => p.message).join("; ")}>
                          <TriangleExclamationPoint className="ic" aria-hidden="true" />
                          {r.problems.map((p) => p.message).join("; ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {checked && (
          <p className="small" role="status">
            {ready} of {checked.rows.length} row{checked.rows.length === 1 ? "" : "s"} ready to import.
            {ready < checked.rows.length ? " Rows with a problem are skipped; fix them in the file and import them later." : ""}
          </p>
        )}
        {check.error ? <ErrorBanner error={check.error} title="The file could not be checked" /> : null}
        {run.error ? <ErrorBanner error={run.error} title="The import did not finish" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        {checked ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={ready === 0 || run.state === "saving"}
            onClick={async () => {
              const r = await run.run();
              if (r) onImported(r.created.length);
            }}
          >
            {run.state === "saving" ? "Importing…" : `Import ${ready} application${ready === 1 ? "" : "s"}`}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            disabled={!count || tooMany || !mapping.title || !mapping.funderName || check.state === "saving"}
            onClick={async () => {
              const r = await check.run();
              if (r) setChecked(r);
            }}
          >
            {check.state === "saving" ? "Checking…" : "Check the rows"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
