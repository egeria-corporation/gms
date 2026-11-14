// SPDX-License-Identifier: AGPL-3.0-only
// The funding summary (v1.7.0): outside and built-in applications by fiscal year, the win rate,
// asked vs. awarded, the fiscal-year setting, and the CSV and one-page PDF exports.
import { beforeEach, describe, expect, it } from "vitest";
import { fiscalYearOf, fiscalYearRange } from "../src/services/funding-summary.ts";
import { WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Year = { fiscalYear: number; label: string; start: string; end: string; submitted: number; decided: number; awarded: number; declined: number; winRate: number | null; asked: { amount: string; currency: string }[]; awardedAmount: { amount: string; currency: string }[]; bySource: { outside: { submitted: number }; gms: { submitted: number; awarded: number } } };
const data = async <T>(method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T }>(s.applicant, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const outside = (over: Record<string, unknown>) => h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, title: "T", funder_name: "F", currency: "USD", ...over } as never);

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  // FY by calendar year (January start).
  await outside({ title: "Awarded 2026", stage: "awarded", submitted_at: "2026-02-01T12:00:00Z", submission_method: "portal", ask_amount_minor: 5_000_000, decided_at: "2026-06-01T12:00:00Z", awarded_amount_minor: 4_000_000 });
  await outside({ title: "Declined 2026", stage: "declined", submitted_at: "2026-08-01T12:00:00Z", submission_method: "email", ask_amount_minor: 2_000_000, decided_at: "2026-11-01T12:00:00Z" });
  await outside({ title: "Submitted 2026, decided 2027", stage: "awarded", submitted_at: "2026-12-15T12:00:00Z", submission_method: "portal", ask_amount_minor: 1_000_000, decided_at: "2027-02-01T12:00:00Z", awarded_amount_minor: 1_000_000 });
  await outside({ title: "Pending 2027", stage: "submitted", submitted_at: "2027-03-01T12:00:00Z", submission_method: "portal", ask_amount_minor: 3_000_000 });
  await outside({ title: "Draft", stage: "drafting" });
  await outside({ title: "Withdrawn", stage: "withdrawn", submitted_at: "2027-01-05T12:00:00Z", submission_method: "portal" });
  // A built-in application, submitted and approved on this GMS.
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const uuid = started.body.data.id;
  const d = await h.repos.table("decisions").insert({ workspace_id: WS_FUNDER, competition_id: s.uuid.comp, application_id: uuid, outcome: "approve", amount_minor: 15_000_000, currency: "USD", committed_at: "2027-03-20T12:00:00Z" });
  await h.repos.table("applications").update({ id: uuid }, { status: "accepted", submitted_at: "2027-01-20T12:00:00Z", requested_amount_minor: 15_000_000, decision_id: d.id });
});

describe("fiscal years", () => {
  it("names a fiscal year for the calendar year it ends in", () => {
    expect(fiscalYearOf("2026-06-30", 1)).toBe(2026);
    expect(fiscalYearOf("2026-06-30", 7)).toBe(2026);
    expect(fiscalYearOf("2026-07-01", 7)).toBe(2027);
    expect(fiscalYearRange(2027, 7)).toEqual({ start: "2026-07-01", end: "2027-06-30", label: "FY 2027 (Jul 2026 to Jun 2027)" });
    expect(fiscalYearRange(2027, 1)).toEqual({ start: "2027-01-01", end: "2027-12-31", label: "FY 2027" });
    expect(fiscalYearRange(2028, 3).end).toBe("2028-02-29");
  });
});

describe("the funding summary", () => {
  it("counts outside and built-in applications by fiscal year, with the win rate and amounts", async () => {
    const sum = await data<{ fiscalYearStartMonth: number; years: Year[] }>("GET", "/gms/funding-summary");
    expect(sum.fiscalYearStartMonth).toBe(1);
    const [y2027, y2026] = sum.years;
    expect(y2026).toMatchObject({ fiscalYear: 2026, submitted: 3, decided: 2, awarded: 1, declined: 1, winRate: 0.5, asked: [{ amount: "80000.00", currency: "USD" }], awardedAmount: [{ amount: "40000.00", currency: "USD" }] });
    expect(y2027).toMatchObject({ fiscalYear: 2027, submitted: 3, decided: 2, awarded: 2, declined: 0, winRate: 1, asked: [{ amount: "180000.00" }], awardedAmount: [{ amount: "160000.00" }], bySource: { outside: { submitted: 2 }, gms: { submitted: 1, awarded: 1 } } });
  });

  it("follows the workspace's fiscal year start", async () => {
    await data("PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { fiscalYearStartMonth: 7 } });
    const sum = await data<{ fiscalYearStarts: string; years: Year[] }>("GET", "/gms/funding-summary");
    expect(sum.fiscalYearStarts).toBe("July");
    // Feb and Jun 2026 fall in FY 2026; Aug, Nov, Dec 2026 and Jan-Mar 2027 in FY 2027.
    expect(sum.years.map((y) => [y.fiscalYear, y.submitted, y.decided, y.awarded])).toEqual([[2027, 5, 3, 2], [2026, 1, 1, 1]]);
    expect((await s.call(s.applicant, "PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { fiscalYearStartMonth: 13 } })).status).toBe(422);
  });

  it("exports CSV and a one-page PDF, and is the applicant's own", async () => {
    const csv = await h.request("/gms/funding-summary/export?format=csv", { headers: s.applicant });
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split(/\r?\n/);
    expect(lines[0]).toBe("fiscal_year,label,start,end,submitted,decided,awarded,declined,win_rate,asked,awarded_amount,outside_submitted,outside_awarded,gms_submitted,gms_awarded");
    expect(lines[1]).toContain("2027,FY 2027,2027-01-01,2027-12-31,3,2,2,0,1.000");
    const pdf = await h.request("/gms/funding-summary/export?format=pdf", { headers: s.applicant });
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length).toBe(1);
    expect((await s.call(s.applicant, "GET", "/gms/funding-summary/export?format=xlsx")).status).toBe(400);
    expect((await s.call(s.funder, "GET", "/gms/funding-summary")).status).toBe(403);
  });
});
