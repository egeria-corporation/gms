// SPDX-License-Identifier: AGPL-3.0-only
// Flow 17 — Funder: the report builder. Analytics → Report builder → awards grouped by program
// with a total → preview → save the view shared with the workspace → download the CSV (formula-
// safe, money in dollars) → schedule it monthly to a colleague → a starter view runs.
import { readFile } from "node:fs/promises";
import { dialog, expect, rail, shown, start, test } from "./helpers.ts";

test("funder builds, saves, downloads and schedules a report", async ({ app: page }) => {
  await start(page, "/w/riverbend");

  await test.step("open the report builder from Analytics", async () => {
    await rail(page, "Analytics").click();
    await page.getByRole("link", { name: "Report builder" }).click();
    await expect(page.getByRole("heading", { name: "Report builder", level: 1 })).toBeVisible();
  });

  await test.step("build: awards by program with a total, and preview", async () => {
    await page.getByLabel("Data set").selectOption("awards");
    await page.getByLabel("Group by").selectOption("program");
    await page.getByLabel("Add a summary").selectOption("sum:amount");
    await page.getByLabel("Sort by").selectOption("sum:amount");
    await page.getByLabel("Order").selectOption("desc");
    await page.getByRole("button", { name: "Preview" }).click();
    const table = page.getByRole("table", { name: "Report preview" });
    await expect(table.getByRole("columnheader", { name: "Total awarded amount" })).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toContainText("Community Health 2027");
    await expect(table.getByRole("row").nth(1)).toContainText("$290,000");
    await expect(shown(page, "2 groups")).toBeVisible();
  });

  await test.step("save the view, shared with the workspace", async () => {
    await page.getByRole("button", { name: "Save view" }).click();
    const save = dialog(page, "Save view");
    await save.getByLabel("Name").fill("Awards by program");
    await save.getByLabel("Shared with the workspace").check();
    await save.getByRole("button", { name: "Save view" }).click();
    await expect(save).toBeHidden();
    const views = page.getByRole("complementary", { name: "Report views" });
    await expect(views.getByRole("button", { name: /Awards by program.*Shared/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Awards by program", level: 2 })).toBeVisible();
  });

  await test.step("download the CSV", async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    expect(file.suggestedFilename()).toMatch(/^awards-by-program-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await file.path())!, "utf8");
    expect(text.split("\r\n")[0]).toBe("Program,Count,Total awarded amount");
    expect(text).toContain("Community Health 2027,3,290000.00");
  });

  await test.step("schedule it monthly to a colleague", async () => {
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const sched = dialog(page, /Schedule/);
    await expect(sched.getByText("The file is never attached", { exact: false })).toBeVisible();
    await sched.getByLabel("Monthly").check();
    await sched.getByLabel("Day of the month").fill("3");
    await sched.getByLabel(/Marcus Lee/).check();
    await sched.getByRole("button", { name: "Save schedule" }).click();
    await expect(sched).toBeHidden();
    await expect(shown(page, "On the 3rd of every month to 1 person")).toBeVisible();
  });

  await test.step("a starter view runs", async () => {
    await page.getByRole("button", { name: "Payments due next 90 days" }).click();
    const table = page.getByRole("table", { name: "Report preview" });
    await expect(table.getByRole("cell", { name: "Harbor Light Shelter" })).toBeVisible();
    await expect(table.getByText("Held").first()).toBeVisible();
    await expect(shown(page, "Starter view · read only")).toBeVisible();
  });
});
