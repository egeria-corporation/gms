// SPDX-License-Identifier: AGPL-3.0-only
// Flow 8 — Giving an award directly. A funder gives an award to an organization that has not
// applied, by naming it and a contact address. The contact signs in with that address, sets up the
// organization without Passport, accepts, and both sides then show the award as accepted.
import type { Page } from "@playwright/test";
import { expect, start, test } from "./helpers.ts";

/** Moves within the app without a reload: the mock's state lives in the page. */
async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** What a real install would have emailed to the contact: the claim link. */
const lastInvitationLink = (page: Page) =>
  page.evaluate(() => {
    const mock = (window as unknown as { __gmsMock: { outbox(): { link: string; to: string }[] } }).__gmsMock;
    return mock.outbox().at(-1)!;
  });

async function signOut(page: Page) {
  await go(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();
}

async function signInWith(page: Page, email: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

test("a funder gives an award directly and the organization claims it without Passport", async ({ app: page }) => {
  await start(page, "/w/riverbend/awards");

  await test.step("the funder fills in New award; each missing field is named in plain words", async () => {
    await page.getByRole("link", { name: "New award" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New award" })).toBeVisible();
    await expect(page.getByText(/We'll email this person a link/)).toBeVisible();
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Enter the organization's name.")).toBeVisible();
    await expect(page.getByText("Give the award a title.")).toBeVisible();
    await page.getByLabel(/^Organization name/).fill("Pine Ridge Youth Alliance");
    await page.getByLabel(/^Contact email/).fill("sam@newcomer.example");
    await page.getByLabel(/^Award title/).fill("Summer Youth Programs");
    await page.getByLabel(/^Amount/).fill("25000");
    await page.getByLabel(/^Message/).fill("We are glad to support your work.");
    await page.getByRole("button", { name: "Send invitation" }).click();
  });

  await test.step("the award is offered, with the invitation's status and its actions", async () => {
    const invitation = page.getByRole("region", { name: "Invitation" });
    await expect(invitation).toContainText("Invitation sent");
    await expect(invitation).toContainText("s…@newcomer.example");
    await expect(invitation.getByRole("button", { name: "Resend invitation" })).toBeVisible();
    await expect(invitation.getByRole("button", { name: "Change address…" })).toBeVisible();
    await expect(invitation.getByRole("button", { name: "Withdraw…" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Grant agreement" })).toHaveCount(0);
    const row = page.getByRole("table", { name: "Awards" }).getByRole("row").filter({ hasText: "Pine Ridge Youth Alliance" });
    await expect(row).toContainText("Invitation sent");
    await expect(row).toContainText("Offered");
  });

  const mail = await lastInvitationLink(page);
  expect(mail.to).toBe("sam@newcomer.example");

  await test.step("the contact opens the link signed out, and signs in with the invited address", async () => {
    await signOut(page);
    await go(page, mail.link);
    // Signing out already left the sign-in page on screen, so its heading proves nothing: wait for the
    // claim link's own redirect (claim page, then sign-in with `next`) before typing, or the redirect can
    // land mid-sign-in and start the form over.
    await expect(page).toHaveURL(/\/signin\?next=%2Fawards%2Fclaim$/);
    await expect(page.getByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeVisible();
    await signInWith(page, "sam@newcomer.example");
    await expect(page.getByRole("heading", { level: 1, name: "Accept an award from Riverbend Community Foundation" })).toBeVisible();
    // The token never stays in the address.
    expect(page.url()).toMatch(/\/awards\/claim$/);
    await expect(page.getByText("Summer Youth Programs", { exact: true })).toBeVisible();
    await expect(page.getByText("$25,000", { exact: true })).toBeVisible();
    await expect(page.getByText("We are glad to support your work.")).toBeVisible();
  });

  await test.step("there is no organization yet: set one up without Passport", async () => {
    const setUp = page.getByRole("link", { name: "Set up your organization" });
    await expect(setUp).toHaveAttribute("href", `/onboarding/applicant?start=email&name=Pine%20Ridge%20Youth%20Alliance&next=%2Fawards%2Fclaim`);
    await setUp.click();
    const legalName = page.getByLabel(/^Legal name/);
    // The organization's name travels with the link, and the form opens straight away.
    await expect(legalName).toHaveValue("Pine Ridge Youth Alliance");
    await legalName.fill("Pine Ridge Youth Alliance");
    await page.getByLabel(/^Contact email/).fill("sam@newcomer.example");
    await page.getByRole("button", { name: "Create my workspace" }).click();
    // Onboarding hands the person back to the claim.
    await expect(page).toHaveURL(/\/awards\/claim$/);
  });

  await test.step("back at the claim, accepting asks for the second step an admin needs, then goes through", async () => {
    await expect(page.getByRole("radio", { name: /Pine Ridge Youth Alliance/ })).toBeChecked();
    await expect(page.getByText("Accepting shares your organization's record with Riverbend Community Foundation.")).toBeVisible();
    await page.getByRole("button", { name: "Accept award" }).click();
    await page.getByRole("link", { name: "Finish the second step" }).click();
    await expect(page.getByRole("heading", { name: "Set Up Two-Step Verification" })).toBeVisible();
    await page.getByLabel("Enter the 6-digit code from your app").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/awards\/claim$/);
    await page.getByRole("button", { name: "Accept award" }).click();
  });

  await test.step("the organization sees the award as accepted", async () => {
    await expect(page).toHaveURL(/\/w\/pine-ridge-youth-alliance\/grants\/awd_/);
    await expect(page.locator("main")).toContainText("Summer Youth Programs");
    await expect(page.locator("main")).toContainText("Accepted");
  });

  await test.step("the funder sees it as accepted too, and the link works only once", async () => {
    await signOut(page);
    await signInWith(page, "dana.ortiz@riverbendcf.example");
    // The funder role asks for a second step at every sign-in.
    await expect(page.getByRole("heading", { name: "Two-Step Verification" })).toBeVisible();
    await page.getByLabel("Enter the 6-digit code from your app").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/w\//);
    await go(page, "/w/riverbend/awards");
    const row = page.getByRole("table", { name: "Awards" }).getByRole("row").filter({ hasText: "Summer Youth Programs" });
    await expect(row).toContainText("Accepted");
    await expect(row).toContainText("Pine Ridge Youth Alliance");
    await expect(row).not.toContainText("Invitation sent");
    await go(page, mail.link);
    await expect(page.getByRole("heading", { name: "This award was already accepted" })).toBeVisible();
  });
});
