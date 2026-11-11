// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport, in the web app: the button really leaves for Passport, the return page
// redeems the one-time sign-in, and every way the trip can fail has a banner with a next step.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { MOCK_PASSPORT_TOKEN, RETURN_TO, beginPassportHop, endPassportHop, passportBrowser, passportProblem, passportSignInUrl, safeNext } from "../src/lib/passportSignIn.ts";
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

/** The value this tab stored when the trip to Passport started. */
const HOP_KEY = "gms.passport.hop";
const HOP = "h".repeat(43);
const startedHere = () => window.sessionStorage.setItem(HOP_KEY, HOP);

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Continue with Passport", () => {
  it("on the sign-in page, leaves for the API's start route with the destination, and shows it is working", async () => {
    const go = vi.spyOn(passportBrowser, "go").mockImplementation(() => undefined);
    open("/signin?next=%2Fw%2Falder-creek%2Fapplications", live());
    const button = await screen.findByRole("button", { name: "Continue with Passport" });
    await userEvent.click(button);
    const hop = window.sessionStorage.getItem(HOP_KEY)!;
    expect(hop).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(go).toHaveBeenCalledExactlyOnceWith(`http://api.test/gms/passport/signin/start?hop=${hop}&returnTo=%2Fw%2Falder-creek%2Fapplications`);
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
    expect(go).toHaveBeenCalledExactlyOnceWith(`http://api.test/gms/passport/signin/start?hop=${window.sessionStorage.getItem(HOP_KEY)}`);
  });

  it("makes a new value for every trip, and uses it up on return", () => {
    const first = beginPassportHop()!;
    const second = beginPassportHop()!;
    expect(second).not.toBe(first);
    expect(endPassportHop(first)).toBe(false);
    // The stored value was used up by that attempt: even the right one no longer matches.
    expect(endPassportHop(second)).toBe(false);
    const third = beginPassportHop()!;
    expect(endPassportHop(third)).toBe(true);
    expect(window.sessionStorage.getItem(HOP_KEY)).toBeNull();
    expect(endPassportHop(null)).toBe(false);
  });

  it("never sends an off-site destination", () => {
    expect(passportSignInUrl("//evil.example", false, HOP)).toBe(`http://api.test/gms/passport/signin/start?hop=${HOP}`);
    expect(passportSignInUrl("https://evil.example", false, HOP)).toBe(`http://api.test/gms/passport/signin/start?hop=${HOP}`);
    expect(safeNext("/w/alder-creek")).toBe("/w/alder-creek");
    // The app carries "which opportunity" through sign-in as a query string.
    expect(safeNext("/onboarding/applicant?funder=riverbend&opportunity=community-health-2027")).toBe("/onboarding/applicant?funder=riverbend&opportunity=community-health-2027");
    // Everything a browser could read as another site, including the tab and newline that
    // browsers strip before resolving a URL.
    for (const bad of ["/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "//evil.example", "/a//b", "/\u0000x", "/w/x?y=1#z", "/w/x?y=<script>", "/w/x?a b", "/a//b?x=1", "/w/x#y", "javascript:alert(1)", "/w/ x", "w/x", ""]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("uses the same destination allow-list as the API", () => {
    const api = readFileSync(join(import.meta.dirname, "../../api/src/services/passport-signin.ts"), "utf8");
    const literal = /export const RETURN_TO = \/(.+)\/;/.exec(api)?.[1];
    expect(literal).toBe(RETURN_TO.source);
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
    startedHere();
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&hop=${HOP}&next=%2Fw%2Fcascade-county`, services);
    expect(await screen.findByRole("navigation", { name: "Funder workspace" })).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledExactlyOnceWith(MOCK_PASSPORT_TOKEN, "magiclink");
    await waitFor(() => expect(where()).toBe("/w/cascade-county"));
  });

  it("ignores an off-site destination in the fragment", async () => {
    startedHere();
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&hop=${HOP}&next=%2F%2Fevil.example`, createMockServices({ session: null, totpEnrolled: true }));
    expect(await screen.findByRole("heading", { name: "Two-Step Verification" })).toBeInTheDocument();
    expect(where()).not.toContain("evil.example");
  });

  it("says the sign-in ran out when the token is not accepted, and signs nobody in", async () => {
    const services = createMockServices({ session: null });
    startedHere();
    open(`/auth/passport#token_hash=used-already&type=magiclink&hop=${HOP}`, services);
    expect(await screen.findByText("That sign-in ran out of time")).toBeInTheDocument();
    expect(where()).toBe("/signin?passport_error=expired");
    expect(await services.auth.getSession()).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Passport" })).toBeEnabled();
  });

  it("refuses a sign-in this tab did not ask for: a link carrying someone else's token signs nobody in", async () => {
    // No trip started here (a link sent by someone else), then one started here with another value.
    for (const prepare of [() => undefined, () => window.sessionStorage.setItem(HOP_KEY, "x".repeat(43))]) {
      prepare();
      const services = createMockServices({ session: null });
      const redeem = vi.spyOn(services.auth, "redeemSignIn");
      const view = open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&hop=${HOP}`, services);
      expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in could not be confirmed");
      expect(where()).toBe("/signin?passport_error=state_mismatch");
      expect(redeem).not.toHaveBeenCalled();
      expect(await services.auth.getSession()).toBeNull();
      // The stored value is used up, so the same address cannot be tried again.
      expect(window.sessionStorage.getItem(HOP_KEY)).toBeNull();
      view.unmount();
    }
  });

  it("refuses a return with no binding value at all", async () => {
    startedHere();
    const services = createMockServices({ session: null });
    const redeem = vi.spyOn(services.auth, "redeemSignIn");
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink`, services);
    expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in could not be confirmed");
    expect(redeem).not.toHaveBeenCalled();
  });

  it("never switches a signed-in tab to another account: the token is not redeemed", async () => {
    startedHere();
    const services = createMockServices({ totpEnrolled: true });
    const before = await services.auth.getSession();
    expect(before).not.toBeNull();
    const redeem = vi.spyOn(services.auth, "redeemSignIn");
    open(`/auth/passport#token_hash=${MOCK_PASSPORT_TOKEN}&type=magiclink&hop=${HOP}&next=%2Fw%2Fcascade-county`, services);
    await waitFor(() => expect(where()).not.toContain("/auth/passport"));
    expect(redeem).not.toHaveBeenCalled();
    expect(await services.auth.getSession()).toEqual(before);
    expect(where()).not.toContain(MOCK_PASSPORT_TOKEN);
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
    ["account_mismatch", "This email is linked to a different Passport account"],
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
    for (const code of ["cancelled", "no_organization", "email_unverified", "expired", "state_mismatch", "unavailable", "not_configured", "account_mismatch"]) {
      const p = passportProblem(code)!;
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.detail).toMatch(/again|below|Start|Claim|Confirm/);
    }
  });
});
