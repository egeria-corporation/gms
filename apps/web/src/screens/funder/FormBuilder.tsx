// SPDX-License-Identifier: AGPL-3.0-only
// Form builder: palette → canvas → properties. The draft is edited as sections of fields
// (lib/form-model.ts) and saved as JSON Schema + UI Schema + CommonGrants mappings through
// `/gms/forms`. A published version never changes; editing it starts the next draft.
// "Add Spanish" puts the funder's own text side by side with its translation (Translate view),
// with a completeness indicator and an optional assistant draft that must be reviewed before the
// version is published (docs/forms.md, "Languages").
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowDown, ArrowUp, BadgeCheck, Clock, Eye, Info, Plus, Search, Trash2, Zap } from "lucide-react";
import { PREFILL_PATHS, type FormDefinition, type FormLanguage, type JsonObject } from "@gms/forms";
import { ApiError } from "../../api/client.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useTranslationsApi } from "../../api/translationsHooks.ts";
import type { FormPatch, FormPurpose, FormRecord } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, Loading, PageHeader, problemsOf, SaveNote } from "../../components/ui.tsx";
import { ShareToGalleryButton } from "./ShareToGallery.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { formatDate } from "../../lib/format.ts";
import {
  addField,
  addLanguage,
  addSection,
  applyDrafts,
  canMove,
  CG_TARGETS,
  compileForm,
  compileTranslations,
  confirmRow,
  conditionSources,
  countForm,
  FIELD_KINDS,
  localProblems,
  moveField,
  newField,
  parseForm,
  parseTranslations,
  removeField,
  removeLanguage,
  removeSection,
  renameSection,
  setSourceLanguage,
  translationRows,
  updateField,
  writeTranslation,
  type FieldModel,
  type FormModel,
  type TranslationModel,
} from "../../lib/form-model.ts";
import { PURPOSE_LABEL } from "./shared.tsx";
import { conditionText, fieldKindLabel, prefillLabel } from "./formWords.ts";
import { t, useFunderMessages } from "./i18n.ts";
import { LanguagePicker, RowsHead, TranslateAssist, TranslationRow } from "./TranslationParts.tsx";

const PURPOSES = (Object.keys(PURPOSE_LABEL) as FormPurpose[]).map((value) => ({ value, get label() { return PURPOSE_LABEL[value](); } }));

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
  const shown = PREFILL_PATHS.filter((p) => `${prefillLabel(p)} ${p.path}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const current = PREFILL_PATHS.find((p) => p.path === value);
  return (
    <div className="fld">
      <span className="lbl" id="p-prefill-label">
        {t("formBuilder.prefillFromPassport")}
      </span>
      <div className="row" style={{ gap: "6px" }}>
        <button type="button" className="inp" style={{ textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} aria-expanded={open} aria-controls="p-prefill-list" id="p-prefill-button" aria-labelledby="p-prefill-label p-prefill-button" onClick={() => setOpen((o) => !o)}>
          {current ? <span>{prefillLabel(current)}</span> : <span className="muted">{t("formBuilder.chooseAPassportField")}</span>}
        </button>
        {value && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            {t("formBuilder.clear")}
          </button>
        )}
      </div>
      {open && (
        <div id="p-prefill-list" style={{ border: "1px solid #D6DEDE", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
          <div className="inp-icon" style={{ padding: "8px", borderBottom: "1px solid #EEF3F3" }}>
            <Search className="ic" aria-hidden="true" style={{ left: "18px" }} />
            <input className="inp" style={{ height: "32px", fontSize: "13px" }} aria-label={t("formBuilder.filterPassportFields")} placeholder={t("formBuilder.filterFields")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul style={{ display: "flex", flexDirection: "column", maxHeight: "260px", overflowY: "auto", fontSize: "13px" }} aria-label={t("formBuilder.passportFields")}>
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
                      {prefillLabel(p)}
                    </span>
                    <span className="mono muted">{p.path}</span>
                  </span>
                  {inUse.has(p.path) && p.path !== value && <span className="tag">{t("formBuilder.inUse")}</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="muted" style={{ padding: "10px 12px" }}>{t("formBuilder.noPassportFieldMatches")}</li>}
          </ul>
        </div>
      )}
      <span className="help">{t("formBuilder.theValueArrivesFrom")}</span>
    </div>
  );
}

function ListEditor({ id, label, values, onChange }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field id={id} label={label} help={t("formBuilder.onePerLine")}>
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
      <legend className="sr">{t("formBuilder.propertiesOf", { label: field.label })}</legend>
      <Field id="p-label" label={t("formBuilder.label")}>
        <input className="inp" id="p-label" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field id="p-help" label={t("formBuilder.helpText")}>
        <textarea className="ta" id="p-help" style={{ minHeight: "56px" }} value={field.help} onChange={(e) => onChange({ help: e.target.value })} />
      </Field>
      <Toggle id="p-req" label={t("formBuilder.required")} checked={field.required} onChange={(required) => onChange({ required })} />
      {field.kind === "longText" && (
        <Field id="p-limit" label={t("formBuilder.wordLimit")} help={t("formBuilder.leaveEmptyForNo")}>
          <input className="inp" id="p-limit" inputMode="numeric" value={field.wordMax ?? ""} onChange={(e) => onChange({ wordMax: Number(e.target.value.replace(/[^\d]/g, "")) || null })} />
        </Field>
      )}
      {(field.kind === "select" || field.kind === "multiSelect") && <ListEditor id="p-choices" label={t("formBuilder.choices")} values={field.choices} onChange={(choices) => onChange({ choices })} />}
      {field.kind === "budgetTable" && <ListEditor id="p-categories" label={t("formBuilder.budgetCategories")} values={field.categories} onChange={(categories) => onChange({ categories })} />}
      <Toggle id="p-rev" label={t("formBuilder.reviewersCanSeeThis")} checked={field.reviewerVisible} onChange={(reviewerVisible) => onChange({ reviewerVisible })} />
      <Toggle id="p-pii" label={t("formBuilder.containsPii")} help={t("formBuilder.maskedForExternalReviewers")} checked={field.pii} onChange={(pii) => onChange({ pii })} />
      <Toggle id="p-identifying" label={t("formBuilder.saysWhoApplied")} help={t("formBuilder.hiddenFromReviewersIn")} checked={field.identifying} onChange={(identifying) => onChange({ identifying })} />

      <div className="fld">
        <label className="lbl" htmlFor="p-when-field">
          {t("formBuilder.showOnlyWhen")}
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
          <option value="">{t("formBuilder.alwaysShown")}</option>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {source && field.showWhen && (
          <>
            <label className="sr" htmlFor="p-when-value">
              {t("formBuilder.equals")}
            </label>
            <select
              className="sel"
              id="p-when-value"
              value={String(field.showWhen.equals)}
              onChange={(e) => onChange({ showWhen: { field: source.key, equals: source.kind === "boolean" ? e.target.value === "true" : e.target.value } })}
            >
              {source.kind === "boolean" ? (
                <>
                  <option value="true">{t("formBuilder.isYes")}</option>
                  <option value="false">{t("formBuilder.isNo")}</option>
                </>
              ) : (
                source.choices.map((c) => (
                  <option key={c} value={c}>
                    {t("formBuilder.is", { c })}
                  </option>
                ))
              )}
            </select>
          </>
        )}
        <span className="help">{sources.length ? t("formBuilder.dependsOnASelect") : t("formBuilder.addASelectOr")}</span>
      </div>

      <Field id="p-cg" label={t("formBuilder.mapsToCommongrants")} help={t("formBuilder.suppliesThisApplicationProperty")}>
        <select className="sel" id="p-cg" value={field.mapsTo ?? ""} onChange={(e) => onChange({ mapsTo: e.target.value || null })}>
          <option value="">{t("formBuilder.none")}</option>
          {CG_TARGETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
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
            {field.label || t("formBuilder.untitledField")}
          </button>
          {field.required && (
            <span className="req" title={t("formBuilder.required")}>
              *<span className="sr">{t("formBuilder.required2")}</span>
            </span>
          )}
          {field.prefill && (
            <span className="prov prov-passport">
              <BadgeCheck className="ic" aria-hidden="true" />
              {t("formBuilder.fromPassport", { label: prefill ? prefillLabel(prefill) : field.prefill })}
            </span>
          )}
          {field.mapsTo && (
            <span className="tag" style={{ background: "var(--og-blue-light)", color: "var(--s-info-fg)" }}>
              {t("formBuilder.mapsToCommongrants2", { mapsTo: field.mapsTo })}
            </span>
          )}
          {field.wordMax && <span className="tag">{t("formBuilder.words", { wordMax: field.wordMax })}</span>}
          {!field.reviewerVisible && <span className="tag">{t("formBuilder.hiddenFromReviewers")}</span>}
          {field.pii && <span className="tag">{t("formBuilder.pii")}</span>}
          {field.identifying && <span className="tag">{t("formBuilder.saysWhoApplied")}</span>}
        </div>
        {field.help && (
          <div className="small muted" style={{ marginTop: "2px" }}>
            {field.help}
          </div>
        )}
        {field.showWhen && (
          <div className="row small" style={{ gap: "6px", marginTop: "6px", color: "#4A5C5A" }}>
            <Eye className="ic ic-sm" aria-hidden="true" />
            {t.rich("formBuilder.shownWhen", { condition: conditionText(model, field.showWhen), span: (chunks) => <span className="b">{chunks}</span> })}
          </div>
        )}
        {problem && (
          <span className="err-msg" role="alert" style={{ marginTop: "6px" }}>
            {problem}
          </span>
        )}
      </div>
      <span className="tag">{fieldKindLabel(field.kind)}</span>
      {!readOnly && (
        <span className="row" style={{ gap: "2px" }}>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={t("formBuilder.moveUp", { label: field.label })} disabled={!canMove(model, field.key, -1)} onClick={() => onMove(-1)}>
            <ArrowUp className="ic" aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={t("formBuilder.moveDown", { label: field.label })} disabled={!canMove(model, field.key, 1)} onClick={() => onMove(1)}>
            <ArrowDown className="ic" aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label={t("formBuilder.remove", { label: field.label })} onClick={onRemove}>
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
          {t("formBuilder.versionHistory")}
        </h2>
      </div>
      <div className="bd">
        {versions.status === "loading" && <Loading label={t("formBuilder.loadingVersions")} />}
        {versions.status === "error" && <ErrorBanner error={versions.error} onRetry={versions.reload} />}
        {versions.status === "ready" && (
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {versions.data.map((v) => (
              <li key={v.version} className="row" style={{ justifyContent: "space-between" }}>
                <span className="b">{t("formBuilder.version", { version: v.version })}</span>
                <span className="row" style={{ gap: "8px" }}>
                  <span className="muted small">{v.publishedAt ? t("formBuilder.published", { date: formatDate(v.publishedAt) }) : t("formBuilder.edited", { date: formatDate(v.updatedAt) })}</span>
                  <StatusBadge kind="form" status={v.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("formBuilder.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** The Translate view: every text of the form beside its translation, in reading order. */
function TranslateView({ model, tm, title, language, readOnly, onChange, assist }: { model: FormModel; tm: TranslationModel; title: string; language: FormLanguage; readOnly: boolean; onChange: (next: TranslationModel) => void; assist: ReactNode }) {
  const rows = translationRows(model, tm, title, language);
  return (
    <section className="card" aria-labelledby="translate-title">
      <div className="card-h" style={{ padding: "12px 16px" }}>
        <h3 id="translate-title" style={{ fontSize: "14px" }}>
          {t("formBuilder.translate.heading", { language })}
        </h3>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px 16px" }}>
        <p className="small muted">{t("formBuilder.translate.intro", { language })}</p>
        <p className="small muted">{t("formBuilder.translate.versions")}</p>
        {assist}
        {rows.items.length === 0 ? (
          <p className="muted small">{t("formBuilder.translate.empty")}</p>
        ) : (
          <>
            <RowsHead source={tm.source} language={language} />
            <ul style={{ display: "flex", flexDirection: "column" }} aria-label={t("formBuilder.translate.heading", { language })}>
              {rows.items.map((item) => (
                <TranslationRow
                  key={item.id}
                  kind={item.kind}
                  source={item.source}
                  sourceLanguage={tm.source}
                  language={language}
                  text={item.text}
                  state={item.state}
                  {...(item.was !== undefined ? { was: item.was } : {})}
                  multiline={item.kind === "help"}
                  readOnly={readOnly}
                  onText={(text) => onChange(writeTranslation(model, tm, language, item, text))}
                  onConfirm={() => onChange(confirmRow(model, tm, language, item))}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
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
  const [view, setView] = useState<"build" | "translate" | "preview">("build");
  const [tm, setTm] = useState<TranslationModel>(() => parseTranslations(initial.translations));
  const [previewLanguage, setPreviewLanguage] = useState<FormLanguage | null>(null);
  const [drafted, setDrafted] = useState<number | null>(null);
  const [response, setResponse] = useState<JsonObject>({});
  const [showVersions, setShowVersions] = useState(false);
  const [seq, setSeq] = useState(1);

  const readOnly = form.status === "published";
  const problems = useMemo(() => localProblems(model), [model]);
  const counts = countForm(model);
  const parts = useMemo(() => compileForm(model), [model]);
  const translations = useMemo(() => compileTranslations(model, tm, title), [model, tm, title]);
  const definition = useMemo<FormDefinition>(() => ({ id: form.id, version: form.version, title, ...parts, translations }), [form.id, form.version, title, parts, translations]);
  // One language beside the form's own in this release.
  const added = tm.languages[0] ?? null;
  const progress = useMemo(() => (added ? translationRows(model, tm, title, added) : null), [added, model, tm, title]);
  const assistStatus = useApiQuery((api) => api.assistStatus(), []);
  const assistOn = assistStatus.status === "ready" && assistStatus.data.enabled;
  const field = model.sections.flatMap((s) => s.fields).find((f) => f.key === selected) ?? null;

  const edit = (next: FormModel) => {
    setModel(next);
    setDirty(true);
  };
  const editLanguages = (next: TranslationModel) => {
    setTm(next);
    setDirty(true);
  };

  const save = useApiMutation((api, patch: FormPatch) => api.updateForm(form.id, patch));
  const publish = useApiMutation((api) => api.publishForm(form.id));
  const nextVersion = useApiMutation((api) => api.createFormVersion(form.id));
  const fill = useApiMutation((api) => api.testFillForm(form.id, { version: form.version }));
  const translationsApi = useTranslationsApi();
  const [assistError, setAssistError] = useState<unknown>(null);
  const [assistBusy, setAssistBusy] = useState(false);

  const accept = (saved: FormRecord) => {
    setForm(saved);
    setDirty(false);
    onSaved(saved);
  };
  async function saveDraft(): Promise<boolean> {
    if (Object.keys(problems).length) return false;
    const saved = await save.run({ title: title.trim() || t("formBuilder.untitledForm"), purpose, ...parts, translations: compileTranslations(model, tm, title.trim() || t("formBuilder.untitledForm")) });
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
      setTm(parseTranslations(draft.translations));
    }
  }
  /** Saves first (the server drafts from the saved version), then marks each draft for review. */
  async function draftTranslations() {
    if (!added) return;
    if (dirty && !(await saveDraft())) return;
    setAssistBusy(true);
    setAssistError(null);
    try {
      const result = await translationsApi.draftForm(ws.id, form.id, added);
      const next = applyDrafts(model, tm, title, added, result.items);
      if (next.applied) editLanguages(next.tm);
      setDrafted(next.applied);
      assistStatus.reload();
    } catch (e) {
      setAssistError(e);
    } finally {
      setAssistBusy(false);
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
  const draftsToReview = progress?.drafts ?? 0;

  return (
    <main className="main" style={{ gap: "16px" }}>
      <PageHeader
        crumbs={[{ label: ws.name, to: base }, { label: t("formBuilder.forms"), to: `${base}/forms` }, { label: t("formBuilder.v", { title: title || t("formBuilder.untitledForm"), version: form.version }) }]}
        title={t("formBuilder.v2", { title: title || t("formBuilder.untitledForm"), version: form.version })}
        badge={<StatusBadge kind="form" status={form.status} />}
        meta={
          <>
            <span>
              {t("formBuilder.counts", { sections: counts.sections, fields: counts.fields, prefills: counts.prefills })}
              {counts.conditionals ? ` · ${t("formBuilder.conditionalCount", { count: counts.conditionals })}` : ""}
            </span>
            {dirty ? (
              <span className="pill-warn">
                <Clock className="ic ic-sm" aria-hidden="true" />
                {t("formBuilder.unsavedChanges")}
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
              {t("formBuilder.testFill")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowVersions(true)}>
              <Clock className="ic" aria-hidden="true" />
              {t("formBuilder.versionHistory")}
            </button>
            {!form.shared && <ShareToGalleryButton source={{ type: "form", id: form.id }} name={title || form.title} disabledReason={readOnly || form.version > 1 ? undefined : t("formBuilder.publishBeforeSharing")} />}
            {readOnly ? (
              // A shared library form is copied from the Forms list, never versioned in place.
              !form.shared && (
                <button type="button" className="btn btn-primary" onClick={startNext} disabled={nextVersion.state === "saving"}>
                  {t("formBuilder.createVToEdit", { version: form.version + 1 })}
                </button>
              )
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={save.state === "saving" || blocked}>
                  {t("formBuilder.saveDraft")}
                </button>
                <button type="button" className="btn btn-primary" onClick={publishNow} disabled={publish.state === "saving" || blocked || counts.fields === 0 || draftsToReview > 0} aria-describedby={draftsToReview > 0 ? "publish-drafts-note" : undefined}>
                  {t("formBuilder.publishV", { version: form.version })}
                </button>
              </>
            )}
          </>
        }
      />

      {draftsToReview > 0 && !readOnly && (
        <div className="bnr bnr-warn" role="status" id="publish-drafts-note">
          <Info className="ic" aria-hidden="true" />
          <div className="grow">
            <div className="t">{t("formBuilder.publishBlockedDrafts")}</div>
          </div>
        </div>
      )}
      {writeError !== null && (
        <ErrorBanner error={writeError} title={writeError instanceof ApiError && writeError.status === 422 ? t("formBuilder.thisFormDefinitionIs") : t("formBuilder.thatDidNotWork")} />
      )}
      {readOnly ? (
        <div className="bnr bnr-neu" role="status">
          <Info className="ic" aria-hidden="true" />
          <div className="grow">
            <div className="t">{t("formBuilder.versionIsPublishedAnd", { version: form.version })}</div>
            <div className="d">{t("formBuilder.competitionsPinAPublished", { version: form.version + 1 })}</div>
          </div>
        </div>
      ) : (
        form.version > 1 && (
          <div className="bnr bnr-info" role="status">
            <Info className="ic" aria-hidden="true" />
            <div className="grow">
              <div className="t">{t("formBuilder.youAreEditingA", { version: form.version })}</div>
              <div className="d">
                {t("formBuilder.vStaysPinnedWherever", { supersedesFormVersion: form.supersedesFormVersion ?? form.version - 1 })}
              </div>
            </div>
          </div>
        )
      )}

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
        <aside className="card" style={{ padding: "14px 12px" }} aria-labelledby="palette-title">
          <div className="eyebrow" id="palette-title" style={{ padding: "0 4px 10px" }}>
            {t("formBuilder.fieldPalette")}
          </div>
          <ul className="pal" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {FIELD_KINDS.map(({ kind }) => ({ kind, label: fieldKindLabel(kind) })).map(({ kind, label }) => (
              <li key={kind} style={{ padding: 0, cursor: "default", ...(kind === "passportField" ? { borderColor: "var(--og-teal-light)", background: "var(--og-teal-soft)", color: "var(--og-teal-dark)" } : {}) }}>
                <button
                  type="button"
                  disabled={readOnly || model.sections.length === 0}
                  aria-label={t("formBuilder.add", { label })}
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
            {t("formBuilder.aFieldIsAdded")}
          </p>
        </aside>

        <section style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: "0" }} aria-label={t("formBuilder.formCanvas")}>
          <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="fld-row">
              <Field id="form-title" label={t("formBuilder.formTitle")}>
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
              <Field id="form-purpose" label={t("formBuilder.usedFor")}>
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
            <LanguagePicker
              idPrefix="form"
              source={tm.source}
              added={added}
              progress={progress}
              readOnly={readOnly}
              onSource={(l) => editLanguages(setSourceLanguage(tm, l))}
              onAdd={(l) => {
                editLanguages(addLanguage(tm, l));
                setView("translate");
              }}
              onRemove={(l) => {
                editLanguages(removeLanguage(tm, l));
                if (view === "translate") setView("build");
              }}
            />
            <div className="seg" role="group" aria-label={t("formBuilder.canvasView")} style={{ alignSelf: "flex-start" }}>
              <button type="button" className={view === "build" ? "on" : ""} aria-pressed={view === "build"} onClick={() => setView("build")}>
                {t("formBuilder.build")}
              </button>
              {added && (
                <button type="button" className={view === "translate" ? "on" : ""} aria-pressed={view === "translate"} onClick={() => setView("translate")}>
                  {t("formBuilder.translate")}
                </button>
              )}
              <button type="button" className={view === "preview" ? "on" : ""} aria-pressed={view === "preview"} onClick={() => setView("preview")}>
                <Eye className="ic ic-sm" aria-hidden="true" />
                {t("formBuilder.previewAsApplicant")}
              </button>
            </div>
          </div>

          {view === "preview" && (
            <div className="card gms-applicant" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }} role="region" aria-label={t("formBuilder.applicantPreview")}>
              {added && (
                <div className="row" style={{ gap: "8px" }}>
                  <span className="small muted" id="preview-language-label">
                    {t("formBuilder.previewIn")}
                  </span>
                  <div className="seg" role="group" aria-labelledby="preview-language-label">
                    {[tm.source, added].map((l) => (
                      <button key={l} type="button" className={(previewLanguage ?? tm.source) === l ? "on" : ""} aria-pressed={(previewLanguage ?? tm.source) === l} onClick={() => setPreviewLanguage(l)}>
                        {t("translation.language.name", { language: l })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {counts.fields === 0 ? <p className="muted">{t("formBuilder.addAFieldTo")}</p> : <FormView form={definition} response={response} mode="edit" onChange={setResponse} language={previewLanguage ?? tm.source} previewDrafts />}
            </div>
          )}

          {view === "translate" && added && (
            <TranslateView
              model={model}
              tm={tm}
              title={title}
              language={added}
              readOnly={readOnly}
              onChange={editLanguages}
              assist={
                assistOn && !readOnly ? (
                  <TranslateAssist
                    id="form-translate-assist"
                    help={t("translation.assist.formHelp")}
                    quota={assistStatus.status === "ready" ? assistStatus.data.quota : null}
                    busy={assistBusy}
                    disabled={blocked || !progress || progress.missing + progress.stale === 0}
                    result={drafted}
                    error={assistError !== null ? <ErrorBanner error={assistError} /> : null}
                    onDraft={() => void draftTranslations()}
                  />
                ) : null
              }
            />
          )}

          {view === "build" && (
            <>
              {model.sections.map((s, i) => (
                <div className="card" key={s.id}>
                  <div className="card-h" style={{ padding: "12px 16px" }}>
                    <div className="row grow" style={{ gap: "10px" }}>
                      <label className="sr" htmlFor={`section-${s.id}`}>
                        {t("formBuilder.sectionName", { i: i + 1 })}
                      </label>
                      <span className="b muted small">{t("formBuilder.section", { i: i + 1 })}</span>
                      <input className="inp" id={`section-${s.id}`} style={{ height: "32px", fontWeight: 700, maxWidth: "320px" }} value={s.label} disabled={readOnly} onChange={(e) => edit(renameSection(model, s.id, e.target.value))} />
                    </div>
                    <span className="row" style={{ gap: "8px" }}>
                      <span className="small muted">
                        {t("formBuilder.fieldCount", { count: s.fields.length })}
                      </span>
                      {!readOnly && (
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={t("formBuilder.removeSection", { i: i + 1, label: s.label })} onClick={() => edit(removeSection(model, s.id))}>
                          {t("formBuilder.remove2")}
                        </button>
                      )}
                    </span>
                  </div>
                  <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px" }} aria-label={t("formBuilder.fieldsIn", { label: s.label })}>
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
                    {s.fields.length === 0 && <li className="muted small">{t("formBuilder.noFieldsYetPick")}</li>}
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
                  {t("formBuilder.addSection")}
                </button>
              )}
            </>
          )}
        </section>

        <aside className="card" style={{ minWidth: "0" }} aria-labelledby="props-title">
          <div className="card-h" style={{ padding: "12px 16px" }}>
            <h3 id="props-title" style={{ fontSize: "14px" }}>
              {field ? t("formBuilder.fieldProperties", { label: field.label || t("formBuilder.untitledField") }) : t("formBuilder.fieldProperties2")}
            </h3>
            {field && <span className="tag">{fieldKindLabel(field.kind)}</span>}
          </div>
          {field ? (
            <Properties key={field.key} model={model} field={field} readOnly={readOnly} onChange={(change) => edit(updateField(model, field.key, change))} />
          ) : (
            <p className="muted" style={{ padding: "16px" }}>
              {t("formBuilder.selectAFieldOn")}
            </p>
          )}
        </aside>
      </div>

      {showVersions && <VersionsDialog form={form} onClose={() => setShowVersions(false)} />}
      <p className="small muted">
        {t.rich("formBuilder.pinAPublishedVersion", { link: (chunks) => <Link to={`${base}/opportunities`}>{chunks}</Link> })}
      </p>
    </main>
  );
}

export default function FormBuilder() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const { formId = "" } = useParams();
  const data = useApiQuery((api) => api.getForm(formId), [ws.id, formId]);
  const missing = data.status === "error" && data.error instanceof ApiError && data.error.status === 404;
  if (missing) return <NotFound />;

  return (
    <FunderShell active="Opportunities">
      <title>{t("formBuilder.formBuilder", { title: data.status === "ready" ? data.data.title : t("formBuilder.form") })}</title>
      {data.status === "loading" && (
        <main className="main">
          <Loading label={t("formBuilder.loadingTheForm")} />
        </main>
      )}
      {data.status === "error" && (
        <main className="main">
          <ErrorBanner error={data.error} onRetry={data.reload} title={t("formBuilder.theFormCouldNot")} />
        </main>
      )}
      {data.status === "ready" && <Builder key={`${data.data.id}`} initial={data.data} onSaved={() => undefined} />}
    </FunderShell>
  );
}
