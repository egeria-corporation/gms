// SPDX-License-Identifier: AGPL-3.0-only
// Flow 3 — Funder: pay.
//
// As launched, payments through Passport are switched off: the payments center shows readiness as
// information and the funder records a payment it made elsewhere. With the switch on (second
// test): a tranche whose readiness is all green → release → in flight → settled; a second tranche
// stays blocked by a pending destination change, with the banner that says what clears it.
import { expect, rail, start, test } from "./helpers.ts";

test("record a payment made outside the GMS (payments through Passport off)", async ({ app: page }) => {
  await start(page, "/w/riverbend/payments/due");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Payments through Passport are not switched on yet")).toBeVisible();

  const alder = page.getByRole("region", { name: "Alder Creek Family Services" });
  await test.step("readiness is shown, release is not offered", async () => {
    await expect(alder.getByRole("status").first()).toContainText("7 of 7 checks pass");
    await expect(alder).toContainText("River City Credit Union •••• 4821");
    await expect(page.getByRole("button", { name: "Release" })).toHaveCount(0);
  });

  await test.step("record the payment the funder made itself", async () => {
    await alder.getByRole("button", { name: "Record a payment made outside the GMS" }).click();
    const d = page.getByRole("dialog", { name: "Record a payment made outside Passport" });
    const save = d.getByRole("button", { name: "Record payment" });
    await expect(save).toBeDisabled();
    await d.getByLabel(/Payment reference/).fill("Wire 0042");
    await d.getByLabel(/Date paid/).fill("2027-05-25");
    // Only the last four digits, which Passport checks against the verified destination.
    await d.getByLabel(/Destination, last four digits/).fill("4821");
    await save.click();
    await expect(d).toBeHidden();
  });

  await test.step("the payment is on record as made outside Passport", async () => {
    await page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /In flight/ }).click();
    const settled = page.getByRole("table", { name: "Settled payments" }).getByRole("row").filter({ hasText: "Alder Creek Family Services" });
    await expect(settled).toContainText("$75,000");
    await expect(settled).toContainText("Paid outside Passport");
  });

  await test.step("a held tranche still says why, and never offers release", async () => {
    await page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /^Due/ }).click();
    const harbor = page.getByRole("region", { name: "Harbor Light Shelter" });
    await expect(harbor).toContainText("Tranche 2 is held");
    await expect(harbor).toContainText("Harbor Community Bank •••• 7730");
    await expect(harbor.getByRole("button", { name: "Release" })).toHaveCount(0);
  });
});

test("pay a tranche (payments through Passport on)", async ({ app: page }) => {
  await start(page, "/w/riverbend");
  // Mock state lives in the page: switch payments on, then go to Payments by clicking.
  await page.evaluate(() => {
    (window as unknown as { __gmsLaunch: { config: { facilitatedPayments: boolean } } }).__gmsLaunch.config.facilitatedPayments = true;
  });
  await rail(page, "Payments").click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Payments through Passport are not switched on yet")).toHaveCount(0);

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
