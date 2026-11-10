// SPDX-License-Identifier: AGPL-3.0-only
// How the application editor keeps several people's edits apart. Each client remembers the last
// response the server gave it (the baseline) and sends only the paths that differ from it. When a
// newer server response arrives, from its own save or because someone else saved, local edits that
// have not been sent yet are replayed on top, so nobody's typing is overwritten.
import { collectControls, mergeResponse, scopeToPointer, type FormDefinition, type JsonObject, type UiElement, type UiLayout, type ValidationError } from "@gms/forms";
import { changedPaths } from "../../api/applicant.ts";

/** The response to show after the server answered: its merged state plus edits made since `sent`. */
export function rebase(server: JsonObject, sent: JsonObject, local: JsonObject): JsonObject {
  const pending = changedPaths(sent, local);
  return pending ? mergeResponse(server, pending).response : server;
}

/** What to send: the paths where `local` differs from the last server response; null when nothing changed. */
export const patchFor = (baseline: JsonObject, local: JsonObject): JsonObject | null => changedPaths(baseline, local);

export interface Section {
  label: string;
  /** JSON pointers of the controls inside the section. */
  paths: string[];
}

/** The top-level groups of a form, in order. A form without groups is one section named after it. */
export function sectionsOf(form: FormDefinition): Section[] {
  const out: Section[] = [];
  const walk = (el: UiElement) => {
    if (el.type === "Control") return;
    const layout = el as UiLayout;
    if ((layout.type === "Group" || layout.type === "Category") && layout.label) {
      out.push({ label: layout.label, paths: collectControls(layout).map((c) => scopeToPointer(c.scope)) });
      return;
    }
    layout.elements.forEach(walk);
  };
  walk(form.uiSchema);
  if (!out.length) out.push({ label: form.title, paths: collectControls(form.uiSchema).map((c) => scopeToPointer(c.scope)) });
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

/** The label a person sees for a field path, from the form's schema titles. */
export function fieldLabel(form: FormDefinition, path: string): string {
  const key = path.replace(/^\//, "").split("/")[0] ?? "";
  const title = form.jsonSchema.properties?.[key]?.title;
  return typeof title === "string" && title ? title : key || "This form";
}

/** The section a field path belongs to. */
export const sectionFor = (sections: Section[], path: string): Section | undefined => sections.find((s) => s.paths.some((p) => under(path, p)));
