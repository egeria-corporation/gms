// SPDX-License-Identifier: AGPL-3.0-only
// Flow 5 — Applicant: report and share. Dashboard → reports due → a prefilled report → submit →
// the funder accepts it → the linked tranche becomes due → the applicant shares the accepted
// report with another funder.
import { expect, rail, start, switchWorkspace, test } from "./helpers.ts";

test("report and share", async ({ app: page }) => {
  await start(page, "/w/alder-creek");

  await test.step("open the report that is due", async () => {
    const due = page.getByRole("region", { name: "Reports due" });
    await expect(due).toContainText("Final report · Clinic Navigation Pilot");
    await due.getByRole("link", { name: "Final report · Clinic Navigation Pilot" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Final report · Clinic Navigation Pilot" })).toBeVisible();
  });

  await test.step("start the report: it arrives prefilled with where each value came from", async () => {
    await page.getByRole("button", { name: "Start report", exact: true }).click();
    const report = page.getByRole("region", { name: "Report", exact: true });
    await expect(report.getByRole("textbox", { name: /^Legal name/ })).toHaveValue("Alder Creek Family Services");
    await expect(report.getByRole("textbox", { name: /^What happened this period/ })).toHaveAccessibleName(/From prior report/);
    await expect(report.getByRole("spinbutton", { name: /^Families served to date/ })).toHaveValue("212");
  });

  await test.step("update, certify and submit", async () => {
    const report = page.getByRole("region", { name: "Report", exact: true });
    await report.getByRole("spinbutton", { name: /^Families served to date/ }).fill("240");
    await report.getByText("I certify that this report is accurate and complete").click();
    await expect(report.getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("navigation", { name: "Report sections" })).not.toContainText("to fix");
    await page.getByRole("button", { name: "Submit report" }).click();
    const row = page.getByRole("table", { name: "Reporting requirements" }).getByRole("row").filter({ hasText: "Final report" });
    await expect(row).toContainText("Submitted");
  });

  await test.step("the funder accepts a report, which makes its tranche due", async () => {
    await switchWorkspace(page, "Riverbend Community Foundation");
    await rail(page, "Reporting").click();
    await page.getByRole("tab", { name: /^Received/ }).click();
    const received = page.getByRole("table", { name: "Reports received" });
    await expect(received.getByRole("row").filter({ hasText: "2026 final report" })).toContainText("Shared by grantee");
    await received.getByRole("button", { name: "Interim report" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Interim report" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Accepting makes the next tranche due");
    await page.getByRole("button", { name: "Accept report" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Report accepted" })).toContainText("The tranche it releases is now due in Payments");
    const accepted = page.getByRole("table", { name: "Reports received" }).getByRole("row").filter({ hasText: "Interim report" });
    await expect(accepted).toContainText("Accepted");
    await expect(accepted).not.toContainText("Another funder");
    await rail(page, "Payments").click();
    // Tranche 2 ($60,000) joined the list of payments due; nothing was released.
    await expect(page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /^Due/ })).toContainText("4");
    await expect(page.locator("main")).toContainText("$60,000");
  });

  await test.step("the applicant shares an accepted report with another funder", async () => {
    await switchWorkspace(page, "Alder Creek Family Services");
    await page.getByRole("navigation", { name: "Applicant workspace" }).getByRole("link", { name: "Reports" }).click();
    await page.getByRole("button", { name: /^View and share: Mid-year progress report/ }).click();
    await page.getByRole("button", { name: "Share this report" }).click();
    const share = page.getByRole("dialog", { name: /^Share/ });
    await share.getByText("Grant funds spent to date", { exact: true }).click(); // keep the spending figure private
    await share.getByLabel("Note to the funder (optional)").fill("Same program you fund; sharing our mid-year results.");
    await expect(share).toContainText("This is recorded as your consent");
    await share.getByRole("button", { name: "Share with Riverbend Community Foundation" }).click();
    await expect(share).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Report status" })).toContainText(/Shared with Riverbend Community Foundation/);
  });
});
