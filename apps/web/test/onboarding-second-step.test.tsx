// SPDX-License-Identifier: AGPL-3.0-only
// A new funder admin signs in with an email code only (no workspace yet, so no second step). The
// workspace they create makes them an admin, whose saves the API refuses until they verify with an
// authenticator app. Funder setup must take them through that step, not stop at a refused save.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { ApiError } from "../src/api/client.ts";
import { needsSecondStep, SecondStepNotice } from "../src/components/SecondStep.tsx";
import { demoSession, MOCK_CODE } from "../src/mocks/auth.ts";

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

describe("funder setup and the second step of sign-in", () => {
  it("takes a new funder admin through the second step right after the workspace is created, then back to the brand step", async () => {
    open("/onboarding/funder/organization", createMockServices({ session: demoSession("aal1"), memberships: [], totpEnrolled: true }));
    await userEvent.type(await screen.findByLabelText(/Organization name/), "Maple Street Fund");
    await userEvent.click(screen.getByRole("button", { name: /Continue to Brand/ }));
    expect(await screen.findByRole("heading", { name: "Two-Step Verification" })).toBeInTheDocument();
    expect(where()).toContain("step=mfa");
    expect(where()).toContain(encodeURIComponent("/onboarding/funder/brand"));
    await userEvent.type(screen.getByLabelText("Enter the 6-digit code from your app"), MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(where()).toBe("/onboarding/funder/brand"));
    expect(screen.queryByText("This role requires two-step verification", { exact: false })).toBeNull();
  });

  it("shows the second step when a page asks for it, even before the membership list has caught up", async () => {
    open(`/signin?next=${encodeURIComponent("/onboarding/funder/brand")}&step=mfa`, createMockServices({ session: demoSession("aal1"), memberships: [], totpEnrolled: true }));
    expect(await screen.findByRole("heading", { name: "Two-Step Verification" })).toBeInTheDocument();
  });

  it("does not hold back someone who already did the second step", async () => {
    open(`/signin?next=${encodeURIComponent("/onboarding/funder/brand")}&step=mfa`, createMockServices({ session: demoSession("aal2"), memberships: [] }));
    await waitFor(() => expect(where()).toBe("/onboarding/funder/brand"));
  });
});

describe("the notice that replaces a refused save", () => {
  it("recognises the API's refusal and links to the second step, coming back to the same page", () => {
    expect(needsSecondStep(new ApiError(403, "This role requires two-step verification.", [{ code: "mfa_required" }]))).toBe(true);
    expect(needsSecondStep(new ApiError(403, "Forbidden", [{ code: "insufficient_scope" }]))).toBe(false);
    expect(needsSecondStep(new Error("network"))).toBe(false);
    render(
      <MemoryRouter>
        <SecondStepNotice next="/onboarding/funder/brand" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Set up two-step verification to continue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set it up now" })).toHaveAttribute("href", `/signin?next=${encodeURIComponent("/onboarding/funder/brand")}&step=mfa`);
  });
});
