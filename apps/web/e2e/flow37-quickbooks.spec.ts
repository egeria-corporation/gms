// SPDX-License-Identifier: AGPL-3.0-only
// Flow 37 — QuickBooks sync (v1.13.0), in mock mode (no Composio and no QuickBooks). Record-keeping
// only. A funder admin opens Settings › Accounting, connects QuickBooks, sets once where grant
// payments go (the expense account, the bank account in QuickBooks' chart of accounts, a class per
// program) and turns the sync on. Payments settled before that are not sent. The funder then records
// a payment made outside the GMS in the Payments center: it shows "In QuickBooks", and the
// reconciliation view lists it next to its QuickBooks entry, which matches when compared.
import { dialog, expect, rail, shown, start, test } from "./helpers.ts";

test("send recorded payments to QuickBooks, once each, and see them next to their entries", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/passport");
  const nav = page.getByRole("navigation", { name: "Settings sections" });

  await test.step("connect QuickBooks in Settings › Accounting", async () => {
    await nav.getByRole("link", { name: "Accounting" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Accounting" })).toBeVisible();
    await expect(shown(page, "Record-keeping only")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("This never pays, schedules or moves money, and no bank details leave the GMS.");
    const qb = page.getByRole("region", { name: "QuickBooks Online" });
    await expect(qb.getByText("Not connected")).toBeVisible();
    await qb.getByRole("button", { name: "Connect QuickBooks" }).click();
    await expect(qb.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("set where grant payments go, and turn the sync on", async () => {
    const map = page.getByRole("region", { name: "Where grant payments go" });
    const save = map.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await map.getByRole("combobox", { name: /^Expense account/ }).selectOption({ label: "Grants and assistance" });
    await map.getByRole("combobox", { name: /^Paid from/ }).selectOption({ label: "Operating checking •••4410" });
    await map.getByRole("radio", { name: "Class" }).check();
    await map.getByRole("combobox", { name: /^For / }).first().selectOption({ label: "Community health" });
    await expect(map.getByRole("radio", { name: "Create a vendor with the organization's name only" })).toBeChecked();
    await map.getByRole("checkbox", { name: "Send recorded payments to QuickBooks" }).check();
    await save.click();
    await expect(shown(page, "Saved. Payments recorded from now on go to QuickBooks.")).toBeVisible();
  });

  await test.step("payments settled before the sync was on are not sent", async () => {
    const entries = page.getByRole("table", { name: "Payments and QuickBooks entries" });
    await expect(entries.getByRole("row").filter({ hasText: "Harbor Light Shelter" }).first()).toContainText("Not sent");
    await expect(entries.locator("tbody")).not.toContainText("In QuickBooks");
  });

  await test.step("record a payment made outside the GMS", async () => {
    await rail(page, "Payments").click();
    const alder = page.getByRole("region", { name: "Alder Creek Family Services" });
    await alder.getByRole("button", { name: "Record a payment made outside the GMS" }).click();
    const d = dialog(page, "Record a payment made outside Passport");
    await d.getByLabel(/Payment reference/).fill("Wire 0042");
    await d.getByLabel(/Date paid/).fill("2027-05-25");
    await d.getByLabel(/Destination, last four digits/).fill("4821");
    await d.getByRole("button", { name: "Record payment" }).click();
    await expect(d).toBeHidden();
  });

  await test.step("the payment shows In QuickBooks; the earlier ones do not", async () => {
    await page.getByRole("navigation", { name: "Payments views" }).getByRole("link", { name: /In flight/ }).click();
    const settled = page.getByRole("table", { name: "Settled payments" });
    await expect(settled.getByRole("row").filter({ hasText: "Alder Creek Family Services" })).toContainText("In QuickBooks");
    await expect(settled.getByRole("row").filter({ hasText: "Harbor Light Shelter" })).not.toContainText("QuickBooks");
  });

  await test.step("the reconciliation view lists it next to its QuickBooks entry, and it matches", async () => {
    await rail(page, "Settings").click();
    await nav.getByRole("link", { name: "Accounting" }).click();
    const entries = page.getByRole("table", { name: "Payments and QuickBooks entries" });
    const alder = entries.getByRole("row").filter({ hasText: "Alder Creek Family Services" });
    await expect(alder).toContainText("In QuickBooks");
    await expect(alder).toContainText(/Ref\. no\. GMS-/);
    await expect(alder).toContainText("$75,000");
    await page.getByRole("button", { name: "Compare with QuickBooks" }).click();
    await expect(alder).toContainText("Matches QuickBooks");
    // The grantee was matched to the QuickBooks vendor of the same name, and that vendor is kept for it.
    const vendor = page.getByRole("region", { name: "Grantees and vendors" }).getByRole("combobox", { name: "Alder Creek Family Services" });
    await expect(vendor.locator("option:checked")).toHaveText("Alder Creek Family Services");
  });
});
