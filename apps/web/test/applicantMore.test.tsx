// SPDX-License-Identifier: AGPL-3.0-only
// The rest of the applicant workspace against the mock API: a grant's payments with the hold
// banner, reports from prefill through submit and share, the editor follow-ups (library inserts,
// the revision diff), notifications, preferences, connected agents, the phone layouts at 390, and
// the agents page.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { provideApplicantApi, provideMockApplicantStore, provideRealtime } from "../src/api/applicantHooks.ts";
import { holdExplanation } from "../src/api/applicantMore.ts";
import { provideApplicantMoreApi } from "../src/api/applicantMoreHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { diffWords } from "../src/components/RevisionDiff.tsx";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantMoreApi, MORE_IDS, seedMoreStore, type MoreStore } from "../src/mocks/applicantMore.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { viewport } from "./setup.ts";

function open(path: string, arrange?: (store: ApplicantStore, more: MoreStore) => void) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const more = seedMoreStore(store);
  arrange?.(store, more);
  const session = () => services.auth.getSession();
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, createMockApplicantApi({ session, store }));
  provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more }));
  provideRealtime(services, createRealtimeHub());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...view, store, more };
}

const A = "/w/alder-creek";
const CLINIC = `awd_${APPLICANT_IDS.awardClinic}`;
const req = (id: string) => `${A}/reports?r=req_${id}`;
afterEach(() => {
  viewport.phone = false;
});

describe("a grant's payments", () => {
  it("shows the schedule, where payments go (bank name and last four only) and the budget", async () => {
    open(`${A}/grants/${CLINIC}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Clinic Navigation Pilot" })).toBeInTheDocument();
    const schedule = screen.getByRole("table", { name: "Payment schedule" });
    expect(within(schedule).getByText("$25,000")).toBeInTheDocument();
    expect(within(schedule).getByText("Settled")).toBeInTheDocument();
    expect(within(schedule).getByText("When the final report is accepted")).toBeInTheDocument();
    expect(within(schedule).getByText("After Jun 30, 2027")).toBeInTheDocument();
    expect(screen.getByText("River City Credit Union •••• 4821")).toBeInTheDocument();
    expect(screen.getByText("Payee active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage in Passport/ })).toHaveAttribute("href", expect.stringContaining("passport"));
    const budget = screen.getByRole("table", { name: /Approved budget/ });
    expect(within(budget).getByText("$26,000")).toBeInTheDocument();
    // Travel is over its approved line: said in words, not by color alone.
    expect(within(budget).getByText(/\+\$720 \(8%\) over/)).toBeInTheDocument();
    // Nothing is paused, so there is no hold banner.
    expect(screen.queryByText(/is paused/)).not.toBeInTheDocument();
    // No bank detail beyond the name and last four anywhere on the page.
    expect(document.body.textContent).not.toMatch(/\b\d{9,17}\b/);
  });

  it("explains a paused payment: what is blocked, why, and what clears it", async () => {
    open(`${A}/grants/${CLINIC}`, (store, more) => {
      const t = store.awards.find((a) => a.id === CLINIC)!.tranches[1]!;
      Object.assign(t, { status: "held", holdReason: "destination_change_in_flight" });
      more.payee.status = "pending_change";
    });
    const banner = (await screen.findByText("Tranche 2 ($15,000) is paused")).closest(".bnr") as HTMLElement;
    expect(within(banner).getByText(/started a change to its payout destination in Passport/)).toBeInTheDocument();
    expect(within(banner).getByText(/Clears automatically when the destination change completes/)).toBeInTheDocument();
    expect(screen.getByText("Change pending")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Payment schedule" })).getAllByText("Paused")).toHaveLength(2);
  });

  it("an offered grant shows its schedule as not started yet", async () => {
    open(`${A}/grants/awd_${APPLICANT_IDS.awardHealth}`);
    expect(await screen.findByText(/Payments start once the agreement is executed/)).toBeInTheDocument();
    expect(screen.getAllByText("Scheduled").length).toBe(3);
  });

  it("requests an amendment and reports actuals", async () => {
    const user = userEvent.setup();
    const { store, more } = open(`${A}/grants/${CLINIC}`);
    const form = await screen.findByRole("form", { name: "Request an amendment" });
    await user.type(within(form).getByLabelText(/Reason/), "The van was out of service; we need three more months.");
    await user.click(within(form).getByRole("button", { name: /Send request to Cascade County/ }));
    await waitFor(() => expect(store.awards.find((a) => a.id === CLINIC)!.amendments).toHaveLength(1));
    expect(await screen.findByText(/1 requested/)).toBeInTheDocument();

    const actuals = screen.getByRole("form", { name: "Report actuals" });
    await user.type(within(actuals).getByLabelText("Period end"), "2027-03-31");
    await user.clear(within(actuals).getByLabelText("Period start"));
    await user.type(within(actuals).getByLabelText("Period start"), "2027-01-01");
    await user.type(within(actuals).getByLabelText("Supplies spent"), "1,200");
    await user.click(within(actuals).getByRole("button", { name: "Save actuals" }));
    await waitFor(() => expect(more.budgets[APPLICANT_IDS.awardClinic]!.actuals).toHaveLength(2));
    expect(more.budgets[APPLICANT_IDS.awardClinic]!.actuals[1]!.lines).toEqual([{ category: "Supplies", label: "Supplies", amountMinor: 120000 }]);
  });
});

describe("reports", () => {
  it("lists requirements across funders, most urgent first", async () => {
    open(`${A}/reports`);
    const table = await screen.findByRole("table", { name: "Reporting requirements" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual(["Site data report", "Final report", "Interim report", "Mid-year progress report"]);
    expect(within(rows[0]!).getByText("Returned")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: /^Respond/ })).toBeInTheDocument();
    expect(screen.getByText("4 requirements across 2 funders")).toBeInTheDocument();
    expect(screen.getByText("1 returned with comments")).toBeInTheDocument();
    // The returned report opens first, with the funder's note and what to do.
    expect(await screen.findByText("Cascade County Health Department returned this report")).toBeInTheDocument();
    expect(screen.getByText(/Appointments kept reads 0/)).toBeInTheDocument();
  });

  it("starts a report prefilled from Passport and the last accepted report, saves as you type, and submits", async () => {
    const user = userEvent.setup();
    const { more } = open(req(MORE_IDS.reqFinal));
    await user.click(await screen.findByRole("button", { name: "Start report" }));
    const families = await screen.findByLabelText(/Families served to date/);
    expect(families).toHaveValue(212);
    // Every carried value says where it came from.
    expect(screen.getAllByText("From prior report").length).toBeGreaterThan(2);
    expect(screen.getByText("From Passport")).toBeInTheDocument();
    const draft = more.submissions.at(-1)!;
    expect(draft.status).toBe("draft");
    expect(draft.form.provenance["/familiesServed"]).toBe("prior_submission");

    // Not complete yet: submitting lists what to fix and sends nothing.
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(await screen.findByText(/To fix · /)).toBeInTheDocument();
    expect(draft.status).toBe("draft");

    await user.clear(families);
    await user.type(families, "240");
    await user.click(screen.getByLabelText(/I certify that this report is accurate/));
    await waitFor(() => expect(draft.form.response.familiesServed).toBe(240), { timeout: 4000 });
    expect(draft.form.provenance["/familiesServed"]).toBe("user");
    expect(draft.form.response.certified).toBe(true);

    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(draft.status).toBe("submitted"), { timeout: 4000 });
    expect(more.requirements.find((r) => r.uuid === MORE_IDS.reqFinal)!.status).toBe("submitted");
    expect(await screen.findByText(/Sent to Cascade County Health Department/)).toBeInTheDocument();
    // Locked once sent.
    expect(screen.queryByRole("button", { name: "Submit report" })).not.toBeInTheDocument();
  });

  it("shares an accepted report with another funder by consent", async () => {
    const user = userEvent.setup();
    const { store, more } = open(req(MORE_IDS.reqMidYear));
    await user.click(await screen.findByRole("button", { name: "Share this report" }));
    const dialog = await screen.findByRole("dialog", { name: /Share “Mid-year progress report”/ });
    expect(within(dialog).getByLabelText("Share with")).toHaveValue("riverbend");
    await user.click(within(dialog).getByLabelText("What got in the way, and what changed?"));
    expect(within(dialog).getByText(/This is recorded as your consent/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Share with Riverbend Community Foundation" }));
    expect(await screen.findByText("Shared with Riverbend Community Foundation")).toBeInTheDocument();
    expect(more.submissions.find((s) => s.uuid === MORE_IDS.subMidYear)!.sharedWith).toEqual([APPLICANT_IDS.riverbend]);
    expect(store.consents.some((c) => c.basis === "shared_submission" && c.funder.workspaceId === APPLICANT_IDS.riverbend)).toBe(true);
  });

  it("only offers sharing once a report is accepted", async () => {
    open(req(MORE_IDS.reqSiteData));
    expect(await screen.findByText(/returned this report/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share this report" })).not.toBeInTheDocument();
  });
});

describe("application follow-ups", () => {
  it("shows what changed in a revision response", async () => {
    open(`${A}/applications/app_${APPLICANT_IDS.appClinic}`);
    expect((await screen.findAllByText("Please name the county assessment you cite and give its year.")).length).toBeGreaterThan(0);
    expect(screen.getByText(/19 → 24 words \(\+5 words\)/)).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    const added = [...document.querySelectorAll("ins.ins")].map((n) => n.textContent).join("");
    expect(added).toContain("2026");
    expect(added).toContain("Needs");
    expect([...document.querySelectorAll("del.del")].map((n) => n.textContent).join("")).toContain("county");
  });

  it("inserting from the library marks the field as From library and records the use", async () => {
    const { store } = open(`${A}/applications/app_${APPLICANT_IDS.appHealth}/edit`);
    const more = createMockApplicantMoreApi({ session: async () => demoSession(), store });
    const answer = store.answers.find((a) => a.usedIn?.length === 0)!;
    const saved = await more.insertAnswer(`app_${APPLICANT_IDS.appHealth}`, `frm_${APPLICANT_IDS.formFull}`, { answerId: answer.id, path: "/need" });
    expect(saved.response.need).toBe(answer.body);
    expect(saved.provenance["/need"]).toBe("library");
    expect(answer.usedIn).toHaveLength(1);
    // A hand edit afterwards makes it the person's own again.
    const api = createMockApplicantApi({ session: async () => demoSession(), store });
    const edited = await api.saveForm(`app_${APPLICANT_IDS.appHealth}`, APPLICANT_IDS.formFull, { need: "Rewritten by hand." });
    expect(edited.provenance["/need"]).toBe("user");
    expect(await screen.findByRole("button", { name: /Insert from answer library/ })).toBeInTheDocument();
  });

  it("reads section assignments back", async () => {
    const store = seedApplicantStore();
    const more = createMockApplicantMoreApi({ session: async () => demoSession(), store });
    const rows = await more.sectionAssignments(`app_${APPLICANT_IDS.appHealth}`);
    expect(rows.find((r) => r.formId === APPLICANT_IDS.formFull)!.sections).toMatchObject({ Organization: APPLICANT_IDS.maria });
  });
});

describe("the person: notifications, preferences, agents", () => {
  it("groups notifications by workspace and marks them read", async () => {
    const user = userEvent.setup();
    const { more } = open("/notifications");
    const group = await screen.findByRole("region", { name: "Alder Creek Family Services" });
    expect(await within(group).findByRole("link", { name: "Award offered · $150,000" })).toHaveAttribute("href", `/w/alder-creek/grants/awd_${APPLICANT_IDS.awardHealth}`);
    expect(within(group).getByText("2 new")).toBeInTheDocument();
    const funder = screen.getByRole("region", { name: "Riverbend Community Foundation" });
    expect(await within(funder).findByRole("link", { name: /proposes declining 14 applications/ })).toHaveAttribute("href", "/w/riverbend/approvals");
    await waitFor(() => expect(screen.getByText("4 unread")).toBeInTheDocument());

    await user.click(within(group).getByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(more.notifications.every((n) => n.read)).toBe(true));
    expect(await within(group).findByText("All read")).toBeInTheDocument();
    expect(screen.getByText("2 unread")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unread" }));
    expect(within(group).getByText("Nothing unread here.")).toBeInTheDocument();
  });

  it("saves a notification preference when a switch is flipped", async () => {
    const user = userEvent.setup();
    const { more } = open(`${A}/settings`);
    const toggle = await screen.findByRole("switch", { name: "Payments, email" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await waitFor(() => expect(more.preferences.channels.payment).toEqual({ inApp: true, email: false }));
    expect(screen.getByRole("switch", { name: "Payments, email" })).toHaveAttribute("aria-checked", "false");
    await user.selectOptions(screen.getByLabelText("Email digest"), "weekly");
    await waitFor(() => expect(more.preferences.digest).toBe("weekly"));
  });

  it("lists connected agents per workspace and revokes one after a confirmation", async () => {
    const user = userEvent.setup();
    const { more } = open("/account/agents");
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Connected by a teammate")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Revoke Claude/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Claude?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(more.connections.find((c) => c.id === MORE_IDS.connClaude)!.revokedAt).not.toBeNull());
    await waitFor(() => expect(screen.queryByText("Claude")).not.toBeInTheDocument());
  });

  it("lists the person's workspaces", async () => {
    open("/workspaces");
    expect(await screen.findByRole("link", { name: /Alder Creek Family Services/ })).toHaveAttribute("href", "/w/alder-creek");
    expect(screen.getByRole("link", { name: /Riverbend Community Foundation/ })).toHaveAttribute("href", "/w/riverbend");
  });
});

describe("phone layouts follow the 390px artboards", () => {
  const phone = (path: string, arrange?: Parameters<typeof open>[1]) => {
    viewport.phone = true;
    return open(path, arrange);
  };

  it("dashboard: phone bar, greeting, readiness with one action, cards, bottom tabs", async () => {
    phone(A);
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Maria$/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Manage in Passport" })).toHaveClass("btn-block");
    const tabs = screen.getByRole("navigation", { name: "Primary" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Home", "Apply", "Grants", "Reports", "Org"]);
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    // No desktop rail on the phone layout until the menu is opened.
    expect(screen.queryByRole("navigation", { name: "Applicant workspace" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Menu" }));
    expect(within(screen.getByRole("navigation", { name: "Applicant workspace" })).getByRole("link", { name: "Answer library" })).toBeInTheDocument();
  });

  it("organization: identity card, stacked profile with sources, payee status", async () => {
    phone(`${A}/organization`);
    expect(await screen.findByRole("heading", { level: 2, name: "Alder Creek Family Services" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("501(c)(3) public charity")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Payee status" })).getByText("Change control")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Who has access" })).toBeInTheDocument();
  });

  it("grant: one card per tranche, destination and agreement", async () => {
    phone(`${A}/grants/${CLINIC}`);
    expect(await screen.findByText("Tranche 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Tranche 2 of 2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Payment destination" })).getByText("River City Credit Union •••• 4821")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Grants" })).toHaveAttribute("aria-current", "page");
  });

  it("reports: a card per requirement, then the report with a full-width submit", async () => {
    phone(`${A}/reports`);
    expect(await screen.findByRole("heading", { name: "Due across funders" })).toBeInTheDocument();
    const due = screen.getByRole("region", { name: "Due across funders" });
    expect(within(due).getAllByRole("button").length).toBe(4);
    expect(await screen.findByRole("button", { name: "Resubmit report" })).toHaveClass("btn-block");
    expect(screen.getByText(/returned this report/)).toBeInTheDocument();
  });

  it("status: summary card, timeline, thread and the revision diff", async () => {
    phone(`${A}/applications/app_${APPLICANT_IDS.appClinic}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Community Clinic Capacity" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Messages" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Revision request" })).getByText(/19 → 24 words/)).toBeInTheDocument();
  });

  it("editor: section pills and the validation sheet above the tabs", async () => {
    const user = userEvent.setup();
    phone(`${A}/applications/app_${APPLICANT_IDS.appHealth}/edit`);
    const pills = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(pills).getAllByRole("link").length).toBeGreaterThan(1);
    const sheet = screen.getByRole("button", { name: /^Validation/ });
    expect(sheet).toHaveAttribute("aria-expanded", "false");
    await user.click(sheet);
    expect(sheet).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});

describe("agents page and helpers", () => {
  it("says how agents connect and which actions always need a person", async () => {
    open("/agents");
    expect(await screen.findByRole("heading", { level: 1, name: "Agents are first-class users of the GMS" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Tools that need a person" });
    const row = within(table).getByText("sign_agreement").closest("tr")!;
    expect(within(row).getByText("A person, always")).toBeInTheDocument();
    expect(within(within(table).getByText("submit_application").closest("tr")!).getByText(/A person approves/)).toBeInTheDocument();
    expect(screen.getByText(/\/mcp/)).toBeInTheDocument();
  });

  it("diffs by word and explains every hold cause", () => {
    const d = diffWords("travel 46 miles to care", "travel 46 miles to primary care");
    expect(d.before.every((p) => p.kind === "same")).toBe(true);
    expect(d.after.filter((p) => p.kind === "ins").map((p) => p.text.trim())).toEqual(["primary"]);
    for (const [reason, cause] of [
      ["destination_change_in_flight", "destination_change"],
      ["freeze_window", "freeze_window"],
      ["level_below_l3", "level_below_l3"],
      ["agreement_not_executed", "agreement_not_executed"],
      ["passport_unavailable", "passport_unavailable"],
      ["organization_inactive", "organization_inactive"],
    ] as const) {
      const e = holdExplanation(reason);
      expect(e.cause).toBe(cause);
      expect(e.why.length).toBeGreaterThan(20);
      expect(e.clears).toMatch(/^Clears/);
    }
    expect(holdExplanation("Award suspended: audit").clears).toBe("Your funder releases the hold");
  });
});
