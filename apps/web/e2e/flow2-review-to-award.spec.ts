// SPDX-License-Identifier: AGPL-3.0-only
// Flow 2 — Funder: review to award. Applications inbox → application detail → advance → assign
// reviewers (one external) → score → panel: rank, allocate, commit → award offered → the applicant
// accepts and signs → the funder countersigns → active.
import { expect, rail, start, switchWorkspace, test } from "./helpers.ts";

test("review to award", async ({ app: page }) => {
  await start(page, "/w/riverbend/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();

  await test.step("open a letter of intent that passed eligibility", async () => {
    await page.getByRole("tab", { name: /Needs screening/ }).click();
    await expect(page.getByRole("tab", { name: /Needs screening/ })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /^All/ }).click();
    await page.getByLabel("Stage").selectOption({ label: "Letter of intent" });
    await page.getByLabel("Eligibility").selectOption({ label: "Pass" });
    await page.getByRole("table", { name: "Applications" }).getByRole("link", { name: "Community Health Worker Corps" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community Health Worker Corps" })).toBeVisible();
    await expect(page.getByText("L3").first()).toBeVisible();
  });

  await test.step("advance to the full proposal", async () => {
    await page.getByRole("button", { name: "Advance to Full proposal" }).click();
    const d = page.getByRole("dialog", { name: "Advance to Full proposal" });
    await d.getByRole("button", { name: "Advance", exact: true }).click();
    await expect(d).toBeHidden();
    // The applicant now owes the full proposal, so the application waits in Draft at that stage.
    await expect(page.locator("main")).toContainText("Full proposal");
  });

  await test.step("assign reviewers, one of them external", async () => {
    await rail(page, "Reviews").click();
    const matrix = page.getByRole("table", { name: "Reviewers by application" });
    await matrix.getByRole("button", { name: "Dana Ortiz on Northgate Housing Trust: not assigned" }).click();
    await expect(matrix.getByRole("button", { name: /Dana Ortiz on Northgate Housing Trust: Assigned/ })).toBeVisible();
    await page.getByRole("button", { name: "Invite external reviewer…" }).click();
    const invite = page.getByRole("dialog", { name: "Invite an external reviewer" });
    await invite.getByLabel("Email").fill("hollis.grant@university.example");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(invite).toBeHidden();
  });

  await test.step("score an assignment as a reviewer", async () => {
    await page.getByRole("link", { name: "My assignments" }).click();
    const mine = page.getByRole("article").filter({ hasText: "Healthy Homes Visits" });
    await mine.getByRole("button", { name: "Declare conflicts and open" }).click();
    const coi = page.getByRole("dialog", { name: "Conflict of interest declaration" });
    await expect(coi.getByRole("button", { name: "Declare no conflict and open" })).toBeDisabled();
    for (const box of await coi.getByRole("checkbox").all()) await box.check();
    await coi.getByRole("button", { name: "Declare no conflict and open" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Healthy Homes Visits" })).toBeVisible();
    const card = page.getByRole("complementary", { name: "Score card" });
    await card.getByRole("spinbutton", { name: /Community impact score/ }).fill("5");
    await card.getByRole("spinbutton", { name: /Feasibility score/ }).fill("4");
    await card.getByRole("spinbutton", { name: /Budget reasonableness score/ }).fill("4");
    await card.getByRole("spinbutton", { name: /Reach to underserved families score/ }).fill("5");
    await expect(card.getByText("4 of 4 scored")).toBeVisible();
    await card.getByRole("radio", { name: "Fund", exact: true }).check();
    await card.getByLabel("Narrative for the panel").fill("Strong reach and a realistic plan.");
    await card.getByRole("button", { name: "Submit review" }).click();
    await expect(card.getByRole("status")).toContainText("Submitted");
  });

  await test.step("panel: rank, allocate and commit", async () => {
    await page.getByRole("banner").getByRole("link", { name: /Reviewer portal/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await page.locator("main").getByRole("link", { name: /^Riverbend Community Foundation/ }).click();
    await rail(page, "Reviews").click();
    await page.getByRole("link", { name: "Open panel" }).click();
    const ranking = page.getByRole("table", { name: "Ranking and decisions" });
    const northgate = ranking.getByRole("row").filter({ hasText: "Northgate Housing Trust" });
    await expect(northgate).toContainText("3"); // the review just submitted is counted
    await northgate.getByRole("radio", { name: "Approve" }).check();
    await northgate.getByLabel("Allocation for Northgate Housing Trust").fill("110000");
    const headroom = page.getByRole("region", { name: "Program headroom" });
    await expect(headroom.getByRole("group", { name: "Program budget headroom" })).toContainText("Pending $110,000");
    await headroom.getByRole("button", { name: "Commit decisions" }).click();
    const confirm = page.getByRole("dialog", { name: "Commit 1 decision?" });
    await expect(confirm).toContainText("1 approved");
    await confirm.getByRole("button", { name: "Commit decisions" }).click();
    await expect(headroom.getByRole("status")).toContainText("1 decision committed");
  });

  await test.step("the award is offered and its agreement goes out", async () => {
    await page.getByRole("link", { name: "Open award for Northgate Housing Trust" }).click();
    const agreement = page.getByRole("region", { name: "Grant agreement" });
    await agreement.getByRole("button", { name: "Send to grantee" }).click();
    await expect(agreement.getByText("Sent", { exact: true }).first()).toBeVisible();
  });

  await test.step("the applicant accepts the offer and signs", async () => {
    await switchWorkspace(page, "Alder Creek Family Services");
    await page.getByRole("navigation", { name: "Applicant workspace" }).getByRole("link", { name: "My grants" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Mobile Health Navigation for Rural Families" })).toBeVisible();
    await page.getByRole("button", { name: "Accept award" }).click();
    await expect(page.getByRole("table", { name: "Grants" }).getByRole("row").filter({ hasText: "Mobile Health Navigation" })).toContainText("Accepted");
    await page.getByRole("button", { name: "Review and sign" }).click();
    const sign = page.getByRole("dialog", { name: "Sign the grant agreement" });
    await expect(sign.getByRole("button", { name: "Sign agreement" })).toBeDisabled();
    await sign.getByLabel("Type your full legal name").fill("Dana Ortiz");
    await expect(sign.getByRole("button", { name: "Sign agreement" })).toBeDisabled();
    await sign.getByRole("checkbox").check();
    await sign.getByRole("button", { name: "Sign agreement" }).click();
    await expect(sign).toBeHidden();
    await expect(page.getByRole("region", { name: "Grant agreement" })).toContainText("Signed by grantee");
  });

  await test.step("the funder countersigns and the award becomes active", async () => {
    await switchWorkspace(page, "Riverbend Community Foundation");
    await rail(page, "Awards").click();
    await page.getByRole("table", { name: "Awards" }).getByRole("link", { name: "Alder Creek Family Services" }).click();
    const agreement = page.getByRole("region", { name: "Grant agreement" });
    await expect(agreement).toContainText("Signed by grantee");
    await agreement.getByRole("button", { name: "Countersign…" }).click();
    const d = page.getByRole("dialog", { name: "Countersign the grant agreement" });
    await d.getByLabel("Type your full legal name").fill("Dana Ortiz");
    await d.getByRole("checkbox").check();
    await d.getByRole("button", { name: "Countersign", exact: true }).click();
    await expect(d).toBeHidden();
    await expect(agreement).toContainText("Executed");
    await expect(page.getByRole("table", { name: "Awards" }).getByRole("row").filter({ hasText: "Alder Creek Family Services" })).toContainText("Active");
  });
  void rail;
});
