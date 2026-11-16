// SPDX-License-Identifier: AGPL-3.0-only
// The funder page's Past Awards table (v1.9.0): an award whose funder hides amounts shows a dash,
// never $0, in the table and an empty cell in the CSV; each listed award links to its own page; and
// the API's past awards reach the table with a hidden amount as null.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { PastAward } from "../src/api/applicantFull.ts";
import { PastAwards } from "../src/screens/public/publicExtras.tsx";

const AWARDS: PastAward[] = [
  { year: "2027", recipient: "Alder Creek Family Services", amountMinor: null, currency: "USD", purpose: "Mobile Health Navigation", page: "https://gms.example/f/riverbend/awards/alder-creek-family-services-0123456789ab" },
  { year: "2027", recipient: "Birch Hollow Food Bank", amountMinor: 5_000_000, currency: "USD", purpose: "Pantry shelving", page: null },
];

describe("Past Awards", () => {
  it("shows a hidden amount as a dash, never $0, and links each listed award to its page", () => {
    render(
      <MemoryRouter>
        <PastAwards awards={AWARDS} handle="riverbend" />
      </MemoryRouter>,
    );
    const table = screen.getByRole("table");
    const [, hidden, shown] = within(table).getAllByRole("row");
    // The dash is for the eye; a screen reader hears the words (no aria-label on a plain span).
    const cell = within(hidden!).getByText("Amount not shown").closest("td")!;
    expect(cell).toHaveTextContent("—");
    expect(cell.querySelector("[aria-hidden=true]")).toHaveTextContent("—");
    expect(hidden!.textContent).not.toContain("$0");
    expect(shown!.textContent).toContain("$50,000");
    expect(within(hidden!).getByRole("link", { name: "Mobile Health Navigation" })).toHaveAttribute("href", "/f/riverbend/awards/alder-creek-family-services-0123456789ab");
    expect(within(shown!).queryByRole("link")).toBeNull();
  });
});
