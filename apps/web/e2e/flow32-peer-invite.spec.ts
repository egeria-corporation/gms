// SPDX-License-Identifier: AGPL-3.0-only
// Flow 32 — Invite a peer funder (E4). A funder admin writes a short note, reads a preview of
// exactly the email that goes out, and sends it once: the same address cannot be invited again and
// nothing is sent after it. The peer opens the link signed out, sees who invited them, signs in with
// the normal email code, and sets up a funder workspace in place; funder setup continues with its
// second step of sign-in and then the brand step. A funder who reaches /for-funders from an
// applicant's package sees the applicant's region and the count, from ten up.
import type { Page } from "@playwright/test";
import { dialog, expect, shown, start, test } from "./helpers.ts";

/** Moves within the app without a reload: the mock's state lives in the page. */
async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function signInAs(page: Page, email: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

test("a funder invites a peer, who sets up a funder workspace from the link", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/invite-funders");
  let link = "";

  await test.step("the admin previews exactly what is sent, then sends it", async () => {
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Invite a funder" })).toHaveAttribute("aria-current", "page");
    await page.getByLabel(/Their email address/).fill("peer@northwind.example");
    await page.getByLabel(/A note from you/).fill("We moved our whole grant cycle here last spring.");
    await page.getByRole("button", { name: "Preview the email" }).click();
    const d = dialog(page, "Check the invitation");
    await expect(d).toContainText("This is exactly the email that is sent.");
    await expect(d).toContainText("peer@northwind.example");
    await expect(d).toContainText("We moved our whole grant cycle here last spring.");
    await expect(d).toContainText("no reminders follow");
    const text = (await d.getByRole("region", { name: "The email" }).textContent()) ?? "";
    // The one link in the email: funder setup with this invitation's token.
    const url = new URL(/https?:\/\/\S+\/for-funders\?invite=[A-Za-z0-9_-]+/.exec(text)![0]);
    link = url.pathname + url.search;
    await d.getByRole("button", { name: "Send invitation" }).click();
    await expect(d).toBeHidden();
    await expect(shown(page, "Invitation sent to p…@northwind.example")).toBeVisible();
    const table = page.getByRole("table", { name: "Invitations sent" });
    await expect(table.getByRole("row", { name: /p…@northwind\.example/ })).toContainText("Sent");
    await expect(page.getByRole("region", { name: "Who to invite" })).toContainText("4 of 5 invitations left this week");
  });

  await test.step("the same address is never invited twice", async () => {
    await page.getByLabel(/Their email address/).fill("peer@northwind.example");
    await page.getByRole("button", { name: "Preview the email" }).click();
    const d = dialog(page, "Check the invitation");
    await expect(d).toContainText("This workspace already invited this address.");
    await expect(d.getByRole("button", { name: "Send invitation" })).toBeDisabled();
    await d.getByRole("button", { name: "Edit" }).click();
    await expect(d).toBeHidden();
  });

  await test.step("the peer opens the link and sees who invited them", async () => {
    await go(page, "/workspaces");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await go(page, link);
    await expect(page.getByRole("heading", { name: "Dana Ortiz at Riverbend Community Foundation invited you" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Receive applications here, free" })).toBeVisible();
  });

  await test.step("they sign in with the normal email code and set up in place", async () => {
    await page.getByRole("button", { name: "Receive applications here, free" }).click();
    await page.getByRole("button", { name: "Continue with my email" }).click();
    await signInAs(page, "jo@newcomer.example");
    await expect(page).toHaveURL(/\/for-funders\?invite=gms_pi_[A-Za-z0-9_-]+&setup=1$/);
    const start = page.getByRole("form", { name: "Receive applications here, free" });
    await start.getByLabel(/Organization name/).fill("Northwind Family Foundation");
    await expect(start.getByLabel("Public handle")).toHaveValue("northwind-family-foundation");
    await start.getByRole("button", { name: "Create my funder workspace" }).click();
    // A funder admin is taken through the second step of sign-in, then funder setup's brand step.
    await expect(page).toHaveURL(/\/signin\?.*next=%2Fonboarding%2Ffunder%2Fbrand/);
  });
});

test("a funder from an applicant's package sees the region and the count, never a name", async ({ app: page }) => {
  await start(page, "/for-funders?ref=mockpkgoregon0000001");
  await expect(page.getByRole("heading", { name: "The application you received came from an organization in Oregon" })).toBeVisible();
  await expect(shown(page, "14 organizations in Oregon already keep their applications here.")).toBeVisible();
  await go(page, "/for-funders?ref=mockpkgmontana000002");
  await expect(shown(page, "Organizations in Montana keep their applications here, and can send them to you complete.")).toBeVisible();
  await expect(shown(page, /\d+ organizations in Montana/)).toHaveCount(0);
});
