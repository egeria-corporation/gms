// SPDX-License-Identifier: AGPL-3.0-only
// The renderer in the reader's language (docs/forms.md, "Languages"): the funder's Spanish where it
// gave it, its own text with a note where it did not, answers stored once as the source values,
// validation in the page's language, and a switch for reviewers and staff.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setTranslation, translatableTexts, type FormDefinition, type JsonObject } from "@gms/forms";
import { describe, expect, it, vi } from "vitest";
import { FormView, type FormViewProps } from "../src/forms/FormView.tsx";
import { changeLocale } from "../src/i18n/current.ts";
import { LOI_FORM, LOI_FORM_SPANISH, LOI_PROVENANCE, LOI_RESPONSE } from "../src/mocks/forms.ts";

const SPANISH: FormDefinition = { ...LOI_FORM, translations: LOI_FORM_SPANISH };

async function draw(props: Partial<FormViewProps> = {}) {
  const onChange = vi.fn<(r: JsonObject) => void>();
  const view = render(
    <div className="gms">
      <FormView form={SPANISH} response={LOI_RESPONSE} mode="edit" provenance={LOI_PROVENANCE} onChange={onChange} {...props} />
    </div>,
  );
  await screen.findAllByRole("region");
  const last = () => onChange.mock.calls[onChange.mock.calls.length - 1]![0];
  return { ...view, onChange, last };
}

describe("FormView in the reader's language", () => {
  it("shows the funder's Spanish to a Spanish reader, and stores answers as the funder's values", async () => {
    await changeLocale("es");
    const { last } = await draw();
    expect(screen.getByRole("region", { name: "Proyecto" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Presupuesto y archivos adjuntos" })).toBeTruthy();
    // The renderer's own words are Spanish too (the required mark), around the funder's.
    expect(screen.getByLabelText(/^Título del proyecto/)).toBeTruthy();
    expect(screen.getByText("Rango para esta convocatoria: $50,000 – $150,000")).toBeTruthy();
    const kind = screen.getByLabelText(/^Tipo de proyecto/) as HTMLSelectElement;
    expect([...kind.options].map((o) => o.textContent)).toEqual(["Seleccione…", "Servicio directo", "Fortalecimiento institucional", "Inversión de capital"]);
    await userEvent.selectOptions(kind, "Inversión de capital");
    expect(last().projectType).toBe("Capital");
    const populations = screen.getByRole("group", { name: /^Poblaciones atendidas/ });
    await userEvent.click(within(populations).getByRole("checkbox", { name: "Veteranos y veteranas" }));
    expect(last().populations).toEqual(["Children", "Rural residents", "Veterans"]);
    // A budget category reads in Spanish; the row keeps the funder's category.
    const amount = screen.getByLabelText("Monto de Materiales");
    await userEvent.clear(amount);
    await userEvent.type(amount, "900");
    expect((last().budget as JsonObject[]).find((r) => r.category === "Supplies")).toMatchObject({ amount: { amount: "900", currency: "USD" } });
    // Everything was translated: no note.
    expect(screen.queryByTestId("form-language-note")).toBeNull();
  });

  it("validation messages come from the catalog, naming the field as the reader reads it", async () => {
    await changeLocale("es");
    await draw({ response: {}, showAllErrors: true });
    const title = screen.getByLabelText(/^Título del proyecto/);
    expect(title.getAttribute("aria-describedby")).toBeTruthy();
    const errors = screen.getAllByRole("alert").map((e) => e.textContent);
    expect(errors.some((e) => e && /Título del proyecto/.test(e) && !/required/.test(e))).toBe(true);
  });

  it("falls back to the funder's language with a note, and marks that text's language", async () => {
    await changeLocale("es");
    await draw({ form: LOI_FORM });
    expect(screen.getByTestId("form-language-note").textContent).toBe("Este formulario está en inglés, tal como lo escribió el financiador.");
    const heading = screen.getByRole("heading", { name: "Project" });
    expect(heading.querySelector('[lang="en"]')?.textContent).toBe("Project");
    expect(screen.getByLabelText(/^Project title/)).toBeTruthy();
  });

  it("a partly translated form says so, and only the missing texts fall back", async () => {
    await changeLocale("es");
    const unit = translatableTexts(LOI_FORM).find((u) => u.kind === "label" && u.path === "/projectTitle")!;
    await draw({ form: { ...LOI_FORM, translations: setTranslation({}, "es", unit, "Título del proyecto") } });
    expect(screen.getByTestId("form-language-note").textContent).toBe("Parte de este formulario está en inglés, tal como lo escribió el financiador.");
    expect(screen.getByLabelText(/^Título del proyecto/)).toBeTruthy();
    expect(screen.getByLabelText(/^Planned start date/)).toBeTruthy();
  });

  it("an English reader sees the form as the funder wrote it, with no note", async () => {
    await draw();
    expect(screen.getByLabelText(/^Project title/)).toBeTruthy();
    expect(screen.queryByTestId("form-language-note")).toBeNull();
    expect(document.querySelector('.gms-form [lang="es"]')).toBeNull();
  });

  it("never shows an unreviewed assistant draft to a reader; the funder's preview does", async () => {
    await changeLocale("es");
    const unit = translatableTexts(LOI_FORM).find((u) => u.kind === "section" && u.source === "Project")!;
    const drafted: FormDefinition = { ...LOI_FORM, translations: setTranslation(LOI_FORM_SPANISH, "es", unit, "Proyecto propuesto", { draft: true }) };
    const { unmount } = await draw({ form: drafted });
    expect(screen.getByRole("region", { name: "Project" })).toBeTruthy();
    unmount();
    await draw({ form: drafted, previewDrafts: true });
    expect(screen.getByRole("region", { name: "Proyecto propuesto" })).toBeTruthy();
  });
});

describe("FormView for reviewers and staff", () => {
  it("shows the questions in the reviewer's language with a switch to the form's own, and option answers by their label", async () => {
    await changeLocale("es");
    render(<FormView form={SPANISH} response={LOI_RESPONSE} mode="reviewer" />);
    const sw = await screen.findByRole("group", { name: "Preguntas en" });
    expect(within(sw).getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Proyecto" })).toBeTruthy();
    expect(screen.getByText("Servicio directo")).toBeTruthy();
    await userEvent.click(within(sw).getByRole("button", { name: "English" }));
    expect(screen.getByRole("region", { name: "Project" })).toBeTruthy();
    expect(screen.getByText("Direct service")).toBeTruthy();
    expect(within(sw).getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("an English-speaking officer can switch to the Spanish the applicant read", async () => {
    render(<FormView form={SPANISH} response={LOI_RESPONSE} mode="funder" provenance={LOI_PROVENANCE} />);
    const sw = await screen.findByRole("group", { name: "Questions in" });
    await userEvent.click(within(sw).getByRole("button", { name: "Español" }));
    const heading = screen.getByRole("heading", { name: "Proyecto" });
    expect(heading.querySelector('[lang="es"]')).toBeTruthy();
  });

  it("offers no switch for a form in one language, and none in print", async () => {
    const { unmount } = render(<FormView form={LOI_FORM} response={LOI_RESPONSE} mode="reviewer" />);
    await screen.findAllByRole("region");
    expect(screen.queryByRole("group", { name: "Questions in" })).toBeNull();
    unmount();
    render(<FormView form={SPANISH} response={LOI_RESPONSE} mode="print" />);
    await screen.findByRole("heading", { name: "Project" });
    expect(screen.queryByRole("group", { name: "Questions in" })).toBeNull();
  });
});
