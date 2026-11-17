// SPDX-License-Identifier: AGPL-3.0-only
// Imported history in the browser against the mock API (v1.12.0): the import wizard's "What are
// you importing?" choice, past applications and reviews from a Submittable export with the
// contact and bank-shaped columns left out, and the "Imported history" section on the grantee and
// award pages, read-only, with outcome and status as an icon and a label.
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockImportsStore } from "../src/api/importsHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MONEY_IDS } from "../src/mocks/funderMoney.ts";

/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");
const APPLICATIONS = [
  "Submission ID,Title,Category,Submitter First Name,Submitter Last Name,Submitter Email,Organization,Date Submitted,Status,Amount Requested,Amount Awarded,Project summary,Bank acct,Reference",
  `70012345,Clinic van,Health 2024,Ana,Ruiz,ana@example.org,River Clinic,2024-01-10,Accepted,"$45,000","$40,000",A mobile clinic,on file,${NINE}`,
  '70012346,After-school tutors,Youth 2024,Ben,Cho,ben@example.org,Alder Creek Family Services,2024-01-12,Declined,"15,000",,Tutoring three afternoons a week,,',
].join("\n");
const REVIEWS = ["Submission ID,Submission Title,Reviewer,Reviewer Email,Impact score,Total Score,Recommendation,Comments", "70012346,After-school tutors,Jo Park,jo@example.org,2,5,Decline,Budget unclear", "70012345,Clinic van,Lee Moss,lee@example.org,5,13,Fund,Strong plan"].join("\n");

async function open(path: string) {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}

async function importAs(label: RegExp, csv: string, count: number, kind: string) {
  await userEvent.click(await screen.findByRole("radio", { name: label }));
  await userEvent.click(screen.getByRole("radio", { name: /An export from another grants system/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.click(screen.getByRole("radio", { name: "Submittable" }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Or paste CSV text"), { target: { value: csv } });
  await userEvent.click(screen.getByRole("button", { name: "Read the file" }));
  await screen.findByRole("heading", { name: "Match columns to fields" });
  await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
  await userEvent.click(await screen.findByRole("button", { name: `Import ${count} ${kind}` }));
  expect(await screen.findByText(`${count} ${kind} imported`)).toBeInTheDocument();
}

describe("imported history", () => {
  it("imports past applications and their reviews from a Submittable export", async () => {
    const services = await open("/w/riverbend/import");
    expect(await screen.findByRole("heading", { level: 1, name: "Import grant history" })).toBeInTheDocument();
    const choice = screen.getByRole("group", { name: "What are you importing?" });
    expect(within(choice).getAllByRole("radio").map((r) => r.closest("label")!.querySelector(".row")!.textContent)).toEqual(["Grant history", "Past applications", "Past reviews", "Past reports"]);
    await importAs(/^Past applications/, APPLICATIONS, 2, "past applications");
    expect(screen.getByText(/Imported history is read-only/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import another" }));
    await importAs(/^Past reviews/, REVIEWS, 2, "past reviews");

    const history = mockImportsStore(services).history;
    const tutors = history.applications.find((a) => a.title === "After-school tutors")!;
    expect(tutors).toMatchObject({ outcome: "declined", organizationId: MONEY_IDS.wsAlder, award: null });
    expect(tutors.answers).toEqual([{ question: "Project summary", answer: "Tutoring three afternoons a week" }]);
    expect(history.reviews.filter((r) => r.applicationId === tutors.id).map((r) => r.reviewerName)).toEqual(["Jo Park"]);
    const stored = JSON.stringify(history);
    for (const x of [NINE, "@example.org", "Ruiz"]) expect(stored).not.toContain(x);
  });

  it("shows on the grantee's page, read-only, with answers and reviews in place", async () => {
    await open(`/w/riverbend/grantees/${MONEY_IDS.wsAlder}`);
    const section = (await screen.findByRole("heading", { name: "Imported history" })).closest("section")!;
    expect(within(section).getByText("Read-only")).toBeInTheDocument();
    const apps = within(section).getByRole("table", { name: "Past applications" });
    // Outcome as an icon and a label, never color alone.
    for (const label of ["Declined", "Awarded"]) {
      const badge = within(apps).getAllByText(label).find((e) => e.classList.contains("bdg"))!;
      expect(badge.querySelector("svg")).not.toBeNull();
    }
    const row = within(apps).getByRole("button", { name: "After-school transport" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(await within(apps).findByText("A van for after-school pick-up three days a week.")).toBeInTheDocument();
    expect(within(apps).getByText("Lee Moss")).toBeInTheDocument();
    const reports = within(section).getByRole("table", { name: "Past reports" });
    expect(within(reports).getByText("Approved")).toBeInTheDocument();
    expect(within(reports).getByRole("button", { name: "Open Final report 2024.pdf" })).toBeInTheDocument();
    // Nothing in the section reviews, decides or pays.
    expect(within(section).queryByRole("button", { name: /review|decide|pay|approve/i })).toBeNull();
  });

  it("shows on the award page the past application it was linked to", async () => {
    await open(`/w/riverbend/awards/${MONEY_IDS.awardAlder}/agreement`);
    const section = (await screen.findByRole("heading", { name: "Imported history" })).closest("section")!;
    expect(within(within(section).getByRole("table", { name: "Past applications" })).getByRole("button", { name: "Mobile Health Navigation for Rural Families" })).toBeInTheDocument();
    expect(within(section).queryByRole("table", { name: "Past reports" })).toBeNull();
  });

  it("is left out where there is none", async () => {
    await open(`/w/riverbend/grantees/${MONEY_IDS.wsHarbor}`);
    expect(await screen.findByRole("heading", { name: "Relationship notes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Imported history" })).toBeNull();
  });
});
