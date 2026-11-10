// SPDX-License-Identifier: AGPL-3.0-only
// The sections restored on the funder screens to match the design, against the mock API: recent
// activity, payments reconcile and ledger, the award's nine sections, the application's budget,
// documents and assistant, the approval request in full, panel scores and notes, and the rest.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { actorOf, describeEvent } from "../src/components/ActivityTimeline.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { MONEY_IDS } from "../src/mocks/funderMoney.ts";
import { IDS } from "../src/mocks/store.ts";
import { findBudgets, findDocuments } from "../src/screens/funder/ApplicationPanels.tsx";

async function riverbend(): Promise<Services> {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  return services;
}
function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
}
const card = (heading: string | RegExp) => screen.getByRole("heading", { name: heading }).closest("section")!;

describe("activity", () => {
  it("names who acted: a person, an agent for a person, Passport or a job", () => {
    const name = (id: string) => (id === "u1" ? "Dana Ortiz" : undefined);
    expect(actorOf("user:u1", name)).toEqual({ kind: "person", name: "Dana Ortiz" });
    expect(actorOf("user:u1/client:claude-mcp", name)).toEqual({ kind: "agent", name: "claude-mcp (for Dana Ortiz)" });
    expect(actorOf("passport", name)).toEqual({ kind: "passport", name: "Passport" });
    expect(actorOf("system:reminders", name)).toEqual({ kind: "system", name: "System · reminders" });
    expect(describeEvent("tranche.release")).toBe("released a payment");
    expect(describeEvent("grantee.updated")).toBe("updated · grantee");
  });

  it("shows recent activity on the dashboard from the ledger", async () => {
    open("/w/riverbend", await riverbend());
    const activity = within(await waitFor(() => card("Recent activity")));
    expect(await activity.findByText(/Passport put a payment on hold/)).toBeInTheDocument();
    expect(activity.getByText(/claude-mcp \(for .+\) proposed decisions/)).toBeInTheDocument();
  });
});

describe("payments center", () => {
  it("lists what falls due in the next 30 days and explains readiness beside the due list", async () => {
    open("/w/riverbend/payments/due", await riverbend());
    const next = within(await waitFor(() => card("Next 30 days")));
    expect(next.getByText("Total in window")).toBeInTheDocument();
    expect(next.getAllByRole("listitem").length).toBeGreaterThan(0);
    const explained = within(card("Readiness explained"));
    expect(explained.getByText(/Treated as blocking, never as pass/)).toBeInTheDocument();
  });

  it("reconciles bank transactions against tranches on its own tab", async () => {
    open("/w/riverbend/payments/reconcile", await riverbend());
    const table = within(await screen.findByRole("table", { name: "Mercury outbound transactions" }));
    const row = within(table.getByText("COPPER VALLEY CLINIC").closest("tr")!);
    expect(row.getByText(/Copper Valley Clinic · tranche 1/)).toBeInTheDocument();
    expect(row.getByText(/%/)).toBeInTheDocument();
    await userEvent.click(row.getByRole("button", { name: "Match" }));
    expect(await screen.findByRole("dialog", { name: "Match this bank transaction" })).toBeInTheDocument();
    expect(table.getByText("Matched")).toBeInTheDocument();
  });

  it("says so when the bank feed is not connected", async () => {
    const services = await riverbend();
    await services.api.disconnectConnector("mercury");
    open("/w/riverbend/payments/reconcile", services);
    expect(await screen.findByRole("heading", { name: "Bank feed not connected" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect Mercury/ })).toBeInTheDocument();
  });

  it("shows the payments ledger with who released or held each payment", async () => {
    open("/w/riverbend/payments/ledger", await riverbend());
    const ledger = within(await waitFor(() => card("Payments ledger")));
    expect(ledger.getByText(/released a payment/)).toBeInTheDocument();
    expect(ledger.getByText(/Passport put a payment on hold/)).toBeInTheDocument();
    expect(ledger.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });

  it("groups alerts by cause and says when a group is empty", async () => {
    open("/w/riverbend/payments/in-flight", await riverbend());
    const alerts = within(await waitFor(() => card("Alerts")));
    expect(alerts.getByRole("heading", { name: /Destination change pending · 1/ })).toBeInTheDocument();
    expect(alerts.getByRole("heading", { name: /Level downgrade · 1/ })).toBeInTheDocument();
    expect(alerts.getByText("No inactive grantees.")).toBeInTheDocument();
  });
});

describe("award detail", () => {
  it("offers all nine sections and moves between the two routes", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, await riverbend());
    const tabs = within(await screen.findByRole("tablist", { name: "Award sections" }));
    for (const name of ["Agreement", /^Payments/, /^Requirements/, "Budget", /^Amendments/, "Documents", "Messages / Notes", "Activity", "Closeout"]) expect(tabs.getByRole("tab", { name })).toBeInTheDocument();
    await userEvent.click(tabs.getByRole("tab", { name: "Budget" }));
    expect(await screen.findByRole("tab", { name: "Budget", selected: true })).toBeInTheDocument();
    expect(await screen.findByText(/Approved/)).toBeInTheDocument();
  });

  it("lists signature records and the documents the GMS produced", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, await riverbend());
    const signatures = within(await screen.findByRole("table", { name: "Signature records" }));
    expect(signatures.getByText(/Grantee · /)).toBeInTheDocument();
    expect(signatures.getByText(/Funder · Riverbend Community Foundation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Documents" }));
    const docs = within(await waitFor(() => card("Documents")));
    expect(docs.getByText("Award letter.pdf")).toBeInTheDocument();
    expect(docs.getAllByRole("button", { name: "Open" }).length).toBeGreaterThan(0);
  });

  it("explains what blocks closeout and keeps Complete disabled until it clears", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement?tab=closeout`, await riverbend());
    const closeout = within(await waitFor(() => card("Closeout")));
    const checklist = within(closeout.getByRole("list", { name: "Closeout checklist" }));
    expect(checklist.getByText("Every tranche settled")).toBeInTheDocument();
    const complete = closeout.queryByRole("button", { name: "Complete award" });
    if (complete) {
      expect(complete).toBeDisabled();
      expect(closeout.getByText(/unavailable until every line above is met/)).toBeInTheDocument();
    }
  });

  it("shows the award's activity from the ledger", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement?tab=activity`, await riverbend());
    expect(within(await waitFor(() => card("Activity"))).getByText("From the append-only ledger")).toBeInTheDocument();
  });
});

describe("application detail", () => {
  it("finds budget tables and file references in any form's answers", async () => {
    const app = await (await riverbend()).api.getApplication(MOCK_IDS.alder);
    const budgets = findBudgets(app);
    expect(budgets[0]?.rows.map((r) => r.category)).toEqual(["personnel", "travel", "supplies", "indirect"]);
    expect(findDocuments(app).map((d) => d.source)).toEqual(["passport", "upload"]);
  });

  it("shows the proposed budget and the attached documents on their own tabs", async () => {
    open(`/w/riverbend/applications/${MOCK_IDS.alder}`, await riverbend());
    await userEvent.click(await screen.findByRole("tab", { name: "Budget" }));
    const budget = within(await screen.findByRole("table", { name: /Budget/ }));
    expect(budget.getByText("Personnel")).toBeInTheDocument();
    expect(budget.getByText("Total")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(await screen.findByText("IRS determination letter.pdf")).toBeInTheDocument();
    expect(screen.getByText("Passport locker")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
  });

  it("drafts a summary with the assistant, marked as a draft and counted against the quota", async () => {
    open(`/w/riverbend/applications/${MOCK_IDS.alder}`, await riverbend());
    const assistant = within((await screen.findByText("Assistant")).closest("section")!);
    expect(assistant.getByText("Draft — review before use")).toBeInTheDocument();
    expect(assistant.getByText("14 of 40 this month")).toBeInTheDocument();
    await userEvent.click(assistant.getByRole("button", { name: "Summarize" }));
    expect(await assistant.findByRole("group", { name: "Summary draft" })).toBeInTheDocument();
    expect(assistant.getByText("15 of 40 this month")).toBeInTheDocument();
    expect(assistant.getByText(/Applicant-supplied · Need statement/)).toBeInTheDocument();
  });
});

describe("approvals", () => {
  it("shows the request in full: exact inputs, each application affected and the letter", async () => {
    open("/w/riverbend/approvals", await riverbend());
    const detail = within(await waitFor(() => card("Request detail")));
    expect(await detail.findByLabelText("Tool input as the agent sent it")).toHaveTextContent("decline_application");
    const affected = within(await detail.findByRole("table", { name: "Applications affected" }));
    expect(affected.getAllByRole("row")).toHaveLength(3);
    expect(affected.getAllByText(/Serves Riverbend County/).length).toBeGreaterThan(0);
    expect(await detail.findByText("Letter preview · 1 of 2")).toBeInTheDocument();
    await userEvent.click(detail.getByRole("button", { name: "Next letter" }));
    expect(await detail.findByText("Letter preview · 2 of 2")).toBeInTheDocument();
  });
});

describe("applications table", () => {
  it("shows the mean review score and days in stage, and the two extra saved views", async () => {
    open("/w/riverbend/applications", await riverbend());
    const table = within(await screen.findByRole("table", { name: "Applications" }));
    expect(table.getByRole("columnheader", { name: "Score" })).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: "Days in stage" })).toBeInTheDocument();
    const views = within(screen.getByRole("tablist", { name: "Saved views" }));
    expect(views.getByRole("tab", { name: /Review complete/ })).toBeInTheDocument();
    expect(views.getByRole("tab", { name: /Flagged/ })).toBeInTheDocument();
  });
});

describe("panel", () => {
  it("shows each reviewer's score per criterion, the decision summary and internal notes", async () => {
    open(`/w/riverbend/competitions/${IDS.compHealth27}/panel`, await riverbend());
    const summary = within(await waitFor(() => card("Decision summary")));
    expect(summary.getByText("No decision yet")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Discussion notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Letter preview" })).toBeInTheDocument();
    const notes = screen.getByRole("textbox", { name: "Add a discussion note" });
    await userEvent.type(notes, "Strong need; check the second-year budget.");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Strong need; check the second-year budget.")).toBeInTheDocument();
  });
});

describe("grantees", () => {
  it("adds level, total awarded, owner and tags to the directory, and the grantee's reports", async () => {
    open(`/w/riverbend/grantees/${MONEY_IDS.wsAlder}`, await riverbend());
    const directory = within(await screen.findByRole("table", { name: "Grantee directory" }));
    for (const name of ["Level", "Total awarded", "Owner", "Tags"]) expect(directory.getByRole("columnheader", { name })).toBeInTheDocument();
    expect(await waitFor(() => card("Reports"))).toBeInTheDocument();
  });
});

describe("communications", () => {
  it("sends one template to a group after showing the count, and logs each send", async () => {
    const services = await riverbend();
    open("/w/riverbend/communications", services);
    const bulk = within(await waitFor(() => card("Bulk send")));
    expect(bulk.getByLabelText("Recipients")).toHaveValue("application:submitted");
    const send = await bulk.findByRole("button", { name: /Send to [1-9]/ });
    const before = (await services.api.listCommunications()).length;
    await userEvent.click(send);
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: /^Send [1-9]/ }));
    expect(await bulk.findByText(/of \d+ sent/)).toBeInTheDocument();
    expect((await services.api.listCommunications()).length).toBeGreaterThan(before);
    expect(within(screen.getByRole("table", { name: "Templates" })).getByRole("columnheader", { name: "Last used" })).toBeInTheDocument();
    expect(within(await screen.findByRole("table", { name: "Send log" })).getByRole("columnheader", { name: "Channel" })).toBeInTheDocument();
  });
});

describe("programs and competition", () => {
  it("shows committed, paid and remaining per program and committed awards by status", async () => {
    const services = await riverbend();
    const program = (await services.api.listPrograms())[0]!;
    open(`/w/riverbend/programs/${program.id}`, services);
    const table = within(await screen.findByRole("table", { name: "Programs" }));
    for (const name of ["Committed", "Paid", "Remaining"]) expect(table.getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Committed by status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Outcomes rollup" })).toBeInTheDocument();
  });

  it("lists the stages with dates, form, rubric and entry rule, and the reviewer pool", async () => {
    open(`/w/riverbend/competitions/${IDS.compHealth27}`, await riverbend());
    const stages = within(await screen.findByRole("table", { name: "Stages" }));
    for (const name of ["Stage", "Opens", "Closes", "Form", "Rubric", "Entry rule"]) expect(stages.getByRole("columnheader", { name })).toBeInTheDocument();
    const pool = within(await waitFor(() => card("Reviewer pool")));
    expect(pool.getByText("Entry rules")).toBeInTheDocument();
    expect(pool.getByRole("link", { name: "Assign" })).toBeInTheDocument();
  });
});

describe("analytics", () => {
  it("charts awards by region and reviewer load, and withholds small groups in the equity lens", async () => {
    open("/w/riverbend/analytics", await riverbend());
    expect(await screen.findByRole("heading", { name: "Awards by region" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reviewer load" })).toBeInTheDocument();
    const equity = within(card("Equity lens"));
    expect(equity.getByRole("radio", { name: /Applicants · \d+/ })).toBeInTheDocument();
    await userEvent.click(equity.getByRole("radio", { name: /Awards · \d+/ }));
    await waitFor(() => expect(equity.getByRole("radio", { name: /Awards · \d+/ })).toBeChecked());
  });
});
