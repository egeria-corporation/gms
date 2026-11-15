// SPDX-License-Identifier: AGPL-3.0-only
// Flow 20 — Funder: open data export. Reporting → the Open data panel counts the awards that will
// go out and says why the rest is left out → choose a year → download the 360Giving CSV and JSON
// (drafts until a prefix is saved) → keep an award confidential and the count drops → the public
// feed is off by default and cannot be switched on without a prefix.
import { readFile } from "node:fs/promises";
import { expect, rail, start, test } from "./helpers.ts";

test("funder previews and downloads its open data", async ({ app: page }) => {
  await start(page, "/w/riverbend");
  await rail(page, "Reporting").click();
  const panel = page.getByRole("region", { name: "Open data" });
  const stat = (label: string) => panel.locator(".stat").filter({ has: page.getByText(label, { exact: true }) }).locator(".stat-v");

  await test.step("the panel counts what goes out and why the rest stays out", async () => {
    await expect(panel.getByRole("heading", { name: "Open data" })).toBeVisible();
    await expect(stat("Will be exported")).toHaveText("5");
    await expect(stat("Left out")).toHaveText("5");
    await expect(panel.getByText("These files are drafts")).toBeVisible();
    await panel.getByLabel("Period", { exact: true }).selectOption({ label: "Awards made in 2027" });
    await expect(stat("Will be exported")).toHaveText("4");
    await expect(panel.getByText("of 8 awards in the period")).toBeVisible();
    for (const reason of ["Not accepted yet: 1", "Cancelled: 1", "Awarded to an individual: 1", "Marked confidential: 1"]) await expect(panel.getByText(reason)).toBeVisible();
  });

  await test.step("download the 360Giving CSV and JSON", async () => {
    const [csv] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download 360Giving CSV" }).click()]);
    expect(csv.suggestedFilename()).toBe("360giving-riverbend-2027-01-01-to-2027-12-31-DRAFT.csv");
    const csvText = await readFile((await csv.path())!, "utf8");
    expect(csvText.split("\r\n")[0]).toContain("Recipient Org:Identifier");
    expect(csvText.trim().split("\r\n")).toHaveLength(5);
    const [json] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download 360Giving JSON" }).click()]);
    expect(json.suggestedFilename()).toBe("360giving-riverbend-2027-01-01-to-2027-12-31-DRAFT.json");
    const pkg = JSON.parse(await readFile((await json.path())!, "utf8")) as { grants: { id: string }[] };
    expect(pkg.grants).toHaveLength(4);
    for (const g of pkg.grants) expect(g.id.startsWith("DRAFT-riverbend-")).toBe(true);
  });

  await test.step("keep an award confidential", async () => {
    await panel.getByText(/Awards in this period/).click();
    await panel.getByRole("checkbox", { name: "Keep Youth mentoring circles confidential" }).check();
    await expect(panel.getByText("Youth mentoring circles is kept confidential and will not be exported.")).toBeVisible();
    await expect(stat("Will be exported")).toHaveText("3");
    await expect(panel.getByText("Marked confidential: 2")).toBeVisible();
  });

  await test.step("the public feed is off by default and needs a prefix", async () => {
    const toggle = panel.getByRole("switch", { name: "Publish my awards as open data" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeDisabled();
    await expect(panel.getByLabel("Public feed address")).toHaveCount(0);
  });
});
