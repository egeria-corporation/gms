// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  APP_STATUS_OPTIONS,
  applicationStatusesForCg,
  applicationStatusToCg,
  awardStatusesForCg,
  awardStatusToCg,
  competitionStatusToCg,
  parseId,
  prefixedId,
  toMinor,
  toMoney,
} from "../src/index.ts";

describe("status mapping (build spec §10.1)", () => {
  it.each([
    ["draft", "inProgress", undefined],
    ["submitted", "submitted", undefined],
    ["screening", "custom", "screening"],
    ["under_review", "custom", "underReview"],
    ["recommended", "custom", "recommended"],
    ["accepted", "accepted", undefined],
    ["declined", "rejected", undefined],
    ["waitlisted", "custom", "waitlisted"],
    ["revision_requested", "custom", "revisionRequested"],
    ["interview", "custom", "interview"],
    ["withdrawn", "custom", "withdrawn"],
  ])("application %s → %s / %s", (gms, value, customValue) => {
    const cg = applicationStatusToCg(gms);
    expect(cg.value).toBe(value);
    expect(cg.customValue).toBe(customValue);
    expect(APP_STATUS_OPTIONS).toContain(cg.value);
  });

  it.each([
    ["offered", "awarded"],
    ["accepted", "awarded"],
    ["active", "awarded"],
    ["suspended", "awarded"],
    ["completed", "completed"],
    ["cancelled", "cancelled"],
  ])("award %s → %s with the GMS status as customValue", (gms, value) => {
    expect(awardStatusToCg(gms)).toEqual({ value, customValue: gms });
  });

  it("maps competition statuses and refuses unknown ones", () => {
    expect(competitionStatusToCg("open")).toEqual({ value: "open" });
    expect(competitionStatusToCg("draft")).toEqual({ value: "custom", customValue: "draft" });
    expect(() => applicationStatusToCg("toString")).toThrow(RangeError);
    expect(() => awardStatusToCg("paid")).toThrow(RangeError);
  });

  it("resolves CommonGrants filter values back to GMS statuses", () => {
    expect(applicationStatusesForCg("rejected")).toEqual(["declined"]);
    expect(applicationStatusesForCg("underReview")).toEqual(["under_review"]);
    expect(applicationStatusesForCg("custom")).toHaveLength(7);
    expect(awardStatusesForCg("awarded")).toEqual(["offered", "accepted", "active", "suspended"]);
    expect(awardStatusesForCg("suspended")).toEqual(["suspended"]);
  });
});

describe("ids and money", () => {
  const uuid = "0192f0c1-7a3e-7b2c-9a41-5d2f6c1e8b90";

  it("round-trips prefixed ids and rejects the wrong prefix", () => {
    expect(prefixedId("award", uuid)).toBe(`awd_${uuid}`);
    expect(parseId("award", `awd_${uuid}`)).toBe(uuid);
    expect(parseId("award", uuid)).toBe(uuid);
    expect(parseId("award", `app_${uuid}`)).toBeNull();
    expect(parseId("tranche", "trn_1")).toBeNull();
  });

  it("converts minor units to CommonGrants money and back", () => {
    expect(toMoney(15000000, "usd")).toEqual({ amount: "150000.00", currency: "USD" });
    expect(toMoney(5, "USD").amount).toBe("0.05");
    expect(toMoney(-1250, "USD").amount).toBe("-12.50");
    expect(toMoney(5000, "JPY").amount).toBe("5000");
    expect(toMinor({ amount: "150000.00", currency: "USD" })).toBe(15000000);
    expect(toMinor({ amount: "12.5", currency: "USD" })).toBe(1250);
    expect(toMinor({ amount: "12", currency: "USD" })).toBe(1200);
    expect(() => toMinor({ amount: "1.005", currency: "USD" })).toThrow(RangeError);
    expect(() => toMoney(1.5, "USD")).toThrow(RangeError);
  });
});
