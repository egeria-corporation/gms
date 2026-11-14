// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { viewport } from "./setup.ts";

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={createMockServices({ session: demoSession() })} />
    </MemoryRouter>,
  );
}

describe("routes", () => {
  it("renders the landing page with both entry points", async () => {
    open("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Give and manage grants, free. Sign up with your email." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /I’m a funder: start free/ })).toHaveAttribute("href", "/signin?as=funder");
  });

  it("resolves /w/:ws by workspace kind", async () => {
    viewport.phone = false;
    const funder = open("/w/riverbend");
    const funderRail = await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(within(funderRail).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(within(funderRail).getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/w/riverbend/payments/due");
    funder.unmount();

    open("/w/alder-creek");
    const applicantRail = await screen.findByRole("navigation", { name: "Applicant workspace" });
    expect(within(applicantRail).getByRole("link", { name: "Awarded funding" })).toBeInTheDocument();
  });

  it("keeps funder-only routes out of an applicant workspace", async () => {
    open("/w/alder-creek/payments/due");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("uses the phone layout for the applicant dashboard at phone width", async () => {
    viewport.phone = true;
    open("/w/alder-creek");
    expect(await screen.findByRole("heading", { name: /^Good (morning|afternoon|evening), Maria$/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    viewport.phone = false;
  });

  it("toggles row density on the applications table", async () => {
    open("/w/riverbend/applications");
    const compact = await screen.findByRole("button", { name: "Compact" });
    expect(compact).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(compact);
    expect(await screen.findByRole("button", { name: "Compact", pressed: true })).toBeInTheDocument();
  });

  it("returns not found for an unknown funder page", async () => {
    open("/f/nobody");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
