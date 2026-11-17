// SPDX-License-Identifier: AGPL-3.0-only
// Flow 22 — Award sharing (v1.9.0). The funder's award screen says the award is not public yet →
// the funder turns on "List awards on my public page" in Settings › Public page → its
// grants-awarded page lists the award, which has its own page → the grantee opens the grant, finds
// the share kit, edits nothing and copies the short post, which is what the clipboard then holds →
// the grantee chooses "Don't list us publicly" and the kit is gone.
// Mock mode serves the app without the front Worker: the share card and the badge image are checked
// in test/award-share-front.test.ts.
import { expect, rail, shown, start, switchWorkspace, test } from "./helpers.ts";

const AWARD = "awd_b0000000-0000-7000-8000-000000000001";

test("funder lists its awards and the grantee copies the share kit", async ({ app: page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page, `/w/riverbend/awards/${AWARD}/agreement`);
  const share = page.getByRole("region", { name: "Share this award" });

  await test.step("the award is not public until the funder lists awards", async () => {
    await expect(share.getByText("Not public")).toBeVisible();
    await expect(share.getByText(/Your public page does not list awards/)).toBeVisible();
    await expect(share.getByRole("textbox", { name: "LinkedIn post" })).toHaveCount(0);
    await share.getByRole("link", { name: "Open Settings › Public page" }).click();
  });

  await test.step("the funder turns on listing and opens its grants-awarded page", async () => {
    const card = page.getByRole("region", { name: "Grants awarded" });
    const toggle = card.getByRole("switch", { name: "List awards on my public page" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(card.getByText(/1 listed/)).toBeVisible();
    await card.getByRole("link", { name: "Open your grants-awarded page" }).click();
    await expect(page).toHaveURL(/\/f\/riverbend\/awards$/);
    await expect(page.getByRole("heading", { level: 1, name: "Grants awarded by Riverbend Community Foundation" })).toBeVisible();
    const table = page.getByRole("table", { name: "Grants awarded in 2027, Community Health 2027" });
    await expect(table.getByText("Alder Creek Family Services")).toBeVisible();
    await expect(table.getByText("$150,000")).toBeVisible();
  });

  await test.step("the award has its own page", async () => {
    await page.getByRole("link", { name: "View the grant to Alder Creek Family Services" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Riverbend Community Foundation awarded Alder Creek Family Services a grant" })).toBeVisible();
    await expect(shown(page, "Verified with OpenGrants Passport")).toBeVisible();
    await expect(shown(page, "Mobile Health Navigation for Rural Families").first()).toBeVisible();
  });

  await test.step("the grantee copies the short post from its share kit", async () => {
    // Back to Settings inside the app (history moves within the page; the mock state stays).
    await page.goBack();
    await page.goBack();
    await expect(page.getByRole("region", { name: "Grants awarded" })).toBeVisible();
    await switchWorkspace(page, "Alder Creek Family Services");
    await rail(page, "Awarded funding").click();
    // The award's link in Awarded funding's own table: the page left behind (the dashboard) has a link
    // with the same name, to the application, until the new page has drawn.
    await page.getByRole("table", { name: "Grants" }).getByRole("link", { name: "Mobile Health Navigation for Rural Families" }).first().click();
    await page.getByRole("link", { name: "Payments and schedule" }).click();
    const kit = page.getByRole("region", { name: "Share this award" });
    await expect(kit.getByText("Listed publicly")).toBeVisible();
    const short = kit.getByRole("textbox", { name: "Short post" });
    await expect(short).toHaveValue(/^Thank you, Riverbend Community Foundation, for a \$150,000 grant for “Mobile Health Navigation for Rural Families”\. http:\/\/localhost:\d+\/f\/riverbend\/awards\/alder-creek-family-services-[a-z0-9]{12}$/);
    await expect(kit.getByRole("textbox", { name: "LinkedIn post" })).toHaveValue(/^We are grateful to Riverbend Community Foundation/);
    await expect(kit.getByRole("img", { name: "Funded by Riverbend Community Foundation · verified" })).toBeVisible();
    await kit.getByRole("button", { name: "Copy the short post" }).click();
    await expect(kit.getByText("Copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await short.inputValue());
  });

  await test.step("the grantee opts out, and the kit is gone", async () => {
    const kit = page.getByRole("region", { name: "Share this award" });
    await kit.getByRole("switch", { name: "Don’t list us publicly" }).click();
    await expect(kit.getByText("You chose not to be listed publicly.")).toBeVisible();
    await expect(kit.getByRole("textbox", { name: "Short post" })).toHaveCount(0);
  });
});
