// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard against the mock API, which runs the same import framework as the server:
// columns that look like bank or identity details are named and left out, a second import of the
// same rows skips them, a funder imports grant history from Awards with payments recorded as paid
// elsewhere, and a connected app goes through the connect step.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { mockImportsStore } from "../src/api/importsHooks.ts";
import { mockOutsideStore } from "../src/api/outsideHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_SHEET_ID } from "../src/mocks/imports.ts";

/** Made at run time; no file holds such a value. */
const IDENTITY_SHAPED = ["900", "00", "0001"].join("-");

function open(path: string, services: Services = createMockServices({ session: demoSession() })) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}

async function fromPastedCsv(csv: string) {
  await userEvent.click(await screen.findByRole("radio", { name: /A file from your computer/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Or paste CSV text"), { target: { value: csv } });
  await userEvent.click(screen.getByRole("button", { name: "Read the file" }));
  await screen.findByRole("heading", { name: "Match columns to fields" });
}

describe("the import wizard", () => {
  it("names the columns it leaves out, and never shows what was in them", async () => {
    open("/w/alder-creek/import");
    await fromPastedCsv(`Grant,Funder,Contact ref\nCapacity 2027,Larkspur Foundation,${IDENTITY_SHAPED}\n`);
    const notice = screen.getByRole("list", { name: "Columns left out" });
    expect(notice).toHaveTextContent("Contact ref: Its values look like a person's identity number");
    expect(document.body.textContent).not.toContain(IDENTITY_SHAPED);
    // A dropped column cannot be chosen for any field.
    expect(within(screen.getByLabelText(/^Notes/)).queryByRole("option", { name: "Contact ref" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    expect(await screen.findByRole("group", { name: "What will happen" })).toHaveTextContent("To import1");
  });

  it("skips rows imported before, and offers the saved matching again", async () => {
    const services = open("/w/alder-creek/import");
    const csv = "Grant,Foundation,Deadline\nYouth mentoring,Cedar Fund,2027-08-01\nClinic van,Harbor Trust,2027-10-15\n";
    await fromPastedCsv(csv);
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import 2 applications" }));
    expect(await screen.findByText("2 applications imported")).toBeInTheDocument();
    const count = mockOutsideStore(services).applications.length;

    await userEvent.click(screen.getByRole("button", { name: "Import another" }));
    await fromPastedCsv(csv);
    expect(screen.getByText("Matched as you saved it last time for this source.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    expect(await screen.findByRole("group", { name: "What will happen" })).toHaveTextContent("Skipped2");
    expect(within(screen.getByRole("table", { name: "Rows checked" })).getAllByText(/Imported already on/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Import 0 applications" })).toBeDisabled();
    expect(mockOutsideStore(services).applications).toHaveLength(count);
  });

  it("imports a funder's grant history from Awards, with payments recorded as paid elsewhere", async () => {
    const services = createMockServices({ session: demoSession() });
    await services.api.workspace("riverbend");
    open("/w/riverbend/awards", services);
    await userEvent.click(await screen.findByRole("link", { name: "Import history" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Import grant history" })).toBeInTheDocument();
    await fromPastedCsv("Organization,Grant,Amount,Award date,Paid,Paid on\nAlder Creek Family Services,Van route,50000,2024-03-01,25000,2024-04-01\nPine Valley Arts,Murals,12500,2025-01-15,,\n");
    expect(screen.getByLabelText(/^Organization/)).toHaveValue("Organization");
    expect(screen.getByLabelText(/^Amount paid/)).toHaveValue("Paid");
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    const totals = await screen.findByRole("table", { name: "Amounts by year" });
    expect(within(totals).getByRole("columnheader", { name: "Paid (recorded as paid elsewhere)" })).toBeInTheDocument();
    expect(within(totals).getAllByRole("row")[1]).toHaveTextContent("2024");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 awards" }));
    expect(await screen.findByText("2 awards imported")).toBeInTheDocument();
    expect(mockImportsStore(services).awards.map((a) => [a.title, a.paidMinor])).toEqual([
      ["Van route", 2_500_000],
      ["Murals", null],
    ]);
    expect(screen.getByRole("link", { name: "Open Awards" })).toHaveAttribute("href", "/w/riverbend/awards");
  });

  it("connects Google Sheets first, then reads a sheet from its link", async () => {
    const services = open("/w/alder-creek/import");
    const sheets = await screen.findByRole("radio", { name: /Google Sheets/ });
    expect(sheets.closest("label")).toHaveTextContent("Not connected");
    await userEvent.click(sheets);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Connect Google Sheets" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect Google Sheets" }));
    await userEvent.type(await screen.findByLabelText(/^Spreadsheet link/), `https://docs.google.com/spreadsheets/d/${MOCK_SHEET_ID}/edit`);
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByRole("heading", { name: "Match columns to fields" });
    expect(screen.getByText(/Google Sheets · Pipeline 2027/)).toBeInTheDocument();
    expect(mockImportsStore(services).connected.google_sheets).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 2 applications" })).toBeEnabled());
  });
});
