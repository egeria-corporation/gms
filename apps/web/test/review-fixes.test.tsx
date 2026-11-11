// SPDX-License-Identifier: AGPL-3.0-only
// What the 2026-11-11 platform review found broken for a real person on the live site, held fixed:
// invitation links, the agent consent address, reference boards on the public site, the
// opportunity lost after "Apply", role-blind navigation and connections offered where they cannot work.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { mockLaunchStore } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { firstName } from "../src/components/applicant.tsx";
import { hiddenFunderRailItems, isReviewOnly } from "../src/lib/roles.ts";
import { forgetWanted, rememberWanted, wantedFrom } from "../src/lib/wantedOpportunity.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { invitationProblem } from "../src/screens/public/InvitationAccept.tsx";
import { invitationToken } from "../src/screens/public/SignIn.tsx";
import { ApiError } from "../src/api/client.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return services;
}
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("invitations", () => {
  it("the link in the email adds the person and opens the workspace; it works once", async () => {
    const services = createMockServices({ session: demoSession() });
    const riverbend = MOCK_MEMBERSHIPS.find((m) => m.handle === "riverbend")!;
    const inv = (await services.api.createInvitation(riverbend.id, { email: "new.person@gms.example", role: "program_officer" })) as { acceptUrl?: string };
    const token = /token=(.+)$/.exec(inv.acceptUrl ?? "")![1]!;
    expect(await services.api.acceptInvitation(token)).toMatchObject({ workspace: { handle: "riverbend" } });
    // A second use of the same link is refused, in words the person can act on.
    open(`/invitations/accept?token=${token}`, services);
    expect(await screen.findByRole("heading", { name: "This invitation can't be used" })).toBeInTheDocument();
    expect(screen.getByText(/Ask the person who invited you to send a new one/)).toBeInTheDocument();
  });

  it("a fresh link lands in the workspace", async () => {
    const services = createMockServices({ session: demoSession() });
    const riverbend = MOCK_MEMBERSHIPS.find((m) => m.handle === "riverbend")!;
    const inv = (await services.api.createInvitation(riverbend.id, { email: "second@gms.example", role: "program_officer" })) as { acceptUrl?: string };
    open(inv.acceptUrl!, services);
    await waitFor(() => expect(where()).toBe("/w/riverbend"));
  });

  it("someone signed out is sent to sign in and comes back to the same link", async () => {
    open("/invitations/accept?token=gms_inv_abcdefghij", createMockServices({ session: null }));
    await waitFor(() => expect(where()).toBe(`/signin?next=${encodeURIComponent("/invitations/accept?token=gms_inv_abcdefghij")}`));
  });

  it("a link without a token says so instead of a blank page", async () => {
    open("/invitations/accept");
    expect(await screen.findByRole("heading", { name: "This invitation link is incomplete" })).toBeInTheDocument();
  });

  it("reads the token from a pasted link or a bare token, and nothing else", () => {
    expect(invitationToken("https://gms.opengrants.io/invitations/accept?token=gms_inv_AbC123-xyz_")).toBe("gms_inv_AbC123-xyz_");
    expect(invitationToken("  gms_inv_AbC123-xyz_  ")).toBe("gms_inv_AbC123-xyz_");
    expect(invitationToken("https://gms.opengrants.io/invitations/accept")).toBeNull();
    expect(invitationToken("short")).toBeNull();
    expect(invitationToken("has spaces in it and more")).toBeNull();
    expect(invitationProblem(new ApiError(404, "x")).title).toBe("This invitation can't be used");
    expect(invitationProblem(new Error("network")).title).toBe("You could not be added just now");
  });
});

describe("addresses the site can actually serve", () => {
  const worker = readFileSync(join(import.meta.dirname, "../../../scripts/build-front-worker.mjs"), "utf8");
  const list = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]+\\]);`).exec(worker)![1]!) as string[];
  const prefixes = list("API_PREFIXES");
  const exact = list("API_EXACT");
  const isApi = (path: string) => exact.includes(path) || path === "/mcp" || path.startsWith("/mcp/") || prefixes.some((p) => path.startsWith(p));

  it("the agent consent page is not under a path the site hands to the API", async () => {
    // Every /oauth/ path goes to the API Worker, which has no web pages: the page lives at /consent.
    expect(isApi("/oauth/consent")).toBe(true);
    expect(isApi("/consent")).toBe(false);
    expect(isApi("/invitations/accept")).toBe(false);
    open("/consent?req=signed-request");
    await waitFor(() => expect(document.title).not.toMatch(/Page not found/));
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
  });

  it("reference boards and template previews exist in demo mode only", async () => {
    const live = { ...createMockServices({ session: demoSession() }), mock: false };
    open("/styleguide/components-a", live);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("the same board still opens in demo mode", async () => {
    open("/styleguide/components-a");
    expect(await screen.findByRole("heading", { level: 1, name: "Component Additions A" })).toBeInTheDocument();
  });

  it("a template preview is not served on the live site either", async () => {
    open("/preview/email/award", { ...createMockServices({ session: demoSession() }), mock: false });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("roles", () => {
  it("knows who only reviews, and what a role is not shown", () => {
    expect(isReviewOnly("reviewer")).toBe(true);
    expect(isReviewOnly("external_reviewer")).toBe(true);
    expect(isReviewOnly("program_officer")).toBe(false);
    expect(hiddenFunderRailItems("admin").size).toBe(0);
    expect(hiddenFunderRailItems("reviewer").has("Payments")).toBe(true);
    expect(hiddenFunderRailItems("reviewer").has("Applications")).toBe(false);
    expect(hiddenFunderRailItems("auditor").has("Settings")).toBe(true);
    expect(hiddenFunderRailItems("auditor").has("Payments")).toBe(false);
  });

  it("a reviewer's funder menu leaves out what they cannot use", async () => {
    const memberships = MOCK_MEMBERSHIPS.map((m) => (m.handle === "riverbend" ? { ...m, role: "reviewer", requiresMfa: false } : m));
    open("/w/riverbend", createMockServices({ session: demoSession(), memberships }));
    const nav = await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(nav).toHaveTextContent("Applications");
    expect(nav).not.toHaveTextContent("Payments");
    expect(nav).not.toHaveTextContent("Settings");
  });

  it("an admin still sees the whole menu, and Grantees no longer points at a demo organization", async () => {
    open("/w/riverbend");
    const nav = await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(nav).toHaveTextContent("Payments");
    expect(screen.getByRole("link", { name: "Grantees" })).toHaveAttribute("href", "/w/riverbend/grantees");
  });

  it("someone who only reviews is sent to the reviewer portal after signing in", async () => {
    const memberships = MOCK_MEMBERSHIPS.filter((m) => m.handle === "riverbend").map((m) => ({ ...m, role: "external_reviewer", requiresMfa: false }));
    open("/signin", createMockServices({ session: demoSession(), memberships }));
    await waitFor(() => expect(where()).toBe("/review/assignments"));
  });
});

describe("the opportunity someone clicked Apply on", () => {
  it("is remembered across the trip and validated", () => {
    rememberWanted({ funder: "riverbend", opportunity: "community-health-2027" });
    expect(wantedFrom(new URLSearchParams())).toEqual({ funder: "riverbend", opportunity: "community-health-2027" });
    // The address wins over what was remembered; anything that is not a handle and a slug is ignored.
    expect(wantedFrom(new URLSearchParams("funder=other&opportunity=thing"))).toEqual({ funder: "other", opportunity: "thing" });
    forgetWanted();
    expect(wantedFrom(new URLSearchParams())).toBeNull();
    expect(wantedFrom(new URLSearchParams("funder=a/b&opportunity=<script>"))).toBeNull();
    rememberWanted({ funder: "../x", opportunity: "y" });
    expect(wantedFrom(new URLSearchParams())).toBeNull();
  });

  it("is shown first in Find funding", async () => {
    open("/w/alder-creek/find?funder=riverbend&opportunity=community-health-2027");
    expect(await screen.findByText("The opportunity you chose")).toBeInTheDocument();
  });

  it("is said to be closed when it is not among the open ones", async () => {
    open("/w/alder-creek/find?funder=riverbend&opportunity=not-a-real-one");
    expect(await screen.findByText("That opportunity is not open for applications right now")).toBeInTheDocument();
  });
});

describe("connections this site cannot make", () => {
  it("Find funding does not offer the OpenGrants tabs where the server cannot search", async () => {
    const services = createMockServices({ session: demoSession() });
    mockLaunchStore(services)!.config.available = { openGrants: false, assistant: false, googleWorkspace: false, mercury: false, customMcp: false };
    open("/w/alder-creek/find", services);
    expect(await screen.findByRole("tab", { name: /Open here/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("tab", { name: "OpenGrants index" })).not.toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "Alerts" })).not.toBeInTheDocument();
  });

  it("settings show a notice instead of a form or a Connect button", async () => {
    const services = createMockServices({ session: demoSession() });
    mockLaunchStore(services)!.config.available = { openGrants: false, assistant: false, googleWorkspace: false, mercury: false, customMcp: false };
    open("/w/riverbend/settings/mcp", services);
    expect(await screen.findByText("Mercury reconciliation is not available on this installation")).toBeInTheDocument();
    expect(await screen.findByText("Custom MCP servers need to be switched on by whoever hosts this GMS. Everything else works without them.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Workspace" })).not.toBeInTheDocument();
  });
});

describe("small things", () => {
  it("greets someone by a capitalised first name, from a name or an address", () => {
    expect(firstName("sedale@opengrants.example")).toBe("Sedale");
    expect(firstName("Maria Santos")).toBe("Maria");
    expect(firstName("dana.ortiz@riverbendcf.example")).toBe("Dana");
  });

  it("the workspace bar has no search box or Help button that do nothing", async () => {
    open("/w/riverbend");
    await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Help" })).not.toBeInTheDocument();
  });

  it("the landing page's footer links go somewhere real", async () => {
    open("/", createMockServices({ session: null }));
    expect(await screen.findByRole("link", { name: "Source" })).toHaveAttribute("href", "https://github.com/egeria-corporation/gms");
    expect(screen.getByRole("link", { name: "CommonGrants spec" })).toHaveAttribute("href", "https://commongrants.org");
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Status" })).not.toBeInTheDocument();
  });
});
