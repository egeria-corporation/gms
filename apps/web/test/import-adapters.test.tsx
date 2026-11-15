// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard's importer adapters against the mock API, which runs the same framework as the
// server: the system picker with each system's export steps, a recognised export's matching and its
// never-awarded rows set aside, the sensitive columns left out whatever the system, Fluxx and
// Zengine connected with the funder's own credentials (and forgotten once the import is done), and
// a zip's files matched by name and attached to the imported awards.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockImportsStore } from "../src/api/importsHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { makeZip } from "./zip.ts";

/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");

const SUBMITTABLE = [
  "Submission ID,Title,Category,Submitter First Name,Submitter Last Name,Submitter Email,Organization,Date Submitted,Status,Labels,Amount Awarded,Decision Date,Bank acct,Reference",
  `70012345,Clinic van,Health 2024,Ana,Ruiz,ana@example.org,River Clinic,2024-01-10,Accepted,priority,"$40,000",2024-03-01,on file,${NINE}`,
  "70012346,After-school tutors,Youth 2024,Ben,Cho,ben@example.org,Alder Creek Family Services,2024-01-12,Declined,,,,,",
  "70012347,Mural walk,Arts 2024,Cy,Diaz,cy@example.org,Pine Valley Arts,2024-01-15,In-Progress,,,,,",
  '70012348,Food pantry shelves,Health 2024,Di,Eng,di@example.org,Harbor Food Bank,2024-01-20,Accepted,,"12,500",2024-03-15,,',
  "70012349,Library hours,Youth 2024,Ed,Fox,ed@example.org,Cedar Library Friends,2024-02-01,Completed,,8000,2024-04-01,,",
].join("\n");
const GOOD_GRANTS = ["Slug,Title,Applicant,Organisation,Category,Chapter,Season,Status,Moderation,Grant status,Grant amount,IBAN,Year of birth", "AbCdEfGh,Coastal wetlands survey,Fay Gold,Shoreline Trust,Environment,Main,2024,submitted,approved,Funded,25000,,", "BcDeFgHi,Choir tour,Gus Hale,Valley Singers,Arts,Main,2024,submitted,rejected,,,,"].join("\n");

async function funder() {
  const services = createMockServices({ session: demoSession() });
  await services.api.workspace("riverbend");
  render(
    <MemoryRouter initialEntries={["/w/riverbend/import"]}>
      <App services={services} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Import grant history" })).toBeInTheDocument();
  return services;
}

async function paste(csv: string) {
  fireEvent.change(screen.getByLabelText("Or paste CSV text"), { target: { value: csv } });
  await userEvent.click(screen.getByRole("button", { name: "Read the file" }));
  await screen.findByRole("heading", { name: "Match columns to fields" });
}

describe("importing from another grants system", () => {
  it("lists the systems with how to export from each, and fills the matching from the one picked", async () => {
    await funder();
    await userEvent.click(await screen.findByRole("radio", { name: /An export from another grants system/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const systems = within(screen.getByRole("group", { name: "System" }).closest("fieldset")!).getAllByRole("radio");
    expect(systems.map((r) => r.closest("label")!.textContent)).toEqual(["Good Grants", "SurveyMonkey Apply", "Submittable", "Foundant GLM", "SmartSimple", "OpenWater"]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Good Grants" }));
    expect(screen.getByRole("group", { name: "How to export from Good Grants" })).toHaveTextContent("Manage applications");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Choose the Good Grants export" })).toBeInTheDocument();
    await paste(GOOD_GRANTS);
    expect(screen.getByText("Matched as a Good Grants export")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Organization/)).toHaveValue("Organisation");
    expect(screen.getByLabelText(/^Amount awarded/)).toHaveValue("Grant amount");
    const left = screen.getByRole("list", { name: "Columns left out" });
    expect(left).toHaveTextContent("IBAN");
    expect(left).toHaveTextContent("Year of birth");
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    expect(await screen.findByRole("group", { name: "What will happen" })).toHaveTextContent("To import1");
    expect(screen.getByRole("table", { name: "Rows checked" })).toHaveTextContent("Not awarded in Good Grants (Moderation: rejected)");
  });

  it("recognises an export dropped in as a plain file, sets aside what was never awarded, and attaches the zip's files", async () => {
    const services = await funder();
    await userEvent.click(await screen.findByRole("radio", { name: /A file from your computer/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await paste(SUBMITTABLE);
    expect(screen.getByText("Matched as a Submittable export")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Row ID/)).toHaveValue("Submission ID");
    expect(screen.getByRole("list", { name: "Columns left out" })).toHaveTextContent("Reference");
    expect(document.body.textContent).not.toContain(NINE);
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    const what = await screen.findByRole("group", { name: "What will happen" });
    expect(what).toHaveTextContent("To import3");
    expect(what).toHaveTextContent("Skipped2");
    expect(screen.getByRole("table", { name: "Rows checked" })).toHaveTextContent("Not awarded in Submittable (Status: Declined)");
    await userEvent.click(screen.getByRole("button", { name: "Import 3 awards" }));
    expect(await screen.findByText("3 awards imported")).toBeInTheDocument();

    const zip = makeZip({ "70012345 - Clinic van/Submission.pdf": "%PDF-1.4 made up", "Library hours/budget.xlsx": "made up", "70012346/Submission.pdf": "made up", "__MACOSX/._x": "x" });
    await userEvent.upload(await screen.findByLabelText("Choose the zip"), new File([zip], "submission-pdfs.zip", { type: "application/zip" }));
    const matched = await screen.findByRole("group", { name: "Files matched" });
    expect(matched).toHaveTextContent("2 files match an award");
    expect(matched).toHaveTextContent("1 left out");
    expect(screen.getByRole("list", { name: "Files left out" })).toHaveTextContent("Submission.pdf: No imported record matches its name");
    expect(within(screen.getByRole("table", { name: "Files to attach" })).getAllByRole("row").map((r) => r.textContent)).toEqual(["FileAwardMatched by", "Submission.pdfClinic vanIts id in the file name", "budget.xlsxLibrary hoursIts title"]);
    await userEvent.click(screen.getByRole("button", { name: "Attach 2 files" }));
    expect(await screen.findByText("2 files attached")).toBeInTheDocument();
    expect(mockImportsStore(services).files.map((f) => f.name)).toEqual(["Submission.pdf", "budget.xlsx"]);
  });

  it("offers a better match when the file looks like another system's export", async () => {
    await funder();
    await userEvent.click(await screen.findByRole("radio", { name: /An export from another grants system/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("radio", { name: "OpenWater" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await paste(SUBMITTABLE);
    expect(screen.getByText("This file looks like a Submittable export")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use Submittable's matching" }));
    await waitFor(() => expect(screen.getByText("Matched as a Submittable export")).toBeInTheDocument());
  });
});

describe("reading from Fluxx and Zengine", () => {
  it("connects Fluxx with the funder's own application, imports, and forgets the credentials once done", async () => {
    const services = await funder();
    const fluxx = await screen.findByRole("radio", { name: /^Fluxx/ });
    expect(fluxx.closest("label")).toHaveTextContent("Not connected");
    await userEvent.click(fluxx);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("list", { name: "How to connect Fluxx" })).toHaveTextContent("/oauth/applications");
    await userEvent.type(screen.getByLabelText(/^Fluxx address/), "https://riverbend.fluxx.io");
    await userEvent.type(screen.getByLabelText(/^Application id/), "gms-import");
    await userEvent.type(screen.getByLabelText(/^Application secret/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Connect Fluxx" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fluxx did not accept this application id and secret");
    await userEvent.clear(screen.getByLabelText(/^Application secret/));
    await userEvent.type(screen.getByLabelText(/^Application secret/), "made-up-secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect Fluxx" }));
    await userEvent.click(await screen.findByRole("button", { name: "Read grant requests" }));
    await screen.findByRole("heading", { name: "Match columns to fields" });
    expect(screen.getByText("Matched as a Fluxx export")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Organization/)).toHaveValue("Organization");
    expect(screen.getByLabelText(/^Amount paid/)).toHaveValue("Amount paid");
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    expect(await screen.findByRole("group", { name: "What will happen" })).toHaveTextContent("To import2");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 awards" }));
    expect(await screen.findByText("Your Fluxx credentials were deleted")).toBeInTheDocument();
    expect(Object.values(mockImportsStore(services).pullers).some((p) => p.fluxx)).toBe(false);
  });

  it("connects Zengine with a token and reads the form chosen", async () => {
    await funder();
    await userEvent.click(await screen.findByRole("radio", { name: /^Zengine/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(screen.getByLabelText(/^Access token/), "made-up-zengine-token");
    await userEvent.click(screen.getByRole("button", { name: "Connect Zengine" }));
    expect(await screen.findByLabelText(/^Form/)).toHaveValue("42");
    await userEvent.click(screen.getByRole("button", { name: "Read the form" }));
    await screen.findByRole("heading", { name: "Match columns to fields" });
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    const what = await screen.findByRole("group", { name: "What will happen" });
    expect(what).toHaveTextContent("To import1");
    expect(what).toHaveTextContent("Skipped1");
  });

  it("offers none of this to an applicant", async () => {
    render(
      <MemoryRouter initialEntries={["/w/alder-creek/import"]}>
        <App services={createMockServices({ session: demoSession() })} />
      </MemoryRouter>,
    );
    await screen.findByRole("radio", { name: /A file from your computer/ });
    expect(screen.queryByRole("radio", { name: /another grants system/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /^Fluxx/ })).toBeNull();
  });
});
