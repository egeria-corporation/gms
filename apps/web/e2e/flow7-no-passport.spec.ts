// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from "@playwright/test";
// Flow 7 — Using the GMS without Passport. A newcomer sets up an applicant organization from a
// short profile; an install without Passport offers no Passport step anywhere; a funder sees
// "Not verified" beside an applicant that has no Passport record and sets the two opportunity toggles.
import { expect, start, test } from "./helpers.ts";

/** The mock starts signed in as the demo funder: sign out, then sign in as a person with no workspaces. */
async function signIn(page: Page) {
  await start(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();
  await page.getByLabel("Work email").fill("sam@newcomer.example");
  await page.getByRole("button", { name: "Send code" }).click();
  const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

async function signInAsNewcomer(page: Page) {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "How Will You Use OpenGrants GMS?" })).toBeVisible();
  await page.getByRole("radio", { name: /Set up my applicant organization/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test("applicant sets up without Passport", async ({ app: page }) => {
  await signInAsNewcomer(page);

  await test.step("both choices are offered, Passport recommended", async () => {
    await expect(page.getByRole("heading", { name: "Continue with Passport" })).toBeVisible();
    await expect(page.getByText("Recommended")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up without Passport" })).toBeVisible();
  });

  await test.step("a short profile: legal name and contact email are required", async () => {
    await page.getByRole("button", { name: "Set up without Passport" }).click();
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await expect(page.getByText("Enter your organization’s legal name")).toBeVisible();
    await page.getByLabel(/^Legal name/).fill("Pine Ridge Youth Alliance");
    await page.getByLabel(/^Contact email/).fill("hello@pineridge.example");
    await page.getByRole("button", { name: "Create my workspace" }).click();
  });

  await test.step("the workspace opens (after the authenticator step an admin needs)", async () => {
    await expect(page.getByRole("heading", { name: "Set Up Two-Step Verification" })).toBeVisible();
    await page.getByLabel("Enter the 6-digit code from your app").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/w\/pine-ridge-youth-alliance/);
  });

  await test.step("settings: the details are the organization's own, shown as not verified", async () => {
    await page.getByRole("navigation", { name: /workspace$/ }).getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Organization details" })).toBeVisible();
    await expect(page.getByText(/Funders see this organization as not verified/)).toBeVisible();
    await expect(page.getByLabel(/^Legal name/)).toHaveValue("Pine Ridge Youth Alliance");
    await page.getByLabel(/^Legal name/).fill("Pine Ridge Youth Alliance Inc.");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect Passport" })).toBeVisible();
  });
});

test.describe("an install without Passport", () => {
  test.beforeEach(async ({ app: page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("gms.mock.passport", "off"));
  });

  test("no Passport button or step anywhere", async ({ app: page }) => {
    await start(page, "/workspaces");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Passport/ })).toHaveCount(0);

    await page.getByLabel("Work email").fill("sam@newcomer.example");
    await page.getByRole("button", { name: "Send code" }).click();
    const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.getByRole("radio", { name: /Set up my applicant organization/ }).click();
    await expect(page.getByText(/Link your Passport record/)).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Set up without Passport" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Continue with Passport" })).toHaveCount(0);
    await expect(page.getByText("Recommended")).toHaveCount(0);
  });
});

test("funder sees Not verified and sets the verification toggles", async ({ app: page }) => {
  await start(page, "/w/riverbend/applications");
  const row = page.getByRole("link", { name: "Meadowbrook Food Bank" }).locator("xpath=ancestor::td");
  await expect(row.getByText("Not verified")).toBeVisible();
  const alder = page.getByRole("link", { name: "Alder Creek Family Services" }).first().locator("xpath=ancestor::td");
  await expect(alder.getByText("Not verified")).toHaveCount(0);

  await test.step("opportunity settings: the two toggles", async () => {
    await page.getByRole("navigation", { name: /workspace$/ }).getByRole("link", { name: "Opportunities", exact: true }).click();
    await page.getByRole("link", { name: /Community Health Grants 2027/ }).first().click();
    await page.getByRole("link", { name: "Who can apply", exact: true }).first().click();
    await page.getByLabel(/Accept details applicants enter themselves/).check();
    await page.getByLabel(/Require a linked Passport/).check();
    await page.getByRole("button", { name: "Save draft" }).first().click();
    await expect(page.getByLabel(/Accept details applicants enter themselves/)).toBeChecked();
  });
});
