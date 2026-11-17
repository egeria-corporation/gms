// SPDX-License-Identifier: AGPL-3.0-only
// Flow 33 — An intermediary's onboarding link and the partner directory (E4). A funder that runs
// one fund is told the link is for workspaces with two or more; with two funds it makes a
// co-branded onboarding link, uploads its logo with alt text and asks to be listed. The page the
// link opens names it, its funds and its logo. Nothing is listed until a moderator approves it;
// once approved it is at /partners, and when the intermediary withdraws it leaves at once.
import type { Page } from "@playwright/test";
import { dialog, expect, shown, start, test } from "./helpers.ts";

async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64");

async function newFund(page: Page, name: string) {
  await page.getByRole("button", { name: "New fund" }).click();
  const d = dialog(page, "New fund");
  await d.getByLabel("Name").fill(name);
  await d.getByRole("button", { name: "Create fund" }).click();
  await expect(d).toBeHidden();
}

test("an intermediary's co-branded link, and a listing a moderator approves and it withdraws", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/partners");
  const nav = page.getByRole("navigation", { name: "Settings sections" });

  await test.step("it is for workspaces that run two or more funds", async () => {
    await expect(nav.getByRole("link", { name: "Partners" })).toHaveAttribute("aria-current", "page");
    await expect(shown(page, "This is for workspaces that run 2 or more funds")).toBeVisible();
    await page.getByRole("link", { name: "Settings, Funds" }).click();
    await newFund(page, "River Health Fund");
    await newFund(page, "Youth Arts Fund");
    await nav.getByRole("link", { name: "Partners" }).click();
    await expect(shown(page, "The page names your funds: River Health Fund and Youth Arts Fund.")).toBeVisible();
  });

  await test.step("the admin makes the link and uploads the logo with its alt text", async () => {
    await page.getByRole("button", { name: "Make the onboarding link" }).click();
    await expect(page.getByRole("textbox", { name: "Onboarding link" })).toHaveValue(/\/join\/[a-z0-9]{20}$/);
    await page.getByLabel("Logo", { exact: true }).setInputFiles({ name: "riverbend.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel(/What the logo shows/).fill("Riverbend Community Foundation");
    await page.getByRole("button", { name: "Upload logo" }).click();
    await expect(page.getByRole("img", { name: "Riverbend Community Foundation" })).toBeVisible();
  });

  await test.step("the link opens a page with its name, its funds and its logo", async () => {
    await page.getByRole("link", { name: "Open the page" }).click();
    await expect(page).toHaveURL(/\/join\/[a-z0-9]{20}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Riverbend Community Foundation invites you to join" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Riverbend Community Foundation" })).toBeVisible();
    const funds = page.getByRole("region", { name: "Riverbend Community Foundation's funds" });
    await expect(funds).toContainText("River Health Fund");
    await expect(funds).toContainText("Youth Arts Fund");
    await expect(page.getByRole("button", { name: "Set up my organization" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up a funder workspace" })).toBeVisible();
    await page.goBack();
  });

  await test.step("it asks to be listed; nothing is public yet", async () => {
    await page.getByLabel(/Region you work in/).fill("Oregon");
    await page.getByRole("button", { name: "Ask to be listed" }).click();
    await expect(page.getByRole("region", { name: "Partner directory" })).toContainText("Waiting for a moderator");
    await go(page, "/partners");
    await expect(page.getByRole("heading", { level: 1, name: "Partner directory" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Partners" })).not.toContainText("Riverbend Community Foundation");
  });

  await test.step("a moderator approves it, and it is listed", async () => {
    await go(page, "/partners/moderation");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Riverbend Community Foundation" }) });
    await expect(card).toContainText("Oregon");
    await expect(card).toContainText("2 funds");
    await card.getByRole("button", { name: "Approve and list" }).click();
    await expect(shown(page, "Riverbend Community Foundation is listed at /partners.")).toBeVisible();
    await go(page, "/partners");
    const listed = page.getByRole("list", { name: "Partners" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Riverbend Community Foundation" }) });
    await expect(listed).toContainText("Oregon");
    await expect(listed).toContainText("2 funds");
    await expect(listed.getByRole("link", { name: "Riverbend Community Foundation's public page" })).toHaveAttribute("href", "/f/riverbend");
  });

  await test.step("it withdraws, and leaves the directory at once", async () => {
    await go(page, "/w/riverbend/settings/partners");
    await page.getByRole("button", { name: "Withdraw from the directory" }).click();
    await expect(page.getByRole("region", { name: "Partner directory" })).toContainText("Withdrawn");
    await go(page, "/partners");
    await expect(page.getByRole("list", { name: "Partners" })).toContainText("High Desert Community Fund");
    await expect(page.getByRole("list", { name: "Partners" })).not.toContainText("Riverbend Community Foundation");
  });
});
