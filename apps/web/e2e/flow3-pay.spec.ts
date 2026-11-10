// SPDX-License-Identifier: AGPL-3.0-only
// Flow 3 — Funder: pay. Payments center → a tranche whose readiness is all green → release →
// in flight → settled; a second tranche stays blocked by a pending destination change, with the
// banner that says what clears it.
import { expect, start, test } from "./helpers.ts";

test("pay a tranche", async ({ app: page }) => {
  await start(page, "/w/riverbend/payments/due");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await test.step("release a tranche whose readiness is all green", async () => {
    const alder = page.getByRole("region", { name: "Alder Creek Family Services" });
    await expect(alder.getByRole("status").first()).toContainText("7 of 7 checks pass");
    await expect(alder).toContainText("River City Credit Union •••• 4821");
    await alder.getByRole("button", { name: "Release" }).click();
    const d = page.getByRole("dialog", { name: "Release tranche 1" });
    const go = d.getByRole("button", { name: /^Release/ });
    await expect(go).toBeDisabled();
    await d.getByRole("checkbox").check();
    await go.click();
    await expect(d).toBeHidden();
  });

  await test.step("in flight, then settled when Passport reports it", async () => {
    await page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /In flight/ }).click();
    const flying = page.getByRole("table", { name: "Payments in flight" });
    const row = flying.getByRole("row").filter({ hasText: "Alder Creek Family Services" });
    await expect(row).toContainText("$75,000");
    await expect(row).toContainText("Initiated");

    // Only Passport settles a payment. In mock mode its webhook is delivered through the mock's control.
    await page.evaluate(async () => {
      type Mock = { listTranches(): Promise<Array<{ id: string; status: string; amountMinor: number }>>; simulatePassport(e: { type: string; trancheId: string }): Promise<void> };
      const mock = (window as unknown as { __gmsMock: Mock }).__gmsMock;
      const released = (await mock.listTranches()).find((t) => t.status === "initiated" && t.amountMinor === 7_500_000);
      if (!released) throw new Error("the released tranche is not in flight");
      await mock.simulatePassport({ type: "disbursement.settled", trancheId: released.id });
    });
    await page.getByRole("region", { name: "In flight" }).getByRole("button", { name: "Refresh" }).click();
    const settled = page.getByRole("table", { name: "Settled payments" }).getByRole("row").filter({ hasText: "Alder Creek Family Services" });
    await expect(settled).toContainText("Through Passport");
    await expect(settled).toContainText("Settled");
  });

  await test.step("a second tranche stays blocked by a pending destination change", async () => {
    const alerts = page.getByRole("region", { name: "Alerts" });
    await expect(alerts).toContainText("Harbor Light Shelter · destination change pending");
    await expect(alerts).toContainText("Clears automatically on Jun 3, 2027");
    await page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /^Due/ }).click();
    const harbor = page.getByRole("region", { name: "Harbor Light Shelter" });
    await expect(harbor).toContainText("Tranche 2 is held");
    await expect(harbor.getByRole("button", { name: "Release" })).toBeDisabled();
    await expect(harbor).toContainText("1 readiness check needs fixing");
    // Bank data never goes beyond the bank name and the last four digits.
    await expect(harbor).toContainText("Harbor Community Bank •••• 7730");
  });
});
