// SPDX-License-Identifier: AGPL-3.0-only
// Flow 30 — Share this call (E2), in mock mode. On the open call's Publish step the funder sees the
// call in the open-call feeds with its addresses, takes it out and puts it back; reads that the feed
// OpenGrants can pull is not imported yet; sees the date by which Philanthropy News Digest lists it
// free; previews the email to PND (PND's fields, filled from the call, replies to the funder) and
// sends it with one click; and the call cannot be sent twice.
import { expect, start, test } from "./helpers.ts";

const OPP = "opp_50000000-0000-7000-8000-000000000001";

test("funder shares an open call in the feeds and sends it to Philanthropy News Digest once", async ({ app: page }) => {
  await start(page, `/w/riverbend/opportunities/${OPP}/edit#publish`);
  const panel = page.getByRole("region", { name: "Share this call" });

  await test.step("the call is in the open-call feeds, with this funder's addresses", async () => {
    await expect(panel.getByText("In the open-call feeds", { exact: true })).toBeVisible();
    await expect(panel.getByText(/\/gms\/public\/feeds\/opportunities\.rss\?funder=riverbend$/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Copy the CSV file address" })).toBeVisible();
    await expect(panel.getByText("In the feed OpenGrants can pull")).toBeVisible();
    await expect(panel).toContainText("OpenGrants does not import calls from the GMS yet.");
  });

  await test.step("take it out of the feeds and put it back", async () => {
    const include = panel.getByRole("checkbox", { name: /Include this call in the open-call feeds/ });
    await include.uncheck();
    await expect(panel.getByText("Left out of the open-call feeds", { exact: true })).toBeVisible();
    await include.check();
    await expect(panel.getByText("In the open-call feeds", { exact: true })).toBeVisible();
  });

  await test.step("PND: the date the listing is free, then a preview of exactly PND's fields", async () => {
    await expect(panel.getByText(/^Send by .+ for a free listing$/)).toBeVisible();
    await expect(panel.getByRole("link", { name: /How PND takes requests for proposals/ })).toHaveAttribute("href", "https://philanthropynewsdigest.org/rfps");
    await panel.getByRole("button", { name: "Preview the email to PND" }).click();
    const preview = panel.getByRole("region", { name: "Email to Philanthropy News Digest" });
    await expect(preview).toContainText("pndrfp@candid.org");
    await expect(preview).toContainText("Community Health Grants 2027");
    for (const label of ["Program scope", "Grantee qualifications", "Application instructions", "Deadlines", "Full RFP", "Contact"]) await expect(preview).toContainText(label);
    await expect(preview).toContainText(/\/f\/riverbend\/o\/community-health-2027\?utm_source=pnd/);
    await expect(preview).toContainText("Nothing goes until you press Send to PND.");
  });

  await test.step("send on the person's click, once", async () => {
    await panel.getByRole("button", { name: "Send to PND" }).click();
    await expect(panel.getByText("Sent to Philanthropy News Digest", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Preview the email to PND" })).toHaveCount(0);
    await expect(panel.getByRole("region", { name: "Email to Philanthropy News Digest" })).toHaveCount(0);
  });
});
