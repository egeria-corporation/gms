// SPDX-License-Identifier: AGPL-3.0-only
// Flow 12 — Win and keep it (v1.7). A submitted outside application is awarded (amount and grant
// period) → the outside award page → a report series and an expected payment → the report is
// written by reusing an earlier report's answer, marked submitted (an "as submitted" PDF with its
// fingerprint) and done → the payment arrives → close out → Awarded funding lists it as an outside
// award → the Funding summary counts it and exports → a declined application sets an alert for
// its next cycle.
import { dialog, expect, rail, start, test } from "./helpers.ts";

const PINECREST = "oap_d1000000-0000-7000-8000-000000000003";
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test("win and keep an outside award", async ({ app: page }) => {
  await start(page, `/w/alder-creek/outside/${PINECREST}`);

  await test.step("record the award with its grant period", async () => {
    await page.getByRole("button", { name: "Record decision" }).click();
    const decision = dialog(page, "Record the decision");
    await decision.getByLabel(/Amount awarded/).fill("40000");
    await decision.getByLabel("Grant starts").fill(iso(-200));
    await decision.getByLabel("Grant ends").fill(iso(30));
    await decision.getByRole("button", { name: "Record awarded" }).click();
    await expect(decision).toBeHidden();
    await page.getByRole("region", { name: "Awarded" }).getByRole("link", { name: "Open the award" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Youth Mentoring Pilot" })).toBeVisible();
    await expect(page.locator(".ph .title")).toContainText("Outside award");
  });

  await test.step("what the grant asks for: a report series and an expected payment", async () => {
    await page.getByRole("button", { name: "Add an obligation" }).first().click();
    let add = dialog(page, "Add an obligation");
    await add.getByLabel("Title").fill("Six-month report");
    await add.getByRole("radio", { name: "Repeats" }).check();
    await add.getByLabel("Every (months)").fill("6");
    await expect(add.getByText(/^Makes 1:/)).toBeVisible();
    await add.getByRole("button", { name: "Add the series" }).click();
    await expect(add).toBeHidden();

    await page.getByRole("button", { name: "Add an obligation" }).first().click();
    add = dialog(page, "Add an obligation");
    await add.getByLabel("What the grant asks for").selectOption("payment_expected");
    await add.getByLabel("Title").fill("Grant payment");
    await add.getByLabel(/Amount \(USD\)/).fill("40000");
    await add.getByLabel("Expected on").fill(iso(10));
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("list", { name: "Obligations" }).getByRole("listitem")).toHaveCount(2);
  });

  await test.step("write the report by reusing an earlier report's answer, then mark it submitted", async () => {
    const report = page.getByRole("listitem", { name: /^Six-month report/ });
    await report.getByRole("button", { name: "Write the report" }).click();
    await report.getByLabel("Add a report question").fill("Describe the progress made so far.");
    await report.getByRole("button", { name: "Add", exact: true }).click();
    const q = report.getByRole("article", { name: /Describe the progress made so far/ });
    await q.getByRole("button", { name: "Reuse from an earlier report" }).click();
    const reuse = dialog(page, "Reuse from an earlier report");
    await reuse.getByRole("button", { name: /Use the answer to “Describe the progress made in the first six months/ }).click();
    await expect(reuse).toBeHidden();
    await expect(q.getByRole("textbox", { name: "Answer to question 1" })).toHaveValue(/Both school clinics opened/);
    await expect(q.getByText("From an earlier report", { exact: true })).toBeVisible();

    await report.getByRole("button", { name: "Mark submitted" }).click();
    const submit = dialog(page, "Mark the report submitted");
    await submit.getByLabel("Confirmation number").fill("PFF-R1");
    await submit.getByRole("button", { name: "Mark submitted" }).click();
    await expect(submit).toBeHidden();
    await expect(report).toContainText("Submitted");
    await expect(report).toContainText("as submitted");
    await expect(report).toContainText("Fingerprint (SHA-256)");
    await report.getByRole("button", { name: "Mark done (the funder accepted it)" }).click();
    await expect(report.locator(".bdg").first()).toContainText("Done");
  });

  await test.step("the payment arrives, then close out", async () => {
    const payment = page.getByRole("listitem", { name: /^Grant payment/ });
    await payment.getByRole("button", { name: "Record it received" }).click();
    await payment.getByRole("button", { name: "Save" }).click();
    await expect(payment.locator(".bdg").first()).toContainText("Received");
    const received = page.getByRole("region", { name: "Payments received" });
    await expect(received).toContainText("Received $40,000");
    await page.getByRole("region", { name: "Close out" }).getByRole("button", { name: "Close out this award" }).click();
    await expect(page.getByText(/^Closed out on /).first()).toBeVisible();
  });

  await test.step("Awarded funding lists it as an outside award", async () => {
    await rail(page, "Awarded funding").click();
    const row = page.getByRole("table", { name: "Grants" }).getByRole("row", { name: /Youth Mentoring Pilot/ });
    await expect(row).toContainText("Outside award");
    await expect(row).toContainText("Closed out");
    await expect(page.getByRole("table", { name: "Grants" }).getByRole("row", { name: /Clinic Navigation Pilot/ })).toContainText("On this GMS");
  });

  await test.step("the funding summary counts it and exports", async () => {
    await rail(page, "Funding summary").click();
    await expect(page.getByRole("table", { name: "Funding by fiscal year" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Spreadsheet (CSV)" }).click();
    expect((await download).suggestedFilename()).toBe("funding-summary.csv");
  });

  await test.step("a declined application: the next cycle, and an alert when it reopens", async () => {
    await rail(page, "Applications").click();
    await page.getByRole("link", { name: "Community Clinics Initiative" }).click();
    const next = page.getByRole("region", { name: "Next cycle" });
    await expect(next).toContainText("A reminder goes to the application’s owner by email on that day.");
    await next.getByRole("button", { name: "Get an alert when it reopens" }).click();
    await expect(next).toContainText("Alert set for “Community Clinics”");
  });
});
