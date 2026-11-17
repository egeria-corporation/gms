// SPDX-License-Identifier: AGPL-3.0-only
// Flow 19 — The template gallery. Browse /templates → filter by kind and search → preview the
// common application (the form renderer, read-only) → "Use this template" copies it into the
// Riverbend funder workspace → the copy opens in the form builder as a draft of its own → the
// gallery counts the use. A second flow previews the program kit's rubric and emails.
import type { Page } from "@playwright/test";
import { dialog, expect, shown, start, test } from "./helpers.ts";

test("browse the gallery, preview a template and copy it into a funder workspace", async ({ app: page }) => {
  await start(page, "/templates");

  await test.step("browse and filter", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Ready-to-use templates for running a grant program" })).toBeVisible();
    const list = page.getByRole("list", { name: "Templates" });
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(10);
    await page.getByRole("group", { name: "Kind of template" }).getByRole("button", { name: "Application forms" }).click();
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(4);
    await page.getByLabel("Search templates").fill("common");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Common application"]);
    await expect(list.getByText("OpenGrants starter library")).toBeVisible();
  });

  await test.step("preview the template read-only", async () => {
    await templates(page).getByRole("link", { name: "Common application" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Common application" })).toBeVisible();
    const form = page.getByRole("region", { name: "Form: Common application" });
    await expect(form.getByText("Project title").first()).toBeVisible();
    await expect(form.getByText("What will change, and how you will know").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "CC BY 4.0" }).first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "About this template" })).toContainText("41 times");
  });

  await test.step("copy it into the funder workspace", async () => {
    await page.getByRole("button", { name: "Use this template" }).click();
    const d = dialog(page, "Use this template");
    await expect(d.getByText("Workspace: Riverbend Community Foundation")).toBeVisible();
    await d.getByRole("button", { name: "Copy to Riverbend Community Foundation" }).click();
    const done = dialog(page, "Copied to your workspace");
    await expect(done.getByRole("list", { name: "What was copied" })).toContainText("Common application");
    await done.getByRole("link", { name: "Open the draft form" }).click();
  });

  await test.step("the copy is the workspace's own draft", async () => {
    await expect(page.getByRole("heading", { name: /Common application · v1/ })).toBeVisible();
    await expect(shown(page, "Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish v1" })).toBeVisible();
  });

  await test.step("the gallery counts the use", async () => {
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Common application" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "About this template" })).toContainText("42 times");
  });
});

test("preview a program kit: forms, the rubric's criteria and the email text", async ({ app: page }) => {
  await start(page, "/templates/small-grants-program-kit");
  await expect(page.getByRole("heading", { level: 1, name: "Small grants program kit" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Form: Common application" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Form: Final report" })).toBeVisible();
  const rubric = page.getByRole("table", { name: "Five-criterion rubric criteria" });
  await expect(rubric.getByRole("row")).toHaveCount(6);
  await expect(rubric).toContainText("Community impact");
  await expect(page.getByRole("region", { name: "Email: Decline" })).toContainText("Your application to {{funder.name}}");
});

const templates = (page: Page) => page.getByRole("list", { name: "Templates" });
