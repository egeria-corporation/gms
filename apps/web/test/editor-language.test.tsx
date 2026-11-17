// SPDX-License-Identifier: AGPL-3.0-only
// The application editor reads a funder's form text in the reader's language, as FormView does
// (docs/forms.md, "Languages"): the form's title, the section rail and the names of fields that
// need attention, where the funder gave Spanish; the funder's own words otherwise, marked with
// their language. Who-is-in-which-section stays keyed by the funder's words, whatever each reads.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { FormDefinition } from "@gms/forms";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { changeLocale } from "../src/i18n/current.ts";
import { APPLICANT_IDS } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { LOI_FORM, LOI_FORM_SPANISH } from "../src/mocks/forms.ts";
import { fieldLabel, fieldLabelShown, formTitleShown, sectionsOf } from "../src/screens/applicant/editorSync.ts";

const SPANISH: FormDefinition = { ...LOI_FORM, translations: LOI_FORM_SPANISH };

afterEach(async () => {
  await changeLocale("en");
});

describe("the editor's own lists in the reader's language", () => {
  it("names sections, fields and the form in the funder's Spanish for a Spanish reader", async () => {
    await changeLocale("es");
    const sections = sectionsOf(SPANISH);
    expect(sections.map((s) => s.shown)).toEqual([
      { text: "Organización", lang: "es" },
      { text: "Proyecto", lang: "es" },
      { text: expect.any(String), lang: "es" },
    ]);
    // The shared key stays the funder's words.
    expect(sections.map((s) => s.label)).toEqual(["Organization", "Project", "Budget and attachments"]);
    expect(fieldLabelShown(SPANISH, "/projectTitle")).toEqual({ text: "Título del proyecto", lang: "es" });
    expect(fieldLabel(SPANISH, "/legalName")).toBe("Nombre legal");
    expect(formTitleShown(SPANISH)).toEqual({ text: "Carta de intención", lang: "es" });
  });

  it("falls back to the funder's words, marked as English, where there is no Spanish", async () => {
    await changeLocale("es");
    expect(sectionsOf(LOI_FORM)[0]!.shown).toEqual({ text: "Organization", lang: "en" });
    expect(fieldLabelShown(LOI_FORM, "/projectTitle")).toEqual({ text: "Project title", lang: "en" });
    expect(formTitleShown(LOI_FORM).lang).toBe("en");
  });

  it("reads exactly as before for an English reader", () => {
    expect(sectionsOf(SPANISH).map((s) => s.shown.text)).toEqual(["Organization", "Project", "Budget and attachments"]);
    expect(fieldLabel(SPANISH, "/projectTitle")).toBe("Project title");
    expect(formTitleShown(SPANISH)).toEqual({ text: "Letter of intent", lang: "en" });
  });

  it("on the screen: Spanish where the funder gave it, the rest marked English, and the rail still reaches each card", async () => {
    await changeLocale("es");
    render(
      <MemoryRouter initialEntries={[`/w/alder-creek/applications/app_${APPLICANT_IDS.appHealth}/edit`]}>
        <App services={createMockServices({ session: demoSession() })} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: "Mobile Health Navigation for Rural Families" }, { timeout: 5000 });
    // The full proposal is English only: its rail names are marked as English.
    await waitFor(() => expect(document.querySelector(".nm span[lang]")).not.toBeNull());
    const railNames = [...document.querySelectorAll(".nm")].map((n) => ({ text: n.textContent, lang: n.querySelector("[lang]")?.getAttribute("lang") ?? null }));
    expect(railNames).toEqual(expect.arrayContaining([{ text: "Organization", lang: "en" }, { text: "Project", lang: "en" }]));
    // The anchors still land on FormView's cards, named as the reader sees them.
    await waitFor(() => expect(document.getElementById("sec-organization")?.getAttribute("aria-label")).toBe("Organization"));
    // The earlier stage's letter of intent has the funder's Spanish.
    expect(screen.getAllByText("Respuestas de Carta de intención").length).toBeGreaterThan(0);
  });
});
