import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;

// v1.12.0: bilingual funder forms and opportunity text (docs/forms.md, "Languages"). A form version
// may carry the funder's text in a second language (title, section titles, field labels, help,
// option labels), and an opportunity its title, summary and eligibility labels. The canonical
// fields keep the funder's own language; CommonGrants records carry the other language in
// `customFields.translations` only. Each text keeps the source it translates, so a reworded source
// is flagged and readers get the source text until it is updated. The assistant can draft
// translations; its drafts are never saved by these routes, a form holding an unreviewed one
// cannot be published, and an opportunity never stores one.

namespace GMS.Models {
  union TranslationLanguage {
    en: "en",
    es: "es",
  }

  /** One text in another language, with the source text it translates. */
  model TranslatedText {
    text: string;

    /** The source text as it was when this was translated; a different source today makes this stale. */
    source: string;

    /** The assistant's draft, not yet reviewed. A form holding one cannot be published (422). */
    draft?: true;
  }

  model FieldTranslation {
    label?: TranslatedText;
    help?: TranslatedText;

    /** A choice's label (a select's option, a budget table's category), by its stored value. Answers stay the stored value. */
    options?: Record<TranslatedText>;
  }

  model FormTranslation {
    title?: TranslatedText;

    /** Section titles, by the layout's place in the UI schema ("/elements/0"). */
    sections?: Record<TranslatedText>;

    /** By the field's JSON pointer into the response ("/projectTitle"). */
    fields?: Record<FieldTranslation>;
  }

  /** A form version's text in other languages, keyed by language. Part of the version: published and copied with it. */
  model FormTranslations {
    /** The language the form itself is written in; English when absent. */
    source?: TranslationLanguage;

    en?: FormTranslation;
    es?: FormTranslation;
  }

  model OpportunityTranslation {
    title?: TranslatedText;

    /** The summary (the opportunity's `description`). */
    description?: TranslatedText;

    /** An eligibility rule's label, by the label as written. */
    eligibility?: Record<TranslatedText>;
  }

  /** An opportunity's title, summary and eligibility labels in other languages. Never holds an assistant draft. */
  model OpportunityTranslations {
    source?: TranslationLanguage;
    en?: OpportunityTranslation;
    es?: OpportunityTranslation;
  }

  model TranslationDraftRequest {
    /** The language to draft into; not the record's own. */
    language: TranslationLanguage;
  }

  /** A drafted form text. `path` is "" for the title, the layout's UI-schema path for a section, the field's pointer otherwise. */
  model FormTextDraft {
    kind: "title" | "section" | "label" | "help" | "option";
    path: string;

    /** For an option: its stored value. */
    option?: string;

    source: string;
    text: string;
  }

  /** `POST /gms/translations/forms/{formId}/draft`: drafts for the texts not translated yet. Nothing was saved. */
  model FormTranslationDraft {
    draft: true;
    language: TranslationLanguage;
    items: FormTextDraft[];

    /** Texts left for another call (one call drafts at most 120). */
    remaining: int32;

    /** Null when nothing needed translating (no call was made). */
    `model`: string | null;

    quota: AssistQuota | null;
  }

  model OpportunityTextDraft {
    kind: "title" | "description" | "eligibility";

    /** For an eligibility label: the label as written. */
    key: string;

    source: string;
    text: string;
  }

  model OpportunityTranslationDraft {
    draft: true;
    language: TranslationLanguage;
    items: OpportunityTextDraft[];
    remaining: int32;
    `model`: string | null;
    quota: AssistQuota | null;
  }
}

namespace GMS.Routes.Custom {
  @tag("Translations")
  namespace Translations {
    /**
     * Drafts, with the assistant, the texts of the form's current draft version that are not
     * translated into `language` yet or whose source changed. Saves nothing; counts against the
     * workspace's monthly assistant quota (429 `assist_quota_exhausted`). 404 `assistant_disabled`
     * when the assistant is off; 409 `form_published` for a published version (start the next one);
     * 422 for the form's own language.
     */
    @post @route("/translations/forms/{formId}/draft") @useAuth(GmsOAuth<["assist", "forms:write"]> | UserSession)
    op draftForm(@path formId: GmsId, @body body: TranslationDraftRequest): OkT<FormTranslationDraft> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | TooManyRequests;

    /** The same for an opportunity's title, summary and eligibility labels. The drafts must be reviewed before they are saved. */
    @post @route("/translations/opportunities/{oppId}/draft") @useAuth(GmsOAuth<["assist", "opportunities:write"]> | UserSession)
    op draftOpportunity(@path oppId: GmsId, @body body: TranslationDraftRequest): OkT<OpportunityTranslationDraft> | BadRequest | AuthErrors | NotFound | Unprocessable | TooManyRequests;
  }
}
