// SPDX-License-Identifier: AGPL-3.0-only
// The one form renderer (build spec §10.2). It draws a CommonGrants FormBase — JSON Schema plus a
// JSON Forms-style UI schema — in four modes:
//   edit      the applicant editor: inputs, inline validation, word counters, provenance chips
//   reviewer  read-only; fields are removed or masked by `maskForReviewer`
//   funder    read-only, with provenance
//   print     read-only, flat, for the PDF snapshot
// All rules, validation and masking come from `@gms/forms`; this file only draws.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, BookOpen, Bot, EyeOff, FileText, Pencil, Plus, Trash2, TriangleExclamationPoint, Upload } from "lucide-react";
import {
  clone,
  computeBudgetTotals,
  countWords,
  deleteAt,
  effectiveSchema,
  evaluateUi,
  getPath,
  isMoney,
  isPlainObject,
  maskForReviewer,
  parsePointer,
  sanitizeRichText,
  schemaAtScope,
  scopeToPointer,
  setAt,
  stripTags,
  toMinor,
  validateResponse,
  type FormDefinition,
  type FormSchema,
  type Json,
  type JsonObject,
  type UiControl,
  type UiElement,
  type UiLayout,
  type ValidationError,
  type WidgetName,
  type WidgetOptions,
} from "@gms/forms";

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
    return new Intl.NumberFormat("en-US", {
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
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const PROVENANCE: Record<string, { cls: string; label: string; icon: typeof BadgeCheck }> = {
  passport: { cls: "prov-passport", label: "From Passport", icon: BadgeCheck },
  library: { cls: "prov-library", label: "From library", icon: BookOpen },
  prior_submission: { cls: "prov-report", label: "From prior report", icon: FileText },
  qbo: { cls: "prov-qb", label: "From QuickBooks", icon: FileText },
  user: { cls: "prov-entered", label: "Entered", icon: Pencil },
};

export function ProvenanceChip({ source }: { source: string }) {
  const known = PROVENANCE[source] ?? (source.startsWith("agent:") ? { cls: "prov-agent", label: "Agent draft", icon: Bot } : null);
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

const titleCase = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

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
}

export function FormView(props: FormViewProps) {
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
    passportUrl: props.passportUrl ?? "https://passport.opengrants.io",
  };

  const body = <Element el={form.uiSchema} ctx={ctx} />;
  if (mode === "print") return <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{body}</div>;
  return (
    <div className="gms-form" data-mode={mode} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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

function Element({ el, ctx }: { el: UiElement; ctx: Ctx }) {
  if (!hasVisible(el, ctx)) return null;
  if (el.type === "Control") return <Control control={el} ctx={ctx} />;
  const children = el.elements.map((child, i) => <Element key={i} el={child} ctx={ctx} />);
  switch (el.type) {
    case "HorizontalLayout":
      return ctx.mode === "print" ? <>{children}</> : <div className="fld-row">{children}</div>;
    case "Group":
    case "Category":
      if (ctx.mode === "print") {
        return (
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2>{el.label}</h2>
            {children}
          </section>
        );
      }
      return (
        <section className="card" aria-label={el.label}>
          <div className="card-h">
            <h3>{el.label}</h3>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {children}
          </div>
        </section>
      );
    case "Categorization":
      return <Categorization el={el} ctx={ctx} />;
    default:
      return <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>{children}</div>;
  }
}

function Categorization({ el, ctx }: { el: UiLayout; ctx: Ctx }) {
  const categories = el.elements.filter((c): c is UiLayout => c.type === "Category" && hasVisible(c, ctx));
  const [active, setActive] = useState(0);
  // Read-only modes show every category; only the editor pages through them.
  if (ctx.mode !== "edit") {
    return (
      <>
        {categories.map((c, i) => (
          <Element key={i} el={c} ctx={ctx} />
        ))}
      </>
    );
  }
  const current = categories[Math.min(active, categories.length - 1)];
  const countErrors = (c: UiLayout): number => {
    const paths: string[] = [];
    const walk = (e: UiElement) => (e.type === "Control" ? paths.push(scopeToPointer(e.scope)) : e.elements.forEach(walk));
    walk(c);
    return ctx.errors.filter((err) => paths.some((p) => (err.field === p || err.field.startsWith(p + "/")) && ctx.showError(p))).length;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="tabs" role="tablist" aria-label={el.label ?? "Sections"}>
        {categories.map((c, i) => {
          const n = countErrors(c);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={c === current}
              className={c === current ? "tab on" : "tab"}
              onClick={() => setActive(i)}
            >
              {c.label}
              {n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
      {current && (
        <div role="tabpanel" aria-label={current.label} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {current.elements.map((child, i) => (
            <Element key={i} el={child} ctx={ctx} />
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
  const label = control.label ?? schema.title ?? titleCase(segs[segs.length - 1] ?? "");
  const widget = widgetOf(schema, control);
  const opts = widgetOptionsOf(schema, control);
  const id = `${ctx.uid}${path.replace(/[^\w-]/g, "-")}`;
  const help = control.options?.help ?? schema.description;
  const source = ctx.provenance[path];
  const readOnly = ctx.mode !== "edit";
  const required = isRequired(ctx.schema, path);
  const fieldErrors = ctx.showError(path) ? ctx.errors.filter((e) => e.field === path || e.field.startsWith(path + "/")) : [];
  const value = getPath(ctx.visibleResponse, path);

  if (readOnly) {
    return (
      <div className="fld">
        <div className="lbl">
          {label}
          {ctx.mode === "funder" && source && <ProvenanceChip source={source} />}
        </div>
        {ctx.masked.has(path) ? (
          <span className="masked" style={{ alignSelf: "flex-start" }}>
            <EyeOff className="ic ic-sm" aria-hidden="true" />
            Hidden from external reviewers
          </span>
        ) : (
          <ReadValue schema={schema} widget={widget} value={value} />
        )}
      </div>
    );
  }

  const disabled = ctx.disabled.has(path);
  const common: InputProps = {
    id,
    path,
    schema,
    opts,
    value,
    disabled,
    invalid: fieldErrors.length > 0,
    describedBy: `${id}-help`,
    ctx,
    label,
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
          {label}
          {required && <Required />}
          {source && <ProvenanceChip source={source} />}
        </div>
      ) : (
        <label className="lbl" htmlFor={id}>
          {label}
          {required && <Required />}
          {source && <ProvenanceChip source={source} />}
        </label>
      )}
      <Input {...common} widget={widget} required={required} />
      {widget === "passportField" && (
        <span className="help">
          <a href={ctx.passportUrl} target="_blank" rel="noreferrer">
            Edit in Passport
          </a>{" "}
          · values from your Passport record are read-only here
        </span>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <span className="help" id={`${id}-help`}>
          {help}
        </span>
        {wordLimit?.max !== undefined && (
          <span className={words > wordLimit.max ? "counter over" : "counter"} aria-live="polite">
            {words} / {wordLimit.max} words
          </span>
        )}
      </div>
      {dedupe(fieldErrors).map((e) => (
        <span className="err-msg" role="alert" key={e.field + e.message}>
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {errorText(e, label)}
        </span>
      ))}
    </div>
  );
}

const Required = () => (
  <span className="req" title="Required">
    <span aria-hidden="true">*</span>
    <span className="sr">required</span>
  </span>
);

function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => !seen.has(e.message) && seen.add(e.message));
}
function errorText(e: ValidationError, label: string): string {
  const m = e.message;
  return /^[A-Z]/.test(m) ? m : `${label} ${m}`;
}

// ---------------------------------------------------------------------------------------------
// read-only values

function ReadValue({ schema, widget, value }: { schema: FormSchema; widget: WidgetName | undefined; value: Json | undefined }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))
    return <span className="muted">—</span>;
  if (widget === "money" || isMoney(value)) return <div>{formatMoney(value)}</div>;
  if (widget === "richText" && typeof value === "string") return <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(value).html }} />;
  if (widget === "budgetTable") return <BudgetRead rows={value} />;
  if (widget === "signature" && isPlainObject(value)) {
    return (
      <div>
        Signed by <span className="b">{String(value.name ?? "")}</span>
        {value.attested === true ? " · attestation confirmed" : ""}
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
        <span className="ft">FILE</span>
        <div className="grow">
          <div className="nm">{String(value.name ?? value.documentId ?? value.passportDocumentId ?? "Attachment")}</div>
          {value.passportDocumentId ? <div className="mt">Passport locker</div> : null}
        </div>
      </div>
    );
  }
  if (typeof value === "boolean") return <div>{value ? "Yes" : "No"}</div>;
  if (typeof value === "string") {
    if (schema.format === "date" || schema.format === "date-time") return <div>{formatDate(value)}</div>;
    return <div style={{ whiteSpace: "pre-wrap" }}>{value}</div>;
  }
  if (typeof value === "number") return <div>{value.toLocaleString("en-US")}</div>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) return <div>{value.join(", ")}</div>;
    const columns = Object.keys(schema.items?.properties ?? (isPlainObject(value[0]) ? value[0] : {}));
    return (
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Table, scrollable">
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
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function BudgetRead({ rows }: { rows: Json }) {
  const list = Array.isArray(rows) ? rows.filter(isPlainObject) : [];
  const totals = computeBudgetTotals(rows);
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Table, scrollable">
      <table className="tbl bud">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Amount</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i}>
              <td>{String(r.label ?? r.category ?? "")}</td>
              <td className="num">{formatMoney(r.amount)}</td>
              <td style={{ whiteSpace: "normal" }}>{String(r.notes ?? "")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
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
          {props.label}
          {required && <Required />}
        </span>
      </label>
    );
  }
  if (schema.enum) {
    return (
      <select {...base} className={cls("sel", invalid)} value={text} onChange={(e) => ctx.set(path, e.target.value)}>
        <option value="">Select…</option>
        {schema.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
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
              <span>{String(o)}</span>
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
      {field("line1", "Street address", "address-line1")}
      {field("line2", "Suite or unit (optional)", "address-line2")}
      <div className="fld-row">
        {field("city", "City", "address-level2")}
        {field("region", "State or region", "address-level1")}
      </div>
      <div className="fld-row">
        {field("postalCode", "Postal code", "postal-code")}
        {field("country", "Country", "country")}
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
          Type your full legal name
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
        <span>I am authorized to sign and I attest that this information is accurate.</span>
      </label>
    </div>
  );
}

function FileInput({ id, path, value, ctx, disabled, describedBy }: InputProps) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const input = useRef<HTMLInputElement>(null);
  const v = isPlainObject(value) ? value : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {v && (
        <div className="doc">
          <span className="ft">FILE</span>
          <div className="grow">
            <div className="nm">{String(v.name ?? v.documentId ?? v.passportDocumentId)}</div>
            {v.passportDocumentId ? <div className="mt">Passport locker</div> : null}
          </div>
          <button className="btn btn-sm btn-ghost" type="button" disabled={disabled} onClick={() => ctx.set(path, undefined)}>
            Remove
          </button>
        </div>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        className="sr"
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
            setState({ busy: false, error: err instanceof Error ? err.message : "The file could not be uploaded." });
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
        >
          <Upload className="ic" aria-hidden="true" />
          {state.busy ? "Uploading…" : v ? "Replace file" : "Upload"}
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
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Table, scrollable">
        <table className="tbl bud">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Amount ({currency})</th>
              <th>Notes</th>
              {!fixed && <th></th>}
            </tr>
          </thead>
          <tbody>
            {display.map((row, i) => {
              const amount = isPlainObject(row.amount) && typeof row.amount.amount === "string" ? row.amount.amount : "";
              const name = String(row.category ?? "");
              return (
                <tr key={fixed ? name : i}>
                  <td>
                    {fixed ? (
                      name
                    ) : (
                      <input
                        className="inp"
                        aria-label={`Category, row ${i + 1}`}
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
                      aria-label={`Amount for ${name || `row ${i + 1}`}`}
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
                      aria-label={`Notes for ${name || `row ${i + 1}`}`}
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
                        aria-label={`Remove row ${i + 1}`}
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
              <td>Total</td>
              <td className={over ? "num over" : "num"} data-testid="budget-total">
                {formatMoney({ amount: (totals.totalMinor / 100).toFixed(2), currency })}
              </td>
              <td>
                {cap !== null && (
                  <span className="small muted">of {formatMoney({ amount: (cap / 100).toFixed(2), currency })} requested</span>
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
            Add row
          </button>
        </div>
      )}
      {over && (
        <span className="err-msg" role="alert">
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          Budget total exceeds the requested amount by {formatMoney({ amount: ((totals.totalMinor - cap) / 100).toFixed(2), currency })}.
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
        <option value="">Select…</option>
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
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Table, scrollable">
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
                        label={`${s.title ?? titleCase(key)}, row ${i + 1}`}
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
                      aria-label={`Remove row ${i + 1}`}
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
          Add {label.toLowerCase()}
        </button>
        {schema.maxItems !== undefined && <span className="help">Up to {schema.maxItems}</span>}
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
