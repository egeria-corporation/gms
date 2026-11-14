// SPDX-License-Identifier: AGPL-3.0-only
// Flow 1 — Funder: launch a cycle. First-run applications → create a program → new opportunity →
// build the LOI form with two Passport prefills and a budget table → competition launch checklist
// passes → open → the public page is live.
import { expect, rail, start, test } from "./helpers.ts";

test("funder launches a cycle", async ({ app: page }) => {
  await start(page, "/w/riverbend/applications/first-run");
  await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();

  await test.step("create a program", async () => {
    await page.getByRole("link", { name: "Create a program" }).click();
    await page.getByRole("button", { name: "New program" }).click();
    const d = page.getByRole("dialog", { name: "New program" });
    await d.getByLabel("Name").fill("Rural Health Access 2028");
    await d.getByLabel("Fiscal year").fill("2028");
    await d.getByLabel("Budget (USD)").fill("500000");
    await d.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByRole("region", { name: "Rural Health Access 2028" })).toBeVisible();
  });

  await test.step("draft the opportunity", async () => {
    await page.getByRole("region", { name: "Rural Health Access 2028" }).getByRole("link", { name: "New opportunity" }).click();
    await expect(page.getByRole("heading", { name: "Opportunity builder" })).toBeVisible();
    await page.getByLabel("Title").fill("Rural Health Access Grants 2028");
    await page.getByLabel("Summary").fill("Operating support for clinics that serve rural families in Riverbend County.");
    await expect(page.getByLabel("Program")).toHaveValue(/.+/);
    await page.getByRole("button", { name: "Save draft" }).first().click();
    await page.getByRole("link", { name: "Funding", exact: true }).first().click();
    await page.getByLabel("Total available").fill("500000");
    await page.getByLabel("Smallest award").fill("25000");
    await page.getByLabel("Largest award").fill("100000");
    await page.getByRole("link", { name: "Dates", exact: true }).first().click();
    await page.getByLabel("Opens").fill("2028-01-10");
    await page.getByLabel("Closes", { exact: true }).fill("2028-03-15");
    await page.getByRole("link", { name: "Who can apply", exact: true }).first().click();
    await page.getByLabel("Rule to add").selectOption({ label: "IRS tax-exempt status · Passport profile" });
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByRole("list", { name: "Eligibility rules" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Save draft" }).first().click();
  });

  await test.step("build the LOI form: two Passport prefills and a budget table", async () => {
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Forms", exact: true }).first().click();
    await page.getByRole("button", { name: "New blank form" }).click();
    await page.getByLabel("Form title").fill("Rural Health LOI");
    await page.getByLabel("Used for").selectOption({ label: "Letter of intent" });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("button", { name: "Add Short text" }).click();
    await page.getByLabel("Label").fill("Legal name");
    await page.getByRole("button", { name: /^Prefill from Passport/ }).click();
    await page.getByRole("list", { name: "Passport fields" }).getByRole("button", { name: /^Organization name/ }).click();
    await page.getByRole("button", { name: "Add Short text" }).click();
    await page.getByLabel("Label").fill("EIN");
    await page.getByRole("button", { name: /^Prefill from Passport/ }).click();
    await page.getByRole("list", { name: "Passport fields" }).getByRole("button", { name: /^EIN/ }).click();
    await page.getByRole("button", { name: "Add Budget table" }).click();
    await expect(page.getByText(/3 fields · 2 Passport prefills/)).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: /^Publish v1/ }).click();
  });

  await test.step("competition: pin the form, pass the launch checklist, open", async () => {
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Competition for Rural Health Access Grants 2028" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Rural Health Access Grants 2028");
    await page.getByRole("button", { name: "Set up the competition" }).click();
    const stages = page.getByRole("dialog", { name: "Edit stages" });
    await stages.getByLabel("Stage 1 name").fill("Letter of intent");
    await stages.getByLabel("Opens").fill("2028-01-10");
    await stages.getByLabel("Closes").fill("2028-03-15");
    await stages.getByLabel("Pin a form to stage 1").selectOption({ label: "Rural Health LOI · v1" });
    await stages.getByLabel("Rubric").selectOption({ label: "LOI screening rubric · v1" });
    await stages.getByRole("button", { name: "Save stages" }).click();
    await expect(stages).toBeHidden();

    // The checklist blocks opening until the opportunity is published.
    const checklist = page.getByRole("region", { name: "Launch checklist" });
    await expect(checklist.getByRole("status")).toContainText("6 of 7 checks pass");
    await expect(checklist.getByRole("button", { name: "Open competition" })).toBeDisabled();
    await checklist.getByRole("link", { name: /Fix/ }).click();
    await page.getByRole("link", { name: "Publish", exact: true }).first().click();
    await page.getByRole("button", { name: "Publish as open" }).click();
    // Published, but its competition is still a draft: the builder says so.
    await expect(page.getByText("Published, not taking applications").first()).toBeVisible();
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Competition for Rural Health Access Grants 2028" }).click();
    const ready = page.getByRole("region", { name: "Launch checklist" });
    await expect(ready.getByRole("status")).toContainText("7 of 7 checks pass");
    await ready.getByRole("button", { name: "Open competition" }).click();
  });

  await test.step("the public page is live", async () => {
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Public page of Rural Health Access Grants 2028" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rural Health Access Grants 2028" })).toBeVisible();
  });
});
