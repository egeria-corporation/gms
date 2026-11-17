// SPDX-License-Identifier: AGPL-3.0-only
// The translation-drafting port in the browser (api/translations.ts). It drafts from a small
// phrase list (the fixture forms' Spanish); a text it does not know comes back as written, still
// marked as a draft for the funder to rewrite. Like the API, it
// saves nothing, refuses a published version, and answers 404 while the mock assistant is off.
import { opportunityTranslationStatus, sourceLanguageOf, translationStatus, type FormLanguage } from "@gms/forms";
import type { Rule } from "@gms/rules";
import { ApiError, type GmsApi } from "../api/client.ts";
import type { FormTranslationDraft, OpportunityTranslationDraft, TranslationsApi } from "../api/translations.ts";
import { LOI_SPANISH } from "./forms.ts";

/** Spanish for the fixture forms and calls (fixture text, not the catalogs). */
const PHRASES: Readonly<Record<string, string>> = { ...LOI_SPANISH, "Full proposal": "Propuesta completa", "Community Health Grants 2027": "Subvenciones de Salud Comunitaria 2027" };
const spanish = (text: string) => PHRASES[text] ?? text;

function labelsOf(rule: Rule | null | undefined, out: string[] = []): string[] {
  if (!rule) return out;
  if ("all" in rule) rule.all.forEach((r) => labelsOf(r, out));
  else if ("any" in rule) rule.any.forEach((r) => labelsOf(r, out));
  else if (rule.label?.trim() && !out.includes(rule.label)) out.push(rule.label);
  return out;
}

export function createMockTranslationsApi(opts: { api: GmsApi }): TranslationsApi {
  const status = async () => {
    const s = await opts.api.assistStatus();
    if (!s.enabled) throw new ApiError(404, "The drafting assistant is not enabled on this server");
    return s;
  };
  const translate = (text: string, to: FormLanguage) => (to === "es" ? spanish(text) : (Object.entries(PHRASES).find(([, es]) => es === text)?.[0] ?? text));
  return {
    async draftForm(_workspaceId, formId, language): Promise<FormTranslationDraft> {
      const s = await status();
      const form = await opts.api.getForm(formId);
      if (form.status === "published") throw new ApiError(409, `Version ${form.version} is published and cannot change. Create version ${form.version + 1} to translate it`);
      if (sourceLanguageOf(form) === language) throw new ApiError(422, "This form is already written in that language");
      const todo = translationStatus(form, language).items.filter((i) => i.state === "missing" || i.state === "stale");
      const items = todo.map((i) => ({ kind: i.kind, path: i.path, ...(i.option !== undefined ? { option: i.option } : {}), source: i.source, text: translate(i.source, language) }));
      return { draft: true, language, items, remaining: 0, model: items.length ? "mock-assistant" : null, quota: items.length ? s.quota : null };
    },
    async draftOpportunity(_workspaceId, opportunityId, language): Promise<OpportunityTranslationDraft> {
      const s = await status();
      const o = await opts.api.getOpportunity(opportunityId);
      const todo = opportunityTranslationStatus({ title: o.title, description: o.description, eligibility: labelsOf(o.eligibilityRules) }, o.translations, language).items.filter((i) => i.state !== "done");
      const items = todo.map((i) => ({ kind: i.kind, key: i.key, source: i.source, text: translate(i.source, language) }));
      return { draft: true, language, items, remaining: 0, model: items.length ? "mock-assistant" : null, quota: items.length ? s.quota : null };
    },
  };
}
