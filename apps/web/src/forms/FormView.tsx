// SPDX-License-Identifier: AGPL-3.0-only
// The one form renderer (build spec §10.2). It draws a CommonGrants FormBase — JSON Schema plus a
// JSON Forms-style UI schema — in four modes:
//   edit      the applicant editor: inputs, inline validation, word counters, provenance chips
//   reviewer  read-only; fields are removed or masked by `maskForReviewer`
//   funder    read-only, with provenance
//   print     read-only, flat, for the PDF snapshot
// All rules, validation and masking come from `@gms/forms`; this file only draws.
//
// The funder's own text (section titles, labels, help, option labels) is shown in the reader's
// language when the funder translated it, text by text, and otherwise as the funder wrote it, with
// a note (docs/forms.md, "Languages"). A text in another language than the page is marked with
// its `lang`. Reviewers and staff can switch the questions to the form's other language. Answers
// are never per language: a choice is stored as its source value, whatever label was read.
import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, BookOpen, Bot, EyeOff, FileText, Languages, Pencil, Plus, Trash2, TriangleExclamationPoint, Upload } from "lucide-react";
import {
  clone,
  computeBudgetTotals,
  countWords,
  deleteAt,
  effectiveSchema,
  evaluateUi,
  formText,
  getPath,
  isFormLanguage,
  keyTitle,
  isMoney,
  isPlainObject,
  maskForReviewer,
  parsePointer,
  sanitizeRichText,
  schemaAtScope,
  scopeToPointer,
  setAt,
  sourceLanguageOf,
  stripTags,
  toMinor,
  validateResponse,
  type FormDefinition,
  type FormLanguage,
  type FormSchema,
  type FormText,
  type Json,
  type JsonObject,
  type ShownText,
  type UiControl,
  type UiElement,
  type UiLayout,
  type ValidationError,
  type WidgetName,
  type WidgetOptions,
} from "@gms/forms";
import { getLocale, intlLocale } from "../i18n/index.tsx";
import { t, useApplicantText } from "../screens/applicant/i18n.ts";

export type FormMode = "edit" | "reviewer" | "funder" | "print";

/** A stored file, as the upload port returns it and as a `fileRef` value holds it. */
export interface UploadedFile {
  documentId: string;
  name: string;
  size?: number;
}

export interface FormViewProps {
  form: FormDefinition;
  response: JsonObject;
  mode: FormMode;
  /** JSON pointer → source of the value (`passport`, `library`, `prior_submission`, `qbo`, `user`, `agent:<client>`). */
  provenance?: Record<string, string>;
  /** Edit mode: called with the whole response after every change. */
  onChange?: (response: JsonObject) => void;
  /** Edit mode: called with the latest response once typing pauses. */
  onAutosave?: (response: JsonObject) => void;
  autosaveDelayMs?: number;
  /** Edit mode: show every validation error, not only those on fields the person has touched. */
  showAllErrors?: boolean;
  /** Errors returned by the API; shown alongside the local ones. */
  serverErrors?: ValidationError[];
  /** Reviewer mode: external reviewers get PII masked. */
  externalReviewer?: boolean;
  /** Edit mode: stores a file and returns its reference. Without it, file fields are read-only. */
  uploadFile?: (file: File) => Promise<UploadedFile>;
  /** Where "Edit in Passport" goes. */
  passportUrl?: string;
  /** Where an organization changes the details it entered itself (Settings). */
  profileUrl?: string;
  /**
   * Whether the organization has a Passport record for `passportField`s to follow (default true).
   * Without one they are ordinary inputs the applicant fills in, and no Passport link is shown.
   */
  passportLinked?: boolean;
  /**
   * The language to show the funder's text in. Default: the page's, where the funder translated
   * it. Reviewer and funder modes offer a switch to the form's other language when it has one.
   */
  language?: FormLanguage;
  /** The funder's own preview: show the assistant's unreviewed translation drafts too. */
  previewDrafts?: boolean;
}

// ---------------------------------------------------------------------------------------------
// helpers

const fieldPointer = (path: string, ...rest: Array<string | number>) =>
  [path, ...rest.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))].join("/");

function withValue(response: JsonObject, path: string, value: Json | undefined): JsonObject {
  const next = clone(response);
  const segs = parsePointer(path);
  if (value === undefined || value === "" || value === null) deleteAt(next, segs);
  else setAt(next, segs, value);
  return next;
}

function isRequired(root: FormSchema, path: string): boolean {
  const segs = parsePointer(path);
  const last = segs[segs.length - 1];
  if (last === undefined) return false;
  const parentScope =
    "#" +
    segs
      .slice(0, -1)
      .map((s) => `/properties/${s}`)
      .join("");
  const parent = segs.length === 1 ? root : schemaAtScope(root, parentScope);
  return parent?.required?.includes(last) ?? false;
}

function formatMoney(v: unknown): string {
  if (!isMoney(v)) return "";
  try {
    return new Intl.NumberFormat(intlLocale(), {
      style: "currency",
      currency: v.currency,
      maximumFractionDigits: toMinor(v.amount) % 100 === 0 ? 0 : 2,
    }).format(Number(v.amount));
  } catch {
    return `${v.amount} ${v.currency}`;
  }
}

function formatDate(v: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  // Spanish spells the month out ("15 de noviembre de 2026"), as lib/format.ts does.
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(intlLocale(), { year: "numeric", month: getLocale() === "en" ? "short" : "long", day: "numeric" });
}

// Labels are getters, read in the page's language each time (docs/i18n.md).
const PROVENANCE: Record<string, { cls: string; readonly label: string; icon: typeof BadgeCheck }> = {
  passport: { cls: "prov-passport", get label() { return t("form.provenance.passport"); }, icon: BadgeCheck },
  library: { cls: "prov-library", get label() { return t("form.provenance.library"); }, icon: BookOpen },
  prior_submission: { cls: "prov-report", get label() { return t("form.provenance.priorReport"); }, icon: FileText },
  qbo: { cls: "prov-qb", get label() { return t("form.provenance.quickbooks"); }, icon: FileText },
  user: { cls: "prov-entered", get label() { return t("form.provenance.entered"); }, icon: Pencil },
  // Filled from the details the organization entered itself (no Passport record behind them).
  self_declared: { cls: "prov-entered", get label() { return t("form.provenance.youEntered"); }, icon: Pencil },
};

/** What the applicant's own details are called for anyone else reading the form (review NP-15). */
const FOR_OTHERS: Record<string, () => string> = { self_declared: () => t("form.provenance.selfReported") };

export function ProvenanceChip({ source, forApplicant = true }: { source: string; forApplicant?: boolean }) {
  useApplicantText();
  const base = PROVENANCE[source] ?? (source.startsWith("agent:") ? { cls: "prov-agent", label: t("form.provenance.agentDraft"), icon: Bot } : null);
  const known = base && !forApplicant && FOR_OTHERS[source] ? { ...base, label: FOR_OTHERS[source]!() } : base;
  if (!known) return null;
  const Icon = known.icon;
  return (
    <span className={`prov ${known.cls}`}>
      <Icon className="ic" aria-hidden="true" />
      {known.label}
    </span>
  );
}

function widgetOf(schema: FormSchema, control: UiControl): WidgetName | undefined {
  return control.options?.widget ?? schema["x-widget"];
}
function widgetOptionsOf(schema: FormSchema, control: UiControl): WidgetOptions {
  const fromUi = control.options?.widgetOptions;
  return schema["x-widgetOptions"] ?? (isPlainObject(fromUi) ? (fromUi as WidgetOptions) : {});
}

const titleCase = keyTitle;

/** A language's own name, as a language switch names it (never translated). */
const LANGUAGE_OWN_NAME: Record<FormLanguage, string> = { en: "English", es: "Español" };

/** A funder's text, marked with its language when the page reads in another one (WCAG 3.1.2). */
function Shown({ s, page }: { s: ShownText; page: string }) {
  return s.lang === page ? <>{s.text}</> : <span lang={s.lang}>{s.text}</span>;
}

// ---------------------------------------------------------------------------------------------
// renderer

interface Ctx {
  form: FormDefinition;
  schema: FormSchema;
  mode: FormMode;
  response: JsonObject;
  /** The response as this viewer may see it (masked in reviewer mode). */
  visibleResponse: JsonObject;
  removed: Set<string>;
  masked: Set<string>;
  hidden: Set<string>;
  disabled: Set<string>;
  errors: ValidationError[];
  showError: (path: string) => boolean;
  provenance: Record<string, string>;
  set: (path: string, value: Json | undefined) => void;
  touch: (path: string) => void;
  uid: string;
  uploadFile?: (file: File) => Promise<UploadedFile>;
  passportUrl: string;
  profileUrl: string | null;
  passportLinked: boolean;
  /** The funder's text in the language shown. */
  text: FormText;
  /** The page's language. */
  pageLang: string;
}

/**
 * The form. Its own words are in the applicant catalog, loaded on demand: while it arrives only the
 * form waits, never the screen or dialog around it (a funder's preview, a gallery dialog).
 */
export function FormView(props: FormViewProps) {
  return (
    <Suspense fallback={null}>
      <FormBody {...props} />
    </Suspense>
  );
}

function FormBody(props: FormViewProps) {
  useApplicantText();
  const { form, mode, onChange, onAutosave, autosaveDelayMs = 800 } = props;
  const uid = useId();
  const [response, setResponse] = useState<JsonObject>(props.response);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const dirty = useRef(false);

  // A new response object from the parent (another editor's change, a refresh) replaces local state.
  useEffect(() => setResponse(props.response), [props.response]);

  useEffect(() => {
    if (mode !== "edit" || !onAutosave || !dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      onAutosave(response);
    }, autosaveDelayMs);
    return () => clearTimeout(t);
  }, [response, mode, onAutosave, autosaveDelayMs]);

  const schema = useMemo(() => effectiveSchema(form), [form]);
  const ui = useMemo(() => evaluateUi(form.uiSchema, response), [form, response]);
  const mask = useMemo(
    () => (mode === "reviewer" ? maskForReviewer(form, response, { external: props.externalReviewer ?? false }) : null),
    [form, response, mode, props.externalReviewer],
  );
  const errors = useMemo(
    () => (mode === "edit" ? [...validateResponse(form, response).validationErrors, ...(props.serverErrors ?? [])] : []),
    [form, response, mode, props.serverErrors],
  );

  // The funder's text: in the reader's language where translated, else the form's own.
  const pageLang = getLocale();
  const [chosen, setChosen] = useState<FormLanguage | null>(null);
  const language = props.language ?? chosen ?? (isFormLanguage(pageLang) ? pageLang : sourceLanguageOf(form));
  const text = useMemo(() => formText(form, language, { drafts: props.previewDrafts === true }), [form, language, props.previewDrafts]);

  const ctx: Ctx = {
    form,
    schema,
    mode,
    response,
    visibleResponse: mask?.response ?? response,
    removed: new Set(mask?.removed),
    masked: new Set(mask?.masked),
    hidden: new Set(ui.hidden),
    disabled: new Set(ui.disabled),
    errors,
    showError: (path) => (props.showAllErrors ?? false) || touched.has(path),
    provenance: props.provenance ?? {},
    set: (path, value) => {
      const next = withValue(response, path, value);
      dirty.current = true;
      setResponse(next);
      onChange?.(next);
    },
    touch: (path) => setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path))),
    uid,
    uploadFile: props.uploadFile,
    passportUrl: props.passportUrl ?? "https://app.passport.opengrants.io",
    profileUrl: props.profileUrl ?? null,
    passportLinked: props.passportLinked ?? true,
    text,
    pageLang,
  };

  const body = <Element el={form.uiSchema} path="" ctx={ctx} />;
  if (mode === "print") return <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{body}</div>;
  // Reviewers and staff may read the questions in the form's other language.
  const canSwitch = (mode === "reviewer" || mode === "funder") && !props.language && text.languages.length > 1;
  return (
    <div className="gms-form" data-mode={mode} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {(canSwitch || text.coverage !== "full") && (
        <div className="row" style={{ gap: "12px", flexWrap: "wrap", justifyContent: "space-between" }}>
          {text.coverage !== "full" ? (
            <p className="row small muted" style={{ gap: "6px" }} data-testid="form-language-note">
              <Languages className="ic ic-sm" aria-hidden="true" />
              {t(text.coverage === "none" ? "form.language.notTranslated" : "form.language.partlyTranslated", { language: text.source })}
            </p>
          ) : (
            <span />
          )}
          {canSwitch && (
            <div className="row" style={{ gap: "8px" }}>
              <span className="small muted" id={`${uid}-language`}>
                {t("form.language.questionsIn")}
              </span>
              <div className="seg" role="group" aria-labelledby={`${uid}-language`}>
                {text.languages.map((l) => (
                  <button key={l} type="button" lang={l} className={l === language ? "on" : ""} aria-pressed={l === language} onClick={() => setChosen(l)}>
                    {LANGUAGE_OWN_NAME[l]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  );
}

/** True when a layout has at least one control this viewer will see. */
function hasVisible(el: UiElement, ctx: Ctx): boolean {
  if (el.type === "Control") {
    const path = scopeToPointer(el.scope);
    return !ctx.hidden.has(path) && !ctx.removed.has(path);
  }
  return el.elements.some((child) => hasVisible(child, ctx));
}

/** A section's title in the language shown; `path` is the layout's place in the UI schema. */
const sectionText = (ctx: Ctx, path: string, label: string | undefined): ShownText | null => (label ? ctx.text.section(path, label) : null);

function Element({ el, path, ctx }: { el: UiElement; path: string; ctx: Ctx }) {
  if (!hasVisible(el, ctx)) return null;
  if (el.type === "Control") return <Control control={el} ctx={ctx} />;
  const children = el.elements.map((child, i) => <Element key={i} el={child} path={`${path}/elements/${i}`} ctx={ctx} />);
  const title = sectionText(ctx, path, el.label);
  switch (el.type) {
    case "HorizontalLayout":
      return ctx.mode === "print" ? <>{children}</> : <div className="fld-row">{children}</div>;
    case "Group":
    case "Category":
      if (ctx.mode === "print") {
        return (
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2>{title && <Shown s={title} page={ctx.pageLang} />}</h2>
            {children}
          </section>
        );
      }
      return (
        <section className="card" aria-label={title?.text}>
          <div className="card-h">
            <h3>{title && <Shown s={title} page={ctx.pageLang} />}</h3>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {children}
          </div>
        </section>
      );
    case "Categorization":
      return <Categorization el={el} path={path} ctx={ctx} />;
    default:
      return <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>{children}</div>;
  }
}

function Categorization({ el, path, ctx }: { el: UiLayout; path: string; ctx: Ctx }) {
  // Each category keeps its place in the UI schema, which is how its title's translation is found.
  const placed = el.elements.flatMap((c, i) => (c.type === "Category" && hasVisible(c, ctx) ? [{ c: c as UiLayout, at: `${path}/elements/${i}` }] : []));
  const categories = placed.map((p) => p.c);
  const atOf = (c: UiLayout) => placed.find((p) => p.c === c)!.at;
  const [active, setActive] = useState(0);
  // Read-only modes show every category; only the editor pages through them.
  if (ctx.mode !== "edit") {
    return (
      <>
        {placed.map(({ c, at }, i) => (
          <Element key={i} el={c} path={at} ctx={ctx} />
        ))}
      </>
    );
  }
  const current = categories[Math.min(active, categories.length - 1)];
  const currentTitle = current ? sectionText(ctx, atOf(current), current.label) : null;
  const countErrors = (c: UiLayout): number => {
    const paths: string[] = [];
    const walk = (e: UiElement) => (e.type === "Control" ? paths.push(scopeToPointer(e.scope)) : e.elements.forEach(walk));
    walk(c);
    return ctx.errors.filter((err) => paths.some((p) => (err.field === p || err.field.startsWith(p + "/")) && ctx.showError(p))).length;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="tabs" role="tablist" aria-label={sectionText(ctx, path, el.label)?.text ?? t("form.sections")}>
        {categories.map((c, i) => {
          const n = countErrors(c);
          const title = sectionText(ctx, atOf(c), c.label);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={c === current}
              className={c === current ? "tab on" : "tab"}
              onClick={() => setActive(i)}
            >
              {title && <Shown s={title} page={ctx.pageLang} />}
              {n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
      {current && (
        <div role="tabpanel" aria-label={currentTitle?.text} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {current.elements.map((child, i) => (
            <Element key={i} el={child} path={`${atOf(current)}/elements/${i}`} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function Control({ control, ctx }: { control: UiControl; ctx: Ctx }) {
  const path = scopeToPointer(control.scope);
  const schema = schemaAtScope(ctx.schema, control.scope);
  if (!schema) return null;
  const segs = parsePointer(path);
  const shownLabel = ctx.text.label(path, control.label ?? schema.title ?? titleCase(segs[segs.length - 1] ?? ""));
  const label = shownLabel.text;
  const labelNode = <Shown s={shownLabel} page={ctx.pageLang} />;
  const widget = widgetOf(schema, control);
  const opts = widgetOptionsOf(schema, control);
  const id = `${ctx.uid}${path.replace(/[^\w-]/g, "-")}`;
  const helpSource = control.options?.help ?? schema.description;
  const help = helpSource ? <Shown s={ctx.text.help(path, helpSource)} page={ctx.pageLang} /> : undefined;
  const source = ctx.provenance[path];
  const readOnly = ctx.mode !== "edit";
  const required = isRequired(ctx.schema, path);
  const fieldErrors = ctx.showError(path) ? ctx.errors.filter((e) => e.field === path || e.field.startsWith(path + "/")) : [];
  const value = getPath(ctx.visibleResponse, path);

  if (readOnly) {
    return (
      <div className="fld">
        <div className="lbl">
          {labelNode}
          {ctx.mode === "funder" && source && <ProvenanceChip source={source} forApplicant={false} />}
        </div>
        {ctx.masked.has(path) ? (
          <span className="masked" style={{ alignSelf: "flex-start" }}>
            <EyeOff className="ic ic-sm" aria-hidden="true" />
            {t("form.hiddenFromExternalReviewers")}
          </span>
        ) : (
          <ReadValue schema={schema} widget={widget} value={value} option={(v) => ctx.text.option(path, v)} page={ctx.pageLang} />
        )}
      </div>
    );
  }

  const disabled = ctx.disabled.has(path);
  // Each error shown under the field is part of the control's description (WCAG 3.3.1).
  const shownErrors = dedupe(fieldErrors);
  const errorIds = shownErrors.map((_, i) => `${id}-err-${i}`);
  const common: InputProps = {
    id,
    path,
    schema,
    opts,
    value,
    disabled,
    invalid: fieldErrors.length > 0,
    describedBy: [`${id}-help`, ...errorIds].join(" "),
    ctx,
    label,
    labelShown: shownLabel,
    control,
  };
  const wordLimit = schema["x-wordCount"];
  const words = wordLimit && typeof value === "string" ? countWords(stripTags(value)) : 0;
  // Composite widgets label their own inputs; a plain <label> would point at nothing.
  const composite =
    widget === "budgetTable" ||
    widget === "address" ||
    widget === "signature" ||
    schema.type === "array" ||
    (schema.type === "object" && !widget);

  return (
    <div className="fld" role={composite ? "group" : undefined} aria-labelledby={composite ? `${id}-label` : undefined}>
      {schema.type === "boolean" && !widget ? null : composite ? (
        <div className="lbl" id={`${id}-label`}>
          {labelNode}
          {required && <Required />}
          {source && <ProvenanceChip source={source} forApplicant={ctx.mode === "edit"} />}
        </div>
      ) : (
        <label className="lbl" htmlFor={id}>
          {labelNode}
          {required && <Required />}
          {source && <ProvenanceChip source={source} forApplicant={ctx.mode === "edit"} />}
        </label>
      )}
      <Input {...common} widget={widget} required={required} />
      {widget === "passportField" && source === "self_declared" && (
        <span className="help">
          {ctx.profileUrl ? <a href={ctx.profileUrl}>{t("form.changeItInSettings")}</a> : t("form.changeItInSettings")} · {t("form.selfDeclaredNote")}
        </span>
      )}
      {widget === "passportField" && source !== "self_declared" && ctx.passportLinked && (
        <span className="help">
          <a href={ctx.passportUrl} target="_blank" rel="noreferrer">
            {t("form.editInPassport")}
          </a>{" "}
          · {t("form.passportReadOnly")}
        </span>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <span className="help" id={`${id}-help`}>
          {help}
        </span>
        {wordLimit?.max !== undefined && (
          <span className={words > wordLimit.max ? "counter over" : "counter"} aria-live="polite">
            {t("form.wordCounter", { words, max: wordLimit.max })}
          </span>
        )}
      </div>
      {shownErrors.map((e, i) => (
        <span className="err-msg" role="alert" id={errorIds[i]} key={e.field + e.message}>
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {errorText(e, label)}
        </span>
      ))}
    </div>
  );
}

const Required = () => (
  <span className="req" title={t("form.required")}>
    <span aria-hidden="true">*</span>
    <span className="sr">{t("form.requiredSr")}</span>
  </span>
);

function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => !seen.has(e.message) && seen.add(e.message));
}
/**
 * A validation message under its field, in the page's language. The rules (@gms/forms) word their
 * messages in English; each known one is shown from the catalog, anything else as written. A
 * message that starts with a capital (from the API) is a sentence of its own.
 */
function errorText(e: ValidationError, label: string): string {
  const m = e.message;
  if (/^[A-Z]/.test(m)) return m;
  for (const [pattern, text] of ERROR_TEXT) {
    const match = pattern.exec(m);
    if (match) return text(match, label, e.type);
  }
  return `${label} ${m}`;
}

/** A validation message without its field's label, for a list that names the field beside it. */
export function validationMessage(e: ValidationError): string {
  if (/^[A-Z]/.test(e.message)) return e.message;
  const text = errorText(e, "").replace(/^[\s:]+/, "");
  return text || e.message;
}

const FORMAT_KIND: Record<string, string> = { email: "email", uri: "uri", date: "date", "date-time": "datetime" };
const ERROR_TEXT: [RegExp, (m: RegExpExecArray, label: string, type: string) => string][] = [
  [/^is required$/, (_, label) => t("form.error.required", { label })],
  [/^is not an expected field$/, (_, label) => t("form.error.unexpected", { label })],
  [/^must be (string|number|integer|boolean|object|array|null)$/, (_, label) => t("form.error.type", { label, type: _[1] })],
  [/^must be one of the allowed values$/, (_, label) => t("form.error.enum", { label })],
  [/^must equal the required value$/, (_, label) => t("form.error.const", { label })],
  [/^must be at least (\d+) characters$/, (m, label) => t("form.error.minLength", { label, min: Number(m[1]) })],
  [/^must be at most (\d+) characters$/, (m, label) => t("form.error.maxLength", { label, max: Number(m[1]) })],
  [/^is not in the expected format$/, (_, label) => t("form.error.pattern", { label })],
  [/^must be a valid (\S+)$/, (m, label) => t("form.error.format", { label, kind: FORMAT_KIND[m[1]!] ?? "other", format: m[1] })],
  [/^must be at most (\d+) words \(currently (\d+)\)$/, (m, label) => t("form.error.maxWords", { label, max: Number(m[1]), count: Number(m[2]) })],
  [/^must be at least (\d+) words \(currently (\d+)\)$/, (m, label) => t("form.error.minWords", { label, min: Number(m[1]), count: Number(m[2]) })],
  [/^must be at least (-?[\d.]+)$/, (m, label) => t("form.error.minimum", { label, min: m[1] })],
  [/^must be at most (-?[\d.]+)$/, (m, label) => t("form.error.maximum", { label, max: m[1] })],
  [/^must have at least (\d+) items?$/, (m, label) => t("form.error.minItems", { label, min: Number(m[1]) })],
  [/^must have at most (\d+) items?$/, (m, label) => t("form.error.maxItems", { label, max: Number(m[1]) })],
  [/^must not contain duplicates$/, (_, label) => t("form.error.unique", { label })],
  [/^must be a phone number$/, (_, label) => t("form.error.phone", { label })],
  [/^type your full legal name$/, (_, label) => t("form.error.signatureName", { label })],
  [/^the attestation box must be checked$/, (_, label) => t("form.error.attestation", { label })],
  [/^must be text$/, (_, label) => t("form.error.text", { label })],
  [/^must be a decimal string such as "25000\.00"$/, (_, label) => t("form.error.decimal", { label })],
  [/^must not be negative$/, (_, label) => t("form.error.negative", { label })],
  [/^must be a three-letter ISO 4217 code$/, (_, label) => t("form.error.currencyCode", { label })],
  [/^must be ([A-Z]{3})$/, (m, label) => t("form.error.currency", { label, currency: m[1] })],
  [/^must be one of: (.+)$/, (m, label) => t("form.error.oneOf", { label, options: m[1] })],
  [/^budget total (\S+) exceeds the requested amount (\S+)$/, (m, label) => t("form.error.budgetTotal", { label, total: m[1], max: m[2] })],
];

// ---------------------------------------------------------------------------------------------
// read-only values

/** A stored choice shown by its label in the language shown (the value itself stays as stored). */
type OptionText = (value: string) => ShownText;

function ReadValue({ schema, widget, value, option, page }: { schema: FormSchema; widget: WidgetName | undefined; value: Json | undefined; option: OptionText; page: string }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))
    return <span className="muted">—</span>;
  if (widget === "money" || isMoney(value)) return <div>{formatMoney(value)}</div>;
  if (widget === "richText" && typeof value === "string") return <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(value).html }} />;
  if (widget === "budgetTable") return <BudgetRead rows={value} option={option} page={page} />;
  if (widget === "signature" && isPlainObject(value)) {
    return (
      <div>
        {t.rich("form.signedBy", { name: String(value.name ?? ""), b: (chunks) => <span className="b">{chunks}</span> })}
        {value.attested === true ? ` · ${t("form.attestationConfirmed")}` : ""}
      </div>
    );
  }
  if (widget === "address" && isPlainObject(value)) {
    const line3 = [value.city, value.region, value.postalCode].filter(Boolean).join(", ");
    return (
      <div style={{ whiteSpace: "pre-line" }}>
        {[value.line1, value.line2, line3, value.country].filter((s) => typeof s === "string" && s).join("\n")}
      </div>
    );
  }
  if (widget === "fileRef" && isPlainObject(value)) {
    return (
      <div className="doc">
        <span className="ft">{t("form.file")}</span>
        <div className="grow">
          <div className="nm">{String(value.name ?? value.documentId ?? value.passportDocumentId ?? t("form.attachment"))}</div>
          {value.passportDocumentId ? <div className="mt">{t("form.passportLocker")}</div> : null}
        </div>
      </div>
    );
  }
  if (typeof value === "boolean") return <div>{t("form.yesNo", { value: value ? "yes" : "no" })}</div>;
  if (typeof value === "string") {
    if (schema.format === "date" || schema.format === "date-time") return <div>{formatDate(value)}</div>;
    if (schema.enum?.includes(value)) return <div><Shown s={option(value)} page={page} /></div>;
    return <div style={{ whiteSpace: "pre-wrap" }}>{value}</div>;
  }
  if (typeof value === "number") return <div>{value.toLocaleString(intlLocale())}</div>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      const choices = schema.items?.enum;
      if (!choices) return <div>{value.join(", ")}</div>;
      return (
        <div>
          {value.map((v, i) => (
            <span key={String(v)}>
              {i > 0 && ", "}
              {typeof v === "string" && choices.includes(v) ? <Shown s={option(v)} page={page} /> : String(v)}
            </span>
          ))}
        </div>
      );
    }
    const columns = Object.keys(schema.items?.properties ?? (isPlainObject(value[0]) ? value[0] : {}));
    return (
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("form.tableScrollable")}>
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{schema.items?.properties?.[c]?.title ?? titleCase(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{isPlainObject(row) ? formatCell(row[c]) : ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (isPlainObject(value)) {
    return (
      <dl className="kv">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{schema.properties?.[k]?.title ?? titleCase(k)}</dt>
            <dd>{formatCell(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

function formatCell(v: Json | undefined): string {
  if (v === undefined || v === null) return "";
  if (isMoney(v)) return formatMoney(v);
  if (typeof v === "boolean") return t("form.yesNo", { value: v ? "yes" : "no" });
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function BudgetRead({ rows, option, page }: { rows: Json; option: OptionText; page: string }) {
  const list = Array.isArray(rows) ? rows.filter(isPlainObject) : [];
  const totals = computeBudgetTotals(rows);
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("form.tableScrollable")}>
      <table className="tbl bud">
        <thead>
          <tr>
            <th>{t("form.category")}</th>
            <th className="num">{t("form.amount")}</th>
            <th>{t("form.notes")}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i}>
              <td>{typeof r.label === "string" ? r.label : typeof r.category === "string" ? <Shown s={option(r.category)} page={page} /> : ""}</td>
              <td className="num">{formatMoney(r.amount)}</td>
              <td style={{ whiteSpace: "normal" }}>{String(r.notes ?? "")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t("form.total")}</td>
            <td className="num">{totals.total ? formatMoney(totals.total) : "—"}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// inputs

interface InputProps {
  id: string;
  path: string;
  schema: FormSchema;
  opts: WidgetOptions;
  value: Json | undefined;
  disabled: boolean;
  invalid: boolean;
  describedBy: string;
  ctx: Ctx;
  label: string;
  /** The label with its language, for a control that shows it beside the input (a yes/no box). */
  labelShown: ShownText;
  control: UiControl;
}

const cls = (base: string, invalid: boolean) => (invalid ? `${base} err` : base);

function Input(props: InputProps & { widget: WidgetName | undefined; required: boolean }) {
  const { id, path, schema, value, disabled, invalid, describedBy, ctx, widget, required, control } = props;
  const base = {
    id,
    disabled,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
    onBlur: () => ctx.touch(path),
  };
  const placeholder = control.options?.placeholder;
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);

  switch (widget) {
    case "passportField":
      // No Passport record to follow: the applicant types the value like any other field.
      if (!ctx.passportLinked && ctx.mode === "edit")
        return <input {...base} className={cls("inp", invalid)} autoComplete={organizationAutocomplete(path)} value={text} onChange={(e) => ctx.set(path, e.target.value === "" ? undefined : e.target.value)} />;
      return (
        <input
          {...base}
          className="inp"
          readOnly
          value={isMoney(value) ? formatMoney(value) : isPlainObject(value) || Array.isArray(value) ? formatCell(value) : text}
        />
      );
    case "money":
      return <MoneyInput {...props} base={base} />;
    case "phone":
      return (
        <input
          {...base}
          className={cls("inp", invalid)}
          type="tel"
          autoComplete="tel"
          placeholder={placeholder}
          value={text}
          onChange={(e) => ctx.set(path, e.target.value)}
        />
      );
    case "richText":
      return (
        <textarea
          {...base}
          className={cls("ta", invalid)}
          placeholder={placeholder}
          value={text}
          onChange={(e) => ctx.set(path, e.target.value)}
          style={{ minHeight: "160px" }}
        />
      );
    case "address":
      return <AddressInput {...props} />;
    case "signature":
      return <SignatureInput {...props} />;
    case "fileRef":
      return <FileInput {...props} />;
    case "budgetTable":
      return <BudgetInput {...props} />;
  }

  if (schema.type === "boolean") {
    return (
      <label className="cb">
        <input
          {...base}
          type="checkbox"
          className="sr"
          checked={value === true}
          onChange={(e) => {
            ctx.touch(path);
            ctx.set(path, e.target.checked);
          }}
        />
        <span className={value === true ? "c on" : "c"} aria-hidden="true"></span>
        <span>
          <Shown s={props.labelShown} page={ctx.pageLang} />
          {required && <Required />}
        </span>
      </label>
    );
  }
  if (schema.enum) {
    return (
      <select {...base} className={cls("sel", invalid)} value={text} onChange={(e) => ctx.set(path, e.target.value)}>
        <option value="">{t("form.select")}</option>
        {schema.enum.map((o) => {
          // The option reads in the language shown; its value is the funder's, so the answer is stored once.
          const shown = typeof o === "string" ? ctx.text.option(path, o) : null;
          return (
            <option key={String(o)} value={String(o)} lang={shown && shown.lang !== ctx.pageLang ? shown.lang : undefined}>
              {shown ? shown.text : String(o)}
            </option>
          );
        })}
      </select>
    );
  }
  if (schema.type === "array" && schema.items?.enum) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {schema.items.enum.map((o) => {
          const on = selected.includes(o);
          return (
            <label className="cb" key={String(o)}>
              <input
                type="checkbox"
                className="sr"
                disabled={disabled}
                checked={on}
                onChange={() => {
                  ctx.touch(path);
                  const next = on ? selected.filter((v) => v !== o) : [...selected, o];
                  ctx.set(path, next.length ? next : undefined);
                }}
              />
              <span className={on ? "c on" : "c"} aria-hidden="true"></span>
              <span>{typeof o === "string" ? <Shown s={ctx.text.option(path, o)} page={ctx.pageLang} /> : String(o)}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (schema.type === "array") return <RepeatingGroup {...props} />;
  if (schema.type === "object") return <ObjectFields {...props} />;
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        {...base}
        className={cls("inp", invalid)}
        type="number"
        inputMode={schema.type === "integer" ? "numeric" : "decimal"}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        placeholder={placeholder}
        value={text}
        onChange={(e) => ctx.set(path, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  }
  const long = schema["x-wordCount"] !== undefined || (schema.maxLength ?? 0) > 200 || control.options?.multi === true;
  if (long) {
    return (
      <textarea
        {...base}
        className={cls("ta", invalid)}
        placeholder={placeholder}
        value={text}
        onChange={(e) => ctx.set(path, e.target.value)}
      />
    );
  }
  const type =
    schema.format === "date"
      ? "date"
      : schema.format === "date-time"
        ? "datetime-local"
        : schema.format === "email"
          ? "email"
          : schema.format === "uri"
            ? "url"
            : "text";
  return (
    <input
      {...base}
      className={cls("inp", invalid)}
      type={type}
      maxLength={schema.maxLength}
      placeholder={placeholder}
      value={text}
      onChange={(e) => ctx.set(path, e.target.value)}
    />
  );
}

function MoneyInput({ path, opts, value, ctx, invalid, base }: InputProps & { base: object }) {
  const currency = opts.currency ?? (isMoney(value) ? value.currency : "USD");
  const amount = isPlainObject(value) && typeof value.amount === "string" ? value.amount : "";
  return (
    <div className="row" style={{ gap: "8px" }}>
      <input
        {...base}
        className={cls("inp", invalid)}
        inputMode="decimal"
        value={amount}
        placeholder="0.00"
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          ctx.set(path, cleaned === "" ? undefined : { amount: cleaned, currency });
        }}
        style={{ textAlign: "right" }}
      />
      <span className="tag">{currency}</span>
    </div>
  );
}

function sub(id: string, key: string) {
  return `${id}-${key}`;
}

function AddressInput({ id, path, value, ctx, disabled }: InputProps) {
  const v = isPlainObject(value) ? value : {};
  const field = (key: string, label: string, autoComplete: string) => {
    const errs = ctx.showError(path) ? ctx.errors.filter((e) => e.field === fieldPointer(path, key)) : [];
    return (
      <div className="fld">
        <label className="lbl" htmlFor={sub(id, key)}>
          {label}
        </label>
        <input
          id={sub(id, key)}
          className={cls("inp", errs.length > 0)}
          disabled={disabled}
          autoComplete={autoComplete}
          value={typeof v[key] === "string" ? (v[key] as string) : ""}
          onBlur={() => ctx.touch(path)}
          onChange={(e) => {
            const next: JsonObject = { ...v };
            if (e.target.value === "") delete next[key];
            else next[key] = e.target.value;
            ctx.set(path, Object.keys(next).length ? next : undefined);
          }}
        />
      </div>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {field("line1", t("form.address.line1"), "address-line1")}
      {field("line2", t("form.address.line2"), "address-line2")}
      <div className="fld-row">
        {field("city", t("form.address.city"), "address-level2")}
        {field("region", t("form.address.region"), "address-level1")}
      </div>
      <div className="fld-row">
        {field("postalCode", t("form.address.postalCode"), "postal-code")}
        {field("country", t("form.address.country"), "country")}
      </div>
    </div>
  );
}

function SignatureInput({ id, path, value, ctx, disabled, invalid }: InputProps) {
  const v = isPlainObject(value) ? value : {};
  const update = (patch: JsonObject) => ctx.set(path, { ...v, ...patch });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="fld">
        <label className="lbl" htmlFor={sub(id, "name")}>
          {t("form.typeYourFullLegalName")}
        </label>
        <input
          id={sub(id, "name")}
          className={cls("inp", invalid)}
          disabled={disabled}
          autoComplete="name"
          value={typeof v.name === "string" ? v.name : ""}
          onBlur={(e) => {
            // Moving from the name to the attestation box is still inside this field: wait until
            // focus has left the whole group before showing what is missing.
            const group = e.currentTarget.closest('[role="group"]');
            setTimeout(() => {
              if (!group || !group.contains(document.activeElement)) ctx.touch(path);
            }, 150);
          }}
          onChange={(e) => update({ name: e.target.value })}
          style={{ fontFamily: "var(--font-emphasis)", fontStyle: "italic" }}
        />
      </div>
      <label className="cb">
        <input
          type="checkbox"
          className="sr"
          disabled={disabled}
          checked={v.attested === true}
          onChange={(e) => {
            ctx.touch(path);
            update({ attested: e.target.checked });
          }}
        />
        <span className={v.attested === true ? "c on" : "c"} aria-hidden="true"></span>
        <span>{t("form.iAmAuthorizedToSignAnd")}</span>
      </label>
    </div>
  );
}

/**
 * The browser's autofill purpose for an organization field the applicant types (WCAG 1.3.5), from
 * the last part of its path; nothing when the purpose is not one the browser knows.
 */
export function organizationAutocomplete(path: string): string | undefined {
  const key = (path.split("/").pop() ?? "").toLowerCase();
  if (/^(name|legalname|organizationname|orgname)$/.test(key)) return "organization";
  if (/email/.test(key)) return "email";
  if (/phone/.test(key)) return "tel";
  if (/website|url/.test(key)) return "url";
  return undefined;
}

function FileInput({ id, path, value, ctx, disabled, describedBy, label }: InputProps) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const input = useRef<HTMLInputElement>(null);
  const v = isPlainObject(value) ? value : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {v && (
        <div className="doc">
          <span className="ft">{t("form.file")}</span>
          <div className="grow">
            <div className="nm">{String(v.name ?? v.documentId ?? v.passportDocumentId)}</div>
            {v.passportDocumentId ? <div className="mt">{t("form.passportLocker")}</div> : null}
          </div>
          <button className="btn btn-sm btn-ghost" type="button" disabled={disabled} onClick={() => ctx.set(path, undefined)}>
            {t("form.remove")}
          </button>
        </div>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        className="sr"
        // The button below is the keyboard's way in; a hidden input in the tab order shows no focus.
        tabIndex={-1}
        disabled={disabled || !ctx.uploadFile || state.busy}
        aria-describedby={describedBy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !ctx.uploadFile) return;
          setState({ busy: true, error: null });
          try {
            const stored = await ctx.uploadFile(file);
            ctx.set(path, { documentId: stored.documentId, name: stored.name });
            setState({ busy: false, error: null });
          } catch (err) {
            setState({ busy: false, error: err instanceof Error ? err.message : t("form.uploadFailed") });
          } finally {
            ctx.touch(path);
            if (input.current) input.current.value = "";
          }
        }}
      />
      <div className="row">
        <button
          className="btn btn-sm btn-secondary"
          type="button"
          disabled={disabled || !ctx.uploadFile || state.busy}
          onClick={() => input.current?.click()}
          // Named by what it shows, then which field it fills; described by the field's help and errors.
          aria-label={state.busy ? t("form.uploadingField", { label }) : v ? t("form.replaceFileField", { label }) : t("form.uploadField", { label })}
          aria-describedby={describedBy}
        >
          <Upload className="ic" aria-hidden="true" />
          {state.busy ? t("form.uploading") : v ? t("form.replaceFile") : t("form.upload")}
        </button>
      </div>
      {state.error && (
        <span className="err-msg" role="alert">
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {state.error}
        </span>
      )}
    </div>
  );
}

function BudgetInput({ id, path, opts, value, ctx, disabled }: InputProps) {
  const rows = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const currency = opts.currency ?? "USD";
  const fixed = opts.categories;
  const display: JsonObject[] = fixed ? fixed.map((c) => rows.find((r) => r.category === c) ?? { category: c }) : rows;
  const totals = computeBudgetTotals(rows);
  const capRef = opts.maxTotalPath ? getPath(ctx.response, opts.maxTotalPath) : undefined;
  const caps = [opts.maxTotal, isMoney(capRef) ? capRef.amount : typeof capRef === "number" ? String(capRef) : undefined]
    .filter((c): c is string => typeof c === "string" && /^\d+(\.\d+)?$/.test(c))
    .map(toMinor);
  const cap = caps.length ? Math.min(...caps) : null;
  const over = cap !== null && totals.totalMinor > cap;

  const write = (next: JsonObject[]) => {
    // Rows without an amount are placeholders for the fixed categories; they are not stored.
    const kept = next.filter((r) => (fixed ? isPlainObject(r.amount) || (typeof r.notes === "string" && r.notes) : true));
    ctx.set(path, kept.length ? kept : undefined);
  };
  const patch = (i: number, change: JsonObject | null) => {
    const next = display.map((r) => ({ ...r }));
    if (change === null) next.splice(i, 1);
    else {
      const merged: JsonObject = { ...next[i], ...change };
      for (const k of Object.keys(merged)) if (merged[k] === "" || merged[k] === undefined) delete merged[k];
      next[i] = merged;
    }
    write(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("form.tableScrollable")}>
        <table className="tbl bud">
          <thead>
            <tr>
              <th>{t("form.category")}</th>
              <th className="num">{t("form.amountIn", { currency })}</th>
              <th>{t("form.notes")}</th>
              {!fixed && <th></th>}
            </tr>
          </thead>
          <tbody>
            {display.map((row, i) => {
              const amount = isPlainObject(row.amount) && typeof row.amount.amount === "string" ? row.amount.amount : "";
              const category = String(row.category ?? "");
              // A fixed category reads in the language shown; the row stores the funder's own name.
              const shownCategory = fixed ? ctx.text.option(path, category) : null;
              const name = shownCategory ? shownCategory.text : category;
              return (
                <tr key={fixed ? category : i}>
                  <td>
                    {shownCategory ? (
                      <Shown s={shownCategory} page={ctx.pageLang} />
                    ) : (
                      <input
                        className="inp"
                        aria-label={t("form.categoryRow", { row: i + 1 })}
                        disabled={disabled}
                        value={name}
                        onChange={(e) => patch(i, { category: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="num">
                    <input
                      id={i === 0 ? id : undefined}
                      className="inp"
                      inputMode="decimal"
                      aria-label={name ? t("form.amountFor", { name }) : t("form.amountForRow", { row: i + 1 })}
                      disabled={disabled}
                      value={amount}
                      placeholder="0.00"
                      onBlur={() => ctx.touch(path)}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                        patch(i, { amount: cleaned === "" ? "" : { amount: cleaned, currency } });
                      }}
                      style={{ textAlign: "right", width: "140px" }}
                    />
                  </td>
                  <td>
                    <input
                      className="inp"
                      aria-label={name ? t("form.notesFor", { name }) : t("form.notesForRow", { row: i + 1 })}
                      disabled={disabled}
                      value={typeof row.notes === "string" ? row.notes : ""}
                      onChange={(e) => patch(i, { notes: e.target.value })}
                    />
                  </td>
                  {!fixed && (
                    <td>
                      <button
                        className="iconbtn"
                        type="button"
                        aria-label={t("form.removeRow", { row: i + 1 })}
                        disabled={disabled}
                        onClick={() => patch(i, null)}
                      >
                        <Trash2 className="ic" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>{t("form.total")}</td>
              <td className={over ? "num over" : "num"} data-testid="budget-total">
                {formatMoney({ amount: (totals.totalMinor / 100).toFixed(2), currency })}
              </td>
              <td>
                {cap !== null && (
                  <span className="small muted">{t("form.ofRequested", { amount: formatMoney({ amount: (cap / 100).toFixed(2), currency }) })}</span>
                )}
              </td>
              {!fixed && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {!fixed && (
        <div className="row">
          <button
            className="btn btn-sm btn-secondary"
            type="button"
            disabled={disabled}
            onClick={() => ctx.set(path, [...rows, { category: "" }])}
          >
            <Plus className="ic" aria-hidden="true" />
            {t("form.addRow")}
          </button>
        </div>
      )}
      {over && (
        <span className="err-msg" role="alert">
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {t("form.budgetOver", { amount: formatMoney({ amount: ((totals.totalMinor - cap) / 100).toFixed(2), currency }) })}
        </span>
      )}
    </div>
  );
}

/** Scalar editor for one property of a repeating row or nested object. */
function CellInput({
  schema,
  value,
  label,
  disabled,
  onChange,
  onBlur,
}: {
  schema: FormSchema;
  value: Json | undefined;
  label: string;
  disabled: boolean;
  onChange: (v: Json | undefined) => void;
  onBlur: () => void;
}) {
  const text = value === undefined || value === null ? "" : String(value);
  if (schema.enum) {
    return (
      <select
        className="sel"
        aria-label={label}
        disabled={disabled}
        value={text}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{t("form.select")}</option>
        {schema.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  }
  if (schema.type === "boolean") {
    return (
      <input
        type="checkbox"
        aria-label={label}
        disabled={disabled}
        checked={value === true}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  const numeric = schema.type === "number" || schema.type === "integer";
  return (
    <input
      className="inp"
      aria-label={label}
      disabled={disabled}
      type={numeric ? "number" : schema.format === "date" ? "date" : "text"}
      step={schema.type === "number" ? "any" : undefined}
      value={text}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value === "" ? undefined : numeric ? Number(e.target.value) : e.target.value)}
    />
  );
}

function RepeatingGroup({ path, schema, value, ctx, disabled, label }: InputProps) {
  const rows = Array.isArray(value) ? value : [];
  const item = schema.items ?? {};
  const columns = Object.entries(item.properties ?? {});
  const canAdd = schema.maxItems === undefined || rows.length < schema.maxItems;
  const setRow = (i: number, key: string, v: Json | undefined) => {
    const next = rows.map((r) => (isPlainObject(r) ? { ...r } : {}));
    const row = next[i] ?? {};
    if (v === undefined) delete row[key];
    else row[key] = v;
    next[i] = row;
    ctx.set(path, next);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rows.length > 0 && (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("form.tableScrollable")}>
          <table className="tbl">
            <thead>
              <tr>
                {columns.map(([key, s]) => (
                  <th key={key}>{s.title ?? titleCase(key)}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map(([key, s]) => (
                    <td key={key}>
                      <CellInput
                        schema={s}
                        value={isPlainObject(row) ? row[key] : undefined}
                        label={t("form.cellRow", { column: s.title ?? titleCase(key), row: i + 1 })}
                        disabled={disabled}
                        onBlur={() => ctx.touch(path)}
                        onChange={(v) => setRow(i, key, v)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="iconbtn"
                      type="button"
                      aria-label={t("form.removeRow", { row: i + 1 })}
                      disabled={disabled}
                      onClick={() => {
                        const next = rows.filter((_, j) => j !== i);
                        ctx.touch(path);
                        ctx.set(path, next.length ? next : undefined);
                      }}
                    >
                      <Trash2 className="ic" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button
          className="btn btn-sm btn-secondary"
          type="button"
          disabled={disabled || !canAdd}
          onClick={() => ctx.set(path, [...rows, {}])}
        >
          <Plus className="ic" aria-hidden="true" />
          {t("form.addItem", { label: label.toLowerCase() })}
        </button>
        {schema.maxItems !== undefined && <span className="help">{t("form.upToItems", { max: schema.maxItems })}</span>}
      </div>
    </div>
  );
}

function ObjectFields({ id, path, schema, value, ctx, disabled }: InputProps) {
  const v = isPlainObject(value) ? value : {};
  const fields: ReactNode[] = Object.entries(schema.properties ?? {}).map(([key, s]) => (
    <div className="fld" key={key}>
      <span className="lbl" id={sub(id, `${key}-l`)}>
        {s.title ?? titleCase(key)}
      </span>
      <CellInput
        schema={s}
        value={v[key]}
        label={s.title ?? titleCase(key)}
        disabled={disabled}
        onBlur={() => ctx.touch(path)}
        onChange={(next) => {
          const merged: JsonObject = { ...v };
          if (next === undefined) delete merged[key];
          else merged[key] = next;
          ctx.set(path, Object.keys(merged).length ? merged : undefined);
        }}
      />
    </div>
  ));
  return <div className="fld-row">{fields}</div>;
}
