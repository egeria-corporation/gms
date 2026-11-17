// SPDX-License-Identifier: AGPL-3.0-only
// A funder's own text in a second language (docs/forms.md, "Languages"). A form is written in one
// language (its source, English unless it says otherwise); beside it a funder may give the same
// text in another: the form title, section titles, field labels, help text and option labels.
//
// Each translated text keeps the source text it was made from. When the source changes (in this
// draft or in a later version) the translation no longer matches and is flagged as needing an
// update; until then the reader is shown the source text instead, so nobody reads a question that
// says something the funder no longer asks. Answers never depend on the language: a choice is
// stored as its source value, whatever label the applicant read.
import { formatPointer, isPlainObject, parsePointer, scopeToPointer } from "./pointer.ts";
import type { DefinitionError, FormDefinition, FormSchema, Json, UiControl, UiElement, WidgetOptions } from "./types.ts";
import { schemaAtScope } from "./ui-schema.ts";
import { effectiveSchema } from "./validate.ts";

/** The languages a funder's text can be written or translated in (the GMS's interface languages). */
export const FORM_LANGUAGES = ["en", "es"] as const;
export type FormLanguage = (typeof FORM_LANGUAGES)[number];
export const isFormLanguage = (v: unknown): v is FormLanguage => typeof v === "string" && (FORM_LANGUAGES as readonly string[]).includes(v);
export const DEFAULT_FORM_LANGUAGE: FormLanguage = "en";

/** Longest translated text kept (a help text or summary; longer input is refused at save). */
export const MAX_TRANSLATED_TEXT = 20_000;

/** One text in another language, with the source text it translates. */
export interface TranslatedText {
  text: string;
  /** The source text as it was when this was translated. A different source today makes this stale. */
  source: string;
  /** The assistant's draft, not yet reviewed by a person. A form holding one cannot be published. */
  draft?: true;
}

export interface FieldTranslation {
  label?: TranslatedText;
  help?: TranslatedText;
  /** A choice's label (a select's options, a budget table's categories), by its stored value. */
  options?: Record<string, TranslatedText>;
}

export interface FormTranslation {
  title?: TranslatedText;
  /** Section titles (a Group's or Category's label), by the layout's place in the UI schema ("/elements/0"). */
  sections?: Record<string, TranslatedText>;
  /** By the field's JSON pointer into the response ("/projectTitle"). */
  fields?: Record<string, FieldTranslation>;
}

/** A form's text in other languages: part of the form version, published and copied with it. */
export type FormTranslations = { source?: FormLanguage } & { [L in FormLanguage]?: FormTranslation };

/** What one translatable text is. */
export type TextKind = "title" | "section" | "label" | "help" | "option";
export interface TranslatableText {
  /** Stable within a form version: kind, path and option. */
  id: string;
  kind: TextKind;
  /** "" for the title, the layout's UI-schema path for a section, the field's pointer otherwise. */
  path: string;
  /** For an option: its stored value. */
  option?: string;
  /** The text in the form's own language. */
  source: string;
}
/** `done`: translated, reviewed and current. `stale`: its source changed since. `draft`: the assistant's, not reviewed. */
export type TextState = "done" | "missing" | "stale" | "draft";
export interface TranslationItem extends TranslatableText {
  state: TextState;
  /** The translation as stored ("" when missing). */
  text: string;
  /** For a stale one: the source text it was translated from. */
  was?: string;
}
export interface TranslationStatus {
  language: FormLanguage;
  total: number;
  done: number;
  missing: number;
  stale: number;
  drafts: number;
  /** Every text translated, reviewed and current. */
  complete: boolean;
  items: TranslationItem[];
}

const idOf = (kind: TextKind, path: string, option?: string) => JSON.stringify(option === undefined ? [kind, path] : [kind, path, option]);

/** "projectTitle" → "Project title": the label a field without one is shown with. */
export const keyTitle = (key: string): string =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

function widgetOptions(node: FormSchema, control: UiControl): WidgetOptions {
  const fromUi = control.options?.widgetOptions;
  return node["x-widgetOptions"] ?? (isPlainObject(fromUi) ? (fromUi as WidgetOptions) : {});
}

/** The choices of a field as stored values: a select's or multi-select's options, a budget table's categories. */
export function fieldChoices(node: FormSchema, control: UiControl): string[] {
  const widget = control.options?.widget ?? node["x-widget"];
  if (widget === "budgetTable") return (widgetOptions(node, control).categories ?? []).filter(nonEmpty);
  const values = Array.isArray(node.enum) ? node.enum : node.type === "array" && Array.isArray(node.items?.enum) ? node.items.enum : [];
  return values.filter(nonEmpty);
}

/** A control's label, help and choices in the form's own language, as the renderer shows them. */
export function controlSourceText(root: FormSchema, control: UiControl): { label: string; help: string | undefined; choices: string[] } | null {
  const node = schemaAtScope(root, control.scope);
  if (!node) return null;
  const segs = parsePointer(scopeToPointer(control.scope));
  const label = control.label ?? node.title ?? keyTitle(segs[segs.length - 1] ?? "");
  const help = control.options?.help ?? node.description;
  return { label, help: nonEmpty(help) ? help : undefined, choices: fieldChoices(node, control) };
}

/** Every text of a form a funder can translate, in reading order. */
export function translatableTexts(form: Pick<FormDefinition, "title" | "jsonSchema" | "uiSchema">): TranslatableText[] {
  const out: TranslatableText[] = [];
  const add = (kind: TextKind, path: string, source: string, option?: string) => out.push({ id: idOf(kind, path, option), kind, path, source, ...(option !== undefined ? { option } : {}) });
  if (nonEmpty(form.title)) add("title", "", form.title);
  const root = effectiveSchema(form);
  const seen = new Set<string>();
  const walk = (el: UiElement, path: string) => {
    if (!isPlainObject(el)) return;
    if (el.type === "Control") {
      const pointer = scopeToPointer(el.scope);
      const text = controlSourceText(root, el);
      if (!text || seen.has(pointer)) return;
      seen.add(pointer);
      add("label", pointer, text.label);
      if (text.help) add("help", pointer, text.help);
      for (const c of [...new Set(text.choices)]) add("option", pointer, c, c);
      return;
    }
    if ((el.type === "Group" || el.type === "Category") && nonEmpty(el.label)) add("section", path, el.label);
    (el.elements ?? []).forEach((child, i) => walk(child, `${path}/elements/${i}`));
  };
  walk(form.uiSchema, "");
  return out;
}

/** The stored translation of one text, if any. */
function entryOf(tr: FormTranslation | undefined, unit: Pick<TranslatableText, "kind" | "path" | "option">): TranslatedText | undefined {
  if (!tr) return undefined;
  switch (unit.kind) {
    case "title":
      return tr.title;
    case "section":
      return tr.sections?.[unit.path];
    case "label":
      return tr.fields?.[unit.path]?.label;
    case "help":
      return tr.fields?.[unit.path]?.help;
    case "option":
      return unit.option === undefined ? undefined : tr.fields?.[unit.path]?.options?.[unit.option];
  }
}

/** Where a translation stands against today's source text. */
export function textState(entry: TranslatedText | undefined, source: string): TextState {
  if (!entry || !nonEmpty(entry.text)) return "missing";
  if (entry.source !== source) return "stale";
  return entry.draft ? "draft" : "done";
}

/** The form's own language. */
export const sourceLanguageOf = (form: Pick<FormDefinition, "translations">): FormLanguage => (isFormLanguage(form.translations?.source) ? form.translations.source : DEFAULT_FORM_LANGUAGE);

/** The languages a form has text in beside its own (whether or not every text is translated yet). */
export function addedLanguages(form: Pick<FormDefinition, "translations">): FormLanguage[] {
  const source = sourceLanguageOf(form);
  return FORM_LANGUAGES.filter((l) => l !== source && isPlainObject(form.translations?.[l]));
}

/** How far a form's translation into `language` has come, text by text. */
export function translationStatus(form: Pick<FormDefinition, "title" | "jsonSchema" | "uiSchema" | "translations">, language: FormLanguage): TranslationStatus {
  const tr = form.translations?.[language];
  const items = translatableTexts(form).map((u): TranslationItem => {
    const entry = entryOf(tr, u);
    const state = textState(entry, u.source);
    return { ...u, state, text: entry?.text ?? "", ...(state === "stale" ? { was: entry!.source } : {}) };
  });
  const count = (s: TextState) => items.filter((i) => i.state === s).length;
  const done = count("done");
  return { language, total: items.length, done, missing: count("missing"), stale: count("stale"), drafts: count("draft"), complete: items.length > 0 && done === items.length, items };
}

/** A text as shown, with the language it is in (to mark a passage in another language than the page). */
export interface ShownText {
  text: string;
  lang: FormLanguage;
}

/** The funder's text of one form in a reader's language, falling back text by text to the form's own. */
export interface FormText {
  /** The language asked for. */
  language: FormLanguage;
  /** The form's own language. */
  source: FormLanguage;
  /** `full`: everything in `language`; `partial`: some texts are in the form's own language; `none`: all are. */
  coverage: "full" | "partial" | "none";
  /** Every language the form can be read in: its own, and each with a translated text to show. */
  languages: FormLanguage[];
  title: ShownText;
  section(path: string, source: string): ShownText;
  label(pointer: string, source: string): ShownText;
  help(pointer: string, source: string): ShownText;
  option(pointer: string, value: string): ShownText;
}

/**
 * The form's text in `language`. A text is shown translated only when its translation is current
 * and reviewed (an assistant draft too with `drafts: true`, for the funder's own preview);
 * otherwise in the form's own language.
 */
export function formText(form: Pick<FormDefinition, "title" | "jsonSchema" | "uiSchema" | "translations">, language: FormLanguage, opts: { drafts?: boolean } = {}): FormText {
  const source = sourceLanguageOf(form);
  const tr = language === source ? undefined : form.translations?.[language];
  const shows = (s: TextState) => s === "done" || (opts.drafts === true && s === "draft");
  const pick = (unit: Pick<TranslatableText, "kind" | "path" | "option">, text: string): ShownText => {
    const entry = entryOf(tr, unit);
    return tr && entry && shows(textState(entry, text)) ? { text: entry.text, lang: language } : { text, lang: source };
  };
  let coverage: FormText["coverage"] = "full";
  if (language !== source) {
    const states = translationStatus(form, language).items.map((i) => shows(i.state));
    coverage = states.length && states.every(Boolean) ? "full" : states.some(Boolean) ? "partial" : "none";
  }
  const languages = [source, ...addedLanguages(form).filter((l) => translationStatus(form, l).items.some((i) => shows(i.state)))];
  return {
    language,
    source,
    coverage,
    languages,
    title: pick({ kind: "title", path: "" }, form.title),
    section: (path, text) => pick({ kind: "section", path }, text),
    label: (pointer, text) => pick({ kind: "label", path: pointer }, text),
    help: (pointer, text) => pick({ kind: "help", path: pointer }, text),
    option: (pointer, value) => pick({ kind: "option", path: pointer, option: value }, value),
  };
}

// ------------------------------------------------------------------------------------- editing

/** Sets (or, with an empty text, removes) one translation. A text a person writes is reviewed and stamped with today's source. */
export function setTranslation(translations: FormTranslations | undefined, language: FormLanguage, unit: Pick<TranslatableText, "kind" | "path" | "option" | "source">, text: string, opts: { draft?: boolean } = {}): FormTranslations {
  const next: FormTranslations = JSON.parse(JSON.stringify(translations ?? {})) as FormTranslations;
  const tr: FormTranslation = (next[language] ??= {});
  const value: TranslatedText | undefined = text.trim() ? { text, source: unit.source, ...(opts.draft ? { draft: true as const } : {}) } : undefined;
  const field = () => ((tr.fields ??= {})[unit.path] ??= {});
  switch (unit.kind) {
    case "title":
      if (value) tr.title = value;
      else delete tr.title;
      break;
    case "section":
      if (value) (tr.sections ??= {})[unit.path] = value;
      else delete tr.sections?.[unit.path];
      break;
    case "label":
    case "help":
      if (value) field()[unit.kind] = value;
      else delete tr.fields?.[unit.path]?.[unit.kind];
      break;
    case "option":
      if (unit.option === undefined) break;
      if (value) (field().options ??= {})[unit.option] = value;
      else delete tr.fields?.[unit.path]?.options?.[unit.option];
      break;
  }
  return next;
}

/** "Still correct": a stale translation is kept as it is and stamped with today's source; a draft becomes reviewed. */
export function confirmTranslation(translations: FormTranslations | undefined, language: FormLanguage, unit: Pick<TranslatableText, "kind" | "path" | "option" | "source">): FormTranslations {
  const entry = entryOf(translations?.[language], unit);
  return entry ? setTranslation(translations, language, unit, entry.text) : JSON.parse(JSON.stringify(translations ?? {}));
}

/**
 * The translations a form can hold today: entries for texts it no longer has are dropped (a removed
 * field, a section that moved, an option taken out), and so is a language equal to the form's own.
 * Stale entries are kept, so the funder sees what needs updating.
 */
export function normalizeTranslations(form: Pick<FormDefinition, "title" | "jsonSchema" | "uiSchema" | "translations">): FormTranslations {
  const source = sourceLanguageOf(form);
  const out: FormTranslations = form.translations?.source ? { source } : {};
  const units = translatableTexts(form);
  for (const language of addedLanguages(form)) {
    let next: FormTranslations = { [language]: {} };
    for (const u of units) {
      const entry = entryOf(form.translations?.[language], u);
      if (entry && nonEmpty(entry.text)) next = setTranslation(next, language, { ...u, source: entry.source }, entry.text, { draft: entry.draft === true });
    }
    out[language] = prune(next[language] ?? {});
  }
  return out;
}

/** Removes empty containers. */
function prune(tr: FormTranslation): FormTranslation {
  const out: FormTranslation = {};
  if (tr.title) out.title = tr.title;
  if (tr.sections && Object.keys(tr.sections).length) out.sections = tr.sections;
  const fields: Record<string, FieldTranslation> = {};
  for (const [path, f] of Object.entries(tr.fields ?? {})) {
    const ft: FieldTranslation = {};
    if (f.label) ft.label = f.label;
    if (f.help) ft.help = f.help;
    if (f.options && Object.keys(f.options).length) ft.options = f.options;
    if (Object.keys(ft).length) fields[path] = ft;
  }
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}

// ---------------------------------------------------------------------------------- validation

type Err = (path: string, message: string) => void;
const escapeKey = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

function checkText(v: Json | undefined, path: string, err: Err): void {
  if (!isPlainObject(v)) return err(path, "must be { text, source }");
  for (const k of Object.keys(v)) if (k !== "text" && k !== "source" && k !== "draft") err(`${path}/${k}`, "is not an expected field");
  for (const k of ["text", "source"] as const) {
    const s = v[k];
    if (typeof s !== "string") err(`${path}/${k}`, "must be text");
    else if (s.length > MAX_TRANSLATED_TEXT) err(`${path}/${k}`, `must be at most ${MAX_TRANSLATED_TEXT} characters`);
  }
  if (v.draft !== undefined && v.draft !== true) err(`${path}/draft`, "must be true or left out");
}

function checkMap(v: Json | undefined, path: string, err: Err, each: (item: Json | undefined, at: string) => void): void {
  if (v === undefined) return;
  if (!isPlainObject(v)) return err(path, "must be an object");
  for (const [k, item] of Object.entries(v)) each(item, `${path}/${escapeKey(k)}`);
}

function checkFields(v: Json | undefined, allowed: readonly string[], path: string, err: Err): v is { [key: string]: Json } {
  if (!isPlainObject(v)) {
    err(path, "must be an object");
    return false;
  }
  for (const k of Object.keys(v)) if (!allowed.includes(k)) err(`${path}/${k}`, "is not an expected field");
  return true;
}

/** Checks the languages of a translations object; `each` checks one language's texts. */
function checkLanguages(raw: unknown, each: (value: { [key: string]: Json }, path: string, err: Err) => void): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const err: Err = (path, message) => errors.push({ path: `translations${path}`, message });
  if (raw === undefined || raw === null) return errors;
  if (!isPlainObject(raw)) return [{ path: "translations", message: "must be an object" }];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "source") {
      if (!isFormLanguage(value)) err("/source", `must be one of ${FORM_LANGUAGES.join(", ")}`);
    } else if (!isFormLanguage(key)) err(`/${escapeKey(key)}`, `is not a language this server offers (${FORM_LANGUAGES.join(", ")})`);
    else if (isPlainObject(value)) each(value, `/${key}`, err);
    else err(`/${key}`, "must be an object");
  }
  return errors;
}

/** Save-time checks of a form's stored translations object. */
export function validateTranslations(raw: unknown): DefinitionError[] {
  return checkLanguages(raw, (value, path, err) => {
    checkFields(value, ["title", "sections", "fields"], path, err);
    if (value.title !== undefined) checkText(value.title, `${path}/title`, err);
    checkMap(value.sections, `${path}/sections`, err, (item, at) => checkText(item, at, err));
    checkMap(value.fields, `${path}/fields`, err, (field, at) => {
      if (!checkFields(field, ["label", "help", "options"], at, err)) return;
      if (field.label !== undefined) checkText(field.label, `${at}/label`, err);
      if (field.help !== undefined) checkText(field.help, `${at}/help`, err);
      checkMap(field.options, `${at}/options`, err, (item, o) => checkText(item, o, err));
    });
  });
}

/** Drafts by the assistant that a person has not reviewed yet: publishing waits for them. */
export function unreviewedDrafts(form: Pick<FormDefinition, "title" | "jsonSchema" | "uiSchema" | "translations">): DefinitionError[] {
  return addedLanguages(form).flatMap((language) =>
    translationStatus(form, language)
      .items.filter((i) => i.state === "draft")
      .map((i) => ({ path: `translations/${language}/${i.kind}${i.path ? formatPointer(parsePointer(i.path)) : ""}${i.option !== undefined ? `/${i.option}` : ""}`, message: `the assistant's ${i.kind === "option" ? "option label" : i.kind} draft must be reviewed before the form is published` })),
  );
}

// ------------------------------------------------------------------------------- opportunities

/** An opportunity's public text in another language: its title, summary and eligibility labels. */
export interface OpportunityTranslation {
  title?: TranslatedText;
  description?: TranslatedText;
  /** An eligibility rule's label, by the label as the funder wrote it. */
  eligibility?: Record<string, TranslatedText>;
}
export type OpportunityTranslations = { source?: FormLanguage } & { [L in FormLanguage]?: OpportunityTranslation };

/** The opportunity's title, summary and eligibility labels in `language`, each falling back to the funder's own. */
export function opportunityText(o: { title: string; description: string; eligibility: readonly string[] }, translations: OpportunityTranslations | null | undefined, language: FormLanguage) {
  const source = isFormLanguage(translations?.source) ? translations.source : DEFAULT_FORM_LANGUAGE;
  const tr = language === source ? undefined : translations?.[language];
  const pick = (entry: TranslatedText | undefined, text: string): ShownText => (tr && textState(entry, text) === "done" ? { text: entry!.text, lang: language } : { text, lang: source });
  const title = pick(tr?.title, o.title);
  const description = o.description.trim() ? pick(tr?.description, o.description) : { text: o.description, lang: source };
  const eligibility = o.eligibility.map((label) => pick(tr?.eligibility?.[label], label));
  const shown = [title, ...(o.description.trim() ? [description] : []), ...eligibility];
  const coverage = language === source || shown.every((s) => s.lang === language) ? "full" : shown.some((s) => s.lang === language) ? "partial" : "none";
  return { language, source, coverage: coverage as FormText["coverage"], title, description, eligibility };
}

/** How far an opportunity's text in `language` has come (title, summary, each eligibility label). */
export function opportunityTranslationStatus(o: { title: string; description: string; eligibility: readonly string[] }, translations: OpportunityTranslations | null | undefined, language: FormLanguage) {
  const tr = translations?.[language];
  const items = [
    { kind: "title" as const, key: "", source: o.title, entry: tr?.title },
    ...(o.description.trim() ? [{ kind: "description" as const, key: "", source: o.description, entry: tr?.description }] : []),
    ...[...new Set(o.eligibility)].filter(nonEmpty).map((label) => ({ kind: "eligibility" as const, key: label, source: label, entry: tr?.eligibility?.[label] })),
  ].map(({ entry, ...i }) => ({ ...i, state: textState(entry, i.source), text: entry?.text ?? "", ...(entry && textState(entry, i.source) === "stale" ? { was: entry.source } : {}) }));
  const count = (s: TextState) => items.filter((i) => i.state === s).length;
  return { language, total: items.length, done: count("done"), missing: count("missing"), stale: count("stale"), drafts: count("draft"), complete: items.length > 0 && count("done") === items.length, items };
}

/** Save-time checks of an opportunity's translations. */
export function validateOpportunityTranslations(raw: unknown): DefinitionError[] {
  return checkLanguages(raw, (value, path, err) => {
    checkFields(value, ["title", "description", "eligibility"], path, err);
    if (value.title !== undefined) checkText(value.title, `${path}/title`, err);
    if (value.description !== undefined) checkText(value.description, `${path}/description`, err);
    checkMap(value.eligibility, `${path}/eligibility`, err, (item, at) => checkText(item, at, err));
  });
}
