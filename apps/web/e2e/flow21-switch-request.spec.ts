// SPDX-License-Identifier: AGPL-3.0-only
// Flow 21 — Switch and request a free migration. From /switch, open the Submittable page (sources
// and date stamp), fill "Request a free migration", see the preview of exactly what will be sent,
// and send it (mock mode). The send waits for a person's few seconds after the form was shown:
// the page clock is moved on instead of waiting.
import { expect, start, test } from "./helpers.ts";

test("switch from Submittable and request a free migration", async ({ app: page }) => {
  await page.clock.install();
  await start(page, "/switch");

  await test.step("the list of systems leads to the Submittable page", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Switching to the OpenGrants Grant Management System" })).toBeVisible();
    await page.getByRole("link", { name: "Submittable", exact: true }).click();
    await expect(page).toHaveURL(/\/switch\/submittable$/);
    await expect(page.getByRole("heading", { level: 1, name: "Moving from Submittable to the OpenGrants Grant Management System" })).toBeVisible();
    await expect(page.getByText("Switching · facts as of November 2026")).toBeVisible();
    const sources = page.getByRole("list", { name: "Sources" }).getByRole("link");
    await expect(sources).toHaveCount(2);
    await expect(sources.first()).toHaveAttribute("href", "https://submittable.help/en/articles/904906");
    await expect(page.getByTestId("switch-note")).toContainText("Product names are trademarks of their owners. Facts as of November 2026; tell us if something changed.");
  });

  await test.step("fill the request and see exactly what will be sent", async () => {
    const form = page.getByRole("form", { name: "Request a free migration" });
    await expect(form.getByLabel(/Current system/)).toHaveValue("submittable");
    await form.getByLabel(/Your name/).fill("Ana Ruiz");
    await form.getByLabel(/Work email/).fill("ana@riverbendcf.example");
    await form.getByLabel(/^Organization/).fill("Riverbend Community Foundation");
    await form.getByLabel(/Programs, about how many/).selectOption("2-5");
    await form.getByLabel(/Past awards, about how many/).selectOption("100-999");
    await form.getByLabel(/When you hope to move/).selectOption("3-months");
    await form.getByLabel(/Note/).fill("Two cycles a year. Our acct 11111 is on file.");
    await form.getByRole("button", { name: "Preview what will be sent" }).click();
    const preview = form.getByRole("region", { name: "What will be sent" });
    await expect(preview).toContainText("hello@agents.opengrants.io");
    await expect(preview).toContainText("Migration request: Riverbend Community Foundation (from Submittable)");
    await expect(page.getByTestId("migration-email-text")).toContainText("Current system: Submittable");
    await expect(page.getByTestId("migration-email-text")).toContainText("Our acct [number removed] is on file.");
    await expect(page.getByTestId("migration-email-text")).not.toContainText("11111");
  });

  await test.step("send it", async () => {
    await page.clock.fastForward(5_000);
    await page.getByRole("button", { name: "Send the request" }).click();
    await expect(page.getByText("Request sent")).toBeVisible();
    await expect(page.getByText("A person at OpenGrants will reply to ana@riverbendcf.example. Migration help can start right away.")).toBeVisible();
  });
});

test("on a phone, a switch page does not scroll sideways", async ({ app: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, "/switch/foundant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
