// SPDX-License-Identifier: AGPL-3.0-only
// Flow 26 — The guest reviewer (C4). Someone new opens an invitation to review → signs in with the
// emailed code, and is asked for no workspace or organization → lands on a one-screen welcome
// (funder, competition, how many, due date, the conflict-of-interest note) → "Start reviewing"
// opens the reviewer portal. A guest whose reviews are all in sees the done screen, which offers
// once to run a review panel for their own organization: dismissed, it stays gone; taken, it
// creates a funder workspace through funder setup with their email domain as a suggestion.
import type { Page } from "@playwright/test";
import { expect, start, test } from "./helpers.ts";

async function signOut(page: Page) {
  await start(page, "/workspaces");
  await page.getByRole("button", { name: "Sign out" }).click();
}

/** Opens an invitation link signed out and signs in with the emailed code, as someone new. */
async function acceptAsNewcomer(page: Page, token: string) {
  await page.goto(`/invitations/accept?token=${token}`);
  await page.getByLabel("Work email").fill("sam@newcomer.example");
  await page.getByRole("button", { name: "Send code" }).click();
  const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

test("a guest reviewer is welcomed and starts reviewing", async ({ app: page }) => {
  await signOut(page);
  await acceptAsNewcomer(page, "gms_inv_mock_guest_reviewer");

  await test.step("no setup is asked: the welcome says who, what, how many and by when", async () => {
    await expect(page).toHaveURL(/\/review\/welcome\?ws=riverbend$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome. Thank you for reviewing." })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("Guest reviewer");
    const facts = page.locator("dl.kv");
    await expect(facts).toContainText("Riverbend Community Foundation");
    await expect(facts).toContainText("Community Health Grants 2027: letters of intent");
    await expect(facts).toContainText("3 assigned to you");
    await expect(facts).toContainText(/Dec 4, 2026|December 4, 2026|2026-12-04/);
    const coi = page.getByRole("note", { name: "Conflicts of interest" });
    await expect(coi).toContainText("you step aside from it and it never opens for you");
    await expect(coi.getByRole("link", { name: "Read and confirm the conflict-of-interest steps" })).toHaveAttribute("href", "/review/assignments?ws=riverbend&sign=1");
    await expect(page.getByText(/Organization name|Set up your funder workspace/)).toHaveCount(0);
  });

  await test.step("Start reviewing opens the reviewer portal", async () => {
    await page.getByRole("button", { name: "Start reviewing" }).click();
    await expect(page).toHaveURL(/\/review\/assignments\?ws=riverbend$/);
  });
});

test("the done screen offers a panel once, and a dismissal sticks", async ({ app: page }) => {
  await signOut(page);
  await acceptAsNewcomer(page, "gms_inv_mock_guest_done");
  await expect(page).toHaveURL(/\/review\/welcome\?ws=cascade-county$/);
  await expect(page.getByText("All 2 reviews submitted")).toBeVisible();

  await test.step("thanks, and the offer", async () => {
    await page.getByRole("link", { name: "See what’s next" }).click();
    await expect(page).toHaveURL(/\/review\/done\?ws=cascade-county$/);
    await expect(page.getByRole("heading", { level: 1, name: "Thank you. Your reviews are in." })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("You submitted 2 reviews for Cascade County Health Department.");
    const offer = page.getByRole("region", { name: "Run a review panel for your own organization, free" });
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByText("Got it. We won’t show this again.")).toBeVisible();
    await expect(offer).toBeHidden();
  });

  await test.step("back on the done screen, it is not shown again", async () => {
    await page.getByRole("link", { name: "your assignments" }).click();
    await expect(page).toHaveURL(/\/review\/assignments/);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Thank you. Your reviews are in." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Run a review panel for your own organization, free" })).toHaveCount(0);
  });
});

test("taking the offer sets up a funder workspace, the email domain only a suggestion", async ({ app: page }) => {
  await signOut(page);
  await acceptAsNewcomer(page, "gms_inv_mock_guest_done");
  await page.getByRole("link", { name: "See what’s next" }).click();
  const offer = page.getByRole("region", { name: "Run a review panel for your own organization, free" });
  await offer.getByRole("button", { name: "Set up my organization" }).click();
  const form = offer.getByRole("form", { name: "Set up your funder workspace" });
  await expect(form.getByLabel(/Organization name/)).toHaveValue("Newcomer");
  await expect(form).toContainText("Suggested from your email address (newcomer.example). Change it to your organization’s name.");
  await form.getByLabel(/Organization name/).fill("Valley Giving Circle");
  await expect(form.getByLabel("Public handle")).toHaveValue("valley-giving-circle");
  await form.getByRole("button", { name: "Create my funder workspace" }).click();
  // The new workspace's admin is taken through the second step of sign-in, then into the workspace.
  await expect(page).toHaveURL(/\/signin\?.*next=%2Fw%2Fvalley-giving-circle/);
});
