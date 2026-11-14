// SPDX-License-Identifier: AGPL-3.0-only
// Accessibility: every public, applicant, funder and reviewer route rendered from the mocks, desktop
// and phone, checked with axe-core (pinned in package.json) for serious and critical violations.
// jsdom has no layout, so color contrast and target size are checked in Chromium instead
// (README, "Accessibility").
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { provideApplicantApi, provideMockApplicantStore, provideRealtime } from "../src/api/applicantHooks.ts";
import { provideApplicantMoreApi } from "../src/api/applicantMoreHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantMoreApi, MORE_IDS, seedMoreStore } from "../src/mocks/applicantMore.ts";
import { fullStoreFor } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { mockWriteKeepStore } from "../src/api/writeKeepHooks.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { MONEY_IDS } from "../src/mocks/funderMoney.ts";
import { OUTSIDE_IDS } from "../src/mocks/outside.ts";
import { IDS } from "../src/mocks/store.ts";
import { viewport } from "./setup.ts";

const A = "/w/alder-creek";
const HEALTH = `app_${APPLICANT_IDS.appHealth}`;
const CLINIC = `app_${APPLICANT_IDS.appClinic}`;

const PUBLIC = ["/", "/agents", "/signin", "/f/riverbend", "/f/riverbend/o/community-health-2027", "/workspaces", "/notifications", "/account/agents", "/onboarding/applicant"];
const APPLICANT = [
  A,
  `${A}/organization`,
  `${A}/find`,
  `${A}/applications`,
  `${A}/applications/${HEALTH}`,
  `${A}/applications/${HEALTH}/edit`,
  `${A}/applications/${HEALTH}/edit/submit`,
  `${A}/applications/${CLINIC}`,
  `${A}/applications/${CLINIC}/submitted`,
  `${A}/grants`,
  `${A}/grants/awd_${APPLICANT_IDS.awardHealth}`,
  `${A}/grants/awd_${APPLICANT_IDS.awardHealth}/offer`,
  `${A}/grants/awd_${APPLICANT_IDS.awardClinic}`,
  `${A}/reports`,
  `${A}/reports?r=req_${MORE_IDS.reqMidYear}`,
  `${A}/reports?r=req_${MORE_IDS.reqSiteData}`,
  `${A}/library`,
  `${A}/team`,
  `${A}/funders`,
  `${A}/settings`,
  `${A}/applications?view=board`,
  `${A}/outside/${OUTSIDE_IDS.northwind}`,
  `${A}/outside/${OUTSIDE_IDS.northwind}?tab=checklist`,
  `${A}/outside/${OUTSIDE_IDS.northwind}?tab=notes`,
  `${A}/outside/${OUTSIDE_IDS.northwind}?tab=activity`,
  `${A}/outside/${OUTSIDE_IDS.pinecrest}?tab=submission`,
  `${A}/funders/${OUTSIDE_IDS.recNorthwind}`,
  // Write faster, win and keep it (v1.6, v1.7).
  `${A}/organization/documents`,
  `${A}/summary`,
  `${A}/grants/outside/${OUTSIDE_IDS.cedar}`,
  `${A}/applications?view=calendar`,
  `${A}/outside/${OUTSIDE_IDS.meadow}`,
  `${A}/outside/${OUTSIDE_IDS.lakeshore}`,
  `${A}/outside/${OUTSIDE_IDS.cedar}`,
];
const F = "/w/riverbend";
const FUNDER = [
  F,
  `${F}/programs`,
  `${F}/programs/${IDS.programHealth27}`,
  `${F}/opportunities`,
  `${F}/opportunities/new`,
  `${F}/opportunities/${IDS.oppHealth27}/edit`,
  `${F}/forms`,
  `${F}/forms/${IDS.formLoi}/edit`,
  `${F}/competitions/${IDS.compHealth27}`,
  `${F}/competitions/${IDS.compHealth27}/panel`,
  `${F}/applications`,
  `${F}/applications/${MOCK_IDS.alder}`,
  `${F}/reviews/assign`,
  `${F}/awards`,
  `${F}/awards/${MOCK_IDS.award}/agreement`,
  `${F}/awards/${MONEY_IDS.awardAlder}/payments`,
  `${F}/awards/${MONEY_IDS.awardHarbor}/payments`,
  `${F}/payments/due`,
  `${F}/payments/in-flight`,
  `${F}/reporting`,
  `${F}/reporting?tab=received`,
  `${F}/grantees`,
  `${F}/analytics`,
  `${F}/communications`,
  `${F}/settings/passport`,
  `${F}/settings/mcp`,
  `${F}/approvals`,
  "/review/assignments",
  `/review/score/${MOCK_IDS.danaScoring}`,
  "/consent",
  "/onboarding/funder/organization",
  "/onboarding/funder/brand",
];
// The six screens with a dedicated 390px layout, plus the shared ones a phone reaches.
const PHONE = [`${A}/grants/outside/${OUTSIDE_IDS.cedar}`, `${A}/summary`, `${A}/organization/documents`, A, `${A}/organization`, `${A}/applications/${HEALTH}/edit`, `${A}/applications/${HEALTH}`, `${A}/grants/awd_${APPLICANT_IDS.awardClinic}`, `${A}/reports`, `${A}/reports?r=req_${MORE_IDS.reqMidYear}`, "/notifications", "/"];

async function violations(path: string) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const more = seedMoreStore(store);
  const session = () => services.auth.getSession();
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, createMockApplicantApi({ session, store }));
  provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more }));
  provideRealtime(services, createRealtimeHub());
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  // Wait for the screen's data: a main landmark with no loading status left in it.
  await waitFor(() => {
    expect(container.querySelector("main, [role=main]")).not.toBeNull();
    expect(container.querySelector(".loading, [aria-busy=true]")).toBeNull();
  });
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

afterEach(() => {
  viewport.phone = false;
});

describe("axe: no serious or critical violations", () => {
  it.each([...PUBLIC, ...APPLICANT, ...FUNDER])("desktop %s", async (path) => {
    expect(await violations(path)).toEqual([]);
  });
  it.each(PHONE)("phone %s", async (path) => {
    viewport.phone = true;
    expect(await violations(path)).toEqual([]);
  });
});

/** Axe on the document as it stands (after the clicks a test made). */
async function check() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

describe("axe: write faster and keep it, with the assistant on and the panels open", () => {
  function mount(path: string) {
    const services = createMockServices({ session: demoSession() });
    const store = seedApplicantStore();
    fullStoreFor(store).assist = { enabled: true, quota: { used: 3, limit: 100, remaining: 97 } };
    provideMockApplicantStore(services, store);
    mockWriteKeepStore(services).settings.goNoGoEnabled = true;
    render(
      <MemoryRouter initialEntries={[path]}>
        <App services={services} />
      </MemoryRouter>,
    );
  }
  it("the AI draft panel with a draft, and comments", async () => {
    mount(`${A}/outside/${OUTSIDE_IDS.northwind}`);
    const q1 = await screen.findByRole("article", { name: /Describe the need/ });
    await userEvent.click(await within(q1).findByRole("button", { name: "Draft with AI" }));
    await userEvent.click(within(q1).getByRole("button", { name: "Write a draft" }));
    await within(q1).findByRole("status", { name: "The draft" });
    await userEvent.click(within(q1).getByRole("button", { name: "Comments" }));
    await within(q1).findByText(/No comments yet/);
    expect(await check()).toEqual([]);
  });
  it("reading the funder's guidelines", async () => {
    mount(`${A}/outside/${OUTSIDE_IDS.northwind}`);
    await userEvent.click((await screen.findAllByRole("button", { name: "Paste questions" }))[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Read the funder’s guidelines" }));
    expect(await check()).toEqual([]);
  });
  it("the go/no-go scorecard", async () => {
    mount(`${A}/outside/${OUTSIDE_IDS.meadow}`);
    await screen.findByRole("region", { name: "Go or no-go?" });
    expect(await check()).toEqual([]);
  });
  it("the obligation dialog with a series, and a report being written", async () => {
    mount(`${A}/grants/outside/${OUTSIDE_IDS.cedar}`);
    const rows = await screen.findAllByRole("button", { name: "Write the report" });
    await userEvent.click(rows[0]!);
    await screen.findByLabelText("Add a report question");
    await userEvent.click(screen.getAllByRole("button", { name: "Add an obligation" })[0]!);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Add an obligation" })).getByRole("radio", { name: "Repeats" }));
    expect(await check()).toEqual([]);
  });
  it("the vault upload dialog", async () => {
    mount(`${A}/organization/documents`);
    await userEvent.click(await screen.findByRole("button", { name: "Add a document" }));
    expect(await check()).toEqual([]);
  });
});
