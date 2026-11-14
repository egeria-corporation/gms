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
