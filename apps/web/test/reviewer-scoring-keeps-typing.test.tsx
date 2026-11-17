// SPDX-License-Identifier: AGPL-3.0-only
// A reviewer's typing survives the assignment arriving again. The scoring screen fills its form
// from the saved review; it used to fill the whole form whenever the assignment arrived, so a
// load that landed after the first keystroke threw that score away (seen on CI as "2 of 4 scored"
// after three scores were typed). Now the saved review fills only what the reviewer has not changed.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";

function app(services: Services) {
  return (
    <MemoryRouter initialEntries={[`/review/score/${MOCK_IDS.danaScoring}`]}>
      <App services={services} />
    </MemoryRouter>
  );
}

describe("scoring a review", () => {
  it("keeps the scores and words the reviewer typed when the assignment arrives again", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    const view = render(app(services));
    expect(await screen.findByRole("heading", { level: 1, name: "Shelter Health Liaison" })).toBeInTheDocument();
    const card = screen.getByRole("complementary", { name: "Score card" });
    const score = (label: RegExp) => within(card).getByRole("spinbutton", { name: label });
    fireEvent.change(score(/Community impact/), { target: { value: "5" } });
    fireEvent.change(score(/Feasibility/), { target: { value: "4" } });
    expect(within(card).getByText("2 of 4 scored")).toBeInTheDocument();

    // The same data service under a new identity: every query loads again, the assignment included.
    view.rerender(app({ ...services, api: { ...services.api } }));
    expect(await screen.findByRole("heading", { level: 1, name: "Shelter Health Liaison" })).toBeInTheDocument();
    const again = screen.getByRole("complementary", { name: "Score card" });
    expect(within(again).getByRole("spinbutton", { name: /Community impact/ })).toHaveValue(5);
    expect(within(again).getByRole("spinbutton", { name: /Feasibility/ })).toHaveValue(4);
    expect(within(again).getByText("2 of 4 scored")).toBeInTheDocument();
  });
});
