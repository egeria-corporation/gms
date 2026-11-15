// SPDX-License-Identifier: AGPL-3.0-only
// Flow 23 — Social posting through Zernio (v1.8.0), against the fake Zernio in mock mode. The
// funder's open call has no social account yet → Settings › Social accounts → Connect LinkedIn
// (Zernio sends the browser back; the account is recorded and the address cleaned) → back on the
// Publish step, Write a post: the text starts from the call with its deadline and shared link, and
// the length shows per platform → Preview shows exactly what will go out → Post → the post shows
// under Reach, Published, with its link on LinkedIn.
import { dialog, expect, rail, start, test } from "./helpers.ts";

const OPP = "opp_50000000-0000-7000-8000-000000000001";
const TEXT = "Applications are open for Community Health Grants 2027. Apply by April 30.";

test("funder connects an account, previews and posts an open call, and sees it in reach", async ({ app: page }) => {
  await start(page, `/w/riverbend/opportunities/${OPP}/edit#publish`);
  const panel = page.getByRole("region", { name: "Share on social media" });

  await test.step("no account yet: connect LinkedIn in Settings", async () => {
    await expect(panel.getByText("No social accounts connected yet")).toBeVisible();
    await panel.getByRole("link", { name: "Connect an account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Social accounts" })).toBeVisible();
    await page.getByRole("button", { name: "Connect LinkedIn" }).click();
    await expect(page.getByText("LinkedIn account connected")).toBeVisible();
    const accounts = page.getByRole("list", { name: "Connected accounts" });
    await expect(accounts).toContainText("LinkedIn");
    await expect(accounts).toContainText("riverbend-foundation");
    await expect(page).toHaveURL(/\/w\/riverbend\/settings\/social$/);
  });

  await test.step("compose from the call, with each platform's length", async () => {
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Community Health Grants 2027" }).first().click();
    await page.getByRole("link", { name: "Publish", exact: true }).first().click();
    await panel.getByRole("button", { name: "Write a post" }).click();
    const composer = dialog(page, "Write a post");
    const text = composer.getByRole("textbox", { name: "Post text" });
    await expect(text).toHaveValue(/^Applications are open: Community Health Grants 2027, from Riverbend Community Foundation\. Apply by April 30, 2027\./);
    await expect(text).toHaveValue(/\/f\/riverbend\/o\/community-health-2027\?utm_source=social$/);
    await expect(composer.getByRole("checkbox", { name: /LinkedIn/ })).toBeChecked();
    await text.fill(TEXT);
    await expect(composer.getByRole("group", { name: "Length on each platform" })).toContainText(`LinkedIn ${TEXT.length} / 3,000`);
    await composer.getByRole("button", { name: "Preview" }).click();
  });

  await test.step("the preview is exactly what goes out, and only Post sends it", async () => {
    const check = dialog(page, "Check the post");
    await expect(check.getByRole("region", { name: "Post text as it will appear" })).toHaveText(TEXT);
    await expect(check).toContainText("LinkedIn (riverbend-foundation)");
    await expect(check).toContainText("Now, when you press Post");
    await expect(check.getByRole("link", { name: "The share card" })).toHaveAttribute("href", /\/og\/f\/riverbend\/o\/community-health-2027\.png$/);
    await check.getByRole("button", { name: "Post", exact: true }).click();
    const done = dialog(page, "Posted");
    await expect(done.getByText("Sent to Zernio")).toBeVisible();
    await done.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the post shows under Reach with its link", async () => {
    const posts = panel.getByRole("list", { name: "Posts" });
    await expect(posts.getByText("Published").first()).toBeVisible();
    await expect(posts.getByRole("link", { name: "View on LinkedIn" })).toHaveAttribute("href", /^https:\/\/linkedin\.example\/posts\//);
    await expect(panel).toContainText("Applications from social");
  });
});
