// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { roleRequiresMfa } from "../src/auth/types.ts";
import { demoSession, MOCK_CODE } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;

async function typeCode(code: string) {
  const group = await screen.findByRole("group", { name: "One-time code" });
  await userEvent.click(within(group).getByLabelText("Digit 1"));
  await userEvent.paste(code);
}

describe("route guard", () => {
  it.each(["/w/riverbend", "/notifications", "/account/agents", "/review/assignments", "/onboarding/funder/brand"])(
    "sends a signed-out visitor from %s to sign-in and remembers the destination",
    async (path) => {
      open(path, createMockServices({ session: null }));
      expect(await screen.findByRole("heading", { name: "Enter Your Email" })).toBeInTheDocument();
      expect(where()).toBe(`/signin?next=${encodeURIComponent(path)}`);
    },
  );

  it("leaves public pages open", async () => {
    open("/f/riverbend", createMockServices({ session: null }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(where()).toBe("/f/riverbend");
  });
});

describe("two-step verification", () => {
  it("is required for funder admin and finance and applicant admin only", () => {
    expect(roleRequiresMfa("funder", "admin")).toBe(true);
    expect(roleRequiresMfa("funder", "finance")).toBe(true);
    expect(roleRequiresMfa("funder", "program_officer")).toBe(false);
    expect(roleRequiresMfa("funder", "external_reviewer")).toBe(false);
    expect(roleRequiresMfa("applicant", "admin")).toBe(true);
    expect(roleRequiresMfa("applicant", "editor")).toBe(false);
  });

  it("holds an aal1 admin at the second step before the workspace opens", async () => {
    open("/w/riverbend", createMockServices({ session: demoSession("aal1"), totpEnrolled: true }));
    expect(await screen.findByRole("heading", { name: "Two-Step Verification" })).toBeInTheDocument();
    expect(where()).toContain("step=mfa");
    await userEvent.type(await screen.findByLabelText("Enter the 6-digit code from your app"), MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
  });

  it("opens a workspace whose role does not require it at aal1", async () => {
    open("/w/cascade-county", createMockServices({ session: demoSession("aal1") }));
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
  });
});

describe("sign-in flow", () => {
  it("goes email → code → authenticator setup → workspace", async () => {
    open("/signin", createMockServices({ session: null }));
    await userEvent.type(await screen.findByLabelText("Work email"), "dana.ortiz@riverbendcf.example");
    await userEvent.click(screen.getByRole("button", { name: /Send code/ }));

    await typeCode("000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't match.");

    await typeCode(MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    expect(await screen.findByRole("heading", { name: "Set Up Two-Step Verification" })).toBeInTheDocument();
    expect(await screen.findByText("QHX7-R2MP-4TLC-W9KD")).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("Enter the 6-digit code from your app"), MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe("/w/riverbend"));
  });

  it("shows first run to someone with no workspaces", async () => {
    open("/signin", createMockServices({ session: demoSession("aal1"), memberships: [] }));
    expect(await screen.findByRole("heading", { name: "How Will You Use OpenGrants GMS?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Set up my applicant organization/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(where()).toBe("/onboarding/applicant"));
  });

  it("ignores an off-site next parameter", async () => {
    open("/signin?next=//evil.example", createMockServices({ session: demoSession() }));
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
    expect(where()).toBe("/w/riverbend");
  });
});

describe("workspace switcher", () => {
  it("lists the member's workspaces, marks the current one and switches", async () => {
    open("/w/riverbend", createMockServices({ session: demoSession() }));
    const button = await screen.findByRole("button", { name: /Riverbend Community Foundation/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Switch workspace" });
    for (const m of MOCK_MEMBERSHIPS) expect(within(menu).getByRole("menuitem", { name: new RegExp(m.name) })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Riverbend/ })).toHaveAttribute("aria-current", "true");

    await userEvent.click(within(menu).getByRole("menuitem", { name: /Alder Creek/ }));
    expect(await screen.findByRole("navigation", { name: "Applicant workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and signs out", async () => {
    open("/w/riverbend", createMockServices({ session: demoSession() }));
    const button = await screen.findByRole("button", { name: /Riverbend Community Foundation/ });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Enter Your Email" })).toBeInTheDocument();
  });
});
