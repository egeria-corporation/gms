// SPDX-License-Identifier: AGPL-3.0-only
// Social posting in the web app, against the fake Zernio in mock mode: an admin connects an account
// in Settings › Social accounts (the address Zernio returns to is checked and then cleaned), the
// composer starts from the call, the preview shows exactly the body that is sent, and the post
// appears under Reach. On a server without Zernio every social control is hidden.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

// The machine may be busy: give each screen time to load before a query gives up.
const SLOW = { timeout: 8000 };
import { callbackFrom, createHttpSocialApi, type SocialApi } from "../src/api/social.ts";
import { mockSocialStore, provideSocialApi } from "../src/api/socialHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

const OPP = "opp_50000000-0000-7000-8000-000000000001";

/** Axe on the document as it stands, as in a11y.test.tsx: serious and critical violations only. */
async function axeCheck() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}

describe("social posting", () => {
  it("connects an account, previews the exact post and sends that body once", { timeout: 60_000 }, async () => {
    const services = open("/w/riverbend/settings/social");
    await userEvent.click(await screen.findByRole("button", { name: "Connect LinkedIn" }, SLOW));
    expect(await screen.findByText("LinkedIn account connected", {}, SLOW)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Connected accounts" }, SLOW);
    expect(list).toHaveTextContent("riverbend-foundation");
    expect(await axeCheck()).toEqual([]);
    const store = mockSocialStore(services);
    expect(store.fake.profiles).toEqual([expect.objectContaining({ externalId: expect.any(String), name: "Riverbend Community Foundation" })]);

    // To the call's Publish step through the settings rail.
    await userEvent.click(screen.getAllByRole("link", { name: "Opportunities" })[0]!);
    await userEvent.click((await screen.findAllByRole("link", { name: "Community Health Grants 2027" }, SLOW))[0]!);
    await userEvent.click((await screen.findAllByRole("link", { name: /^Publish$/ }, SLOW))[0]!);
    const panel = await screen.findByRole("region", { name: "Share on social media" }, SLOW);
    await userEvent.click(await within(panel).findByRole("button", { name: "Write a post" }, SLOW));
    const composer = await screen.findByRole("dialog", { name: "Write a post" }, SLOW);
    const text = within(composer).getByRole("textbox", { name: "Post text" });
    expect((text as HTMLTextAreaElement).value).toMatch(/^Applications are open: Community Health Grants 2027, from Riverbend Community Foundation\. Apply by April 30, 2027\.\n\nhttp.*\/f\/riverbend\/o\/community-health-2027\?utm_source=social$/);
    expect(within(composer).getByRole("group", { name: "Length on each platform" })).toHaveTextContent(/LinkedIn \d+ \/ 3,000/);
    await userEvent.click(within(composer).getByRole("radio", { name: "Schedule" }));
    expect(within(composer).getByLabelText("Time zone")).toBeInTheDocument();
    expect(await axeCheck()).toEqual([]);
    await userEvent.click(within(composer).getByRole("radio", { name: "Post now" }));

    await userEvent.click(within(composer).getByRole("button", { name: "Preview" }));
    const check = await screen.findByRole("dialog", { name: "Check the post" }, SLOW);
    const shown = within(check).getByRole("region", { name: "Post text as it will appear" }).textContent;
    expect(check).toHaveTextContent("LinkedIn (riverbend-foundation)");
    expect(check).toHaveTextContent("Now, when you press Post");
    expect(await axeCheck()).toEqual([]);
    expect(store.fake.requests.filter((r) => r.path === "/v1/posts")).toEqual([]);
    await userEvent.click(within(check).getByRole("button", { name: "Post" }));
    await screen.findByRole("dialog", { name: "Posted" }, SLOW);

    const sent = store.fake.requests.filter((r) => r.path === "/v1/posts");
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { content: string }).content).toBe(shown);
    expect(sent[0]!.body).toMatchObject({ publishNow: true, platforms: [{ platform: "linkedin" }], mediaItems: [{ type: "image" }] });
    expect(sent[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    await userEvent.click(within(screen.getByRole("dialog", { name: "Posted" })).getByRole("button", { name: "Close" }));
    const reach = await within(panel).findByRole("list", { name: "Posts" }, SLOW);
    expect(reach).toHaveTextContent("Published");
    expect(within(reach).getByRole("link", { name: "View on LinkedIn" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/linkedin\.example\/posts\//));
  });

  it("hides every social control when the server has no Zernio", { timeout: 30_000 }, async () => {
    const services = createMockServices({ session: demoSession() });
    const off: SocialApi = { ...createHttpSocialApi({ baseUrl: "http://x.invalid", token: async () => null, workspaceId: () => null }), settings: async () => null };
    provideSocialApi(services, off);
    open(`/w/riverbend/opportunities/${OPP}/edit#publish`, services);
    expect(await screen.findByRole("region", { name: "Embed on your website" }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Share on social media" })).toBeNull());
  });

  it("reads Zernio's return address, and nothing else", () => {
    expect(callbackFrom("?gs=v1.abc.def&connected=linkedin&profileId=prof_1&accountId=acc_1&username=x&request_id=r&stage=complete")).toEqual({ state: "v1.abc.def", profileId: "prof_1", accountId: "acc_1", connected: "linkedin", username: "x" });
    expect(callbackFrom("?connected=linkedin")).toBeNull();
  });
});
