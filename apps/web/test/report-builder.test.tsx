// SPDX-License-Identifier: AGPL-3.0-only
// The report builder screen in mock mode: build, preview, save and schedule a view, the starter
// views, the scheduled email's link, formula-safe CSV, and the HTTP client's routes.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createHttpReportsApi, type Definition } from "../src/api/reports.ts";
import { mockReportsStore } from "../src/api/reportsHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { ReportProblem, csvCell, csvText, emptyDefinition, runReport } from "../src/lib/reports.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_DATA_SETS, mockRows } from "../src/mocks/reports.ts";
import type * as Browser from "../src/lib/browser.ts";

vi.mock("../src/lib/browser.ts", async (orig) => ({ ...(await orig<typeof Browser>()), downloadBlob: vi.fn() }));

function open(path: string) {
  const services = createMockServices({ session: demoSession() });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return services;
}

describe("the in-browser engine", () => {
  const awards = MOCK_DATA_SETS.find((d) => d.key === "awards")!;
  it("refuses a column the data set does not have", () => {
    expect(() => runReport(awards, emptyDefinition("awards", ["title", "ein"]), [], { now: new Date(), limit: 200 })).toThrow(ReportProblem);
  });
  it("groups and adds up, never Passport's disbursed amount", () => {
    const d: Definition = { ...emptyDefinition("awards", ["title"]), groupBy: ["program"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }], sort: [{ column: "program", dir: "asc" }] };
    const r = runReport(awards, d, mockRows().awards, { now: new Date(), limit: 200 });
    expect(r.rows).toEqual([
      ["Community Health 2026", 2, 16_600_000],
      ["Community Health 2027", 3, 29_000_000],
    ]);
    expect(() => runReport(awards, { ...d, aggregates: [{ fn: "sum", column: "disbursedThroughPassport" }] }, [], { now: new Date(), limit: 200 })).toThrow(/cannot be added up/);
  });
  it("writes formula-safe cells", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvText({ columns: [{ key: "a", label: "A", type: "money" }], rows: [[150_000]] })).toBe("A\r\n1500.00\r\n");
  });
});

describe("report builder screen", () => {
  it("builds, previews, saves and schedules a view", async () => {
    const services = open("/w/riverbend/report-builder");
    await screen.findByRole("heading", { name: "Report builder", level: 1 });
    await userEvent.selectOptions(await screen.findByLabelText("Data set"), "awards");
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "program");
    await userEvent.selectOptions(screen.getByLabelText("Add a summary"), "sum:amount");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    const table = await screen.findByRole("table", { name: "Report preview" });
    expect(within(table).getByRole("columnheader", { name: "Total awarded amount" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Community Health 2027" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save view" }));
    const dialog = screen.getByRole("dialog", { name: "Save view" });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), "Awards by program");
    await userEvent.click(within(dialog).getByLabelText("Shared with the workspace"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    const saved = screen.getByRole("complementary", { name: "Report views" });
    expect(within(saved).getByRole("button", { name: /Awards by program.*Shared/ })).toBeInTheDocument();
    expect(mockReportsStore(services).views.map((v) => v.name)).toContain("Awards by program");

    await userEvent.click(screen.getByRole("button", { name: "Schedule" }));
    const sched = screen.getByRole("dialog", { name: /Schedule/ });
    await userEvent.click(await within(sched).findByLabelText(/Marcus Lee/));
    await userEvent.click(within(sched).getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(saved).getByRole("button", { name: /Awards by program.*On the 1st of every month/ })).toBeInTheDocument();
  });

  it("runs a starter view and has no serious accessibility problems", async () => {
    open("/w/riverbend/report-builder");
    await userEvent.click(await screen.findByRole("button", { name: "Overdue reports" }));
    const table = await screen.findByRole("table", { name: "Report preview" });
    expect(within(table).getByRole("cell", { name: "Shelter occupancy report" })).toBeInTheDocument();
    // Status is an icon and a label, never colour alone.
    expect(within(table).getAllByText("Overdue").length).toBeGreaterThan(0);
    const result = await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } } });
    expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("opens the scheduled email's link with a download, not an attachment", async () => {
    const services = open("/w/riverbend/report-builder?file=0190d000-0000-7000-8000-0000000000f1");
    expect(await screen.findByText(/Your scheduled report “Board pack: awards by program” is ready/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download the file" }));
    await waitFor(() => expect(mockReportsStore(services).downloads.length).toBe(1));
    expect(mockReportsStore(services).downloads[0]!.filename).toMatch(/^board-pack-awards-by-program-\d{4}-\d{2}\.csv$/);
  });

  it("is linked once from Analytics", async () => {
    open("/w/riverbend/analytics");
    expect(await screen.findByRole("link", { name: "Report builder" })).toHaveAttribute("href", "/w/riverbend/report-builder");
  });
});

describe("the HTTP client", () => {
  it("calls the report routes with the workspace header", async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, ...(init.body ? { body: String(init.body) } : {}) });
      expect((init.headers as Record<string, string>)["X-GMS-Workspace"]).toBe("ws-1");
      return url.includes("/export") ? new Response("A\r\n", { headers: { "Content-Disposition": 'attachment; filename="r-2027-04-16.csv"' } }) : new Response(JSON.stringify({ data: { ok: true } }));
    });
    const api = createHttpReportsApi({ baseUrl: "https://gms.test", token: async () => "t", workspaceId: () => "ws-1", fetch: fetch as unknown as typeof globalThis.fetch });
    await api.preview(emptyDefinition("awards", ["title"]));
    const f = await api.exportView("starter-overdue-reports");
    await api.setSchedule("v1", { cadence: "weekly", weekday: 1, recipientUserIds: ["u1"] });
    expect(f.filename).toBe("r-2027-04-16.csv");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST https://gms.test/gms/reports/preview", "GET https://gms.test/gms/report-views/starter-overdue-reports/export?lang=en", "PUT https://gms.test/gms/report-views/v1/schedule"]);
  });
});
