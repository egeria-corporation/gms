// SPDX-License-Identifier: AGPL-3.0-only
// Funders can open applications (v1.4.0): the builder's ticks, the Applications step with quick
// setup, and honest status on the funder screens and the public opportunity page.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.hash}</output>;
}
const where = () => screen.getByTestId("where").textContent;

function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return services;
}

/** Whether the builder's step list shows the step as complete. */
function ticked(title: string): boolean {
  const nav = screen.getByRole("navigation", { name: "Builder steps" });
  const item = within(nav).getByRole("link", { name: title }).closest("li")!;
  return within(item).queryByRole("img", { name: "Complete" }) !== null;
}

describe("opportunity builder ticks", () => {
  it("ticks a step only after the funder has visited it, even when its default is valid", async () => {
    open("/w/riverbend/opportunities/new");
    await userEvent.type(await screen.findByLabelText(/^Title/), "Senior Nutrition 2028");
    await userEvent.type(screen.getByLabelText("Summary"), "Meals and nutrition education for older adults.");
    // "Who can apply" already holds the 501(c)(3) default, but nobody has looked at it.
    expect(ticked("Who can apply")).toBe(false);
    expect(ticked("Basics")).toBe(false);

    await userEvent.click(screen.getByRole("link", { name: "Who can apply" }));
    expect(await screen.findByRole("button", { name: /501\(c\)\(3\)/, pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Basics" }));
    await waitFor(() => expect(ticked("Who can apply")).toBe(true));
    expect(ticked("Basics")).toBe(false); // the current step shows its number

    // Saving gives the opportunity its own address; the steps visited so far stay the only ticks.
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    await waitFor(() => expect(where()).toMatch(/\/opportunities\/opp_[0-9a-f-]+\/edit(#basics)?$/));
    await waitFor(() => expect(ticked("Who can apply")).toBe(true));
    expect(ticked("Dates")).toBe(false);
    expect(ticked("Funding")).toBe(false);
  });

  it("counts every step of an already-saved opportunity as visited", async () => {
    open("/w/riverbend/opportunities/community-health-2027/edit#publish");
    await screen.findByRole("heading", { name: "Publish" });
    expect(ticked("Basics")).toBe(true);
    expect(ticked("Funding")).toBe(true);
    expect(ticked("Dates")).toBe(true);
    expect(ticked("Who can apply")).toBe(true);
  });
});

describe("Applications step", () => {
  it("shows the honest status, runs quick setup, and opens through the checklist", async () => {
    const services = open("/w/riverbend/opportunities/housing-stability-2027/edit#applications");
    expect(await screen.findByRole("heading", { name: "Applications" })).toBeInTheDocument();
    const header = screen.getByRole("main");
    expect(await within(header).findAllByText("Published, not taking applications")).not.toHaveLength(0);
    expect(ticked("Applications")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Quick setup" }));
    expect(await screen.findByText("Quick setup is done")).toBeInTheDocument();
    expect(screen.getByText(/It made a one-stage competition, the application form and the rubric/)).toBeInTheDocument();
    expect(await screen.findByText(/7 of 7 checks pass/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit the application form" })).toHaveAttribute("href", expect.stringMatching(/^\/w\/riverbend\/forms\/frm_[0-9a-f-]+\/edit$/));

    // Running it again reuses what it made.
    await userEvent.click(screen.getByRole("button", { name: "Quick setup" }));
    expect(await screen.findByText("Already set up")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open for applications" }));
    expect(await screen.findByText("Taking applications")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Basics" }));
    await waitFor(() => expect(ticked("Applications")).toBe(true));
    expect(within(screen.getByRole("main")).queryByText("Published, not taking applications")).not.toBeInTheDocument();
    const comps = await services.api.listCompetitions({ opportunityId: "opp_50000000-0000-7000-8000-000000000002" });
    expect(comps.map((c) => c.status)).toEqual(["open"]);
  });

  it("keeps Open for applications disabled while a checklist item fails, with a link to fix it", async () => {
    open("/w/riverbend/opportunities/rapid-response-fund/edit#applications");
    await userEvent.click(await screen.findByRole("button", { name: "Quick setup" }));
    expect(await screen.findByText(/6 of 7 checks pass/)).toBeInTheDocument();
    const row = screen.getByText("Stage dates are set").closest("li")!;
    expect(within(row).getByRole("img", { name: "Needs fixing" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Fix/ })).toHaveAttribute("href", expect.stringMatching(/^\/w\/riverbend\/competitions\/cmp_/));
    expect(screen.getByRole("button", { name: "Open for applications" })).toBeDisabled();
  });

  it("asks for a saved opportunity first", async () => {
    open("/w/riverbend/opportunities/new#applications");
    expect(await screen.findByText("Save the opportunity first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick setup" })).not.toBeInTheDocument();
  });
});

describe("honest status on the funder screens", () => {
  it("labels a published opportunity with no open competition in the Opportunities list", async () => {
    open("/w/riverbend/opportunities");
    const table = await screen.findByRole("table", { name: "Opportunities" });
    const row = (name: string) => within(table).getByRole("link", { name }).closest("tr")!;
    await waitFor(() => expect(within(row("Housing Stability Grants 2027")).getByText("Published, not taking applications")).toBeInTheDocument());
    expect(within(row("Housing Stability Grants 2027")).getByRole("link", { name: "Set up applications for Housing Stability Grants 2027" })).toHaveAttribute("href", "/w/riverbend/opportunities/opp_50000000-0000-7000-8000-000000000002/edit#applications");
    expect(within(row("Community Health Grants 2027")).getByText("Open")).toBeInTheDocument();
    expect(within(row("Youth Opportunity 2028")).getByText("Forecasted")).toBeInTheDocument();
  });

  it("puts a task on the Dashboard that leads to the Applications step", async () => {
    open("/w/riverbend");
    const task = await screen.findByRole("link", { name: "Open applications for Housing Stability Grants 2027" });
    expect(task).toHaveAttribute("href", "/w/riverbend/opportunities/opp_50000000-0000-7000-8000-000000000002/edit#applications");
    expect(screen.queryByRole("link", { name: "Open applications for Community Health Grants 2027" })).not.toBeInTheDocument();
  });
});

describe("public opportunity page", () => {
  it("shows Apply only while a competition is open", async () => {
    open("/f/riverbend/o/community-health-2027", createMockServices({ session: null }));
    expect(await screen.findByRole("link", { name: /^Apply$/ })).toBeInTheDocument();
    expect(screen.queryByText("Not taking applications yet")).not.toBeInTheDocument();
  });

  it("says it is not taking applications yet when nothing is open, without a Save for a signed-out visitor", async () => {
    open("/f/riverbend/o/housing-stability-2027", createMockServices({ session: null }));
    expect(await screen.findByText("Not taking applications yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Apply$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("offers Save to a signed-in applicant, and remembers it", async () => {
    open("/f/riverbend/o/housing-stability-2027");
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("shows Apply once quick setup's competition is opened", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    const out = await services.api.quickSetup("opp_50000000-0000-7000-8000-000000000002");
    await services.api.openCompetition(out.competition.id);
    open("/f/riverbend/o/housing-stability-2027", services);
    expect(await screen.findByRole("link", { name: /^Apply$/ })).toHaveAttribute("href", "/apply/riverbend/housing-stability-2027");
    expect(screen.queryByText("Not taking applications yet")).not.toBeInTheDocument();
    expect(await screen.findByText(/Housing Stability Grants 2027 application/)).toBeInTheDocument();
  });

  it("does not offer Apply on a forecasted opportunity even with an open competition", async () => {
    const services = createMockServices({ session: null });
    const data = await services.api.publicOpportunity("riverbend", "community-health-2027");
    const { takingApplications } = await import("../src/screens/public/OpportunityPage.tsx");
    expect(takingApplications(data)).toBe(true);
    expect(takingApplications({ ...data, opportunity: { ...data.opportunity, status: "forecasted" } })).toBe(false);
    expect(takingApplications({ ...data, competitions: data.competitions.map((c) => ({ ...c, status: "closed" as const })) })).toBe(false);
  });
});
