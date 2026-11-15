// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing screens against the mock (v1.8.0): the funder turns on listing in Settings › Public
// page, the grants-awarded page and the award page show the award, the "Share this award" panel on
// both sides says why an award is not public and offers the kit once it is, the funder can keep an
// award confidential, the grantee can opt out, and amounts can be hidden.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockAwardSharingStore } from "../src/api/awardSharingHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";

const GRANTEE_AWARD = "awd_a0000000-0000-7000-8000-000000000001";

function open(path: string, setup?: (services: Services) => void) {
  const services = createMockServices({ session: demoSession() });
  setup?.(services);
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}
const listing = (services: Services, on = true, showAmounts = true) => (mockAwardSharingStore(services).settings.riverbend = { listAwards: on, showAmounts });
const panel = () => screen.findByRole("region", { name: "Share this award" });

describe("Settings › Public page › Grants awarded", () => {
  it("is off until the funder turns it on, and then links to the page", async () => {
    const services = open("/w/riverbend/settings/public-page");
    const card = await screen.findByRole("region", { name: "Grants awarded" });
    const toggle = await within(card).findByRole("switch", { name: "List awards on my public page" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(within(card).getByText(/0 listed · 0 confidential/)).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(mockAwardSharingStore(services).settings.riverbend!.listAwards).toBe(true);
    expect(within(card).getByText(/1 listed/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open your grants-awarded page" })).toHaveAttribute("href", "/f/riverbend/awards");
    // A program's default for new awards.
    const program = within(card).getByRole("switch", { name: "Community Health 2027" });
    await userEvent.click(program);
    await waitFor(() => expect(program).toHaveAttribute("aria-checked", "true"));
  });
});

describe("the public pages", () => {
  it("are not found while the funder does not list awards", async () => {
    open("/f/riverbend/awards");
    expect(await screen.findByRole("heading", { name: /not found|could not find/i })).toBeInTheDocument();
  });

  it("list the award by year and program, and open its page", async () => {
    open("/f/riverbend/awards", (s) => listing(s));
    expect(await screen.findByRole("heading", { level: 1, name: "Grants awarded by Riverbend Community Foundation" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Grants awarded in 2027, Community Health 2027" });
    expect(within(table).getByText("Alder Creek Family Services")).toBeInTheDocument();
    expect(within(table).getByText("$150,000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Community Health 2027" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "2027" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "The grant to Alder Creek Family Services" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation awarded Alder Creek Family Services a grant" })).toBeInTheDocument();
    expect(screen.getByText("Verified with OpenGrants Passport")).toBeInTheDocument();
    expect(screen.getByText("$150,000")).toBeInTheDocument();
  });

  it("leave the amount out when the funder hides amounts", async () => {
    open("/f/riverbend/awards", (s) => listing(s, true, false));
    await screen.findByRole("heading", { level: 1, name: "Grants awarded by Riverbend Community Foundation" });
    expect(screen.queryByRole("columnheader", { name: "Amount" })).toBeNull();
    expect(document.body.textContent).not.toContain("150,000");
  });

  it("never show a confidential award", async () => {
    open("/f/riverbend/awards", (s) => {
      listing(s);
      mockAwardSharingStore(s).awards[0]!.confidential = true;
    });
    expect(await screen.findByRole("heading", { name: "No grants listed yet" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Alder Creek");
  });
});

describe("Share this award", () => {
  it("tells the funder why the award is not public and where to turn listing on", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`);
    const p = await panel();
    expect(await within(p).findByText("Not public")).toBeInTheDocument();
    expect(within(p).getByText(/Your public page does not list awards/)).toBeInTheDocument();
    expect(within(p).getByRole("link", { name: "Open Settings › Public page" })).toHaveAttribute("href", "/w/riverbend/settings/public-page");
    expect(within(p).queryByRole("textbox", { name: "LinkedIn post" })).toBeNull();
  });

  it("gives the funder the kit once listed, and takes it away when the award is made confidential", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, (s) => listing(s));
    const p = await panel();
    expect(await within(p).findByText("Listed publicly")).toBeInTheDocument();
    const post = within(p).getByRole("textbox", { name: "LinkedIn post" });
    expect((post as HTMLTextAreaElement).value).toContain("We are proud to support Alder Creek Family Services with a $150,000 grant through our Community Health 2027 program.");
    // Ready to edit: the copy button copies what is in the box.
    await userEvent.type(post, " Thank you all.");
    expect((post as HTMLTextAreaElement).value).toMatch(/Thank you all\.$/);
    expect(within(p).getByRole("button", { name: "Copy the LinkedIn post" })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Copy the short post" })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Copy the newsletter paragraph" })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Copy the award page link" })).toBeInTheDocument();
    expect(within(p).getByRole("link", { name: "Download the card image" })).toHaveAttribute("href", expect.stringMatching(/\/og\/f\/riverbend\/awards\/alder-creek-family-services-[a-z0-9]{12}\.png$/));
    expect((within(p).getByRole("textbox", { name: "Badge code" }) as HTMLTextAreaElement).value).toMatch(/^<a href="[^"]+\/f\/riverbend\/awards\/[^"]+"><img src="[^"]+\/badge\/[^"]+\.svg" alt="Funded by Riverbend Community Foundation, verified"/);
    expect(within(p).getByRole("img", { name: "Funded by Riverbend Community Foundation · verified" }).getAttribute("src")).toMatch(/^data:image\/svg\+xml/);

    await userEvent.click(within(p).getByRole("switch", { name: "Keep this award confidential" }));
    expect(await within(p).findByText("This award is confidential, so it is never shown publicly.")).toBeInTheDocument();
    expect(within(p).getByText("Not public")).toBeInTheDocument();
    expect(within(p).queryByRole("textbox", { name: "LinkedIn post" })).toBeNull();
  });

  it("lets the grantee copy its kit and opt out of the funder's page", async () => {
    const services = open(`/w/alder-creek/grants/${GRANTEE_AWARD}`, (s) => listing(s));
    const p = await panel();
    const post = await within(p).findByRole("textbox", { name: "Short post" });
    expect((post as HTMLTextAreaElement).value).toMatch(/^Thank you, Riverbend Community Foundation, for a \$150,000 grant for “Mobile Health Navigation for Rural Families”\./);
    await userEvent.click(within(p).getByRole("switch", { name: "Don’t list us publicly" }));
    expect(await within(p).findByText("You chose not to be listed publicly.")).toBeInTheDocument();
    expect(mockAwardSharingStore(services).awards[0]!.recipientUnlisted).toBe(true);
  });
});

/** As test/a11y.test.tsx: serious and critical WCAG 2.2 AA violations, colour contrast left to the theme's own checks. */
async function violations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

describe("axe: no serious or critical violations", () => {
  it.each([
    ["/f/riverbend/awards", "Grants awarded by Riverbend Community Foundation"],
    ["/f/riverbend/awards/alder-creek-family-services-7k2m9x4qp1ad", "Riverbend Community Foundation awarded Alder Creek Family Services a grant"],
  ])("%s", async (path, heading) => {
    open(path, (s) => listing(s));
    await screen.findByRole("heading", { level: 1, name: heading });
    expect(await violations()).toEqual([]);
  });
  it("the share panels and the settings card", async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, (s) => listing(s));
    await within(await panel()).findByRole("textbox", { name: "LinkedIn post" });
    expect(await violations()).toEqual([]);
  });
  it("the grantee's panel", async () => {
    open(`/w/alder-creek/grants/${GRANTEE_AWARD}`, (s) => listing(s));
    await within(await panel()).findByRole("textbox", { name: "LinkedIn post" });
    expect(await violations()).toEqual([]);
  });
  it("Settings › Public page", async () => {
    open("/w/riverbend/settings/public-page");
    await within(await screen.findByRole("region", { name: "Grants awarded" })).findByRole("switch", { name: "List awards on my public page" });
    expect(await violations()).toEqual([]);
  });
});
