// SPDX-License-Identifier: AGPL-3.0-only
// "Add Spanish" in the form builder (docs/forms.md, "Languages"): the builder's translation model,
// then the screen: side-by-side rows, the completeness indicator, the assistant's drafts that hold
// publishing back until reviewed, the Spanish preview, and what is saved.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translationStatus } from "@gms/forms";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import {
  addLanguage,
  addSection,
  applyDrafts,
  compileForm,
  compileTranslations,
  parseForm,
  parseTranslations,
  removeSection,
  translationRows,
  writeTranslation,
  type FormModel,
} from "../src/lib/form-model.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { LOI_FORM, LOI_FORM_SPANISH } from "../src/mocks/forms.ts";
import { IDS } from "../src/mocks/store.ts";

const T = { timeout: 20_000 };

describe("the builder's translation model", () => {
  const model = (): FormModel => parseForm({ ...LOI_FORM, mappingFromCommonGrants: {}, mappingToCommonGrants: {} });

  it("round-trips the stored translations", () => {
    const m = model();
    const tm = parseTranslations(LOI_FORM_SPANISH);
    expect(tm).toMatchObject({ source: "en", languages: ["es"] });
    const compiled = compileTranslations(m, tm, LOI_FORM.title);
    expect(translationStatus({ title: LOI_FORM.title, ...compileForm(m), translations: compiled }, "es").complete).toBe(true);
    expect(compiled.es?.sections).toEqual(LOI_FORM_SPANISH.es?.sections);
  });

  it("removing a section takes its translation with it and keeps the others on their own sections", () => {
    const m = model();
    const tm = parseTranslations(LOI_FORM_SPANISH);
    const without = removeSection(m, m.sections[0]!.id);
    const compiled = compileTranslations(without, tm, LOI_FORM.title);
    expect(compiled.es?.sections).toEqual({ "/elements/0": LOI_FORM_SPANISH.es!.sections!["/elements/1"], "/elements/1": LOI_FORM_SPANISH.es!.sections!["/elements/2"] });
    expect(compiled.es?.fields?.["/legalName"]).toBeUndefined();
    // A new section starts untranslated.
    const more = addSection(without, "new1");
    expect(translationRows(more, tm, LOI_FORM.title, "es").items.filter((i) => i.kind === "section").map((i) => i.state)).toEqual(["done", "done", "missing"]);
  });

  it("the assistant's drafts fill only what is missing or stale, marked as drafts", () => {
    const m = model();
    let tm = addLanguage(parseTranslations(undefined), "es");
    const title = translationRows(m, tm, LOI_FORM.title, "es").items[0]!;
    tm = writeTranslation(m, tm, "es", title, "Carta de intención (de la fundación)");
    const { tm: next, applied } = applyDrafts(m, tm, LOI_FORM.title, "es", [
      { kind: "title", path: "", source: "Letter of intent", text: "Carta de intención" },
      { kind: "section", path: "/elements/1", source: "Project", text: "Proyecto" },
      { kind: "section", path: "/elements/2", source: "Something else", text: "Otra cosa" },
    ]);
    expect(applied).toBe(1);
    const rows = translationRows(m, next, LOI_FORM.title, "es").items;
    expect(rows[0]).toMatchObject({ state: "done", text: "Carta de intención (de la fundación)" });
    expect(rows.find((r) => r.kind === "section" && r.path === "/elements/1")).toMatchObject({ state: "draft", text: "Proyecto" });
  });
});

function open(path: string, services: Services) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
}

describe("Add Spanish in the form builder", () => {
  it("translates side by side, drafts with the assistant, holds publishing until the drafts are reviewed, and saves the Spanish", T, async () => {
      const services = createMockServices({ session: demoSession() });
      await services.api.workspace("riverbend");
      await services.api.createFormVersion(IDS.formLoi);
      open(`/w/riverbend/forms/${IDS.formLoi}/edit`, services);
      await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" });

      await userEvent.click(screen.getByRole("button", { name: "Add Spanish" }));
      expect(screen.getByLabelText("Written in")).toBeDisabled();
      const rows = await screen.findByRole("list", { name: "Spanish text" });
      const total = within(rows).getAllByRole("listitem").length;
      expect(screen.getAllByText(`Spanish: 0 of ${total} translated`).length).toBeGreaterThan(0);

      // A person types the title.
      await userEvent.type(within(rows).getByRole("textbox", { name: "Form title Letter of intent" }), "Carta de intención");
      expect(screen.getAllByText(`Spanish: 1 of ${total} translated`).length).toBeGreaterThan(0);

      // The assistant drafts the rest: each is marked, and publishing waits for review.
      await userEvent.click(screen.getByRole("button", { name: "Draft the missing texts" }));
      expect(await screen.findByText(`${total - 1} drafts added. Review each one below.`)).toBeInTheDocument();
      expect(within(rows).getByRole("textbox", { name: "Section title Project" })).toHaveValue("Proyecto");
      expect(screen.getAllByText(`${total - 1} assistant drafts to review`).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Publish v3" })).toBeDisabled();
      expect(screen.getByText("Review the assistant's drafts before publishing.")).toBeInTheDocument();
      // The title a person wrote was not replaced.
      expect(within(rows).getByRole("textbox", { name: "Form title Letter of intent" })).toHaveValue("Carta de intención");

      // Editing one reviews it; the rest are marked reviewed one by one.
      const kind = within(rows).getByRole("textbox", { name: "Field label Project type" });
      await userEvent.clear(kind);
      await userEvent.type(kind, "Tipo de proyecto");
      for (const b of within(rows).getAllByRole("button", { name: "Mark as reviewed" })) await userEvent.click(b);
      expect(screen.getAllByText("Spanish complete").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Publish v3" })).toBeEnabled();

      // The applicant preview in Spanish.
      await userEvent.click(screen.getByRole("button", { name: "Preview as applicant" }));
      const preview = screen.getByRole("region", { name: "Applicant preview" });
      await userEvent.click(within(within(preview).getByRole("group", { name: "Preview in" })).getByRole("button", { name: "Spanish" }));
      expect(await within(preview).findByRole("region", { name: "Proyecto" })).toBeInTheDocument();
      expect(within(preview).getByLabelText(/^Tipo de proyecto/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(async () => {
        const saved = await services.api.getForm(IDS.formLoi);
        expect(saved.translations?.es?.title).toEqual({ text: "Carta de intención", source: "Letter of intent" });
        expect(translationStatus(saved, "es").complete).toBe(true);
      });
      await userEvent.click(screen.getByRole("button", { name: "Publish v3" }));
      await waitFor(async () => expect((await services.api.getForm(IDS.formLoi)).status).toBe("published"));
  });

  it("a reworded question in the next version is flagged until updated or confirmed", T, async () => {
      const services = createMockServices({ session: demoSession() });
      await services.api.workspace("riverbend");
      const v3 = await services.api.createFormVersion(IDS.formLoi);
      await services.api.updateForm(IDS.formLoi, { translations: LOI_FORM_SPANISH, jsonSchema: { ...v3.jsonSchema, properties: { ...v3.jsonSchema.properties, projectTitle: { ...v3.jsonSchema.properties!.projectTitle!, title: "Name of the project" } } } });
      open(`/w/riverbend/forms/${IDS.formLoi}/edit`, services);
      await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" });
      expect(screen.getAllByText("1 needs updating").length).toBeGreaterThan(0);
      await userEvent.click(screen.getByRole("button", { name: "Translate" }));
      const rows = screen.getByRole("list", { name: "Spanish text" });
      const row = within(rows).getByRole("textbox", { name: "Field label Name of the project" }).closest("li")!;
      expect(within(row).getByText("Needs updating")).toBeInTheDocument();
      expect(within(row).getByText("Project title")).toBeInTheDocument();
      await userEvent.click(within(row).getByRole("button", { name: "Still correct" }));
      expect(screen.getAllByText("Spanish complete").length).toBeGreaterThan(0);
  });
});

describe("Add Spanish in the opportunity builder", () => {
  it("translates the title, summary and eligibility rules, and never saves an unreviewed draft", T, async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    const id = (await services.api.listOpportunities()).find((o) => o.slug === "community-health-2027")!.id;
    open("/w/riverbend/opportunities/community-health-2027/edit", services);
    await screen.findByRole("heading", { name: "Opportunity builder" });
    await userEvent.click(await screen.findByRole("button", { name: "Add Spanish" }));
    const rows = screen.getByRole("list", { name: "Languages" });
    await userEvent.type(within(rows).getByRole("textbox", { name: "Title Community Health Grants 2027" }), "Subvenciones de Salud Comunitaria 2027");
    // The assistant drafts the rest; saving waits until each draft is reviewed.
    await userEvent.click(screen.getByRole("button", { name: "Draft the missing texts" }));
    expect(await screen.findByText(/drafts? added/)).toBeInTheDocument();
    expect(within(rows).getByRole("textbox", { name: "Title Community Health Grants 2027" })).toHaveValue("Subvenciones de Salud Comunitaria 2027");
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    expect(await screen.findByText("Review the assistant's drafts before saving.")).toBeInTheDocument();
    expect((await services.api.getOpportunity(id)).translations?.es?.description).toBeUndefined();
    for (const b of within(rows).getAllByRole("button", { name: "Mark as reviewed" })) await userEvent.click(b);
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    await waitFor(async () => {
      const saved = await services.api.getOpportunity(id);
      expect(saved.translations?.es?.title).toEqual({ text: "Subvenciones de Salud Comunitaria 2027", source: "Community Health Grants 2027" });
      expect(JSON.stringify(saved.translations)).not.toContain('"draft"');
    });
  });
});
