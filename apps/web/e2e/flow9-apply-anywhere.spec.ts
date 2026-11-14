// SPDX-License-Identifier: AGPL-3.0-only
// Flow 9 — Apply anywhere. An OpenGrants listing for a funder outside this GMS → Details → Start
// application → paste the funder's questions (limits found in the text) → write, one answer from
// the answer library → mark submitted on the funder's site → record the award → the pipeline shows
// it as Awarded, in the list and on the board.
import { expect, rail, start, test } from "./helpers.ts";

const LISTING = "Rural Health Network Development Planning";

test("apply to a funder outside this GMS", async ({ app: page }) => {
  await start(page, "/w/alder-creek/find");

  await test.step("an OpenGrants listing: details, then start the application", async () => {
    await page.getByRole("tab", { name: "OpenGrants index" }).click();
    await page.getByRole("searchbox", { name: "Search the OpenGrants index" }).fill("rural");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByRole("article", { name: LISTING });
    await expect(result).toContainText("Health Resources and Services Administration");
    await result.getByRole("button", { name: "Details" }).click();
    const details = page.getByRole("dialog", { name: LISTING });
    await expect(details).toContainText("Up to $100,000");
    await expect(details.getByRole("link", { name: /Open original listing/ })).toHaveAttribute("href", /opengrants\.io/);
    await details.getByRole("button", { name: "Start application" }).click();
    await expect(page).toHaveURL(/\/w\/alder-creek\/outside\/oap_/);
    await expect(page.getByRole("heading", { level: 1, name: LISTING })).toBeVisible();
    await expect(page.locator(".ph .title")).toContainText("Drafting");
  });

  await test.step("paste the funder's questions and review what was found", async () => {
    await page.getByRole("button", { name: "Paste questions" }).first().click();
    const paste = page.getByRole("dialog", { name: "Paste the funder’s questions" });
    await paste.getByLabel("Questions").fill("1. Describe the need your project addresses. (250 words)\n\n2. How will you measure success? Maximum 1,500 characters including spaces.");
    await paste.getByRole("button", { name: "Find the questions" }).click();
    const proposed = paste.getByRole("list", { name: "Proposed questions" });
    await expect(proposed.getByRole("listitem")).toHaveCount(2);
    await expect(proposed.getByRole("listitem").nth(0)).toContainText("250 words (found in the text)");
    await expect(proposed.getByRole("listitem").nth(1)).toContainText("1,500 characters (found in the text)");
    await paste.getByRole("button", { name: "Save 2 questions" }).click();
    await expect(paste).toBeHidden();
    await expect(page.getByText("2 questions added")).toBeVisible();
  });

  await test.step("write: one answer from the library, one typed against a character limit", async () => {
    const q1 = page.getByRole("article", { name: /Describe the need your project addresses/ });
    await q1.getByRole("button", { name: "Insert from library" }).click();
    const library = page.getByRole("dialog", { name: "Insert from answer library" });
    await library.getByLabel("Library answer").selectOption({ label: "Need · v3 · 27 words" });
    await library.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(library).toBeHidden();
    await expect(q1.getByRole("textbox", { name: "Answer to question 1" })).toHaveValue(/Families in the Alder Creek valley/);
    await expect(q1.getByText("From library", { exact: true })).toBeVisible();
    await expect(q1.getByText("Within the limit")).toBeVisible();

    const q2 = page.getByRole("article", { name: /How will you measure success/ });
    await q2.getByRole("textbox", { name: "Answer to question 2" }).fill("We count appointments kept and referrals completed each quarter, against our 2026 baseline.");
    await expect(q2.locator('[data-active="true"]')).toContainText("/ 1,500 characters");
    await q2.getByRole("button", { name: "Save answer" }).click();
    await expect(q2.getByText("Saved as version 1")).toBeVisible();
  });

  await test.step("mark it submitted after submitting on the funder's site", async () => {
    await page.getByRole("button", { name: "Mark as submitted" }).first().click();
    const submit = page.getByRole("dialog", { name: "Mark as submitted" });
    await submit.getByLabel(/How you submitted/).selectOption({ label: "The funder’s online portal" });
    await submit.getByLabel("Confirmation number").fill("HRSA-2027-0042");
    await submit.getByRole("button", { name: "Mark as submitted" }).click();
    await expect(submit).toBeHidden();
    await expect(page.locator(".ph .title")).toContainText("Submitted");
    await page.getByRole("tab", { name: "Submission" }).click();
    await expect(page.getByRole("tabpanel", { name: "Submission" })).toContainText("HRSA-2027-0042");
    await expect(page.getByRole("tabpanel", { name: "Submission" })).toContainText("as submitted");
  });

  await test.step("record the award", async () => {
    await page.getByRole("button", { name: "Record decision" }).click();
    const decision = page.getByRole("dialog", { name: "Record the decision" });
    await expect(decision.getByRole("radio", { name: /Awarded/ })).toBeChecked();
    await decision.getByLabel(/Amount awarded/).fill("85000");
    await decision.getByRole("button", { name: "Record awarded" }).click();
    await expect(decision).toBeHidden();
    await expect(page.locator(".ph .title")).toContainText("Awarded");
    await expect(page.locator(".ph .meta")).toContainText("Awarded $85,000");
  });

  await test.step("the pipeline shows it as Awarded, in the list and on the board", async () => {
    await rail(page, "Applications").click();
    const table = page.getByRole("table", { name: "Applications" });
    const row = table.getByRole("row", { name: new RegExp(LISTING) });
    await expect(row).toContainText("Awarded");
    // Built-in applications on this GMS sit beside it.
    await expect(table.getByRole("row", { name: /Community Clinic Capacity/ })).toContainText("On this GMS");
    await page.getByRole("button", { name: "Board" }).click();
    await expect(page.getByRole("region", { name: /^Awarded, \d+$/ }).getByRole("article", { name: LISTING })).toBeVisible();
  });
});
