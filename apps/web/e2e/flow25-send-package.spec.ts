// SPDX-License-Identifier: AGPL-3.0-only
// Flow 25 — Send to the funder (C4). An outside application, written in the GMS, for a funder who
// is not on it → the checklist uses a vault document → "Send to the funder" lists exactly the
// package (the PDF, that vault document, answers.txt), with the footer line → the PDF and the ZIP
// download → an answer that holds an account number stops the package, naming the question →
// taken out, the email is previewed (under the person's name, replies to them) and sent → the
// footer line is switched off for the workspace.
import { dialog, expect, start, test } from "./helpers.ts";

const APP = "/w/alder-creek/outside/oap_d1000000-0000-7000-8000-000000000001";

test("send an outside application to the funder", async ({ app: page }) => {
  await start(page, APP);
  await expect(page.getByRole("heading", { level: 1, name: "Family Navigation Expansion" })).toBeVisible();

  await test.step("the checklist uses a vault document", async () => {
    await page.getByRole("tab", { name: "Checklist" }).click();
    const req = page.getByRole("region", { name: "Required documents" });
    await req.getByRole("button", { name: "Use from vault: IRS determination letter.pdf" }).click();
    await expect(req.getByRole("listitem", { name: "IRS determination letter" })).toContainText("Ready");
  });

  await test.step("the package holds the answers, that document and answers.txt, and nothing else", async () => {
    await page.getByRole("button", { name: "Send to the funder" }).click();
    const d = dialog(page, "Send to the funder");
    const files = d.getByRole("list", { name: "Files in the package" });
    await expect(files.getByRole("listitem")).toHaveCount(3);
    await expect(files.getByRole("listitem").nth(0)).toContainText("Family-Navigation-Expansion.pdf");
    await expect(files.getByRole("listitem").nth(0)).toContainText("budget summary");
    await expect(files.getByRole("listitem").nth(1)).toContainText("IRS determination letter.pdf");
    await expect(files.getByRole("listitem").nth(1)).toContainText("from your vault, for “IRS determination letter”");
    await expect(files.getByRole("listitem").nth(2)).toContainText("answers.txt");
    // Only the IRS letter was used for this application: the audit and board list in the vault stay out.
    await expect(files).not.toContainText("Audit");
    await expect(d).toContainText("1 question has no answer yet");
    await expect(d).toContainText("Your team’s internal deadline is left out.");
    await expect(d).toContainText("Prepared with the OpenGrants Grant Management System, free for funders and applicants · gms.opengrants.io");
  });

  await test.step("the PDF and the ZIP download", async () => {
    const d = dialog(page, "Send to the funder");
    const pdf = page.waitForEvent("download");
    await d.getByRole("button", { name: "Download PDF" }).click();
    expect((await pdf).suggestedFilename()).toBe("Family-Navigation-Expansion.pdf");
    const zip = page.waitForEvent("download");
    await d.getByRole("button", { name: /^Download ZIP/ }).click();
    expect((await zip).suggestedFilename()).toBe("Family-Navigation-Expansion-package.zip");
    await d.locator(".ft").getByRole("button", { name: "Close" }).click();
    await expect(d).toBeHidden();
  });

  await test.step("an answer that holds an account number stops the package", async () => {
    await page.getByRole("tab", { name: /Questions/ }).click();
    const q2 = page.getByRole("article", { name: /How will you measure success/ });
    await q2.getByRole("textbox", { name: "Answer to question 2" }).fill("We count appointments kept each quarter. Payments go to account 000123456789.");
    await q2.getByRole("button", { name: "Save answer" }).click();
    await expect(q2.getByText(/Saved as version/)).toBeVisible();
    await page.getByRole("button", { name: "Send to the funder" }).click();
    const d = dialog(page, "Send to the funder");
    const stop = d.getByRole("alert");
    await expect(stop).toContainText("This package cannot be made yet");
    await expect(stop).toContainText("The answer to question 2 (“How will you measure success? Maximum 1,500 characters including spaces.”) looks like it holds an account or card number.");
    await expect(stop).not.toContainText("000123456789");
    await expect(d.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    await expect(d).toContainText("It cannot be emailed from here now");
    await d.locator(".ft").getByRole("button", { name: "Close" }).click();
    await q2.getByRole("textbox", { name: "Answer to question 2" }).fill("We count appointments kept and referrals completed each quarter.");
    await q2.getByRole("button", { name: "Save answer" }).click();
    await expect(q2.getByText(/Saved as version 2/)).toBeVisible();
  });

  await test.step("the email is previewed, then exactly that is sent", async () => {
    await page.getByRole("button", { name: "Send to the funder" }).click();
    const d = dialog(page, "Send to the funder");
    await expect(d.getByRole("alert")).toHaveCount(0);
    await expect(d).toContainText("Up to 5 a day for this application; 5 left today.");
    await d.getByLabel(/Funder contact’s email/).fill("ruth.calloway@northwind.example");
    await d.getByLabel(/^Message/).fill("Dear Ruth, as we discussed, our application is attached.");
    await d.getByRole("button", { name: "Preview the email" }).click();
    const preview = d.getByRole("region", { name: "The email that will be sent" });
    await expect(preview).toContainText('"Dana Ortiz" <');
    await expect(preview).toContainText("ruth.calloway@northwind.example");
    await expect(preview).toContainText("Replies go to");
    await expect(preview).toContainText("dana.ortiz@riverbendcf.example");
    await expect(preview).toContainText("Application: Family Navigation Expansion");
    await expect(preview).toContainText("Dear Ruth, as we discussed");
    await expect(preview.getByRole("listitem")).toHaveText(["Family-Navigation-Expansion.pdf", "IRS determination letter.pdf"]);
    await d.getByRole("button", { name: "Send the email" }).click();
    await expect(d.getByText("Sent to ruth.calloway@northwind.example")).toBeVisible();
    await expect(d).toContainText("4 more emails of this package can go today.");
  });

  await test.step("an admin switches the footer line off", async () => {
    const d = dialog(page, "Send to the funder");
    await d.getByLabel("Show this line on packages from this workspace").uncheck();
    await expect(d).toContainText("Packages from this workspace carry no footer line.");
    await d.locator(".ft").getByRole("button", { name: "Close" }).click();
    await expect(d).toBeHidden();
  });
});
