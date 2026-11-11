// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport, in the web app: the button really leaves for Passport, the return page
// redeems the one-time sign-in, and every way the trip can fail has a banner with a next step.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { MOCK_PASSPORT_TOKEN, passportBrowser, passportProblem, passportSignInUrl, safeNext } from "../src/lib/passportSignIn.ts";
import { MOCK_CODE } from "../src/mocks/auth.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
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
/** Services as a deployed app has them: the button must leave for the API. */
const live = (): Services => ({ ...createMockServices({ session: null }), mock: false });

afterEach(() => vi.restoreAllMocks());

describe("Continue with Passport", () => {
  it("on the sign-in page, leaves for the API's start route with the destination, and shows it is working", async () => {
    const go = vi.spyOn(passportBrowser, "go").mockImplementation(() => undefined);
    open("/signin?next=%2Fw%2Falder-creek%2Fapplications", live());
    const button = await screen.findByRole("button", { name: "Continue with Passport" });
    await userEvent.click(button);
    expect(go).toHaveBeenCalledExactlyOnceWith("http://api.test/gms/passport/signin/start?returnTo=%2Fw%2Falder-creek%2Fapplications");
    const busy = screen.getByRole("button", { name: "Opening Passport…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    // A second click while the browser is leaving does nothing.
    await userEvent.click(busy);
    expect(go).toHaveBeenCalledTimes(1);
    // It is no longer a link back to this page.
    expect(screen.queryByRole("link", { name: /Continue with Passport/ })).not.toBeInTheDocument();
  });

  it("on the landing page, leaves for the API's start route", async () => {
    const go = vi.spyOn(passportBrowser, "go").mockImplementation(() => undefined);
    open("/", live());
    await userEvent.click(await screen.findByRole("button", { name: "Continue with Passport" }));
    expect(go).toHaveBeenCalledExactlyOnceWith("http://api.test/gms/passport/signin/start");
  });

  it("never sends an off-site destination", () => {
    expect(passportSignInUrl("//evil.example", false)).toBe("http://api.test/gms/passport/signin/start");
    expect(passportSignInUrl("https://evil.example", false)).toBe("http://api.test/gms/passport/signin/start");
    expect(safeNext("/\\evil.example")).toBeNull();
    expect(safeNext("/w/alder-creek")).toBe("/w/alder-creek");
  });

  it("in mock mode walks the whole path: Passport, back, second step, workspace", async () => {
    const services = createMockServices({ session: null });
    open("/signin", services);
    await userEvent.click(await screen.findByRole("button", { name: "Continue with Passport" }));
    expect(await screen.findByRole("heading", { name: "Set Up Two-Step Verification" })).toBeInTheDocument();
    expect(await services.auth.getSession()).toMatchObject({ aal: "aal1" });
    // The one-time sign-in is gone from the address bar.
    expect(where()).not.toContain(MOCK_PASSPORT_TOKEN);
    await userEvent.type(screen.getByLabelText("Enter the 6-digit code from your app"), MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
  });
});

describe("coming back from Passport", () => {
  it("redeems the sign-in and goes to the destination it was given", async () => {
    const services = createMockServices({ session: null });
    const redeem = vi.spyOn(services.auth, "redeemSignIn");
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&next=%2Fw%2Fcascade-county`, services);
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledExactlyOnceWith(MOCK_PASSPORT_TOKEN, "magiclink");
    await waitFor(() => expect(where()).toBe("/w/cascade-county"));
  });

  it("ignores an off-site destination in the fragment", async () => {
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&next=%2F%2Fevil.example`, createMockServices({ session: null, totpEnrolled: true }));
    expect(await screen.findByRole("heading", { name: "Two-Step Verification" })).toBeInTheDocument();
    expect(where()).not.toContain("evil.example");
  });

  it("says the sign-in ran out when the token is not accepted, and signs nobody in", async () => {
    const services = createMockServices({ session: null });
    open("/auth/passport#token_hash=used-already&type=magiclink", services);
    expect(await screen.findByText("That sign-in ran out of time")).toBeInTheDocument();
    expect(where()).toBe("/signin?passport_error=expired");
    expect(await services.auth.getSession()).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Passport" })).toBeEnabled();
  });

  it("refuses a return with no sign-in in it", async () => {
    open("/auth/passport", createMockServices({ session: null }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in could not be confirmed");
    expect(where()).toBe("/signin?passport_error=state_mismatch");
  });
});

describe("when Passport sends the person back without a session", () => {
  it.each([
    ["cancelled", "You cancelled at Passport"],
    ["no_organization", "Your Passport has no organization yet"],
    ["email_unverified", "Your Passport email is not confirmed"],
    ["expired", "That sign-in ran out of time"],
    ["state_mismatch", "That sign-in could not be confirmed"],
    ["unavailable", "Passport did not answer"],
    ["not_configured", "Passport sign-in is not set up here"],
    ["something_new", "Passport sign-in did not finish"],
  ])("explains %s and keeps both ways of signing in available", async (code, title) => {
    open(`/signin?passport_error=${code}`, createMockServices({ session: null }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Passport" })).toBeEnabled();
  });

  it("points a person with no organization to Passport to claim one", async () => {
    open("/signin?passport_error=no_organization", createMockServices({ session: null }));
    const link = await screen.findByRole("link", { name: /Claim your organization in Passport/ });
    expect(link).toHaveAttribute("href", "https://app.passport.opengrants.io/claim");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("shows nothing without an error, and every problem has a title and a next step", () => {
    expect(passportProblem(null)).toBeNull();
    for (const code of ["cancelled", "no_organization", "email_unverified", "expired", "state_mismatch", "unavailable", "not_configured"]) {
      const p = passportProblem(code)!;
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.detail).toMatch(/again|below|Start|Claim|Confirm/);
    }
  });
});
