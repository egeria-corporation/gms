// SPDX-License-Identifier: AGPL-3.0-only
// The applicant screens in Spanish, end to end (docs/i18n.md): an applicant opens Find funding,
// starts an application to a funder outside this GMS from an OpenGrants listing, pastes the
// funder's questions and saves an answer. The screens' own words are Spanish; what the funder
// wrote (the listing, the questions) stays as written.
import type { Page } from "@playwright/test";
import { expect, start, test } from "./helpers.ts";

const LISTING = "Rural Health Network Development Planning";
const railLink = (page: Page, label: string) => page.getByRole("navigation", { name: /^Espacio de trabajo/ }).getByRole("link", { name: label, exact: true });

test("an applicant finds a listing, starts an outside application and saves an answer, in Spanish", async ({ app: page }) => {
  await page.context().addCookies([{ name: "gms_lang", value: "es", url: test.info().project.use.baseURL ?? "http://localhost:5179" }]);
  await start(page, "/w/alder-creek");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { name: "Solicitudes activas" })).toBeVisible();

  await test.step("Find funding: an OpenGrants listing, its details, then start the application", async () => {
    await railLink(page, "Buscar financiamiento").click();
    await expect(page.getByRole("heading", { level: 1, name: "Buscar financiamiento" })).toBeVisible();
    await page.getByRole("tab", { name: "Índice de OpenGrants" }).click();
    await page.getByRole("searchbox", { name: "Buscar en el índice de OpenGrants" }).fill("rural");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    const result = page.getByRole("article", { name: LISTING });
    // The listing reads as its source wrote it.
    await expect(result).toContainText("Health Resources and Services Administration");
    await result.getByRole("button", { name: "Detalles" }).click();
    const details = page.getByRole("dialog", { name: LISTING });
    // The listing's own amount text comes from OpenGrants as written; the labels around it are Spanish.
    await expect(details).toContainText("Up to $100,000");
    await expect(details.getByText("Financiador", { exact: true })).toBeVisible();
    await expect(details.getByRole("link", { name: /Abrir el anuncio original/ })).toHaveAttribute("href", /opengrants\.io/);
    await details.getByRole("button", { name: "Comenzar la solicitud" }).click();
    await expect(page).toHaveURL(/\/w\/alder-creek\/outside\/oap_/);
    await expect(page.getByRole("heading", { level: 1, name: LISTING })).toBeVisible();
    await expect(page.locator(".ph .title")).toContainText("En redacción");
  });

  await test.step("paste the funder's questions: the limits are found and said in Spanish", async () => {
    await page.getByRole("button", { name: "Pegar preguntas" }).first().click();
    const paste = page.getByRole("dialog", { name: "Pegar las preguntas del financiador" });
    await paste.getByLabel("Preguntas").fill("1. Describe the need your project addresses. (250 words)\n\n2. How will you measure success? Maximum 1,500 characters including spaces.");
    await paste.getByRole("button", { name: "Encontrar las preguntas" }).click();
    const proposed = paste.getByRole("list", { name: "Preguntas propuestas" });
    await expect(proposed.getByRole("listitem")).toHaveCount(2);
    await expect(proposed.getByRole("listitem").nth(0)).toContainText("250 palabras (encontrado en el texto)");
    await paste.getByRole("button", { name: "Guardar 2 preguntas" }).click();
    await expect(paste).toBeHidden();
    await expect(page.getByRole("main").getByText("2 preguntas agregadas")).toBeVisible();
  });

  await test.step("write an answer against the funder's limit and save it", async () => {
    // The question is the funder's, as written.
    const q2 = page.getByRole("article", { name: /How will you measure success/ });
    await q2.getByRole("textbox", { name: "Respuesta a la pregunta 2" }).fill("Contamos las citas cumplidas y las derivaciones completadas cada trimestre, frente a nuestra línea de base de 2026.");
    await expect(q2.locator('[data-active="true"]')).toContainText("/ 1,500 caracteres");
    await expect(q2.getByText("Dentro del límite")).toBeVisible();
    await q2.getByRole("button", { name: "Guardar la respuesta" }).click();
    await expect(q2.getByText("Guardada como versión 1")).toBeVisible();
  });
});
