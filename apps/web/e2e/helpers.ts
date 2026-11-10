// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test as base, type Locator, type Page } from "@playwright/test";

/**
 * The mock API keeps its state in the page, so a flow loads the app once and then moves only by
 * clicking. Every flow also fails on an uncaught page error or a console error.
 */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use, testInfo) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console error: ${m.text()}`);
    });
    await use(page);
    // Optional: keep a picture of where each flow ended (FLOW_SHOTS=<directory>).
    if (process.env.FLOW_SHOTS) await page.screenshot({ path: `${process.env.FLOW_SHOTS}/${testInfo.titlePath[0]?.replace(/\W+/g, "-") ?? "flow"}.png` }).catch(() => undefined);
    if (testInfo.status !== testInfo.expectedStatus) {
      // On failure, attach where the flow stopped so the break can be read from the report.
      const where = (await page.getByRole("dialog").count()) ? page.getByRole("dialog").first() : page.locator("main").first();
      const snapshot = await where.ariaSnapshot().catch(() => "(no main)");
      await testInfo.attach("stopped-at", { body: `${page.url()}\n${snapshot.slice(0, 6000)}`, contentType: "text/plain" });
    }
    expect(problems, "no console or page errors during the flow").toEqual([]);
  },
});
export { expect };

/** The first load of a flow. After this, navigate by clicking. */
export async function start(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("main").first()).toBeVisible();
}

/** Rail link in the workspace shell. */
export const rail = (page: Page, label: string): Locator => page.getByRole("navigation", { name: /workspace$/ }).getByRole("link", { name: label, exact: true });

/** Switches workspace through the top bar menu, without reloading the page. */
export async function switchWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: /(Funder|Applicant)$/ }).click();
  await page.getByRole("menu", { name: "Switch workspace" }).getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
}

export const dialog = (page: Page, name: string | RegExp): Locator => page.getByRole("dialog", { name });
