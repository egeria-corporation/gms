// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { initialStatus, MAX_SERIES_INSTANCES, OBLIGATION_EDGES, obligationMoveRefusal, seriesDates } from "../src/index.ts";

describe("obligation statuses", () => {
  it("moves each kind only along its own edges", () => {
    expect(obligationMoveRefusal("report", "upcoming", "submitted")).toBeNull();
    expect(obligationMoveRefusal("report", "submitted", "done")).toBeNull();
    expect(obligationMoveRefusal("report", "upcoming", "received")).toMatch(/can become due, submitted or missed/);
    expect(obligationMoveRefusal("condition", "due", "done")).toBeNull();
    expect(obligationMoveRefusal("condition", "due", "submitted")).not.toBeNull();
    expect(obligationMoveRefusal("payment_expected", "missed", "received")).toBeNull();
    expect(obligationMoveRefusal("payment_received", "received", "due")).toMatch(/does not change/);
    expect(initialStatus("payment_received")).toBe("received");
    expect(initialStatus("report")).toBe("upcoming");
    // Every target of every edge is a status the kind can be in (the database checks the same pairs).
    const allowed = { report: ["upcoming", "due", "submitted", "done", "missed"], payment_expected: ["upcoming", "due", "received", "missed"], payment_received: ["received"], condition: ["upcoming", "due", "done", "missed"] } as const;
    for (const [kind, edges] of Object.entries(OBLIGATION_EDGES)) for (const [from, tos] of Object.entries(edges)) for (const s of [from, ...(tos ?? [])]) expect(allowed[kind as keyof typeof allowed]).toContain(s);
  });
});

describe("series", () => {
  it("runs from the start every N months until the end, inclusive", () => {
    expect(seriesDates("2027-01-01", "2028-12-31", 6)).toEqual(["2027-01-01", "2027-07-01", "2028-01-01", "2028-07-01"]);
    expect(seriesDates("2027-01-01", "2027-07-01", 6)).toEqual(["2027-01-01", "2027-07-01"]);
    expect(seriesDates("2027-03-15", "2027-03-15", 1)).toEqual(["2027-03-15"]);
  });

  it("keeps the start's day, landing on a short month's last day", () => {
    expect(seriesDates("2027-01-31", "2027-05-31", 1)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    expect(seriesDates("2027-11-30", "2028-02-29", 3)).toEqual(["2027-11-30", "2028-02-29"]);
  });

  it("refuses more than 60 dates, a backwards range and a period under a month", () => {
    expect(seriesDates("2027-01-01", "2031-12-01", 1)).toHaveLength(MAX_SERIES_INSTANCES);
    expect(() => seriesDates("2027-01-01", "2032-01-01", 1)).toThrow(/at most 60/);
    expect(() => seriesDates("2028-01-01", "2027-01-01", 1)).toThrow(/ends after/);
    expect(() => seriesDates("2027-01-01", "2028-01-01", 0)).toThrow();
    expect(() => seriesDates("2027-1-1", "2028-01-01", 1)).toThrow();
  });
});
