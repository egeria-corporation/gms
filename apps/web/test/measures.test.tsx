// SPDX-License-Identifier: AGPL-3.0-only
// F3 in mock mode: the operators' growth measures. An operator sees the nine measures with their
// targets, each status as an icon and a label; records a lost deal by reason; connects Search
// Console, chooses the GMS's property and sees clicks by kind of page. Anyone else sees no number.
// No serious accessibility problem on either screen.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockMeasuresStore } from "../src/api/measuresHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

function open(path: string, services = createMockServices({ session: demoSession() })) {
  const store = mockMeasuresStore(services);
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...utils, services, store };
}

async function seriousViolations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}
const settled = () => waitFor(() => expect(document.querySelector(".loading, [aria-busy=true]")).toBeNull());

describe("the growth measures", () => {
  it("shows an operator the nine measures, each with its target and a status in words", async () => {
    open("/operator/measures");
    expect(await screen.findByRole("heading", { level: 1, name: "Growth measures" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "The nine measures" }, { timeout: 5000 });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(9);
    const card = (name: string) => within(list).getByRole("listitem", { name });
    expect(card("Funders with an open call")).toHaveTextContent("14");
    expect(card("Funders with an open call")).toHaveTextContent("90-day target: 50");
    expect(card("Funders with an open call")).toHaveTextContent("Below target");
    expect(card("New applicant workspaces per published call")).toHaveTextContent("11.8");
    expect(card("New applicant workspaces per published call")).toHaveTextContent("On target");
    expect(card("New applicant workspaces per published call")).toHaveTextContent("47 new applicant workspaces for 4 calls published");
    expect(card("Awards shared with the share kit")).toHaveTextContent("36%");
    expect(card("Invited teammates who join")).toHaveTextContent("90-day target: 40%");
    expect(card("Organic visits to funder and call pages")).toHaveTextContent("Connect Google Search Console below to see this.");
    expect(card("Organic visits to funder and call pages")).toHaveTextContent("Not known yet");
    expect(card("Funders who imported their history and opened a call within 14 days")).toBeInTheDocument();
    expect(card("Deals lost")).toHaveTextContent("Tracked");
    // A status is never color alone: every pill carries its words and an icon.
    for (const pill of document.querySelectorAll(".stat .bdg")) {
      expect(pill.textContent?.trim()).not.toBe("");
      expect(pill.querySelector("svg")).not.toBeNull();
    }
    await settled();
    expect(await seriousViolations()).toEqual([]);
  });

  it("records a lost deal by its reason only, and counts it", async () => {
    const user = userEvent.setup();
    const { store } = open("/operator/measures");
    const table = await screen.findByRole("table", { name: "Deals lost in the last 30 days, by reason" }, { timeout: 5000 });
    expect(within(table).getByRole("row", { name: /Reviews: conflict of interest/ })).toHaveTextContent("2");
    await user.selectOptions(screen.getByLabelText("Why we lost it"), "Procurement: single sign-on, accessibility report or security review");
    await user.click(screen.getByRole("button", { name: "Record it" }));
    expect(await screen.findByText("Recorded: Procurement: single sign-on, accessibility report or security review")).toBeInTheDocument();
    expect(store.lostDeals.filter((d) => d.reason === "procurement")).toHaveLength(2);
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Deals lost in the last 30 days, by reason" })).getByRole("row", { name: /Procurement/ })).toHaveTextContent("2"));
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
  });

  it("connects Search Console, takes the GMS's property and shows clicks by kind of page, never an address", async () => {
    const user = userEvent.setup();
    open("/operator/measures");
    await user.click(await screen.findByRole("button", { name: "Connect Google Search Console" }, { timeout: 5000 }));
    await user.click(await screen.findByRole("button", { name: "Use this property" }));
    const table = await screen.findByRole("table", { name: "Clicks and impressions by kind of page" });
    expect(within(table).getByRole("row", { name: /Call pages/ })).toHaveTextContent("212");
    expect(table.textContent).not.toMatch(/https?:|\/f\//);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "The nine measures" })).getByRole("listitem", { name: "Organic visits to funder and call pages" })).toHaveTextContent("325"));
    expect(screen.getByRole("listitem", { name: "Organic visits to funder and call pages" })).toHaveTextContent("90-day target: 3× the first week (75 a week)");
    await settled();
    expect(await seriousViolations()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Disconnect Google Search Console" }));
    expect(await screen.findByRole("button", { name: "Connect Google Search Console" })).toBeInTheDocument();
  });

  it("hides Search Console until the server has it set up", async () => {
    const services = createMockServices({ session: demoSession() });
    mockMeasuresStore(services).searchConsole.available = false;
    open("/operator/measures", services);
    await screen.findByRole("list", { name: "The nine measures" }, { timeout: 5000 });
    await settled();
    expect(screen.queryByRole("heading", { name: "Google Search Console" })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Organic visits to funder and call pages" })).toHaveTextContent("Google Search Console is not set up on this server.");
  });

  it("shows no number to someone who is not an operator, such as a funder admin", async () => {
    open("/operator/measures", createMockServices({ session: demoSession("aal2", "sam.lee@cascadecounty.example") }));
    expect(await screen.findByText("Only OpenGrants' operators can see the growth measures", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "The nine measures" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Google Search Console" })).not.toBeInTheDocument();
    await settled();
    expect(await seriousViolations()).toEqual([]);
  });
});
