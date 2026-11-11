// SPDX-License-Identifier: AGPL-3.0-only
// The launch-preparation sections against the mock API: sessions, program owners and outcomes,
// representatives, interview times, budget category mapping, last active, contacts, signature
// addresses, payments with Passport switched off and on, the assistant's letter draft and quota,
// and Google Workspace (connect, export to Drive, directory suggestions, the Picker's CSP).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, headersFile } from "../build/headers.ts";
import { provideApplicantFullApi } from "../src/api/applicantFullHooks.ts";
import { provideApplicantApi, provideMockApplicantStore, provideRealtime } from "../src/api/applicantHooks.ts";
import { provideApplicantMoreApi } from "../src/api/applicantMoreHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { mockLaunchStore, provideLaunchApi } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, ServicesProvider, type Services } from "../src/app/services.tsx";
import type * as Browser from "../src/lib/browser.ts";
import { appIdOf } from "../src/lib/googlePicker.ts";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore, type ApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantFullApi, seedFullStore, type FullStore } from "../src/mocks/applicantFull.ts";
import { createMockApplicantMoreApi, seedMoreStore } from "../src/mocks/applicantMore.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { MONEY_IDS } from "../src/mocks/funderMoney.ts";
import { createMockLaunchApi, seedLaunchStore, type LaunchStore } from "../src/mocks/launch.ts";
import { IDS } from "../src/mocks/store.ts";
import { DriveExportButton } from "../src/screens/funder/GoogleWorkspace.tsx";

const left = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("../src/lib/browser.ts", async (original) => ({ ...(await original<typeof Browser>()), leaveTo: (url: string) => void left.to.push(url) }));
beforeEach(() => {
  left.to.length = 0;
  sessionStorage.clear();
});

const show = (path: string, services: Services) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );

/** A funder at Riverbend. `arrange` sets the launch scene before anything renders. */
async function funder(path: string, arrange?: (launch: LaunchStore) => void) {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  const launch = mockLaunchStore(services)!;
  arrange?.(launch);
  return { ...show(path, services), services, launch };
}

/** An applicant at Alder Creek. */
function applicant(path: string, arrange?: (store: ApplicantStore, full: FullStore, launch: LaunchStore) => void) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const more = seedMoreStore(store);
  const full = seedFullStore(store);
  const launch = seedLaunchStore();
  arrange?.(store, full, launch);
  const session = () => services.auth.getSession();
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, createMockApplicantApi({ session, store }));
  provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more }));
  provideApplicantFullApi(services, createMockApplicantFullApi({ session, store, full }));
  provideLaunchApi(services, createMockLaunchApi({ session, store: launch }), launch);
  provideRealtime(services, createRealtimeHub());
  return { ...show(path, services), store, full, launch };
}

const R = "/w/riverbend";
const A = "/w/alder-creek";
const CLINIC_APP = `app_${APPLICANT_IDS.appClinic}`;
const CLINIC_AWARD = `awd_${APPLICANT_IDS.awardClinic}`;
const card = (heading: string) => screen.getByRole("heading", { name: heading }).closest("section")!;

describe("account sessions", () => {
  it("lists the person's sessions and signs one out", async () => {
    const services = createMockServices({ session: demoSession() });
    const launch = mockLaunchStore(services)!;
    show("/account/agents", services);
    const table = within(await screen.findByRole("table", { name: "Sessions" }));
    expect(table.getByText("Chrome on macOS")).toBeInTheDocument();
    expect(table.getByText("Now")).toBeInTheDocument();
    expect(table.getByText("203.0.113.24")).toBeInTheDocument();
    // The current session is ended by signing out, never revoked from the list.
    expect(table.getAllByRole("button", { name: /^Revoke/ })).toHaveLength(1);
    await userEvent.click(table.getByRole("button", { name: "Revoke the session on Safari on iPhone" }));
    await waitFor(() => expect(launch.sessions.map((s) => s.device)).toEqual(["Chrome on macOS"]));
    await waitFor(() => expect(table.queryByText("Safari on iPhone")).not.toBeInTheDocument());
  });
});

describe("programs", () => {
  it("names each program's owner and totals its outcomes", async () => {
    await funder(`${R}/programs/${IDS.programHealth26}`);
    const list = within(await screen.findByRole("table", { name: /Programs/ }));
    expect(list.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
    expect(await list.findByText("Dana Ortiz")).toBeInTheDocument();
    expect(await screen.findByText("Families served (reported)")).toBeInTheDocument();
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getAllByText("From 4 accepted reports").length).toBe(3);
  });

  it("edits the budget categories a program's awards are budgeted in", async () => {
    const { launch } = await funder(`${R}/programs/${IDS.programHealth27}`);
    const categories = within(await screen.findByRole("list", { name: "Budget categories" }));
    expect(categories.getByText("Personnel")).toBeInTheDocument();
    await userEvent.click(categories.getByRole("button", { name: "Remove Supplies" }));
    await waitFor(() => expect(launch.budgetCategories[IDS.programHealth27]).not.toContain("Supplies"));
  });
});

describe("organization representatives", () => {
  it("lists representatives with a verified mark that is not color alone", async () => {
    applicant(`${A}/organization`);
    const reps = within(await screen.findByRole("region", { name: "Representatives" }));
    const maria = within((await reps.findByText("Maria Santos")).closest("tr")!);
    expect(maria.getByText("Executive Director")).toBeInTheDocument();
    expect(maria.getByText(/^Verified/)).toBeInTheDocument();
    expect(within(reps.getByText("Lena Fischer").closest("tr")!).getByText(/Not verified/)).toBeInTheDocument();
  });

  it("says so when Passport does not share the list", async () => {
    applicant(`${A}/organization`, (_s, _f, launch) => {
      launch.representatives = { state: "not_shared", items: [], manageUrl: "https://app.passport.opengrants.io/" };
    });
    const reps = within(await screen.findByRole("region", { name: "Representatives" }));
    expect(await reps.findByText(/does not share/)).toBeInTheDocument();
    expect(reps.queryByRole("table")).not.toBeInTheDocument();
  });
});

const offered = { proposed: { slots: ["2027-05-04T17:00:00Z", "2027-05-05T20:30:00Z"], note: "A 30-minute video call with the panel.", location: "Video call", at: "2027-04-20T15:00:00Z" }, confirmed: null };

describe("accepting an award", () => {
  it("asks for the legal name of a verified representative and sends it", async () => {
    const services = createMockServices({ session: demoSession() });
    const store = seedApplicantStore();
    const award = store.awards.find((w) => w.status === "offered")!;
    const session = () => services.auth.getSession();
    const api = createMockApplicantApi({ session, store });
    const names: (string | undefined)[] = [];
    const accept = api.acceptAward.bind(api);
    api.acceptAward = (id, name) => (names.push(name), accept(id, name));
    provideMockApplicantStore(services, store);
    provideApplicantApi(services, api);
    provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more: seedMoreStore(store) }));
    provideApplicantFullApi(services, createMockApplicantFullApi({ session, store, full: seedFullStore(store) }));
    provideRealtime(services, createRealtimeHub());
    show(`${A}/grants/${award.id}/offer`, services);
    const button = await screen.findByRole("button", { name: "Accept award" });
    const name = await screen.findByLabelText("Your full legal name");
    expect(screen.getByText(/must match one in Passport: Maria Santos, Jamal Reed\./)).toBeInTheDocument();
    expect(button).toBeDisabled();
    await userEvent.type(name, "Maria Santos");
    await userEvent.click(button);
    await waitFor(() => expect(names).toEqual(["Maria Santos"]));
  });

  it("asks for no name when Passport lists no representatives", async () => {
    const offered = seedApplicantStore().awards.find((w) => w.status === "offered")!;
    const { store } = applicant(`${A}/grants/${offered.id}/offer`, (_s, _f, launch) => {
      launch.representatives = { state: "not_shared", items: [], manageUrl: null };
    });
    const button = await screen.findByRole("button", { name: "Accept award" });
    expect(screen.queryByLabelText("Your full legal name")).not.toBeInTheDocument();
    await userEvent.click(button);
    await waitFor(() => expect(store.awards.find((w) => w.id === offered.id)!.status).toBe("accepted"));
  });
});

describe("interview times", () => {
  it("the applicant picks one of the offered times and confirms it", async () => {
    const { launch } = applicant(`${A}/applications/${CLINIC_APP}`, (store, _f, l) => {
      store.applications.find((a) => a.uuid === APPLICANT_IDS.appClinic)!.status = "interview";
      l.interviews[CLINIC_APP] = structuredClone(offered);
    });
    const section = within(await screen.findByRole("region", { name: "Interview scheduling" }));
    const confirm = await section.findByRole("button", { name: "Confirm this time" });
    expect(confirm).toBeDisabled();
    const slots = section.getAllByRole("radio");
    expect(slots).toHaveLength(2);
    await userEvent.click(slots[1]!);
    await userEvent.click(confirm);
    expect(await section.findByText("Time confirmed")).toBeInTheDocument();
    expect(launch.interviews[CLINIC_APP]!.confirmed?.slot).toBe("2027-05-05T20:30:00Z");
    expect(section.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("the funder offers times from the application", async () => {
    const { launch } = await funder(`${R}/applications/${MOCK_IDS.copper}`);
    const panel = within(await waitFor(() => card("Interview")));
    await userEvent.click(panel.getByRole("button", { name: "Offer interview times" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Offer interview times" }));
    await userEvent.type(dialog.getByLabelText("Time 1"), "2027-05-04T10:00");
    await userEvent.click(dialog.getByRole("button", { name: /Offer/ }));
    await waitFor(() => expect(launch.interviews[MOCK_IDS.copper]?.proposed?.slots).toHaveLength(1));
    expect(await panel.findByText("Times offered")).toBeInTheDocument();
  });
});

describe("a grant's budget", () => {
  it("maps the grantee's own ledger accounts to the funder's categories", async () => {
    const { launch } = applicant(`${A}/grants/${CLINIC_AWARD}`);
    const form = within((await screen.findByRole("heading", { name: "Map categories" })).closest("form")!);
    const inputs = form.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
    await userEvent.type(inputs[0]!, "6100 Salaries");
    await userEvent.click(form.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(launch.mappings[CLINIC_AWARD]?.[0]?.ownCategory).toBe("6100 Salaries"));
  });
});

describe("team", () => {
  it("shows when each person was last active and a consultant's organization", async () => {
    applicant(`${A}/team`);
    expect((await screen.findAllByRole("columnheader", { name: /Last active/ })).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: /Consultants/ }));
    expect(await screen.findByText("Fischer Grants Consulting")).toBeInTheDocument();
  });
});

describe("funder contacts", () => {
  it("an applicant sees the people the funder lists; the public page shows only the public ones", async () => {
    const view = applicant(`${A}/funders`);
    const contact = within(await screen.findByRole("region", { name: "Contact Riverbend Community Foundation" }));
    expect(await contact.findByText("Dana Ortiz")).toBeInTheDocument();
    expect(contact.getByText("Program officer")).toBeInTheDocument();
    expect(contact.getByText("Marcus Lee")).toBeInTheDocument();
    expect(contact.getByRole("link", { name: "grants@riverbendcf.example" })).toHaveAttribute("href", "mailto:grants@riverbendcf.example");
    view.unmount();

    show("/f/riverbend", createMockServices({ session: null }));
    const who = within((await screen.findByRole("heading", { name: "Who to Ask" })).closest("section")!);
    expect(who.getByText("Dana Ortiz")).toBeInTheDocument();
    expect(who.queryByText("Marcus Lee")).not.toBeInTheDocument();
  });

  it("the funder edits its contacts in settings", async () => {
    const { launch } = await funder(`${R}/settings/mcp`);
    const editor = within(await waitFor(() => card("Contacts for applicants")));
    expect(await editor.findByDisplayValue("Dana Ortiz")).toBeInTheDocument();
    await userEvent.click(editor.getByRole("button", { name: "Add a contact" }));
    const save = editor.getByRole("button", { name: "Save contacts" });
    // A contact without a name and address cannot be saved.
    expect(save).toBeDisabled();
    const added = within(editor.getByRole("group", { name: "Contact 3" }));
    await userEvent.type(added.getByLabelText("Name"), "Helen Park");
    await userEvent.type(added.getByLabelText("Email"), "helen@riverbendcf.example");
    await userEvent.click(added.getByRole("checkbox", { name: "On public page" }));
    await userEvent.click(save);
    expect(await editor.findByText("Contacts saved.")).toBeInTheDocument();
    expect(launch.contacts.riverbend).toHaveLength(3);
    expect(launch.contacts.riverbend![2]).toMatchObject({ name: "Helen Park", public: true, phone: null });
  });
});

describe("signature records", () => {
  it("shows the signer's address to those who may see it, and says so to those who may not", async () => {
    const award = MOCK_IDS.award;
    const probe = createMockServices({ session: demoSession() });
    await probe.api.workspace("riverbend");
    const version = (await probe.api.getAward(award)).agreement!.version;
    const second = await funder(`${R}/awards/${award}/agreement`, (l) => {
      l.signatures[award] = [{ party: "grantee", version, ip: "203.0.113.24", ipVisible: true }];
    });
    const table = within(await screen.findByRole("table", { name: "Signature records" }));
    expect(await table.findByText("203.0.113.24")).toBeInTheDocument();
    second.unmount();
    await funder(`${R}/awards/${award}/agreement`, (l) => {
      l.signatures[award] = [{ party: "grantee", version, ip: null, ipVisible: false }];
    });
    expect(await within(await screen.findByRole("table", { name: "Signature records" })).findByText(/shown to admins and finance/)).toBeInTheDocument();
  });
});

describe("payments while Passport payments are switched off", () => {
  it("the payments center offers recording only, with readiness kept as information", async () => {
    await funder(`${R}/payments/due`);
    const alder = within(await waitFor(() => card("Alder Creek Family Services")));
    expect(await alder.findByRole("button", { name: "Record a payment made outside the GMS" })).toHaveClass("btn-primary");
    expect(alder.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    expect(alder.getByText(/7 of 7 checks pass/)).toBeInTheDocument();
    const note = screen.getByText("Payments through Passport are not switched on yet").closest(".bnr")!;
    expect(note).toHaveClass("bnr-info");
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
  });

  it("the award's payments tab records a payment made elsewhere", async () => {
    const { services } = await funder(`${R}/awards/${MONEY_IDS.awardAlder}/payments`);
    const t1 = within(await waitFor(() => card("Tranche 1 · $75,000")));
    expect(screen.getByText("Payments through Passport are not switched on yet")).toBeInTheDocument();
    expect(t1.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    await userEvent.click(await t1.findByRole("button", { name: "Record a payment made outside the GMS" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText(/Payment reference/), "CHK-1042");
    await userEvent.type(dialog.getByLabelText(/Date paid/), "2027-04-20");
    await userEvent.type(dialog.getByLabelText(/last four/), "4821");
    await userEvent.click(dialog.getByRole("button", { name: /Record/ }));
    await waitFor(async () => expect((await services.api.listTranches({ view: "due" })).map((t) => t.id)).not.toContain(MONEY_IDS.alderT1));
  });

  it("the human-gate list says releases are off rather than offering an approval that cannot happen", async () => {
    await funder(`${R}/settings/mcp`);
    const gates = within(await waitFor(() => card("Human gates")));
    expect(await gates.findByText(/not switched on/i)).toBeInTheDocument();
  });

  it("with the switch on, release is offered again and the notice is gone", async () => {
    await funder(`${R}/payments/due`, (l) => {
      l.config.facilitatedPayments = true;
    });
    const alder = within(await waitFor(() => card("Alder Creek Family Services")));
    expect(await alder.findByRole("button", { name: "Release" })).toBeEnabled();
    expect(alder.getByRole("button", { name: "Record external payment" })).not.toHaveClass("btn-primary");
    expect(screen.queryByText("Payments through Passport are not switched on yet")).not.toBeInTheDocument();
  });
});

describe("the assistant", () => {
  it("drafts a letter that is marked as a draft, counted, and never written into the template", async () => {
    const { services } = await funder(`${R}/communications`);
    const assistant = within((await screen.findByRole("heading", { name: "Assistant" })).closest("section")!);
    expect(assistant.getByText("Draft — review before use")).toBeInTheDocument();
    expect(assistant.getByText("14 of 40 this month")).toBeInTheDocument();
    const before = structuredClone(await services.api.listTemplates());
    const body = (screen.getByLabelText(/^Body/) as HTMLTextAreaElement).value;
    await userEvent.click(assistant.getByRole("button", { name: "Draft a letter" }));
    const draft = within(await assistant.findByRole("group", { name: "Letter draft" }));
    expect(draft.getByText(/Draft by/)).toBeInTheDocument();
    expect(draft.getByRole("button", { name: "Copy the draft" })).toBeInTheDocument();
    expect(assistant.getByText("15 of 40 this month")).toBeInTheDocument();
    // Nothing was inserted or saved.
    expect((screen.getByLabelText(/^Body/) as HTMLTextAreaElement).value).toBe(body);
    expect(await services.api.listTemplates()).toEqual(before);
  });

  it("says when the month's drafts are used up instead of offering a draft", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    for (let i = 14; i < 40; i++) await services.api.assistSummarize(MOCK_IDS.copper);
    show(`${R}/communications`, services);
    const assistant = within((await screen.findByRole("heading", { name: "Assistant" })).closest("section")!);
    expect(assistant.getByText("40 of 40 this month")).toBeInTheDocument();
    expect(assistant.getByText(/This month’s drafts are used up/)).toBeInTheDocument();
    expect(assistant.getByRole("button", { name: "Draft a letter" })).toBeDisabled();
  });

  it("reports a refusal from the server when the month ran out after the page loaded", async () => {
    const { services } = await funder(`${R}/communications`);
    const assistant = within((await screen.findByRole("heading", { name: "Assistant" })).closest("section")!);
    expect(assistant.getByText("14 of 40 this month")).toBeInTheDocument();
    for (let i = 14; i < 40; i++) await services.api.assistSummarize(MOCK_IDS.copper);
    await userEvent.click(assistant.getByRole("button", { name: "Draft a letter" }));
    expect(await assistant.findByText("The assistant could not draft this")).toBeInTheDocument();
    expect(assistant.queryByRole("group", { name: "Letter draft" })).not.toBeInTheDocument();
  });

  it("an applicant whose month is used up sees that instead of a draft", async () => {
    applicant(`${A}/library`, (_s, full) => {
      full.assist = { enabled: true, quota: { used: 40, limit: 40, remaining: 0, resetsAt: "2027-05-01T00:00:00Z" } };
    });
    expect(await screen.findByText("Draft — review before use")).toBeInTheDocument();
    expect(screen.getByText("40 of 40 this month")).toBeInTheDocument();
    expect(screen.getByText(/This month’s drafts are used up. The count resets on May 1/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Target question/), "What need does this project address?");
    expect(screen.getByRole("button", { name: "Adapt" })).toBeDisabled();
  });
});

describe("Google Workspace", () => {
  it("connects by leaving for the address the API returns, and confirms on return", async () => {
    const { services, unmount } = await funder(`${R}/settings/mcp`);
    const integrations = within(await waitFor(() => card("Integrations")));
    await userEvent.click(await integrations.findByRole("button", { name: "Connect Google Workspace" }));
    await waitFor(() => expect(left.to).toEqual([`${R}/settings/connectors?connected=google_workspace`]));
    expect(await integrations.findByText("Waiting for Google sign-in")).toBeInTheDocument();
    unmount();

    // The person comes back to the address the API named; the app shows the integrations and asks again.
    show(left.to[0]!, services);
    const back = within(await waitFor(() => card("Integrations")));
    expect(await back.findByText(/Access: drive\.file, admin\.directory\.user\.readonly/)).toBeInTheDocument();
    await userEvent.click(back.getByRole("button", { name: "Disconnect Google Workspace" }));
    expect(await back.findByRole("button", { name: "Connect Google Workspace" })).toBeInTheDocument();
  });

  it("says it is not configured when the installation has no Google connection", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    services.api.connectConnector = async () => {
      throw new Error("Google Workspace is not configured on this installation");
    };
    show(`${R}/settings/mcp`, services);
    const integrations = within(await waitFor(() => card("Integrations")));
    await userEvent.click(await integrations.findByRole("button", { name: "Connect Google Workspace" }));
    expect(await integrations.findByText("Not available on this installation")).toBeInTheDocument();
    expect(left.to).toEqual([]);
  });

  async function connected() {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    await services.api.connectConnector("google_workspace");
    await services.api.connectConnector("google_workspace");
    return { services, launch: mockLaunchStore(services)! };
  }
  const exportButton = (services: Services, props: Partial<Parameters<typeof DriveExportButton>[0]>) =>
    render(
      <MemoryRouter>
        <ServicesProvider services={services}>
          <DriveExportButton kind="agreement" id="agr_1" label="the grant agreement" {...props} />
        </ServicesProvider>
      </MemoryRouter>,
    );

  it("exports to the folder picked in Google's picker, sending only the folder id", async () => {
    const { services, launch } = await connected();
    const pick = vi.fn(async () => ({ id: "folder-123", name: "Grants 2027" }));
    exportButton(services, { pick, config: { apiKey: "test-picker-key", clientId: "1234-test.apps.googleusercontent.com" } });
    const button = await screen.findByRole("button", { name: "Export the grant agreement to Drive" });
    // Nothing from Google is asked for until the button is pressed.
    expect(pick).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="google"]')).toBeNull();
    await userEvent.click(button);
    expect(await screen.findByText(/Grant agreement\.pdf saved to Grants 2027/)).toBeInTheDocument();
    expect(launch.exports).toEqual([{ kind: "agreement", id: "agr_1", folderId: "folder-123" }]);
    expect(screen.getByRole("link", { name: "Open in Drive" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("exports nothing when the picker is closed without a choice", async () => {
    const { services, launch } = await connected();
    exportButton(services, { pick: async () => null, config: { apiKey: "test-picker-key", clientId: "1234-test.apps.googleusercontent.com" } });
    await userEvent.click(await screen.findByRole("button", { name: /Export/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Export/ })).toBeEnabled());
    expect(launch.exports).toEqual([]);
    expect(screen.queryByText(/saved to/)).not.toBeInTheDocument();
  });

  it("explains what is missing when the Picker key and client id are not set", async () => {
    const { services, launch } = await connected();
    const pick = vi.fn();
    exportButton(services, { pick, config: null });
    await userEvent.click(await screen.findByRole("button", { name: /Export/ }));
    expect(await screen.findByText(/Export to Drive is not configured on this installation/)).toBeInTheDocument();
    expect(pick).not.toHaveBeenCalled();
    expect(launch.exports).toEqual([]);
  });

  it("is not offered at all until Google Workspace is connected", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    exportButton(services, {});
    await waitFor(async () => expect(await services.api.getConnector("google_workspace")).toMatchObject({ connected: false }));
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
  });

  it("suggests people from the directory in the invite form, and only fills the address", async () => {
    const { services } = await connected();
    show(`${R}/settings/mcp`, services);
    const team = within(await waitFor(() => card("Team & roles")));
    const email = team.getByLabelText("Email to invite");
    await userEvent.type(email, "hel");
    const suggestions = within(await team.findByRole("group", { name: "From your Google directory" }));
    await userEvent.click(suggestions.getByRole("button", { name: /Helen Park/ }));
    expect(email).toHaveValue("helen.park@riverbendcf.example");
    // Choosing a suggestion invites nobody.
    expect(team.queryByText(/Invitation created/)).not.toBeInTheDocument();
  });

  it("derives the Picker's app id from the OAuth client id", () => {
    expect(appIdOf("1234567890-abc.apps.googleusercontent.com")).toBe("1234567890");
  });
});

describe("content security policy", () => {
  const API = "https://gms.example";
  const SB = "https://project.supabase.example";

  it("names no Google origin and frames nothing unless the Picker is configured", () => {
    for (const google of [undefined, {}, { apiKey: "test-picker-key" }, { clientId: "1234-test.apps.googleusercontent.com" }, { apiKey: " ", clientId: " " }]) {
      const csp = contentSecurityPolicy(API, SB, google);
      expect(csp).not.toMatch(/google/);
      expect(csp).toContain("script-src 'self';");
      expect(csp).toContain("frame-src 'none'");
      expect(headersFile(API, SB, google)).toContain("Cross-Origin-Opener-Policy: same-origin\n");
    }
  });

  it("adds exactly the Picker's origins when both values are set", () => {
    const google = { apiKey: "test-picker-key", clientId: "1234-test.apps.googleusercontent.com" };
    const directives = Object.fromEntries(
      contentSecurityPolicy(API, SB, google)
        .split("; ")
        .map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]),
    );
    expect(directives["script-src"]).toEqual(["'self'", "https://apis.google.com", "https://accounts.google.com/gsi/client"]);
    expect(directives["frame-src"]).toEqual(["https://docs.google.com", "https://accounts.google.com/gsi/"]);
    expect(directives["style-src"]).toEqual(["'self'", "https://accounts.google.com/gsi/style"]);
    expect(directives["connect-src"]).toEqual(["'self'", API, SB, "wss://project.supabase.example", "https://accounts.google.com/gsi/"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(headersFile(API, SB, google)).toContain("Cross-Origin-Opener-Policy: same-origin-allow-popups");
  });
});
