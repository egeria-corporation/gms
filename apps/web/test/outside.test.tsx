// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere on screen, against the mock API: the counters and their limit, the paste preview,
// the people-only dialogs (submitted, decision, consulting), the pipeline, starting from Find
// funding and from a pasted link, funder records, the calendar feed and the CSV import.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { provideMockApplicantStore } from "../src/api/applicantHooks.ts";
import { mockOutsideStore } from "../src/api/outsideHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { countText } from "../src/lib/outside.ts";
import { seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { fullStoreFor } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { Counters } from "../src/screens/applicant/outside/QuestionsTab.tsx";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function open(path: string, opts: { store?: ApplicantStore } = {}) {
  const services = createMockServices({ session: demoSession() });
  const store = opts.store ?? seedApplicantStore();
  provideMockApplicantStore(services, store);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return { ...view, store, outside: mockOutsideStore(services) };
}
const where = () => screen.getByTestId("where").textContent ?? "";
const NW = `/w/alder-creek/outside/${OUTSIDE_IDS.northwind}`;

describe("counters", () => {
  it("highlight the funder's limit and say in words when an answer is over it", () => {
    const { rerender } = render(<Counters counts={countText("one two three")} limitKind="words" limitValue={5} />);
    expect(screen.getByText("Within the limit")).toBeInTheDocument();
    expect(document.querySelector('[data-active="true"]')).toHaveTextContent("3 / 5 words");
    rerender(<Counters counts={countText("one two three four five six seven")} limitKind="words" limitValue={5} />);
    expect(screen.getByText("Over the limit by 2 words")).toBeInTheDocument();
    rerender(<Counters counts={countText("abc def")} limitKind="chars_no_spaces" limitValue={5} />);
    expect(screen.getByText("Over the limit by 1 characters without spaces")).toBeInTheDocument();
    rerender(<Counters counts={countText("abc")} limitKind={null} limitValue={null} />);
    expect(screen.queryByText(/limit/)).not.toBeInTheDocument();
  });
});

describe("the outside application screen", () => {
  it("pastes questions, reviews the detected limits, and saves only those kept", async () => {
    const o = open(NW);
    await screen.findByRole("heading", { level: 1, name: "Family Navigation Expansion" });
    await userEvent.click(screen.getAllByRole("button", { name: "Paste questions" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Paste the funder’s questions" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Questions" }), { target: { value: "1. Budget narrative (500 words)\n2. Board list, max 800 chars\n3. Anything else?" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Find the questions" }));
    const items = within(await within(dialog).findByRole("list", { name: "Proposed questions" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("500 words (found in the text)");
    expect(items[1]).toHaveTextContent("800 characters (found in the text)");
    expect(items[2]).toHaveTextContent("No limit");
    // Nothing is saved until the person saves.
    expect(o.outside.applications[0]!.questions).toHaveLength(3);
    await userEvent.click(within(items[2]!).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save 2 questions" }));
    expect(await screen.findByText("2 questions added")).toBeInTheDocument();
    const saved = o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions;
    expect(saved.slice(3).map((q) => [q.prompt, q.limitKind, q.limitValue])).toEqual([
      ["Budget narrative (500 words)", "words", 500],
      ["Board list, max 800 chars", "chars", 800],
    ]);
  });

  it("writes an answer with live counts, inserts a fact at the cursor, and keeps versions", async () => {
    const o = open(NW);
    const q2 = await screen.findByRole("article", { name: /How will you measure success/ });
    const box = within(q2).getByRole("textbox", { name: "Answer to question 2" });
    fireEvent.change(box, { target: { value: "Served by " } });
    expect(within(q2).getByText(/^10 \/ 1,500 characters/)).toBeInTheDocument();
    await userEvent.click(within(q2).getByRole("button", { name: "Insert a fact" }));
    const facts = screen.getByRole("dialog", { name: "Insert a fact about your organization" });
    await userEvent.click(within(facts).getByRole("button", { name: "Insert Legal name" }));
    expect(box).toHaveValue("Served by Alder Creek Family Services");
    await userEvent.click(within(q2).getByRole("button", { name: "Save answer" }));
    expect(await within(q2).findByText("Saved as version 1")).toBeInTheDocument();
    const q = o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[1]!;
    expect(q.versions.map((v) => [v.version, v.body, v.provenance])).toEqual([[1, "Served by Alder Creek Family Services", "user"]]);
    expect(q.status).toBe("draft");

    const q1 = screen.getByRole("article", { name: /Describe the need/ });
    await userEvent.click(within(q1).getByRole("button", { name: "Version history (2)" }));
    const history = screen.getByRole("dialog", { name: "Earlier versions" });
    expect(await within(history).findByText("Version 1")).toBeInTheDocument();
    await userEvent.click(within(history).getAllByRole("button", { name: "Put this version in the editor" })[1]!);
    expect(within(q1).getByRole("textbox", { name: "Answer to question 1" })).toHaveValue("Families in the Alder Creek valley travel more than forty minutes to reach a clinic.");
    expect(within(q1).getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("offers Fit to limit only when the assistant is on, and its draft goes in the editor unsaved", async () => {
    const store = seedApplicantStore();
    fullStoreFor(store).assist = { enabled: true, quota: null };
    open(NW, { store });
    const q1 = await screen.findByRole("article", { name: /Describe the need/ });
    await userEvent.click(await within(q1).findByRole("button", { name: "Fit to limit" }));
    const panel = within(q1).getByRole("region", { name: "Fit to limit" });
    await userEvent.click(within(panel).getByRole("button", { name: "Adapt to this question" }));
    await userEvent.click(await within(panel).findByRole("button", { name: "Put the draft in the editor" }));
    expect(within(q1).getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("marks it submitted (a method is required) and keeps the as-submitted copy", async () => {
    const o = open(NW);
    await screen.findByRole("heading", { level: 1, name: "Family Navigation Expansion" });
    await userEvent.click(screen.getAllByRole("button", { name: "Mark as submitted" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Mark as submitted" });
    // The portal is on record, so the method starts at the portal; clear it to see it is required.
    fireEvent.change(within(dialog).getByLabelText(/How you submitted/), { target: { value: "" } });
    expect(within(dialog).getByRole("button", { name: "Mark as submitted" })).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/How you submitted/), "email");
    await userEvent.type(within(dialog).getByLabelText("Confirmation number"), "NW-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as submitted" }));
    expect(await screen.findByText(/Marked as submitted/)).toBeInTheDocument();
    const rec = o.outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!;
    expect(rec).toMatchObject({ stage: "submitted", submissionMethod: "email", confirmationRef: "NW-77" });
    expect(rec.snapshotDocumentId).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Submission" }));
    const panel = screen.getByRole("tabpanel", { name: "Submission" });
    expect(within(panel).getByText("NW-77")).toBeInTheDocument();
    expect(within(panel).getByText(/- as submitted\.pdf$/)).toBeInTheDocument();
    expect(within(panel).getByText(rec.snapshotSha256!)).toBeInTheDocument();
  });

  it("records a decision: an award needs its amount; a decline keeps the next cycle", async () => {
    const o = open(`/w/alder-creek/outside/${OUTSIDE_IDS.pinecrest}`);
    await screen.findByRole("heading", { level: 1, name: "Youth Mentoring Pilot" });
    await userEvent.click(screen.getByRole("button", { name: "Record decision" }));
    let dialog = screen.getByRole("dialog", { name: "Record the decision" });
    await userEvent.clear(within(dialog).getByLabelText(/Amount awarded/));
    expect(within(dialog).getByRole("button", { name: "Record awarded" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Declined/ }));
    await userEvent.type(within(dialog).getByLabelText("What the funder said"), "Strong, but out of area this year.");
    fireEvent.change(within(dialog).getByLabelText("When to try again"), { target: { value: "2027-09-01" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Record declined" }));
    expect(await screen.findByText("Decision recorded: Declined")).toBeInTheDocument();
    expect(o.outside.applications.find((a) => a.id === OUTSIDE_IDS.pinecrest)).toMatchObject({ stage: "declined", decisionNotes: "Strong, but out of area this year.", nextCycleOn: "2027-09-01" });

    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByText("Reopened at Submitted")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record decision" }));
    dialog = screen.getByRole("dialog", { name: "Record the decision" });
    await userEvent.clear(within(dialog).getByLabelText(/Amount awarded/));
    await userEvent.type(within(dialog).getByLabelText(/Amount awarded/), "35000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record awarded" }));
    expect(await screen.findByText("Decision recorded: Awarded")).toBeInTheDocument();
    expect(o.outside.applications.find((a) => a.id === OUTSIDE_IDS.pinecrest)!.awardedAmount).toEqual({ amount: "35000.00", currency: "USD" });
  });

  it("shows exactly what a consulting request sends, sends it, and says when the team will reply", async () => {
    const o = open(NW);
    await screen.findByRole("heading", { level: 1, name: "Family Navigation Expansion" });
    await userEvent.click(screen.getByRole("button", { name: "Get help writing this" }));
    const dialog = screen.getByRole("dialog", { name: "Get help writing this" });
    expect(within(dialog).getByLabelText(/Your name/)).toHaveValue("Maria Santos");
    await userEvent.clear(within(dialog).getByLabelText(/Your email/));
    await userEvent.type(within(dialog).getByLabelText(/Your email/), "maria@aldercreek.example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview what will be sent" }));
    const preview = await within(dialog).findByRole("region", { name: "What will be sent" });
    expect(preview).toHaveTextContent("hello@agents.opengrants.io");
    expect(preview).toHaveTextContent("Consulting request: Family Navigation Expansion (Alder Creek Family Services)");
    expect(preview).toHaveTextContent("No answer text is sent.");
    // Changing anything asks for a fresh preview first.
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Include my current answers/ }));
    expect(within(dialog).queryByRole("region", { name: "What will be sent" })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview what will be sent" }));
    expect(await within(dialog).findByText(/Your current answers \(3\)/)).toBeInTheDocument();
    // As the email carries it: an unanswered question goes with "(no answer yet)".
    expect(within(dialog).getByText("(no answer yet)")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send the request" }));
    expect(await within(dialog).findByText("OpenGrants consulting can start right away. The team will reply to maria@aldercreek.example.")).toBeInTheDocument();
    expect(o.outside.consulting).toHaveLength(1);
    expect(o.outside.consulting[0]!.preview.answers).toHaveLength(3);
  });

  it("is read-only while archived", async () => {
    open(NW);
    await screen.findByRole("heading", { level: 1, name: "Family Navigation Expansion" });
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("This application is archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as submitted" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(await screen.findAllByRole("button", { name: "Save answer" })).not.toHaveLength(0);
  });
});

describe("the pipeline", () => {
  it("lists built-in and outside applications and filters by stage, owner and view", async () => {
    open("/w/alder-creek/applications");
    const table = await screen.findByRole("table", { name: "Applications" });
    expect(within(table).getByRole("link", { name: "Family Navigation Expansion" })).toHaveAttribute("href", NW);
    expect(within(table).getByRole("link", { name: "Community Clinic Capacity" })).toBeInTheDocument();
    expect(within(table).getAllByText("On this GMS").length).toBeGreaterThan(0);

    await userEvent.selectOptions(screen.getByLabelText("Stage"), "prospect");
    expect(within(screen.getByRole("table", { name: "Applications" })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Food Security Planning Grant" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Stage"), "");
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "none");
    expect(screen.getByRole("link", { name: "Food Security Planning Grant" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Family Navigation Expansion" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Owner"), "");
    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(where()).toContain("view=board");
    const drafting = screen.getByRole("region", { name: /^Drafting, \d+$/ });
    expect(within(drafting).getByRole("article", { name: "Family Navigation Expansion" })).toBeInTheDocument();
    expect(within(drafting).getByRole("article", { name: "Mobile Health Navigation for Rural Families" })).toBeInTheDocument();
  });

  it("starts from a pasted link: this GMS opens the built-in application, anything else is tracked", async () => {
    const a = open("/w/alder-creek/applications");
    await userEvent.click(await screen.findByRole("button", { name: "New application" }));
    let dialog = screen.getByRole("dialog", { name: "New application" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Paste a link/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Link/), "https://gms.opengrants.io/f/riverbend/o/housing-stability-2027");
    expect(within(dialog).getByText("This opportunity is on this GMS")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Go to the application" }));
    await waitFor(() => expect(where()).toMatch(/^\/w\/alder-creek\/applications\/app_[0-9a-f-]{36}\/edit$/));
    a.unmount();

    const b = open("/w/alder-creek/applications");
    await userEvent.click(await screen.findByRole("button", { name: "New application" }));
    dialog = screen.getByRole("dialog", { name: "New application" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Paste a link/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Link/), "https://northwind.example/grants/rural-capacity");
    await userEvent.type(within(dialog).getByLabelText(/^Title/), "Rural Capacity Grant");
    await userEvent.type(within(dialog).getByLabelText(/^Funder/), "northwind health trust");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start application" }));
    await waitFor(() => expect(where()).toMatch(/^\/w\/alder-creek\/outside\/oap_/));
    expect(b.outside.applications[0]).toMatchObject({ source: "link", listingUrl: "https://northwind.example/grants/rural-capacity", funderRecordId: OUTSIDE_IDS.recNorthwind, stage: "drafting" });
  });

  it("imports a spreadsheet after checking every row", async () => {
    const o = open("/w/alder-creek/applications");
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog", { name: "Import applications from a spreadsheet" });
    fireEvent.change(within(dialog).getByLabelText("Or paste the CSV"), { target: { value: "Title,Funder,Due,Ask\nCapacity 2027,Larkspur Foundation,2027-03-01,30000\nNo funder,,2027-04-01,10" } });
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Title");
    expect(within(dialog).getByLabelText(/^Full application due/)).toHaveValue("Due");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check the rows" }));
    const rows = within(await within(dialog).findByRole("table", { name: "Rows checked" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Ready");
    expect(rows[2]).toHaveTextContent("No funder");
    const before = o.outside.applications.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Import 1 application" }));
    expect(await screen.findByText("1 application imported")).toBeInTheDocument();
    expect(o.outside.applications).toHaveLength(before + 1);
    expect(o.outside.applications[0]).toMatchObject({ title: "Capacity 2027", source: "import", fullDue: "2027-03-01", askAmount: { amount: "30000.00", currency: "USD" } });
  });
});

describe("Find funding", () => {
  it("starts an outside application from an OpenGrants result, and saves another as a prospect", async () => {
    const store = seedApplicantStore();
    store.openGrants!.push({ id: "og_food", title: "Food Access Fund", funder: "Larkspur Foundation", summary: "Pantry grants.", amount: "$10,000", deadline: "2027-02-01", url: "https://larkspur.example/food", gms: null });
    const o = open("/w/alder-creek/find", { store });
    await userEvent.click(await screen.findByRole("tab", { name: "OpenGrants index" }));
    await userEvent.click(screen.getByRole("button", { name: "Match to my profile" }));
    const food = await screen.findByRole("article", { name: "Food Access Fund" });
    await userEvent.click(within(food).getByRole("button", { name: "Save" }));
    expect(await within(food).findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(o.outside.applications[0]).toMatchObject({ title: "Food Access Fund", source: "opengrants", sourceRef: "og_food", stage: "prospect", fullDue: "2027-02-01" });

    // A listing on this GMS with an open competition is the built-in application.
    const gms = screen.getByRole("article", { name: "Community Health Grants 2027" });
    expect(within(gms).getByRole("link", { name: "Continue application" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Saved/ }));
    const saved = screen.getByRole("list", { name: "Saved" });
    expect(within(saved).getByRole("link", { name: "Food Access Fund" })).toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "Food Security Planning Grant" })).toBeInTheDocument();
    await userEvent.click(within(saved).getAllByRole("button", { name: "Start application" })[0]!);
    await waitFor(() => expect(where()).toMatch(/^\/w\/alder-creek\/outside\/oap_/));
    expect(o.outside.applications.find((a) => a.sourceRef === "og_food")!.stage).toBe("drafting");
  });

  it("shows details with the original listing, and starts from there", async () => {
    open("/w/alder-creek/find?tab=index");
    await userEvent.click(await screen.findByRole("button", { name: "Match to my profile" }));
    const rural = await screen.findByRole("article", { name: "Rural Health Network Development Planning" });
    await userEvent.click(within(rural).getByRole("button", { name: "Details" }));
    const details = screen.getByRole("dialog", { name: "Rural Health Network Development Planning" });
    expect(details).toHaveTextContent("Up to $100,000");
    expect(within(details).getByRole("link", { name: /Open original listing/ })).toHaveAttribute("href", "https://opengrants.io/grants/rural-health-network-planning");
    await userEvent.click(within(details).getByRole("button", { name: "Start application" }));
    await waitFor(() => expect(where()).toMatch(/^\/w\/alder-creek\/outside\/oap_/));
    expect(await screen.findByRole("heading", { level: 1, name: "Rural Health Network Development Planning" })).toBeInTheDocument();
  });

  it("lists opportunities not taking applications yet, with Save and no Start; alerts stay out of Saved", async () => {
    const store = seedApplicantStore();
    store.saved.push({ id: "11111111-1111-4111-8111-111111111111", source: "alert" as "gms", externalId: "rural health", title: "Alert: rural health", url: null, savedAt: "2026-11-01T00:00:00Z" });
    const o = open("/w/alder-creek/find", { store });
    const card = await screen.findByRole("article", { name: "Youth Mental Health Partnerships 2028" });
    expect(within(card).getByText("Not taking applications yet")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Start/ })).not.toBeInTheDocument();
    expect(within(card).queryByText(/eligib/i)).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));
    expect(await within(card).findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(o.store.saved.some((s) => s.source === "gms" && s.title === "Youth Mental Health Partnerships 2028")).toBe(true);
    expect(screen.getByRole("tab", { name: "Alerts" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Saved/ }));
    const saved = screen.getByRole("list", { name: "Saved" });
    expect(within(saved).getByText("Youth Mental Health Partnerships 2028")).toBeInTheDocument();
    expect(within(saved).queryByText("Alert: rural health")).not.toBeInTheDocument();
  });
});

describe("funder records and the calendar feed", () => {
  it("adds a funder, edits its contacts and shows past asks", async () => {
    open("/w/alder-creek/funders");
    const card = await screen.findByRole("region", { name: "Your funder records" });
    expect(await within(card).findByRole("link", { name: "Northwind Health Trust" })).toHaveAttribute("href", `/w/alder-creek/funders/${OUTSIDE_IDS.recNorthwind}`);
    await userEvent.click(within(card).getByRole("button", { name: "Add a funder" }));
    const dialog = screen.getByRole("dialog", { name: "Add a funder" });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), "Riverbend Community Foundation");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add funder" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" })).toBeInTheDocument();
    // A built-in application whose funder has the same name is listed as a name match.
    const asks = screen.getByRole("table", { name: "Past asks" });
    expect(within(asks).getByText(/matched by the funder’s name/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a contact" }));
    await userEvent.type(screen.getByLabelText(/^Name/, { selector: "#frc-n-0" }), "Dana Ortiz");
    await userEvent.type(screen.getByLabelText("Email", { selector: "#frc-e-0" }), "not-an-address");
    expect(screen.getByRole("button", { name: "Save contacts" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Email", { selector: "#frc-e-0" }));
    await userEvent.type(screen.getByLabelText("Email", { selector: "#frc-e-0" }), "dana@riverbend.example");
    await userEvent.click(screen.getByRole("button", { name: "Save contacts" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save contacts" })).toBeDisabled());
  });

  it("makes the calendar link once, and turns it off", async () => {
    const o = open("/w/alder-creek/settings");
    const card = await screen.findByRole("region", { name: "Calendar feed" });
    expect(card).toHaveTextContent("never answers or amounts");
    await userEvent.click(within(card).getByRole("button", { name: "Get a calendar link" }));
    const url = (await within(card).findByLabelText("Your calendar link")) as HTMLInputElement;
    expect(url.value).toMatch(/\/cal\/[0-9a-f]{48}\.ics$/);
    expect(url.value).toContain(o.outside.calendarFeed!.token);
    await userEvent.click(within(card).getByRole("button", { name: "Turn off the calendar link" }));
    expect(await within(card).findByText("The calendar link is off")).toBeInTheDocument();
    expect(o.outside.calendarFeed).toBeNull();
    expect(within(card).queryByLabelText("Your calendar link")).not.toBeInTheDocument();
  });
});
