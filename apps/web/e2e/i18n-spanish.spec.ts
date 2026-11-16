// SPDX-License-Identifier: AGPL-3.0-only
// Spanish, end to end (docs/i18n.md): a visitor reads the public pages in Spanish from `?lang=es`,
// the footer switcher or the browser's language, signs in in Spanish, and a signed-in person
// switches from the account menu; the page's `lang`, its words and the focus follow each choice.
import type { Browser, Page } from "@playwright/test";
import { expect, rail, shown, start, test } from "./helpers.ts";

const html = (page: Page) => page.locator("html");
/** A rail link in either language (the rail is named "Funder workspace" / "Espacio de trabajo del financiador"). */
const railLink = (page: Page, label: string) => page.getByRole("navigation", { name: /workspace$|^Espacio de trabajo/ }).getByRole("link", { name: label, exact: true });

/** A tab that starts signed out (the mock keeps its session in sessionStorage). */
async function signedOut(browser: Browser, locale?: string): Promise<Page> {
  const context = await browser.newContext(locale ? { locale } : {});
  await context.addInitScript(() => {
    if (sessionStorage.getItem("gms.mock.session") === null) sessionStorage.setItem("gms.mock.session", "null");
  });
  return context.newPage();
}

test("a visitor reads the site in Spanish, switches in the footer, and signs in in Spanish", async ({ browser }) => {
  const page = await signedOut(browser);
  await page.goto("/?lang=es");
  await expect(html(page)).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1, name: "Otorgue y gestione subvenciones, gratis. Regístrese con su correo." })).toBeVisible();
  const footer = page.getByRole("navigation", { name: "Idioma" });
  await expect(footer.getByRole("link", { name: "Español (beta)" })).toHaveAttribute("aria-current", "true");

  // English, from the footer: the address stops naming a language and focus stays on the switcher.
  await footer.getByRole("link", { name: "English" }).click();
  await expect(html(page)).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Give and manage grants, free. Sign up with your email." })).toBeVisible();
  const english = page.getByRole("navigation", { name: "Language" });
  await expect(english.getByRole("link", { name: "English" })).toBeFocused();

  // Back to Spanish: remembered on this device for the next page.
  await english.getByRole("link", { name: "Español (beta)" }).click();
  await expect(html(page)).toHaveAttribute("lang", "es");
  expect((await page.context().cookies()).find((c) => c.name === "gms_lang")?.value).toBe("es");
  await page.getByRole("link", { name: "Iniciar sesión" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Inicie sesión en OpenGrants GMS" })).toBeVisible();
  await page.getByLabel("Correo de trabajo").fill("sam@newcomer.example");
  await page.getByRole("button", { name: "Enviar el código" }).click();
  await expect(page.getByRole("heading", { name: "Revise su correo" })).toBeVisible();
  const digits = page.getByRole("group", { name: /código/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Cómo usará OpenGrants GMS?" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "¿Cómo usará OpenGrants GMS?" })).toBeVisible();
  await page.context().close();
});

test("a funder page asked for in Spanish shows its fixed text in Spanish and the funder's own words as written", async ({ browser }) => {
  const page = await signedOut(browser);
  await page.goto("/f/riverbend?lang=es");
  await expect(html(page)).toHaveAttribute("lang", "es");
  await expect(page.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(shown(page, "Con la tecnología de OpenGrants Grant Management System")).toBeVisible();
  // What the funder wrote stays in its language.
  await expect(shown(page, "Riverbend Community Foundation").first()).toBeVisible();
  await page.context().close();
});

test("the browser's language picks Spanish when nothing else has", async ({ browser }) => {
  const page = await signedOut(browser, "es-MX");
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1, name: "Otorgue y gestione subvenciones, gratis. Regístrese con su correo." })).toBeVisible();
  await page.context().close();
});

test("a signed-in person switches language from the account menu, and focus comes back to it", async ({ app: page }) => {
  await start(page, "/workspaces");
  await page.getByRole("link", { name: /Riverbend Community Foundation/ }).first().click();
  await expect(rail(page, "Dashboard")).toBeVisible();

  const menuButton = page.getByRole("banner").getByRole("button", { name: /(Funder|Applicant)$/ });
  await menuButton.click();
  const spanish = page.getByRole("menu").getByRole("menuitemradio", { name: "Español (beta)" });
  await expect(spanish).toHaveAttribute("aria-checked", "false");
  await spanish.click();
  await expect(html(page)).toHaveAttribute("lang", "es");
  await expect(railLink(page, "Panel principal")).toBeVisible();
  const menuButtonEs = page.getByRole("banner").getByRole("button", { name: /(Financiador|Solicitante)$/ });
  await expect(menuButtonEs).toBeFocused();

  await menuButtonEs.click();
  await expect(page.getByRole("menu").getByRole("menuitemradio", { name: "Español (beta)" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menu").getByRole("menuitemradio", { name: "English" }).click();
  await expect(html(page)).toHaveAttribute("lang", "en");
  await expect(rail(page, "Dashboard")).toBeVisible();
  await expect(menuButton).toBeFocused();
});
