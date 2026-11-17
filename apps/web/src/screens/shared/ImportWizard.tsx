// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard: a funder's grant history or an applicant's applications, from a CSV or Excel
// file, Google Sheets or Airtable. Source → connect (for an app, when needed) → pick → map with
// suggestions → check every row (the reconciliation, and the columns left out) → import → summary.
// The server drops columns that look like bank or identity details before anything comes back;
// this screen only ever sees the columns that may be imported, and names the ones left out.
//
// A funder moving from another grants system (v1.9.0) picks the system its export comes from (Good
// Grants, SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple, OpenWater) and gets that
// system's matching, or reads straight from Fluxx or Zengine with credentials it creates there.
// After the import, the PDFs and files of the system's zip can be attached to the imported awards:
// the zip is opened here, only its file names are sent to be matched, then each matched file.
//
// Imported history (v1.12.0): a funder first says what the file holds (ImportTargetPicker): grant
// history, or past applications, reviews or reports, kept read-only as "Imported history".
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRightLeft, Check, CircleCheck, CircleSlash, Database, FileArchive, FileSpreadsheet, Link2, Link2Off, Plug, ShieldCheck, Sheet, TriangleExclamationPoint, Unplug, Upload } from "lucide-react";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { fileSource, targetFor, toBase64, type ConnectedApp, type ImportAdapter, type ImportAdapterKey, type ImportCommitted, type ImportFilesMatch, type ImportPreview, type ImportPreviewRow, type ImportPuller, type ImportRead, type ImportRunDetail, type ImportSourceInput, type ImportTotal, type ZengineForm } from "../../api/imports.ts";
import { useImportsApi, useImportsQuery } from "../../api/importsHooks.ts";
import { ApplicantShell, FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { railLabel } from "../../components/shells.tsx";
import { ImportTargetPicker, isFunderTarget, KIND_OF, type FunderTarget } from "./ImportTargetPicker.tsx";
import { formatMinor } from "../../lib/format.ts";

import { intlLocale, translator } from "../../i18n/index.tsx";

const tr = translator("shared");
type Step = "source" | "system" | "connect" | "pick" | "map" | "check" | "import" | "done";
/** A file, a connected app, an export from a grants system, or a grants system read through its API. */
type Choice = "file" | "system" | ConnectedApp | ImportPuller;
const STEP_KEY = {
  source: "importWizard.step.source",
  system: "importWizard.step.system",
  connect: "importWizard.step.connect",
  pick: "importWizard.step.pick",
  map: "importWizard.step.map",
  check: "importWizard.step.check",
  import: "importWizard.step.import",
  done: "importWizard.step.done",
} as const satisfies Record<Step, string>;
const STEP_LABEL = (step: Step): string => tr(STEP_KEY[step]);
const APP_LABEL: Record<ConnectedApp | ImportPuller, string> = { google_sheets: "Google Sheets", airtable: "Airtable", fluxx: "Fluxx", zengine: "Zengine" };
const isPuller = (c: Choice | null): c is ImportPuller => c === "fluxx" || c === "zengine";
const isApp = (c: Choice | null): c is ConnectedApp => c === "google_sheets" || c === "airtable";
/** Files read from a zip at once, and sent to be matched. */
const MAX_ZIP_PATHS = 2000;
const KIND_LABEL: Record<string, string> = {
  get ask() {
    return tr("importWizard.kind.ask");
  },
  get awarded() {
    return tr("importWizard.kind.awarded");
  },
  get paid() {
    return tr("importWizard.kind.paid");
  },
};

function Steps({ steps, at }: { steps: Step[]; at: Step }) {
  const i = steps.indexOf(at);
  return (
    <ol className="stp" aria-label={tr("importWizard.importSteps")} style={{ flexWrap: "wrap", rowGap: "8px", marginBottom: "18px" }}>
      {steps.map((s, n) => (
        <li key={s} style={{ display: "contents" }}>
          {n > 0 && <span className={n <= i ? "ln done" : "ln"} aria-hidden="true"></span>}
          <div className={n < i || (s === "done" && at === "done") ? "s done" : n === i ? "s on" : "s"} aria-current={n === i ? "step" : undefined}>
            <span className="n">{n < i || (s === "done" && at === "done") ? <Check className="ic ic-sm" aria-hidden="true" /> : n + 1}</span>
            {STEP_LABEL(s)}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A row's outcome, always as an icon and a label. */
function OutcomeBadge({ outcome, written }: { outcome: string; written?: boolean }) {
  if (outcome === "create")
    return (
      <span className="bdg bdg-ok">
        <CircleCheck className="ic" aria-hidden="true" />
        {written ? tr("importWizard.imported") : tr("importWizard.willBeImported")}
      </span>
    );
  if (outcome === "skip")
    return (
      <span className="bdg bdg-neutral">
        <CircleSlash className="ic" aria-hidden="true" />
        {tr("importWizard.skipped")}
      </span>
    );
  return (
    <span className="bdg bdg-warn">
      <TriangleExclamationPoint className="ic" aria-hidden="true" />
      {tr("importWizard.needsAFix")}
    </span>
  );
}

function Dropped({ dropped }: { dropped: ImportRead["dropped"] }) {
  if (!dropped.length) return null;
  return (
    <Notice tone="warn" title={tr("importWizard.columnsLeftOutCount", { count: dropped.length })}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        {tr("importWizard.theseColumnsLookLikeBank")}
      </p>
      <ul aria-label={tr("importWizard.columnsLeftOut2")} style={{ margin: 0, paddingLeft: "18px" }}>
        {dropped.map((d) => (
          <li key={d.column} className="small">
            <b>{d.column}</b>: {d.why}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Created rows' money by year, one column per kind. */
function Totals({ totals }: { totals: ImportTotal[] }) {
  const created = totals.filter((t) => t.outcome === "create");
  if (!created.length) return null;
  const kinds = [...new Set(created.map((t) => t.kind))];
  const years = [...new Set(created.map((t) => t.year))].sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const currencies = [...new Set(created.map((t) => t.currency))];
  const cell = (year: number | null, kind: string) =>
    currencies
      .map((c) => created.find((t) => t.year === year && t.kind === kind && t.currency === c))
      .filter(Boolean)
      .map((t) => tr("importWizard.amountRows", { amount: formatMinor(t!.amountMinor, t!.currency), count: t!.rows }))
      .join(" · ") || "—";
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("importWizard.amountsByYearScrollable")}>
      <table className="tbl tbl-compact" aria-label={tr("importWizard.amountsByYear")}>
        <thead>
          <tr>
            <th>{tr("importWizard.year")}</th>
            {kinds.map((k) => (
              <th key={k} className="num">
                {KIND_LABEL[k] ?? k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={String(y)}>
              <td>{y ?? tr("importWizard.noYear")}</td>
              {kinds.map((k) => (
                <td key={k} className="num">
                  {cell(y, k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FILTERS = ["all", "create", "skip", "error"] as const;
const FILTER_KEY = { all: "importWizard.filter.all", create: "importWizard.filter.create", skip: "importWizard.filter.skip", error: "importWizard.filter.error" } as const;
const FILTER_LABEL = (f: (typeof FILTERS)[number]): string => tr(FILTER_KEY[f]);
const SHOW = 200;

function RowsTable({ rows, subtitle }: { rows: ImportPreviewRow[]; subtitle: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const shown = rows.filter((r) => filter === "all" || r.outcome === filter);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="seg" role="group" aria-label={tr("importWizard.showRows")}>
        {FILTERS.map((k) => (
          <button key={k} type="button" className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {FILTER_LABEL(k)}
          </button>
        ))}
      </div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("importWizard.rowsCheckedScrollable")} style={{ maxHeight: "360px", overflow: "auto" }}>
        <table className="tbl tbl-compact" aria-label={tr("importWizard.rowsChecked")}>
          <thead>
            <tr>
              <th className="num">{tr("importWizard.row")}</th>
              <th>{tr("importWizard.title")}</th>
              <th>{subtitle}</th>
              <th>{tr("importWizard.check")}</th>
              <th>{tr("importWizard.why")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, SHOW).map((r) => (
              <tr key={r.line}>
                <td className="num">{r.line}</td>
                <td>{r.title}</td>
                <td>{r.subtitle ?? "—"}</td>
                <td>
                  <OutcomeBadge outcome={r.outcome} />
                </td>
                <td style={{ whiteSpace: "normal" }} className="small">
                  {r.reason ?? (r.problems.map((p) => p.message).join("; ") || "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > SHOW && <p className="small muted">{tr("importWizard.showingTheFirstOfRows", { SHOW, length: shown.length })}</p>}
    </div>
  );
}

function SourceOption({ value, chosen, onChoose, icon, title, children, status }: { value: Choice; chosen: Choice | null; onChoose: (c: Choice) => void; icon: ReactNode; title: string; children: ReactNode; status?: ReactNode }) {
  return (
    <label className="card" style={{ display: "flex", gap: "12px", padding: "14px 16px", cursor: "pointer", alignItems: "flex-start", borderColor: chosen === value ? "var(--og-teal-dark)" : undefined }}>
      <input type="radio" name="import-source" value={value} checked={chosen === value} onChange={() => onChoose(value)} style={{ marginTop: "3px" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
        <span className="row" style={{ gap: "8px", fontWeight: 700 }}>
          {icon}
          {title}
        </span>
        <span className="small muted">{children}</span>
      </span>
      {status}
    </label>
  );
}

/** A file's bytes (jsdom and older browsers lack Blob.arrayBuffer). */
const bytesOf = (file: File): Promise<Uint8Array> =>
  typeof file.arrayBuffer === "function"
    ? file.arrayBuffer().then((b) => new Uint8Array(b))
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
        r.onerror = () => reject(new Error(tr("importWizard.theFileCouldNotBe")));
        r.readAsArrayBuffer(file);
      });

/**
 * The PDFs and files of a grants system's zip, attached to the awards an import created. The zip is
 * opened in the browser; only its file names go to the server to be matched, then each matched
 * file on its own. Nothing in them is read by the GMS.
 */
function ZipFiles({ runId, adapter, history = false }: { runId: string; adapter: ImportAdapter; history?: boolean }) {
  const api = useImportsApi();
  const [zip, setZip] = useState<{ name: string; bytes: Uint8Array; extra: number } | null>(null);
  const [match, setMatch] = useState<ImportFilesMatch | null>(null);
  const [progress, setProgress] = useState<{ done: number; attached: number; already: number; failed: { name: string; why: string }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function choose(file: File | null) {
    if (!file) return;
    setBusy("read");
    setError(null);
    setMatch(null);
    setProgress(null);
    try {
      const bytes = await bytesOf(file);
      const { listZip } = await import("@gms/importers/zip");
      const paths = listZip(bytes).map((e) => e.path);
      setZip({ name: file.name, bytes, extra: Math.max(0, paths.length - MAX_ZIP_PATHS) });
      setMatch(paths.length ? await api.matchFiles(runId, paths.slice(0, MAX_ZIP_PATHS)) : { matched: [], unmatched: [] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function attachAll() {
    if (!zip || !match) return;
    setBusy("attach");
    setError(null);
    const { readZipEntry } = await import("@gms/importers/zip");
    const p = { done: 0, attached: 0, already: 0, failed: [] as { name: string; why: string }[] };
    setProgress({ ...p });
    for (const m of match.matched) {
      const bytes = readZipEntry(zip.bytes, m.path);
      if (!bytes) p.failed.push({ name: m.name, why: tr("importWizard.largerThan25Mb") });
      else {
        try {
          const r = await api.attachFile(runId, { path: m.path, contentBase64: toBase64(bytes) });
          if (r.created) p.attached++;
          else p.already++;
        } catch (e) {
          p.failed.push({ name: m.name, why: e instanceof Error ? e.message : tr("importWizard.itCouldNotBeAttached") });
        }
      }
      p.done++;
      setProgress({ ...p, failed: [...p.failed] });
    }
    setBusy(null);
  }

  return (
    <section className="card" aria-labelledby="imp-files">
      <div className="card-h">
        <h3 id="imp-files">{tr("importWizard.addThePdfsAndFiles")}</h3>
        <span className="small muted">{tr("importWizard.optional")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="small" style={{ margin: 0 }}>
          {history ? tr("importWizard.target.zip.onlyYourTeam", { attachments: adapter.attachments }) : tr("importWizard.onlyYourTeamSeesThem", { attachments: adapter.attachments })}
        </p>
        {error ? <ErrorBanner error={error} /> : null}
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            <FileArchive className="ic" aria-hidden="true" />
            {zip ? tr("importWizard.chooseAnotherZip") : tr("importWizard.chooseTheZip")}
            <input type="file" accept=".zip,application/zip" className="sr" aria-label={tr("importWizard.chooseTheZip")} disabled={!!busy} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
          </label>
          {zip && <span className="small">{zip.name}</span>}
          {busy === "read" && <span className="small muted">{tr("importWizard.readingTheZip")}</span>}
        </div>
        {zip && zip.extra > 0 && <p className="small muted">{tr("importWizard.theZipHoldsMoreThan", { count: MAX_ZIP_PATHS.toLocaleString(intlLocale()) })}</p>}
        {match && (
          <>
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }} role="group" aria-label={tr("importWizard.filesMatched")}>
              <span className="bdg bdg-ok">
                <CircleCheck className="ic" aria-hidden="true" />
                {history ? tr("importWizard.target.zip.filesMatch", { count: match.matched.length }) : tr("importWizard.filesMatch", { count: match.matched.length })}
              </span>
              {match.unmatched.length > 0 && (
                <span className="bdg bdg-neutral">
                  <CircleSlash className="ic" aria-hidden="true" />
                  {tr("importWizard.leftOut", { length: match.unmatched.length })}
                </span>
              )}
            </div>
            {match.matched.length > 0 && (
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label={tr("importWizard.filesToAttachScrollable")} style={{ maxHeight: "260px", overflow: "auto" }}>
                <table className="tbl tbl-compact" aria-label={tr("importWizard.filesToAttach")}>
                  <thead>
                    <tr>
                      <th>{tr("importWizard.file")}</th>
                      <th>{history ? tr("importWizard.target.zip.record") : tr("importWizard.award")}</th>
                      <th>{tr("importWizard.matchedBy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.matched.slice(0, 200).map((m) => (
                      <tr key={m.path}>
                        <td>{m.name}</td>
                        <td>{m.title}</td>
                        <td className="small">{m.by === "id" ? tr("importWizard.itsIdInTheFile") : tr("importWizard.itsTitle")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {match.unmatched.length > 0 && (
              <ul aria-label={tr("importWizard.filesLeftOut")} style={{ margin: 0, paddingLeft: "18px" }}>
                {match.unmatched.slice(0, 50).map((u) => (
                  <li key={u.path} className="small">
                    <b>{u.name}</b>: {u.why}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {progress && (
          <div className="mtr">
            <div className="lbls">
              {/* The count is the announced part: a progress bar's value changes silently (WCAG 4.1.3). */}
              <span role="status">
                {tr.rich("importWizard.attachedOf", { done: progress.attached + progress.already, total: match?.matched.length ?? 0, b: (chunks) => <b>{chunks}</b> })}
              </span>
            </div>
            <div className="track" role="progressbar" aria-label={tr("importWizard.attachingFiles")} aria-valuemin={0} aria-valuemax={match?.matched.length ?? 0} aria-valuenow={progress.done}>
              <div className="fill" style={{ width: `${match?.matched.length ? (progress.done / match.matched.length) * 100 : 100}%` }}></div>
            </div>
          </div>
        )}
        {progress && !busy && match && progress.done === match.matched.length && (
          <Notice tone={progress.failed.length ? "warn" : "ok"} title={tr("importWizard.filesAttached", { count: progress.attached })}>
            {progress.already ? (history ? tr("importWizard.target.zip.alreadyOn", { count: progress.already }) : tr("importWizard.alreadyOnAward", { count: progress.already })) : ""}
            {progress.failed.length ? tr("importWizard.couldNotBeAttached", { length: progress.failed.length, join: progress.failed.map((f) => `${f.name} (${f.why})`).join("; ") }) : history ? tr("importWizard.target.zip.eachIsOn") : tr("importWizard.eachIsOnTheAward")}
          </Notice>
        )}
      </div>
      {match && match.matched.length > 0 && !(progress && progress.done === match.matched.length) && (
        <div className="card-f">
          <button type="button" className="btn btn-primary" disabled={busy === "attach"} onClick={() => void attachAll()}>
            {busy === "attach" ? tr("importWizard.attaching") : tr("importWizard.attachFiles", { count: match.matched.length })}
          </button>
        </div>
      )}
    </section>
  );
}

export function ImportWizard() {
  const ws = useCurrentWorkspace()!;
  const api = useImportsApi();
  const [params] = useSearchParams();
  const funder = ws.kind === "funder";
  // A funder chooses what it imports (`?target=` opens one directly); an applicant imports its applications.
  const asked = params.get("target");
  const [funderTarget, setFunderTarget] = useState<FunderTarget>(isFunderTarget(asked) ? asked : "award_history");
  const target = funder ? funderTarget : targetFor(ws.kind);
  const past = target !== "award_history" && target !== "outside_applications";
  const base = `/w/${ws.handle}`;
  const noun = funder ? { one: KIND_OF[target], many: "awards", list: "Awards", to: past ? `${base}/grantees` : `${base}/awards` } : { one: "application", many: "applications", list: "Applications", to: `${base}/applications` };
  const returned = params.get("connected");
  const sources = useImportsQuery((a) => a.sources(target), [target]);

  const [choice, setChoice] = useState<Choice | null>(returned === "google_sheets" || returned === "airtable" ? returned : null);
  const [system, setSystem] = useState<ImportAdapterKey | null>(null);
  const [creds, setCreds] = useState({ instanceUrl: "", clientId: "", clientSecret: "", token: "" });
  const [forms, setForms] = useState<ZengineForm[] | null>(null);
  const [formId, setFormId] = useState("");
  const [step, setStep] = useState<Step>(returned === "google_sheets" || returned === "airtable" ? "pick" : "source");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [source, setSource] = useState<ImportSourceInput | null>(null);
  const [read, setRead] = useState<ImportRead | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [progress, setProgress] = useState<ImportCommitted | null>(null);
  const [detail, setDetail] = useState<ImportRunDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const option = (k: ConnectedApp | ImportPuller) => (sources.status === "ready" ? sources.data.sources.find((s) => s.kind === k) : undefined);
  const adapters = sources.status === "ready" ? sources.data.adapters : [];
  const adapterOf = (k: string | null | undefined) => adapters.find((a) => a.key === k);
  const needsConnect = (isApp(choice) || isPuller(choice)) && option(choice)?.connected === false;
  const steps: Step[] = useMemo(() => ["source", ...(choice === "system" ? (["system"] as Step[]) : []), ...(needsConnect || step === "connect" ? (["connect"] as Step[]) : []), "pick", "map", "check", "import", "done"], [needsConnect, step, choice]);
  const columns = read?.columns ?? [];
  const missing = (read?.fields ?? []).filter((f) => f.required && !mapping[f.key]);

  async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    setError(null);
    try {
      return await run();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function readSource(src: ImportSourceInput, adapter?: ImportAdapterKey) {
    const r = await attempt("read", () => api.read(target, src, adapter));
    if (!r) return;
    setSource(src);
    setRead(r);
    setMapping(r.mapping);
    setPreview(null);
    setStep("map");
  }

  async function pick() {
    if (choice === "file" || choice === "system") {
      const src = file ? await fileSource(file) : { kind: "csv" as const, text: pasted, fileName: tr("importWizard.pastedCsv") };
      return readSource(src, choice === "system" ? (system ?? undefined) : undefined);
    }
    if (choice === "fluxx") return readSource({ kind: "fluxx" });
    if (choice === "zengine") return readSource({ kind: "zengine", formId });
    if (choice === "google_sheets") return readSource({ kind: "google_sheets", url: link });
    if (choice === "airtable") return readSource({ kind: "airtable", url: link });
  }

  async function connectPuller(provider: ImportPuller) {
    const r = await attempt("connect", () => api.connectPuller(provider, provider === "fluxx" ? { instanceUrl: creds.instanceUrl, clientId: creds.clientId, clientSecret: creds.clientSecret } : { token: creds.token }));
    if (!r) return;
    // The secret is not kept on this page once it is sent.
    setCreds({ instanceUrl: "", clientId: "", clientSecret: "", token: "" });
    sources.reload();
    setStep("pick");
  }

  async function disconnectPuller(provider: ImportPuller) {
    const r = await attempt("disconnect", () => api.disconnectPuller(provider));
    if (!r) return;
    sources.reload();
    setForms(null);
    setStep("source");
  }

  // Zengine: the forms the token can read, once connected.
  useEffect(() => {
    if (step !== "pick" || choice !== "zengine" || forms) return;
    void attempt("forms", () => api.zengineForms()).then((f) => {
      if (!f) return;
      setForms(f);
      if (f.length === 1) setFormId(f[0]!.id);
    });
  }, [step, choice, forms]);

  /** The next part of a source larger than one run (Fluxx, Zengine). */
  async function continueNext() {
    const next = preview?.run.nextPage;
    if (!source || !next || (source.kind !== "fluxx" && source.kind !== "zengine")) return;
    setProgress(null);
    setDetail(null);
    await readSource({ ...source, startPage: next });
  }

  async function connect(app: ConnectedApp) {
    const r = await attempt("connect", () => api.connect(app, `${base}/import?connected=${app}`));
    if (!r) return;
    if (r.connectUrl) window.location.assign(r.connectUrl);
    else {
      sources.reload();
      setStep("pick");
    }
  }

  async function check() {
    if (!source) return;
    const p = await attempt("check", () => api.preview({ target, source, mapping, saveMapping: remember, ...(read?.adapter ? { adapter: read.adapter.key } : {}) }));
    if (!p) return;
    setPreview(p);
    setStep("check");
  }

  async function importAll() {
    if (!preview) return;
    setStep("import");
    const done = await attempt("import", async () => {
      for (;;) {
        const c = await api.commit(preview.run.id);
        setProgress(c);
        if (c.done) return c;
      }
    });
    if (!done) return;
    const d = await attempt("summary", () => api.run(preview.run.id));
    if (d) setDetail(d);
    setStep("done");
  }

  function restart() {
    setStep("source");
    setChoice(null);
    setSystem(null);
    setFile(null);
    setPasted("");
    setLink("");
    setSource(null);
    setRead(null);
    setPreview(null);
    setProgress(null);
    setDetail(null);
    setError(null);
  }

  const Shell = funder ? FunderShell : ApplicantShell;
  const title = funder ? tr("importWizard.importGrantHistory") : tr("importWizard.importApplications");
  const created = detail?.rows.filter((r) => r.entity) ?? [];
  const reconciliation = preview?.run.reconciliation;

  return (
    <>
      <title>{`${title} — ${ws.name}`}</title>
      <Shell active={noun.list}>
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: railLabel(noun.list), to: noun.to }, { label: tr("importWizard.step.import") }]}
            title={title}
            meta={<span>{past ? tr("importWizard.target.meta") : funder ? tr("importWizard.pastAwardsToNamedOrganizations") : tr("importWizard.applicationsYouTrackInA")}</span>}
          />
          <Steps steps={steps} at={step} />
          {error ? <ErrorBanner error={error} title={busy === "import" || step === "import" ? tr("importWizard.theImportStopped") : tr("importWizard.thatDidNotWork")} /> : null}

          {step === "source" && (
            <section className="card" aria-labelledby="imp-source">
              <div className="card-h">
                <h3 id="imp-source">{tr("importWizard.whereAreYour", { kind: noun.one })}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {sources.status === "loading" && <Loading label={tr("importWizard.loadingSources")} />}
                {sources.status === "error" && <ErrorBanner error={sources.error} onRetry={sources.reload} />}
                {funder && <ImportTargetPicker target={funderTarget} onChange={(next) => { setFunderTarget(next); setChoice(null); setSystem(null); }} />}
                {sources.status === "ready" && (
                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">{tr("importWizard.source")}</legend>
                    <SourceOption value="file" chosen={choice} onChoose={setChoice} icon={<FileSpreadsheet className="ic" aria-hidden="true" />} title={tr("importWizard.aFileFromYourComputer")}>
                      {tr("importWizard.aCsvFileOrAn", { count: sources.data.maxRows })}
                    </SourceOption>
                    {funder && adapters.some((a) => a.via === "file") && (
                      <SourceOption value="system" chosen={choice} onChoose={setChoice} icon={<ArrowRightLeft className="ic" aria-hidden="true" />} title={tr("importWizard.anExportFromAnotherGrants")}>
                        {tr("importWizard.theColumnsAreMatchedFor", { join: adapters
                          .filter((a) => a.via === "file")
                          .map((a) => a.system)
                          .join(", ") })}
                      </SourceOption>
                    )}
                    {(["fluxx", "zengine"] as const)
                      .filter((k) => option(k))
                      .map((k) => (
                        <SourceOption
                          key={k}
                          value={k}
                          chosen={choice}
                          onChoose={setChoice}
                          icon={<Plug className="ic" aria-hidden="true" />}
                          title={APP_LABEL[k]}
                          status={
                            option(k)!.connected ? (
                              <span className="bdg bdg-ok">
                                <Link2 className="ic" aria-hidden="true" />
                                {tr("importWizard.connected")}
                              </span>
                            ) : (
                              <span className="bdg bdg-neutral">
                                <Link2Off className="ic" aria-hidden="true" />
                                {tr("importWizard.notConnected")}
                              </span>
                            )
                          }
                        >
                          {tr(k === "fluxx" ? "importWizard.readHistoryFluxx" : "importWizard.readHistoryToken", { system: APP_LABEL[k] })}
                        </SourceOption>
                      ))}
                    {(["google_sheets", "airtable"] as const)
                      .filter((k) => option(k))
                      .map((k) => (
                        <SourceOption
                          key={k}
                          value={k}
                          chosen={choice}
                          onChoose={setChoice}
                          icon={k === "google_sheets" ? <Sheet className="ic" aria-hidden="true" /> : <Database className="ic" aria-hidden="true" />}
                          title={APP_LABEL[k]}
                          status={
                            option(k)!.connected ? (
                              <span className="bdg bdg-ok">
                                <Link2 className="ic" aria-hidden="true" />
                                {tr("importWizard.connected")}
                              </span>
                            ) : (
                              <span className="bdg bdg-neutral">
                                <Link2Off className="ic" aria-hidden="true" />
                                {tr("importWizard.notConnected")}
                              </span>
                            )
                          }
                        >
                          {k === "google_sheets" ? tr("importWizard.pasteTheLinkToA") : tr("importWizard.pasteTheLinkToA2")}
                        </SourceOption>
                      ))}
                  </fieldset>
                )}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={!choice} onClick={() => setStep(choice === "system" ? "system" : needsConnect ? "connect" : "pick")}>
                  {tr("importWizard.continue")}
                </button>
                <Link to={noun.to} className="btn btn-ghost">
                  {tr("importWizard.cancel")}
                </Link>
              </div>
            </section>
          )}

          {step === "system" && (
            <section className="card" aria-labelledby="imp-system">
              <div className="card-h">
                <h3 id="imp-system">{tr("importWizard.whichSystemIsTheExport")}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
                  <legend className="sr">{tr("importWizard.system")}</legend>
                  {adapters
                    .filter((a) => a.via === "file")
                    .map((a) => (
                      <label key={a.key} className="card" style={{ display: "flex", gap: "10px", padding: "10px 12px", cursor: "pointer", alignItems: "center", borderColor: system === a.key ? "var(--og-teal-dark)" : undefined }}>
                        <input type="radio" name="import-system" value={a.key} checked={system === a.key} onChange={() => setSystem(a.key)} />
                        <span style={{ fontWeight: 600 }}>{a.system}</span>
                      </label>
                    ))}
                </fieldset>
                {adapterOf(system) && (
                  <div aria-label={tr("importWizard.howToExportFrom", { system: adapterOf(system)!.system })} role="group">
                    <p className="lbl" style={{ margin: "6px 0" }}>
                      {tr("importWizard.howToExportFrom", { system: adapterOf(system)!.system })}
                    </p>
                    <ol style={{ margin: 0, paddingLeft: "20px" }}>
                      {adapterOf(system)!.steps.map((x) => (
                        <li key={x} className="small">
                          {x}
                        </li>
                      ))}
                    </ol>
                    <p className="small muted" style={{ margin: "8px 0 0" }}>
                      {tr("importWizard.files", { join: adapterOf(system)!.accepts.map((x) => x.toUpperCase()).join(", ") })}{adapterOf(system)!.attachments ? ` ${tr("importWizard.afterTheImportYouCan")}` : ""}
                      {adapterOf(system)!.headersConfirmed ? "" : ` ${tr("importWizard.columnNamesDifferBetweenAccounts")}`}
                    </p>
                  </div>
                )}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={!system} onClick={() => setStep("pick")}>
                  {tr("importWizard.continue")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.back")}
                </button>
              </div>
            </section>
          )}

          {step === "connect" && isPuller(choice) && (
            <section className="card" aria-labelledby="imp-connect">
              <div className="card-h">
                <h3 id="imp-connect">{tr("importWizard.connect", { value: APP_LABEL[choice] })}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <ol style={{ margin: 0, paddingLeft: "20px" }} aria-label={tr("importWizard.howToConnect", { value: APP_LABEL[choice] })}>
                  {(adapterOf(choice)?.steps ?? []).map((x) => (
                    <li key={x} className="small">
                      {x}
                    </li>
                  ))}
                </ol>
                <p className="row" style={{ gap: "8px", margin: 0 }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  <span className="small">{tr("importWizard.theGmsChecksThemWith")}</span>
                </p>
                {option(choice)?.canConnect ? (
                  choice === "fluxx" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "10px" }}>
                      <Field id="imp-fluxx-url" label={tr("importWizard.fluxxAddress")} help={tr("importWizard.itLooksLikeHttpsYourfoundation")}>
                        <input id="imp-fluxx-url" className="inp" value={creds.instanceUrl} onChange={(e) => setCreds((c) => ({ ...c, instanceUrl: e.target.value }))} />
                      </Field>
                      <Field id="imp-fluxx-id" label={tr("importWizard.applicationId")}>
                        <input id="imp-fluxx-id" className="inp mono" autoComplete="off" value={creds.clientId} onChange={(e) => setCreds((c) => ({ ...c, clientId: e.target.value }))} />
                      </Field>
                      <Field id="imp-fluxx-secret" label={tr("importWizard.applicationSecret")}>
                        <input id="imp-fluxx-secret" type="password" className="inp mono" autoComplete="off" value={creds.clientSecret} onChange={(e) => setCreds((c) => ({ ...c, clientSecret: e.target.value }))} />
                      </Field>
                    </div>
                  ) : (
                    <Field id="imp-zengine-token" label={tr("importWizard.accessToken")}>
                      <input id="imp-zengine-token" type="password" className="inp mono" autoComplete="off" value={creds.token} onChange={(e) => setCreds((c) => ({ ...c, token: e.target.value }))} />
                    </Field>
                  )
                ) : (
                  <Notice tone="info" title={tr("importWizard.askAWorkspaceAdminTo", { value: APP_LABEL[choice] })}>{tr("importWizard.onceItIsConnectedThey")}</Notice>
                )}
              </div>
              <div className="card-f">
                {option(choice)?.canConnect && (
                  <button type="button" className="btn btn-primary" disabled={busy === "connect" || (choice === "fluxx" ? !creds.instanceUrl.trim() || !creds.clientId.trim() || !creds.clientSecret.trim() : creds.token.trim().length < 8)} onClick={() => void connectPuller(choice)}>
                    {busy === "connect" ? tr("importWizard.checking") : tr("importWizard.connect", { value: APP_LABEL[choice] })}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.back")}
                </button>
              </div>
            </section>
          )}

          {step === "connect" && isApp(choice) && (
            <section className="card" aria-labelledby="imp-connect">
              <div className="card-h">
                <h3 id="imp-connect">{tr("importWizard.connect", { value: APP_LABEL[choice] })}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <p className="row" style={{ gap: "8px", margin: 0 }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  <span>
                    {choice === "google_sheets"
                      ? tr("importWizard.youSignInWithGoogle")
                      : tr("importWizard.youSignInWithAirtable")}
                  </span>
                </p>
                {option(choice)?.canConnect ? null : <Notice tone="info" title={tr("importWizard.askAWorkspaceAdminTo", { value: APP_LABEL[choice] })}>{tr("importWizard.onceItIsConnectedAnyone")}</Notice>}
              </div>
              <div className="card-f">
                {option(choice)?.canConnect && (
                  <button type="button" className="btn btn-primary" disabled={busy === "connect"} onClick={() => void connect(choice)}>
                    {busy === "connect" ? tr("importWizard.opening") : tr("importWizard.connect", { value: APP_LABEL[choice] })}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.back")}
                </button>
              </div>
            </section>
          )}

          {step === "pick" && choice && (
            <section className="card" aria-labelledby="imp-pick">
              <div className="card-h">
                <h3 id="imp-pick">{choice === "file" ? tr("importWizard.chooseTheFile") : choice === "system" ? tr("importWizard.chooseTheExport", { value: adapterOf(system)?.system ?? "" }) : choice === "fluxx" ? tr("importWizard.readFromFluxx") : choice === "zengine" ? tr("importWizard.whichZengineForm") : choice === "google_sheets" ? tr("importWizard.whichSpreadsheet") : tr("importWizard.whichAirtableBase")}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {returned === choice && (
                  <Notice tone="ok" title={tr("importWizard.isConnected", { value: APP_LABEL[choice as ConnectedApp] })}>
                    {tr("importWizard.pasteTheLinkToRead")}
                  </Notice>
                )}
                {isPuller(choice) ? (
                  <>
                    <p className="row" style={{ gap: "8px", margin: 0 }}>
                      <Link2 className="ic" aria-hidden="true" />
                      <span className="small">
                        {tr("importWizard.isConnected2", { value: APP_LABEL[choice] })}{" "}
                        {tr(choice === "fluxx" ? "importWizard.readsUpToFluxx" : "importWizard.readsUpTo", { count: sources.status === "ready" ? sources.data.maxRows : 5000 })}
                      </span>
                    </p>
                    {choice === "zengine" &&
                      (forms ? (
                        <Field id="imp-zengine-form" label={tr("importWizard.form")}>
                          <select id="imp-zengine-form" className="sel" value={formId} onChange={(e) => setFormId(e.target.value)}>
                            <option value="">{tr("importWizard.chooseAForm")}</option>
                            {forms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.workspaceName ? `${f.workspaceName} · ${f.name}` : f.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : busy === "forms" ? (
                        <Loading label={tr("importWizard.loadingTheForms")} />
                      ) : null)}
                  </>
                ) : choice === "file" || choice === "system" ? (
                  <>
                    <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                      <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                        <Upload className="ic" aria-hidden="true" />
                        {tr("importWizard.chooseAFile")}
                        <input type="file" accept={choice === "system" && adapterOf(system)?.accepts.includes("json") ? ".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} className="sr" aria-label={tr("importWizard.chooseAFile")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                      </label>
                      {file && <span className="small">{file.name}</span>}
                    </div>
                    <Field id="imp-paste" label={tr("importWizard.orPasteCsvText")} help={tr("importWizard.aHeaderRowFirstThen")}>
                      <textarea id="imp-paste" className="ta mono" style={{ minHeight: "110px", fontSize: "12px" }} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                    </Field>
                  </>
                ) : (
                  <Field id="imp-link" label={choice === "google_sheets" ? tr("importWizard.spreadsheetLink") : tr("importWizard.airtableLink")} help={choice === "google_sheets" ? tr("importWizard.itStartsWithHttpsDocs") : tr("importWizard.itStartsWithHttpsAirtable")}>
                    <input id="imp-link" className="inp" value={link} onChange={(e) => setLink(e.target.value)} />
                  </Field>
                )}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={busy === "read" || (choice === "file" || choice === "system" ? !file && !pasted.trim() : choice === "fluxx" ? false : choice === "zengine" ? !formId : !link.trim())} onClick={() => void pick()}>
                  {busy === "read" ? tr("importWizard.reading") : choice === "file" || choice === "system" ? tr("importWizard.readTheFile") : choice === "fluxx" ? tr("importWizard.readGrantRequests") : choice === "zengine" ? tr("importWizard.readTheForm") : tr("importWizard.readIt")}
                </button>
                {isPuller(choice) && option(choice)?.canConnect && (
                  <button type="button" className="btn btn-ghost" disabled={busy === "disconnect"} onClick={() => void disconnectPuller(choice)}>
                    <Unplug className="ic" aria-hidden="true" />
                    {tr("importWizard.disconnect", { value: APP_LABEL[choice] })}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.back")}
                </button>
              </div>
            </section>
          )}

          {step === "map" && read && source && (
            <section className="card" aria-labelledby="imp-map">
              <div className="card-h">
                <h3 id="imp-map">{tr("importWizard.matchColumnsToFields")}</h3>
                <span className="small muted">
                  {tr("importWizard.sourceRows", { label: read.source.label, count: read.rows })}
                </span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <Dropped dropped={read.dropped} />
                {read.adapter && (
                  <Notice tone="ok" title={tr("importWizard.matchedAsAExport", { system: read.adapter.system })}>
                    {tr("importWizard.applicationsMarksAsNeverAwarded", { system: read.adapter.system })}
                    {adapterOf(read.adapter.key)?.headersConfirmed === false ? ` ${tr("importWizard.columnNamesDifferBetweenAccounts2")}` : ""}
                  </Notice>
                )}
                {read.detected && read.detected.key !== read.adapter?.key && (
                  <Notice tone="info" title={tr("importWizard.thisFileLooksLikeA", { system: read.detected.system })}>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy === "read"} onClick={() => void readSource(source, read.detected!.key)}>
                      {tr("importWizard.useSMatching", { system: read.detected.system })}
                    </button>
                  </Notice>
                )}
                {typeof read.source.nextPage === "number" && (
                  <p className="small muted" style={{ margin: 0 }}>
                    {tr("importWizard.holdsMoreRecordsThanOne", { value: APP_LABEL[read.source.kind as ImportPuller] ?? tr("importWizard.theSource") })}
                  </p>
                )}
                {read.source.sheets && read.source.sheets.length > 1 && (
                  <Field id="imp-sheet" label={tr("importWizard.sheet")}>
                    <select id="imp-sheet" className="sel" value={read.source.sheet ?? ""} onChange={(e) => void readSource({ ...(source as Extract<ImportSourceInput, { kind: "xlsx" | "google_sheets" }>), sheet: e.target.value })}>
                      {read.source.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {read.source.tables && read.source.tables.length > 1 && (
                  <Field id="imp-table" label={tr("importWizard.table")}>
                    <select id="imp-table" className="sel" value={read.source.table ?? ""} onChange={(e) => void readSource({ ...(source as Extract<ImportSourceInput, { kind: "airtable" }>), table: e.target.value })}>
                      {read.source.tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {read.savedMapping && (
                  <p className="small muted" style={{ margin: 0 }}>
                    {read.savedMapping === "this_source" ? tr("importWizard.matchedAsYouSavedIt") : tr("importWizard.matchedAsYouSavedIt2")}
                  </p>
                )}
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="lbl">{tr("importWizard.whichColumnFillsEachField")}</legend>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px", marginTop: "6px" }}>
                    {read.fields.map((f) => {
                      const col = columns.find((c) => c.name === mapping[f.key]);
                      return (
                        <Field key={f.key} id={`imp-map-${f.key}`} label={f.label} required={f.required} help={col?.samples.length ? tr("importWizard.forExample", { join: col.samples.join(", ") }) : (f.help ?? undefined)}>
                          <select id={`imp-map-${f.key}`} className="sel" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== f.key)), ...(e.target.value ? { [f.key]: e.target.value } : {}) }))}>
                            <option value="">{tr("importWizard.notInTheFile")}</option>
                            {columns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="cb">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>{tr("importWizard.rememberThisMatchingForThe")}</span>
                </label>
                {missing.length > 0 && <p className="small muted">{tr("importWizard.chooseAColumnFor", { join: missing.map((f) => f.label).join(", ") })}</p>}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={missing.length > 0 || busy === "check"} onClick={() => void check()}>
                  {busy === "check" ? tr("importWizard.checking") : tr("importWizard.checkTheRows")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("pick")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.back")}
                </button>
              </div>
            </section>
          )}

          {step === "check" && preview && reconciliation && (
            <section className="card" aria-labelledby="imp-check">
              <div className="card-h">
                <h3 id="imp-check">{tr("importWizard.checkBeforeImporting")}</h3>
                <span className="small muted">{tr("importWizard.nothingHasBeenImportedYet")}</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px" }} role="group" aria-label={tr("importWizard.whatWillHappen")}>
                  <div className="stat">
                    <span className="stat-l">{tr("importWizard.toImport")}</span>
                    <span className="stat-v">{reconciliation.create}</span>
                    <span className="stat-d">
                      <CircleCheck className="ic ic-sm" aria-hidden="true" />
                      {tr("importWizard.newKind", { kind: noun.one, count: reconciliation.create })}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-l">{tr("importWizard.skipped")}</span>
                    <span className="stat-v">{reconciliation.skip}</span>
                    <span className="stat-d">
                      <CircleSlash className="ic ic-sm" aria-hidden="true" />
                      {tr("importWizard.importedBeforeOrRepeated")}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-l">{tr("importWizard.needAFix")}</span>
                    <span className="stat-v">{reconciliation.error}</span>
                    <span className="stat-d">
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      {tr("importWizard.leftOutFixThemIn")}
                    </span>
                  </div>
                </div>
                <Totals totals={reconciliation.totals} />
                <Dropped dropped={preview.run.dropped} />
                <RowsTable rows={preview.rows} subtitle={target === "history_reviews" ? tr("importWizard.target.reviewer") : funder ? tr("importWizard.organization") : tr("importWizard.funder")} />
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={reconciliation.create === 0} onClick={() => void importAll()}>
                  {tr("importWizard.importCount", { kind: noun.one, count: reconciliation.create })}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("map")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  {tr("importWizard.backToMatching")}
                </button>
              </div>
            </section>
          )}

          {step === "import" && preview && (
            <section className="card" aria-labelledby="imp-run">
              <div className="card-h">
                <h3 id="imp-run">{tr("importWizard.importing")}</h3>
              </div>
              <div className="card-b">
                {(() => {
                  const p = progress?.run.progress ?? { written: 0, toWrite: preview.run.reconciliation.create };
                  const total = p.written + p.toWrite;
                  return (
                    <div className="mtr">
                      <div className="lbls">
                        <span role="status">
                          {tr.rich("importWizard.importedOf", { written: p.written, total, b: (chunks) => <b>{chunks}</b>, b2: (chunks) => <b>{chunks}</b> })}
                        </span>
                      </div>
                      <div className="track" role="progressbar" aria-label={tr("importWizard.importProgress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={p.written}>
                        <div className="fill" style={{ width: `${total ? (p.written / total) * 100 : 100}%` }}></div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {error ? (
                <div className="card-f">
                  <button type="button" className="btn btn-primary" onClick={() => void importAll()}>
                    {tr("importWizard.continueTheImport")}
                  </button>
                </div>
              ) : null}
            </section>
          )}

          {step === "done" && (
            <section className="card" aria-labelledby="imp-done">
              <div className="card-h">
                <h3 id="imp-done">{tr("importWizard.importFinished")}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(() => {
                  const p = detail?.run.progress ?? progress?.run.progress;
                  return (
                    <Notice tone="ok" title={tr("importWizard.importedCount", { kind: noun.one, count: p?.written ?? 0 })}>
                      {p && (p.skipped || p.failed) ? tr("importWizard.skippedLeftOutWithA", { skipped: p.skipped, failed: p.failed }) : tr("importWizard.everyRowToImportWas")}
                    </Notice>
                  );
                })()}
                {!funder && created.length > 0 && (
                  <ul aria-label={tr("importWizard.importedApplications")} style={{ margin: 0, paddingLeft: "18px" }}>
                    {created.slice(0, 20).map((r) => (
                      <li key={r.line}>
                        <Link to={`${base}/outside/${r.entity!.id}`}>{r.title}</Link>
                        {r.subtitle ? <span className="muted"> · {r.subtitle}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {funder && <p className="small muted">{past ? tr("importWizard.target.doneNote") : tr("importWizard.importedAwardsAreMarkedAs")}</p>}
                {preview?.run.nextPage ? (
                  <Notice tone="info" title={APP_LABEL[preview.run.source as ImportPuller] ? tr("importWizard.thereIsMoreToImport", { system: APP_LABEL[preview.run.source as ImportPuller] }) : tr("importWizard.thereIsMoreToImportSource")}>
                    <span>{tr("importWizard.thisImportReadOnePart")} </span>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy === "read"} onClick={() => void continueNext()}>
                      {tr("importWizard.continueWithTheNextRecords")}
                    </button>
                  </Notice>
                ) : isPuller(preview?.run.source as Choice) ? (
                  <Notice tone="ok" title={tr("importWizard.yourCredentialsWereDeleted", { value: APP_LABEL[preview!.run.source as ImportPuller] })}>
                    {tr("importWizard.theImportReadEverythingSo")}
                  </Notice>
                ) : null}
              </div>
              <div className="card-f">
                <Link to={noun.to} className="btn btn-primary">
                  {tr("importWizard.openKind", { kind: noun.one })}
                </Link>
                <button type="button" className="btn btn-ghost" onClick={restart}>
                  {tr("importWizard.importAnother")}
                </button>
              </div>
            </section>
          )}
          {step === "done" && funder && target !== "history_reviews" && preview && adapterOf(preview.run.adapter?.key)?.attachments && (detail?.run.progress?.written ?? 0) > 0 && <ZipFiles runId={preview.run.id} adapter={adapterOf(preview.run.adapter!.key)!} history={past} />}
        </main>
      </Shell>
    </>
  );
}
export default ImportWizard;
