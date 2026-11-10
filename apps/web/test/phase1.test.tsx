// SPDX-License-Identifier: AGPL-3.0-only
// Phase 1 screens against the mock API: each renders from data, and each write round-trips.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { ReadinessChecklist } from "../src/components/ui.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { jsonLd } from "../src/screens/public/OpportunityPage.tsx";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.hash}</output>;
}
const where = () => screen.getByTestId("where").textContent;

function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return services;
}

/** Services whose API has opened the Riverbend workspace, for asserting on what was written. */
async function riverbend() {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  return services;
}

describe("public funder page", () => {
  it("lists published opportunities in the funder's brand without a sign-in", async () => {
    open("/f/riverbend", createMockServices({ session: null }));
    expect(await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" })).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Community Health Grants 2027" }).closest("article")!;
    expect(within(card).getByText("$50,000 – $150,000")).toBeInTheDocument();
    expect(within(card).getByText("8–12 awards")).toBeInTheDocument();
    expect(within(card).getByText("Tribal government")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Apply to Community Health Grants 2027" })).toHaveAttribute("href", "/f/riverbend/o/community-health-2027");
    expect(screen.getByRole("heading", { name: "Youth Opportunity 2028" })).toBeInTheDocument();
    expect(document.querySelector(".gms.pub")).toHaveStyle({ "--tenant": "#1F6F8B" });
  });

  it("uses each tenant's accent and shows the empty state when nothing is open", async () => {
    const store = seedStore();
    store.workspaces[1]!.opportunities = [];
    open("/f/cascade-county", createMockServices({ session: null, store }));
    expect(await screen.findByRole("heading", { name: "No opportunities are open right now" })).toBeInTheDocument();
    expect(document.querySelector(".gms.pub")).toHaveStyle({ "--tenant": "#7A4F01" });
  });

  it("falls back to the OpenGrants accent when a tenant's pair fails contrast", async () => {
    const store = seedStore();
    store.workspaces[0]!.record.brand = { accent: "#9FE3CB", onAccent: "#FFFFFF" };
    open("/f/riverbend", createMockServices({ session: null, store }));
    await screen.findByRole("heading", { level: 1, name: "Riverbend Community Foundation" });
    expect(document.querySelector(".gms.pub")).toHaveStyle({ "--tenant": "#1F6F8B" });
  });

  it("answers an unknown handle with not found", async () => {
    open("/f/nobody", createMockServices({ session: null }));
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("public opportunity page", () => {
  it("shows funding, eligibility in plain language, stages and a form preview", async () => {
    open("/f/riverbend/o/community-health-2027", createMockServices({ session: null }));
    expect(await screen.findByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeInTheDocument();
    expect(screen.getByText("$50,000 – $150,000")).toBeInTheDocument();
    expect(screen.getByText("Organization type is 501(c)(3), Tribal government or Local government")).toBeInTheDocument();
    expect(screen.getByText("Annual revenue under $5,000,000")).toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Stages" });
    expect(within(stages).getByText("Letter of intent")).toBeInTheDocument();
    expect(within(stages).getByText("Full proposal")).toBeInTheDocument();
    expect((await screen.findAllByText(/pre-filled from Passport/)).length).toBeGreaterThan(0);
  });

  it("sends Apply to sign-in with the page as the return address", async () => {
    open("/f/riverbend/o/community-health-2027", createMockServices({ session: null }));
    const apply = await screen.findByRole("link", { name: /Apply with Passport/ });
    expect(apply).toHaveAttribute("href", `/signin?next=${encodeURIComponent("/f/riverbend/o/community-health-2027")}`);
  });

  it("links the CommonGrants record and describes the grant for search engines", async () => {
    const api = createMockServices({ session: null }).api;
    const data = await api.publicOpportunity("riverbend", "community-health-2027");
    expect(data.links.json).toMatch(/\/common-grants\/opportunities\/[0-9a-f-]{36}$/);
    expect(jsonLd(data, "https://gms.example/f/riverbend/o/community-health-2027")).toMatchObject({
      "@type": "MonetaryGrant",
      name: "Community Health Grants 2027",
      funder: { name: "Riverbend Community Foundation" },
      amount: { currency: "USD", minValue: "50000", maxValue: "150000" },
      applicationDeadline: "2027-04-30",
    });
    open("/f/riverbend/o/community-health-2027", createMockServices({ session: null }));
    await screen.findByRole("heading", { level: 1, name: "Community Health Grants 2027" });
    await waitFor(() => expect(document.querySelector('link[rel="alternate"][type="application/json"]')).toHaveAttribute("href", data.links.json));
  });

  it("does not offer Apply on a forecasted opportunity", async () => {
    open("/f/riverbend/o/youth-opportunity-2028", createMockServices({ session: null }));
    expect(await screen.findByText("This opportunity is forecasted")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply with Passport/ })).not.toBeInTheDocument();
  });
});

describe("programs", () => {
  it("lists programs and creates one through the API", async () => {
    const services = open("/w/riverbend/programs");
    const table = await screen.findByRole("table", { name: "Programs" });
    expect(within(table).getByRole("link", { name: "Community Health 2027" })).toBeInTheDocument();
    expect(within(table).getByText("$1,200,000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New program" }));
    const dialog = await screen.findByRole("dialog", { name: "New program" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create program" }));
    expect(within(dialog).getByText("Give the program a name")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), "Youth Opportunity 2028");
    await userEvent.type(within(dialog).getByLabelText("Fiscal year"), "2028");
    await userEvent.type(within(dialog).getByLabelText(/Budget/), "500,000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create program" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Youth Opportunity 2028" })).toBeInTheDocument();
    const saved = (await services.api.listPrograms()).find((p) => p.name === "Youth Opportunity 2028");
    expect(saved).toMatchObject({ fiscalYear: 2028, budgetAmountMinor: 50_000_000 });
    expect(where()).toBe(`/w/riverbend/programs/${saved!.id}`);
  });

  it("edits a program's budget", async () => {
    const services = open(`/w/riverbend/programs/${IDS.programHousing27}`);
    await userEvent.click(await screen.findByRole("button", { name: "Edit program" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit program" });
    const budget = within(dialog).getByLabelText(/Budget/);
    await userEvent.clear(budget);
    await userEvent.type(budget, "900000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save program" }));
    await waitFor(async () => expect((await services.api.listPrograms()).find((p) => p.id === IDS.programHousing27)!.budgetAmountMinor).toBe(90_000_000));
  });
});

describe("opportunity builder", () => {
  it("opens by slug and shows the saved rules as rows with the sentence applicants read", async () => {
    open("/w/riverbend/opportunities/community-health-2027/edit#who");
    const rules = await screen.findByRole("list", { name: "Eligibility rules" });
    expect(within(rules).getAllByRole("listitem")).toHaveLength(4);
    expect(within(rules).getByText("“Located in Oregon.”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tribal government", pressed: true })).toBeInTheDocument();
  });

  it("adds a rule in the editor and saves it as rules DSL", async () => {
    const services = open("/w/riverbend/opportunities/community-health-2027/edit#who");
    await screen.findByRole("list", { name: "Eligibility rules" });
    await userEvent.selectOptions(screen.getByLabelText("Rule to add"), "orgActive");
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByText("“Organization is active.”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove rule 2" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);

    await waitFor(async () => {
      const saved = await services.api.getOpportunity(IDS.oppHealth27);
      expect((saved.eligibilityRules as { all: { path: string }[] }).all.map((r) => r.path)).toEqual([
        "org.orgType.code",
        "org.customFields.verificationLevel.value",
        "profile.financials.annualRevenue",
        "org.status.value",
      ]);
    });
  });

  it("will not save a rule with no value, and says why", async () => {
    const services = open("/w/riverbend/opportunities/community-health-2027/edit#who");
    await screen.findByRole("list", { name: "Eligibility rules" });
    await userEvent.click(screen.getByRole("button", { name: "Remove Oregon" }));
    expect(screen.getByText(/Rules with no value can't be published/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    const saved = await services.api.getOpportunity(IDS.oppHealth27);
    expect(JSON.stringify(saved.eligibilityRules)).toContain('"OR"');
  });

  it("dry-runs the rules: unknown when revenue is not shared, never a silent pass", async () => {
    open("/w/riverbend/opportunities/community-health-2027/edit#who");
    await screen.findByRole("list", { name: "Eligibility rules" });
    await userEvent.click(screen.getByRole("button", { name: "New record, nothing shared" }));
    const result = await screen.findByRole("status", { name: "Test result" });
    expect(within(result).getByText("Unknown", { selector: ".bdg" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Out-of-state business" }));
    await waitFor(() => expect(within(screen.getByRole("status", { name: "Test result" })).getByText("Not eligible")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Verified 501(c)(3)" }));
    await waitFor(() => expect(within(screen.getByRole("status", { name: "Test result" })).getByText("Eligible")).toBeInTheDocument());
  });

  it("creates an opportunity, then publishes it to the public page", async () => {
    const services = open("/w/riverbend/opportunities/new");
    await userEvent.type(await screen.findByLabelText(/^Title/), "Senior Nutrition 2028");
    await userEvent.type(screen.getByLabelText("Summary"), "Meals and nutrition education for older adults.");
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    await waitFor(() => expect(where()).toMatch(/\/w\/riverbend\/opportunities\/opp_[0-9a-f-]+\/edit$/));
    const created = (await services.api.listOpportunities()).find((o) => o.title === "Senior Nutrition 2028")!;
    expect(created).toMatchObject({ slug: "senior-nutrition-2028", published: false });

    await userEvent.click(await screen.findByRole("link", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish as open" }));
    expect(await screen.findByText(/Published · live at/)).toBeInTheDocument();
    expect(await services.api.getOpportunity(created.id)).toMatchObject({ status: "open", published: true });
    expect((await services.api.publicFunder("riverbend")).opportunities.map((o) => o.slug)).toContain("senior-nutrition-2028");
  });

  it("checks amounts and dates before saving", async () => {
    open("/w/riverbend/opportunities/community-health-2027/edit#funding");
    const max = await screen.findByLabelText("Largest award");
    await userEvent.clear(max);
    await userEvent.type(max, "10");
    await userEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]!);
    expect(await screen.findByText("The largest award is smaller than the smallest")).toBeInTheDocument();
  });
});

describe("form builder", () => {
  const draftPath = async (services: Services) => {
    const draft = await services.api.createFormVersion(IDS.formLoi);
    return { path: `/w/riverbend/forms/${IDS.formLoi}/edit`, draft };
  };

  it("opens a published version read-only and starts the next draft on request", async () => {
    const services = open(`/w/riverbend/forms/${IDS.formLoi}/edit`);
    expect(await screen.findByText("Version 2 is published and cannot change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Short text" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Create v3 to edit" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" })).toBeInTheDocument();
    expect((await services.api.getForm(IDS.formLoi)).status).toBe("draft");
  });

  it("adds a field, pre-fills it from Passport and saves the mapping", async () => {
    const services = await riverbend();
    const { path } = await draftPath(services);
    open(path, services);
    await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" });

    await userEvent.click(screen.getByRole("button", { name: "Add Short text" }));
    const label = screen.getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, "Employer ID");
    await userEvent.click(screen.getByRole("switch", { name: "Required" }));
    await userEvent.click(screen.getByRole("button", { name: "Prefill from Passport" }));
    await userEvent.type(screen.getByLabelText("Filter Passport fields"), "EIN");
    await userEvent.click(within(screen.getByRole("list", { name: "Passport fields" })).getByRole("button", { name: /EIN/ }));

    const canvas = screen.getByRole("region", { name: "Form canvas" });
    expect(within(canvas).getByText(/From Passport · EIN/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(async () => {
      const saved = await services.api.getForm(IDS.formLoi);
      const key = Object.entries(saved.mappingFromCommonGrants).find(([, fn]) => (fn as { field?: string }).field === "identifiers.org:us:ein")?.[0];
      expect(key).toBeDefined();
      expect(saved.jsonSchema.properties![key!]).toMatchObject({ type: "string", title: "Employer ID" });
      expect(saved.jsonSchema.required).toContain(key);
      expect(saved.mappingFromCommonGrants.legalName).toEqual({ field: "name" });
    });
  });

  it("reorders and removes fields with buttons, and sets a condition", async () => {
    const services = await riverbend();
    const { path } = await draftPath(services);
    open(path, services);
    const fields = await screen.findByRole("list", { name: "Fields in Organization" });
    const names = () => within(fields).getAllByRole("button", { pressed: false }).concat(within(fields).getAllByRole("button", { pressed: true })).map((b) => b.textContent);
    expect(within(fields).getByRole("button", { name: "Move Legal name up" })).toBeDisabled();
    await userEvent.click(within(fields).getByRole("button", { name: "Move Mailing address up" }));
    expect(within(fields).getAllByRole("listitem")[0]).toHaveTextContent("Mailing address");
    await userEvent.click(within(fields).getByRole("button", { name: "Remove Contact phone" }));
    expect(names()).not.toContain("Contact phone");

    // A condition can only depend on a question that comes earlier in the form.
    await userEvent.click(within(fields).getByRole("button", { name: "Contact email" }));
    expect(within(screen.getByLabelText("Show only when")).queryByRole("option", { name: "We apply through a fiscal sponsor" })).not.toBeInTheDocument();
    await userEvent.click(within(fields).getByRole("button", { name: "Fiscal sponsor name" }));
    expect(screen.getByLabelText("Show only when")).toHaveValue("fiscalSponsor");
    await userEvent.selectOptions(screen.getByLabelText("equals"), "false");
    expect(within(fields).getByText("We apply through a fiscal sponsor = No")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(async () => {
      const ui = JSON.stringify((await services.api.getForm(IDS.formLoi)).uiSchema);
      expect(ui).not.toContain("contactPhone");
      expect(ui.indexOf("mailingAddress")).toBeLessThan(ui.indexOf("legalName"));
      expect(ui).toContain('{"type":"Control","scope":"#/properties/fiscalSponsorName","rule":{"effect":"SHOW","condition":{"scope":"#/properties/fiscalSponsor","schema":{"const":false}}}}');
    });
  });

  it("blocks saving while a field is incomplete and shows the reason on the field", async () => {
    const services = await riverbend();
    const { path } = await draftPath(services);
    open(path, services);
    await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" });
    await userEvent.click(screen.getByRole("button", { name: "Add Select" }));
    await userEvent.clear(screen.getByLabelText("Choices"));
    expect(screen.getByText("Add at least two choices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish v3" })).toBeDisabled();
  });

  it("previews as an applicant, test-fills and publishes", async () => {
    const services = await riverbend();
    const { path } = await draftPath(services);
    open(path, services);
    await screen.findByRole("heading", { level: 1, name: "Letter of intent · v3" });
    await userEvent.click(screen.getByRole("button", { name: "Test-fill" }));
    const preview = await screen.findByLabelText("Applicant preview");
    await waitFor(() => expect(within(preview).getByLabelText(/Project title/)).not.toHaveValue(""));
    await userEvent.click(screen.getByRole("button", { name: "Publish v3" }));
    expect(await screen.findByText("Version 3 is published and cannot change")).toBeInTheDocument();
    expect(await services.api.getForm(IDS.formLoi)).toMatchObject({ version: 3, status: "published" });
  });

  it("starts a form from the shared library", async () => {
    const services = open("/w/riverbend/forms");
    await userEvent.click(await screen.findByRole("button", { name: "Start from Progress report" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Progress report · v1" })).toBeInTheDocument();
    expect((await services.api.listForms()).map((f) => f.title)).toContain("Progress report");
  });
});

describe("competition", () => {
  it("shows stages, pinned forms, rubric weights and a passing checklist", async () => {
    open("/w/riverbend/competitions/community-health-2027");
    expect(await screen.findByRole("heading", { level: 1, name: "Community Health Grants 2027" })).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "Stage timeline" });
    expect(within(timeline).getByText("Letter of intent")).toBeInTheDocument();
    expect(screen.getByText("Community impact")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByText("7 of 7 checks pass")).toBeInTheDocument();
  });

  it("sets up a single-stage competition and gates opening on the checklist", async () => {
    const services = open("/w/riverbend/opportunities/housing-stability-2027/competition");
    await userEvent.click(await screen.findByRole("button", { name: "Set up the competition" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit stages" });
    expect(within(dialog).getByLabelText("Stage 1 name")).toHaveValue("Application");

    // Saved with no form, date or rubric: the checklist names each gap and Open stays disabled.
    await userEvent.click(within(dialog).getByRole("button", { name: "Save stages" }));
    expect(await screen.findByText(/No form on: Application/)).toBeInTheDocument();
    expect(screen.getByText(/No closing date on: Application/)).toBeInTheDocument();
    expect(screen.getByText(/No rubric on: Application/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open competition" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Edit stages" }));
    const again = await screen.findByRole("dialog", { name: "Edit stages" });
    await userEvent.selectOptions(within(again).getByLabelText("Pin a form to stage 1"), IDS.formFull);
    fireEvent.change(within(again).getByLabelText("Closes"), { target: { value: "2027-05-27" } });
    await userEvent.selectOptions(within(again).getByLabelText("Rubric"), IDS.rubricFull);
    await userEvent.click(within(again).getByRole("button", { name: "Save stages" }));

    const openButton = await screen.findByRole("button", { name: "Open competition" });
    await waitFor(() => expect(openButton).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Open competition" }));
    await waitFor(async () => {
      const comp = (await services.api.listCompetitions()).find((c) => c.opportunityId === IDS.oppHousing27)!;
      expect(comp).toMatchObject({ status: "open", forms: { [IDS.formFull]: 1 } });
      expect(comp.stages[0]).toMatchObject({ key: "application", rubricId: IDS.rubricFull, closes: "2027-05-27T23:59:59Z" });
    });
  });
});

describe("readiness checklist", () => {
  it("shows pass, fail and unknown as distinct states with a fix link", () => {
    render(
      <MemoryRouter>
        <div className="gms">
          <ReadinessChecklist
            checklist={{
              ready: false,
              summary: { pass: 1, fail: 1, unknown: 1 },
              items: [
                { key: "a", state: "pass", label: "Agreement executed", reason: "Signed May 24", fixHref: null },
                { key: "b", state: "fail", label: "Payee verified at L3", reason: "Level is L1", fixHref: "/w/riverbend/grantees" },
                { key: "c", state: "unknown", label: "Destination active", reason: "Passport can't be reached right now", fixHref: null },
              ],
            }}
          />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 checks pass · 1 to fix · 1 unknown");
    expect(screen.getByRole("img", { name: "Passed" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Needs fixing" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Unknown" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix →" })).toHaveAttribute("href", "/w/riverbend/grantees");
  });
});

describe("funder onboarding", () => {
  it("creates the workspace, refuses a low-contrast brand, invites, and ends on the first program", async () => {
    const services = open("/onboarding/funder");
    await userEvent.type(await screen.findByLabelText(/Organization name/), "Maple Street Fund");
    expect(screen.getByLabelText(/^Handle/)).toHaveValue("maple-street-fund");
    await userEvent.click(screen.getByRole("button", { name: /Continue to Brand/ }));

    const accent = await screen.findByLabelText("Accent color");
    await userEvent.clear(accent);
    await userEvent.type(accent, "#9FE3CB");
    expect(screen.getByText(/text on accent fails WCAG AA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Team/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Use suggested pair" }));
    expect(screen.getByText(/passes WCAG AA/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Continue to Team/ }));

    await userEvent.type(await screen.findByLabelText("Email"), "sam.rivera@maplestreet.example");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "finance");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await within(screen.getByRole("list", { name: "Invitations sent" })).findByText("sam.rivera@maplestreet.example")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Continue to Payments/ }));

    expect(await screen.findByText("Passport is not connected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Continue to First program/ }));
    await userEvent.type(await screen.findByLabelText(/Program name/), "Neighborhood Grants 2027");
    await userEvent.type(screen.getByLabelText(/Budget/), "250000");
    await userEvent.click(screen.getByRole("button", { name: "Create program and finish" }));

    await waitFor(() => expect(where()).toMatch(/^\/w\/maple-street-fund\/programs\//));
    const page = await services.api.publicFunder("maple-street-fund");
    expect(page.funder).toMatchObject({ name: "Maple Street Fund", brand: { accent: "#9FE3CB", onAccent: "#0D2A43" } });
    expect((await services.api.listPrograms()).map((p) => p.name)).toEqual(["Neighborhood Grants 2027"]);
  });

  it("reports a taken handle on the field", async () => {
    open("/onboarding/funder/organization");
    await userEvent.type(await screen.findByLabelText(/Organization name/), "Riverbend");
    await userEvent.click(screen.getByRole("button", { name: /Continue to Brand/ }));
    expect((await screen.findAllByText("This handle is taken")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Handle/)).toHaveClass("err");
    expect(where()).toBe("/onboarding/funder/organization");
  });
});

describe("settings · Passport", () => {
  it("shows the connection, disconnects, and reports a rejected client without keeping the secret", async () => {
    const services = open("/w/riverbend/settings");
    expect(await screen.findByText("Passport is connected")).toBeInTheDocument();
    expect(screen.getByText("pc_riverbend_gms")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Passport is not connected")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Client id/), "wrong-client");
    await userEvent.type(screen.getByLabelText(/Client secret/), "not-the-secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect Passport" }));
    expect(await screen.findByText("Passport rejected the client id or secret")).toBeInTheDocument();
    expect(screen.getByLabelText(/Client secret/)).toHaveValue("");

    await userEvent.clear(screen.getByLabelText(/Client id/));
    await userEvent.type(screen.getByLabelText(/Client id/), "pc_riverbend_new");
    await userEvent.type(screen.getByLabelText(/Client secret/), "a-long-secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect Passport" }));
    expect(await screen.findByText("Passport is connected")).toBeInTheDocument();
    expect((await services.api.passportStatus(IDS.riverbend)).clientId).toBe("pc_riverbend_new");
  });
});
