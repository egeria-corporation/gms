// SPDX-License-Identifier: AGPL-3.0-only
// Open data on the Reporting screen: the panel in mock mode (counts, reasons, the confidential mark,
// the prefix and the public feed switch). openData-contract.test.ts runs the HTTP client against
// the real API.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

async function riverbend(): Promise<Services> {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  return services;
}
const panel = async () => within((await screen.findByRole("heading", { name: "Open data" })).closest("section")!);
const stat = (p: ReturnType<typeof within>, label: string) => p.getByText(label, { selector: ".stat-l" }).parentElement!.querySelector(".stat-v")!.textContent;

describe("open data panel (mock mode)", () => {
  it("counts what will be exported and says why the rest is left out", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend/reporting"]}>
        <App services={await riverbend()} />
      </MemoryRouter>,
    );
    const p = await panel();
    await waitFor(() => expect(stat(p, "Will be exported")).toBe("5"));
    expect(stat(p, "Left out")).toBe("5");
    expect(stat(p, "Named only")).toBe("2");
    expect(p.getByText("Marked confidential: 1")).toBeInTheDocument();
    expect(p.getByText("Awarded to an individual: 1")).toBeInTheDocument();
    // Without a prefix the files are drafts, and the panel says how to register.
    expect(p.getByText("These files are drafts")).toBeInTheDocument();
    expect(p.getByRole("link", { name: /How to register as a 360Giving publisher/ })).toHaveAttribute("href", "https://www.360giving.org/publish/guidance/plan/register/");

    const user = userEvent.setup();
    await user.selectOptions(p.getByLabelText("Period"), "2027");
    await waitFor(() => expect(stat(p, "Will be exported")).toBe("4"));
    expect(p.getByText("of 8 awards in the period")).toBeInTheDocument();

    // Keeping an award confidential leaves it out.
    await user.click(p.getByText(/Awards in this period/));
    await user.click(p.getByRole("checkbox", { name: "Keep Food pantry shelving confidential" }));
    await waitFor(() => expect(stat(p, "Will be exported")).toBe("3"));
    expect(p.getByText("Marked confidential: 2")).toBeInTheDocument();
  });

  it("publishes the feed only after a prefix is saved, and then shows its address", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend/reporting"]}>
        <App services={await riverbend()} />
      </MemoryRouter>,
    );
    const p = await panel();
    const toggle = await p.findByRole("switch", { name: "Publish my awards as open data" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeDisabled();
    expect(p.queryByLabelText("Public feed address")).toBeNull();
    const user = userEvent.setup();
    await user.type(p.getByLabelText("360Giving publisher prefix"), "riverbend");
    await user.click(p.getByRole("button", { name: "Save prefix" }));
    expect(await p.findByText(/A 360Giving prefix starts with 360G-/)).toBeInTheDocument();
    await user.clear(p.getByLabelText("360Giving publisher prefix"));
    await user.type(p.getByLabelText("360Giving publisher prefix"), "360G-riverbend");
    await user.click(p.getByRole("button", { name: "Save prefix" }));
    await waitFor(() => expect(p.queryByText("These files are drafts")).toBeNull());
    await waitFor(() => expect(p.getByRole("switch", { name: "Publish my awards as open data" })).toBeEnabled());
    await user.click(p.getByRole("switch", { name: "Publish my awards as open data" }));
    await waitFor(() => expect(p.getByLabelText("Public feed address")).toHaveValue("https://gms.opengrants.io/gms/open-data/riverbend/360giving.json"));
    expect(p.getByRole("switch", { name: "Publish my awards as open data" })).toHaveAttribute("aria-checked", "true");
  });
});
