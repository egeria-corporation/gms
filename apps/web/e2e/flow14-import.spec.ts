// SPDX-License-Identifier: AGPL-3.0-only
// Flow 14 — Import from a spreadsheet. An applicant imports its applications from a CSV file:
// Applications → Import → a file → columns matched with suggestions → every row checked (a column
// that looks like identity numbers is named and left out, a row without a funder needs a fix) →
// import → the summary links to what was created, and the Applications list shows it. The same file
// again skips every row. A funder imports grant history from Awards, with a payment recorded as
// paid elsewhere.
import { expect, rail, shown, start, test } from "./helpers.ts";

/** Made at run time; no file holds such a value. */
const IDENTITY_SHAPED = ["900", "00", "0001"].join("-");
const PIPELINE = [
  "Grant,Foundation,Stage,Deadline,Ask,Contact ref",
  `River restoration,Cedar Fund,Drafting,2027-08-01,"$15,000",${IDENTITY_SHAPED}`,
  "Mobile clinic,Harbor Trust,Prospect,2027-10-15,40000,",
  "No funder here,,Drafting,2027-09-01,500,",
].join("\n");
const file = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });

test("import applications from a CSV file", async ({ app: page }) => {
  await start(page, "/w/alder-creek/applications");

  await test.step("open the wizard and choose a file", async () => {
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import applications" })).toBeVisible();
    await page.getByRole("radio", { name: /A file from your computer/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Choose a file").setInputFiles(file("pipeline.csv", PIPELINE));
    await page.getByRole("button", { name: "Read the file" }).click();
  });

  await test.step("match columns: suggestions, and the identity column left out", async () => {
    await expect(page.getByRole("heading", { name: "Match columns to fields" })).toBeVisible();
    await expect(page.getByLabel(/^Title/)).toHaveValue("Grant");
    await expect(page.getByLabel(/^Funder/)).toHaveValue("Foundation");
    await expect(page.getByLabel(/^Full application due/)).toHaveValue("Deadline");
    await expect(page.getByRole("list", { name: "Columns left out" })).toContainText("Contact ref");
    await expect(page.locator("main")).not.toContainText(IDENTITY_SHAPED);
    await page.getByRole("button", { name: "Check the rows" }).click();
  });

  await test.step("check every row before importing", async () => {
    const what = page.getByRole("group", { name: "What will happen" });
    await expect(what).toContainText("To import2");
    await expect(what).toContainText("Need a fix1");
    await expect(page.getByRole("table", { name: "Amounts by year" })).toContainText("2027");
    const rows = page.getByRole("table", { name: "Rows checked" }).getByRole("row");
    await expect(rows.nth(3)).toContainText("No funder");
    await expect(rows.nth(3)).toContainText("Needs a fix");
    await page.getByRole("button", { name: "Import 2 applications" }).click();
  });

  await test.step("the summary links to what was created", async () => {
    await expect(shown(page, "2 applications imported")).toBeVisible();
    await expect(page.getByRole("list", { name: "Imported applications" }).getByRole("link")).toHaveCount(2);
    await page.getByRole("link", { name: "Open Applications" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
    await expect(page.locator("main")).toContainText("River restoration");
    await expect(page.locator("main")).toContainText("Mobile clinic");
  });

  await test.step("the same file again skips every row", async () => {
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await page.getByRole("radio", { name: /A file from your computer/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Choose a file").setInputFiles(file("pipeline (1).csv", PIPELINE));
    await page.getByRole("button", { name: "Read the file" }).click();
    await expect(shown(page, "Matched as you saved it last time for this source.")).toBeVisible();
    await page.getByRole("button", { name: "Check the rows" }).click();
    await expect(page.getByRole("group", { name: "What will happen" })).toContainText("Skipped2");
    await expect(page.getByRole("button", { name: "Import 0 applications" })).toBeDisabled();
  });
});

test("import a funder's grant history from Awards", async ({ app: page }) => {
  await start(page, "/w/riverbend/awards");
  await page.getByRole("link", { name: "Import history" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import grant history" })).toBeVisible();
  await page.getByRole("radio", { name: /A file from your computer/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Or paste CSV text").fill("Organization,Grant,Amount,Award date,Paid,Paid on\nAlder Creek Family Services,Van route,50000,2024-03-01,25000,2024-04-01\n");
  await page.getByRole("button", { name: "Read the file" }).click();
  await page.getByRole("button", { name: "Check the rows" }).click();
  await expect(page.getByRole("table", { name: "Amounts by year" })).toContainText("Paid (recorded as paid elsewhere)");
  await page.getByRole("button", { name: "Import 1 award" }).click();
  await expect(shown(page, "1 award imported")).toBeVisible();
  await page.getByRole("link", { name: "Open Awards" }).click();
  await expect(rail(page, "Awards")).toHaveAttribute("aria-current", "page");
});
