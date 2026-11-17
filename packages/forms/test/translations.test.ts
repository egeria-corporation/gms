// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  FormDefinitionError,
  clone,
  confirmTranslation,
  formText,
  nextDraft,
  normalizeTranslations,
  opportunityText,
  opportunityTranslationStatus,
  publishForm,
  setTranslation,
  translatableTexts,
  translationStatus,
  translationsCustomField,
  unreviewedDrafts,
  validateFormDefinition,
  validateOpportunityTranslations,
  validateResponse,
  type FormDefinition,
  type FormTranslations,
} from "../src/index.ts";
import { form, validResponse } from "./fixtures.ts";

/** A small form a funder built: one section, a short text with help, a select and a budget table. */
const small: FormDefinition = {
  id: "frm_small",
  version: 1,
  title: "Letter of intent",
  jsonSchema: {
    type: "object",
    properties: {
      projectTitle: { type: "string", title: "Project title" },
      kind: { type: "string", title: "Project type", enum: ["Direct service", "Capacity building"] },
      budget: { type: "array", title: "Budget", items: { type: "object" } },
    },
    required: ["projectTitle", "kind"],
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      {
        type: "Group",
        label: "Project",
        elements: [
          { type: "Control", scope: "#/properties/projectTitle", options: { help: "A short name for the project." } },
          { type: "Control", scope: "#/properties/kind" },
          { type: "Control", scope: "#/properties/budget", options: { widget: "budgetTable", widgetOptions: { currency: "USD", categories: ["Personnel", "Supplies"] } } },
        ],
      },
    ],
  },
};

const spanish = (): FormTranslations => {
  let t: FormTranslations = {};
  const text: Record<string, string> = {
    "Letter of intent": "Carta de intención",
    Project: "Proyecto",
    "Project title": "Título del proyecto",
    "A short name for the project.": "Un nombre corto para el proyecto.",
    "Project type": "Tipo de proyecto",
    "Direct service": "Servicio directo",
    "Capacity building": "Fortalecimiento institucional",
    Budget: "Presupuesto",
    Personnel: "Personal",
    Supplies: "Materiales",
  };
  for (const u of translatableTexts(small)) t = setTranslation(t, "es", u, text[u.source]!);
  return t;
};

describe("translatable texts", () => {
  it("lists the title, sections, labels, help and every choice, in reading order", () => {
    expect(translatableTexts(small).map((u) => [u.kind, u.path, u.source])).toEqual([
      ["title", "", "Letter of intent"],
      ["section", "/elements/0", "Project"],
      ["label", "/projectTitle", "Project title"],
      ["help", "/projectTitle", "A short name for the project."],
      ["label", "/kind", "Project type"],
      ["option", "/kind", "Direct service"],
      ["option", "/kind", "Capacity building"],
      ["label", "/budget", "Budget"],
      ["option", "/budget", "Personnel"],
      ["option", "/budget", "Supplies"],
    ]);
  });

  it("reads nested categories, multi-select options and labels a field without one by its key", () => {
    const units = translatableTexts(form);
    expect(units.filter((u) => u.kind === "section").map((u) => [u.path, u.source])).toEqual([
      ["/elements/0", "Organization"],
      ["/elements/1", "Project"],
      ["/elements/2", "Budget"],
      ["/elements/3", "Sign"],
    ]);
    expect(units.filter((u) => u.path === "/focusAreas" && u.kind === "option").map((u) => u.option)).toEqual(["health", "housing", "education"]);
    expect(units.find((u) => u.kind === "label" && u.path === "/projectTitle")?.source).toBe("Project Title");
  });
});

describe("status and completeness", () => {
  it("counts what is done, missing, stale and drafted", () => {
    expect(translationStatus(small, "es")).toMatchObject({ total: 10, done: 0, missing: 10, complete: false });
    const done = { ...small, translations: spanish() };
    expect(translationStatus(done, "es")).toMatchObject({ total: 10, done: 10, missing: 0, stale: 0, drafts: 0, complete: true });
    const draft = { ...small, translations: setTranslation(spanish(), "es", translatableTexts(small)[0]!, "Carta de intención", { draft: true }) };
    expect(translationStatus(draft, "es")).toMatchObject({ done: 9, drafts: 1, complete: false });
  });

  it("an empty form has nothing to translate and is never complete", () => {
    const empty: FormDefinition = { ...small, title: "", jsonSchema: { type: "object", properties: {} }, uiSchema: { type: "VerticalLayout", elements: [] } };
    expect(translationStatus(empty, "es")).toMatchObject({ total: 0, complete: false });
  });
});

describe("text in the reader's language", () => {
  const done: FormDefinition = { ...small, translations: spanish() };

  it("shows the Spanish when the funder gave it, and the answer value stays the source value", () => {
    const es = formText(done, "es");
    expect(es.coverage).toBe("full");
    expect(es.title).toEqual({ text: "Carta de intención", lang: "es" });
    expect(es.section("/elements/0", "Project").text).toBe("Proyecto");
    expect(es.label("/kind", "Project type").text).toBe("Tipo de proyecto");
    expect(es.option("/kind", "Direct service")).toEqual({ text: "Servicio directo", lang: "es" });
    expect(es.option("/budget", "Supplies").text).toBe("Materiales");
    expect(es.languages).toEqual(["en", "es"]);
    // Answers are stored once: the stored value is the source option, valid whatever language it was chosen in.
    expect(validateResponse(done, { projectTitle: "Casa Segura", kind: "Direct service" }).valid).toBe(true);
    expect(validateResponse(done, { projectTitle: "Casa Segura", kind: "Servicio directo" }).valid).toBe(false);
  });

  it("falls back to the funder's language, text by text, and says how much is translated", () => {
    expect(formText(small, "es")).toMatchObject({ coverage: "none", title: { text: "Letter of intent", lang: "en" }, languages: ["en"] });
    const half = { ...small, translations: setTranslation({}, "es", translatableTexts(small)[2]!, "Título del proyecto") };
    const es = formText(half, "es");
    expect(es.coverage).toBe("partial");
    expect(es.label("/projectTitle", "Project title")).toEqual({ text: "Título del proyecto", lang: "es" });
    expect(es.label("/kind", "Project type")).toEqual({ text: "Project type", lang: "en" });
  });

  it("the form's own language is shown as written", () => {
    const en = formText(done, "en");
    expect(en).toMatchObject({ coverage: "full", source: "en", languages: ["en", "es"] });
    expect(en.label("/kind", "Project type")).toEqual({ text: "Project type", lang: "en" });
  });

  it("never shows a stale translation or an unreviewed draft to a reader; the funder's preview shows drafts", () => {
    const edited: FormDefinition = { ...done, jsonSchema: clone(done.jsonSchema) };
    edited.jsonSchema.properties!.kind!.title = "Kind of project";
    expect(formText(edited, "es").label("/kind", "Kind of project")).toEqual({ text: "Kind of project", lang: "en" });
    const drafted = { ...small, translations: setTranslation({}, "es", translatableTexts(small)[0]!, "Carta de intención", { draft: true }) };
    expect(formText(drafted, "es").title.lang).toBe("en");
    expect(formText(drafted, "es", { drafts: true }).title).toEqual({ text: "Carta de intención", lang: "es" });
  });

  it("a form written in Spanish can carry English", () => {
    const es: FormDefinition = { ...small, title: "Carta de intención", translations: { source: "es", en: { title: { text: "Letter of intent", source: "Carta de intención" } } } };
    expect(formText(es, "en").title).toEqual({ text: "Letter of intent", lang: "en" });
    expect(formText(es, "es").title).toEqual({ text: "Carta de intención", lang: "es" });
  });
});

describe("editing", () => {
  it("a person's text is reviewed and stamped with today's source; an empty text removes it", () => {
    const u = translatableTexts(small)[2]!;
    let t = setTranslation({}, "es", u, "Título", { draft: true });
    expect(t.es?.fields?.["/projectTitle"]?.label).toEqual({ text: "Título", source: "Project title", draft: true });
    t = setTranslation(t, "es", u, "Título del proyecto");
    expect(t.es?.fields?.["/projectTitle"]?.label).toEqual({ text: "Título del proyecto", source: "Project title" });
    t = setTranslation(t, "es", u, "  ");
    expect(t.es?.fields?.["/projectTitle"]?.label).toBeUndefined();
  });

  it("'still correct' keeps a stale text and makes it current; a confirmed draft is reviewed", () => {
    const u = translatableTexts(small)[2]!;
    const stale = setTranslation({}, "es", { ...u, source: "Title" }, "Título del proyecto");
    const form1 = { ...small, translations: stale };
    expect(translationStatus(form1, "es").items[2]).toMatchObject({ state: "stale", was: "Title" });
    const fixed = { ...small, translations: confirmTranslation(stale, "es", u) };
    expect(translationStatus(fixed, "es").items[2]).toMatchObject({ state: "done", text: "Título del proyecto" });
    const drafted = setTranslation({}, "es", u, "Título", { draft: true });
    expect(confirmTranslation(drafted, "es", u).es?.fields?.["/projectTitle"]?.label?.draft).toBeUndefined();
  });

  it("normalizing drops texts the form no longer has and keeps stale ones to flag", () => {
    const t = setTranslation(setTranslation(spanish(), "es", { kind: "label", path: "/gone", source: "Gone" }, "Ya no está"), "es", { kind: "option", path: "/kind", option: "Removed", source: "Removed" }, "Quitado");
    const edited: FormDefinition = { ...small, jsonSchema: clone(small.jsonSchema), translations: t };
    edited.jsonSchema.properties!.projectTitle!.title = "Name of the project";
    const n = normalizeTranslations(edited);
    expect(n.es?.fields?.["/gone"]).toBeUndefined();
    expect(n.es?.fields?.["/kind"]?.options?.Removed).toBeUndefined();
    expect(n.es?.fields?.["/projectTitle"]?.label).toEqual({ text: "Título del proyecto", source: "Project title" });
    expect(normalizeTranslations({ ...small, translations: { source: "en", en: { title: { text: "x", source: "x" } } } })).toEqual({ source: "en" });
  });
});

describe("versions", () => {
  it("translations are published with the version and carry into the next draft; changed sources are flagged", () => {
    const published = publishForm({ ...small, translations: spanish() }, new Date("2027-01-15T00:00:00Z"));
    const draft = nextDraft(published);
    expect(draft.translations).toEqual(published.translations);
    expect(translationStatus(draft, "es").complete).toBe(true);
    // The funder rewords one question and adds a choice in the new draft.
    draft.jsonSchema.properties!.kind!.title = "What kind of project is it?";
    draft.jsonSchema.properties!.kind!.enum = ["Direct service", "Capacity building", "Research"];
    const status = translationStatus(draft, "es");
    expect(status.items.filter((i) => i.state === "stale").map((i) => [i.kind, i.path, i.was])).toEqual([["label", "/kind", "Project type"]]);
    expect(status.items.filter((i) => i.state === "missing").map((i) => i.option)).toEqual(["Research"]);
    expect(status).toMatchObject({ done: 9, stale: 1, missing: 1 });
    // Unchanged texts keep their translation; the reworded one falls back to the source until updated.
    const es = formText(draft, "es");
    expect(es.option("/kind", "Direct service").text).toBe("Servicio directo");
    expect(es.label("/kind", "What kind of project is it?").lang).toBe("en");
    // A stale translation does not stop publishing; it is flagged.
    expect(() => publishForm(draft)).not.toThrow();
  });

  it("an unreviewed assistant draft stops publishing and is named", () => {
    const drafted = { ...small, translations: setTranslation(spanish(), "es", translatableTexts(small)[2]!, "Título del proyecto", { draft: true }) };
    expect(unreviewedDrafts(drafted)).toEqual([{ path: "translations/es/label/projectTitle", message: "the assistant's label draft must be reviewed before the form is published" }]);
    try {
      publishForm(drafted);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FormDefinitionError);
      expect((e as FormDefinitionError).errors.map((x) => x.path)).toEqual(["translations/es/label/projectTitle"]);
    }
  });
});

describe("validation", () => {
  it("accepts a well-formed translations object", () => {
    expect(validateFormDefinition({ ...small, translations: spanish() })).toEqual([]);
  });

  it("names every malformed part", () => {
    const bad = { fr: {}, source: "de", es: { title: { text: 1, source: "x" }, colour: {}, fields: { "/a": { label: { text: "a", source: "a", draft: false }, size: 1 } } } };
    expect(validateFormDefinition({ ...small, translations: bad as unknown as FormTranslations }).map((e) => e.path)).toEqual([
      "translations/fr",
      "translations/source",
      "translations/es/colour",
      "translations/es/title/text",
      "translations/es/fields/~1a/size",
      "translations/es/fields/~1a/label/draft",
    ]);
  });

  it("refuses a text longer than the limit", () => {
    const long = setTranslation({}, "es", translatableTexts(small)[0]!, "x".repeat(20_001));
    expect(validateFormDefinition({ ...small, translations: long }).map((e) => e.path)).toEqual(["translations/es/title/text"]);
  });

  it("the CommonGrants custom field carries the translations, and nothing when there are none", () => {
    expect(translationsCustomField(undefined)).toBeNull();
    expect(translationsCustomField({ source: "en" })).toBeNull();
    expect(translationsCustomField(spanish())).toMatchObject({ name: "translations", fieldType: "object", value: spanish() });
  });
});

describe("opportunity text", () => {
  const opp = { title: "Community Health Grants 2027", description: "Operating support for clinics.", eligibility: ["IRS tax-exempt status", "Serves Riverbend County"] };
  const tr = {
    es: {
      title: { text: "Subvenciones de Salud Comunitaria 2027", source: "Community Health Grants 2027" },
      description: { text: "Apoyo operativo para clínicas.", source: "Operating support for clinics." },
      eligibility: { "IRS tax-exempt status": { text: "Exención de impuestos del IRS", source: "IRS tax-exempt status" } },
    },
  };

  it("picks the Spanish title, summary and labels, falling back label by label", () => {
    const es = opportunityText(opp, tr, "es");
    expect(es.title).toEqual({ text: "Subvenciones de Salud Comunitaria 2027", lang: "es" });
    expect(es.description.text).toBe("Apoyo operativo para clínicas.");
    expect(es.eligibility.map((e) => e.text)).toEqual(["Exención de impuestos del IRS", "Serves Riverbend County"]);
    expect(es.coverage).toBe("partial");
    expect(opportunityText(opp, tr, "en")).toMatchObject({ coverage: "full", title: { text: opp.title, lang: "en" } });
    expect(opportunityText(opp, null, "es")).toMatchObject({ coverage: "none", title: { text: opp.title, lang: "en" } });
  });

  it("a changed title falls back to the funder's text and is flagged", () => {
    const changed = { ...opp, title: "Community Health Grants 2028" };
    expect(opportunityText(changed, tr, "es").title.lang).toBe("en");
    const status = opportunityTranslationStatus(changed, tr, "es");
    expect(status).toMatchObject({ total: 4, done: 2, stale: 1, missing: 1, complete: false });
    expect(status.items[0]).toMatchObject({ kind: "title", state: "stale", was: "Community Health Grants 2027" });
  });

  it("validates its shape", () => {
    expect(validateOpportunityTranslations(tr)).toEqual([]);
    expect(validateOpportunityTranslations({ es: { summary: {}, eligibility: { a: { text: "b" } } } }).map((e) => e.path)).toEqual(["translations/es/summary", "translations/es/eligibility/a/source"]);
  });
});

it("the fixture form still validates and publishes with no translations", () => {
  expect(validateFormDefinition(form)).toEqual([]);
  expect(validateResponse(form, validResponse).valid).toBe(true);
});
