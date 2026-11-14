// SPDX-License-Identifier: AGPL-3.0-only
// Write faster, win and keep it on screen, against the mock API: the AI draft panel (accept, edit,
// discard; hidden when the assistant is off), the library insert that offers the variant fitting
// the limit, the guidelines reader in the paste dialog, the vault upload refusal, the go/no-go
// scorecard behind its setting, the obligation series editor, outside awards in Awarded funding,
// the funding summary, and the fixes: the builder's preview card, the forecasted label, and the
// consulting preview cut where the email cuts.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { provideMockApplicantStore } from "../src/api/applicantHooks.ts";
import { mockOutsideStore } from "../src/api/outsideHooks.ts";
import { mockWriteKeepStore } from "../src/api/writeKeepHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { fullStoreFor } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { SentAnswers } from "../src/screens/applicant/outside/dialogs.tsx";

function open(path: string, opts: { store?: ApplicantStore; assist?: boolean } = {}) {
  const services = createMockServices({ session: demoSession() });
  const store = opts.store ?? seedApplicantStore();
  if (opts.assist) fullStoreFor(store).assist = { enabled: true, quota: { used: 3, limit: 100, remaining: 97 } };
  provideMockApplicantStore(services, store);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...view, store, outside: mockOutsideStore(services), wk: mockWriteKeepStore(services) };
}
const NW = `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`;
const nwQuestion = (o: ReturnType<typeof open>, i: number) => o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[i]!;

describe("the AI draft panel", () => {
  it("is not offered when the assistant is off", async () => {
    open(NW);
    const q1 = await screen.findByRole("article", { name: /Describe the need/ });
    expect(within(q1).getByRole("button", { name: "Insert from library" })).toBeInTheDocument();
    expect(within(q1).queryByRole("button", { name: "Draft with AI" })).not.toBeInTheDocument();
  });

  it("drafts from the library, shows what it used and what to check, and accepting saves an AI-marked version", async () => {
    const o = open(NW, { assist: true });
    const q1 = await screen.findByRole("article", { name: /Describe the need/ });
    await userEvent.click(await within(q1).findByRole("button", { name: "Draft with AI" }));
    const panel = within(q1).getByRole("region", { name: "AI draft" });
    expect(panel).toHaveTextContent("97 of 100 AI drafts left this month");
    await userEvent.click(within(panel).getByRole("button", { name: "Write a draft" }));
    const draft = await within(panel).findByRole("status", { name: "The draft" });
    expect(draft.querySelector("mark")).toHaveTextContent("[what this grant would pay for]");
    expect(draft).toHaveTextContent("Fill in before you use it: [what this grant would pay for]");
    expect(within(draft).getByRole("list", { name: "Library answers used" })).toHaveTextContent("Need");
    expect(within(draft).getByText("Check these figures")).toBeInTheDocument();
    // Nothing is saved by drafting.
    expect(nwQuestion(o, 0).versions).toHaveLength(2);
    await userEvent.click(within(panel).getByRole("button", { name: "Accept the draft" }));
    await waitFor(() => expect(nwQuestion(o, 0).versions).toHaveLength(3));
    expect(nwQuestion(o, 0).versions[2]!.provenance).toBe("assist");
    expect(await screen.findByRole("note", { name: "AI use" })).toHaveTextContent("question 1 was drafted with AI");
  });

  it("puts the draft in the editor to edit, and the saved version is still marked as AI; discard leaves nothing", async () => {
    const o = open(NW, { assist: true });
    const q2 = await screen.findByRole("article", { name: /How will you measure success/ });
    await userEvent.click(await within(q2).findByRole("button", { name: "Draft with AI" }));
    const panel = within(q2).getByRole("region", { name: "AI draft" });
    await userEvent.click(within(panel).getByRole("button", { name: "Write a draft" }));
    await within(panel).findByRole("status", { name: "The draft" });
    await userEvent.click(within(panel).getByRole("button", { name: "Discard" }));
    expect(within(panel).queryByRole("status", { name: "The draft" })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Write a draft" }));
    await within(panel).findByRole("status", { name: "The draft" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit before saving" }));
    expect(within(q2).getByText("Unsaved AI draft")).toBeInTheDocument();
    const box = within(q2).getByRole("textbox", { name: "Answer to question 2" });
    fireEvent.change(box, { target: { value: `${(box as HTMLTextAreaElement).value} We report quarterly.` } });
    await userEvent.click(within(q2).getByRole("button", { name: "Save answer" }));
    await waitFor(() => expect(nwQuestion(o, 1).versions).toHaveLength(1));
    expect(nwQuestion(o, 1).versions[0]!.provenance).toBe("assist");
    expect(nwQuestion(o, 1).versions[0]!.body).toMatch(/We report quarterly\.$/);
  });
});

describe("writing", () => {
  it("inserts the library version that fits the question's limit, and shows when the answer needs checking", async () => {
    const o = open(NW);
    o.wk.library.need = { lastVerifiedAt: null, variants: { short: "Families travel far for care." }, tags: [] };
    const q = await screen.findByRole("article", { name: /How will you measure success/ });
    // Question 2 allows 1,500 characters: the full Need answer fits, so it is offered first.
    await userEvent.click(within(q).getByRole("button", { name: "Insert from library" }));
    const dialog = screen.getByRole("dialog", { name: "Insert from answer library" });
    await waitFor(() => expect(within(dialog).getByLabelText("Version")).toHaveValue("full"));
    expect(within(dialog).getByText(/Needs checking · never verified/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Version"), "short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(nwQuestion(o, 1).versions).toHaveLength(1));
    expect(nwQuestion(o, 1).versions[0]).toMatchObject({ body: "Families travel far for care.", provenance: "library" });
  });

  it("reads a funder's guidelines in the paste dialog and adds the documents to the checklist", async () => {
    const o = open(`/w/alder-creek/outside/${OUTSIDE_IDS.harvest}`, { assist: true });
    await userEvent.click((await screen.findAllByRole("button", { name: "Paste questions" }))[0]!);
    const dialog = screen.getByRole("dialog", { name: "Paste the funder’s questions" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Read the funder’s guidelines" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "The funder’s guidelines" }), { target: { value: "Winter grants\n\n1. What will the grant pay for? (100 words)\n\nPlease include a project budget." } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Read the guidelines" }));
    const docs = await within(dialog).findByRole("group", { name: "Documents the funder asks for" });
    expect(docs).toHaveTextContent("Project budget");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save 1 question and 1 document" }));
    expect(await screen.findByText("1 question added · 1 document added to the checklist")).toBeInTheDocument();
    expect(o.outside.applications.find((a) => a.id === OUTSIDE_IDS.harvest)!.requiredDocuments).toEqual([{ label: "Project budget", documentId: null, status: "needed" }]);
  });
});

describe("the vault and the checklist", () => {
  it("refuses a bank letter before anything is sent", async () => {
    open("/w/alder-creek/organization/documents");
    await userEvent.click(await screen.findByRole("button", { name: "Add a document" }));
    const dialog = screen.getByRole("dialog", { name: "Add a document to the vault" });
    expect(dialog).toHaveTextContent("Never upload bank or identity paperwork");
    await userEvent.upload(within(dialog).getByLabelText("Choose a file"), new File(["x"], "Voided check.pdf", { type: "application/pdf" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("looks like bank or tax paperwork");
    expect(within(dialog).getByRole("button", { name: "Add to the vault" })).toBeDisabled();
  });

  it("uses a vault document for a required one", async () => {
    const o = open(`${NW}?tab=checklist`);
    const req = await screen.findByRole("region", { name: "Required documents" });
    await userEvent.click(await within(req).findByRole("button", { name: "Use from vault: FY2026 audited financial statements.pdf" }));
    await waitFor(() => expect(o.outside.applications[0]!.requiredDocuments[1]).toMatchObject({ status: "attached" }));
    expect(await within(req).findByText("Expires in 21 days")).toBeInTheDocument();
  });
});

describe("go/no-go", () => {
  it("shows the scorecard at Deciding only when the workspace turns it on", async () => {
    const off = open(`/w/alder-creek/outside/${OUTSIDE_IDS.meadow}`);
    await screen.findByRole("heading", { level: 1, name: "Senior Ride Program" });
    expect(screen.queryByRole("region", { name: "Go or no-go?" })).not.toBeInTheDocument();
    off.unmount();
    const services = createMockServices({ session: demoSession() });
    provideMockApplicantStore(services, seedApplicantStore());
    mockWriteKeepStore(services).settings.goNoGoEnabled = true;
    render(
      <MemoryRouter initialEntries={[`/w/alder-creek/outside/${OUTSIDE_IDS.meadow}`]}>
        <App services={services} />
      </MemoryRouter>,
    );
    const card = await screen.findByRole("region", { name: "Go or no-go?" });
    await userEvent.click(within(card).getByRole("radio", { name: "No, it does not" }));
    expect(within(card).getByText("An application that fails the funder’s rules can only be a no-go.")).toBeInTheDocument();
    for (const name of [/^Fit with our work: 2,/, /^Capacity to do it: 2,/, /^Effort against the amount: 2,/, /^Relationship with the funder: 2,/]) await userEvent.click(within(card).getByRole("radio", { name }));
    expect(within(card).getByRole("button", { name: "Go: start the application" })).toBeDisabled();
    await userEvent.click(within(card).getByRole("button", { name: "No-go: not pursuing" }));
    expect(await screen.findByText("No-go. Moved to Not pursuing.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Go/no-go" })).toHaveTextContent("2.0 of 5");
  });
});

describe("keeping an award", () => {
  it("lists outside awards beside built-in ones in Awarded funding", async () => {
    open("/w/alder-creek/grants");
    const table = await screen.findByRole("table", { name: "Grants" });
    const row = await within(table).findByRole("row", { name: /School-Based Health Clinics/ });
    expect(row).toHaveTextContent("Outside award");
    expect(row).toHaveTextContent("$60,000");
    expect(within(table).getByRole("row", { name: /Clinic Navigation Pilot/ })).toHaveTextContent("On this GMS");
  });

  it("adds a report series, says how many it makes, and refuses more than 60", async () => {
    const o = open(`/w/alder-creek/grants/outside/${OUTSIDE_IDS.cedar}`);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add an obligation" }))[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add an obligation" });
    await userEvent.type(within(dialog).getByLabelText(/^Title/), "Quarterly data");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Repeats" }));
    const every = within(dialog).getByLabelText("Every (months)");
    fireEvent.change(every, { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2040-01-01" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("That makes more than 60");
    expect(within(dialog).getByRole("button", { name: "Add the series" })).toBeDisabled();
    fireEvent.change(every, { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: o.outside.applications.find((a) => a.id === OUTSIDE_IDS.cedar)!.grantEnd! } });
    expect(within(dialog).getByText(/^Makes \d+:/)).toBeInTheDocument();
    const before = o.wk.obligations.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Add the series" }));
    await waitFor(() => expect(o.wk.obligations.length).toBeGreaterThan(before + 1));
    expect(new Set(o.wk.obligations.slice(before).map((x) => x.seriesId)).size).toBe(1);
  });

  it("counts the funding summary by fiscal year", async () => {
    open("/w/alder-creek/summary");
    const table = await screen.findByRole("table", { name: "Funding by fiscal year" });
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "One-page PDF for the board" })).toBeInTheDocument();
  });
});

describe("fixes", () => {
  it("the consulting preview cuts the answers where the email does, and marks the cut", () => {
    render(<SentAnswers answers={[{ prompt: "Need", body: "a".repeat(19_000) }, { prompt: "Plan", body: "b".repeat(5_000) }, { prompt: "Team", body: "c" }]} />);
    expect(screen.getByText(/Your current answers \(2 of 3\), cut at 20,000 characters/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("The email stops here, at 20,000 characters.");
    expect(screen.getByText("1 more question is not in the email. The team can ask you for the rest.")).toBeInTheDocument();
  });

  it("the builder's preview card offers Apply only when the public page does", async () => {
    const forecast = open("/w/riverbend/opportunities/youth-opportunity-2028/edit");
    const card = await screen.findByRole("region", { name: "Live preview · public card" });
    expect(await within(card).findByText("Not taking applications yet")).toBeInTheDocument();
    expect(within(card).queryByText("Apply")).not.toBeInTheDocument();
    forecast.unmount();
    open("/w/riverbend/opportunities/community-health-2027/edit");
    const open2 = await screen.findByRole("region", { name: "Live preview · public card" });
    expect(await within(open2).findByText("Apply")).toBeInTheDocument();
  });

  it("the Applications step says a forecasted opportunity is forecasted", async () => {
    open("/w/riverbend/opportunities/youth-opportunity-2028/edit#applications");
    expect(await screen.findByText("Forecasted, not taking applications yet")).toBeInTheDocument();
    expect(screen.queryByText("Published, not taking applications")).not.toBeInTheDocument();
  });
});
