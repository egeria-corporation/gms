// SPDX-License-Identifier: AGPL-3.0-only
// Funder work screens against the mock API: each renders from data and each action round-trips.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS, USERS } from "../src/mocks/funder.ts";
import { IDS } from "../src/mocks/store.ts";
import { browser } from "../src/screens/shared/OAuthConsent.tsx";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const where = () => screen.getByTestId("where").textContent ?? "";

async function riverbend(): Promise<Services> {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  return services;
}
function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return services;
}
const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

afterEach(() => vi.restoreAllMocks());

describe("dashboard", () => {
  it("counts what needs a person and shows the pending agent request", async () => {
    open("/w/riverbend");
    const stat = (await screen.findByText("Open applications")).closest("a")!;
    await waitFor(() => expect(within(stat).getByText("7")).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "Community Health Grants 2027 pipeline by stage" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Approval request: Decline 2 applications/ })).toBeInTheDocument();
    expect(await screen.findByText("Harbor Light Shelter · destination change pending")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /Done: Countersign the Alder Creek agreement/ })).toBeInTheDocument();
  });
});

describe("applications inbox", () => {
  it("lists applications and keeps filters in the URL", async () => {
    open("/w/riverbend/applications");
    expect(await screen.findByRole("link", { name: "Alder Creek Family Services" })).toBeInTheDocument();
    expect(within(rowOf("Copper Valley Clinic")).getByText("Unknown")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Eligibility" }), "false");
    await waitFor(() => expect(where()).toContain("eligibility=false"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Alder Creek Family Services" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Pine Ridge Youth Alliance" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(where()).toBe("/w/riverbend/applications"));
  });

  it("opens a saved view from the URL and sorts by header", async () => {
    open("/w/riverbend/applications?view=under-review");
    expect(await screen.findByRole("link", { name: "Harbor Light Shelter" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Lakeside Senior Center" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Under review/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Requested" }));
    await waitFor(() => expect(where()).toContain("sort=requestedAmount"));
  });

  it("declines in bulk only after the letter has been previewed", async () => {
    const services = await riverbend();
    open("/w/riverbend/applications", services);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Lakeside Senior Center" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Copper Valley Clinic" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline 2 applications" });
    expect(within(dialog).queryByRole("button", { name: /Decline and send/ })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Reason shown in the letter"), "Outside this cycle's priorities.");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Preview letter" }));
    const preview = await within(dialog).findByRole("region", { name: "Letter preview" });
    expect(preview).toHaveTextContent("Dear Lakeside Senior Center");
    expect(preview).toHaveTextContent("Outside this cycle's priorities.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline and send 2 letters" }));
    expect(await screen.findByText("2 declined · 2 letters sent")).toBeInTheDocument();
    const after = await services.api.listApplications({ status: "declined" });
    expect(after.items.map((a) => a.applicant.name)).toEqual(expect.arrayContaining(["Lakeside Senior Center", "Copper Valley Clinic"]));
  });

  it("shows an agent's proposed declines and applies them when a person approves", async () => {
    const services = await riverbend();
    open("/w/riverbend/applications?view=agent", services);
    const row = (await screen.findByRole("link", { name: "Pine Ridge Youth Alliance" })).closest("tr")!;
    expect(row).toHaveClass("agent");
    expect(within(row).getByText("Riverbend Triage Agent")).toBeInTheDocument();
    expect(within(row).getByText("Decline proposed")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Approve" }));
    await waitFor(async () => expect((await services.api.getApplication(MOCK_IDS.pineRidge)).status).toBe("declined"));
    expect((await services.api.getApplication(MOCK_IDS.meadowbrook)).status).toBe("declined");
    expect(await services.api.listApprovals("pending")).toHaveLength(0);
  });

  it("shows the first-run screen when the workspace has no programs", async () => {
    const services = await riverbend();
    vi.spyOn(services.api, "listPrograms").mockResolvedValue([]);
    open("/w/riverbend/applications", services);
    expect(await screen.findByRole("heading", { name: /No applications yet|Start with a program|program/i, level: 3 })).toBeInTheDocument();
  });
});

describe("application detail", () => {
  it("shows responses with provenance, the applicant and eligibility", async () => {
    open(`/w/riverbend/applications/${MOCK_IDS.harbor}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Shelter Health Liaison" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Full proposal" })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel", { name: "Applicant" })).getByText("001234567")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Eligibility" }));
    expect(await screen.findByText("Serves Riverbend County")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(await screen.findByText(/Reviews · 1 of 3 submitted/)).toBeInTheDocument();
  });

  it("advances an application to the next stage", async () => {
    const services = await riverbend();
    open(`/w/riverbend/applications/${MOCK_IDS.pineRidge}`, services);
    await userEvent.click(await screen.findByRole("button", { name: "Advance to Full proposal" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Advance to Full proposal" })).getByRole("button", { name: "Advance" }));
    await waitFor(async () => expect((await services.api.getApplication(MOCK_IDS.pineRidge)).stage).toBe("full"));
  });

  it("requests a revision with a message and shows the new status", async () => {
    const services = await riverbend();
    open(`/w/riverbend/applications/${MOCK_IDS.harbor}`, services);
    await userEvent.click(await screen.findByRole("button", { name: "Request revision" }));
    const dialog = screen.getByRole("dialog", { name: "Request a revision" });
    const send = within(dialog).getByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/What should change/), "Please cite the county assessment.");
    await userEvent.click(send);
    expect(await screen.findByText("A revision is with the applicant")).toBeInTheDocument();
    expect((await services.api.getApplication(MOCK_IDS.harbor)).status).toBe("revision_requested");
  });

  it("keeps internal notes apart from the shared thread", async () => {
    const services = await riverbend();
    open(`/w/riverbend/applications/${MOCK_IDS.alder}`, services);
    await userEvent.click(await screen.findByRole("tab", { name: "Messages" }));
    expect(await screen.findByText(/A source for the county assessment/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Internal" }));
    expect(await screen.findByText(/thin cash reserve/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Write an internal note"), "Condition on tranche 2 agreed.");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Condition on tranche 2 agreed.")).toBeInTheDocument();
    const threads = await services.api.listThreads(MOCK_IDS.alder);
    expect(threads.find((t) => t.visibility === "shared")!.messages.some((m) => m.body.includes("Condition on tranche 2"))).toBe(false);
  });
});

describe("reviews", () => {
  it("assigns a reviewer from the matrix", async () => {
    const services = await riverbend();
    open("/w/riverbend/reviews/assign", services);
    const cell = await screen.findByRole("button", { name: "Priya Natarajan on Lakeside Senior Center: not assigned" });
    await userEvent.click(cell);
    expect(await screen.findByRole("button", { name: "Priya Natarajan on Lakeside Senior Center: Assigned" })).toHaveAttribute("aria-pressed", "true");
    expect(await services.api.listAssignments({ applicationId: MOCK_IDS.lakeside, reviewerUserId: USERS.priya })).toHaveLength(1);
  });

  it("previews auto-assignment before making it", async () => {
    open("/w/riverbend/reviews/assign");
    await userEvent.click(await screen.findByRole("button", { name: "Auto-assign…" }));
    const dialog = screen.getByRole("dialog", { name: "Auto-assign reviewers" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText(/new assignments? would be made/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Assign \d+/ }));
    expect(await screen.findByText(/assignments? made/)).toBeInTheDocument();
  });

  it("scores an assignment, refuses an incomplete submit, and feeds the ranking", async () => {
    const services = await riverbend();
    const before = (await services.api.getRanking(IDS.compHealth27, "full")).items.find((r) => r.applicationId === MOCK_IDS.harbor)!;
    expect(before.n).toBe(1);
    open(`/review/score/${MOCK_IDS.danaScoring}`, services);
    expect(await screen.findByRole("heading", { level: 1, name: "Shelter Health Liaison" })).toBeInTheDocument();
    const set = (label: RegExp, v: string) => fireEvent.change(screen.getByRole("spinbutton", { name: label }), { target: { value: v } });
    set(/Community impact score/, "5");
    set(/Feasibility score/, "4");
    set(/Budget reasonableness score/, "4");
    await userEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(await screen.findByText("Score this criterion before submitting")).toBeInTheDocument();
    set(/Reach to underserved families score/, "5");
    await userEvent.click(screen.getByRole("radio", { name: "Fund" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(await screen.findByText("Submitted. Your scores are locked.")).toBeInTheDocument();
    const after = (await services.api.getRanking(IDS.compHealth27, "full")).items.find((r) => r.applicationId === MOCK_IDS.harbor)!;
    expect(after.n).toBe(2);
    // impact 5, feasibility 4, budget 4, equity 5 on a 1–5 scale with weights 35/25/20/20 → 88.75; with Priya's 75 the mean is 81.88.
    expect(after.overalls.find((o) => o.reviewerId === USERS.dana)!.overall).toBe(88.75);
    expect(after.mean).toBeCloseTo(81.88, 2);
  });
});

describe("panel", () => {
  it("ranks by mean and flags reviewer disagreement", async () => {
    open(`/w/riverbend/competitions/${IDS.compHealth27}/panel`);
    const table = await screen.findByRole("table", { name: "Ranking and decisions" });
    const names = within(table).getAllByRole("link").map((a) => a.textContent);
    expect(names.slice(0, 3)).toEqual(["Alder Creek Family Services", "Harbor Light Shelter", "Northgate Housing Trust"]);
    expect(within(rowOf("Northgate Housing Trust")).getByText("reviewers disagree")).toBeInTheDocument();
    expect(within(rowOf("Alder Creek Family Services")).getByText("Committed")).toBeInTheDocument();
  });

  it("disables Commit while approvals exceed the budget, until an admin gives a reason", async () => {
    open(`/w/riverbend/competitions/${IDS.compHealth27}/panel`);
    const row = (await screen.findByRole("link", { name: "Harbor Light Shelter" })).closest("tr")!;
    const commit = screen.getByRole("button", { name: "Commit decisions" });
    expect(commit).toBeDisabled();
    await userEvent.click(within(row).getByRole("radio", { name: "Approve" }));
    const amount = within(row).getByRole("textbox", { name: "Allocation for Harbor Light Shelter" });
    expect(amount).toHaveValue("120000");
    expect(commit).toBeEnabled();
    fireEvent.change(amount, { target: { value: "2,000,000" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Over budget by $950,000");
    expect(commit).toBeDisabled();
    expect(screen.getByText(/Give a reason to override/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Override reason"), "Board approved a one-time increase.");
    expect(commit).toBeEnabled();
  });

  it("commits a decision and the award appears", async () => {
    const services = await riverbend();
    open(`/w/riverbend/competitions/${IDS.compHealth27}/panel`, services);
    const row = (await screen.findByRole("link", { name: "Harbor Light Shelter" })).closest("tr")!;
    await userEvent.click(within(row).getByRole("radio", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Commit decisions" }));
    // Committing is final, so it is confirmed first.
    await userEvent.click(within(await screen.findByRole("dialog", { name: /Commit \d+ decisions?\?/ })).getByRole("button", { name: "Commit decisions" }));
    expect(await screen.findByText("1 decision committed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Open award for Harbor Light Shelter" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Shelter Health Liaison" })).toBeInTheDocument();
    expect(await services.api.listAwards()).toHaveLength(2);
    expect((await services.api.getApplication(MOCK_IDS.harbor)).status).toBe("accepted");
  });
});

describe("award agreement", () => {
  it("countersigns only with a typed name and the attestation, then the award is active", async () => {
    const services = await riverbend();
    open(`/w/riverbend/awards/${MOCK_IDS.award}/agreement`, services);
    await userEvent.click(await screen.findByRole("button", { name: "Countersign…" }));
    const dialog = screen.getByRole("dialog", { name: "Countersign the grant agreement" });
    const sign = within(dialog).getByRole("button", { name: "Countersign" });
    expect(sign).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type your full legal name/), "Dana Ortiz");
    expect(sign).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    expect(sign).toBeEnabled();
    await userEvent.click(sign);
    expect(await screen.findByText("Agreement executed")).toBeInTheDocument();
    const award = await services.api.getAward(MOCK_IDS.award);
    expect(award.status).toBe("active");
    expect(award.tranches[0]!.status).toBe("due");
    expect(screen.getByRole("button", { name: "Open executed PDF" })).toBeInTheDocument();
  });

  it("generates and sends an agreement for a new award", async () => {
    const services = await riverbend();
    const proposed = await services.api.proposeDecisions(IDS.compHealth27, [{ applicationId: MOCK_IDS.northgate, outcome: "approve", amountMinor: 11_000_000 }]);
    const committed = await services.api.commitDecisions({ competitionId: IDS.compHealth27, decisionIds: proposed.decisions.map((d) => d.id) });
    open(`/w/riverbend/awards/${committed.results[0]!.awardId}/agreement`, services);
    await userEvent.click(await screen.findByRole("button", { name: "Send to grantee" }));
    expect(await screen.findByText("Waiting for the grantee to sign")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Countersign…" })).not.toBeInTheDocument();
  });
});

describe("communications", () => {
  it("renders a template preview on the server and lists the send log", async () => {
    open("/w/riverbend/communications");
    await userEvent.click(await screen.findByRole("button", { name: "Standard decline v3" }));
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("region", { name: "Rendered preview" })).toHaveTextContent("Riverbend Community Foundation will not be advancing");
    expect(within(screen.getByRole("table", { name: "Send log" })).getByText("Award letter")).toBeInTheDocument();
  });

  it("saves an edit as a new version and warns about an unknown merge field", async () => {
    const services = await riverbend();
    open("/w/riverbend/communications", services);
    await userEvent.click(await screen.findByRole("button", { name: "Standard decline v3" }));
    const body = screen.getByLabelText("Body");
    fireEvent.change(body, { target: { value: "Dear {{recipient.name}}, EIN {{applicant.ein}}" } });
    expect(screen.getByText(/Unknown merge field/)).toBeInTheDocument();
    fireEvent.change(body, { target: { value: "Dear {{recipient.name}}, thank you." } });
    await userEvent.click(screen.getByRole("button", { name: "Save as v4" }));
    await waitFor(async () => expect((await services.api.listTemplates()).items.some((t) => t.body === "Dear {{recipient.name}}, thank you.")).toBe(true));
  });
});

describe("approvals and gates", () => {
  it("rejects a request with a note and keeps who decided", async () => {
    const services = await riverbend();
    open("/w/riverbend/approvals", services);
    const card = await screen.findByRole("article", { name: /Approval request: Decline 2 applications/ });
    expect(within(card).getByText("Will send 2 letters and set 2 statuses to Declined")).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText(/Note/), "Needs a second look.");
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("No agent requests")).toBeInTheDocument();
    expect(screen.getByText("“Needs a second look.”")).toBeInTheDocument();
    expect((await services.api.getApplication(MOCK_IDS.pineRidge)).status).toBe("submitted");
  });

  it("approves a request and the action runs", async () => {
    const services = await riverbend();
    open("/w/riverbend/approvals", services);
    const card = await screen.findByRole("article", { name: /Approval request/ });
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(async () => expect((await services.api.getApplication(MOCK_IDS.pineRidge)).status).toBe("declined"));
    expect(await screen.findAllByText("Approved and done")).not.toHaveLength(0);
  });

  it("adds a human gate but never removes a locked one", async () => {
    const services = await riverbend();
    open("/w/riverbend/settings/mcp", services);
    const locked = await screen.findByRole("switch", { name: "Commit decisions requires approval (locked)" });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("aria-checked", "true");
    const optional = screen.getByRole("switch", { name: "Request a revision requires approval" });
    expect(optional).toHaveAttribute("aria-checked", "false");
    await userEvent.click(optional);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Request a revision requires approval" })).toHaveAttribute("aria-checked", "true"));
    expect(((await services.api.workspaceRecord(IDS.riverbend)).settings as { gatedTools?: string[] }).gatedTools).toEqual(["request_revision"]);
  });
});

describe("OAuth consent", () => {
  it("grants only the ticked scopes to the chosen workspace and returns to the client", async () => {
    const services = await riverbend();
    const decide = vi.spyOn(services.api, "decideConsent");
    const go = vi.spyOn(browser, "go").mockImplementation(() => {});
    open("/consent?req=signed-request", services);
    expect(await screen.findByRole("heading", { level: 1, name: "Claude wants to connect to OpenGrants GMS" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Riverbend Community Foundation/ })).toBeChecked());
    expect(screen.getByText(/Sign an agreement/).closest("li")).toHaveTextContent("always a person");
    await userEvent.click(screen.getByRole("checkbox", { name: /communications:write/ }));
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(expect.stringContaining("code=mock-code")));
    expect(decide).toHaveBeenCalledWith({ req: "signed-request", workspaceId: IDS.riverbend, approve: true, scopes: ["applications:read", "applications:write", "reviews:read"] });
  });

  it("denies without granting anything", async () => {
    const services = await riverbend();
    const go = vi.spyOn(browser, "go").mockImplementation(() => {});
    open("/consent?req=signed-request", services);
    await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(expect.stringContaining("error=access_denied")));
  });

  it("sends a signed-out person to sign in first", async () => {
    open("/consent?req=signed-request", createMockServices({ session: null }));
    await waitFor(() => expect(where()).toContain("/signin"));
  });
});
