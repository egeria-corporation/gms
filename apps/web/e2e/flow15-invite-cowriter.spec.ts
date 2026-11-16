// SPDX-License-Identifier: AGPL-3.0-only
// Flow 15 — Write with others, and the AI summary in review (v1.7). A person opens the link from an
// invitation into a draft and lands on the question they were asked to write, assigned to them →
// the admin sees the one-time "Writing with others?" note → invites a cowriter from a question's
// assignee picker (one email, no reminders, the address masked while it waits) → a second
// invitation to the waiting address is refused → the note is dismissed → a built-in application's
// section picker invites too. Then the funder: the AI summary panel, marked "Review before
// relying on it", is written once and read again without spending the quota, and it is gone when
// the assistant is off.
import { dialog, expect, rail, shown, start, test } from "./helpers.ts";

test("invite a cowriter into a draft", async ({ app: page }) => {
  await start(page, "/invitations/draft?token=gms_inv_mock_cowriter");

  await test.step("the invitation link lands on the question, assigned", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Family Navigation Expansion" })).toBeVisible();
    await expect(page).toHaveURL(/tab=questions&question=oqn_d3000000-0000-7000-8000-000000000003/);
    const q3 = page.getByRole("article", { name: /history and mission/ });
    await expect(q3.getByRole("combobox", { name: "Who writes question 3" }).locator("option:checked")).toHaveText("Maria Santos");
    await expect(q3.getByRole("textbox", { name: "Answer to question 3" })).toBeFocused();
  });

  await test.step("the admin sees the one-time note", async () => {
    const note = page.getByRole("region", { name: "Writing with others" });
    await expect(note).toContainText("Writing with others? Invite a teammate");
    await expect(note).toContainText("They see only this application and can write its answers.");
  });

  await test.step("invite someone by email from a question's assignee picker", async () => {
    const q2 = page.getByRole("article", { name: /How will you measure success/ });
    await q2.getByRole("combobox", { name: "Who writes question 2" }).selectOption({ label: "Invite someone by email…" });
    const invite = dialog(page, "Invite someone to help write this");
    await expect(invite).toContainText("How will you measure success?");
    await expect(invite).toContainText("can open only this application and write its answers");
    await expect(invite).toContainText("We send one email when you click Send invitation. There are no reminders.");
    await expect(invite).toContainText("Your workspace can send 20 more invitations today.");
    await invite.getByLabel(/Their email address/).fill("priya@writers.example");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(invite).toBeHidden();
    await expect(shown(page, "Invitation sent to p…@writers.example")).toBeVisible();
    // Assigned when they accept; until then the picker shows them waiting, masked.
    const picker = q2.getByRole("combobox", { name: "Who writes question 2" });
    await expect(picker.locator("option:checked")).toHaveText("Jamal Reed");
    await expect(picker.getByRole("option", { name: "Invited: p…@writers.example (waiting)" })).toBeDisabled();
  });

  await test.step("a waiting address is not sent another email", async () => {
    await page.getByRole("region", { name: "Writing with others" }).getByRole("button", { name: "Invite a teammate" }).click();
    const invite = dialog(page, "Invite someone to help write this");
    await expect(invite).toContainText("Your workspace can send 19 more invitations today.");
    await invite.getByLabel(/Their email address/).fill("priya@writers.example");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(invite.getByText(/already has an invitation waiting/)).toBeVisible();
    await invite.getByRole("button", { name: "Cancel" }).click();
    await expect(invite).toBeHidden();
  });

  await test.step("the note is dismissed for good", async () => {
    await page.getByRole("region", { name: "Writing with others" }).getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("region", { name: "Writing with others" })).toBeHidden();
    await page.getByRole("tab", { name: "Notes" }).click();
    await page.getByRole("tab", { name: /Questions/ }).click();
    await expect(page.getByRole("region", { name: "Writing with others" })).toBeHidden();
  });
});

test("invite a cowriter into a built-in application's section", async ({ app: page }) => {
  await start(page, "/w/alder-creek/applications/app_90000000-0000-7000-8000-000000000001/edit");
  await page.getByRole("tab", { name: "Assignments" }).click();
  const project = page.getByRole("tabpanel", { name: "Assignments" }).getByRole("combobox", { name: "Project", exact: true });
  await project.selectOption({ label: "Invite someone by email…" });
  const invite = dialog(page, "Invite someone to help write this");
  await expect(invite).toContainText("When they accept, “Project” is assigned to them");
  await invite.getByLabel(/Their email address/).fill("sam@writers.example");
  await invite.getByRole("button", { name: "Send invitation" }).click();
  await expect(invite).toBeHidden();
  await expect(shown(page, "Invitation sent to s…@writers.example")).toBeVisible();
  await expect(project.getByRole("option", { name: "Invited: s…@writers.example (waiting)" })).toBeDisabled();
});

test("the AI summary in funder review is written once and read again without spending", async ({ app: page }) => {
  await start(page, "/w/riverbend/applications");
  const table = page.getByRole("table", { name: "Applications" });
  await page.getByRole("tab", { name: /^All/ }).click();
  await table.getByRole("link", { name: "Community Health Worker Corps" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Community Health Worker Corps" })).toBeVisible();

  const panel = page.getByRole("region", { name: "AI summary" });
  await expect(panel).toContainText("Review before relying on it");
  await expect(panel).toContainText("uses one of this month’s 26 remaining drafts");
  await panel.getByRole("button", { name: "Write the summary" }).click();
  const summary = panel.getByRole("group", { name: "AI summary of this application" });
  await expect(summary).toContainText("Everyone reviewing this version sees the same summary. It does not score or decide anything.");
  await expect(summary).toContainText("Applicant-supplied · Need statement");

  // Back to the inbox and in again: the same summary, nothing more spent.
  await rail(page, "Applications").click();
  await page.getByRole("tab", { name: /^All/ }).click();
  await page.getByRole("table", { name: "Applications" }).getByRole("link", { name: "Community Health Worker Corps" }).click();
  await expect(page.getByRole("region", { name: "AI summary" }).getByRole("group", { name: "AI summary of this application" })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI summary" }).getByRole("button", { name: "Write the summary" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Assistant" })).toContainText("15 of 40 this month");
});

test("the AI summary is hidden when the assistant is off", async ({ app: page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __GMS_MOCK_ASSIST__: boolean }).__GMS_MOCK_ASSIST__ = false;
  });
  await start(page, "/w/riverbend/applications");
  await page.getByRole("tab", { name: /^All/ }).click();
  await page.getByRole("table", { name: "Applications" }).getByRole("link", { name: "Community Health Worker Corps" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Community Health Worker Corps" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Budget" })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI summary" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Assistant" })).toHaveCount(0);
});
