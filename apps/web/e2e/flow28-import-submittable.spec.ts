// SPDX-License-Identifier: AGPL-3.0-only
// Flow 28 — Import from Submittable. A funder leaving Submittable imports its funded submissions as
// grant history: Awards → Import history → an export from another grants system → Submittable (how
// to export from it) → its submission list CSV → the columns matched by Submittable's preset, with
// the bank and identity-shaped columns named and left out → every row checked, the declined and
// unfinished submissions set aside with the reason → import → the zip of submission PDFs matched
// to the imported awards by submission id and attached.
import { makeZip } from "../test/zip.ts";
import { expect, start, test } from "./helpers.ts";

/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");
const SUBMITTABLE = [
  "Submission ID,Title,Category,Submitter First Name,Submitter Last Name,Submitter Email,Organization,Date Submitted,Status,Labels,Amount Awarded,Decision Date,Bank acct,Reference",
  `70012345,Clinic van,Health 2024,Ana,Ruiz,ana@example.org,River Clinic,2024-01-10,Accepted,priority,"$40,000",2024-03-01,on file,${NINE}`,
  "70012346,After-school tutors,Youth 2024,Ben,Cho,ben@example.org,Alder Creek Family Services,2024-01-12,Declined,,,,,",
  "70012347,Mural walk,Arts 2024,Cy,Diaz,cy@example.org,Pine Valley Arts,2024-01-15,In-Progress,,,,,",
  '70012348,Food pantry shelves,Health 2024,Di,Eng,di@example.org,Harbor Food Bank,2024-01-20,Accepted,,"12,500",2024-03-15,,',
  "70012349,Library hours,Youth 2024,Ed,Fox,ed@example.org,Cedar Library Friends,2024-02-01,Completed,,8000,2024-04-01,,",
].join("\n");

test("import funded submissions from Submittable, with their PDFs", async ({ app: page }) => {
  await start(page, "/w/riverbend/awards");

  await test.step("pick Submittable and see how to export from it", async () => {
    await page.getByRole("link", { name: "Import history" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import grant history" })).toBeVisible();
    await page.getByRole("radio", { name: /An export from another grants system/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "Submittable" }).check();
    await expect(page.getByRole("group", { name: "How to export from Submittable" })).toContainText("Export Submissions");
    await page.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("drop in the submission list: matched by Submittable's preset, sensitive columns left out", async () => {
    await expect(page.getByRole("heading", { name: "Choose the Submittable export" })).toBeVisible();
    await page.getByLabel("Choose a file").setInputFiles({ name: "submissions.csv", mimeType: "text/csv", buffer: Buffer.from(SUBMITTABLE, "utf8") });
    await page.getByRole("button", { name: "Read the file" }).click();
    await expect(page.getByRole("heading", { name: "Match columns to fields" })).toBeVisible();
    await expect(page.getByText("Matched as a Submittable export")).toBeVisible();
    await expect(page.getByLabel(/^Organization/)).toHaveValue("Organization");
    await expect(page.getByLabel(/^Amount awarded/)).toHaveValue("Amount Awarded");
    await expect(page.getByLabel(/^Row ID/)).toHaveValue("Submission ID");
    const left = page.getByRole("list", { name: "Columns left out" });
    await expect(left).toContainText("Bank acct");
    await expect(left).toContainText("Reference");
    await expect(page.locator("main")).not.toContainText(NINE);
    await page.getByRole("button", { name: "Check the rows" }).click();
  });

  await test.step("check every row: what was never awarded is set aside, with the reason", async () => {
    const what = page.getByRole("group", { name: "What will happen" });
    await expect(what).toContainText("To import3");
    await expect(what).toContainText("Skipped2");
    const rows = page.getByRole("table", { name: "Rows checked" });
    await expect(rows).toContainText("Not awarded in Submittable (Status: Declined)");
    await expect(rows).toContainText("Not awarded in Submittable (Status: In-Progress)");
    await page.getByRole("button", { name: "Import 3 awards" }).click();
    await expect(page.getByText("3 awards imported")).toBeVisible();
  });

  await test.step("attach the zip of submission PDFs to the imported awards", async () => {
    const zip = makeZip({ "70012345 - Clinic van/Submission 70012345.pdf": "%PDF-1.4 made up", "70012348 - Food pantry shelves/Submission 70012348.pdf": "%PDF-1.4 made up", "70012346 - After-school tutors/Submission 70012346.pdf": "%PDF-1.4 made up" });
    await page.getByLabel("Choose the zip").setInputFiles({ name: "submission-pdfs.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await expect(page.getByRole("group", { name: "Files matched" })).toContainText("2 files match an award");
    await expect(page.getByRole("list", { name: "Files left out" })).toContainText("Submission 70012346.pdf");
    await page.getByRole("button", { name: "Attach 2 files" }).click();
    await expect(page.getByText("2 files attached")).toBeVisible();
  });
});
