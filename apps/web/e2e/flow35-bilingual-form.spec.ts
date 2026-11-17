// SPDX-License-Identifier: AGPL-3.0-only
// Flow 35 — Bilingual forms (E6, docs/forms.md "Languages"). A funder adds Spanish to its letter
// of intent: the next version, Add Spanish, one text typed, the rest drafted by the assistant and
// reviewed one by one (publishing waits for that), the applicant preview in Spanish, publish.
// Then an applicant who reads Spanish applies with that letter of intent: the questions, help and
// options are the funder's Spanish, the answers are stored as the funder's own values, and the
// application is submitted. (Mock state is per role, so the applicant's call pins the seeded
// Spanish letter of intent, the same text the funder writes here.)
import { expect, shown, start, test } from "./helpers.ts";

const FORM = "frm_70000000-0000-7000-8000-000000000001";

test("a funder adds Spanish to a form, and an applicant applies in Spanish", async ({ app: page }) => {
  await test.step("the funder starts version 3 and adds Spanish", async () => {
    await start(page, `/w/riverbend/forms/${FORM}/edit`);
    await page.getByRole("button", { name: "Create v3 to edit" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Letter of intent · v3" })).toBeVisible();
    await page.getByRole("button", { name: "Add Spanish" }).click();
    await expect(page.getByLabel("Written in")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Translate" })).toHaveAttribute("aria-pressed", "true");
    await expect(shown(page, /^Spanish: 0 of \d+ translated$/).first()).toBeVisible();
  });

  const rows = page.getByRole("list", { name: "Spanish text" });

  await test.step("side by side: the funder types the title, the assistant drafts the rest", async () => {
    await rows.getByRole("textbox", { name: "Form title Letter of intent" }).fill("Carta de intención");
    await expect(shown(page, /^Spanish: 1 of \d+ translated$/).first()).toBeVisible();
    await page.getByRole("button", { name: "Draft the missing texts" }).click();
    await expect(shown(page, /drafts added\. Review each one below\./)).toBeVisible();
    await expect(rows.getByRole("textbox", { name: "Section title Project" })).toHaveValue("Proyecto");
    await expect(rows.getByRole("textbox", { name: "Option Direct service" })).toHaveValue("Servicio directo");
    // The title the funder wrote is never replaced by a draft.
    await expect(rows.getByRole("textbox", { name: "Form title Letter of intent" })).toHaveValue("Carta de intención");
    await expect(shown(page, /assistant drafts to review$/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish v3" })).toBeDisabled();
    await expect(shown(page, "Review the assistant's drafts before publishing.")).toBeVisible();
  });

  await test.step("the funder reviews every draft: Spanish complete", async () => {
    const help = rows.getByRole("textbox", { name: /^Help text Reviewers see this field/ });
    await help.fill("El equipo de revisión ve este campo. No incluya datos de salud de personas identificadas.");
    const review = rows.getByRole("button", { name: "Mark as reviewed" });
    while ((await review.count()) > 0) await review.first().click();
    await expect(shown(page, "Spanish complete").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish v3" })).toBeEnabled();
  });

  await test.step("the applicant preview in Spanish, then publish", async () => {
    await page.getByRole("button", { name: "Preview as applicant" }).click();
    const preview = page.getByRole("region", { name: "Applicant preview" });
    await preview.getByRole("group", { name: "Preview in" }).getByRole("button", { name: "Spanish" }).click();
    await expect(preview.getByRole("region", { name: "Proyecto" })).toBeVisible();
    await expect(preview.getByLabel(/^Tipo de proyecto/)).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Publish v3" }).click();
    await expect(shown(page, "Version 3 is published and cannot change")).toBeVisible();
  });

  await test.step("an applicant who reads Spanish starts an application with that letter of intent", async () => {
    await page.context().addCookies([{ name: "gms_lang", value: "es", url: test.info().project.use.baseURL ?? "http://localhost:5179" }]);
    await start(page, "/w/alder-creek/find");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await page.getByRole("article", { name: "Housing Stability 2027" }).getByRole("button", { name: "Comenzar de todos modos" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Housing Stability 2027" })).toBeVisible();
    // The funder's questions, in its Spanish; no note, because it translated everything.
    await expect(page.getByRole("region", { name: "Proyecto" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Presupuesto y archivos adjuntos" })).toBeVisible();
    await expect(page.getByTestId("form-language-note")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /^Nombre legal/ })).toHaveValue("Alder Creek Family Services");
  });

  await test.step("the applicant answers in Spanish and submits; the answers are the funder's values", async () => {
    await page.getByLabel(/^Título del proyecto/).fill("Navegación para hogares estables");
    await page.getByLabel(/^Monto solicitado/).fill("90000");
    const kind = page.getByLabel(/^Tipo de proyecto/);
    await kind.selectOption({ label: "Servicio directo" });
    await expect(kind).toHaveValue("Direct service");
    await page.getByLabel(/^¿Qué necesidad atiende este proyecto\?/).fill("Las familias del valle pierden su vivienda por atrasos pequeños en el alquiler.");
    await page.getByLabel("Monto de Personal").fill("60000");
    await page.getByLabel("Monto de Viajes y vehículo").fill("15000");
    await page.getByLabel("Monto de Materiales").fill("9000");
    await page.getByLabel("Monto de Costos indirectos").fill("6000");
    const attest = page.getByRole("group", { name: /^Declaración/ });
    await attest.getByLabel("Escriba su nombre legal completo").fill("Maria Santos");
    await attest.getByText("Estoy autorizado(a) para firmar y declaro que esta información es correcta.").click();
    await page.getByRole("tab", { name: /^Validación/ }).click();
    await expect(page.getByRole("tabpanel", { name: /^Validación/ })).toContainText("No queda nada por corregir en este formulario", { timeout: 15_000 });
    await page.getByRole("button", { name: "Enviar…" }).click();
    const ready = page.getByRole("dialog", { name: "¿Lista para enviar?" });
    await ready.getByRole("button", { name: "Enviar la solicitud" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Enviada a Riverbend Community Foundation" })).toBeVisible();
  });
});
