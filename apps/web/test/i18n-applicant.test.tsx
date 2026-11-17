// SPDX-License-Identifier: AGPL-3.0-only
// The applicant screens in Spanish (docs/i18n.md): the form renderer translates its own fixed text
// (required, the counters, buttons, validation) and shows the funder's labels and options as written.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonObject } from "@gms/forms";
import { describe, expect, it, vi } from "vitest";
import { FormView, type FormViewProps } from "../src/forms/FormView.tsx";
import { changeLocale } from "../src/i18n/current.ts";
import { LOI_FORM, LOI_PROVENANCE, LOI_RESPONSE } from "../src/mocks/forms.ts";
import { DEADLINE_LABELS, dueIn } from "../src/screens/applicant/outside/shared.tsx";
import { fiscalYearName, limitPhrase, monthName, stageLabel } from "../src/screens/applicant/labels.ts";
import { LANE_LABELS } from "../src/screens/applicant/Applications.tsx";

function draw(props: Partial<FormViewProps> = {}) {
  const onChange = vi.fn<(r: JsonObject) => void>();
  render(
    <div className="gms">
      <FormView form={LOI_FORM} response={LOI_RESPONSE} mode="edit" provenance={LOI_PROVENANCE} onChange={onChange} {...props} />
    </div>,
  );
  return { onChange };
}

describe("the form renderer in Spanish", () => {
  it("translates its fixed text and keeps the funder's labels as written", async () => {
    await act(() => changeLocale("es"));
    draw({ passportUrl: "https://passport.example/org" });
    // The funder's own words.
    expect(screen.getByLabelText(/Project title/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Populations served/ })).toBeInTheDocument();
    // The renderer's own words.
    expect(screen.getAllByTitle("Obligatorio").length).toBeGreaterThan(0);
    expect(screen.getByText(/\/ 60 palabras/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar en Passport" })).toBeInTheDocument();
    expect(screen.getAllByText("De Passport").length).toBeGreaterThan(0);
    expect(screen.getByText("Borrador de un agente")).toBeInTheDocument();
    const staff = screen.getByRole("group", { name: /Key staff/ });
    expect(within(staff).getByRole("button", { name: /^Agregar key staff$/ })).toBeInTheDocument();
    expect(within(staff).getByRole("button", { name: "Quitar la fila 1" })).toBeInTheDocument();
    const address = screen.getByRole("group", { name: /Mailing address/ });
    expect(within(address).getByLabelText("Ciudad")).toBeInTheDocument();
  });

  it("shows validation messages and the budget check in Spanish", async () => {
    await act(() => changeLocale("es"));
    const { projectTitle: _omit, ...rest } = LOI_RESPONSE;
    draw({ response: rest, showAllErrors: true });
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("Project title: este campo es obligatorio");

    const need = screen.getByLabelText(/What need does this project address/);
    fireEvent.change(need, { target: { value: Array.from({ length: 61 }, () => "word").join(" ") } });
    expect(screen.getByText("61 / 60 palabras")).toHaveClass("over");
    expect(screen.getAllByRole("alert").some((a) => /escriba como máximo 60 palabras \(ahora tiene 61\)/.test(a.textContent ?? ""))).toBe(true);

    const budget = screen.getByRole("group", { name: /Budget/ });
    const indirect = within(budget).getByLabelText("Monto de Indirect");
    await userEvent.clear(indirect);
    await userEvent.type(indirect, "18000");
    expect(within(budget).getAllByRole("alert")[0]).toHaveTextContent("El total del presupuesto supera el monto solicitado por $3,000.");
  });

  it("reads a signature and a yes or no answer in Spanish", async () => {
    await act(() => changeLocale("es"));
    draw({ mode: "funder" });
    expect(screen.getByText(/Firmado por/)).toBeInTheDocument();
    expect(screen.getAllByText(/^(Sí|No)$/).length).toBeGreaterThan(0);
  });
});

describe("the applicant screens' words in Spanish", () => {
  it("follow the page's language in label tables, plurals and dates", async () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(dueIn("2026-11-17", now)).toBe("in 1 day");
    expect(LANE_LABELS.drafting).toBe("Drafting");
    expect(limitPhrase("words", 1)).toBe("1 word");
    await act(() => changeLocale("es"));
    expect(dueIn("2026-11-17", now)).toBe("en 1 día");
    expect(dueIn("2026-11-26", now)).toBe("en 10 días");
    expect(dueIn("2026-11-14", now)).toBe("hace 2 días");
    expect(dueIn("2026-11-16", now)).toBe("hoy");
    // Label tables are read in the current language each time.
    expect(LANE_LABELS.drafting).toBe("En redacción");
    expect(DEADLINE_LABELS.fullDue).toBe("Fecha límite de la solicitud completa");
    expect(stageLabel("not_pursuing")).toBe("Descartada");
    expect(limitPhrase("chars", 1500)).toBe("1,500 caracteres");
    expect(limitPhrase(null, null)).toBe("Sin límite");
    expect(monthName(7)).toBe("julio");
  });
});

describe("fiscal years", () => {
  it("read as the API words them in English, and in Spanish", async () => {
    expect([fiscalYearName(2027, 1), fiscalYearName(2027, 7)]).toEqual(["FY 2027", "FY 2027 (Jul 2026 to Jun 2027)"]);
    await changeLocale("es");
    expect([fiscalYearName(2027, 1), fiscalYearName(2027, 7)]).toEqual(["Año fiscal 2027", "Año fiscal 2027 (jul 2026 a jun 2027)"]);
    await changeLocale("en");
  });
});
