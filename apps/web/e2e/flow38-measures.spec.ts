// SPDX-License-Identifier: AGPL-3.0-only
// Flow 38 — The growth measures for OpenGrants' operators (F3), in mock mode. The demo person is an
// operator: they see the nine measures over the last 30 days, each with its 90-day target and a
// status in words; record a deal lost by its reason; connect Google Search Console, choose the
// GMS's property and see clicks by kind of page, never a page's address. A funder admin who is not
// an operator signs in and sees no number at all.
import { expect, shown, start, test } from "./helpers.ts";

test("an operator reads the measures, records a lost deal and connects Search Console", async ({ app: page }) => {
  await start(page, "/operator/measures");
  await expect(page.getByRole("heading", { level: 1, name: "Growth measures" })).toBeVisible();
  const list = page.getByRole("list", { name: "The nine measures" });
  const card = (name: string) => list.getByRole("listitem", { name, exact: true });

  await test.step("nine measures, each with its 90-day target and a status in words", async () => {
    await expect(list.getByRole("listitem")).toHaveCount(9);
    await expect(card("Funders with an open call")).toContainText("90-day target: 50");
    await expect(card("Funders with an open call")).toContainText("Below target");
    await expect(card("New applicant workspaces per published call")).toContainText("On target");
    await expect(card("Awards shared with the share kit")).toContainText("36%");
    await expect(card("Organic visits to funder and call pages")).toContainText("Not known yet");
    await expect(card("Deals lost")).toContainText("Tracked");
  });

  await test.step("a lost deal is recorded by its reason, with no name and no note", async () => {
    const table = page.getByRole("table", { name: "Deals lost in the last 30 days, by reason" });
    await expect(table.getByRole("row", { name: /Moving their records over/ })).toContainText("1");
    await page.getByLabel("Why we lost it").selectOption({ label: "Moving their records over" });
    await page.getByRole("button", { name: "Record it" }).click();
    await expect(shown(page, "Recorded: Moving their records over")).toBeVisible();
    await expect(table.getByRole("row", { name: /Moving their records over/ })).toContainText("2");
    await expect(page.getByLabel(/note|name/i)).toHaveCount(0);
  });

  await test.step("Search Console: connect, choose the GMS's property, clicks by kind of page", async () => {
    const sc = page.getByRole("region", { name: "Google Search Console" });
    await expect(sc).toContainText("Not connected");
    await sc.getByRole("button", { name: "Connect Google Search Console" }).click();
    await expect(sc).toContainText("Connected");
    await sc.getByLabel("Property").selectOption("https://gms.opengrants.io/");
    await sc.getByRole("button", { name: "Use this property" }).click();
    await expect(sc).toContainText("Reading https://gms.opengrants.io/");
    const byKind = sc.getByRole("table", { name: "Clicks and impressions by kind of page" });
    await expect(byKind.getByRole("row", { name: /Call pages/ })).toContainText("212");
    await expect(byKind.getByRole("row", { name: /Funder pages/ })).toContainText("96");
    await expect(byKind).not.toContainText("/f/");
    await expect(card("Organic visits to funder and call pages")).toContainText("325");
    await expect(card("Organic visits to funder and call pages")).toContainText("90-day target: 3× the first week (75 a week)");
    await sc.getByRole("button", { name: "Disconnect Google Search Console" }).click();
    await expect(sc.getByRole("button", { name: "Connect Google Search Console" })).toBeVisible();
  });
});

test("someone who is not an operator sees no number", async ({ app: page }) => {
  // The demo person, a Riverbend funder admin, signed in with an address that is not an operator's
  // (the mock keeps its session in sessionStorage; this is that session with another address).
  await page.addInitScript(() => sessionStorage.setItem("gms.mock.session", JSON.stringify({ userId: "10000000-0000-4000-8000-000000000001", email: "pat.kim@northwind.example", aal: "aal2", accessToken: "mock.aal2" })));
  await start(page, "/operator/measures");
  await expect(page.getByRole("heading", { level: 1, name: "Growth measures" })).toBeVisible();
  await expect(shown(page, "Only OpenGrants' operators can see the growth measures")).toBeVisible();
  await expect(page.getByRole("list", { name: "The nine measures" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Google Search Console" })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});
