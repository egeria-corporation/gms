// SPDX-License-Identifier: AGPL-3.0-only
// Flow 16 — Anonymized review (review parity, v1.8.0). Program staff turn on anonymized review for
// the full proposal stage and change the competition's conflict-of-interest policy; the reviewer
// must sign the new version before anything opens, then sees "Applicant A-…" in place of who
// applied. Staff build the board docket for the decision meeting.
import { dialog, expect, rail, shown, start, test } from "./helpers.ts";

test("anonymized review", async ({ app: page }) => {
  await start(page, "/w/riverbend/reviews/assign");
  await expect(page.getByRole("heading", { level: 1, name: "Review assignment" })).toBeVisible();
  const settings = page.getByRole("region", { name: /^Review settings/ });

  await test.step("turn on anonymized review for the full proposal stage", async () => {
    await expect(settings).toContainText("Review settings · Full proposal");
    await expect(settings.getByText("Reviewers see who applied")).toBeVisible();
    await settings.getByRole("checkbox", { name: /Anonymized review/ }).check();
    await expect(settings.getByText("Anonymized review on")).toBeVisible();
    // Staff still see every applicant by name.
    await expect(page.getByRole("table", { name: "Reviewers by application" })).toContainText("Harbor Light Shelter");
  });

  await test.step("change the conflict-of-interest policy, so every reviewer signs again", async () => {
    await settings.getByRole("button", { name: "Conflict-of-interest policy…" }).click();
    const d = dialog(page, "Conflict-of-interest policy");
    await expect(d).toContainText("Version 1 · the plain-language default");
    await d.getByLabel("What reviewers agree to").fill("Declare every organization you have worked with in the last five years before you read any application in this round.");
    await d.getByRole("button", { name: "Save policy" }).click();
    await expect(d.getByText("Policy saved")).toBeVisible();
    await expect(d).toContainText("Version 2 · your own text");
    await d.getByRole("button", { name: "Close" }).click();
    await expect(d).toBeHidden();
  });

  await test.step("the conflicts register shows who still has to sign", async () => {
    await settings.getByRole("button", { name: "Conflicts register…" }).click();
    const d = dialog(page, "Conflicts register");
    await expect(d.getByRole("table", { name: "Signatures" })).toContainText("Signed version 1; not the current one");
    await d.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the reviewer signs the new policy before anything opens", async () => {
    await page.getByRole("link", { name: "My assignments" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My assignments" })).toBeVisible();
    await expect(shown(page, "Sign the conflict-of-interest policy first")).toBeVisible();
    await expect(page.getByRole("article").first()).toContainText("Waiting for your signature");
    await page.getByRole("button", { name: "Read and sign…" }).click();
    const d = dialog(page, "Conflict-of-interest policy");
    await expect(d).toContainText("Declare every organization you have worked with");
    const signButton = d.getByRole("button", { name: "Sign the policy" });
    await expect(signButton).toBeDisabled();
    await d.getByLabel("Type your full name to sign").fill("Dana Ortiz");
    await d.getByRole("checkbox", { name: "I have read this policy and agree to it" }).check();
    await signButton.click();
    await expect(d).toBeHidden();
    await expect(shown(page, "Sign the conflict-of-interest policy first")).toBeHidden();
  });

  await test.step("the reviewer sees a code, never the organization", async () => {
    const main = page.locator("main");
    const cards = page.getByRole("article");
    await expect(cards.first()).toContainText(/Applicant A-\d{4}/);
    await expect(cards.filter({ hasText: "Anonymized review" })).toHaveCount(2);
    await expect(main).not.toContainText("Harbor Light Shelter");
    await expect(main).not.toContainText("Lakeside Senior Center");
    await cards.filter({ hasText: "Continue scoring" }).getByRole("button", { name: "Continue scoring" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Applicant A-\d{4}$/ })).toBeVisible();
    await expect(shown(page, "You do not see who applied.")).toBeVisible();
    await expect(main).not.toContainText("Harbor Light Shelter");
  });

  await test.step("staff build the board docket for the decision meeting", async () => {
    await page.getByRole("banner").getByRole("link", { name: /Reviewer portal/ }).click();
    await page.locator("main").getByRole("link", { name: /^Riverbend Community Foundation/ }).click();
    await rail(page, "Reviews").click();
    await page.getByRole("link", { name: "Open panel" }).click();
    await page.getByRole("button", { name: "Board docket…" }).click();
    const d = dialog(page, "Board docket");
    await expect(d.getByRole("checkbox", { name: /Include comments reviewers marked for program staff only/ })).not.toBeChecked();
    await d.getByRole("button", { name: "Build the docket" }).click();
    await expect(d.getByText("Docket ready")).toBeVisible();
    const download = page.waitForEvent("download");
    await d.getByRole("button", { name: "Download the docket (PDF)" }).click();
    expect((await download).suggestedFilename()).toBe("board-docket.pdf");
  });
});
