// SPDX-License-Identifier: AGPL-3.0-only
// The funder and reviewer screens in Spanish (docs/i18n.md): the fixed text follows the page's
// language, what the funder wrote stays as written, dates read "15 de noviembre de 2026", and the
// report builder names its columns in Spanish while a saved view keeps column ids and a
// downloaded CSV gets its header row in the language of the person who downloads it.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { mockReportsStore } from "../src/api/reportsHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { changeLocale } from "../src/i18n/current.ts";
import { downloadBlob } from "../src/lib/browser.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import type * as Browser from "../src/lib/browser.ts";
import { csvInPageLanguage, localizeDataSet } from "../src/screens/funder/reportWords.ts";
import { MOCK_DATA_SETS } from "../src/mocks/reports.ts";
import { outColumns, emptyDefinition } from "../src/lib/reports.ts";

vi.mock("../src/lib/browser.ts", async (orig) => ({ ...(await orig<typeof Browser>()), downloadBlob: vi.fn() }));

async function riverbend(): Promise<Services> {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  return services;
}
function open(path: string, services: Services) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}
const spanish = () => act(() => changeLocale("es"));

describe("the funder rail in Spanish", () => {
  it("marks the current item and hides what a reviewer cannot use", async () => {
    await spanish();
    try {
      const memberships = MOCK_MEMBERSHIPS.map((m) => (m.handle === "riverbend" ? { ...m, role: "reviewer", requiresMfa: false } : m));
      open("/w/riverbend", createMockServices({ session: demoSession(), memberships }));
      const nav = await screen.findByRole("navigation", { name: "Espacio de trabajo del financiador" });
      expect(within(nav).getByRole("link", { name: "Panel principal" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Solicitudes" })).toBeInTheDocument();
      expect(within(nav).queryByRole("link", { name: "Pagos" })).toBeNull();
      expect(within(nav).queryByRole("link", { name: "Configuración" })).toBeNull();
    } finally {
      await act(() => changeLocale("en"));
    }
  });
});

describe("the reviewer portal in Spanish", () => {
  it("scores an assignment: Spanish words, the rubric as the funder wrote it, a Spanish date", async () => {
    const services = await riverbend();
    await spanish();
    open(`/review/score/${MOCK_IDS.danaScoring}`, services);
    expect(await screen.findByRole("heading", { level: 1, name: "Shelter Health Liaison" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    const card = screen.getByRole("complementary", { name: "Hoja de puntuación" });
    // The criteria are the funder's words; the label around them is Spanish.
    const set = (label: RegExp, v: string) => fireEvent.change(within(card).getByRole("spinbutton", { name: label }), { target: { value: v } });
    expect(within(card).getByRole("spinbutton", { name: /^Puntuación de Community impact, de 1 a 5$/ })).toBeInTheDocument();
    set(/Community impact/, "5");
    set(/Feasibility/, "4");
    set(/Budget reasonableness/, "4");
    expect(within(card).getByText("Puntuados: 3 de 4")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Enviar la revisión" }));
    expect(await within(card).findByText("Puntúe este criterio antes de enviar")).toBeInTheDocument();
    set(/Reach to underserved families/, "5");
    await userEvent.click(within(card).getByRole("radio", { name: "Fund" }));
    await userEvent.click(within(card).getByRole("button", { name: "Enviar la revisión" }));
    expect(await screen.findByText("Enviada. Sus puntuaciones quedaron bloqueadas.")).toBeInTheDocument();
    // A due date spells the month out in Spanish.
    const due = screen.queryByText(/^Vence el /);
    if (due) expect(due.textContent).toMatch(/^Vence el \d{1,2} de [a-záéíóú]+ de \d{4}$/);
  });
});

describe("the funder screens in Spanish", () => {
  it("lists applications with Spanish labels, counts and views, and the funder's own names as written", async () => {
    const services = await riverbend();
    await spanish();
    open("/w/riverbend/applications", services);
    expect(await screen.findByRole("heading", { level: 1, name: "Solicitudes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Por evaluar/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Etapa" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Solicitudes" });
    expect(within(table).getByRole("columnheader", { name: /Solicitante/ })).toBeInTheDocument();
    expect(screen.getByText(/^Recibidas: \d+$/)).toBeInTheDocument();
    // An English word left on the screen would show here; the funder's content is allowed.
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.queryByText("Needs screening")).toBeNull();
  });

  it("names the award tabs and closeout checks in Spanish", async () => {
    const services = await riverbend();
    await spanish();
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, services);
    const tabs = await screen.findByRole("tablist", { name: "Secciones de la subvención" });
    expect(within(tabs).getByRole("tab", { name: /Convenio/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /Enmiendas/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole("tab", { name: /Agreement/ })).toBeNull();
  });
});

describe("the report builder in Spanish", () => {
  it("names data sets and columns in Spanish, keeps column ids in a saved view, and writes the CSV header in Spanish", async () => {
    const services = await riverbend();
    await spanish();
    open("/w/riverbend/report-builder", services);
    expect(await screen.findByRole("heading", { name: "Generador de informes", level: 1 }));
    await userEvent.selectOptions(await screen.findByLabelText("Conjunto de datos"), "awards");
    expect(screen.getByRole("option", { name: "Subvenciones" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Monto otorgado/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Agrupar por"), "program");
    await userEvent.selectOptions(screen.getByLabelText("Agregar un resumen"), "sum:amount");
    await userEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    const table = await screen.findByRole("table", { name: "Vista previa del informe" });
    expect(within(table).getByRole("columnheader", { name: "Programa" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Total de monto otorgado" })).toBeInTheDocument();

    vi.mocked(downloadBlob).mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const csv = await (vi.mocked(downloadBlob).mock.calls[0]![0] as Blob).text();
    expect(csv.split("\r\n")[0]).toBe("Programa,Cantidad,Total de monto otorgado");

    await userEvent.click(screen.getByRole("button", { name: "Guardar la vista" }));
    const dialog = await screen.findByRole("dialog", { name: "Guardar la vista" });
    await userEvent.type(within(dialog).getByLabelText(/Nombre/), "Por programa");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar la vista" }));
    await waitFor(() => {
      const saved = mockReportsStore(services).views.find((v) => v.name === "Por programa");
      // The view holds ids, so it reads the same in English.
      expect(saved?.definition).toMatchObject({ dataSet: "awards", groupBy: ["program"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }] });
    });
  });

  it("leaves a CSV it cannot vouch for as it came, and English as English", async () => {
    const awards = MOCK_DATA_SETS.find((d) => d.key === "awards")!;
    const d = emptyDefinition("awards", ["title", "amount"]);
    const english = outColumns(awards, d);
    await changeLocale("es");
    const localized = outColumns(localizeDataSet(awards), d);
    const rewritten = await csvInPageLanguage(new Blob(["Award,Awarded amount\r\nA,1.00\r\n"]), english, localized);
    expect(await rewritten.text()).toBe("Subvención,Monto otorgado\r\nA,1.00\r\n");
    const unknown = new Blob(["Something else,Entirely\r\nA,1.00\r\n"]);
    expect(await (await csvInPageLanguage(unknown, english, localized)).text()).toBe("Something else,Entirely\r\nA,1.00\r\n");
    await changeLocale("en");
    const same = new Blob(["Award,Awarded amount\r\n"]);
    expect(await csvInPageLanguage(same, english, outColumns(localizeDataSet(awards), d))).toBe(same);
  });
});
