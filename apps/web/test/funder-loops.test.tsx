// SPDX-License-Identifier: AGPL-3.0-only
// E4 in mock mode: the for-funders page (the count from ten, never a name), the peer invitation
// (preview equals sent, once per address), a new funder counted for the invitation it came from,
// the partner settings, the co-branded page and the directory, and the applicant's profile panel,
// each with no serious accessibility problems.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockLoopsStore } from "../src/api/loopsHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_PACKAGE_TOKENS } from "../src/mocks/loops.ts";
import { FUNDER_SETUP_RESUME_KEY } from "../src/screens/public/loopsParts.tsx";

function open(path: string, services = createMockServices({ session: demoSession() })) {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...utils, services, store: mockLoopsStore(services) };
}

async function seriousViolations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}
const settled = () => waitFor(() => expect(document.querySelector(".loading, [aria-busy=true]")).toBeNull());

afterEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // jsdom always has storage.
  }
});

describe("for funders", () => {
  it("names the applicant's region and how many organizations there keep their applications here", async () => {
    open(`/for-funders?ref=${MOCK_PACKAGE_TOKENS.oregon}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Receive applications here, free" })).toBeInTheDocument();
    expect(await screen.findByText("14 organizations in Oregon already keep their applications here.")).toBeInTheDocument();
    await settled();
    expect(await seriousViolations()).toEqual([]);
  });

  it("gives no number below ten", async () => {
    open(`/for-funders?ref=${MOCK_PACKAGE_TOKENS.montana}`);
    expect(await screen.findByText("Organizations in Montana keep their applications here, and can send them to you complete.")).toBeInTheDocument();
    expect(screen.queryByText(/\b6\b/)).not.toBeInTheDocument();
  });
});

describe("inviting a peer funder", () => {
  it("previews exactly what is sent and sends it once", async () => {
    const user = userEvent.setup();
    const { store } = open("/w/riverbend/settings/invite-funders");
    await user.type(await screen.findByLabelText(/Their email address/), "peer@northwind.example");
    await user.type(screen.getByLabelText(/A note from you/), "We moved our whole cycle here.");
    await user.click(screen.getByRole("button", { name: "Preview the email" }));
    const dialog = await screen.findByRole("dialog", { name: "Check the invitation" });
    expect(dialog).toHaveTextContent("This is exactly the email that is sent.");
    expect(dialog).toHaveTextContent("We moved our whole cycle here.");
    expect(dialog).toHaveTextContent("no reminders follow");
    expect(await seriousViolations()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Invitation sent to p…@northwind.example")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Invitations sent" });
    expect(within(table).getByText("p…@northwind.example")).toBeInTheDocument();
    expect(within(table).getByText("Sent", { selector: ".bdg" })).toBeInTheDocument();
    // The same address again is refused: one email per address, no reminders.
    await user.type(screen.getByLabelText(/Their email address/), "peer@northwind.example");
    await user.click(screen.getByRole("button", { name: "Preview the email" }));
    const again = await screen.findByRole("dialog", { name: "Check the invitation" });
    expect(again).toHaveTextContent("This workspace already invited this address.");
    expect(within(again).getByRole("button", { name: "Send invitation" })).toBeDisabled();
    expect(Object.values(store.invitations).flat()).toHaveLength(1);
  }, 30_000);

  it("counts a new funder workspace made from the invitation's link", async () => {
    const user = userEvent.setup();
    const services = createMockServices({ session: demoSession("aal1", "sam@newcomer.example") });
    const store = mockLoopsStore(services);
    store.invitations["20000000-0000-7000-8000-000000000001"] = [{ id: "i1", to: "s…@newcomer.example", status: "sent", sentAt: "2026-11-16T10:00:00Z", joinedCount: 0, firstJoinedAt: null, createdAt: "2026-11-16T10:00:00Z", emailKey: "sam@newcomer.example", token: "gms_pi_mocktoken0000000000000000000000000000000" }];
    open("/for-funders?invite=gms_pi_mocktoken0000000000000000000000000000000&setup=1", services);
    expect(await screen.findByRole("heading", { name: "Dana Ortiz at Riverbend Community Foundation invited you" })).toBeInTheDocument();
    await user.type(await screen.findByLabelText(/Organization name/), "Northwind Family Foundation");
    expect(screen.getByLabelText("Public handle")).toHaveValue("northwind-family-foundation");
    await user.click(screen.getByRole("button", { name: "Create my funder workspace" }));
    await waitFor(() => expect(store.claims).toHaveLength(1));
    expect(store.invitations["20000000-0000-7000-8000-000000000001"]![0]).toMatchObject({ status: "joined", joinedCount: 1 });
  }, 20_000);
});

describe("intermediaries", () => {
  it("asks for two funds first, then makes a co-branded link with a logo and a directory request", async () => {
    const user = userEvent.setup();
    const first = open("/w/riverbend/settings/partners");
    const { services, store } = first;
    expect(await screen.findByText("This is for workspaces that run 2 or more funds")).toBeInTheDocument();
    await settled();
    expect(await seriousViolations()).toEqual([]);

    // Two funds, as Settings → Funds makes them, and the page offers the link.
    await services.api.workspace("riverbend");
    await services.api.createFund({ name: "River Health Fund" });
    await services.api.createFund({ name: "Youth Arts Fund" });
    first.unmount();
    open("/w/riverbend/settings/partners", services);
    await user.click(await screen.findByRole("button", { name: "Make the onboarding link" }));
    const url = (await screen.findByLabelText("Onboarding link", { selector: "input" })) as HTMLInputElement;
    expect(url.value).toMatch(/\/join\/[a-z0-9]{20}$/);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Logo"), png);
    await user.click(screen.getByRole("button", { name: "Upload logo" }));
    expect(await screen.findByText("Say what the logo shows")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/What the logo shows/), "Riverbend Community Foundation");
    await user.click(screen.getByRole("button", { name: "Upload logo" }));
    expect(await screen.findByRole("img", { name: "Riverbend Community Foundation" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Region you work in/), "Oregon");
    await user.click(screen.getByRole("button", { name: "Ask to be listed" }));
    expect(await screen.findByText("Waiting for a moderator")).toBeInTheDocument();
    const token = store.links["20000000-0000-7000-8000-000000000001"]!.token;
    expect(store.listings["20000000-0000-7000-8000-000000000001"]).toMatchObject({ status: "pending", region: "Oregon" });
    expect(token).toMatch(/^[a-z0-9]{20}$/);
    expect(store.links["20000000-0000-7000-8000-000000000001"]).toBeDefined();
  }, 30_000);

  it("shows the co-branded page and lists an approved partner", async () => {
    const services = createMockServices({ session: demoSession() });
    const store = mockLoopsStore(services);
    store.partners["w1"] = { name: "Riverbend Community Foundation", handle: "riverbend", funds: ["River Health Fund", "Youth Arts Fund"] };
    store.links["w1"] = { token: "jointoken00000000001", logo: { url: "data:image/png;base64,iVBORw0KGgo=", alt: "Riverbend logo" }, joined: 0, createdAt: "2026-11-16T10:00:00Z" };
    store.listings["w1"] = { id: "l1", workspaceId: "w1", status: "approved", region: "Oregon", submittedAt: "2026-11-16T10:00:00Z", decidedAt: "2026-11-16T11:00:00Z", decisionReason: null, withdrawnAt: null };
    const join = open("/join/jointoken00000000001", services);
    expect(await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation invites you to join" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Riverbend logo" })).toBeInTheDocument();
    expect(screen.getByText("Youth Arts Fund")).toBeInTheDocument();
    await settled();
    expect(await seriousViolations()).toEqual([]);
    join.unmount();
    open("/partners", services);
    const list = await screen.findByRole("list", { name: "Partners" });
    expect(within(list).getByRole("heading", { name: "Riverbend Community Foundation" })).toBeInTheDocument();
    const card = within(list).getByRole("heading", { name: "Riverbend Community Foundation" }).closest("li")!;
    expect(within(card).getByText("2 funds")).toBeInTheDocument();
    expect(within(card).getByText("Oregon")).toBeInTheDocument();
    // The demo intermediary is listed too; the directory is in name order.
    expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["High Desert Community Fund", "Riverbend Community Foundation"]);
    await settled();
    expect(await seriousViolations()).toEqual([]);
  });
});

describe("joining through an intermediary", () => {
  it("names the intermediary in the applicant sign-up when the person came from its onboarding link", async () => {
    const services = createMockServices({ session: demoSession() });
    const store = mockLoopsStore(services);
    store.partners["w1"] = { name: "Riverbend Community Foundation", handle: "riverbend", funds: ["River Health Fund", "Youth Arts Fund"] };
    store.links["w1"] = { token: "jointoken00000000001", logo: null, joined: 0, createdAt: "2026-11-16T10:00:00Z" };
    const join = open("/join/jointoken00000000001", services);
    await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation invites you to join" });
    await userEvent.click(screen.getByRole("button", { name: "Set up my organization" }));
    expect(await screen.findByText("You’re joining through Riverbend Community Foundation.")).toBeInTheDocument();
    await settled();
    expect(await seriousViolations()).toEqual([]);
    join.unmount();
  });

  it("says nothing of the kind without such a link, or for a funder's invitation", async () => {
    const plain = open("/onboarding/applicant");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/joining through/)).not.toBeInTheDocument();
    plain.unmount();
    window.localStorage.setItem("gms.referral", JSON.stringify({ source: "invite", token: "invitetoken000000001", name: "Northwind Fund", at: Date.now() }));
    open("/onboarding/applicant");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/joining through/)).not.toBeInTheDocument();
  });
});

describe("the reusable profile", () => {
  it("tells an applicant every funder here sees their Passport record, and nothing else", async () => {
    open("/w/alder-creek");
    const panel = await screen.findByRole("region", { name: "Your organization profile" });
    expect(panel).toHaveTextContent("Your organization profile is reused by every funder you apply to here");
    expect(within(panel).getByText("Verified through Passport")).toBeInTheDocument();
    expect(within(panel).getByText("Alder Creek Family Services")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Edit in Passport" })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/bank|last four|representative/i);
    await settled();
    expect(await seriousViolations()).toEqual([]);
  });
});

describe("funder setup in place", () => {
  it("resumes funder setup through the key funder setup itself keeps", () => {
    const src = [join(process.cwd(), "apps/web/src"), join(process.cwd(), "src")].find((d) => existsSync(join(d, "app/App.tsx")))!;
    const onboarding = readFileSync(join(src, "screens/public/FunderOnboarding.tsx"), "utf8");
    expect(onboarding).toContain(`const RESUME_KEY = "${FUNDER_SETUP_RESUME_KEY}";`);
  });
});
