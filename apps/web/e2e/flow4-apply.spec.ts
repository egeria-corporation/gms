// SPDX-License-Identifier: AGPL-3.0-only
// Flow 4 — Applicant: apply. Opportunity page → Apply with Passport → sign in → onboarding →
// find funding → start → editor (prefilled fields, assign the budget to a consultant, insert from
// the library, validation) → submit → confirmation → status.
import { expect, start, test } from "./helpers.ts";

test("applicant applies", async ({ app: page }) => {
  await start(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();

  await test.step("from the opportunity page to sign-in", async () => {
    await page.getByRole("banner").getByRole("link", { name: "OpenGrants GMS", exact: true }).click();
    await page.getByRole("link", { name: "View a live opportunity" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeVisible();
    await page.getByRole("link", { name: "Apply with Passport" }).first().click();
    await expect(page).toHaveURL(/\/signin\?next=%2Fapply%2Friverbend%2Fcommunity-health-2027/);
  });

  await test.step("sign in with a one-time code and the authenticator", async () => {
    await page.getByLabel("Work email").fill("maria.santos@aldercreek.example");
    await page.getByRole("button", { name: "Send code" }).click();
    const typeCode = async () => {
      const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
      for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    };
    await typeCode();
    await page.getByRole("button", { name: "Verify and continue" }).click();
    // The applicant workspace needs a second step for an admin: enroll the authenticator.
    await expect(page.getByRole("heading", { name: "Set Up Two-Step Verification" })).toBeVisible();
    await page.getByLabel("Enter the 6-digit code from your app").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/w\/alder-creek\/find/);
  });

  await test.step("find funding: eligible, start the application", async () => {
    const health = page.getByRole("article", { name: "Community Health Grants 2027" });
    await expect(health).toContainText("Eligible");
    const housing = page.getByRole("article", { name: "Housing Stability 2027" });
    await expect(housing).toContainText("Eligibility unknown");
    await housing.getByRole("button", { name: "Start anyway" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Housing Stability 2027" })).toBeVisible();
  });

  await test.step("the editor arrives prefilled from Passport", async () => {
    const legalName = page.getByRole("textbox", { name: /^Legal name/ });
    await expect(legalName).toHaveValue("Alder Creek Family Services");
    await expect(legalName).not.toBeEditable();
    await expect(page.getByRole("region", { name: "Organization" }).getByRole("link", { name: "Edit in Passport" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Validation/ })).toContainText("6");
  });

  await test.step("assign the budget section to a consultant", async () => {
    await page.getByRole("tab", { name: "Assignments" }).click();
    const panel = page.getByRole("tabpanel", { name: "Assignments" });
    await panel.getByLabel("Budget and attachments").selectOption({ label: "Lena Fischer (consultant)" });
    await expect(panel.getByLabel("Budget and attachments")).toHaveValue(/.+/);
  });

  await test.step("fill the form, inserting the need statement from the answer library", async () => {
    await page.getByLabel(/^Project title/).fill("Stable Homes Navigation");
    await page.getByLabel(/^Requested amount/).fill("90000");
    await page.getByLabel(/^Project type/).selectOption({ label: "Direct service" });
    await page.getByRole("button", { name: "Insert from answer library" }).click();
    const library = page.getByRole("dialog", { name: "Insert from answer library" });
    // A value that comes from Passport is never a target for pasted text.
    await expect(library.getByLabel("Insert into").getByRole("option", { name: "Legal name" })).toHaveCount(0);
    await library.getByLabel("Answer").selectOption({ label: "Need · v3 · 27 words" });
    await library.getByLabel("Insert into").selectOption({ label: "What need does this project address?" });
    await library.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(library).toBeHidden();
    await expect(page.getByLabel(/^What need does this project address/)).toHaveValue(/Families in the Alder Creek valley/);
    await page.getByLabel("Amount for Personnel").fill("60000");
    await page.getByLabel("Amount for Travel & vehicle").fill("15000");
    await page.getByLabel("Amount for Supplies").fill("9000");
    await page.getByLabel("Amount for Indirect").fill("6000");
    const attest = page.getByRole("group", { name: /^Attestation/ });
    await attest.getByLabel("Type your full legal name").fill("Maria Santos");
    await attest.getByText("I am authorized to sign and I attest that this information is accurate.").click();
    await expect(attest.getByRole("checkbox")).toBeChecked();
    await page.getByRole("tab", { name: /^Validation/ }).click();
    // Autosave sends the last edits; the validation panel then has nothing left to fix.
    await expect(page.getByRole("tabpanel", { name: /^Validation/ })).toContainText("Nothing left to fix in this form", { timeout: 15_000 });
  });

  await test.step("submit: the readiness check, then confirmation", async () => {
    await page.getByRole("button", { name: "Submit…" }).click();
    const ready = page.getByRole("dialog", { name: "Ready to submit?" });
    // An unknown eligibility rule never blocks: a program officer reviews it.
    await expect(ready.getByRole("status")).toContainText("2 of 3 checks pass · 1 unknown");
    await expect(ready).toContainText("Level L3 and your attestation are attached at submission");
    await ready.getByRole("button", { name: "Submit application" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Submitted to Riverbend Community Foundation" })).toBeVisible();
    await expect(page.locator("main")).toContainText(/L3\s*attestation\s*·\s*payee status \(bank name and last four digits only\)/);
  });

  await test.step("the status page shows where it stands", async () => {
    await page.getByRole("link", { name: "View status" }).click();
    await expect(page.locator("main")).toContainText("Submitted");
    await expect(page.getByRole("button", { name: "Withdraw application" })).toBeVisible();
  });
});
