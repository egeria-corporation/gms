// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../src/components/CopyButton.tsx";
import { RequirementsCalendar } from "../src/components/RequirementsCalendar.tsx";
import { copyText, csvCell, downloadBlob, toCsv } from "../src/lib/browser.ts";

afterEach(() => vi.restoreAllMocks());

describe("downloads", () => {
  it("saves a blob through a temporary link and releases the object URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:mock");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: { download: string; href: string | null }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.getAttribute("href") });
    });
    downloadBlob(new Blob(["a"]), "ledger.csv");
    expect(clicked).toEqual([{ download: "ledger.csv", href: "blob:mock" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    vi.useRealTimers();
  });

  it("quotes CSV cells and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe("\"'=SUM(A1)\"");
    expect(csvCell("-5")).toBe("\"'-5\"");
    expect(csvCell(null)).toBe('""');
    expect(toCsv([["a", 1], ["b", null]])).toBe('"a","1"\r\n"b",""');
  });
});

describe("clipboard", () => {
  it("uses the async clipboard when it is available", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    expect(await copyText("https://gms.example/mcp")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://gms.example/mcp");
    vi.unstubAllGlobals();
  });

  it("falls back to a selection copy when the clipboard API refuses", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    const exec = vi.fn(() => true);
    Object.assign(document, { execCommand: exec });
    expect(await copyText("abc")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("confirms a copy in place and says so when it fails", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CopyButton value="test-value" what="server URL" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy server URL" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    Object.assign(document, { execCommand: vi.fn(() => false) });
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("requirements calendar", () => {
  const today = new Date("2027-05-25T12:00:00Z");
  const items = [
    { id: "1", date: "2027-04-30T00:00:00Z", label: "Lakeside · Final report", tone: "overdue" as const },
    { id: "2", date: "2027-05-31T00:00:00Z", label: "Harbor Light · Quarterly financial", tone: "due" as const },
  ];

  it("shows the month, names what is due on a day and reports the day picked", async () => {
    const onSelect = vi.fn();
    render(<RequirementsCalendar items={items} today={today} onSelectDay={onSelect} />);
    expect(screen.getByRole("heading", { name: "May 2027" })).toBeInTheDocument();
    const due = screen.getByRole("button", { name: "May 31: Harbor Light · Quarterly financial (due)" });
    await userEvent.click(due);
    expect(onSelect).toHaveBeenCalledWith("2027-05-31");
    // The overdue item from April shows in the leading days of the grid.
    expect(screen.getByRole("button", { name: /^Apr 30: Lakeside · Final report \(overdue\)/ })).toBeInTheDocument();
  });

  it("moves between months and opens on the next due month when this one is empty", async () => {
    render(<RequirementsCalendar items={[items[1]!]} today={new Date("2027-02-10T12:00:00Z")} />);
    expect(screen.getByRole("heading", { name: "May 2027" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "April 2027" })).toBeInTheDocument();
    expect(screen.getByText("Nothing due this month.")).toBeInTheDocument();
  });
});
