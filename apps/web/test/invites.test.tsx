// SPDX-License-Identifier: AGPL-3.0-only
// Invite someone into a draft (v1.7.0) on screen, against the mock API: the picker's "Invite
// someone by email" on outside questions and built-in sections, the dialog and what it promises,
// waiting invitations masked in the picker, no second email to a waiting address, the one-time
// note, landing on the draft from the link, and the cowriter's narrower view.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { provideMockApplicantStore } from "../src/api/applicantHooks.ts";
import { mockInvitesStore } from "../src/api/invitesHooks.ts";
import { landingPath } from "../src/api/invites.ts";
import { mockOutsideStore, provideOutsideApi } from "../src/api/outsideHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { APPLICANT_IDS, seedApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_COWRITER_TOKEN } from "../src/mocks/invites.ts";
import { createMockOutsideApi, OUTSIDE_IDS } from "../src/mocks/outside.ts";

function open(path: string, setup?: (services: ReturnType<typeof createMockServices>) => void) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  provideMockApplicantStore(services, store);
  setup?.(services);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...view, store, services, outside: mockOutsideStore(services), invites: mockInvitesStore(services) };
}
const NW = `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`;

describe("the assignee picker's invitation choice (WCAG 3.2.2)", () => {
  it("does not open the dialog while the keyboard moves through the closed picker; Enter opens it", async () => {
    open(NW);
    const q2 = await screen.findByRole("article", { name: /How will you measure success/ });
    const picker = within(q2).getByRole("combobox", { name: "Who writes question 2" });
    await within(picker).findByRole("option", { name: "Invite someone by email…" });
    // Arrowing in a closed select changes its value on Windows and Linux.
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.change(picker, { target: { value: "__invite__" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(picker).toHaveValue("__invite__");
    expect(picker).toHaveAccessibleDescription("Press Enter to invite someone by email.");
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Invite someone to help write this" })).toBeInTheDocument();
  });
});

describe("invite someone into an outside draft", () => {
  it("offers it in the assignee picker, says what happens, sends once and lists the address masked", async () => {
    const o = open(NW);
    const q2 = await screen.findByRole("article", { name: /How will you measure success/ });
    const picker = within(q2).getByRole("combobox", { name: "Who writes question 2" });
    expect(await within(picker).findByRole("option", { name: "Invite someone by email…" })).toBeInTheDocument();
    await userEvent.selectOptions(picker, "Invite someone by email…");
    const dialog = await screen.findByRole("dialog", { name: "Invite someone to help write this" });
    expect(dialog).toHaveTextContent("Family Navigation Expansion · How will you measure success?");
    expect(dialog).toHaveTextContent("can open only this application and write its answers");
    expect(dialog).toHaveTextContent("There are no reminders");
    expect(dialog).toHaveTextContent("Nothing is read from your contacts");
    expect(dialog).toHaveTextContent("Your workspace can send 20 more invitations today.");
    await userEvent.type(within(dialog).getByLabelText(/Their email address/), "Priya@Writers.example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Invitation sent to p…@writers.example")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Not assigned until they accept; the picker shows them waiting.
    expect(o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[1]!.assigneeUserId).toBe(APPLICANT_IDS.jamal);
    expect(await within(picker).findByRole("option", { name: "Invited: p…@writers.example (waiting)" })).toBeDisabled();
    expect(o.invites.invitations.filter((i) => i.email === "priya@writers.example")).toHaveLength(1);

    // A second invitation to the waiting address is refused: that would be a reminder.
    await userEvent.selectOptions(picker, "Invite someone by email…");
    const again = await screen.findByRole("dialog", { name: "Invite someone to help write this" });
    await userEvent.type(within(again).getByLabelText(/Their email address/), "priya@writers.example");
    await userEvent.click(within(again).getByRole("button", { name: "Send invitation" }));
    expect(await within(again).findByText(/already has an invitation waiting/)).toBeInTheDocument();
    expect(o.invites.invitations.filter((i) => i.email === "priya@writers.example")).toHaveLength(1);
  });

  it("shows the one-time note until it is dismissed, and it stays dismissed", async () => {
    const o = open(NW);
    const note = await screen.findByRole("region", { name: "Writing with others" });
    expect(note).toHaveTextContent("Writing with others? Invite a teammate");
    await userEvent.click(within(note).getByRole("button", { name: "Invite a teammate" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite someone to help write this" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Writing with others" })).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Writing with others" })).not.toBeInTheDocument());
    expect(o.invites.dismissed).toEqual(["invite_teammate"]);
    o.unmount();
    // A fresh page for the same person: still dismissed.
    render(
      <MemoryRouter initialEntries={[NW]}>
        <App services={o.services} />
      </MemoryRouter>,
    );
    await screen.findByRole("article", { name: /How will you measure success/ });
    expect(screen.queryByRole("region", { name: "Writing with others" })).not.toBeInTheDocument();
  });

  it("lands on the draft from the link, with the question assigned", async () => {
    const o = open(`/invitations/draft?token=${MOCK_COWRITER_TOKEN}`);
    const q3 = await screen.findByRole("article", { name: /history and mission/ });
    await waitFor(() => expect(within(q3).getByRole("combobox", { name: "Who writes question 3" })).toHaveValue(APPLICANT_IDS.maria));
    expect(o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[2]!.assigneeUserId).toBe(APPLICANT_IDS.maria);
    expect(o.invites.invitations[0]!.acceptedAt).not.toBeNull();
  });

  it("says plainly when the link has been used", async () => {
    open(`/invitations/draft?token=gms_inv_not_a_real_one`);
    expect(await screen.findByText("This invitation can't be used")).toBeInTheDocument();
  });

  it("gives a cowriter the questions and their answers, nothing else", async () => {
    open(NW, (services) => {
      const outside = mockOutsideStore(services);
      const api = createMockOutsideApi({ session: () => services.auth.getSession(), applicant: seedApplicantStore(), store: outside });
      provideOutsideApi(services, { ...api, get: async (id) => ({ ...(await api.get(id)), cowriter: true }) });
    });
    expect(await screen.findByText("You were invited to help write this application")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([expect.stringContaining("Questions")]);
    expect(screen.queryByRole("button", { name: "Mark as submitted" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste questions" })).not.toBeInTheDocument();
    const q1 = screen.getByRole("article", { name: /Describe the need/ });
    expect(within(q1).queryByRole("button", { name: "Edit question 1" })).not.toBeInTheDocument();
    expect(within(q1).queryByRole("combobox", { name: "Who writes question 1" })).not.toBeInTheDocument();
    expect(within(q1).getByRole("button", { name: "Save answer" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Writing with others" })).not.toBeInTheDocument();
  });
});

describe("invite someone into a built-in application's section", () => {
  it("offers it in the section picker", async () => {
    const o = open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appHealth}/edit`);
    await userEvent.click(await screen.findByRole("tab", { name: "Assignments" }));
    const picker = await screen.findByRole("combobox", { name: "Project" });
    await userEvent.selectOptions(picker, await within(picker).findByRole("option", { name: "Invite someone by email…" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite someone to help write this" });
    expect(dialog).toHaveTextContent("When they accept, “Project” is assigned to them");
    await userEvent.type(within(dialog).getByLabelText(/Their email address/), "sam@writers.example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Invitation sent to s…@writers.example")).toBeInTheDocument();
    expect(o.invites.invitations.at(-1)!.draft).toMatchObject({ kind: "application", section: "Project" });
  });

  it("refuses an address already on the team", async () => {
    open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appHealth}/edit`);
    await userEvent.click(await screen.findByRole("tab", { name: "Assignments" }));
    const picker = await screen.findByRole("combobox", { name: "Organization" });
    await userEvent.selectOptions(picker, await within(picker).findByRole("option", { name: "Invite someone by email…" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite someone to help write this" });
    await userEvent.type(within(dialog).getByLabelText(/Their email address/), "jamal.reed@aldercreek.example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await within(dialog).findByText(/already on your team/)).toBeInTheDocument();
  });
});

describe("landing paths", () => {
  it("opens the question or section the person was asked to write", () => {
    expect(landingPath("alder-creek", { kind: "outside_application", id: "abc", questionId: "q1", formId: null, section: null })).toBe("/w/alder-creek/outside/abc?tab=questions&question=q1");
    expect(landingPath("alder-creek", { kind: "application", id: "app_1", questionId: null, formId: "frm_2", section: "Budget and attachments" })).toBe("/w/alder-creek/applications/app_1/edit?section=Budget%20and%20attachments");
    expect(landingPath("alder-creek", null)).toBe("/w/alder-creek");
  });
});
