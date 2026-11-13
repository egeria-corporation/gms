// SPDX-License-Identifier: AGPL-3.0-only
// The landing page on a phone and on a desktop: Sign in stays visible, nothing scrolls sideways,
// the menu opens and closes, and both start buttons lead to the right setup.
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, start, test } from "./helpers.ts";

const require = createRequire(import.meta.url);
const phone = { width: 390, height: 844 };

async function signInAs(page: Page, email: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

/** The mock starts signed in as the demo funder; sign out and come back to the landing page by clicking. */
async function toLanding(page: Page) {
  await start(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("link", { name: "Learn how OpenGrants GMS works" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("on a phone, Sign in is visible, the page does not scroll sideways and the menu works", async ({ app: page }) => {
  await page.setViewportSize(phone);
  await start(page, "/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const menu = page.getByRole("button", { name: "Menu" });
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "For funders" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await menu.click();
  await nav.getByRole("link", { name: "Self-host" }).click();
  await expect(nav).toBeHidden();
});

test("on a desktop the section links show and there is no Menu button", async ({ app: page }) => {
  await start(page, "/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
});

test("the funder button leads to funder setup", async ({ app: page }) => {
  await toLanding(page);
  await page.getByRole("link", { name: /I’m a funder: start free/ }).click();
  await expect(page).toHaveURL(/\/signin\?as=funder/);
  await signInAs(page, "sam@newcomer.example");
  await expect(page).toHaveURL(/\/onboarding\/funder\/organization/);
  await expect(page.getByLabel(/Organization name/)).toBeVisible();
});

test("the grantee button leads to grantee setup with the email form open", async ({ app: page }) => {
  await toLanding(page);
  await page.getByRole("link", { name: /I’m a grantee or applicant: start free/ }).click();
  await expect(page).toHaveURL(/\/signin\?as=grantee/);
  await signInAs(page, "sam@newcomer.example");
  await expect(page).toHaveURL(/\/onboarding\/applicant\?start=email/);
  await expect(page.getByRole("button", { name: "Create my workspace" })).toBeVisible();
});

for (const [name, size] of [["phone", phone], ["desktop", { width: 1366, height: 900 }]] as const) {
  test(`no serious accessibility problems on the landing page (${name})`, async ({ app: page }) => {
    await page.setViewportSize(size);
    await start(page, "/");
    await page.addScriptTag({ path: require.resolve("axe-core") });
    const found = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }> } }).axe;
      const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`);
    });
    expect(found).toEqual([]);
  });
}
