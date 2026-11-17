// SPDX-License-Identifier: AGPL-3.0-only
// Flow 31 — Import history from Submittable (v1.12.0). A funder leaving Submittable brings its past
// applications and their reviews: Awards → Import history → "Past applications" → an export from
// another grants system → Submittable → its submission list, with the contact and bank-shaped
// columns left out and every other column kept as the application's questions and answers →
// import; then "Past reviews" → the review export, each review matched to its submission by id →
// import. The grantee's page then shows the declined application under "Imported history",
// read-only, with its reviewer by name and never an email.
import { expect, shown, start, test } from "./helpers.ts";

/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");
const ALDER = "20000000-0000-7000-8000-000000000011";
const APPLICATIONS = [
  "Submission ID,Title,Category,Submitter First Name,Submitter Last Name,Submitter Email,Organization,Date Submitted,Status,Amount Requested,Amount Awarded,Project summary,Bank acct,Reference",
  `70012345,Clinic van,Health 2024,Ana,Ruiz,ana@example.org,River Clinic,2024-01-10,Accepted,"$45,000","$40,000",A mobile clinic for rural families,on file,${NINE}`,
  '70012346,After-school tutors,Youth 2024,Ben,Cho,ben@example.org,Alder Creek Family Services,2024-01-12,Declined,"15,000",,Tutoring three afternoons a week,,',
  "70012347,Mural walk,Arts 2024,Cy,Diaz,cy@example.org,Pine Valley Arts,2024-01-15,Withdrawn,9000,,Murals on Main Street,,",
].join("\n");
const REVIEWS = [
  "Submission ID,Submission Title,Reviewer,Reviewer Email,Impact score,Feasibility score,Total Score,Recommendation,Comments,Date Completed",
  "70012345,Clinic van,Jo Park,jo@example.org,5,4,9,Fund,Strong plan,2024-02-01",
  "70012346,After-school tutors,Lee Moss,lee@example.org,2,3,5,Decline,Budget unclear,2024-02-02",
].join("\n");

test("import past applications and their reviews from Submittable", async ({ app: page }) => {
  await start(page, "/w/riverbend/awards");

  await test.step("say what the file holds, and pick Submittable", async () => {
    await page.getByRole("link", { name: "Import history" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import grant history" })).toBeVisible();
    await page.getByRole("radio", { name: /^Past applications/ }).check();
    await page.getByRole("radio", { name: /An export from another grants system/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "Submittable" }).check();
    await expect(page.getByRole("group", { name: "How to export from Submittable" })).toContainText("so declined submissions come too");
    await page.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("drop in the submission list: matched by Submittable's preset, sensitive columns left out", async () => {
    await page.getByLabel("Choose a file").setInputFiles({ name: "submissions.csv", mimeType: "text/csv", buffer: Buffer.from(APPLICATIONS, "utf8") });
    await page.getByRole("button", { name: "Read the file" }).click();
    await expect(page.getByRole("heading", { name: "Match columns to fields" })).toBeVisible();
    await expect(shown(page, "Matched as a Submittable export")).toBeVisible();
    await expect(page.getByLabel(/^Organization/)).toHaveValue("Organization");
    await expect(page.getByLabel(/^Application ID/)).toHaveValue("Submission ID");
    const left = page.getByRole("list", { name: "Columns left out" });
    await expect(left).toContainText("Bank acct");
    await expect(left).toContainText("Reference");
    await expect(page.locator("main")).not.toContainText(NINE);
    await page.getByRole("button", { name: "Check the rows" }).click();
  });

  await test.step("every application is history, declined and withdrawn ones too", async () => {
    await expect(page.getByRole("group", { name: "What will happen" })).toContainText("To import3");
    await page.getByRole("button", { name: "Import 3 past applications" }).click();
    await expect(shown(page, "3 past applications imported")).toBeVisible();
    await expect(shown(page, /Imported history is read-only/)).toBeVisible();
    await page.getByRole("button", { name: "Import another" }).click();
  });

  await test.step("then the reviews, each matched to its submission by id", async () => {
    await page.getByRole("radio", { name: /^Past reviews/ }).check();
    await page.getByRole("radio", { name: /An export from another grants system/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "Submittable" }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Choose a file").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(REVIEWS, "utf8") });
    await page.getByRole("button", { name: "Read the file" }).click();
    await expect(page.getByLabel(/^Application ID/)).toHaveValue("Submission ID");
    await expect(page.getByLabel(/^Reviewer/)).toHaveValue("Reviewer");
    await page.getByRole("button", { name: "Check the rows" }).click();
    await expect(page.getByRole("table", { name: "Rows checked" })).toContainText("Lee Moss");
    await page.getByRole("button", { name: "Import 2 past reviews" }).click();
    await expect(shown(page, "2 past reviews imported")).toBeVisible();
  });

  await test.step("the grantee's page shows it as Imported history, read-only", async () => {
    await page.getByRole("link", { name: "Open Grantees" }).click();
    await page.getByRole("link", { name: /Alder Creek Family Services/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/grantees/(${ALDER}|org_alder-creek|alder-creek)`));
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Imported history" }) });
    await expect(section).toContainText("Read-only");
    const apps = section.getByRole("table", { name: "Past applications" });
    await apps.getByRole("button", { name: "After-school tutors" }).click();
    await expect(apps).toContainText("Tutoring three afternoons a week");
    await expect(apps).toContainText("Lee Moss");
    await expect(apps).toContainText("Impact score: 2");
    await expect(section).not.toContainText("@example.org");
  });
});
