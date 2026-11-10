// SPDX-License-Identifier: AGPL-3.0-only
// The sections that complete the applicant and public screens, against the mock API: workspace
// tokens, exports and leaving; the Passport locker, access and payout destination; grant documents
// and messages; alerts; the assistant (hidden unless on); decisions; and what a funder publishes.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { provideApplicantFullApi } from "../src/api/applicantFullHooks.ts";
import { provideApplicantApi, provideMockApplicantStore, provideRealtime } from "../src/api/applicantHooks.ts";
import { provideApplicantMoreApi } from "../src/api/applicantMoreHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantFullApi, seedFullStore, type FullStore } from "../src/mocks/applicantFull.ts";
import { createMockApplicantMoreApi, seedMoreStore } from "../src/mocks/applicantMore.ts";
import { demoSession } from "../src/mocks/auth.ts";

function open(path: string, arrange?: (store: ApplicantStore, full: FullStore) => void) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const more = seedMoreStore(store);
  const full = seedFullStore(store);
  arrange?.(store, full);
  const session = () => services.auth.getSession();
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, createMockApplicantApi({ session, store }));
  provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more }));
  provideApplicantFullApi(services, createMockApplicantFullApi({ session, store, full }));
  provideRealtime(services, createRealtimeHub());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...view, store, full };
}

const A = "/w/alder-creek";
const CLINIC = `awd_${APPLICANT_IDS.awardClinic}`;
const HEALTH = `awd_${APPLICANT_IDS.awardHealth}`;

describe("workspace settings", () => {
  it("creates a token, shows its secret once, and revokes one", async () => {
    const { full } = open(`${A}/settings`);
    const tokens = await screen.findByRole("table", { name: "API tokens for this workspace" });
    expect(within(tokens).getByText("Board dashboard sync")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Create token/ }));
    const dialog = screen.getByRole("dialog");
    // Submit and sign are not on offer at all.
    expect(within(dialog).queryByText(/applications:submit|agreements:write/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Name/), "Reporting script");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));
    const notice = await screen.findByText(/“Reporting script” was created/);
    const secret = full.tokens.length; // the mock numbers its secrets
    expect(notice.closest(".bnr")).toHaveTextContent(/mock-secret-\d+/);
    expect(secret).toBe(3);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke Board dashboard sync" }));
    await waitFor(() => expect(full.tokens.find((t) => t.name === "Board dashboard sync")!.revokedAt).not.toBeNull());
  });

  it("exports the workspace and will not let the only admin leave", async () => {
    const { store } = open(`${A}/settings`, (s) => {
      s.members = s.members.filter((m) => m.role !== "admin" || m.userId === APPLICANT_IDS.maria);
    });
    expect(await screen.findByRole("button", { name: /Export all applications/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export reports/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Leave workspace" }));
    expect(await within(dialog).findByText(/only admin/)).toBeInTheDocument();
    expect(store.members.some((m) => m.userId === APPLICANT_IDS.maria)).toBe(true);
  });
});

describe("organization", () => {
  it("lists the Passport locker as references, the apps feeding the record, and who has access", async () => {
    open(`${A}/organization`);
    const locker = await screen.findByRole("region", { name: "Documents locker" });
    expect(await within(locker).findByText("IRS determination letter.pdf")).toBeInTheDocument();
    expect(within(locker).getAllByText("Passport locker").length).toBeGreaterThan(0);
    // A Drive link has no fixed copy, so it cannot be pinned to an application.
    expect(within(locker).getByText("Link only")).toBeInTheDocument();
    expect(within(locker).getByRole("link", { name: "Upload to Passport" })).toHaveAttribute("href", expect.stringContaining("passport"));
    const reps = screen.getByRole("region", { name: "Representatives" });
    expect(within(reps).getByText(/does not share the list/)).toBeInTheDocument();
    const access = screen.getByRole("region", { name: "Who has access" });
    expect(within(access).getByRole("columnheader", { name: "Can read" })).toBeInTheDocument();
    expect(within(access).getByRole("columnheader", { name: "Granted via" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Connected apps" })).toBeInTheDocument();
  });

  it("says so when the locker cannot be read", async () => {
    open(`${A}/organization`, (_s, full) => {
      full.locker = { state: "unavailable", reason: "Passport can't be reached right now.", items: [] };
    });
    const locker = await screen.findByRole("region", { name: "Documents locker" });
    expect(await within(locker).findByText(/can't be shown right now/)).toBeInTheDocument();
  });
});

describe("team & access", () => {
  it("splits members, consultants, funders and agents into tabs", async () => {
    open(`${A}/team`);
    expect(await screen.findByRole("table", { name: "Team members" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "MFA" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Agents/ }));
    const agents = await screen.findByRole("table", { name: "Connected agents" });
    expect(within(agents).getByRole("columnheader", { name: "Scopes" })).toBeInTheDocument();
    expect(within(agents).getByRole("columnheader", { name: "Last used" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Let your agent apply" })).toBeInTheDocument();
  });
});

describe("a grant", () => {
  it("explains a destination Passport does not share, without showing bank details", async () => {
    open(`${A}/grants/${CLINIC}`, (_s, full) => {
      full.destination = { state: "not_shared", bankName: null, last4: null, status: null, level: null, pendingChange: false, freezeUntil: null, manageUrl: "https://passport.opengrants.io/payee", reason: null };
    });
    expect(await screen.findByText("Not shared with the GMS")).toBeInTheDocument();
    expect(screen.getByText(/open it there to see or change it/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{9,17}\b/);
  });

  it("shows the grant's documents and its shared thread, and sends a message", async () => {
    const { store } = open(`${A}/grants/${HEALTH}`);
    const docs = await screen.findByRole("region", { name: "Documents" });
    expect(within(docs).getByText(/Grant agreement/)).toBeInTheDocument();
    const messages = screen.getByRole("region", { name: "Messages" });
    await userEvent.type(within(messages).getByLabelText(/Message /), "Thank you, the first payment arrived.");
    await userEvent.click(within(messages).getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(store.threads.some((t) => t.messages.some((m) => m.body === "Thank you, the first payment arrived."))).toBe(true));
  });

  it("checks the payee, budget and reporting plan before signing", async () => {
    open(`${A}/grants/${HEALTH}/offer`);
    const before = await screen.findByRole("region", { name: "Before you sign" });
    expect(await within(before).findByText(/Payee verified/)).toBeInTheDocument();
    expect(within(before).getByText(/River City Credit Union •••• 4821/)).toBeInTheDocument();
  });
});

describe("find funding", () => {
  it("lists alerts on their own tab and creates one", async () => {
    const { full } = open(`${A}/find`);
    await userEvent.click(await screen.findByRole("tab", { name: "Alerts" }));
    expect(await screen.findByText("rural health navigation")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Watch for/), "housing stability");
    await userEvent.click(screen.getByRole("button", { name: /Create alert/ }));
    await waitFor(() => expect(full.alerts.some((a) => a.query === "housing stability")).toBe(true));
    expect(await screen.findByText("housing stability")).toBeInTheDocument();
  });
});

describe("the assistant", () => {
  it("is not shown at all unless it is switched on", async () => {
    open(`${A}/library`);
    expect(await screen.findByRole("heading", { level: 1, name: "Answer library" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "Answers" });
    expect(screen.queryByText(/Draft — review before use/)).not.toBeInTheDocument();
  });

  it("adapts a library answer into a draft the person copies, and counts it against the quota", async () => {
    const { full, store } = open(`${A}/library`, (_s, f) => {
      f.assist = { enabled: true, quota: { used: 14, limit: 40 } };
    });
    expect(await screen.findByText("Draft — review before use")).toBeInTheDocument();
    expect(screen.getByText("14 of 40 this month")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Target question/), "What need does this project address?");
    await userEvent.clear(screen.getByLabelText("Word limit"));
    await userEvent.type(screen.getByLabelText("Word limit"), "12");
    const before = structuredClone(store.answers);
    await userEvent.click(screen.getByRole("button", { name: "Adapt" }));
    expect(await screen.findByText(/Draft by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy the draft" })).toBeInTheDocument();
    expect(full.assist.quota?.used).toBe(15);
    // A draft changes nothing in the library.
    expect(store.answers).toEqual(before);
  });
});

describe("application status", () => {
  it("says no decision has been made yet", async () => {
    open(`${A}/applications/app_${APPLICANT_IDS.appClinic}`);
    const decision = await screen.findByRole("region", { name: "Decision" });
    expect(within(decision).getByText(/No decision yet/)).toBeInTheDocument();
  });

  it("shows a decision and the interview the funder proposed", async () => {
    open(`${A}/applications/app_${APPLICANT_IDS.appClinic}`, (store) => {
      const app = store.applications.find((a) => a.uuid === APPLICANT_IDS.appClinic)!;
      app.status = "declined";
      app.events = [
        ...app.events,
        { id: "18000000-0000-7000-8000-000000000001", type: "interview", fromStatus: "under_review", toStatus: "interview", fromStage: null, toStage: null, at: "2027-05-01T17:00:00Z", message: "A 30-minute video call with the panel.", payload: { slots: ["2027-05-05T21:30:00Z"] } },
        { id: "18000000-0000-7000-8000-000000000002", type: "decline", fromStatus: "interview", toStatus: "declined", fromStage: null, toStage: null, at: "2027-06-12T17:00:00Z", message: null },
      ];
    });
    const decision = await screen.findByRole("region", { name: "Decision" });
    expect(within(decision).getByText("Declined")).toBeInTheDocument();
    expect(within(decision).getByText(/decided on Jun 12, 2027/)).toBeInTheDocument();
    const interview = screen.getByRole("region", { name: "Interview scheduling" });
    expect(within(interview).getByText("A 30-minute video call with the panel.")).toBeInTheDocument();
  });
});

describe("funders and notifications", () => {
  it("shows open items, documents and published contact per funder", async () => {
    open(`${A}/funders`);
    expect(await screen.findByRole("columnheader", { name: "Open items" })).toBeInTheDocument();
    const contact = await screen.findByRole("region", { name: "Contact Riverbend Community Foundation" });
    expect(await within(contact).findByRole("link", { name: "grants@riverbendcf.example" })).toHaveAttribute("href", "mailto:grants@riverbendcf.example");
    expect(screen.getByRole("region", { name: "Open items with Riverbend Community Foundation" })).toBeInTheDocument();
  });

  it("has digest settings beside the notifications list", async () => {
    open("/notifications");
    const digest = await screen.findByRole("complementary", { name: "Digest settings" });
    expect(within(digest).getByLabelText("Email digest")).toBeInTheDocument();
    expect(await within(digest).findByRole("switch", { name: "An agent needs my approval" })).toBeInTheDocument();
  });
});

describe("what a funder publishes", () => {
  it("shows past awards by year and questions about applying", async () => {
    open("/f/riverbend");
    const past = await screen.findByRole("table", { name: "Awards made in 2026" });
    expect(within(past).getByText("Harbor Light Shelter")).toBeInTheDocument();
    expect(within(past).getByText("$120,000")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(await screen.findByRole("table", { name: "Awards made in 2025" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Questions About Applying" })).toBeInTheDocument();
    expect(screen.getByText("Do we need a Passport record to apply?")).toBeInTheDocument();
  });

  it("lists guideline documents on the opportunity page", async () => {
    open("/f/riverbend/o/community-health-2027");
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Program guidelines 2027\.pdf/ })).toHaveAttribute("href", "https://riverbendcf.example/guidelines-2027.pdf");
  });
});
