// SPDX-License-Identifier: AGPL-3.0-only
// Flow 18 — Single sign-on (SAML) for funder workspaces, in mock mode. An admin opens Settings →
// Security and sees the domain pending with its DNS record, the values for the IT team and why SSO
// cannot be required yet. Someone at cascadecounty.example, whose workspace requires single
// sign-on, signs in with an email code, is told "This workspace requires single sign-on", and gets
// in through single sign-on with the same address.
import { expect, rail, shown, start, test } from "./helpers.ts";

test("settings show a pending single sign-on domain", async ({ app: page }) => {
  await start(page, "/workspaces");
  await page.getByRole("link", { name: /Riverbend Community Foundation/ }).first().click();
  await rail(page, "Settings").click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Security · Single sign-on" }).click();
  await expect(page).toHaveURL(/\/w\/riverbend\/settings\/security$/);

  await test.step("the domain is pending, with the DNS record to add", async () => {
    const domain = page.getByRole("list", { name: "Single sign-on domains" }).getByRole("listitem").filter({ hasText: "riverbendcf.example" });
    await expect(domain.getByText("Pending", { exact: true })).toBeVisible();
    await expect(domain.getByText("_gms-verify.riverbendcf.example")).toBeVisible();
    await domain.getByRole("button", { name: "Check DNS record" }).click();
    await expect(domain.getByText(/could not find the record yet/)).toBeVisible();
  });

  await test.step("single sign-on cannot be required until a domain is active", async () => {
    await expect(page.getByRole("switch", { name: "Require single sign-on for people with these email addresses" })).toBeDisabled();
    await expect(shown(page, "Single sign-on can be required once one of your domains is active.")).toBeVisible();
  });

  await test.step("the IT team's values come from the project's address", async () => {
    await expect(shown(page, /\/auth\/v1\/sso\/saml\/acs$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download metadata file" })).toHaveAttribute("href", /\/auth\/v1\/sso\/saml\/metadata\?download=true$/);
  });
});

test("a workspace that requires single sign-on says so, and single sign-on gets the person in", async ({ app: page }) => {
  await start(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();
  // A link to the workspace, as in an email from a colleague.
  await page.goto("/w/cascade-county");
  await expect(page).toHaveURL(/\/signin\?next=%2Fw%2Fcascade-county/);

  await test.step("an email code for an address on the required domain", async () => {
    await page.getByLabel("Work email").fill("sam.lee@cascadecounty.example");
    await page.getByRole("button", { name: "Send code" }).click();
    const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  });

  await test.step("the workspace says it requires single sign-on", async () => {
    await expect(page).toHaveURL(/\/signin\?.*step=sso/);
    await expect(page.getByRole("alert")).toContainText("This workspace requires single sign-on");
    await expect(page.getByLabel("Work email")).toHaveValue("sam.lee@cascadecounty.example");
  });

  await test.step("single sign-on with the same address opens it", async () => {
    await page.getByRole("button", { name: "Continue with single sign-on" }).click();
    await expect(page).toHaveURL(/\/w\/cascade-county$/);
    await expect(page.getByRole("banner").getByRole("button", { name: /^Cascade County Health Department/ })).toBeVisible();
  });
});
