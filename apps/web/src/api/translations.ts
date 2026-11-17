// SPDX-License-Identifier: AGPL-3.0-only
// "Draft with the assistant" for a funder's translations (docs/forms.md, "Languages"): drafts for
// the texts of a form's draft version, or of an opportunity's title, summary and eligibility
// labels, that are not translated yet. Nothing is saved: the builder shows each one as the
// assistant's draft for a person to review. Each call counts against the workspace's monthly
// assistant quota. `createHttpTranslationsApi` calls the GMS Worker (api/translations.tsp);
// `createMockTranslationsApi` (mocks/translations.ts) answers the same interface in the browser.
import type { FormLanguage, TextKind } from "@gms/forms";
import { ApiError } from "./client.ts";
import type { AssistQuota } from "./funderFull.ts";

export interface FormTextDraft {
  kind: TextKind;
  /** "" for the title, the layout's UI-schema path for a section, the field's pointer otherwise. */
  path: string;
  option?: string;
  source: string;
  text: string;
}
export interface OpportunityTextDraft {
  kind: "title" | "description" | "eligibility";
  /** For an eligibility label: the label as written. */
  key: string;
  source: string;
  text: string;
}
interface DraftBase {
  draft: true;
  language: FormLanguage;
  /** Texts left for another call. */
  remaining: number;
  /** Null when there was nothing to translate (no call was made). */
  model: string | null;
  quota: AssistQuota | null;
}
export interface FormTranslationDraft extends DraftBase {
  items: FormTextDraft[];
}
export interface OpportunityTranslationDraft extends DraftBase {
  items: OpportunityTextDraft[];
}

export interface TranslationsApi {
  /** 404 when the assistant is off, 409 for a published version, 429 when the month's quota is spent. */
  draftForm(workspaceId: string | null, formId: string, language: FormLanguage): Promise<FormTranslationDraft>;
  draftOpportunity(workspaceId: string | null, opportunityId: string, language: FormLanguage): Promise<OpportunityTranslationDraft>;
}

export interface HttpTranslationsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpTranslationsApi(opts: HttpTranslationsOptions): TranslationsApi {
  async function call<T>(path: string, workspaceId: string | null, body: unknown): Promise<T> {
    const token = await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  const e = encodeURIComponent;
  return {
    draftForm: (workspaceId, formId, language) => call(`/gms/translations/forms/${e(formId)}/draft`, workspaceId, { language }),
    draftOpportunity: (workspaceId, opportunityId, language) => call(`/gms/translations/opportunities/${e(opportunityId)}/draft`, workspaceId, { language }),
  };
}
