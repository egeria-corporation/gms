// SPDX-License-Identifier: AGPL-3.0-only
// How the application editor keeps several people's edits apart. Each client remembers the last
// response the server gave it (the baseline) and sends only the paths that differ from it. When a
// newer server response arrives, from its own save or because someone else saved, local edits that
// have not been sent yet are replayed on top, so nobody's typing is overwritten.
import { collectControls, deepEqual, formText, isFormLanguage, mergeResponse, scopeToPointer, sourceLanguageOf, translatableTexts, type FormDefinition, type FormLanguage, type FormText, type Json, type JsonObject, type ShownText, type UiElement, type UiLayout, type UiRule, type ValidationError } from "@gms/forms";
import { changedPaths } from "../../api/applicant.ts";
import { getLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

/** The language a funder's form text is read in: the page's where the form can be in it, else the form's own (as FormView). */
export const readerLanguage = (form: Pick<FormDefinition, "translations">): FormLanguage => {
  const page = getLocale();
  return isFormLanguage(page) ? page : sourceLanguageOf(form);
};

const shownTexts = new WeakMap<FormDefinition, Map<FormLanguage, FormText>>();
/** The form's title, section titles and labels in a language where the funder translated them, else as written (docs/forms.md, Languages). */
export function formTextIn(form: FormDefinition, language: FormLanguage = readerLanguage(form)): FormText {
  let byLanguage = shownTexts.get(form);
  if (!byLanguage) shownTexts.set(form, (byLanguage = new Map()));
  let text = byLanguage.get(language);
  if (!text) byLanguage.set(language, (text = formText(form, language)));
  return text;
}

/** The response to show after the server answered: its merged state plus edits made since `sent`. */
export function rebase(server: JsonObject, sent: JsonObject, local: JsonObject): JsonObject {
  const pending = changedPaths(sent, local);
  return pending ? mergeResponse(server, pending).response : server;
}

/** What to send: the paths where `local` differs from the last server response; null when nothing changed. */
export const patchFor = (baseline: JsonObject, local: JsonObject): JsonObject | null => changedPaths(baseline, local);

export interface Section {
  /** The funder's own words: the key teammates share (who is in which section), whatever language each reads. */
  label: string;
  /** What the reader sees: the section's title in their language where translated, as FormView draws it. */
  shown: ShownText;
  /** JSON pointers of the controls inside the section. */
  paths: string[];
}

/** The top-level groups of a form, in order. A form without groups is one section named after it. */
export function sectionsOf(form: FormDefinition, language: FormLanguage = readerLanguage(form)): Section[] {
  const text = formTextIn(form, language);
  const out: Section[] = [];
  // Paths as FormView and the translations name a layout: "" for the root, then /elements/{i}.
  const walk = (el: UiElement, path: string) => {
    if (el.type === "Control") return;
    const layout = el as UiLayout;
    if ((layout.type === "Group" || layout.type === "Category") && layout.label) {
      out.push({ label: layout.label, shown: text.section(path, layout.label), paths: collectControls(layout).map((c) => scopeToPointer(c.scope)) });
      return;
    }
    layout.elements.forEach((child, i) => walk(child, `${path}/elements/${i}`));
  };
  walk(form.uiSchema, "");
  if (!out.length) out.push({ label: form.title, shown: text.title, paths: collectControls(form.uiSchema).map((c) => scopeToPointer(c.scope)) });
  return out;
}

const under = (field: string, path: string) => field === path || field.startsWith(`${path}/`);

export type SectionState = "done" | "prog" | "todo";

export function sectionState(section: Section, response: JsonObject, errors: ValidationError[]): { state: SectionState; problems: ValidationError[] } {
  const problems = errors.filter((e) => section.paths.some((p) => under(e.field, p)));
  const answered = section.paths.some((p) => {
    const v = response[p.slice(1).split("/")[0]!];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  return { state: problems.length === 0 ? "done" : answered ? "prog" : "todo", problems };
}

/**
 * The label a person sees for a field path: the label FormView draws for it, in the reader's
 * language where the funder translated it, else as the funder wrote it (with its language, so a
 * screen can mark it, WCAG 3.1.2).
 */
export function fieldLabelShown(form: FormDefinition, path: string): ShownText {
  const key = path.replace(/^\//, "").split("/")[0] ?? "";
  if (!key) return { text: t("editor.thisForm"), lang: getLocale() };
  const pointer = `/${key}`;
  const title = form.jsonSchema.properties?.[key]?.title;
  const source = translatableTexts(form).find((x) => x.kind === "label" && x.path === pointer)?.source ?? (typeof title === "string" && title ? title : key);
  return formTextIn(form).label(pointer, source);
}

export const fieldLabel = (form: FormDefinition, path: string): string => fieldLabelShown(form, path).text;

/** The form's title as the reader sees it (their language where translated). */
export const formTitleShown = (form: FormDefinition): ShownText => formTextIn(form).title;

/** The section a field path belongs to. */
export const sectionFor = (sections: Section[], path: string): Section | undefined => sections.find((s) => s.paths.some((p) => under(path, p)));

// ------------------------------------------------------------------------------------ live co-editing
// (lib/presence.ts, docs/co-editing.md). A question is a top-level answer: presence, soft locks and
// "changed this" notes speak of `/<key>`, whatever lies beneath it (a budget's lines).

/** The question a field path belongs to: `/budget/lines/0/amount` → `/budget`. */
export const questionOf = (path: string): string => `/${path.replace(/^\//, "").split("/")[0] ?? ""}`;

const ALWAYS_DISABLED: UiRule = { effect: "DISABLE", condition: { scope: "#", schema: {} } };
const withLocksCache = new WeakMap<FormDefinition, Map<string, FormDefinition>>();
/**
 * The form with the questions someone else is typing in shown read-only (the soft lock): each
 * such control sits in a layout whose rule always disables it, which the renderer already honours.
 * The form's own rules, paths and translations are unchanged. Memoized per form and set of locks.
 */
export function withLocks(form: FormDefinition, locked: readonly string[]): FormDefinition {
  if (!locked.length) return form;
  const key = [...locked].sort().join("\n");
  let byKey = withLocksCache.get(form);
  if (!byKey) withLocksCache.set(form, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const set = new Set(locked);
  const walk = (el: UiElement): UiElement => {
    if (el.type === "Control") return set.has(questionOf(scopeToPointer(el.scope))) ? { type: "VerticalLayout", rule: ALWAYS_DISABLED, elements: [el] } : el;
    return { ...el, elements: el.elements.map(walk) };
  };
  const out = { ...form, uiSchema: walk(form.uiSchema) };
  byKey.set(key, out);
  return out;
}

/** The questions both sides changed since `base` and now differ: this person's unsaved edit and someone else's save. */
export function conflictsOf(base: JsonObject, theirs: JsonObject, mine: JsonObject): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(theirs), ...Object.keys(mine)]);
  return [...keys].filter((k) => !deepEqual(base[k], theirs[k]) && !deepEqual(base[k], mine[k]) && !deepEqual(theirs[k], mine[k])).map((k) => `/${k}`);
}

/** What someone else's save just changed: each question and the value it had before, kept briefly. */
export interface RecentChange {
  at: number;
  before: Map<string, Json | undefined>;
}
/** How long a change from someone else is guarded against a stale copy of the form (one frame is the risk; this is generous). */
export const RECENT_CHANGE_MS = 2_000;

/**
 * Keeps someone else's just-saved answer when the form hands back a copy made before it arrived.
 * The renderer takes a new response from the editor in an effect; a keystroke landing in that
 * frame comes back from the older copy, with the other person's question at its old value. A
 * question this person is not in, changed by someone else within RECENT_CHANGE_MS, and returned
 * exactly as it was before that change, keeps the value on screen instead. Everything else (the
 * question being typed in, an upload finishing) is taken as it comes.
 */
export function keepOthersChanges(current: JsonObject, next: JsonObject, recent: RecentChange | undefined, typingIn: string | null, now: number): JsonObject {
  if (!recent || now - recent.at > RECENT_CHANGE_MS) return next;
  let out = next;
  for (const [question, before] of recent.before) {
    if (question === typingIn) continue;
    const k = question.slice(1);
    if (!deepEqual(next[k], before) || deepEqual(current[k], before)) continue;
    out = out === next ? { ...next } : out;
    if (current[k] === undefined) delete out[k];
    else out[k] = current[k] as Json;
  }
  return out;
}
