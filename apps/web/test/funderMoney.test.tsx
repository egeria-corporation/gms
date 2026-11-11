// SPDX-License-Identifier: AGPL-3.0-only
// The funder's money and compliance screens against the mock API: payments (readiness gating,
// release, hold banners), reporting, grantees, analytics and the integrations admin.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockLaunchStore } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import type { ApplicationEvent } from "../src/api/funder.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { MONEY_IDS, type MockMoneyControls } from "../src/mocks/funderMoney.ts";
import { flattenPatch } from "../src/screens/funder/Grantees.tsx";

async function riverbend(): Promise<Services> {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  // These screens are tested with payments through Passport switched on; launch.test.tsx covers off.
  mockLaunchStore(services)!.config.facilitatedPayments = true;
  return services;
}
const controls = (s: Services) => s.api as unknown as MockMoneyControls;
function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
}
const card = (heading: string) => screen.getByRole("heading", { name: heading }).closest("section")!;

describe("payments center · due", () => {
  it("enables release only when every readiness check passes", async () => {
    open("/w/riverbend/payments/due", await riverbend());
    const alder = within(await waitFor(() => card("Alder Creek Family Services")));
    expect(alder.getByText(/7 of 7 checks pass/)).toBeInTheDocument();
    expect(alder.getByText("To River City Credit Union •••• 4821")).toBeInTheDocument();
    expect(await alder.findByRole("button", { name: "Release" })).toBeEnabled();

    // A failing check blocks the release and says why.
    const copper = within(card("Copper Valley Clinic"));
    expect(copper.getByRole("button", { name: "Release" })).toBeDisabled();
    expect(copper.getByText("Copper Valley Clinic · level dropped to L1")).toBeInTheDocument();
    expect(copper.getByText("1 readiness check needs fixing")).toBeInTheDocument();
  });

  it("treats unknown as its own state: nothing can be released while Passport is unreachable", async () => {
    const services = await riverbend();
    await controls(services).simulatePassport({ type: "passport.unreachable", unreachable: true });
    open("/w/riverbend/payments/due", services);
    const alder = within(await waitFor(() => card("Alder Creek Family Services")));
    expect(await alder.findByRole("button", { name: "Release" })).toBeDisabled();
    expect(alder.getByText("Readiness is unknown until Passport can be reached")).toBeInTheDocument();
    expect(alder.getAllByRole("img", { name: "Unknown" }).length).toBeGreaterThan(0);
    expect(alder.queryByRole("img", { name: "Needs fixing" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Passport can’t be reached").length).toBeGreaterThan(0);
  });

  it("releases one tranche after a person confirms, then follows it in flight to settled", async () => {
    const services = await riverbend();
    const view = open("/w/riverbend/payments/due", services);
    const alder = within(await waitFor(() => card("Alder Creek Family Services")));
    await userEvent.click(await alder.findByRole("button", { name: "Release" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Release tranche 1" }));
    const go = dialog.getByRole("button", { name: "Release $75,000" });
    expect(go).toBeDisabled();
    await userEvent.click(dialog.getByRole("checkbox", { name: /I confirm the release of \$75,000/ }));
    await userEvent.click(go);
    expect(await screen.findByText(/Released \$75,000 to Alder Creek Family Services/)).toBeInTheDocument();
    expect((await services.api.listTranches({ view: "in-flight" })).map((t) => t.id)).toContain(MONEY_IDS.alderT1);
    view.unmount();

    // Passport reports the settlement (a webhook in production).
    await controls(services).simulatePassport({ type: "disbursement.settled", trancheId: MONEY_IDS.alderT1 });
    open("/w/riverbend/payments/in-flight", services);
    const settled = within(await waitFor(() => card("Settled")));
    expect(settled.getByRole("link", { name: "Alder Creek Family Services" })).toBeInTheDocument();
    expect((await services.api.getSchedule(MONEY_IDS.awardAlder)).disbursedAmountMinor).toBe(7_500_000);
  });

  it("blocks a tranche while a destination change is pending and clears when Passport says it changed", async () => {
    const services = await riverbend();
    const view = open("/w/riverbend/payments/due", services);
    const harbor = within(await waitFor(() => card("Harbor Light Shelter")));
    const banner = harbor.getByText("Harbor Light Shelter · destination change pending").closest("[data-cause]")!;
    expect(banner).toHaveAttribute("data-cause", "pending_destination_change");
    expect(within(banner as HTMLElement).getByText("Clears automatically on Jun 3, 2027.")).toBeInTheDocument();
    expect(await harbor.findByRole("button", { name: "Release" })).toBeDisabled();
    view.unmount();

    await controls(services).simulatePassport({ type: "payee.destination.changed", workspaceId: MONEY_IDS.wsHarbor });
    open("/w/riverbend/payments/due", services);
    const after = within(await waitFor(() => card("Harbor Light Shelter")));
    expect(after.queryByText("Harbor Light Shelter · destination change pending")).not.toBeInTheDocument();
    expect(await after.findByRole("button", { name: "Release" })).toBeEnabled();
  });

  it("says to connect Passport when the workspace has no link", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("cascade-county");
    open("/w/cascade-county/payments/due", services);
    expect(await screen.findByText("Connect Passport to pay")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Passport" })).toHaveAttribute("href", "/w/cascade-county/settings/passport");
  });
});

describe("payments center · in flight and alerts", () => {
  it("lists what is with Passport, the alerts and a bank transaction to match", async () => {
    const services = await riverbend();
    open("/w/riverbend/payments/in-flight", services);
    const flying = within(await waitFor(() => card("In flight")));
    expect(flying.getByRole("link", { name: "Lakeside Senior Center" })).toBeInTheDocument();
    const alerts = within(card("Alerts"));
    expect(alerts.getByText("Harbor Light Shelter · destination change pending")).toBeInTheDocument();
    expect(alerts.getByText(/Northgate Housing Trust · tranche 1 recorded as unverified/)).toBeInTheDocument();

    // Confirming a proposed match records the tranche as paid outside Passport.
    await userEvent.click(within(card("Bank transactions to match")).getByRole("button", { name: "Match" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Match this bank transaction" }));
    await userEvent.type(dialog.getByLabelText(/Destination, last four digits/), "3308");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm match" }));
    expect(await screen.findByText(/Matched\. The tranche is recorded as paid outside Passport/)).toBeInTheDocument();
    expect((await services.api.listTranches({ awardId: MONEY_IDS.awardCopper }))[0]).toMatchObject({ status: "settled", mode: "resolve" });
  });
});

describe("award payments tab", () => {
  it("shows the schedule, disbursed as read from Passport, and each tranche's readiness", async () => {
    open(`/w/riverbend/awards/${MONEY_IDS.awardAlder}/payments`, await riverbend());
    expect(await screen.findByRole("heading", { name: "Tranche 1 · $75,000" })).toBeInTheDocument();
    expect(screen.getByText(/Read from Passport/)).toBeInTheDocument();
    expect(screen.getByText("When interim report is accepted")).toBeInTheDocument();
    const t1 = within(card("Tranche 1 · $75,000"));
    await waitFor(() => expect(t1.getByRole("button", { name: "Release" })).toBeEnabled());
    // A scheduled tranche has no release control at all.
    expect(within(card("Tranche 2 · $60,000")).queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
  });

  it("records a payment made elsewhere and says when Passport could not verify it", async () => {
    const services = await riverbend();
    open(`/w/riverbend/awards/${MONEY_IDS.awardAlder}/payments`, services);
    const t1 = within(await waitFor(() => card("Tranche 1 · $75,000")));
    await userEvent.click(await t1.findByRole("button", { name: "Record external payment" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Record a payment made outside Passport" }));
    const save = dialog.getByRole("button", { name: "Record payment" });
    expect(save).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/Payment reference/), "Wire 0042");
    await userEvent.type(dialog.getByLabelText(/Date paid/), "2027-05-25");
    await userEvent.type(dialog.getByLabelText(/Destination, last four digits/), "0000");
    await userEvent.click(save);
    expect(await screen.findByText(/Recorded here as unverified/)).toBeInTheDocument();
    // An unverified payment is never added to the disbursed total.
    expect((await services.api.getSchedule(MONEY_IDS.awardAlder)).disbursedAmountMinor).toBe(0);
  });

  it("refuses a schedule that does not add up to the award", async () => {
    open(`/w/riverbend/awards/${MONEY_IDS.awardAlder}/payments`, await riverbend());
    await userEvent.click(await screen.findByRole("button", { name: "Edit schedule" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Edit the payment schedule" }));
    const first = dialog.getAllByLabelText(/Amount \(USD\)/)[0]!;
    await userEvent.clear(first);
    await userEvent.type(first, "1000");
    expect(dialog.getByText(/amounts must add up/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save schedule" })).toBeDisabled();
  });

  it("shows the approved budget against actuals", async () => {
    open(`/w/riverbend/awards/${MONEY_IDS.awardAlder}/payments`, await riverbend());
    await userEvent.click(await screen.findByRole("tab", { name: "Budget" }));
    const table = within(await screen.findByRole("table", { name: "Approved budget against actuals" }));
    expect(table.getByRole("row", { name: /Personnel \$96,000 \$41,500 \$54,500 43.2%/ })).toBeInTheDocument();
  });
});

describe("reporting", () => {
  it("accepting a report makes the tranche it releases due", async () => {
    const services = await riverbend();
    open(`/w/riverbend/reporting?tab=received&submission=${MONEY_IDS.subAlderInterim}`, services);
    expect(await screen.findByText(/412 families enrolled/)).toBeInTheDocument();
    expect(screen.getByText(/Accepting makes the next tranche due/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept report" }));
    expect(await screen.findByText(/Report accepted\. The tranche it releases is now due in Payments/)).toBeInTheDocument();
    const t2 = (await services.api.listTranches({ awardId: MONEY_IDS.awardAlder })).find((t) => t.id === MONEY_IDS.alderT2)!;
    expect(t2.status).toBe("due");
  });

  it("marks a report shared by the grantee as reference only", async () => {
    open(`/w/riverbend/reporting?tab=received&submission=${MONEY_IDS.subShared}`, await riverbend());
    expect(await screen.findByText("Shared for reference")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept report" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Shared by grantee").length).toBeGreaterThan(0);
  });

  it("lists what is owed, sends a reminder and edits the reminder plan", async () => {
    open("/w/riverbend/reporting", await riverbend());
    const table = within(await screen.findByRole("table", { name: "Requirements owed" }));
    const northgate = within(table.getByText("Northgate Housing Trust").closest("tr")!);
    expect(northgate.getByText("Overdue")).toBeInTheDocument();
    await userEvent.click(northgate.getByRole("button", { name: /Remind Northgate Housing Trust/ }));
    expect(await screen.findByText("Reminder sent to Northgate Housing Trust.")).toBeInTheDocument();
    await userEvent.click(northgate.getByRole("button", { name: /planned reminders for Interim report/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Reminder plan" }));
    const input = dialog.getByLabelText(/Days relative to the due date/);
    await userEvent.clear(input);
    await userEvent.type(input, "-7, 0, x");
    expect(dialog.getByRole("button", { name: "Save plan" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "-7, 0, 5");
    await userEvent.click(dialog.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByText("Reminder plan saved.")).toBeInTheDocument();
  });
});

describe("grantees", () => {
  it("shows the Passport record read-only and accepts a pending change", async () => {
    const services = await riverbend();
    open(`/w/riverbend/grantees/${MONEY_IDS.wsAlder}`, services);
    expect(await screen.findByRole("heading", { name: "Alder Creek Family Services" })).toBeInTheDocument();
    expect(screen.getByText(/River City Credit Union •••• 4821/)).toBeInTheDocument();
    const change = within(screen.getByText(/Change at Passport/).closest("[data-change]") as HTMLElement);
    expect(change.getByText("418 Mill Road, Suite 2")).toBeInTheDocument();
    await userEvent.click(change.getByRole("button", { name: "Accept change" }));
    expect(await screen.findByText(/Change accepted/)).toBeInTheDocument();
    expect(await services.api.listOrgChanges("pending")).toHaveLength(0);
  });

  it("explains when the organization has not consented to proposals", async () => {
    open(`/w/riverbend/grantees/${MONEY_IDS.wsNorthgate}`, await riverbend());
    expect(await screen.findByText("No consent to read this organization’s Passport record")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Propose a change" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Propose a change to Northgate Housing Trust" }));
    await userEvent.type(dialog.getByLabelText(/Proposed value/), "office@northgate.example");
    await userEvent.click(dialog.getByRole("button", { name: "Send proposal" }));
    expect(await dialog.findByText(/has not given this funder permission/)).toBeInTheDocument();
  });

  it("flattens a nested patch into field rows", () => {
    expect(flattenPatch({ addresses: { primary: { city: "Alder Creek" } }, mission: null })).toEqual([
      { path: "addresses.primary.city", value: "Alder Creek" },
      { path: "mission", value: "(removed)" },
    ]);
  });
});

describe("analytics", () => {
  it("shows committed against paid by program and gates the import on a dry run", async () => {
    open("/w/riverbend/analytics", await riverbend());
    expect(await screen.findByRole("heading", { name: "Committed vs paid by program" })).toBeInTheDocument();
    expect(screen.getByText(/Read from Passport/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Exports & import" }));
    expect(await screen.findByRole("table", { name: "990-PF grant list" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Or paste CSV text"), "Org,Grant,Amount\nAlder Creek Family Services,Van route,50000\nNew Org,Pilot,x");
    await userEvent.selectOptions(screen.getByLabelText(/Recipient name/), "Org");
    await userEvent.selectOptions(screen.getByLabelText(/Award title/), "Grant");
    await userEvent.selectOptions(screen.getByLabelText(/Awarded amount/), "Amount");
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Dry run" }));
    expect(await screen.findByText("Dry run: 1 of 2 rows would import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });
});

describe("settings · integrations and audit", () => {
  it("shows an API client's secret once", async () => {
    open("/w/riverbend/settings/mcp", await riverbend());
    await userEvent.type(await screen.findByLabelText(/New client name/), "Finance export");
    await userEvent.click(screen.getByRole("checkbox", { name: "awards:read" }));
    await userEvent.click(screen.getByRole("button", { name: "Create client" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Client secret for “Finance export”" }));
    const secret = (dialog.getByLabelText("Client secret") as HTMLInputElement).value;
    expect(secret).toMatch(/^mock-client-secret-/);
    await userEvent.click(dialog.getByRole("button", { name: "I have copied it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "API clients" })).getByText("Finance export")).toBeInTheDocument();
  });

  it("creates a webhook, lists connected agents and allows only read-only MCP tools", async () => {
    open("/w/riverbend/settings/mcp", await riverbend());
    expect(await screen.findByText("Riverbend Triage Agent")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), "https://hooks.example/gms");
    await userEvent.click(screen.getByRole("checkbox", { name: "tranche.due" }));
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Webhook signing secret" }));
    expect((dialog.getByLabelText("Signing secret") as HTMLInputElement).value).toMatch(/^mock-webhook-secret-/);
    await userEvent.click(dialog.getByRole("button", { name: "I have copied it" }));
    expect(await screen.findByText("https://hooks.example/gms")).toBeInTheDocument();

    await userEvent.click(within(card("Custom MCP servers")).getByRole("button", { name: "Tools" }));
    expect(await screen.findByRole("checkbox", { name: /lookup_organization/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /update_contact/ })).toBeDisabled();
    expect(await within(card("Integrations")).findByRole("button", { name: "Connect Google Workspace" })).toBeInTheDocument();
    expect(within(card("Audit ledger")).getByText("tranche.release")).toBeInTheDocument();
  });
});

describe("application detail", () => {
  it("shows what an applicant changed after a revision request", async () => {
    const services = await riverbend();
    const original = services.api.getApplication.bind(services.api);
    services.api.getApplication = async (id) => {
      const a = await original(id);
      const event = { id: "evt-rev", type: "application.submit", actor: "user:applicant", at: "2027-04-20T17:00:00Z", fromStatus: "revision_requested", toStatus: "submitted", fromStage: null, toStage: null, message: "Resubmitted after revision", revision: { requestedAt: "2027-04-12T17:00:00Z", message: "Please bring the budget under the cap.", changes: [{ formId: "frm_1", path: "/need", before: "Families travel far for care.", after: "Families travel 46 miles for care.", wordsBefore: 5, wordsAfter: 6, wordDelta: 1 }] } } as unknown as ApplicationEvent;
      return { ...a, timeline: [...(a.timeline ?? []), event] };
    };
    open(`/w/riverbend/applications/${MOCK_IDS.alder}`, services);
    await userEvent.click(await screen.findByRole("tab", { name: /Activity/ }));
    expect(await screen.findByText("Resubmitted after revision")).toBeInTheDocument();
    expect(screen.getAllByText(/46/).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Section assignments" })).toBeInTheDocument();
  });
});
