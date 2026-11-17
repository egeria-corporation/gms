// SPDX-License-Identifier: AGPL-3.0-only
// Flow 27 — Opt-in digests (v1.8). The applicant sees the one-time "Get new matches every Monday"
// prompt on Find funding and turns it on → the prompt does not come back → Settings shows "What we
// email you" with New matches on and Deadlines off → the preview of next Monday's email lists the
// new matches and a link to stop it → Deadlines is turned on from the same card. The funder
// dashboard offers this week's activity once, and "Not now" puts it away. An email's "Stop getting
// this email" link turns that digest off with no sign-in, and a link that was not signed here fails.
import { expect, rail, start, switchWorkspace, test } from "./helpers.ts";

test("turn on new matches and preview next Monday's email", async ({ app: page }) => {
  await start(page, "/w/alder-creek/find");

  await test.step("the one-time prompt on Find funding turns new matches on", async () => {
    const prompt = page.getByRole("region", { name: "Get new matches every Monday" });
    await expect(prompt).toContainText("up to 10 new opportunities that fit your organization");
    await prompt.getByRole("button", { name: "Turn it on" }).click();
    await expect(page.getByRole("status").filter({ hasText: "You will get it on Mondays" })).toBeVisible();
  });

  await test.step("What we email you shows it on, and the preview of next Monday's email", async () => {
    await rail(page, "Settings").click();
    const card = page.getByRole("region", { name: "What we email you" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("switch", { name: "New matches" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByRole("switch", { name: "Deadlines" })).toHaveAttribute("aria-checked", "false");
    await expect(card.getByText(/On: next email Monday, /)).toBeVisible();
    await card.getByRole("button", { name: "Preview next Monday's email" }).click();
    const preview = card.getByRole("region", { name: "Preview of New matches email" });
    await expect(preview).toContainText("Subject: 2 new funding matches for Alder Creek Family Services");
    await expect(preview).toContainText("Rural Health Network Development Planning (Health Resources and Services Administration)");
    await expect(preview).toContainText("Stop getting this email:");
    await card.getByRole("button", { name: "Hide the preview" }).click();
    await expect(preview).toBeHidden();
  });

  await test.step("deadlines are turned on from the same card", async () => {
    const card = page.getByRole("region", { name: "What we email you" });
    await card.getByRole("switch", { name: "Deadlines" }).click();
    await expect(card.getByRole("switch", { name: "Deadlines" })).toHaveAttribute("aria-checked", "true");
    await card.getByRole("button", { name: "Preview next Monday's email" }).nth(1).click();
    await expect(card.getByRole("region", { name: "Preview of Deadlines email" })).toContainText("2 deadlines in the next 3 weeks");
  });

  await test.step("the prompt does not come back", async () => {
    await rail(page, "Find funding").click();
    await expect(page.getByRole("heading", { level: 1, name: "Find funding" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Get new matches every Monday" })).toHaveCount(0);
  });

  await test.step("the funder dashboard offers this week's activity once", async () => {
    await switchWorkspace(page, "Riverbend Community Foundation");
    const prompt = page.getByRole("region", { name: "Get this week's activity every Monday" });
    await expect(prompt).toContainText("Never an applicant's answers");
    await prompt.getByRole("button", { name: "Not now" }).click();
    await expect(prompt).toHaveCount(0);
  });
});

test("an email's stop link turns that digest off without signing in", async ({ app: page }) => {
  await start(page, "/digests/unsubscribe#token=mock_unsubscribe_new_matches");
  await expect(page.getByRole("heading", { level: 1, name: "You won't get this email anymore" })).toBeVisible();
  await expect(page.getByText('"New matches" for Alder Creek Family Services is off.')).toBeVisible();
  await start(page, "/digests/unsubscribe#token=v1.forged");
  await expect(page.getByRole("heading", { level: 1, name: "This link did not work" })).toBeVisible();
});
