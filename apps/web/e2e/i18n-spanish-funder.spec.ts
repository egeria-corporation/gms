// SPDX-License-Identifier: AGPL-3.0-only
// The funder side in Spanish, end to end (docs/i18n.md): a funder who chose Spanish opens
// Applications, opens one, then scores an assignment as a reviewer. The fixed text is Spanish;
// what the funder and applicants wrote (titles, rubric criteria, recommendations) stays as written.
import type { Page } from "@playwright/test";
import { expect, start, test } from "./helpers.ts";

/** A rail link in Spanish (the rail is named "Espacio de trabajo del financiador"). */
const railLink = (page: Page, label: string) => page.getByRole("navigation", { name: /^Espacio de trabajo/ }).getByRole("link", { name: label, exact: true });

test("a funder in Spanish opens Applications, opens one, and records a review score", async ({ app: page }) => {
  // The language a visitor chose: the cookie the switcher sets.
  await page.context().addCookies([{ name: "gms_lang", value: "es", url: test.info().project.use.baseURL ?? "http://localhost:5179" }]);
  await start(page, "/w/riverbend");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await test.step("open Applications", async () => {
    await railLink(page, "Solicitudes").click();
    await expect(page.getByRole("heading", { level: 1, name: "Solicitudes" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Por evaluar/ })).toBeVisible();
    await page.getByLabel("Etapa").selectOption({ label: "Letter of intent" });
    await page.getByLabel("Elegibilidad").selectOption({ label: "Cumple" });
  });

  await test.step("open one application", async () => {
    await page.getByRole("table", { name: "Solicitudes" }).getByRole("link", { name: "Community Health Worker Corps" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community Health Worker Corps" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Avanzar a Full proposal" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Elegibilidad/ })).toBeVisible();
  });

  await test.step("record a review score", async () => {
    await railLink(page, "Revisiones").click();
    await expect(page.getByRole("heading", { level: 1, name: "Asignación de revisiones" })).toBeVisible();
    await page.getByRole("link", { name: "Mis asignaciones" }).click();
    const mine = page.getByRole("article").filter({ hasText: "Senior Wellness Navigators" });
    await mine.getByRole("button", { name: "Declarar conflictos y abrir" }).click();
    const coi = page.getByRole("dialog", { name: "Declaración de conflicto de intereses" });
    await expect(coi.getByRole("button", { name: "Declarar que no hay conflicto y abrir" })).toBeDisabled();
    for (const box of await coi.getByRole("checkbox").all()) await box.check();
    await coi.getByRole("button", { name: "Declarar que no hay conflicto y abrir" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Senior Wellness Navigators" })).toBeVisible();

    const card = page.getByRole("complementary", { name: "Hoja de puntuación" });
    await card.getByRole("spinbutton", { name: /Community impact/ }).fill("5");
    await card.getByRole("spinbutton", { name: /Feasibility/ }).fill("4");
    await card.getByRole("spinbutton", { name: /Budget reasonableness/ }).fill("4");
    await card.getByRole("spinbutton", { name: /Reach to underserved families/ }).fill("5");
    await expect(card.getByText("Puntuados: 4 de 4")).toBeVisible();
    await card.getByRole("radio", { name: "Fund", exact: true }).check();
    await card.getByLabel("Comentario para el comité de revisión").fill("Buen alcance y un plan realista.");
    await card.getByRole("button", { name: "Enviar la revisión" }).click();
    await expect(card.getByRole("status")).toContainText("Enviada. Sus puntuaciones quedaron bloqueadas.");
  });
});
