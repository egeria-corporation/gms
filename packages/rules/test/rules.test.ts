// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { allOf, anyOf, evaluate, mayAutoDecline, needsHumanReview, parseRules, type LeafRule, type Rule, type RuleContext } from "../src/index.ts";

const ctx: RuleContext = {
  org: {
    orgType: { code: "non_profit_with_501c3" },
    addresses: { primary: { region: "CA" } },
    status: { value: "active" },
    yearFounded: 2009,
    name: "Alder Creek Family Services",
    focus: ["health", "youth"],
    customFields: { verificationLevel: { value: "L2" }, verifiedAt: { value: "2027-01-12" } },
  },
  profile: { financials: { annualRevenue: 2_400_000 } },
  form: { frm_a: { fiscalSponsor: false, zero: 0 } },
  applicant: { type: "organization" },
};
const one = (rule: LeafRule, c: RuleContext = ctx) => evaluate(rule, c).results[0]!.outcome;
const LEVELS = ["L0", "L1", "L2", "L3"];

describe("operators", () => {
  it("eq / neq", () => {
    expect(one({ path: "org.status.value", op: "eq", value: "active" })).toBe("pass");
    expect(one({ path: "org.status.value", op: "eq", value: "inactive" })).toBe("fail");
    expect(one({ path: "org.status.value", op: "neq", value: "inactive" })).toBe("pass");
    expect(one({ path: "org.status.value", op: "neq", value: "active" })).toBe("fail");
    expect(one({ path: "form.frm_a.fiscalSponsor", op: "eq", value: false })).toBe("pass");
    expect(one({ path: "form.frm_a.zero", op: "eq", value: 0 })).toBe("pass");
    expect(one({ path: "org.orgType", op: "eq", value: { code: "non_profit_with_501c3" } })).toBe("pass");
  });
  it("in / nin, including array-valued fields", () => {
    expect(one({ path: "org.addresses.primary.region", op: "in", value: ["CA", "NV"] })).toBe("pass");
    expect(one({ path: "org.addresses.primary.region", op: "in", value: ["OR"] })).toBe("fail");
    expect(one({ path: "org.addresses.primary.region", op: "nin", value: ["OR"] })).toBe("pass");
    expect(one({ path: "org.addresses.primary.region", op: "nin", value: ["CA"] })).toBe("fail");
    expect(one({ path: "org.focus", op: "in", value: ["youth", "arts"] })).toBe("pass");
    expect(one({ path: "org.focus", op: "nin", value: ["arts"] })).toBe("pass");
    expect(one({ path: "org.focus", op: "in", value: "youth" as never })).toBe("unknown");
  });
  it("gt / gte / lt / lte on numbers and strings", () => {
    expect(one({ path: "profile.financials.annualRevenue", op: "lt", value: 5_000_000 })).toBe("pass");
    expect(one({ path: "profile.financials.annualRevenue", op: "lt", value: 2_400_000 })).toBe("fail");
    expect(one({ path: "profile.financials.annualRevenue", op: "lte", value: 2_400_000 })).toBe("pass");
    expect(one({ path: "profile.financials.annualRevenue", op: "gt", value: 2_400_000 })).toBe("fail");
    expect(one({ path: "profile.financials.annualRevenue", op: "gte", value: 2_400_000 })).toBe("pass");
    expect(one({ path: "org.yearFounded", op: "gt", value: 2000 })).toBe("pass");
    expect(one({ path: "org.customFields.verifiedAt.value", op: "gte", value: "2027-01-01" })).toBe("pass");
    expect(one({ path: "org.customFields.verifiedAt.value", op: "lt", value: "2027-01-01" })).toBe("fail");
  });
  it("ordinal comparison with order", () => {
    const p = "org.customFields.verificationLevel.value";
    expect(one({ path: p, op: "gte", value: "L1", order: LEVELS })).toBe("pass");
    expect(one({ path: p, op: "gte", value: "L3", order: LEVELS })).toBe("fail");
    expect(one({ path: p, op: "gt", value: "L2", order: LEVELS })).toBe("fail");
    expect(one({ path: p, op: "lte", value: "L2", order: LEVELS })).toBe("pass");
    expect(one({ path: p, op: "lt", value: "L3", order: LEVELS })).toBe("pass");
    expect(one({ path: p, op: "gte", value: "L9", order: LEVELS })).toBe("unknown");
  });
  it("exists", () => {
    expect(one({ path: "org.name", op: "exists" })).toBe("pass");
    expect(one({ path: "org.mission", op: "exists" })).toBe("fail");
    expect(one({ path: "org.mission", op: "exists", value: false })).toBe("pass");
    expect(one({ path: "form.frm_a.zero", op: "exists" })).toBe("pass");
    expect(one({ path: "profile.x", op: "exists" }, { org: {} })).toBe("fail");
  });
  it("matches", () => {
    expect(one({ path: "org.name", op: "matches", value: "^Alder" })).toBe("pass");
    expect(one({ path: "org.name", op: "matches", value: "^Harbor" })).toBe("fail");
    expect(one({ path: "org.yearFounded", op: "matches", value: "^20" })).toBe("unknown");
    expect(one({ path: "org.name", op: "matches", value: "(" })).toBe("unknown");
  });
  it("applicant.type", () => {
    expect(one({ path: "applicant.type", op: "eq", value: "organization" })).toBe("pass");
    expect(one({ path: "applicant.type", op: "in", value: ["individual"] })).toBe("fail");
  });
});

describe("unknown handling", () => {
  it("missing values are unknown by default and follow the missing policy", () => {
    const base: LeafRule = { path: "profile.financials.staffCount", op: "gt", value: 3 };
    expect(one(base)).toBe("unknown");
    expect(one({ ...base, missing: "unknown" })).toBe("unknown");
    expect(one({ ...base, missing: "fail" })).toBe("fail");
    expect(one({ ...base, missing: "pass" })).toBe("pass");
    // An absent source (profile not consented) is missing, not an error.
    expect(one({ path: "profile.financials.annualRevenue", op: "lt", value: 1 }, { org: {} })).toBe("unknown");
    expect(one({ path: "form.frm_zz.x", op: "eq", value: 1 })).toBe("unknown");
  });
  it("type mismatches are unknown, not fail", () => {
    expect(one({ path: "org.name", op: "gt", value: 5 })).toBe("unknown");
    expect(one({ path: "org.yearFounded", op: "lt", value: "2000" })).toBe("unknown");
  });
  it("three-valued all / any", () => {
    expect(allOf([])).toBe("pass");
    expect(allOf(["pass", "pass"])).toBe("pass");
    expect(allOf(["pass", "unknown"])).toBe("unknown");
    expect(allOf(["unknown", "fail"])).toBe("fail");
    expect(anyOf([])).toBe("fail");
    expect(anyOf(["fail", "fail"])).toBe("fail");
    expect(anyOf(["fail", "unknown"])).toBe("unknown");
    expect(anyOf(["unknown", "pass"])).toBe("pass");
  });
  it("unknown never auto-declines", () => {
    const e = evaluate({ all: [{ path: "org.status.value", op: "eq", value: "active" }, { path: "profile.missing", op: "lt", value: 1 }] }, ctx);
    expect(e.eligible).toBe("unknown");
    expect(mayAutoDecline(e)).toBe(false);
    expect(needsHumanReview(e)).toBe(true);
    const f = evaluate({ all: [{ path: "org.status.value", op: "eq", value: "inactive" }, { path: "profile.missing", op: "lt", value: 1 }] }, ctx);
    expect(f.eligible).toBe(false);
    expect(mayAutoDecline(f)).toBe(true);
  });
});

describe("evaluate", () => {
  const spec: Rule = {
    all: [
      { path: "org.orgType.code", op: "in", value: ["non_profit_with_501c3"], label: "501(c)(3) nonprofit" },
      { path: "org.addresses.primary.region", op: "in", value: ["CA", "NV"] },
      { path: "org.customFields.verificationLevel.value", op: "gte", value: "L1", order: LEVELS },
      { path: "profile.financials.annualRevenue", op: "lt", value: 5000000, missing: "unknown" },
      { any: [{ path: "form.frm_a.fiscalSponsor", op: "eq", value: true }, { path: "org.status.value", op: "eq", value: "active" }] },
    ],
  };
  it("evaluates the spec example and flattens leaf results in order", () => {
    const e = evaluate(spec, ctx);
    expect(e.eligible).toBe(true);
    expect(e.results.map((r) => r.outcome)).toEqual(["pass", "pass", "pass", "pass", "fail", "pass"]);
    expect(e.results[0]).toMatchObject({ label: "501(c)(3) nonprofit", actual: "non_profit_with_501c3" });
    expect(e.results[1]!.label).toBe("org.addresses.primary.region");
  });
  it("fails on a definite miss and is unknown without the profile", () => {
    expect(evaluate(spec, { ...ctx, org: { ...(ctx.org as object), addresses: { primary: { region: "OR" } } } }).eligible).toBe(false);
    expect(evaluate(spec, { ...ctx, profile: undefined }).eligible).toBe("unknown");
  });
  it("no rules means eligible", () => {
    expect(evaluate(null, ctx)).toEqual({ eligible: true, results: [] });
    expect(evaluate({ all: [] }, ctx).eligible).toBe(true);
    expect(evaluate({ any: [] }, ctx).eligible).toBe(false);
  });
  it("explains with templates and defaults", () => {
    const t = evaluate({ path: "org.addresses.primary.region", op: "in", value: ["NV"], label: "Service area", explain: "{{label}}: {{actual}} is outside {{value}} ({{outcome}}) {{nope}}" }, ctx).results[0]!;
    expect(t.explain).toBe("Service area: CA is outside NV (fail) {{nope}}");
    const d = evaluate({ path: "org.yearFounded", op: "gte", value: 2010, label: "Founded" }, ctx).results[0]!;
    expect(d.explain).toBe("Founded: Not met. Requires that it is at least 2010; found 2009.");
    const u = evaluate({ path: "profile.staff", op: "gt", value: 1, label: "Staff" }, ctx).results[0]!;
    expect(u.explain).toBe("Staff: could not be checked because profile.staff is not available.");
    expect(evaluate({ path: "org.name", op: "exists", label: "Name" }, ctx).results[0]!.explain).toMatch(/^Name: Met\. Requires that it is provided/);
  });
});

describe("parseRules", () => {
  it("accepts the spec example", () => {
    const r = parseRules({ all: [{ path: "org.orgType.code", op: "in", value: ["x"] }, { any: [{ path: "form.frm_a.fiscalSponsor", op: "eq", value: true }] }] });
    expect(r.ok).toBe(true);
  });
  const bad: [string, unknown][] = [
    ["not an object", 5],
    ["both groups", { all: [], any: [] }],
    ["group with path", { all: [], path: "org.x" }],
    ["group not array", { all: {} }],
    ["no path", { op: "eq", value: 1 }],
    ["bad source", { path: "bank.number", op: "eq", value: 1 }],
    ["no field", { path: "org", op: "eq", value: 1 }],
    ["short form path", { path: "form.frm_a", op: "eq", value: 1 }],
    ["bad op", { path: "org.x", op: "like", value: 1 }],
    ["missing value", { path: "org.x", op: "eq" }],
    ["in needs array", { path: "org.x", op: "in", value: "a" }],
    ["exists value", { path: "org.x", op: "exists", value: "yes" }],
    ["bad regex", { path: "org.x", op: "matches", value: "(" }],
    ["regex type", { path: "org.x", op: "matches", value: 3 }],
    ["order on eq", { path: "org.x", op: "eq", value: "L1", order: ["L0", "L1"] }],
    ["value not in order", { path: "org.x", op: "gte", value: "L9", order: ["L0", "L1"] }],
    ["order dupes", { path: "org.x", op: "gte", value: "L0", order: ["L0", "L0"] }],
    ["bad missing", { path: "org.x", op: "eq", value: 1, missing: "skip" }],
    ["bad label", { path: "org.x", op: "eq", value: 1, label: 3 }],
    ["bad explain", { path: "org.x", op: "eq", value: 1, explain: 3 }],
  ];
  it.each(bad)("rejects %s", (_n, input) => {
    expect(parseRules(input).ok).toBe(false);
  });
  it("reports where the error is and collects all of them", () => {
    const r = parseRules({ all: [{ path: "org.x", op: "eq", value: 1 }, { any: [{ path: "nope", op: "zz" }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.every((e) => e.at === "/all/1/any/0")).toBe(true);
      expect(r.errors.length).toBe(2);
    }
  });
  it("limits nesting depth", () => {
    let node: unknown = { path: "org.x", op: "exists" };
    for (let i = 0; i < 10; i++) node = { all: [node] };
    expect(parseRules(node).ok).toBe(false);
  });
});

describe("self-reported and Passport-only facts", () => {
  const ctx: RuleContext = { org: { orgType: "nonprofit", state: "MN" }, form: { f1: { budget: 10 } } };
  const sd = { selfReported: ["org", "profile"], passportFacts: false } as const;
  const isNonprofit: Rule = { path: "org.orgType", op: "eq", value: "nonprofit", label: "Nonprofit" };
  const inTexas: Rule = { path: "org.state", op: "eq", value: "TX" };
  const level: Rule = { path: "org.customFields.verificationLevel.value", op: "gte", value: "L2", order: ["L0", "L1", "L2", "L3"] };

  it("marks a rule that read a self-reported fact", () => {
    const r = evaluate(isNonprofit, ctx, { ...sd, acceptSelfReported: true });
    expect(r.eligible).toBe(true);
    expect(r.results[0]!.selfReported).toBe(true);
  });
  it("turns a pass on self-reported facts into needs-review unless the funder accepts them", () => {
    const r = evaluate(isNonprofit, ctx, sd);
    expect(r.eligible).toBe("unknown");
    expect(r.results[0]!.explain).toMatch(/entered itself/);
  });
  it("keeps a fail on self-reported facts a fail", () => {
    expect(evaluate(inTexas, ctx, sd).eligible).toBe(false);
  });
  it("does not mark form answers or Passport facts as self-reported", () => {
    const r = evaluate({ path: "form.f1.budget", op: "lte", value: 20 }, ctx, sd);
    expect(r.eligible).toBe(true);
    expect(r.results[0]!.selfReported).toBeUndefined();
    expect(evaluate(isNonprofit, ctx).results[0]!.selfReported).toBeUndefined();
  });
  it("an any-group still passes on a verified branch", () => {
    expect(evaluate({ any: [isNonprofit, { path: "form.f1.budget", op: "lte", value: 20 }] }, ctx, sd).eligible).toBe(true);
  });
  it("makes Passport-only rules unknown for an applicant without Passport, even with missing: fail or pass", () => {
    for (const missing of ["fail", "pass"] as const) {
      const r = evaluate({ ...level, missing } as LeafRule, ctx, sd);
      expect(r.eligible).toBe("unknown");
      expect(r.results[0]!.explain).toMatch(/Passport/);
    }
    expect(evaluate({ path: "profile.irs.subsection", op: "eq", value: "03", missing: "pass" }, ctx, sd).eligible).toBe("unknown");
  });
  it("marks the applicant type when the caller says it is self-reported", () => {
    const rule: Rule = { path: "applicant.type", op: "eq", value: "non_profit_with_501c3" };
    const r = evaluate(rule, { applicant: { type: "non_profit_with_501c3" } }, { selfReported: ["org", "profile", "applicant"], passportFacts: false });
    expect(r.eligible).toBe("unknown");
    expect(r.results[0]!.selfReported).toBe(true);
  });
  it("leaves Passport-only rules alone for a Passport applicant", () => {
    const org = { customFields: { verificationLevel: { value: "L3" } } };
    expect(evaluate(level, { org }, { passportFacts: true }).eligible).toBe(true);
  });
});
