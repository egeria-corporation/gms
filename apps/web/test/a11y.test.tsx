// SPDX-License-Identifier: AGPL-3.0-only
// Accessibility: every applicant-facing and public route rendered from the mocks, desktop and
// phone, checked with axe-core (pinned in package.json) for serious and critical violations.
// jsdom has no layout, so color contrast and target size are checked in Chromium instead
// (README, "Accessibility").
import { render, waitFor } from "@testing-library/react";
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
import { demoSession } from "../src/mocks/auth.ts";
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
];
// The six screens with a dedicated 390px layout, plus the shared ones a phone reaches.
const PHONE = [A, `${A}/organization`, `${A}/applications/${HEALTH}/edit`, `${A}/applications/${HEALTH}`, `${A}/grants/awd_${APPLICANT_IDS.awardClinic}`, `${A}/reports`, `${A}/reports?r=req_${MORE_IDS.reqMidYear}`, "/notifications", "/"];

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
  it.each([...PUBLIC, ...APPLICANT])("desktop %s", async (path) => {
    expect(await violations(path)).toEqual([]);
  });
  it.each(PHONE)("phone %s", async (path) => {
    viewport.phone = true;
    expect(await violations(path)).toEqual([]);
  });
});
