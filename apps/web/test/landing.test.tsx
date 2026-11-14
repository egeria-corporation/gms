// SPDX-License-Identifier: AGPL-3.0-only
// The landing page (email first, Passport optional) and the hand-off from its buttons through
// sign-in into onboarding.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { mockLaunchStore } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const where = () => screen.getByTestId("where").textContent;

function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
}

const flags = (services: Services, passport: { signIn: boolean; linking: boolean; payments: boolean }) => {
  mockLaunchStore(services)!.config.passport = passport;
  return services;
};
const signedOut = () => createMockServices({ session: null });
/** Signed in, no workspaces yet: what a new person looks like after the email code. */
const newcomer = () => createMockServices({ session: demoSession("aal1"), memberships: [] });

describe("landing page", () => {
  it("has one h1 and two equal start buttons that carry who the person is", async () => {
    open("/", signedOut());
    expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /I’m a funder: start free/ })).toHaveAttribute("href", "/signin?as=funder");
    expect(screen.getByRole("link", { name: /I’m a grantee or applicant: start free/ })).toHaveAttribute("href", "/signin?as=grantee");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("shows Passport as a small line, never as a primary action, and only when sign-in is on", async () => {
    const on = open("/", flags(signedOut(), { signIn: true, linking: true, payments: true }));
    expect(await screen.findByText("Already use OpenGrants Passport?")).toBeInTheDocument();
    const passport = screen.getByRole("button", { name: "Continue with Passport" });
    expect(passport).toHaveClass("btn-secondary");
    expect(passport).not.toHaveClass("btn-cta");
    expect(screen.getByRole("heading", { name: "What Passport adds, if you want it" })).toBeInTheDocument();
    on.unmount();

    open("/", flags(signedOut(), { signIn: false, linking: false, payments: false }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Already use OpenGrants Passport?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue with Passport/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What Passport adds, if you want it" })).not.toBeInTheDocument();
  });

  it("presents Passport as an optional add-on and no longer leads with not needing it", async () => {
    const pitch = "Add OpenGrants Passport, a free, verified profile for your organization that you set up once and share with the funders you choose. It's optional.";
    const on = open("/", flags(signedOut(), { signIn: true, linking: true, payments: true }));
    const adds = (await screen.findByRole("heading", { name: "What Passport adds, if you want it" })).closest("section")!;
    expect(within(adds).getByText(pitch)).toBeInTheDocument();
    expect(screen.queryByText(/No Passport account needed/)).not.toBeInTheDocument();
    const facts = screen.getByRole("list", { name: "At a glance" });
    expect(within(facts).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Free for funders", "Free for grantees", "Email sign-in, no password", "Open source"]);
    // Anyone can still sign up with an email.
    expect(screen.getByRole("heading", { level: 1, name: "Give and manage grants, free. Sign up with your email." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What you can do without Passport" })).toBeInTheDocument();
    on.unmount();

    // Where this server cannot link Passport, the page does not offer it.
    open("/", flags(signedOut(), { signIn: false, linking: false, payments: false }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(pitch)).not.toBeInTheDocument();
    expect(screen.queryByText(/No Passport (account needed|required)/)).not.toBeInTheDocument();
  });

  it("links the self-host section to the deploy runbook and states what works without Passport", async () => {
    open("/", signedOut());
    expect(await screen.findByRole("link", { name: /Deploy with an agent/ })).toHaveAttribute("href", "https://github.com/egeria-corporation/gms/blob/main/DEPLOY_WITH_AGENT.md");
    expect(screen.getByRole("heading", { name: "What you can do without Passport" })).toBeInTheDocument();
    expect(screen.getByText("Do I need OpenGrants Passport?")).toBeInTheDocument();
  });

  it("keeps Sign in visible and puts the section links behind a Menu button that Escape closes", async () => {
    open("/", signedOut());
    const menu = await screen.findByRole("button", { name: "Menu" });
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    await userEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "How it works" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });
});

describe("sign-up hand-off", () => {
  it("as=funder goes straight to funder setup", async () => {
    open("/signin?as=funder", newcomer());
    await waitFor(() => expect(where()).toBe("/onboarding/funder/organization"));
  });

  it("as=grantee goes straight to grantee setup with the email form open", async () => {
    open("/signin?as=grantee", newcomer());
    await waitFor(() => expect(where()).toBe("/onboarding/applicant?start=email"));
    expect(await screen.findByRole("button", { name: "Create my workspace" })).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });

  it("asks the question only when there is no choice to carry", async () => {
    open("/signin", newcomer());
    expect(await screen.findByRole("heading", { name: "How Will You Use OpenGrants GMS?" })).toBeInTheDocument();
  });

  it("ignores an unknown as value", async () => {
    open("/signin?as=admin", newcomer());
    expect(await screen.findByRole("heading", { name: "How Will You Use OpenGrants GMS?" })).toBeInTheDocument();
  });

  it("warns admins about the authenticator app before the code step", async () => {
    open("/signin?as=funder", signedOut());
    expect(await screen.findByText("Admins add an authenticator app as a second step. It takes a minute.")).toBeInTheDocument();
  });

  it("start=email, name and next pre-fill the form and return to a same-origin path", async () => {
    open("/onboarding/applicant?start=email&name=Pine%20Ridge%20Youth%20Alliance&next=/onboarding/funder/organization", newcomer());
    const legal = await screen.findByLabelText(/^Legal name/);
    expect(legal).toHaveValue("Pine Ridge Youth Alliance");
    await userEvent.clear(screen.getByLabelText(/^Contact email/));
    await userEvent.type(screen.getByLabelText(/^Contact email/), "hello@pineridge.example");
    await userEvent.click(screen.getByRole("button", { name: "Create my workspace" }));
    await waitFor(() => expect(where()).toBe("/onboarding/funder/organization"));
  });

  it("does not follow an off-site next after setup", async () => {
    open("/onboarding/applicant?start=email&name=Oak%20Fund&next=//evil.example", newcomer());
    await screen.findByLabelText(/^Legal name/);
    await userEvent.clear(screen.getByLabelText(/^Contact email/));
    await userEvent.type(screen.getByLabelText(/^Contact email/), "a@oak.example");
    await userEvent.click(screen.getByRole("button", { name: "Create my workspace" }));
    await waitFor(() => expect(where()).toBe("/w/oak-fund"));
  });
});
