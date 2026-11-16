// SPDX-License-Identifier: AGPL-3.0-only
// Flow 24 — Many funds in one workspace (v1.9.0). The admin creates a second fund with its own
// budget, makes a program in it, sees the fund's budget beside its programs', narrows the programs
// list with the fund switcher, and invites an advisor for that fund. The advisor signs in with the
// invitation and sees only that fund: its name in the rail and its program, none of the others.
import type { Page } from "@playwright/test";
import { dialog, expect, rail, shown, start, test } from "./helpers.ts";

/** Moves within the app without a reload: the mock's state lives in the page. */
async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const fundCard = (page: Page, name: string) => page.getByRole("region", { name }).or(page.locator("section.card").filter({ has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) })).first();

test("a second fund, a program in it, and an advisor who sees only that fund", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/funds");

  await test.step("every workspace starts with its default fund", async () => {
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Funds" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: /^Default fund/ })).toBeVisible();
  });

  await test.step("the admin creates a second fund", async () => {
    await page.getByRole("button", { name: "New fund" }).click();
    const d = dialog(page, "New fund");
    await d.getByLabel("Name").fill("Riverside Arts Fund");
    await expect(d.getByLabel("Public address")).toHaveValue("riverside-arts-fund");
    await d.getByLabel("Short description").fill("Murals and music in the river towns.");
    await d.getByLabel("Colour").selectOption({ label: "Teal" });
    await d.getByRole("button", { name: "Create fund" }).click();
    await expect(d).toBeHidden();
    const card = fundCard(page, "Riverside Arts Fund");
    await expect(card).toContainText("/f/riverbend/riverside-arts-fund");
    await expect(card).toContainText("Murals and music in the river towns.");
  });

  await test.step("the fund gets its own budget for a fiscal year", async () => {
    await page.getByRole("button", { name: "Budget for Riverside Arts Fund" }).click();
    const d = dialog(page, "Budget for Riverside Arts Fund");
    await d.getByLabel("Fiscal year").fill("2027");
    await d.getByLabel("Budget (USD)").fill("500,000");
    await d.getByRole("button", { name: "Save budget" }).click();
    await expect(d).toBeHidden();
    const budget = page.getByRole("table", { name: "Budget of Riverside Arts Fund by fiscal year" });
    await expect(budget.getByRole("row", { name: /FY2027/ })).toContainText("$500,000");
  });

  await test.step("a program is made in the new fund", async () => {
    await rail(page, "Programs").click();
    await page.getByRole("button", { name: "New program" }).click();
    const d = dialog(page, "New program");
    await d.getByLabel("Name").fill("Murals");
    await d.getByLabel("Fund").selectOption({ label: "Riverside Arts Fund" });
    await d.getByLabel("Fiscal year").fill("2027");
    await d.getByLabel("Budget (USD)").fill("200,000");
    await d.getByRole("button", { name: "Create program" }).click();
    await expect(d).toBeHidden();
    await expect(page.getByRole("heading", { name: "Murals", level: 2 })).toBeVisible();
    await expect(shown(page, /Riverside Arts Fund · FY2027/)).toBeVisible();
    // With two funds, the list says which fund each program is in.
    await expect(page.getByRole("table", { name: "Programs" }).getByRole("row", { name: /Murals/ })).toContainText("Riverside Arts Fund");
  });

  await test.step("the fund switcher narrows the programs to one fund", async () => {
    const switcher = page.getByRole("navigation", { name: "Funder workspace" }).getByLabel("Fund");
    await switcher.selectOption({ label: "Riverside Arts Fund" });
    const table = page.getByRole("table", { name: "Programs" });
    await expect(table.getByRole("link", { name: "Murals" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Community Health 2027" })).toHaveCount(0);
    await switcher.selectOption({ label: "All funds" });
    await expect(table.getByRole("link", { name: "Community Health 2027" })).toBeVisible();
  });

  let link = "";
  await test.step("the fund's budget sits beside its program's, and the admin invites an advisor for it", async () => {
    await rail(page, "Settings").click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Funds" }).click();
    const row = page.getByRole("table", { name: "Budget of Riverside Arts Fund by fiscal year" }).getByRole("row", { name: /FY2027/ });
    await expect(row).toContainText("$200,000");
    await expect(row).toContainText("$300,000");
    await page.getByRole("button", { name: "Invite an advisor for Riverside Arts Fund" }).click();
    const d = dialog(page, "Advisor for Riverside Arts Fund");
    await expect(d).toContainText("An advisor sees only this fund");
    await d.getByLabel(/Their email address/).fill("leo@newcomer.example");
    await d.getByLabel("What they do").selectOption({ label: "Program officer" });
    await d.getByRole("button", { name: "Send invitation" }).click();
    await expect(d).toContainText("Invitation created for leo@newcomer.example");
    link = (await d.locator(".mono").first().textContent())!.trim();
    expect(link).toMatch(/^\/invitations\/accept\?token=/);
    await d.getByRole("button", { name: "Done" }).click();
    await expect(fundCard(page, "Riverside Arts Fund").getByRole("list", { name: "Advisors" })).toContainText("leo@newcomer.example · Program officer");
  });

  await test.step("the advisor joins and sees only that fund", async () => {
    await go(page, "/workspaces");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Work email").fill("leo@newcomer.example");
    await page.getByRole("button", { name: "Send code" }).click();
    const digits = page.getByRole("group", { name: /code/i }).getByRole("textbox");
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await go(page, link);
    const nav = page.getByRole("navigation", { name: "Funder workspace" });
    await expect(nav.getByLabel("Your fund")).toContainText("Riverside Arts Fund");
    await rail(page, "Programs").click();
    const table = page.getByRole("table", { name: "Programs" });
    await expect(table.getByRole("link", { name: "Murals" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Community Health 2027" })).toHaveCount(0);
    await expect(table.getByRole("row")).toHaveCount(2);
  });
});
