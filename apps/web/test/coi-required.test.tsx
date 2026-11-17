// SPDX-License-Identifier: AGPL-3.0-only
// The conflict-of-interest policy's on/off switch (v1.8.0 integration) in mock mode: new competitions
// require reviewers to sign; turning it off shows "Signing is off" (icon and label) and the reviewer's
// assignments open without a signature. review-parity-contract.test.ts holds the client to the API.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { IDS } from "../src/mocks/store.ts";

describe("the conflict-of-interest policy switch (mock mode)", () => {
  it("is on for a new competition, and a program officer can turn it off and on", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    render(
      <MemoryRouter initialEntries={["/w/riverbend/reviews/assign"]}>
        <App services={services} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Conflict-of-interest policy/ }, { timeout: 5000 }));
    const dialog = within(await screen.findByRole("dialog", { name: "Conflict-of-interest policy" }));
    const toggle = await dialog.findByRole("checkbox", { name: /Reviewers sign this policy before applications open for them/ });
    expect(toggle).toBeChecked();
    expect(dialog.getByText("Reviewers sign it")).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(dialog.getByText("Signing is off")).toBeInTheDocument());
    expect(dialog.getByRole("checkbox", { name: /Reviewers sign this policy/ })).not.toBeChecked();
    expect(dialog.getByText("Reviewers in this competition are not asked to sign.")).toBeInTheDocument();
    expect((await services.api.getCoiPolicy(IDS.compHealth27)).required).toBe(false);

    await user.click(dialog.getByRole("checkbox", { name: /Reviewers sign this policy/ }));
    await waitFor(() => expect(dialog.getByText("Reviewers sign it")).toBeInTheDocument());
    expect((await services.api.getCoiPolicy(IDS.compHealth27)).required).toBe(true);
  });
});
