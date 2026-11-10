// SPDX-License-Identifier: AGPL-3.0-only
// Form builder: palette → canvas → properties. The draft is edited as sections of fields
// (lib/form-model.ts) and saved as JSON Schema + UI Schema + CommonGrants mappings through
// `/gms/forms`. A published version never changes; editing it starts the next draft.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowDown, ArrowUp, BadgeCheck, Clock, Eye, Info, Plus, Search, Trash2, Zap } from "lucide-react";
import { PREFILL_PATHS, type FormDefinition, type JsonObject } from "@gms/forms";
import { ApiError } from "../../api/client.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { FormPatch, FormPurpose, FormRecord } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, Loading, PageHeader, problemsOf, SaveNote } from "../../components/ui.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { formatDate } from "../../lib/format.ts";
import {
  addField,
  addSection,
  canMove,
  CG_TARGETS,
  compileForm,
  conditionSources,
  countForm,
  describeCondition,
  FIELD_KINDS,
  kindLabel,
  localProblems,
  moveField,
  newField,
  parseForm,
  removeField,
  removeSection,
  renameSection,
  updateField,
  type FieldModel,
  type FormModel,
} from "../../lib/form-model.ts";

const PURPOSES: { value: FormPurpose; label: string }[] = [
  { value: "application", label: "Application" },
  { value: "loi", label: "Letter of intent" },
  { value: "report", label: "Report" },
  { value: "amendment", label: "Amendment" },
  { value: "site_visit", label: "Site visit" },
  { value: "other", label: "Other" },
];

function Toggle({ id, label, checked, onChange, help }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div>
        <span className="lbl" id={`${id}-label`}>
          {label}
        </span>
        {help && <div className="help">{help}</div>}
      </div>
      <button type="button" className={checked ? "tog on" : "tog"} id={id} role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} onClick={() => onChange(!checked)}></button>
    </div>
  );
}

/** "Prefill from Passport": pick the Passport record field this form field is filled from. */
export function PrefillPicker({ value, inUse, onChange }: { value: string | null; inUse: Set<string>; onChange: (path: string | null) => void }) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const shown = PREFILL_PATHS.filter((p) => `${p.label} ${p.path}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const current = PREFILL_PATHS.find((p) => p.path === value);
  return (
    <div className="fld">
      <span className="lbl" id="p-prefill-label">
        Prefill from Passport
      </span>
      <div className="row" style={{ gap: "6px" }}>
        <button type="button" className="inp" style={{ textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} aria-expanded={open} aria-controls="p-prefill-list" aria-labelledby="p-prefill-label" onClick={() => setOpen((o) => !o)}>
          {current ? <span>{current.label}</span> : <span className="muted">Choose a Passport field…</span>}
        </button>
        {value && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div id="p-prefill-list" style={{ border: "1px solid #D6DEDE", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
          <div className="inp-icon" style={{ padding: "8px", borderBottom: "1px solid #EEF3F3" }}>
            <Search className="ic" aria-hidden="true" style={{ left: "18px" }} />
            <input className="inp" style={{ height: "32px", fontSize: "13px" }} aria-label="Filter Passport fields" placeholder="Filter fields" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul style={{ display: "flex", flexDirection: "column", maxHeight: "260px", overflowY: "auto", fontSize: "13px" }} aria-label="Passport fields">
            {shown.map((p) => (
              <li key={p.path} style={{ borderBottom: "1px solid #EEF3F3" }}>
                <button
                  type="button"
                  aria-pressed={p.path === value}
                  onClick={() => {
                    onChange(p.path);
                    setOpen(false);
                  }}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "10px", padding: "8px 12px", width: "100%", border: 0, background: p.path === value ? "#E1F8F6" : "#fff", textAlign: "left", cursor: "pointer", font: "inherit" }}
                >
                  <span>
                    <span className="b" style={{ color: "#0D2A43", display: "block" }}>
                      {p.label}
                    </span>
                    <span className="mono muted">{p.path}</span>
                  </span>
                  {inUse.has(p.path) && p.path !== value && <span className="tag">in use</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="muted" style={{ padding: "10px 12px" }}>No Passport field matches.</li>}
          </ul>
        </div>
      )}
      <span className="help">The value arrives from the organization's Passport record, marked “From Passport”. Applicants do not retype it.</span>
    </div>
  );
}

function ListEditor({ id, label, values, onChange }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field id={id} label={label} help="One per line.">
      <textarea className="ta" id={id} style={{ minHeight: "72px" }} value={values.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
    </Field>
  );
}

function Properties({ model, field, readOnly, onChange }: { model: FormModel; field: FieldModel; readOnly: boolean; onChange: (change: Partial<FieldModel>) => void }) {
  const sources = conditionSources(model, field.key);
  const source = sources.find((s) => s.key === field.showWhen?.field);
  const inUse = new Set(model.sections.flatMap((s) => s.fields.map((f) => f.prefill)).filter((p): p is string => !!p));
  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: "16px", margin: 0, display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
      <legend className="sr">Properties of {field.label}</legend>
      <Field id="p-label" label="Label">
        <input className="inp" id="p-label" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field id="p-help" label="Help text">
        <textarea className="ta" id="p-help" style={{ minHeight: "56px" }} value={field.help} onChange={(e) => onChange({ help: e.target.value })} />
      </Field>
      <Toggle id="p-req" label="Required" checked={field.required} onChange={(required) => onChange({ required })} />
      {field.kind === "longText" && (
        <Field id="p-limit" label="Word limit" help="Leave empty for no limit.">
          <input className="inp" id="p-limit" inputMode="numeric" value={field.wordMax ?? ""} onChange={(e) => onChange({ wordMax: Number(e.target.value.replace(/[^\d]/g, "")) || null })} />
        </Field>
      )}
      {(field.kind === "select" || field.kind === "multiSelect") && <ListEditor id="p-choices" label="Choices" values={field.choices} onChange={(choices) => onChange({ choices })} />}
      {field.kind === "budgetTable" && <ListEditor id="p-categories" label="Budget categories" values={field.categories} onChange={(categories) => onChange({ categories })} />}
      <Toggle id="p-rev" label="Reviewers can see this field" checked={field.reviewerVisible} onChange={(reviewerVisible) => onChange({ reviewerVisible })} />
      <Toggle id="p-pii" label="Contains PII" help="Masked for external reviewers and in exports" checked={field.pii} onChange={(pii) => onChange({ pii })} />

      <div className="fld">
        <label className="lbl" htmlFor="p-when-field">
          Show only when
        </label>
        <select
          className="sel"
          id="p-when-field"
          value={field.showWhen?.field ?? ""}
          onChange={(e) => {
            const s = sources.find((x) => x.key === e.target.value);
            onChange({ showWhen: s ? { field: s.key, equals: s.kind === "boolean" ? true : (s.choices[0] ?? "") } : null });
          }}
        >
          <option value="">Always shown</option>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {source && field.showWhen && (
          <>
            <label className="sr" htmlFor="p-when-value">
              equals
            </label>
            <select
              className="sel"
              id="p-when-value"
              value={String(field.showWhen.equals)}
              onChange={(e) => onChange({ showWhen: { field: source.key, equals: source.kind === "boolean" ? e.target.value === "true" : e.target.value } })}
            >
              {source.kind === "boolean" ? (
                <>
                  <option value="true">is Yes</option>
                  <option value="false">is No</option>
                </>
              ) : (
                source.choices.map((c) => (
                  <option key={c} value={c}>
                    is {c}
                  </option>
                ))
              )}
            </select>
          </>
        )}
        <span className="help">{sources.length ? "Depends on a select or yes/no question earlier in the form. A hidden field is never required." : "Add a select or yes/no question above this field to make it conditional."}</span>
      </div>

      <Field id="p-cg" label="Maps to CommonGrants" help="Supplies this application property at submit.">
        <select className="sel" id="p-cg" value={field.mapsTo ?? ""} onChange={(e) => onChange({ mapsTo: e.target.value || null })}>
          <option value="">None</option>
          {CG_TARGETS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <PrefillPicker value={field.prefill} inUse={inUse} onChange={(prefill) => onChange({ prefill })} />
    </fieldset>
  );
}

function FieldCard({ model, field, selected, problem, readOnly, onSelect, onMove, onRemove }: { model: FormModel; field: FieldModel; selected: boolean; problem: string | undefined; readOnly: boolean; onSelect: () => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const prefill = PREFILL_PATHS.find((p) => p.path === field.prefill);
  return (
    <li className={selected ? "fld-c sel" : "fld-c"} aria-current={selected ? "true" : undefined}>
      <div className="grow">
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <button type="button" className="b" onClick={onSelect} aria-pressed={selected} style={{ color: "#0D2A43", border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
            {field.label || "Untitled field"}
          </button>
          {field.required && (
            <span className="req" title="Required">
              *<span className="sr">required</span>
            </span>
          )}
          {field.prefill && (
            <span className="prov prov-passport">
              <BadgeCheck className="ic" aria-hidden="true" />
              From Passport · {prefill?.label ?? field.prefill}
            </span>
          )}
          {field.mapsTo && (
            <span className="tag" style={{ background: "var(--og-blue-light)", color: "var(--s-info-fg)" }}>
              maps to CommonGrants · {field.mapsTo}
            </span>
          )}
          {field.wordMax && <span className="tag">{field.wordMax} words</span>}
          {!field.reviewerVisible && <span className="tag">Hidden from reviewers</span>}
          {field.pii && <span className="tag">PII</span>}
        </div>
        {field.help && (
          <div className="small muted" style={{ marginTop: "2px" }}>
            {field.help}
          </div>
        )}
        {field.showWhen && (
          <div className="row small" style={{ gap: "6px", marginTop: "6px", color: "#4A5C5A" }}>
            <Eye className="ic ic-sm" aria-hidden="true" />
            Shown when <span className="b">{describeCondition(model, field.showWhen)}</span>
          </div>
        )}
        {problem && (
          <span className="err-msg" role="alert" style={{ marginTop: "6px" }}>
            {problem}
          </span>
        )}
      </div>
      <span className="tag">{kindLabel(field.kind)}</span>
      {!readOnly && (
        <span className="row" style={{ gap: "2px" }}>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={`Move ${field.label} up`} disabled={!canMove(model, field.key, -1)} onClick={() => onMove(-1)}>
            <ArrowUp className="ic" aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={`Move ${field.label} down`} disabled={!canMove(model, field.key, 1)} onClick={() => onMove(1)}>
            <ArrowDown className="ic" aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={`Remove ${field.label}`} onClick={onRemove}>
            <Trash2 className="ic" aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  );
}

function VersionsDialog({ form, onClose }: { form: FormRecord; onClose: () => void }) {
  const versions = useApiQuery((api) => Promise.all(Array.from({ length: form.version }, (_, i) => api.getForm(form.id, form.version - i))), [form.id, form.version]);
  return (
    <Dialog open onClose={onClose} labelledBy="versions-title">
      <div className="hd">
        <h2 id="versions-title" style={{ fontSize: "16px" }}>
          Version history
        </h2>
      </div>
      <div className="bd">
        {versions.status === "loading" && <Loading label="Loading versions" />}
        {versions.status === "error" && <ErrorBanner error={versions.error} onRetry={versions.reload} />}
        {versions.status === "ready" && (
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {versions.data.map((v) => (
              <li key={v.version} className="row" style={{ justifyContent: "space-between" }}>
                <span className="b">Version {v.version}</span>
                <span className="row" style={{ gap: "8px" }}>
                  <span className="muted small">{v.publishedAt ? `Published ${formatDate(v.publishedAt)}` : `Edited ${formatDate(v.updatedAt)}`}</span>
                  <StatusBadge kind="form" status={v.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function Builder({ initial, onSaved }: { initial: FormRecord; onSaved: (f: FormRecord) => void }) {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [form, setForm] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [purpose, setPurpose] = useState<FormPurpose>(initial.purpose);
  const [model, setModel] = useState<FormModel>(() => parseForm(initial));
  const [selected, setSelected] = useState<string | null>(() => parseForm(initial).sections[0]?.fields[0]?.key ?? null);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"build" | "preview">("build");
  const [response, setResponse] = useState<JsonObject>({});
  const [showVersions, setShowVersions] = useState(false);
  const [seq, setSeq] = useState(1);

  const readOnly = form.status === "published";
  const problems = useMemo(() => localProblems(model), [model]);
  const counts = countForm(model);
  const parts = useMemo(() => compileForm(model), [model]);
  const definition = useMemo<FormDefinition>(() => ({ id: form.id, version: form.version, title, ...parts }), [form.id, form.version, title, parts]);
  const field = model.sections.flatMap((s) => s.fields).find((f) => f.key === selected) ?? null;

  const edit = (next: FormModel) => {
    setModel(next);
    setDirty(true);
  };

  const save = useApiMutation((api, patch: FormPatch) => api.updateForm(form.id, patch));
  const publish = useApiMutation((api) => api.publishForm(form.id));
  const nextVersion = useApiMutation((api) => api.createFormVersion(form.id));
  const fill = useApiMutation((api) => api.testFillForm(form.id, { version: form.version }));

  const accept = (saved: FormRecord) => {
    setForm(saved);
    setDirty(false);
    onSaved(saved);
  };
  async function saveDraft(): Promise<boolean> {
    if (Object.keys(problems).length) return false;
    const saved = await save.run({ title: title.trim() || "Untitled form", purpose, ...parts });
    if (saved) accept(saved);
    return !!saved;
  }
  async function publishNow() {
    if (dirty && !(await saveDraft())) return;
    const live = await publish.run();
    if (live) accept(live);
  }
  async function startNext() {
    const draft = await nextVersion.run();
    if (draft) {
      accept(draft);
      setModel(parseForm(draft));
    }
  }
  async function testFill() {
    if (dirty && !(await saveDraft())) return;
    const filled = await fill.run();
    if (filled) {
      setResponse(filled.response);
      setView("preview");
    }
  }

  const writeError = save.error ?? publish.error ?? nextVersion.error ?? fill.error;
  // The server names definition problems by JSON path; show each on its field where it can be matched.
  const serverByField = Object.fromEntries(
    problemsOf(save.error ?? publish.error).flatMap((p) => {
      const key = /properties[./]([A-Za-z0-9_]+)/.exec(p.path ?? "")?.[1];
      return key ? [[key, p.message]] : [];
    }),
  );
  const blocked = Object.keys(problems).length > 0;

  return (
    <main className="main" style={{ gap: "16px" }}>
      <PageHeader
        crumbs={[{ label: ws.name, to: base }, { label: "Forms", to: `${base}/forms` }, { label: `${title || "Untitled form"} v${form.version}` }]}
        title={`${title || "Untitled form"} · v${form.version}`}
        badge={<StatusBadge kind="form" status={form.status} />}
        meta={
          <>
            <span>
              {counts.sections} section{counts.sections === 1 ? "" : "s"} · {counts.fields} field{counts.fields === 1 ? "" : "s"} · {counts.prefills} Passport prefill{counts.prefills === 1 ? "" : "s"}
              {counts.conditionals ? ` · ${counts.conditionals} conditional` : ""}
            </span>
            {dirty ? (
              <span className="pill-warn">
                <Clock className="ic ic-sm" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              <SaveNote state={save.state} />
            )}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={testFill} disabled={fill.state === "saving" || blocked}>
              <Zap className="ic" aria-hidden="true" />
              Test-fill
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowVersions(true)}>
              <Clock className="ic" aria-hidden="true" />
              Version history
            </button>
            {readOnly ? (
              // A shared library form is copied from the Forms list, never versioned in place.
              !form.shared && (
                <button type="button" className="btn btn-primary" onClick={startNext} disabled={nextVersion.state === "saving"}>
                  Create v{form.version + 1} to edit
                </button>
              )
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={save.state === "saving" || blocked}>
                  Save draft
                </button>
                <button type="button" className="btn btn-primary" onClick={publishNow} disabled={publish.state === "saving" || blocked || counts.fields === 0}>
                  Publish v{form.version}
                </button>
              </>
            )}
          </>
        }
      />

      {writeError !== null && (
        <ErrorBanner error={writeError} title={writeError instanceof ApiError && writeError.status === 422 ? "This form definition is not valid" : "That did not work"} />
      )}
      {readOnly ? (
        <div className="bnr bnr-neu" role="status">
          <Info className="ic" aria-hidden="true" />
          <div className="grow">
            <div className="t">Version {form.version} is published and cannot change</div>
            <div className="d">Competitions pin a published version, so applicants never see a form change under them. Create version {form.version + 1} to edit; it stays a draft until you publish it.</div>
          </div>
        </div>
      ) : (
        form.version > 1 && (
          <div className="bnr bnr-info" role="status">
            <Info className="ic" aria-hidden="true" />
            <div className="grow">
              <div className="t">You are editing a draft of v{form.version}</div>
              <div className="d">
                v{form.supersedesFormVersion ?? form.version - 1} stays pinned wherever it is used until you publish and re-pin. Publishing does not change forms already submitted.
              </div>
            </div>
          </div>
        )
      )}

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
        <aside className="card" style={{ padding: "14px 12px" }} aria-labelledby="palette-title">
          <div className="eyebrow" id="palette-title" style={{ padding: "0 4px 10px" }}>
            Field palette
          </div>
          <ul className="pal" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {FIELD_KINDS.map(({ kind, label }) => (
              <li key={kind} style={{ padding: 0, cursor: "default", ...(kind === "passportField" ? { borderColor: "var(--og-teal-light)", background: "var(--og-teal-soft)", color: "var(--og-teal-dark)" } : {}) }}>
                <button
                  type="button"
                  disabled={readOnly || model.sections.length === 0}
                  aria-label={`Add ${label}`}
                  style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", height: "100%", padding: "0 10px", border: 0, background: "transparent", font: "inherit", color: "inherit", cursor: readOnly ? "not-allowed" : "pointer", textAlign: "left" }}
                  onClick={() => {
                    const section = model.sections.find((s) => s.fields.some((f) => f.key === selected)) ?? model.sections[model.sections.length - 1]!;
                    const f = newField(model, kind);
                    edit(addField(model, section.id, f));
                    setSelected(f.key);
                    setView("build");
                  }}
                >
                  {kind === "passportField" ? <BadgeCheck className="ic" aria-hidden="true" /> : <Plus className="ic" aria-hidden="true" />}
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <p className="help" style={{ padding: "10px 4px 0" }}>
            A field is added to the section of the selected field.
          </p>
        </aside>

        <section style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: "0" }} aria-label="Form canvas">
          <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="fld-row">
              <Field id="form-title" label="Form title">
                <input
                  className="inp"
                  id="form-title"
                  value={title}
                  disabled={readOnly}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field id="form-purpose" label="Used for">
                <select
                  className="sel"
                  id="form-purpose"
                  value={purpose}
                  disabled={readOnly}
                  onChange={(e) => {
                    setPurpose(e.target.value as FormPurpose);
                    setDirty(true);
                  }}
                >
                  {PURPOSES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="seg" role="group" aria-label="Canvas view" style={{ alignSelf: "flex-start" }}>
              <button type="button" className={view === "build" ? "on" : ""} aria-pressed={view === "build"} onClick={() => setView("build")}>
                Build
              </button>
              <button type="button" className={view === "preview" ? "on" : ""} aria-pressed={view === "preview"} onClick={() => setView("preview")}>
                <Eye className="ic ic-sm" aria-hidden="true" />
                Preview as applicant
              </button>
            </div>
          </div>

          {view === "preview" && (
            <div className="card gms-applicant" style={{ padding: "20px" }} aria-label="Applicant preview">
              {counts.fields === 0 ? <p className="muted">Add a field to see the preview.</p> : <FormView form={definition} response={response} mode="edit" onChange={setResponse} />}
            </div>
          )}

          {view === "build" && (
            <>
              {model.sections.map((s, i) => (
                <div className="card" key={s.id}>
                  <div className="card-h" style={{ padding: "12px 16px" }}>
                    <div className="row grow" style={{ gap: "10px" }}>
                      <label className="sr" htmlFor={`section-${s.id}`}>
                        Section {i + 1} name
                      </label>
                      <span className="b muted small">Section {i + 1}</span>
                      <input className="inp" id={`section-${s.id}`} style={{ height: "32px", fontWeight: 700, maxWidth: "320px" }} value={s.label} disabled={readOnly} onChange={(e) => edit(renameSection(model, s.id, e.target.value))} />
                    </div>
                    <span className="row" style={{ gap: "8px" }}>
                      <span className="small muted">
                        {s.fields.length} field{s.fields.length === 1 ? "" : "s"}
                      </span>
                      {!readOnly && (
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove section ${i + 1}, ${s.label}`} onClick={() => edit(removeSection(model, s.id))}>
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                  <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px" }} aria-label={`Fields in ${s.label}`}>
                    {s.fields.map((f) => (
                      <FieldCard
                        key={f.key}
                        model={model}
                        field={f}
                        selected={f.key === selected}
                        problem={problems[f.key] ?? serverByField[f.key]}
                        readOnly={readOnly}
                        onSelect={() => setSelected(f.key)}
                        onMove={(d) => edit(moveField(model, f.key, d))}
                        onRemove={() => {
                          edit(removeField(model, f.key));
                          if (selected === f.key) setSelected(null);
                        }}
                      />
                    ))}
                    {s.fields.length === 0 && <li className="muted small">No fields yet. Pick one from the palette.</li>}
                  </ul>
                </div>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    edit(addSection(model, `new${seq}`));
                    setSeq((n) => n + 1);
                  }}
                >
                  <Plus className="ic" aria-hidden="true" />
                  Add section
                </button>
              )}
            </>
          )}
        </section>

        <aside className="card" style={{ minWidth: "0" }} aria-labelledby="props-title">
          <div className="card-h" style={{ padding: "12px 16px" }}>
            <h3 id="props-title" style={{ fontSize: "14px" }}>
              {field ? `Field properties · ${field.label || "Untitled field"}` : "Field properties"}
            </h3>
            {field && <span className="tag">{kindLabel(field.kind)}</span>}
          </div>
          {field ? (
            <Properties key={field.key} model={model} field={field} readOnly={readOnly} onChange={(change) => edit(updateField(model, field.key, change))} />
          ) : (
            <p className="muted" style={{ padding: "16px" }}>
              Select a field on the canvas to edit its label, help text, conditions and Passport prefill.
            </p>
          )}
        </aside>
      </div>

      {showVersions && <VersionsDialog form={form} onClose={() => setShowVersions(false)} />}
      <p className="small muted">
        Pin a published version to a stage from the <Link to={`${base}/opportunities`}>competition</Link> of an opportunity.
      </p>
    </main>
  );
}

export default function FormBuilder() {
  const ws = useWorkspace("funder");
  const { formId = "" } = useParams();
  const data = useApiQuery((api) => api.getForm(formId), [ws.id, formId]);
  const missing = data.status === "error" && data.error instanceof ApiError && data.error.status === 404;
  if (missing) return <NotFound />;

  return (
    <FunderShell active="Opportunities">
      <title>{`${data.status === "ready" ? data.data.title : "Form"} — Form builder`}</title>
      {data.status === "loading" && (
        <main className="main">
          <Loading label="Loading the form" />
        </main>
      )}
      {data.status === "error" && (
        <main className="main">
          <ErrorBanner error={data.error} onRetry={data.reload} title="The form could not be loaded" />
        </main>
      )}
      {data.status === "ready" && <Builder key={`${data.data.id}`} initial={data.data} onSaved={() => undefined} />}
    </FunderShell>
  );
}
