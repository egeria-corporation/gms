// SPDX-License-Identifier: AGPL-3.0-only
// Flow 13 — Apply from anywhere (v1.7). The funder copies the apply widget's embed code from the
// Publish step (live preview, resize script) → pastes it on its own site → visitors see the call
// and Apply, which opens the public opportunity page in a new tab; a call that is not taking
// applications says so instead → the funder turns "Powered by" off in Settings → Public page, and
// the preview and the public page drop it.
// Mock mode serves the app without the production `_headers`; the framing policy itself is
// checked in test/embed-headers.test.ts.
import { expect, rail, start, test } from "./helpers.ts";

const OPP = "opp_50000000-0000-7000-8000-000000000001";
const POWERED = "Powered by OpenGrants Grant Management System";

test("funder embeds the apply widget on its own site", async ({ app: page }) => {
  await start(page, `/w/riverbend/opportunities/${OPP}/edit#publish`);
  const panel = page.getByRole("region", { name: "Embed on your website" });
  let snippet = "";

  await test.step("the Publish step gives the embed code and a live preview", async () => {
    const preview = panel.getByRole("region", { name: "Widget preview" });
    await expect(preview.getByRole("link", { name: "Apply to Community Health Grants 2027 (opens in a new tab)" })).toBeVisible();
    await expect(preview.getByRole("link", { name: POWERED })).toBeVisible();
    await panel.getByRole("checkbox", { name: /Resize to fit/ }).check();
    snippet = await panel.getByRole("textbox", { name: "Embed code" }).inputValue();
    expect(snippet).toMatch(/^<iframe [^>]*src="http:\/\/localhost:\d+\/embed\/f\/riverbend\/o\/community-health-2027"/);
    expect(snippet).toContain("<script>");
    await expect(panel.getByRole("button", { name: "Copy embed code" })).toBeVisible();
  });

  await test.step("on the funder's own site, the widget offers Apply in a new tab", async () => {
    // The funder's site, on another origin (127.0.0.1, not localhost). Here the app runs on
    // localhost, which the browser lets another site frame only with local network access.
    const SITE = `http://127.0.0.1:${new URL(page.url()).port}/riverbend-cf/grants`;
    await page.context().grantPermissions(["local-network-access"], { origin: new URL(SITE).origin });
    const host = await page.context().newPage();
    const problems: string[] = [];
    host.on("pageerror", (e) => problems.push(e.message));
    // A second widget, for a call that is open but not taking applications yet.
    const housing = snippet.replaceAll("community-health-2027", "housing-stability-2027");
    await host.route(SITE, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Riverbend Community Foundation</title></head><body><h1>Our grants</h1>${snippet}<hr>${housing}</body></html>` }));
    await host.goto(SITE);

    const iframe = host.locator('iframe[src$="/community-health-2027"]');
    const widget = host.frameLocator('iframe[src$="/community-health-2027"]');
    await expect(widget.getByRole("heading", { name: "Community Health Grants 2027" })).toBeVisible();
    await expect(widget.getByText("Taking applications")).toBeVisible();
    await expect(widget.getByText("Riverbend Community Foundation")).toBeVisible();
    await expect(widget.getByRole("link", { name: POWERED })).toBeVisible();
    // The resize script fitted the frame to the card (the snippet's fixed height is 320px).
    await expect.poll(() => iframe.evaluate((f: HTMLIFrameElement) => f.style.height)).toMatch(/^\d+px$/);

    const opened = host.context().waitForEvent("page");
    await widget.getByRole("link", { name: "Apply to Community Health Grants 2027 (opens in a new tab)" }).click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe("/f/riverbend/o/community-health-2027");
    await expect(tab.getByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeVisible();
    await tab.close();

    const notYet = host.frameLocator('iframe[src$="/housing-stability-2027"]');
    await expect(notYet.getByText("Not taking applications yet")).toBeVisible();
    await expect(notYet.getByRole("link", { name: /^Apply/ })).toHaveCount(0);
    await expect(notYet.getByRole("link", { name: /^View details of Housing Stability Grants 2027/ })).toBeVisible();
    expect(problems).toEqual([]);
    await host.close();
  });

  await test.step("the funder turns Powered by off; the preview and the public page drop it", async () => {
    await rail(page, "Settings").click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Public page" }).click();
    const toggle = page.getByRole("switch", { name: `Show “${POWERED}”` });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await rail(page, "Opportunities").click();
    await page.getByRole("link", { name: "Community Health Grants 2027" }).first().click();
    await page.getByRole("link", { name: "Publish", exact: true }).first().click();
    const preview = panel.getByRole("region", { name: "Widget preview" });
    await expect(preview.getByRole("link", { name: /^Apply to Community Health Grants 2027/ })).toBeVisible();
    await expect(preview.getByText(POWERED)).toHaveCount(0);

    await page.getByRole("link", { name: "Open public page" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByText(POWERED)).toHaveCount(0);
  });
});
