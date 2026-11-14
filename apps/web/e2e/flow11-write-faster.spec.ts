// SPDX-License-Identifier: AGPL-3.0-only
// Flow 11 — Write faster as a team (v1.6), with the assistant on. Turn on go/no-go → score an
// opportunity at Deciding and go → the assistant reads the funder's guidelines (questions, limits,
// required documents) → an AI draft from the library, with a stale figure flagged, accepted and
// noted as AI use → a comment and the approval → the checklist uses the vault and plans milestones
// → the library answer is verified → the vault refuses bank paperwork → the calendar shows the
// deadline. A second test proves every AI action is hidden when the assistant is off.
import { dialog, expect, rail, start, test } from "./helpers.ts";

const GUIDELINES = `Meadowlark Foundation — Senior Mobility Grants

Please answer the following questions.

1. Describe the need your project addresses and who it serves. (150 words)

2. How will you measure success? Maximum 1,000 characters.

Attachments: include your IRS determination letter and your most recent audit.`;

test("write faster as a team, with the assistant on", async ({ app: page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __GMS_MOCK_ASSIST__: boolean }).__GMS_MOCK_ASSIST__ = true;
  });
  await start(page, "/w/alder-creek/settings");

  await test.step("an admin turns on the go/no-go scorecard", async () => {
    const card = page.getByRole("region", { name: "Grant seeking" });
    await card.getByRole("switch", { name: "Go/no-go scorecard" }).click();
    await expect(card.getByLabel("Fit with our work")).toHaveValue("3");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Saved")).toBeVisible();
  });

  await test.step("score an opportunity at Deciding, and go", async () => {
    await rail(page, "Applications").click();
    await page.getByRole("link", { name: "Senior Ride Program" }).click();
    const card = page.getByRole("region", { name: "Go or no-go?" });
    await card.getByRole("radio", { name: "Yes, it passes" }).check();
    for (const [label, n] of [["Fit with our work", 5], ["Capacity to do it", 4], ["Effort against the amount", 3], ["Relationship with the funder", 2]] as const) {
      await card.getByRole("radio", { name: new RegExp(`^${label}: ${n},`) }).check();
    }
    await expect(card.getByText("Score 31 of 40")).toBeVisible();
    await card.getByLabel("Why (optional)").fill("Close fit with our rides program; the funder knows our work.");
    await card.getByRole("button", { name: "Go: start the application" }).click();
    await expect(page.getByText("Go. Moved to Drafting.")).toBeVisible();
    await expect(page.locator(".ph .title")).toContainText("Drafting");
    await expect(page.getByRole("region", { name: "Go/no-go" })).toContainText("31 of 40");
  });

  await test.step("the assistant reads the funder's guidelines", async () => {
    await page.getByRole("button", { name: "Paste questions" }).first().click();
    const paste = dialog(page, "Paste the funder’s questions");
    await paste.getByRole("button", { name: "Read the funder’s guidelines" }).click();
    await paste.getByRole("textbox", { name: "The funder’s guidelines" }).fill(GUIDELINES);
    await expect(paste.getByText("never your document vault", { exact: false })).toBeVisible();
    await paste.getByRole("button", { name: "Read the guidelines" }).click();
    const proposed = paste.getByRole("list", { name: "Proposed questions" });
    await expect(proposed.getByRole("listitem")).toHaveCount(2);
    await expect(proposed.getByRole("listitem").nth(0)).toContainText("150 words (found in the text)");
    await expect(paste.getByRole("group", { name: "Documents the funder asks for" })).toContainText("IRS determination letter");
    await paste.getByRole("button", { name: "Save 2 questions and 2 documents" }).click();
    await expect(paste).toBeHidden();
    await expect(page.getByText("2 questions added · 2 documents added to the checklist")).toBeVisible();
  });

  await test.step("an AI draft from the library: cited, placeholders marked, a stale figure flagged, accepted", async () => {
    const q1 = page.getByRole("article", { name: /Describe the need your project addresses/ });
    await q1.getByRole("button", { name: "Draft with AI" }).click();
    const panel = q1.getByRole("region", { name: "AI draft" });
    await expect(panel).toContainText("of 100 AI drafts left this month");
    await panel.getByRole("button", { name: "Write a draft" }).click();
    const draft = panel.getByRole("status", { name: "The draft" });
    await expect(draft.locator("mark").first()).toContainText("[");
    await expect(draft.getByRole("list", { name: "Library answers used" })).toContainText("Need");
    await expect(draft.getByText("Check these figures")).toBeVisible();
    await expect(draft).toContainText("46 miles");
    await panel.getByRole("button", { name: "Accept the draft" }).click();
    await expect(panel).toBeHidden();
    await expect(q1.getByText("Drafted with AI", { exact: true })).toBeVisible();
    await expect(page.getByRole("note", { name: "AI use" })).toContainText("question 1 was drafted with AI");
  });

  await test.step("a comment for the team, and the approval", async () => {
    const q1 = page.getByRole("article", { name: /Describe the need your project addresses/ });
    await q1.getByRole("button", { name: "Comments" }).click();
    const comments = q1.getByRole("region", { name: "Comments on question 1" });
    await comments.getByLabel("Comment on question 1").fill("Fill in the placeholder before Friday.");
    await comments.getByRole("button", { name: "Post" }).click();
    await expect(comments.getByRole("list", { name: "Comments" })).toContainText("Fill in the placeholder before Friday.");
    await q1.getByLabel("Status of question 1").selectOption("approved");
    await expect(q1.locator(".card-h")).toContainText("Approved");
  });

  await test.step("the checklist uses the vault and plans the writing", async () => {
    await page.getByRole("tab", { name: "Checklist" }).click();
    const req = page.getByRole("region", { name: "Required documents" });
    await req.getByRole("button", { name: "Use from vault: IRS determination letter.pdf" }).click();
    await expect(req.getByRole("listitem", { name: "IRS determination letter" })).toContainText("Ready");
    await expect(req).toContainText("1 of 2 ready");
    const plan = page.getByRole("region", { name: "Plan the writing back from the full deadline?" });
    await plan.getByRole("button", { name: "Add these tasks" }).click();
    await expect(plan).toBeHidden();
    await expect(page.getByRole("list", { name: "Tasks" })).toContainText("First draft due");
    await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Final version ready");
  });

  await test.step("the library answer the draft used is checked again", async () => {
    await rail(page, "Answer library").click();
    await page.getByRole("button", { name: /^Need/ }).click();
    const keep = page.getByRole("region", { name: "Keep it current" });
    await expect(keep).toContainText("Needs checking");
    await keep.getByRole("button", { name: "Mark as verified" }).click();
    await expect(keep.getByText(/^Verified /)).toBeVisible();
  });

  await test.step("the vault refuses bank paperwork and keeps the annual report", async () => {
    await rail(page, "Organization").click();
    await page.getByRole("link", { name: "Open documents" }).click();
    await page.getByRole("button", { name: "Add a document" }).click();
    const up = dialog(page, "Add a document to the vault");
    await up.getByLabel("Choose a file").setInputFiles({ name: "Bank letter 2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
    await expect(up.getByRole("alert")).toContainText("looks like bank or tax paperwork");
    await up.getByLabel("Choose a file").setInputFiles({ name: "Annual report 2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
    await up.getByLabel(/What it is/).selectOption({ label: "Annual report" });
    await up.getByRole("button", { name: "Add to the vault" }).click();
    await expect(up).toBeHidden();
    await expect(page.getByRole("table", { name: "Documents" })).toContainText("Annual report 2026.pdf");
  });

  await test.step("the pipeline calendar shows what is due", async () => {
    await rail(page, "Applications").click();
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByRole("list", { name: "Deadlines" })).toContainText("Senior Ride Program");
  });
});

test("every AI action is hidden when the assistant is off", async ({ app: page }) => {
  await start(page, "/w/alder-creek/outside/oap_d1000000-0000-7000-8000-000000000001");
  const q1 = page.getByRole("article", { name: /Describe the need your project addresses/ });
  await expect(q1.getByRole("button", { name: "Insert from library" })).toBeVisible();
  await expect(q1.getByRole("button", { name: "Draft with AI" })).toHaveCount(0);
  await expect(q1.getByRole("button", { name: "Fit to limit" })).toHaveCount(0);
  await page.getByRole("button", { name: "Paste questions" }).first().click();
  const paste = dialog(page, "Paste the funder’s questions");
  await expect(paste.getByLabel("Questions")).toBeVisible();
  await expect(paste.getByRole("button", { name: "Read the funder’s guidelines" })).toHaveCount(0);
});
