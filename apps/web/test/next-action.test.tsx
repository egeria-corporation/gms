// SPDX-License-Identifier: AGPL-3.0-only
// The next action is the one the screen leads with: the panel when a competition can be committed,
// one competition address, one primary move on an outside application, a line for what to do after
// submitting, and a notice before a role that cannot save tries to.
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { outsidePrimary } from "../src/lib/outside.ts";
import { panelDecisionsPath } from "../src/lib/panelNav.ts";
import { hiddenFunderRailItems } from "../src/lib/roles.ts";
import { APPLICANT_IDS } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { IDS } from "../src/mocks/store.ts";
import { OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { statusNext } from "../src/screens/applicant/ApplicationStatus.tsx";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}
const where = () => screen.getByTestId("where").textContent ?? "";

function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return services;
}

function asRole(role: string) {
  const memberships = MOCK_MEMBERSHIPS.map((m) => (m.handle === "alder-creek" ? { ...m, role } : m));
  return createMockServices({ session: demoSession(), memberships });
}

afterEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe("panel and decisions", () => {
  it("links the rail to the one competition that is ready to commit", async () => {
    open("/w/riverbend");
    const nav = await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(await within(nav).findByRole("link", { name: "Panel & decisions" })).toHaveAttribute("href", `/w/riverbend/competitions/${IDS.compHealth27}/panel`);
  });

  it("hides that entry from a reviewer, whose work is the reviewer portal", () => {
    expect(hiddenFunderRailItems("reviewer").has("Panel & decisions")).toBe(true);
    expect(hiddenFunderRailItems("admin").has("Panel & decisions")).toBe(false);
    expect(panelDecisionsPath([])).toBeNull();
    expect(panelDecisionsPath([{ id: "a", status: "draft", stages: [{ decisionRequired: true }] }])).toBeNull();
    expect(panelDecisionsPath([{ id: "a", status: "open", stages: [{ decisionRequired: false }] }])).toBeNull();
    expect(panelDecisionsPath([{ id: "a", status: "open", stages: [{ decisionRequired: true }] }])).toBe("/competitions/a/panel");
    expect(
      panelDecisionsPath([
        { id: "a", status: "open", stages: [{ decisionRequired: true }] },
        { id: "b", status: "open", stages: [{ decisionRequired: true }] },
      ]),
    ).toBe("/reviews/assign#panels");
  });

  it("opens an existing competition at its own address", async () => {
    open("/w/riverbend/opportunities/community-health-2027/competition");
    expect(await screen.findByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe(`/w/riverbend/competitions/${IDS.compHealth27}`));
  });

  it("does not mark Opportunities current on the forms library", async () => {
    open("/w/riverbend/forms");
    expect(await screen.findByRole("heading", { level: 1, name: "Forms" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Funder workspace" });
    expect(within(nav).getByRole("link", { name: "Opportunities" })).not.toHaveAttribute("aria-current");
  });
});

describe("outside application primary action", () => {
  it("leads with Questions while a draft is still being written, and with the decision once it is sent", async () => {
    expect(outsidePrimary("drafting", [{ status: "draft" }])).toBe("questions");
    expect(outsidePrimary("drafting", [{ status: "ready" }, { status: "approved" }])).toBe("send");
    expect(outsidePrimary("submitted", [])).toBe("decision");
    expect(outsidePrimary("awarded", [])).toBeNull();

    open(`/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`);
    expect(await screen.findByRole("button", { name: "Questions" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Mark as submitted" })).not.toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Send to the funder" })).not.toHaveClass("btn-primary");
  });

  it("leads with Record decision after it has been sent", async () => {
    open(`/w/alder-creek/outside/${OUTSIDE_IDS.pinecrest}`);
    expect(await screen.findByRole("button", { name: "Record decision" })).toHaveClass("btn-primary");
    expect(screen.queryByRole("button", { name: "Questions" })).not.toBeInTheDocument();
  });
});

describe("what to do after submitting", () => {
  it("says what happens now for each status that shares the submitted lane", async () => {
    expect(statusNext("draft")).toBeNull();
    expect(statusNext("submitted")).toMatch(/has your application/);
    expect(statusNext("screening")).toMatch(/screening/);
    expect(statusNext("under_review")).toMatch(/reading/);
    expect(statusNext("revision_requested")).toMatch(/asked for changes/);
    expect(statusNext("interview")).toMatch(/wants to talk/);
    expect(statusNext("recommended")).toMatch(/still has to decide/);
    expect(statusNext("waitlisted")).toMatch(/waitlist/);

    open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appClinic}`);
    expect(await screen.findByText(/The funder has your application/)).toBeInTheDocument();
  });
});

describe("a role that cannot save", () => {
  it("tells a viewer before they try, and does not offer Submit", async () => {
    open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appHealth}/edit`, asRole("viewer"));
    expect(await screen.findByText("You can look, not change")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit…" })).not.toBeInTheDocument();
  });

  it("tells a consultant what they can change", async () => {
    open("/w/alder-creek", asRole("consultant"));
    expect(await screen.findByText("You can edit the applications you were invited to")).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });
});

describe("phone editor", () => {
  it("opens the validation sheet when the stage already has errors", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appHealth}/edit`);
    const sheet = await screen.findByRole("button", { name: /^Validation/ });
    expect(sheet).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tab", { name: /^Validation/ })).toBeVisible();
  });
});
