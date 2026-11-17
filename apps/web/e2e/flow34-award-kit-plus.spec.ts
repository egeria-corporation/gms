// SPDX-License-Identifier: AGPL-3.0-only
// Flow 34 — The award kit, plus (v1.12.0), in mock mode against the fake Zernio.
// The funder connects LinkedIn → its Housing Stability call shows "Two weeks left": Post a reminder
// opens the composer on the reminder, which goes out only on the click on Post, and the prompt is
// dismissed → the funder lists its awards → on the award it marks federal funding (no statement
// with the amount alone; the statement once the percentage is in) → downloads the 1080 × 1350
// portrait card and the carousel PDF (8 slides, each with alt text) → the press release credits
// "funded by" → "Meet our grantees" introduces the program's public grantee and posts it → the
// grantee chooses "Don't list us publicly" and the funder has no one left to introduce.
import { readFileSync } from "node:fs";
import { dialog, expect, rail, start, switchWorkspace, test } from "./helpers.ts";

const STATEMENT = "This project is supported with federal funds as part of a financial assistance award totaling $80,000, with 62.5 percent of the project's total costs funded with federal money. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, the U.S. Government.";

test("funder posts a call's reminder, builds the award kit with the federal statement, and meets its grantees", async ({ app: page }) => {
  test.setTimeout(120_000);
  await start(page, "/w/riverbend/settings/social");

  await test.step("connect LinkedIn", async () => {
    await page.getByRole("button", { name: "Connect LinkedIn" }).click();
    await expect(page.getByRole("list", { name: "Connected accounts" })).toContainText("LinkedIn");
  });

  await test.step("Two weeks left: the reminder is posted only by the click on Post, then dismissed", async () => {
    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Housing Stability Grants 2027" }).first().click();
    await page.getByRole("link", { name: "Publish", exact: true }).first().click();
    const social = page.getByRole("region", { name: "Share on social media" });
    const reminder = social.getByRole("group", { name: "Two weeks left" });
    await expect(reminder).toContainText("Applications close May 27, 2027. Post a reminder?");
    await reminder.getByRole("button", { name: "Post a reminder" }).click();
    const composer = dialog(page, "Write a post");
    await expect(composer.getByRole("textbox", { name: "Post text" })).toHaveValue(/^Two weeks left to apply: Housing Stability Grants 2027, from Riverbend Community Foundation\. Apply by May 27, 2027\.\n\n.*\/f\/riverbend\/o\/housing-stability-2027\?utm_source=social$/);
    await composer.getByRole("button", { name: "Preview" }).click();
    const check = dialog(page, "Check the post");
    await expect(check.getByRole("region", { name: "Post text as it will appear" })).toContainText("Two weeks left to apply");
    await check.getByRole("button", { name: "Post", exact: true }).click();
    const done = dialog(page, "Posted");
    await done.getByRole("button", { name: "Close" }).click();
    await expect(social.getByRole("list", { name: "Posts" }).getByText("Published").first()).toBeVisible();
    await reminder.getByRole("button", { name: "Dismiss" }).click();
    await expect(social.getByRole("group", { name: "Two weeks left" })).toHaveCount(0);
  });

  await test.step("the funder lists its awards", async () => {
    await rail(page, "Settings").click();
    await page.getByRole("link", { name: "Public page" }).first().click();
    const card = page.getByRole("region", { name: "Grants awarded" });
    await card.getByRole("switch", { name: "List awards on my public page" }).click();
    await expect(card.getByRole("switch", { name: "List awards on my public page" })).toHaveAttribute("aria-checked", "true");
  });

  const share = page.getByRole("region", { name: "Share this award" });
  await test.step("federal funding: no statement until both numbers are entered", async () => {
    await rail(page, "Awards").click();
    const form = share.getByRole("form", { name: "Federal funding" });
    await form.getByRole("checkbox", { name: "This award is paid in whole or in part with federal money" }).check();
    await form.getByRole("textbox", { name: "Federal amount (USD)" }).fill("80000");
    await form.getByRole("button", { name: "Save federal funding" }).click();
    await expect(share.getByText("Enter both the federal amount and the percentage to add the statement to the share kit.")).toBeVisible();
    await expect(share.getByRole("textbox", { name: "Statement of the federal share" })).toHaveCount(0);
    await form.getByRole("spinbutton", { name: "Federal share of the project’s total costs (%)" }).fill("62.5");
    await form.getByRole("button", { name: "Save federal funding" }).click();
    await expect(share.getByRole("textbox", { name: "Statement of the federal share" })).toHaveValue(STATEMENT);
  });

  await test.step("the portrait card is 1080 × 1350, the carousel has 8 slides with alt text", async () => {
    await expect(share.getByRole("checkbox", { name: "Show the amount on the card" })).not.toBeChecked();
    const [portrait] = await Promise.all([page.waitForEvent("download"), share.getByRole("button", { name: "Download the portrait card" }).click()]);
    expect(portrait.suggestedFilename()).toMatch(/^alder-creek-family-services-[a-z0-9]{12}-portrait\.png$/);
    const png = readFileSync((await portrait.path())!);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);

    await expect(share.getByText(/^8 slides of 1080 × 1350/)).toBeVisible();
    const [carousel] = await Promise.all([page.waitForEvent("download"), share.getByRole("button", { name: "Download the carousel" }).click()]);
    expect(carousel.suggestedFilename()).toMatch(/-carousel\.pdf$/);
    const pdf = readFileSync((await carousel.path())!, "latin1");
    expect([...pdf.matchAll(/\/Type \/Page\b[\s\S]*?\/MediaBox \[ ?0 0 1080 1350 ?\]/g)]).toHaveLength(8);
    await share.getByText("Alt text for each slide").click();
    const alts = share.getByRole("list", { name: "Alt text for each slide" }).getByRole("listitem");
    await expect(alts).toHaveCount(8);
    await expect(alts.nth(5)).toHaveText(`Slide 6 of 8: The federal share of costs. ${STATEMENT}`);

    const press = share.getByRole("textbox", { name: "Press release" });
    await expect(press).toHaveValue(/^Riverbend Community Foundation awards a grant to Alder Creek Family Services\n\nFOR IMMEDIATE RELEASE\n\n/);
    await expect(press).toHaveValue(/The project is funded by Riverbend Community Foundation\./);
    expect(await press.inputValue()).not.toMatch(/sponsor/i);
  });

  await test.step("Meet our grantees introduces the program's public grantee, on the click on Post", async () => {
    const social = page.getByRole("region", { name: "Share on social media" });
    await social.getByRole("button", { name: "Meet our grantees" }).click();
    const composer = dialog(page, "Write a post");
    await expect(composer.getByRole("checkbox", { name: "Alder Creek Family Services" })).toBeChecked();
    await expect(composer.getByRole("textbox", { name: "Post text" })).toHaveValue(/^Meet the grantees of our Community Health 2027 program\.\n\nAlder Creek Family Services: Mobile Health Navigation for Rural Families\n\nSee every grant we have awarded: .*\/f\/riverbend\/awards\?utm_source=social$/);
    await composer.getByRole("button", { name: "Preview" }).click();
    await dialog(page, "Check the post").getByRole("button", { name: "Post", exact: true }).click();
    await dialog(page, "Posted").getByRole("button", { name: "Close" }).click();
  });

  await test.step("a grantee that chooses not to be listed is not introduced", async () => {
    await switchWorkspace(page, "Alder Creek Family Services");
    await rail(page, "Awarded funding").click();
    await page.getByRole("link", { name: "Mobile Health Navigation for Rural Families" }).first().click();
    await page.getByRole("link", { name: "Payments and schedule" }).click();
    await share.getByRole("switch", { name: "Don’t list us publicly" }).click();
    await expect(share.getByText("You chose not to be listed publicly.")).toBeVisible();
    await switchWorkspace(page, "Riverbend Community Foundation");
    await rail(page, "Awards").click();
    await expect(share.getByText("The grantee asked not to be listed publicly.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Meet our grantees" })).toHaveCount(0);
  });
});
