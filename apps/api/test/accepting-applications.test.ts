// SPDX-License-Identifier: AGPL-3.0-only
// A published open date, or a submission stage that has not opened, means the call is not taking
// applications yet. Closed and forecasted stay closed. The open day itself counts as open.
import { describe, expect, it } from "vitest";
import { acceptingApplications } from "../src/services/public.ts";

const now = new Date("2026-11-21T18:00:00Z");
type OppArg = Parameters<typeof acceptingApplications>[0];
type CompArg = Parameters<typeof acceptingApplications>[1][number];
const opp = (key_dates: OppArg["key_dates"] = {}, status = "open"): OppArg => ({ id: "opp", status, key_dates });
const open = (stages: unknown = []): CompArg[] => [{ opportunity_id: "opp", status: "open", stages }];

describe("acceptingApplications", () => {
  it("is true for an open competition whose dates are not still ahead", () => {
    expect(acceptingApplications(opp({ postDate: { date: "2026-11-01" } }), open([{ opens: "2026-11-01T00:00:00Z", requiresSubmission: true }]), now)).toBe(true);
  });

  it("is true on the published open day", () => {
    expect(acceptingApplications(opp({ postDate: { date: "2026-11-21" } }), open(), now)).toBe(true);
  });

  it("is false when the published open date is still ahead", () => {
    expect(acceptingApplications(opp({ postDate: { date: "2026-11-30" } }), open(), now)).toBe(false);
  });

  it("is false when the first submission stage has not opened", () => {
    const stages = [
      { opens: "2026-12-01T00:00:00Z", requiresSubmission: false },
      { opens: "2026-12-15T00:00:00Z", requiresSubmission: true },
    ];
    expect(acceptingApplications(opp(), open(stages), now)).toBe(false);
  });

  it("stays false for a closed or forecasted opportunity, and when no competition is open", () => {
    expect(acceptingApplications(opp({}, "closed"), open(), now)).toBe(false);
    expect(acceptingApplications(opp({}, "forecasted"), open(), now)).toBe(false);
    expect(acceptingApplications(opp(), [{ opportunity_id: "opp", status: "draft", stages: [] }], now)).toBe(false);
  });
});
