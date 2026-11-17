// SPDX-License-Identifier: AGPL-3.0-only
// Flow 29 — Connected apps (v1.12.0), in mock mode (no Composio, Slack, Google or Salesforce). A
// funder admin opens Settings › Connected apps, connects Slack, picks #grants and the events, and
// saves (alerts start from now); connects their own Google Calendar and chooses a calendar, and the
// deadlines are written. In the applicant workspace an admin connects Google Drive, attaches a file
// from Drive in the document vault (it goes through the same checks as an upload), and imports
// grants from Salesforce with the Nonprofit Success Pack preset, read only.
import { dialog, expect, rail, shown, start, switchWorkspace, test } from "./helpers.ts";

test("connect Slack alerts, a calendar, Google Drive and Salesforce", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/passport");

  await test.step("funder: Slack alerts to #grants", async () => {
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Connected apps" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connected apps" })).toBeVisible();
    const slack = page.getByRole("region", { name: "Slack alerts" });
    await expect(slack.getByText("Not connected")).toBeVisible();
    await slack.getByRole("button", { name: "Connect Slack", exact: true }).click();
    await expect(slack.getByText("Connected", { exact: true })).toBeVisible();
    await slack.getByRole("combobox", { name: "Channel" }).selectOption({ label: "#grants" });
    await expect(slack.getByRole("checkbox", { name: "Review assigned" })).toBeChecked();
    await slack.getByRole("checkbox", { name: "Review assigned" }).uncheck();
    await expect(slack).toContainText("never includes an applicant's answers, email addresses or amounts");
    await slack.getByRole("button", { name: "Save alerts" }).click();
    await expect(shown(page, "Saved. Alerts start from now.")).toBeVisible();
  });

  await test.step("funder: my Google Calendar", async () => {
    const cal = page.getByRole("region", { name: "My Google Calendar" });
    await cal.getByRole("button", { name: "Connect my Google Calendar" }).click();
    await cal.getByRole("combobox", { name: "Calendar" }).selectOption({ label: "Grant deadlines" });
    await cal.getByRole("button", { name: "Use this calendar" }).click();
    await expect(shown(page, "3 deadlines written.")).toBeVisible();
    await expect(cal).toContainText("3 deadlines in Grant deadlines");
  });

  await test.step("applicant: connect Google Drive", async () => {
    await switchWorkspace(page, "Alder Creek Family Services");
    await rail(page, "Settings").click();
    await page.getByRole("region", { name: "Connected apps" }).getByRole("link", { name: "Open connected apps" }).click();
    const drive = page.getByRole("region", { name: "Google Drive" });
    await drive.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
    await expect(drive.getByText("Connected", { exact: true })).toBeVisible();
    // An applicant team has no review alerts.
    const slack = page.getByRole("region", { name: "Slack alerts" });
    await slack.getByRole("button", { name: "Connect Slack", exact: true }).click();
    await expect(slack.getByRole("checkbox", { name: "Review assigned" })).toHaveCount(0);
    await expect(slack.getByRole("checkbox", { name: "Deadline in 3 days" })).toBeVisible();
  });

  await test.step("applicant: attach a file from Google Drive in the document vault", async () => {
    await rail(page, "Organization").click();
    await page.getByRole("link", { name: "Open documents" }).click();
    await page.getByRole("button", { name: "Add a document" }).first().click();
    const add = dialog(page, "Add a document to the vault");
    await add.getByRole("button", { name: "Attach from Google Drive" }).click();
    await expect(add.getByText("Budget 2027.pdf copied from Google Drive")).toBeVisible();
    await expect(add.getByText("Budget 2027.pdf", { exact: true })).toBeVisible();
    await add.getByRole("button", { name: "Close" }).click();
  });

  await test.step("applicant: import grants from Salesforce, read only", async () => {
    await rail(page, "Applications").click();
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await page.getByRole("radio", { name: /Salesforce/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("region", { name: "Connect Salesforce" })).toContainText("The GMS only runs read queries and never changes a record");
    await page.getByRole("button", { name: "Connect Salesforce", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What should be read from Salesforce?" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Grants/ })).toBeChecked();
    await page.getByRole("radio", { name: /A query of my own/ }).check();
    await page.getByRole("textbox", { name: "SOQL query" }).fill("SELECT Id FROM Account FOR UPDATE");
    await page.getByRole("button", { name: "Read it" }).click();
    await expect(page.getByRole("alert")).toContainText("FOR UPDATE");
    await page.getByRole("radio", { name: /Grants/ }).check();
    await page.getByRole("button", { name: "Read it" }).click();
    await expect(page.getByRole("heading", { name: "Match columns to fields" })).toBeVisible();
    await expect(page.getByLabel(/^Title/)).toHaveValue("Grant name");
    await expect(page.getByLabel(/^Funder/)).toHaveValue("Funder");
  });
});
