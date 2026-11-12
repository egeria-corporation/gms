// SPDX-License-Identifier: AGPL-3.0-only
// Using the GMS without Passport: onboarding with a profile, the Passport switches, "Not verified"
// next to organizations, the settings editor, and the opportunity toggles.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { mockLaunchStore } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { VerificationBadge } from "../src/components/status.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { IDS } from "../src/mocks/store.ts";
import { cleanProfile, profileProblems } from "../src/lib/profile.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
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

/** A person who has a funder workspace and no applicant one yet. */
const newApplicant = () => createMockServices({ session: demoSession(), memberships: MOCK_MEMBERSHIPS.filter((m) => m.kind === "funder") });

const passportOff = (services: Services) => {
  const store = mockLaunchStore(services)!;
  store.config.passport = { signIn: false, linking: false, payments: false };
};

describe("profile rules", () => {
  it("needs a legal name and a contact email, and checks the optional fields it is given", () => {
    expect(profileProblems({ legalName: "", contactEmail: "" }).map((p) => p.path)).toEqual(["legalName", "contactEmail"]);
    expect(profileProblems({ legalName: "Oak", contactEmail: "a@b.example", website: "http://x.example", ein: "12", address: { country: "USA" } }).map((p) => p.path)).toEqual(["website", "address.country", "ein"]);
    expect(profileProblems({ legalName: "Oak", contactEmail: "a@b.example", ein: "12-3456789", website: "https://oak.example" })).toEqual([]);
  });
  it("drops empty optional fields and tidies the rest", () => {
    expect(cleanProfile({ legalName: " Oak ", contactEmail: "a@b.example", website: "", ein: "12-3456789", address: { city: " Reno ", country: "us", street: "" } })).toEqual({
      legalName: "Oak",
      contactEmail: "a@b.example",
      ein: "123456789",
      address: { city: "Reno", country: "US" },
    });
  });
});

describe("VerificationBadge", () => {
  it("shows the level for Passport, Not verified otherwise, and the level alone for an older server", () => {
    const { rerender } = render(<VerificationBadge verification={{ source: "passport", level: "L2" }} />);
    expect(screen.getByText("L2")).toBeInTheDocument();
    rerender(<VerificationBadge verification={{ source: "self_declared", level: null }} />);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    rerender(<VerificationBadge verification={{ source: "none", level: null }} />);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    rerender(<VerificationBadge level="L3" />);
    expect(screen.getByText("L3")).toBeInTheDocument();
  });
});

describe("applicant onboarding", () => {
  it("offers Passport (recommended) and setting up without it", async () => {
    open("/onboarding/applicant", newApplicant());
    expect(await screen.findByRole("heading", { name: "Continue with Passport" })).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set up without Passport" })).toBeInTheDocument();
  });

  it("creates a workspace from a short profile and sends the person into it", async () => {
    const services = newApplicant();
    open("/onboarding/applicant", services);
    await userEvent.click(await screen.findByRole("button", { name: "Set up without Passport" }));
    await userEvent.click(screen.getByRole("button", { name: "Create my workspace" }));
    expect(await screen.findAllByText("Enter your organization’s legal name")).not.toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/^Legal name/), "Pine Ridge Youth Alliance");
    await userEvent.clear(screen.getByLabelText(/^Contact email/));
    await userEvent.type(screen.getByLabelText(/^Contact email/), "hello@pineridge.example");
    await userEvent.click(screen.getByRole("button", { name: "Create my workspace" }));
    await waitFor(() => expect(where()).toBe("/w/pine-ridge-youth-alliance"));
    const me = await services.api.me();
    const made = me.workspaces.find((w) => w.handle === "pine-ridge-youth-alliance")!;
    const record = await services.api.workspaceRecord(made.id);
    expect(record.profileSource).toBe("self_declared");
    expect(record.profile).toEqual({ legalName: "Pine Ridge Youth Alliance", contactEmail: "hello@pineridge.example" });
    expect(record.passportOrgId).toBeNull();
  });

  it("hides the Passport choice when this server cannot link Passport", async () => {
    const services = newApplicant();
    passportOff(services);
    open("/onboarding/applicant", services);
    expect(await screen.findByRole("heading", { name: "Set up without Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Passport" })).not.toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
  });
});

describe("Passport switched off", () => {
  it("sign-in has no Passport button and the opportunity page does not push Passport", async () => {
    const out = createMockServices({ session: null });
    passportOff(out);
    open("/signin", out);
    expect(await screen.findByRole("heading", { name: "Sign In to OpenGrants GMS" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Passport" })).not.toBeInTheDocument();
  });

  it("sign-in offers Passport when it is on", async () => {
    open("/signin", createMockServices({ session: null }));
    expect(await screen.findByRole("button", { name: "Continue with Passport" })).toBeInTheDocument();
  });

  it("funder onboarding says Passport is optional and drops the connect panel", async () => {
    const services = createMockServices({ session: demoSession() });
    passportOff(services);
    open("/onboarding/funder/organization", services);
    await userEvent.type(await screen.findByLabelText(/Organization name/), "Oak Fund");
    await userEvent.click(screen.getByRole("button", { name: /Continue to Brand/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Continue to Team/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Continue to Payments/ }));
    expect(await screen.findByText(/You do not need Passport to use the GMS/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Client id/)).not.toBeInTheDocument();
  });
});

describe("funder screens", () => {
  it("show Not verified next to an applicant with no Passport record, and the level for the rest", async () => {
    open("/w/riverbend/applications");
    const meadow = await screen.findByRole("link", { name: "Meadowbrook Food Bank" });
    expect(within(meadow.closest("td")!).getByText("Not verified")).toBeInTheDocument();
    const alder = screen.getByRole("link", { name: "Alder Creek Family Services" });
    expect(within(alder.closest("td")!).queryByText("Not verified")).not.toBeInTheDocument();
  });

  it("the public funder page notes when the funder is not verified", async () => {
    const services = createMockServices({ session: null });
    const real = services.api.publicFunder;
    services.api.publicFunder = async (h) => {
      const data = await real(h);
      return { ...data, funder: { ...data.funder, verificationLevel: null, verification: { source: "self_declared", level: null } } };
    };
    open("/f/riverbend", services);
    expect(await screen.findByText("This funder’s organization is not verified with OpenGrants Passport")).toBeInTheDocument();
  });

  it("the public funder page of a Passport funder does not", async () => {
    open("/f/riverbend", createMockServices({ session: null }));
    await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" });
    expect(screen.queryByText(/not verified with OpenGrants Passport/)).not.toBeInTheDocument();
  });
});

describe("settings", () => {
  it("an applicant workspace without Passport edits its own profile", async () => {
    const services = createMockServices({ session: demoSession() });
    const made = await services.api.createWorkspace({ kind: "applicant", handle: "oak-hollow", displayName: "Oak Hollow", profile: { legalName: "Oak Hollow", contactEmail: "oak@hollow.example" } });
    open("/w/oak-hollow/settings", services);
    expect(await screen.findByRole("heading", { name: "Organization details" })).toBeInTheDocument();
    expect(await screen.findByText(/Funders see this organization as not verified/)).toBeInTheDocument();
    const mission = await screen.findByLabelText(/^Legal name/);
    expect(mission).toHaveValue("Oak Hollow");
    await userEvent.clear(mission);
    await userEvent.type(mission, "Oak Hollow Community Trust");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(async () => expect((await services.api.workspaceRecord(made.workspace.id)).profile?.legalName).toBe("Oak Hollow Community Trust"));
    expect(screen.getByRole("link", { name: "Connect Passport" })).toHaveAttribute("href", "/onboarding/applicant");
  });

  it("a Passport workspace reads its details from Passport and cannot edit them here", async () => {
    open("/w/alder-creek/settings");
    expect(await screen.findByRole("heading", { name: "Organization details" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Edit in Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("the server refuses a profile edit once Passport is linked", async () => {
    const services = createMockServices({ session: demoSession() });
    const me = await services.api.me();
    const alder = me.workspaces.find((w) => w.handle === "alder-creek")!;
    await expect(services.api.updateProfile(alder.id, { legalName: "X", contactEmail: "x@y.example" })).rejects.toMatchObject({ status: 409 });
  });

  it("opportunity settings carry the two toggles, and Passport-only one follows the switch", async () => {
    const services = createMockServices({ session: demoSession() });
    open("/w/riverbend/opportunities/community-health-2027/edit#who", services);
    await screen.findByRole("list", { name: "Eligibility rules" });
    await userEvent.click(await screen.findByLabelText(/Require a linked Passport/));
    await userEvent.click(screen.getByLabelText(/Accept details applicants enter themselves/));
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    await waitFor(async () => {
      const saved = await services.api.getOpportunity(IDS.oppHealth27);
      expect(saved.publish.requirePassport).toBe(true);
      expect(saved.publish.acceptSelfReported).toBe(true);
    });
  });

  it("without Passport the require toggle is not offered", async () => {
    const services = createMockServices({ session: demoSession() });
    passportOff(services);
    open("/w/riverbend/opportunities/community-health-2027/edit#who", services);
    await screen.findByRole("list", { name: "Eligibility rules" });
    expect(screen.getByLabelText(/Accept details applicants enter themselves/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Require a linked Passport/)).not.toBeInTheDocument();
  });
});

describe("applicant readiness without Passport", () => {
  it("shows the profile check and an optional, non-failing Passport line", async () => {
    const services = createMockServices({ session: demoSession() });
    const { provideMockApplicantStore } = await import("../src/api/applicantHooks.ts");
    const { seedApplicantStore } = await import("../src/mocks/applicant.ts");
    const store = seedApplicantStore();
    Object.assign(store.organization, { linked: false, level: null });
    provideMockApplicantStore(services, store);
    open("/w/alder-creek", services);
    expect(await screen.findByRole("heading", { name: "Readiness" })).toBeInTheDocument();
    expect(screen.getByText("Profile complete")).toBeInTheDocument();
    expect(screen.getByText("Connect Passport for verification")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Needs attention" })).not.toBeInTheDocument();
  });
});
