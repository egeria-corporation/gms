// SPDX-License-Identifier: AGPL-3.0-only
// The award kit, plus (v1.12.0), in the web app against the mock: the funder marks an award
// federally funded and the statement appears only with both numbers; the kit offers the portrait
// card, the carousel with each slide's alt text, the press release and the page to tag; the
// share-kit settings take a page and consent; "Meet our grantees" lists the program's public
// awards; a call's "Two weeks left" prompt opens the composer on the reminder and can be dismissed.
// Nothing is posted without the click on Post.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockAwardSharingStore } from "../src/api/awardSharingHooks.ts";
import { mockSocialStore } from "../src/api/socialHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";

const SLOW = { timeout: 8000 };
const HOUSING = "opp_50000000-0000-7000-8000-000000000002";

async function axeCheck() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

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
const listing = (services: Services) => (mockAwardSharingStore(services).settings.riverbend = { listAwards: true, showAmounts: true });
const panel = () => screen.findByRole("region", { name: "Share this award" }, SLOW);

describe("the federal share", () => {
  it("adds the statement only once both numbers are entered", { timeout: 60_000 }, async () => {
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, listing);
    const share = await panel();
    const form = await within(share).findByRole("form", { name: "Federal funding" }, SLOW);
    await userEvent.click(within(form).getByRole("checkbox", { name: "This award is paid in whole or in part with federal money" }));
    await userEvent.type(within(form).getByRole("textbox", { name: "Federal amount (USD)" }), "80,000");
    await userEvent.click(within(form).getByRole("button", { name: "Save federal funding" }));
    expect(await within(share).findByText("Enter both the federal amount and the percentage to add the statement to the share kit.", {}, SLOW)).toBeInTheDocument();
    expect(within(share).queryByRole("textbox", { name: "Statement of the federal share" })).toBeNull();

    await userEvent.type(within(form).getByRole("spinbutton", { name: "Federal share of the project’s total costs (%)" }), "62.5");
    await userEvent.click(within(form).getByRole("button", { name: "Save federal funding" }));
    const statement = await within(share).findByRole("textbox", { name: "Statement of the federal share" }, SLOW);
    expect((statement as HTMLTextAreaElement).value).toBe("This project is supported with federal funds as part of a financial assistance award totaling $80,000, with 62.5 percent of the project's total costs funded with federal money. The contents are those of the authors and do not necessarily represent the official views of, nor an endorsement by, the U.S. Government.");
    expect((within(share).getByRole("textbox", { name: "Press release" }) as HTMLTextAreaElement).value).toContain("totaling $80,000, with 62.5 percent");
    expect(await axeCheck()).toEqual([]);
  });
});

describe("the kit's extras", () => {
  it("offers the portrait card, the carousel with alt text, the press release and the page to tag", { timeout: 60_000 }, async () => {
    const services = open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, (s) => {
      listing(s);
      mockAwardSharingStore(s).profiles["alder-creek"] = { pageUrl: "https://www.linkedin.com/company/alder-creek-family-services", tagConsent: true, consentedAt: "2027-05-19T16:00:00.000Z", creditWording: "funded_by", standardDescription: null };
    });
    const share = await panel();
    expect(await within(share).findByRole("button", { name: "Download the portrait card" }, SLOW)).toBeEnabled();
    const amount = within(share).getByRole("checkbox", { name: "Show the amount on the card" });
    expect(amount).not.toBeChecked();
    expect(within(share).getByText("7 slides of 1080 × 1350, for a LinkedIn document post. Add each slide’s alt text where you post it.")).toBeInTheDocument();
    const alts = within(share).getByRole("list", { name: "Alt text for each slide" });
    expect(within(alts).getAllByRole("listitem")).toHaveLength(7);
    expect(within(alts).getAllByRole("listitem")[0]).toHaveTextContent("Slide 1 of 7: Riverbend Community Foundation awarded Alder Creek Family Services a grant. Mobile Health Navigation for Rural Families");
    const press = within(share).getByRole("textbox", { name: "Press release" }) as HTMLTextAreaElement;
    expect(press.value).toMatch(/^Riverbend Community Foundation awards a grant to Alder Creek Family Services\n\nFOR IMMEDIATE RELEASE\n\n/);
    expect(press.value).toContain("The project is funded by Riverbend Community Foundation.");
    expect(press.value).not.toMatch(/sponsor/i);
    expect(within(share).getByText("Alder Creek Family Services: @alder-creek-family-services on LinkedIn")).toBeInTheDocument();
    expect(await axeCheck()).toEqual([]);
    expect(mockAwardSharingStore(services).awards[0]!.federal.funded).toBe(false);
  });
});

describe("share-kit settings", () => {
  it("takes the page and consent from an admin, and the funder's credit wording", { timeout: 60_000 }, async () => {
    const services = open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, listing);
    const share = await panel();
    await userEvent.click(await within(share).findByRole("button", { name: "Share-kit settings" }, SLOW));
    const dialog = await screen.findByRole("dialog", { name: "Share-kit settings" }, SLOW);
    const page = await within(dialog).findByRole("textbox", { name: "Your organization’s social page (optional)" }, SLOW);
    await userEvent.type(page, "https://example.org/riverbend");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Grantees may tag this page when they post about our grants" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save settings" }));
    expect(await within(dialog).findByText("The settings were not saved.", {}, SLOW)).toBeInTheDocument();
    await userEvent.clear(page);
    await userEvent.type(page, "https://x.com/riverbendcf");
    await userEvent.click(within(dialog).getByRole("radio", { name: "“Supported by”" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save settings" }));
    expect(await within(dialog).findByText("Others may tag @riverbendcf on X.", {}, SLOW)).toBeInTheDocument();
    expect(await axeCheck()).toEqual([]);
    expect(mockAwardSharingStore(services).profiles.riverbend).toMatchObject({ pageUrl: "https://x.com/riverbendcf", tagConsent: true, creditWording: "supported_by" });
  });
});

describe("social posting, plus", () => {
  async function connectLinkedIn() {
    await userEvent.click(await screen.findByRole("button", { name: "Connect LinkedIn" }, SLOW));
    expect(await screen.findByText("LinkedIn account connected", {}, SLOW)).toBeInTheDocument();
  }

  it("opens the composer on a call's reminder, posts nothing by itself, and dismisses it", { timeout: 60_000 }, async () => {
    const services = open("/w/riverbend/settings/social");
    await connectLinkedIn();
    await userEvent.click(screen.getAllByRole("link", { name: "Opportunities" })[0]!);
    await userEvent.click((await screen.findAllByRole("link", { name: "Housing Stability Grants 2027" }, SLOW))[0]!);
    await userEvent.click((await screen.findAllByRole("link", { name: /^Publish$/ }, SLOW))[0]!);
    const social = await screen.findByRole("region", { name: "Share on social media" }, SLOW);
    const reminder = await within(social).findByRole("group", { name: "Two weeks left" }, SLOW);
    expect(reminder).toHaveTextContent("Applications close May 27, 2027. Post a reminder?");
    await userEvent.click(within(reminder).getByRole("button", { name: "Post a reminder" }));
    const composer = await screen.findByRole("dialog", { name: "Write a post" }, SLOW);
    expect((within(composer).getByRole("textbox", { name: "Post text" }) as HTMLTextAreaElement).value).toMatch(/^Two weeks left to apply: Housing Stability Grants 2027, from Riverbend Community Foundation\. Apply by May 27, 2027\.\n\nhttp.*\/f\/riverbend\/o\/housing-stability-2027\?utm_source=social$/);
    expect(await axeCheck()).toEqual([]);
    await userEvent.click(within(composer).getByRole("button", { name: "Cancel" }));
    expect(mockSocialStore(services).fake.requests.filter((r) => r.path === "/v1/posts")).toEqual([]);

    await userEvent.click(within(reminder).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(within(social).queryByRole("group", { name: "Two weeks left" })).toBeNull());
    expect(mockSocialStore(services).reminders[0]!.dismissed).toBe(true);
  });

  it("introduces the program's public grantees, and only the ones kept", { timeout: 60_000 }, async () => {
    open("/w/riverbend/settings/social", listing);
    await connectLinkedIn();
    // The rail's Awards opens the award screen.
    await userEvent.click(screen.getAllByRole("link", { name: "Awards" })[0]!);
    const social = await screen.findByRole("region", { name: "Share on social media" }, SLOW);
    await userEvent.click(await within(social).findByRole("button", { name: "Meet our grantees" }, SLOW));
    const composer = await screen.findByRole("dialog", { name: "Write a post" }, SLOW);
    const text = within(composer).getByRole("textbox", { name: "Post text" }) as HTMLTextAreaElement;
    expect(text.value).toMatch(/^Meet the grantees of our Community Health 2027 program\.\n\nAlder Creek Family Services: Mobile Health Navigation for Rural Families\n\nSee every grant we have awarded: http.*\/f\/riverbend\/awards\?utm_source=social$/);
    const kept = within(composer).getByRole("checkbox", { name: "Alder Creek Family Services" });
    expect(kept).toBeChecked();
    await userEvent.click(kept);
    expect(text.value).not.toContain("Alder Creek");
    expect(await axeCheck()).toEqual([]);
  });
});
