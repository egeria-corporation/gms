// SPDX-License-Identifier: AGPL-3.0-only
// The applicant workspace against the mock API: every live screen renders from it, an application
// goes from start through prefill, edit, validation and submit, two people edit one application
// without overwriting each other, and consent and signing behave as gates.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { ApplicantApi } from "../src/api/applicant.ts";
import { changedPaths } from "../src/api/applicant.ts";
import { provideApplicantApi, provideRealtime } from "../src/api/applicantHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { rebase, sectionsOf, sectionState } from "../src/screens/applicant/editorSync.ts";
import { LOI_FORM, LOI_RESPONSE } from "../src/mocks/forms.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function open(path: string, opts: { store?: ApplicantStore; api?: ApplicantApi } = {}) {
  const services = createMockServices({ session: demoSession() });
  const store = opts.store ?? seedApplicantStore();
  const api = opts.api ?? createMockApplicantApi({ session: () => services.auth.getSession(), store });
  provideApplicantApi(services, api);
  provideRealtime(services, createRealtimeHub());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
  return { ...view, store, api };
}
const where = () => screen.getByTestId("where").textContent;
const APP = `app_${APPLICANT_IDS.appHealth}`;

describe("applicant screens render from the API", () => {
  it("dashboard: readiness, applications, payments, reports, messages and tasks", async () => {
    open("/w/alder-creek");
    expect(await screen.findByRole("heading", { name: "Passport readiness" })).toBeInTheDocument();
    expect(screen.getByText("Payee verified")).toBeInTheDocument();
    const apps = screen.getByRole("region", { name: "Active applications" });
    expect(within(apps).getByRole("link", { name: /Mobile Health Navigation for Rural Families/ })).toHaveAttribute("href", `/w/alder-creek/applications/${APP}/edit`);
    expect(within(apps).getByText("Draft")).toBeInTheDocument();
    expect(within(apps).getByText("Submitted")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Payments" })).getByText("$75,000")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Reports due" })).getByText(/Interim report/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Messages" })).getByText(/Interview slots/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Tasks" })).getByText("Add letters of support")).toBeInTheDocument();
  });

  it("dashboard: an unlinked workspace with nothing started points at Passport and Find funding", async () => {
    const store = seedApplicantStore();
    Object.assign(store.organization, { linked: false, level: null });
    store.applications = [];
    store.awards = [];
    open("/w/alder-creek", { store });
    expect(await screen.findByRole("link", { name: "Connect Passport" })).toHaveAttribute("href", "/onboarding/applicant");
    expect(screen.getByRole("heading", { name: "No applications or grants yet" })).toBeInTheDocument();
    // Unknown is shown as unknown, never as a pass or a fail.
    expect(screen.getAllByRole("img", { name: "Unknown" }).length).toBeGreaterThan(0);
  });

  it("organization: the Passport record read-only, with sources, readiness and who has access", async () => {
    open("/w/alder-creek/organization");
    expect(await screen.findByRole("heading", { name: "Identity" })).toBeInTheDocument();
    expect(screen.getByText("501(c)(3) public charity")).toBeInTheDocument();
    expect(screen.getByText("93-0000418")).toBeInTheDocument();
    expect(screen.getByText("$2,400,000")).toBeInTheDocument();
    expect(screen.getAllByText(/From Passport · Form 990/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const access = screen.getByRole("region", { name: "Who has access" });
    expect(within(access).getByText("Riverbend Community Foundation")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Edit in Passport/ })[0]).toHaveAttribute("href", expect.stringContaining("passport.opengrants.io"));
  });

  it("find funding: eligibility per competition, start, and the OpenGrants index", async () => {
    open("/w/alder-creek/find");
    const health = await screen.findByRole("article", { name: "Community Health Grants 2027" });
    expect(within(health).getByText("Eligible")).toBeInTheDocument();
    expect(within(health).getByRole("link", { name: "Continue application" })).toBeInTheDocument();
    const housing = screen.getByRole("article", { name: "Housing Stability 2027" });
    expect(within(housing).getByText("Eligibility unknown")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "OpenGrants index" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search the OpenGrants index" }), "rural");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: "Rural Health Network Development Planning" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();

    await userEvent.click(screen.getByRole("tab", { name: /Open here/ }));
    await userEvent.click(within(screen.getByRole("article", { name: "Housing Stability 2027" })).getByRole("button", { name: "Start anyway" }));
    await waitFor(() => expect(where()).toMatch(/^\/w\/alder-creek\/applications\/app_[0-9a-f-]{36}\/edit$/));
  });

  it("find funding: OpenGrants being unreachable is said plainly", async () => {
    const store = seedApplicantStore();
    store.openGrants = null;
    open("/w/alder-creek/find", { store });
    await userEvent.click(await screen.findByRole("tab", { name: "OpenGrants index" }));
    await userEvent.click(screen.getByRole("button", { name: "Match to my profile" }));
    expect(await screen.findByText("OpenGrants did not answer")).toBeInTheDocument();
  });

  it("applications, status with the shared thread, funders, answers and team", async () => {
    const a = open("/w/alder-creek/applications");
    expect(await screen.findByRole("link", { name: "Community Clinic Capacity" })).toBeInTheDocument();
    a.unmount();

    const s = open(`/w/alder-creek/applications/app_${APPLICANT_IDS.appClinic}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Community Clinic Capacity" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reply"), "Is there a site visit?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Is there a site visit?")).toBeInTheDocument();
    expect(s.store.threads.some((t) => t.messages.some((m) => m.body === "Is there a site visit?"))).toBe(true);
    s.unmount();

    const f = open("/w/alder-creek/funders");
    expect(await screen.findByRole("heading", { name: "Funders" })).toBeInTheDocument();
    expect(screen.getAllByText("Cascade County Health Department").length).toBeGreaterThan(0);
    f.unmount();

    const l = open("/w/alder-creek/library");
    await userEvent.click(await screen.findByRole("button", { name: /^Mission/ }));
    const body = screen.getByLabelText("Answer");
    await userEvent.type(body, " We serve six communities.");
    await userEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(l.store.answers.find((x) => x.key === "mission")!.version).toBe(2));
    expect(await screen.findByText(/Version 2/)).toBeInTheDocument();
    l.unmount();

    const t = open("/w/alder-creek/team");
    expect(await screen.findByRole("table", { name: "Team members" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Consultants/ }));
    expect(within(screen.getByRole("table", { name: "Consultants" })).getByText("Lena Fischer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Funders with access/ }));
    const access = screen.getByRole("region", { name: "Funders with access" });
    await userEvent.click(within(access).getAllByRole("button", { name: "Remove access" })[0]!);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(t.store.consents[0]!.revokedAt).not.toBeNull());
    expect(await within(access).findByText("Removed")).toBeInTheDocument();
  });
});

describe("apply: start, prefill, edit, validate, submit", () => {
  it("prefills from Passport, shows what is left to fix, refuses to submit early and submits when complete", async () => {
    const { store } = open(`/w/alder-creek/applications/${APP}/edit`);
    expect(await screen.findByRole("heading", { level: 1, name: "Mobile Health Navigation for Rural Families" })).toBeInTheDocument();

    // Passport-owned field: shown, marked, not editable.
    expect(screen.getAllByText("From Passport").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: /Legal name/ })).toHaveAttribute("readonly");

    // The validation panel lists what the server says is left; the section rail agrees.
    const panel = screen.getByRole("tabpanel", { name: /Validation/ });
    expect(within(panel).getAllByRole("img", { name: "Needs attention" }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("navigation", { name: "Application sections" })).getByText(/In progress · \d+ to fix/)).toBeInTheDocument();
    expect(within(panel).getByText("501(c)(3) in good standing")).toBeInTheDocument();

    // Submit is blocked while a check fails.
    await userEvent.click(screen.getByRole("button", { name: "Submit…" }));
    const dialog = screen.getByRole("dialog", { name: "Ready to submit?" });
    expect(within(dialog).getByRole("button", { name: "Submit application" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Editing a field autosaves only that field.
    const title = screen.getByRole("textbox", { name: /Project title/ });
    await userEvent.clear(title);
    await userEvent.type(title, "Mobile Health Navigation, Year Two");
    await waitFor(() => expect(store.applications[0]!.forms[0]!.response.projectTitle).toBe("Mobile Health Navigation, Year Two"), { timeout: 3000 });
    expect(store.applications[0]!.forms[0]!.provenance["/projectTitle"]).toBe("user");
    expect(store.applications[0]!.forms[0]!.response.legalName).toBe("Alder Creek Family Services");
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it("submits a complete application and lands on the confirmation with the Passport level attached", async () => {
    const store = seedApplicantStore();
    const form = store.applications[0]!.forms[0]!;
    Object.assign(form, { response: structuredClone(LOI_RESPONSE), validationErrors: [], status: "complete" });
    open(`/w/alder-creek/applications/${APP}/edit/submit`, { store });
    const dialog = await screen.findByRole("dialog", { name: "Ready to submit?" });
    expect(within(dialog).getByText(/3 of 3 checks pass/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit application" }));
    await waitFor(() => expect(where()).toBe(`/w/alder-creek/applications/${APP}/submitted`));
    expect(await screen.findByRole("heading", { name: "Submitted to Riverbend Community Foundation" })).toBeInTheDocument();
    expect(store.applications[0]!.status).toBe("submitted");
    expect(store.applications[0]!.verificationLevel).toBe("L3");
    expect(store.applications[0]!.forms[0]!.lockedAt).not.toBeNull();
  });

  it("promises nothing from Passport to an applicant without it, and confirms it as not verified (NP-15)", async () => {
    const store = seedApplicantStore();
    Object.assign(store.organization, { linked: false, level: null });
    const form = store.applications[0]!.forms[0]!;
    Object.assign(form, { response: structuredClone(LOI_RESPONSE), validationErrors: [], status: "complete" });
    open(`/w/alder-creek/applications/${APP}/edit/submit`, { store });
    const dialog = await screen.findByRole("dialog", { name: "Ready to submit?" });
    expect(within(dialog).queryByText(/Passport level/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Your organization is not verified with OpenGrants Passport")).toBeInTheDocument();
    expect(within(dialog).getByText(/read the organization details you entered/)).toBeInTheDocument();
  });

  it("shows the fields the server refuses at submit", async () => {
    const store = seedApplicantStore();
    const form = store.applications[0]!.forms[0]!;
    // This page believes the form is complete; the server knows a teammate cleared a field.
    Object.assign(form, { validationErrors: [], status: "complete" });
    open(`/w/alder-creek/applications/${APP}/edit/submit`, { store });
    const dialog = await screen.findByRole("dialog", { name: "Ready to submit?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit application" }));
    expect(await screen.findByText(/The server found \d+ things? to fix/)).toBeInTheDocument();
    expect(store.applications[0]!.status).toBe("draft");
  });

  it("keeps team comments and section owners with the application", async () => {
    const { store } = open(`/w/alder-creek/applications/${APP}/edit`);
    await userEvent.click(await screen.findByRole("tab", { name: /Comments/ }));
    expect(screen.getByText(/cite the county assessment/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Write a comment for your team"), "Added the citation.");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(store.comments[APPLICANT_IDS.appHealth]![0]!.body).toBe("Added the citation."));

    await userEvent.click(screen.getByRole("tab", { name: "Assignments" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), APPLICANT_IDS.lena);
    await waitFor(() => expect(store.applications[0]!.sections[APPLICANT_IDS.formFull]!.Project).toBe(APPLICANT_IDS.lena));
  });
});

describe("two people, one application", () => {
  it("the patch holds only what changed, and unsent edits survive a newer server state", () => {
    const base = { a: "one", b: { c: 1, d: 2 }, list: [1, 2] };
    expect(changedPaths(base, { ...base, a: "uno" })).toEqual({ a: "uno" });
    expect(changedPaths(base, { ...base, b: { c: 1, d: 3 } })).toEqual({ b: { d: 3 } });
    expect(changedPaths(base, { a: "one", b: { c: 1, d: 2 } })).toEqual({ list: null });
    expect(changedPaths(base, structuredClone(base))).toBeNull();
    // I sent {a}, then typed in b.d while the save was in flight; a teammate changed `list`.
    const sent = { ...base, a: "uno" };
    const local = { ...sent, b: { c: 1, d: 9 } };
    const server = { ...sent, list: [1, 2, 3] };
    expect(rebase(server, sent, local)).toEqual({ a: "uno", b: { c: 1, d: 9 }, list: [1, 2, 3] });
  });

  it("two clients saving different fields both keep their edits", async () => {
    const store = seedApplicantStore();
    const maria = createMockApplicantApi({ session: async () => demoSession(), store });
    const lena = createMockApplicantApi({ session: async () => demoSession(), store, actor: { userId: APPLICANT_IDS.lena, name: "Lena Fischer" } });
    const formId = APPLICANT_IDS.formFull;
    const before = (await maria.application(APP)).forms.find((f) => f.formId === formId)!.response;

    // Each sends only what they changed, computed against the same starting point.
    await maria.saveForm(APP, formId, changedPaths(before, { ...before, need: "Maria’s need statement." })!);
    await lena.saveForm(APP, formId, changedPaths(before, { ...before, familiesServed: 310 })!);

    const after = (await maria.application(APP)).forms.find((f) => f.formId === formId)!.response;
    expect(after.need).toBe("Maria’s need statement.");
    expect(after.familiesServed).toBe(310);
    expect(after.projectTitle).toBe(before.projectTitle);
  });

  it("an open editor picks up a teammate’s save without losing its own unsaved typing", async () => {
    const store = seedApplicantStore();
    const services = createMockServices({ session: demoSession() });
    const hub = createRealtimeHub();
    provideApplicantApi(services, createMockApplicantApi({ session: () => services.auth.getSession(), store }));
    provideRealtime(services, hub);
    render(
      <MemoryRouter initialEntries={[`/w/alder-creek/applications/${APP}/edit`]}>
        <App services={services} />
      </MemoryRouter>,
    );
    const title = await screen.findByRole("textbox", { name: /Project title/ });

    // Lena joins the same application and is shown as present.
    const lena = createMockApplicantApi({ session: async () => demoSession(), store, actor: { userId: APPLICANT_IDS.lena, name: "Lena Fischer" } });
    const room = hub.join(APPLICANT_IDS.appHealth, { userId: APPLICANT_IDS.lena, name: "Lena Fischer" }, { onPeers: () => {}, onSaved: () => {} });
    expect(await screen.findByLabelText(/Editing now: .*Lena Fischer/)).toBeInTheDocument();

    // Maria types (not saved yet); Lena saves another field and announces it.
    await userEvent.clear(title);
    await userEvent.type(title, "Maria is typing");
    await lena.saveForm(APP, APPLICANT_IDS.formFull, { familiesServed: 512 });
    room.saved(APPLICANT_IDS.formFull);

    await waitFor(() => expect(screen.getByRole("spinbutton", { name: /Families served/ })).toHaveValue(512));
    expect(screen.getByRole("textbox", { name: /Project title/ })).toHaveValue("Maria is typing");
    await waitFor(() => expect(store.applications[0]!.forms[0]!.response.projectTitle).toBe("Maria is typing"), { timeout: 3000 });
    expect(store.applications[0]!.forms[0]!.response.familiesServed).toBe(512);
    room.leave();
  });

  it("sections report done, in progress and not started", () => {
    const sections = sectionsOf(LOI_FORM);
    expect(sections.map((s) => s.label)).toEqual(["Organization", "Project", "Budget and attachments"]);
    const budget = sections[2]!;
    expect(sectionState(budget, LOI_RESPONSE, []).state).toBe("done");
    expect(sectionState(budget, LOI_RESPONSE, [{ field: "/budget", message: "over", type: "budget" }]).state).toBe("prog");
    expect(sectionState(budget, {}, [{ field: "/signature", message: "required", type: "required" }]).state).toBe("todo");
  });
});

describe("Passport consent", () => {
  it("starts in Passport and, back in the app, shows the imported record and readiness", async () => {
    const store = seedApplicantStore();
    Object.assign(store.organization, { linked: false, level: null });
    const assigned: string[] = [];
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: (url: string) => assigned.push(url) } });

    const first = open("/onboarding/applicant", { store });
    await userEvent.click(await screen.findByRole("button", { name: "Continue with Passport" }));
    await waitFor(() => expect(assigned).toHaveLength(1));
    expect(assigned[0]).toBe("/onboarding/applicant?passport=linked&ws=alder-creek");
    first.unmount();

    open(assigned[0]!, { store });
    expect(await screen.findByRole("heading", { name: "Welcome, Alder Creek Family Services" })).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toHaveValue("Alder Creek Family Services");
    expect(screen.getByLabelText("Legal name")).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: "This looks right" }));
    expect(screen.getByRole("link", { name: "Go to your workspace" })).toHaveAttribute("href", "/w/alder-creek");
  });

  it("says why when the organization was not linked", async () => {
    const store = seedApplicantStore();
    Object.assign(store.organization, { linked: false, level: null });
    open("/onboarding/applicant?passport=error&reason=declined", { store });
    expect(await screen.findByText("Your organization was not linked")).toBeInTheDocument();
    expect(screen.getByText(/You chose not to share/)).toBeInTheDocument();
  });
});

describe("accepting and signing an award", () => {
  it("accepts the offer, then signs only with a typed name and the attestation", async () => {
    const { store } = open(`/w/alder-creek/grants/awd_${APPLICANT_IDS.awardHealth}/offer`);
    // Passport lists verified representatives for this organization, so the person accepting names themself.
    await userEvent.type(await screen.findByLabelText("Your full legal name"), "Maria Santos");
    await userEvent.click(await screen.findByRole("button", { name: "Accept award" }));
    await waitFor(() => expect(store.awards[0]!.status).toBe("accepted"));

    await userEvent.click(screen.getByRole("button", { name: /Review and sign/ }));
    const dialog = screen.getByRole("dialog", { name: "Sign the grant agreement" });
    expect(within(dialog).getAllByText(/sha256 7e2b…40af/).length).toBeGreaterThan(0);
    const sign = within(dialog).getByRole("button", { name: /Sign agreement/ });
    expect(sign).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type your full legal name"), "Maria Santos");
    expect(sign).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(sign);

    await waitFor(() => expect(store.agreements[0]!.status).toBe("signed_by_grantee"));
    expect(store.agreements[0]!.granteeSignature?.name).toBe("Maria Santos");
    expect(await screen.findByText(/Waiting for Riverbend Community Foundation to countersign/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review and sign/ })).not.toBeInTheDocument();
  });

  it("refuses a signature on a document that changed since it was opened", async () => {
    const store = seedApplicantStore();
    const api = createMockApplicantApi({ session: async () => demoSession(), store });
    const refused = await api.signAgreement(store.agreements[0]!.id, { name: "Maria Santos", attest: true, documentSha256: "0".repeat(64) }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 409 });
    expect(store.agreements[0]!.status).toBe("sent");
  });
});
