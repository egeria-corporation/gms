# Form engine (`@gms/forms`)

Build spec §10.2. One engine for applications, LOIs, reports, amendments and site visits. A form is a
CommonGrants `FormBase`: a JSON Schema (2020-12, restricted subset), a JSON Forms-style UI schema,
and two CommonGrants mappings. This package is framework-free; the React renderer in `apps/web` and
the API in `apps/api` both call it.

## Schema subset

`checkSchemaSubset(schema)` runs at save time and returns path-qualified errors (`#/properties/a/format`).
The root must be `type: "object"`.

| Allowed | Notes |
|---|---|
| `type` | `object`, `string`, `number`, `integer`, `boolean`, `array` (a single type, never a list) |
| `properties`, `required`, `additionalProperties` | `additionalProperties` is boolean only |
| `enum`, `const` | |
| strings | `format` (`email`, `uri`, `date`, `date-time`, `phone`), `minLength`, `maxLength`, `pattern`, `x-wordCount` |
| numbers | `minimum`, `maximum` |
| arrays | `items` must be an object (repeating group) or a string with `enum` (multi-select); `minItems`, `maxItems`, `uniqueItems` |
| conditionals | `if` / `then` / `else` |
| `$ref`, `$defs` | references inside the document only |
| annotations | `title`, `description`, `default`, `examples`, `$schema`, `$id` |
| extensions | `x-widget`, `x-widgetOptions`, `x-wordCount` |

Everything else (`oneOf`, `anyOf`, `not`, `patternProperties`, `exclusiveMinimum`, type lists, …) is rejected.

## Widgets

Widgets are declared on the UI control (`options.widget`, `options.widgetOptions`) or directly on the
schema property (`x-widget`, `x-widgetOptions`). `effectiveSchema(form)` folds the UI declarations
into the schema, so validation has one path.

| Widget | Value | Validation |
|---|---|---|
| `money` | CG `Money` `{ amount: "25000.00", currency: "USD" }` | decimal string, not negative, ISO currency, `widgetOptions.currency` fixes the currency |
| `budgetTable` | `[{ category, label?, amount: Money, notes? }]` | categories from `widgetOptions.categories`, one currency, total ≤ `maxTotal` and ≤ the value at `maxTotalPath` (for example `/requestedAmount`). Totals: `computeBudgetTotals` |
| `fileRef` | `{ documentId }` or `{ passportDocumentId }` (+ `name`) | exactly one reference; a locker reference is never copied |
| `richText` | HTML string | must already be inside the allowed subset; `sanitizeRichText` produces it |
| `passportField` | any | read-only: prefill always overwrites it and `mergeResponse` rejects edits (`passportFieldPaths`) |
| `signature` | `{ name, attested: true }` | typed name and checked attestation |
| `address` | `{ line1, line2?, city, region?, postalCode?, country }` | `line1`, `city`, `country` required |
| `phone` | string | 7–15 digits, common punctuation |
| word limits | `x-wordCount: { min?, max? }` on a string | counts words, ignoring markup |

Rich text allows `p br strong b em i u ul ol li a[href] h3 h4 blockquote`; `href` must be `http(s)` or
`mailto`. Scripts, styles, iframes, comments, event handlers and every other attribute are dropped.

## UI schema

Elements: `VerticalLayout`, `HorizontalLayout`, `Group` (label), `Categorization` → `Category` (label),
`Control` (`scope: "#/properties/…"`). A `rule` has an `effect` (`SHOW`, `HIDE`, `ENABLE`, `DISABLE`)
and a JSON Forms condition `{ scope, schema }`; a rule on a layout cascades to its controls. An
unanswered condition field never matches. Control `options`: `widget`, `widgetOptions`, `placeholder`,
`help`, `reviewerVisible` (default true), `pii` (default false), `identifying` (default false: the
answer says who applied, so it is hidden from reviewers in a stage with anonymized review; see
docs/reviews.md).

- `validateUiSchema(ui, jsonSchema)` — save-time errors.
- `evaluateUi(ui, response)` → `{ controls, hidden, disabled }` for the renderer and the validator.

## Validation

`validateResponse(form, response)` → `{ valid, validationErrors }` with CommonGrants entries
`{ field, message, type }`; `field` is a JSON pointer (`/budget/0/amount/currency`). Fields hidden by a
UI rule are neither required nor validated.

**Engine.** Cloudflare Workers forbid runtime code generation, which Ajv needs to compile a schema, and
forms are authored at runtime, so the validator is a small interpreter for the subset
(`validateAgainstSchema`). `@gms/forms/ajv` exports `createAjv()`: Ajv 2020 with the same widget
keywords and formats, for Node tooling. The test suite compiles the fixture form with Ajv and checks
the interpreter agrees on validity and that every interpreter error is also an Ajv error.

## Mappings

CommonGrants `MappingSchema`: a nested object whose leaves are `{ field }`, `{ const }` or
`{ switch: { field, case, default } }`. `field` accepts a CG dot path (`addresses.primary.city`) or a
JSON pointer.

- **Prefill** — `mappingFromCommonGrants` is shaped like the response and reads from
  `buildPrefillSource(org, profile)` (the cached `OrganizationBase`, with the consented Passport
  profile under `profile`). `prefill(form, source, { response, provenance })` writes a value when the
  field is empty, was prefilled from Passport before, or is a `passportField`, and sets
  `provenance[path] = "passport"`. Values from a user, an agent, the library or a prior submission are
  never overwritten; they are listed in `skipped`. `PREFILL_PATHS` is the builder's picker list: paths
  into that source in Passport's own shapes, e.g. `name`, `identifiers.org:us:ein.id`,
  `addresses.primary.stateOrProvince`, `phones.primary.number`, `customFields.verificationLevel.value`,
  and for the profile `profile.commonApp.financials.totalRevenue`, `profile.commonApp.staffCount`,
  `profile.commonApp.irs.subsection`. Each offered path ends at a scalar. Note that CommonGrants
  `yearFounded` is a four-digit string. `docs/rules.md` lists the same vocabulary for eligibility rules.
- **Project-back** — `mappingToCommonGrants` is shaped like the CommonGrants output and reads from the
  response. `projectToCommonGrants(form, response)` then `extractSubmissionFields(projected)` gives
  `title` (from `name`), `requestedAmount` (top level or `customFields.requestedAmount.value`),
  `applicantType` and the declared `customFields`.
- `validateMappings(form)` — targets and sources must be form fields.

## Responses

- `mergeResponse(current, patch, { provenance, actor, lockedPaths })` — `PUT …/forms/{formId}`
  semantics: objects merge, arrays and scalars replace, `null` removes. Changed fields take the actor's
  provenance (`user` or `agent:<client>`).
- `computeResponseStatus(form, response, provenance)` — `complete` when valid, `notStarted` when empty
  or holding only Passport prefill, else `inProgress`.
- `maskForReviewer(form, response, { external })` — removes `reviewerVisible: false` fields for every
  reviewer and masks `pii` fields for external reviewers. Flags come from control options overlaid with
  `form.fieldMeta` (`fieldMetaFor`).
- `identifyingFields(form)` — the fields that say who applied: controls marked `identifying` (in their
  options or `fieldMeta`), widgets that always carry identity (`IDENTIFYING_WIDGETS`: Passport fields,
  addresses, phones, signatures) and email fields. Anonymized review removes them for reviewers.

## Versioning

A published version is immutable (`assertEditable`). `publishForm` validates the definition and stamps
`publishedAt`; `nextDraft(published)` creates version + 1 with `supersedesFormVersion`. Changing a
pinned version on an open competition calls `migrateResponses(target, responses)`, which drops values
for removed fields, re-validates, and returns the new status and errors per response.

## Languages

A funder writes a form in one language (its **source**: English unless `translations.source` says
`"es"`) and may give the same text in the other one. Translations are part of a form version
(`FormDefinition.translations`, the `forms.translations` column, migration 0049): saved with the
draft, published with it, immutable once published, copied into the next draft.

```json
{
  "es": {
    "title": { "text": "Carta de intención", "source": "Letter of intent" },
    "sections": { "/elements/0": { "text": "Proyecto", "source": "Project" } },
    "fields": {
      "/projectType": {
        "label": { "text": "Tipo de proyecto", "source": "Project type" },
        "help": { "text": "Elija una.", "source": "Pick one." },
        "options": { "Direct service": { "text": "Servicio directo", "source": "Direct service" } }
      }
    }
  }
}
```

- **What is translated:** the form title, section titles (a `Group` or `Category` label, keyed by the
  layout's place in the UI schema), field labels, help text, and option labels (a select's or
  multi-select's options and a budget table's categories, keyed by the stored value).
  `translatableTexts(form)` lists them in reading order.
- **Each text keeps its source.** `textState(entry, source)` is `done` (current and reviewed),
  `missing`, `stale` (the source changed since it was translated) or `draft` (the assistant's,
  not reviewed). `translationStatus(form, language)` counts them; `complete` means every text is done.
- **Readers.** `formText(form, language)` gives each text in the reader's language when its
  translation is done, and otherwise the source text (`coverage`: `full`, `partial` or `none`).
  A stale or drafted translation is never shown to an applicant; the funder's own preview passes
  `{ drafts: true }`.
- **Answers are stored once.** A choice is always stored as its source value, whatever label the
  applicant read; validation is the same in every language, and its messages come from the catalogs
  (`form.error.*`), naming the field as the reader reads it.
- **Versions.** `nextDraft` copies the translations unchanged. A text the new draft rewords becomes
  `stale` and is flagged in the builder ("Needs updating", with the text it was translated from and
  "Still correct"); the others carry over. A stale translation does not block publishing; readers
  get the source text for it until it is updated.
- **The assistant** (`POST /gms/translations/forms/{formId}/draft`, `{ language }`) drafts the
  texts of the current draft version that are missing or stale, in one model call against the
  workspace's monthly quota (logged as `translate` in `assist_calls`). It saves nothing: the builder
  marks each draft, and `publishForm` refuses a version that still holds one (`unreviewedDrafts`).
- **Checks.** `validateTranslations` checks the shape at save (the API) and at publish;
  `normalizeTranslations` drops texts the form no longer has (a removed field, option or section)
  and keeps stale ones so they can be flagged.
- **CommonGrants.** The canonical `FormBase` fields keep the source language; the translations
  travel only in `customFields.translations` (`{ name, fieldType: "object", value }`), validated
  with the rest of the record (`projectForm` in `@gms/protocol`). Applicants read a form through
  `/common-grants/forms/{formId}`, which is how the Spanish reaches them.

**Where people see it.** The form builder's "Add Spanish" opens a Translate view: each text beside
its translation, a completeness indicator (icon and label), and "Draft with the assistant" when the
assistant is on; "Preview as applicant" can show either language. The renderer (`FormView`) shows
an applicant the form in their language where the funder gave it, otherwise as written with a note
("This form is in English, as the funder wrote it."), and marks a text in another language with its
`lang`. Reviewers and staff read the questions in their own language with a switch to the other.

**Opportunities.** The opportunity builder takes the title, summary and eligibility rule labels in
the other language the same way (`OpportunityTranslations`, stored as the opportunity's
`customFields.translations` custom field, so the CommonGrants `OpportunityBase` carries them in
`customFields` only). An assistant draft is reviewed in the builder before saving: the API refuses
one, because a published opportunity's text is public as soon as it is saved. The public page
(`GET /gms/public/funders/{handle}/opportunities/{slug}`) answers in the reader's language (`?lang=`,
the `gms_lang` cookie, Accept-Language; it varies on them), says which in `opportunity.language`,
and returns the reviewed text of each other language in `opportunity.translations`, from which the
front Worker draws the page's meta and share card on `?lang=es`.

## Test-fill

`testFill(form, { seed, includeOptional })` generates a valid, fictional response, deterministic per
seed. Strings with a `pattern` use `default` or `examples[0]`; give such fields an example.
