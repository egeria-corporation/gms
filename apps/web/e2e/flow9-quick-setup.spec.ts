// SPDX-License-Identifier: AGPL-3.0-only
// Flow 9 — Funder: from publishing to taking applications. New opportunity → publish → the builder
// and the public page say it is not taking applications → Applications step → quick setup → the
// launch checklist passes → open → the public page offers Apply.
import { expect, rail, start, test } from "./helpers.ts";

test("funder opens applications with quick setup", async ({ app: page }) => {
  await start(page, "/w/riverbend/opportunities");

  await test.step("draft and publish an opportunity", async () => {
    await page.getByRole("link", { name: "New opportunity" }).first().click();
    await expect(page.getByRole("heading", { name: "Opportunity builder" })).toBeVisible();
    await page.getByLabel("Title").fill("The Fund");
    await page.getByLabel("Summary").fill("General operating support for community organizations in the Riverbend valley.");
    await page.getByRole("button", { name: "Save draft" }).first().click();
    await page.getByRole("link", { name: "Dates", exact: true }).first().click();
    await page.getByLabel("Opens").fill("2027-04-01");
    await page.getByLabel("Closes", { exact: true }).fill("2027-06-30");
    await page.getByRole("link", { name: "Publish", exact: true }).first().click();
    await page.getByRole("button", { name: "Publish as open" }).click();
    await expect(page.getByText(/Published · live at/)).toBeVisible();
    await expect(page.getByText("Published, not taking applications").first()).toBeVisible();
    await expect(page.getByText("Not taking applications yet")).toBeVisible();
  });

  await test.step("quick setup, then the checklist passes and applications open", async () => {
    await page.getByRole("link", { name: "Set up applications" }).click();
    await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Quick setup" }).click();
    await expect(page.getByText("Quick setup is done")).toBeVisible();
    await expect(page.getByText("7 of 7 checks pass")).toBeVisible();
    await page.getByRole("button", { name: "Open for applications" }).click();
    await expect(page.getByText("Taking applications")).toBeVisible();
  });

  await test.step("the public page offers Apply", async () => {
    await page.getByRole("link", { name: "Open public page" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "The Fund" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Apply", exact: true })).toBeVisible();
    await expect(page.getByText("Not taking applications yet")).toBeHidden();
    await expect(page.getByText(/The Fund application/).first()).toBeVisible();
  });

  await test.step("the Opportunities list no longer asks for set-up", async () => {
    await page.goBack();
    await rail(page, "Opportunities").click();
    await expect(page.getByRole("link", { name: "Set up applications for The Fund" })).toHaveCount(0);
  });
});
