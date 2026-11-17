// SPDX-License-Identifier: AGPL-3.0-only
// "Share this call" on the Publish step, in mock mode: the call is in the open-call feeds with its
// addresses and can be taken out; the OpenGrants feed is described as it is (not imported yet);
// the PND preview shows PND's fields and is exactly what is sent, once. The HTTP port calls the
// documented routes, and a landing from a feed or PND link is remembered for the application start.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpSyndicationApi } from "../src/api/syndication.ts";
import { mockSyndicationStore } from "../src/api/syndicationHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { rememberSocialLanding, socialSourceFor } from "../src/lib/socialLanding.ts";
import { demoSession } from "../src/mocks/auth.ts";

const SLOW = { timeout: 8000 };
const OPP = "opp_50000000-0000-7000-8000-000000000001";

async function axeCheck() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

async function openPanel() {
  const services = createMockServices({ session: demoSession() });
  mockSyndicationStore(services).now = () => new Date("2027-01-10T12:00:00Z");
  render(
    <MemoryRouter initialEntries={[{ pathname: `/w/riverbend/opportunities/${OPP}/edit`, hash: "#publish" }]}>
      <App services={services} />
    </MemoryRouter>,
  );
  const panel = await screen.findByRole("region", { name: "Share this call" }, SLOW);
  await within(panel).findByText("In the open-call feeds", {}, SLOW);
  return { services, panel };
}

afterEach(() => window.sessionStorage.clear());

describe("Share this call", () => {
  it("shows the feeds, the OpenGrants feed and PND's date, and takes the call out of the feeds", { timeout: 60_000 }, async () => {
    const { services, panel } = await openPanel();
    expect(within(panel).getByText(/\/gms\/public\/feeds\/opportunities\.rss\?funder=riverbend$/)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy the RSS feed address" })).toBeInTheDocument();
    expect(within(panel).getByText("In the feed OpenGrants can pull")).toBeInTheDocument();
    expect(panel).toHaveTextContent("OpenGrants does not import calls from the GMS yet.");
    expect(within(panel).getByText(/^Send by .+ for a free listing$/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /How PND takes requests for proposals/ })).toHaveAttribute("href", "https://philanthropynewsdigest.org/rfps");
    expect(panel).toHaveTextContent("No applications started from a feed link yet");
    expect(await axeCheck()).toEqual([]);

    await userEvent.click(within(panel).getByRole("checkbox", { name: /Include this call in the open-call feeds/ }));
    expect(await within(panel).findByText("Left out of the open-call feeds", {}, SLOW)).toBeInTheDocument();
    expect(mockSyndicationStore(services).feedsOff.has(OPP)).toBe(true);
  });

  it("previews PND's fields, sends exactly the preview on the person's click, and only once", { timeout: 60_000 }, async () => {
    const { services, panel } = await openPanel();
    const store = mockSyndicationStore(services);
    await userEvent.click(within(panel).getByRole("button", { name: "Preview the email to PND" }));
    const preview = await within(panel).findByRole("region", { name: "Email to Philanthropy News Digest" }, SLOW);
    expect(preview).toHaveTextContent("pndrfp@candid.org");
    for (const label of ["Program scope", "Grantee qualifications", "Application instructions", "Deadlines", "Full RFP"]) expect(preview).toHaveTextContent(label);
    expect(preview).toHaveTextContent(/utm_source=pnd/);
    expect(store.sent.size).toBe(0);
    expect(await axeCheck()).toEqual([]);

    await userEvent.click(within(preview).getByRole("button", { name: "Send to PND" }));
    expect(await within(panel).findByText("Sent to Philanthropy News Digest", {}, SLOW)).toBeInTheDocument();
    expect(store.sent.size).toBe(1);
    const sent = store.sent.get(OPP)!;
    expect(sent.email.to).toBe("pndrfp@candid.org");
    expect(preview).not.toBeInTheDocument();
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Preview the email to PND" })).toBeNull());
  });
});

describe("the HTTP port", () => {
  it("calls the documented routes", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const api = createHttpSyndicationApi({
      baseUrl: "https://gms.test",
      token: async () => "t",
      workspaceId: () => "w",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ method: init.method!, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await api.get(OPP);
    await api.setFeeds(OPP, false);
    await api.previewPnd(OPP);
    await api.sendPnd(OPP, "a".repeat(64));
    expect(calls).toEqual([
      { method: "GET", url: `https://gms.test/gms/opportunities/${OPP}/syndication`, body: undefined },
      { method: "PUT", url: `https://gms.test/gms/opportunities/${OPP}/syndication/feeds`, body: { feeds: false } },
      { method: "POST", url: `https://gms.test/gms/opportunities/${OPP}/syndication/pnd/preview`, body: {} },
      { method: "POST", url: `https://gms.test/gms/opportunities/${OPP}/syndication/pnd`, body: { digest: "a".repeat(64) } },
    ]);
  });
});

describe("landing from a feed or PND link", () => {
  it("is remembered for that call and sent with the application start", () => {
    rememberSocialLanding("riverbend", "community-health-2027", "?utm_source=feed");
    expect(socialSourceFor("riverbend", "community-health-2027")).toBe("feed");
    rememberSocialLanding("riverbend", "community-health-2027", "?utm_source=pnd");
    expect(socialSourceFor("riverbend", "community-health-2027")).toBe("pnd");
    rememberSocialLanding("riverbend", "other-call", "?utm_source=newsletter");
    expect(socialSourceFor("riverbend", "other-call")).toBeUndefined();
    // A landing remembered before feeds were counted reads as social.
    window.sessionStorage.setItem("gms.socialLanding", JSON.stringify(["riverbend/old-call"]));
    expect(socialSourceFor("riverbend", "old-call")).toBe("social");
  });
});
