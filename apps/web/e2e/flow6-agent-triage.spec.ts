// SPDX-License-Identifier: AGPL-3.0-only
// Flow 6 — Agent: triage with a human gate. Settings → connect an agent → consent (workspace,
// scopes, gated actions) → agent-proposed declines carry their attribution → Approvals: read the
// letters and approve → Communications: the send log shows the letters.
import { expect, rail, start, test } from "./helpers.ts";

test("agent triage with a human gate", async ({ app: page }) => {
  await start(page, "/w/riverbend/settings/mcp");

  await test.step("settings: how an agent connects and what a person must approve", async () => {
    const connect = page.getByRole("region", { name: "Connect an agent" });
    await expect(connect.getByRole("textbox", { name: "Server URL" })).toHaveValue(/\/mcp$/);
    await expect(connect.getByRole("listitem")).toHaveCount(3);
    const gates = page.getByRole("region", { name: "Human gates" });
    await expect(gates.getByRole("switch", { name: "Decline an application requires approval (locked)" })).toBeChecked();
    await expect(gates.getByRole("switch", { name: "Release a payment requires approval (locked)" })).toBeDisabled();
    // A workspace can add a gate, never remove a locked one.
    await gates.getByRole("switch", { name: "Advance an application requires approval" }).click();
    await expect(gates.getByRole("switch", { name: "Advance an application requires approval" })).toBeChecked();
  });

  await test.step("the consent screen names the workspace, the scopes and the gated actions", async () => {
    await page.getByRole("region", { name: "Connect an agent" }).getByRole("link", { name: "Preview the consent screen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Claude wants to connect to OpenGrants GMS" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Riverbend Community Foundation/ })).toBeChecked();
    const scopes = page.getByRole("group", { name: "Scopes" });
    await scopes.getByText("Read scores and rankings").click(); // grant less than was asked for
    await expect(scopes).toContainText("3 of 4 selected");
    const gated = page.getByRole("list").filter({ hasText: "Decline an application" });
    await expect(gated).toContainText("Decline an application — waits for approval");
    await expect(gated).toContainText("Release a payment — always a person");

    // Approving returns to the agent's client. That address is outside the app, so the test answers
    // it and checks the authorization code came back.
    await page.route("https://claude.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>client</title>" }));
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForURL(/claude\.ai\/.*code=/);
  });

  // The agent now works in its own client. Back in the GMS (a fresh visit, so the mock starts from
  // its seeded state), its proposals are waiting for a person.
  await test.step("agent-proposed declines carry the agent's name and wait for approval", async () => {
    await start(page, "/w/riverbend/applications");
    await page.getByRole("tab", { name: /^Agent proposals/ }).click();
    const table = page.getByRole("table", { name: "Applications" });
    const pine = table.getByRole("row").filter({ hasText: "Pine Ridge Youth Alliance" });
    await expect(pine).toContainText("Riverbend Triage Agent proposed a decline · awaiting approval");
    await expect(pine).toContainText("Decline proposed");
    await pine.getByRole("link", { name: "Open", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
  });

  await test.step("a person approves the request", async () => {
    const request = page.getByRole("article", { name: /^Approval request: Decline 2 applications/ });
    await expect(request).toContainText("Riverbend Triage Agent");
    await expect(request).toContainText("decline_application · gated");
    await expect(request).toContainText("Will send 2 letters and set 2 statuses to Declined");
    await request.getByLabel("Note (optional)").fill("Both are outside the service area.");
    await request.getByRole("button", { name: "Approve" }).click();
    const resolved = page.getByRole("region", { name: "Resolved" });
    await expect(resolved.getByRole("listitem").first()).toContainText(/Approved and done/);
    await expect(resolved.getByRole("listitem").first()).toContainText("Both are outside the service area.");
  });

  await test.step("the letters are in the send log and the applications are declined", async () => {
    await rail(page, "Communications").click();
    const log = page.getByRole("region", { name: "Send log", exact: true });
    const sent = log.getByRole("table", { name: "Send log" }).getByRole("row").filter({ hasText: "Standard decline v3" });
    await expect(sent).toHaveCount(2);
    await expect(sent.filter({ hasText: "Pine Ridge Youth Alliance" })).toHaveCount(1);
    await expect(sent.filter({ hasText: "Meadowbrook Food Bank" })).toHaveCount(1);
    await rail(page, "Applications").click();
    const pine = page.getByRole("table", { name: "Applications" }).getByRole("row").filter({ hasText: "Pine Ridge Youth Alliance" });
    await expect(pine).toContainText("Declined");
    await expect(pine).not.toContainText("awaiting approval");
  });
});
