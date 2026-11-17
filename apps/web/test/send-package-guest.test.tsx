// SPDX-License-Identifier: AGPL-3.0-only
// C4 in mock mode: the send-to-funder dialog and the guest reviewer screens render with no serious
// accessibility problems, the welcome is an external reviewer's only, and the offer shows once.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockGuestReviewStore } from "../src/api/guestReviewHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { mockSensitive } from "../src/mocks/sendPackage.ts";
import { guestReviewDone } from "../src/screens/funder/ReviewerScoring.tsx";

const guestMemberships = MOCK_MEMBERSHIPS.filter((m) => m.kind === "funder").map((m) => ({ ...m, role: "external_reviewer", requiresMfa: false }));

function open(path: string, services = createMockServices({ session: demoSession() })) {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...utils, services };
}

async function seriousViolations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

describe("send to the funder", () => {
  it("the dialog lists the package and has no serious accessibility problems", async () => {
    open(`/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`);
    await userEvent.click(await screen.findByRole("button", { name: "Send to the funder" }));
    const dialog = await screen.findByRole("dialog", { name: "Send to the funder" });
    const files = await within(dialog).findByRole("list", { name: "Files in the package" });
    expect(within(files).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Family-Navigation-Expansion.pdf"), expect.stringContaining("answers.txt")]);
    expect(dialog).toHaveTextContent("Prepared with the OpenGrants Grant Management System, free for funders and applicants · gms.opengrants.io");
    expect(await seriousViolations()).toEqual([]);
  });

  it("the mock screens answers as the server does", () => {
    expect(mockSensitive("Account 000123456789", "Payments")).toBe("long_number");
    expect(mockSensitive("Her number 123-45-6789", "Staff")).toBe("identity_number");
    expect(mockSensitive("12-3456789", "Organization EIN")).toBeNull();
    expect(mockSensitive("Call 555-010-0123", "Contact")).toBeNull();
  });
});

describe("the guest reviewer", () => {
  it("is done after the last review: one submitted and none open, recusals aside", () => {
    expect(guestReviewDone([{ status: "submitted" }, { status: "recused" }])).toBe(true);
    expect(guestReviewDone([{ status: "submitted" }, { status: "in_progress" }])).toBe(false);
    expect(guestReviewDone([{ status: "recused" }])).toBe(false);
    expect(guestReviewDone([])).toBe(false);
  });

  it("the welcome is for an external reviewer only", async () => {
    // The demo person is a staff reviewer at Cascade County, not a guest.
    open("/review/welcome?ws=cascade-county");
    expect(await screen.findByText("This page is for invited reviewers")).toBeInTheDocument();
  });

  it("an external reviewer is welcomed, with no serious accessibility problems", async () => {
    open("/review/welcome?ws=riverbend", createMockServices({ session: demoSession("aal1", "sam@city-foundation.example"), memberships: guestMemberships }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome. Thank you for reviewing." })).toBeInTheDocument();
    expect(screen.getByText("3 assigned to you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start reviewing" })).toBeInTheDocument();
    // The conflict-of-interest link opens the reviewer portal's policy signing.
    expect(screen.getByRole("link", { name: "Read and confirm the conflict-of-interest steps" })).toHaveAttribute("href", "/review/assignments?ws=riverbend&sign=1");
    await waitFor(() => expect(document.querySelector(".loading, [aria-busy=true]")).toBeNull());
    expect(await seriousViolations()).toEqual([]);
  });

  it("the done screen shows the offer once and counts it", async () => {
    const services = createMockServices({ session: demoSession("aal1", "sam@city-foundation.example"), memberships: guestMemberships });
    const first = open("/review/done?ws=cascade-county", services);
    const offer = await screen.findByRole("region", { name: "Run a review panel for your own organization, free" });
    expect(offer).toBeInTheDocument();
    await waitFor(() => expect(mockGuestReviewStore(services).events.map((e) => e.event)).toEqual(["shown"]));
    expect(await seriousViolations()).toEqual([]);
    await userEvent.click(within(offer).getByRole("button", { name: "Set up my organization" }));
    expect(within(offer).getByLabelText(/Organization name/)).toHaveValue("City Foundation");
    first.unmount();
    // Shown once: the next visit has no offer.
    open("/review/done?ws=cascade-county", services);
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you. Your reviews are in." })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Run a review panel for your own organization, free" })).not.toBeInTheDocument();
    expect(mockGuestReviewStore(services).events.map((e) => e.event)).toEqual(["shown", "clicked"]);
  });
});
