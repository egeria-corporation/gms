// SPDX-License-Identifier: AGPL-3.0-only
// Bilingual forms and opportunity text (docs/forms.md, "Languages"): translations are part of a
// form version, travel in CommonGrants customFields only, carry into the next version with changed
// sources flagged, never publish an unreviewed assistant draft, and the public opportunity page
// reads in Spanish where the funder translated it.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { translationStatus, type FormDefinition } from "@gms/forms";
import { FormBaseSchema } from "@gms/protocol";
import type { ZodType } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const sdk = async () => {
  const req = createRequire(new URL("../../../packages/protocol/package.json", import.meta.url));
  return (await import(pathToFileURL(req.resolve("@common-grants/sdk/schemas")).href)) as { OpportunityBaseSchema: ZodType };
};

type Errors = { errors: { code: string; field?: string; detail?: string }[] };
type FormView = FormDefinition & { id: string; status: string; translations: NonNullable<FormDefinition["translations"]> };

const FORM = {
  title: "Small grants application",
  purpose: "application",
  jsonSchema: {
    type: "object",
    properties: {
      projectTitle: { type: "string", title: "Project title" },
      kind: { type: "string", title: "Project type", enum: ["Direct service", "Capacity building"] },
    },
    required: ["projectTitle", "kind"],
  },
  uiSchema: { type: "VerticalLayout", elements: [{ type: "Group", label: "Project", elements: [{ type: "Control", scope: "#/properties/projectTitle", options: { help: "A short name." } }, { type: "Control", scope: "#/properties/kind" }] }] },
};
const t = (text: string, source: string) => ({ text, source });
const SPANISH = {
  es: {
    title: t("Solicitud de subvenciones pequeñas", "Small grants application"),
    sections: { "/elements/0": t("Proyecto", "Project") },
    fields: {
      "/projectTitle": { label: t("Título del proyecto", "Project title"), help: t("Un nombre corto.", "A short name.") },
      "/kind": { label: t("Tipo de proyecto", "Project type"), options: { "Direct service": t("Servicio directo", "Direct service"), "Capacity building": t("Fortalecimiento institucional", "Capacity building") } },
    },
  },
};

let h: Harness;
let s: Scenario;
const data = async <T>(method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T }>(s.funder, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("form translations", () => {
  it("are saved with the draft, published with the version, and served to CommonGrants in customFields only", async () => {
    const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: SPANISH });
    expect(form.translations).toEqual(SPANISH);
    expect(translationStatus(form, "es").complete).toBe(true);
    await data("POST", `/gms/forms/${form.id}/publish`);
    // Read the published version as a funder token reads drafts, and compare with a form that has none.
    const bare = await data<FormView>("POST", "/gms/forms", FORM);
    await data("POST", `/gms/forms/${bare.id}/publish`);
    const cg = (await s.call<{ data: Record<string, unknown> & { customFields: Record<string, unknown> } }>(s.funder, "GET", `/common-grants/forms/${form.id.slice(4)}`)).body.data;
    const plain = (await s.call<{ data: Record<string, unknown> & { customFields: Record<string, unknown> } }>(s.funder, "GET", `/common-grants/forms/${bare.id.slice(4)}`)).body.data;
    expect(FormBaseSchema.safeParse(cg).success).toBe(true);
    expect(Object.keys(cg).sort()).toEqual(Object.keys(plain).sort());
    expect(cg.title).toBe("Small grants application");
    expect(cg.uiSchema).toEqual(FORM.uiSchema);
    expect(cg.customFields.translations).toMatchObject({ name: "translations", fieldType: "object", value: SPANISH });
    expect(plain.customFields.translations).toBeUndefined();
  });

  it("refuses a malformed translations object and names the part", async () => {
    const r = await s.call<Errors>(s.funder, "POST", "/gms/forms", { ...FORM, translations: { es: { title: { text: 3, source: "x" } }, fr: {} } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("translations/es/title/text");
    expect(JSON.stringify(r.body)).toContain("translations/fr");
  });

  it("drops the translation of a field the draft no longer has", async () => {
    const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: SPANISH });
    const ui = { type: "VerticalLayout", elements: [{ type: "Group", label: "Project", elements: [{ type: "Control", scope: "#/properties/projectTitle", options: { help: "A short name." } }] }] };
    const saved = await data<FormView>("PATCH", `/gms/forms/${form.id}`, { uiSchema: ui, jsonSchema: { type: "object", properties: { projectTitle: FORM.jsonSchema.properties.projectTitle }, required: ["projectTitle"] } });
    expect(Object.keys(saved.translations.es?.fields ?? {})).toEqual(["/projectTitle"]);
    expect(saved.translations.es?.title?.text).toBe("Solicitud de subvenciones pequeñas");
  });

  it("carry into the next version; what the new draft rewords is flagged, the rest stays translated", async () => {
    const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: SPANISH });
    await data("POST", `/gms/forms/${form.id}/publish`);
    // A published version never changes, translations included.
    expect((await s.call(s.funder, "PATCH", `/gms/forms/${form.id}`, { translations: {} })).status).toBe(409);
    const v2 = await data<FormView>("POST", `/gms/forms/${form.id}/versions`);
    expect(v2.translations).toEqual(SPANISH);
    const schema = { ...FORM.jsonSchema, properties: { ...FORM.jsonSchema.properties, kind: { ...FORM.jsonSchema.properties.kind, title: "What kind of project is it?" } } };
    const edited = await data<FormView>("PATCH", `/gms/forms/${form.id}`, { jsonSchema: schema });
    const status = translationStatus(edited, "es");
    expect(status.items.filter((i) => i.state === "stale").map((i) => [i.kind, i.path, i.was])).toEqual([["label", "/kind", "Project type"]]);
    expect(status).toMatchObject({ done: status.total - 1, stale: 1 });
    // A stale translation is flagged, not a reason to hold the version back.
    expect((await s.call(s.funder, "POST", `/gms/forms/${form.id}/publish`)).status).toBe(200);
    const v1 = await data<FormView>("GET", `/gms/forms/${form.id}?version=1`);
    expect(translationStatus(v1, "es").complete).toBe(true);
  });

  it("an unreviewed assistant draft holds publishing back until a person reviews it", async () => {
    const drafted = { es: { ...SPANISH.es, title: { ...SPANISH.es.title, draft: true } } };
    const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: drafted });
    const r = await s.call<Errors>(s.funder, "POST", `/gms/forms/${form.id}/publish`);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("translations/es/title");
    await data("PATCH", `/gms/forms/${form.id}`, { translations: SPANISH });
    expect((await s.call(s.funder, "POST", `/gms/forms/${form.id}/publish`)).status).toBe(200);
  });

  it("answers are stored once, as the source value, whatever language the form was read in", async () => {
    // The scenario's LOI is answered in Spanish with the source values: the response holds no language.
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start?lang=es", { competitionId: s.uuid.comp });
    const uuid = started.body.data.id;
    const saved = await s.call<{ data: { response: Record<string, unknown> } }>(s.applicant, "PUT", `/common-grants/applications/${uuid}/forms/${s.uuid.loi}?lang=es`, { response: { projectTitle: "Navegación de salud" } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.response).toMatchObject({ projectTitle: "Navegación de salud" });
    expect(JSON.stringify(saved.body.data.response)).not.toMatch(/"(es|en)"/);
  });
});

describe("opportunity translations", () => {
  const TR = {
    es: {
      title: t("Subvenciones de Salud Comunitaria 2027", "Community Health Grants 2027"),
      description: t("Subvenciones para la navegación de salud comunitaria en el condado de Riverbend.", "Grants for community health navigation in Riverbend County."),
      eligibility: { "Nonprofit organization": t("Organización sin fines de lucro", "Nonprofit organization"), "Serves the region": t("Atiende a la región", "Serves the region") },
    },
  };
  const page = (query = "", headers: Record<string, string> = {}) => h.request(`/gms/public/funders/riverbend/opportunities/community-health-grants-2027${query}`, { headers });

  it("travel in the CommonGrants record's customFields only; the canonical fields keep the funder's language", async () => {
    const before = (await s.call<{ data: Record<string, unknown> }>(s.funder, "GET", `/common-grants/opportunities/${s.uuid.opp}`)).body.data;
    const saved = await data<{ translations: unknown; customFields: Record<string, unknown> }>("PATCH", `/gms/opportunities/${s.oppId}`, { translations: TR });
    expect(saved.translations).toEqual(TR);
    const cg = (await s.call<{ data: Record<string, unknown> & { customFields: Record<string, { value: unknown }> } }>(s.funder, "GET", `/common-grants/opportunities/${s.uuid.opp}`)).body.data;
    const { OpportunityBaseSchema } = await sdk();
    const { competitions: _c, ...base } = cg;
    expect(OpportunityBaseSchema.safeParse(base).success).toBe(true);
    expect(Object.keys(cg).sort()).toEqual(Object.keys(before).sort());
    expect(cg.title).toBe("Community Health Grants 2027");
    expect(cg.customFields.translations!.value).toEqual(TR);
  });

  it("are never stored as an unreviewed draft, and are written only through `translations`", async () => {
    const r = await s.call<Errors>(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { translations: { es: { title: { ...TR.es.title, draft: true } } } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("translations/es/title");
    expect((await s.call(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { customFields: { translations: { name: "translations", fieldType: "object", value: TR } } })).status).toBe(422);
    expect((await s.call(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { translations: { fr: {} } })).status).toBe(422);
  });

  it("survive a custom-fields change; a removed eligibility rule takes its label's translation with it", async () => {
    await data("PATCH", `/gms/opportunities/${s.oppId}`, { translations: TR });
    const kept = await data<{ translations: typeof TR; customFields: Record<string, unknown> }>("PATCH", `/gms/opportunities/${s.oppId}`, { customFields: { region: { name: "region", fieldType: "string", value: "Pacific Northwest" } } });
    expect(kept.translations).toEqual(TR);
    expect(Object.keys(kept.customFields).sort()).toEqual(["region", "translations"]);
    const rules = { all: [{ path: "profile.commonApp.irs.subsection", op: "in", value: ["03"], missing: "unknown", label: "Nonprofit organization" }] };
    const fewer = await data<{ translations: typeof TR }>("PATCH", `/gms/opportunities/${s.oppId}`, { eligibilityRules: rules });
    expect(Object.keys(fewer.translations.es.eligibility)).toEqual(["Nonprofit organization"]);
  });

  it("the public page reads in Spanish on ?lang=es, a Spanish cookie or browser; English otherwise, with the Spanish for the page's meta", async () => {
    await data("PATCH", `/gms/opportunities/${s.oppId}`, { translations: TR });
    type Page = { opportunity: { title: string; description: string; eligibility: string[]; language: string; translations: Record<string, { title?: string; description?: string }> }; commonGrants: { title: string } };
    const es = await page("?lang=es");
    expect(es.headers.get("Vary")).toContain("Accept-Language");
    const esBody = ((await es.json()) as { data: Page }).data;
    expect(esBody.opportunity).toMatchObject({ title: "Subvenciones de Salud Comunitaria 2027", description: TR.es.description.text, language: "es", eligibility: ["Organización sin fines de lucro", "Atiende a la región", "Annual budget under $5M"] });
    // The CommonGrants record on the page stays canonical.
    expect(esBody.commonGrants.title).toBe("Community Health Grants 2027");
    for (const headers of [{ Cookie: "gms_lang=es" }, { "Accept-Language": "es-MX,es;q=0.9" }] as Record<string, string>[]) expect((((await (await page("", headers)).json()) as { data: Page }).data.opportunity.title)).toBe("Subvenciones de Salud Comunitaria 2027");
    const en = ((await (await page()).json()) as { data: Page }).data;
    expect(en.opportunity).toMatchObject({ title: "Community Health Grants 2027", language: "en", eligibility: ["Nonprofit organization", "Serves the region", "Annual budget under $5M"] });
    expect(en.opportunity.translations).toEqual({ es: { title: "Subvenciones de Salud Comunitaria 2027", description: TR.es.description.text } });
  });

  it("a title the funder changed after translating it reads in English until the Spanish is updated", async () => {
    await data("PATCH", `/gms/opportunities/${s.oppId}`, { translations: TR });
    await data("PATCH", `/gms/opportunities/${s.oppId}`, { title: "Community Health Grants 2027–28" });
    const es = ((await (await page("?lang=es")).json()) as { data: { opportunity: { title: string; description: string; language: string; translations: Record<string, { title?: string }> } } }).data.opportunity;
    expect(es).toMatchObject({ title: "Community Health Grants 2027–28", language: "en", description: TR.es.description.text });
    expect(es.translations.es?.title).toBeUndefined();
  });
});

describe("drafting translations with the assistant", () => {
  it("is off unless the assistant is", async () => {
    const form = await data<FormView>("POST", "/gms/forms", FORM);
    const r = await s.call<Errors>(s.funder, "POST", `/gms/translations/forms/${form.id}/draft`, { language: "es" });
    expect(r.status).toBe(404);
    expect(r.body.errors[0]!.code).toBe("assistant_disabled");
    expect(h.llm.requests).toHaveLength(0);
  });

  describe("on", () => {
    beforeEach(() => {
      h.env.ASSISTANT_ENABLED = "true";
    });

    it("drafts what is not translated yet, saves nothing, and counts against the monthly quota", async () => {
      const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: { es: { title: SPANISH.es.title } } });
      h.llmAnswer.value = { texts: [{ id: "1", text: "Proyecto" }, { id: "2", text: "Título del proyecto" }, { id: "99", text: "ignored" }] };
      const r = await data<{ draft: boolean; items: { kind: string; path: string; option?: string; source: string; text: string }[]; remaining: number; quota: { used: number } }>("POST", `/gms/translations/forms/${form.id}/draft`, { language: "es" });
      expect(r).toMatchObject({ draft: true, remaining: 0, quota: { used: 1 } });
      expect(r.items).toEqual([
        { kind: "section", path: "/elements/0", source: "Project", text: "Proyecto" },
        { kind: "label", path: "/projectTitle", source: "Project title", text: "Título del proyecto" },
      ]);
      const req = h.llm.requests[0]!;
      // The translated title is not sent again; the funder's texts travel as data, never in the instructions.
      expect(req.user).not.toContain("Small grants application");
      expect(req.user).toContain("Capacity building");
      expect(req.system).not.toContain("Capacity building");
      expect(req.system).toContain("usted");
      const calls = await h.repos.table("assist_calls").find({ workspace_id: WS_FUNDER });
      expect(calls.map((c) => [c.tool, c.subject])).toEqual([["translate", form.id]]);
      // Nothing was saved: the draft is the builder's to review.
      expect((await data<FormView>("GET", `/gms/forms/${form.id}`)).translations).toEqual({ es: { title: SPANISH.es.title } });
    });

    it("does not call the model when everything is translated, and never translates a published version in place", async () => {
      const form = await data<FormView>("POST", "/gms/forms", { ...FORM, translations: SPANISH });
      expect(await data("POST", `/gms/translations/forms/${form.id}/draft`, { language: "es" })).toMatchObject({ items: [], remaining: 0 });
      expect(h.llm.requests).toHaveLength(0);
      await data("POST", `/gms/forms/${form.id}/publish`);
      expect((await s.call(s.funder, "POST", `/gms/translations/forms/${form.id}/draft`, { language: "es" })).status).toBe(409);
      expect((await s.call(s.funder, "POST", `/gms/translations/forms/${form.id}/draft`, { language: "en" })).status).toBe(409);
      const fresh = await data<FormView>("POST", "/gms/forms", FORM);
      expect((await s.call(s.funder, "POST", `/gms/translations/forms/${fresh.id}/draft`, { language: "en" })).status).toBe(422);
      expect((await s.call(s.funder, "POST", `/gms/translations/forms/${fresh.id}/draft`, { language: "fr" })).status).toBe(400);
    });

    it("drafts an opportunity's title, summary and eligibility labels", async () => {
      h.llmAnswer.value = { texts: [{ id: "1", text: "Subvenciones de Salud Comunitaria 2027" }, { id: "3", text: "Organización sin fines de lucro" }] };
      const r = await data<{ items: { kind: string; key: string; text: string }[]; quota: { used: number } }>("POST", `/gms/translations/opportunities/${s.oppId}/draft`, { language: "es" });
      expect(r.items).toEqual([
        { kind: "title", key: "", source: "Community Health Grants 2027", text: "Subvenciones de Salud Comunitaria 2027" },
        { kind: "eligibility", key: "Nonprofit organization", source: "Nonprofit organization", text: "Organización sin fines de lucro" },
      ]);
      expect(r.quota.used).toBe(1);
      expect(h.llm.requests[0]!.user).toContain("Annual budget under $5M");
    });

    it("stops at the monthly quota", async () => {
      await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { assistMonthlyQuota: 0 } });
      const form = await data<FormView>("POST", "/gms/forms", FORM);
      const r = await s.call<Errors>(s.funder, "POST", `/gms/translations/forms/${form.id}/draft`, { language: "es" });
      expect(r.status).toBe(429);
      expect(r.body.errors[0]!.code).toBe("assist_quota_exhausted");
    });
  });
});
