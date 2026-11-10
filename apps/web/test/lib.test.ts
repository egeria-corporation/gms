// SPDX-License-Identifier: AGPL-3.0-only
import { validateFormDefinition } from "@gms/forms";
import { evaluate, parseRules } from "@gms/rules";
import { AGREEMENT_STATUSES, APPLICATION_STATUSES, AWARD_STATUSES, REQUIREMENT_STATUSES, SUBMISSION_STATUSES, TRANCHE_STATUSES } from "@gms/workflow";
import { describe, expect, it } from "vitest";
import { STATUS, statusLook } from "../src/components/status.tsx";
import { checkBrand, contrastRatio, luminance, suggestOnAccent, SYSTEM_BRAND } from "../src/lib/contrast.ts";
import { addField, addSection, compileForm, conditionSources, localProblems, moveField, newField, parseForm, removeField, updateField } from "../src/lib/form-model.ts";
import { daysUntil, formatAwardRange, formatDate, formatMinor, parseDollars } from "../src/lib/format.ts";
import { describeRow, rowsToRules, rulesToRows, type RuleRow } from "../src/lib/rules.ts";
import { LOI_FORM } from "../src/mocks/forms.ts";

describe("contrast", () => {
  it("computes WCAG luminance and ratios", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#1F6F8B")).toBeCloseTo(5.7, 0);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("teal", "#fff")).toBeNull();
  });

  it("passes a pair at 4.5:1 and falls back to the system accent below it", () => {
    expect(checkBrand("#1F6F8B", "#FFFFFF")).toMatchObject({ passes: true, warning: null, effective: { accent: "#1F6F8B", onAccent: "#FFFFFF" } });
    const pale = checkBrand("#9FE3CB", "#FFFFFF");
    expect(pale.passes).toBe(false);
    expect(pale.effective).toEqual(SYSTEM_BRAND);
    expect(pale.warning).toMatch(/WCAG AA needs 4\.5:1/);
    expect(checkBrand("not-a-color", "#fff").passes).toBe(false);
  });

  it("suggests the text color that reads better", () => {
    expect(suggestOnAccent("#9FE3CB")).toBe("#0D2A43");
    expect(suggestOnAccent("#0D2A43")).toBe("#FFFFFF");
  });
});

describe("format", () => {
  it("formats money, ranges and dates", () => {
    expect(formatMinor(120_000_000)).toBe("$1,200,000");
    expect(formatMinor(null)).toBe("—");
    expect(formatAwardRange({ minAwardAmount: { amount: "50000", currency: "USD" }, maxAwardAmount: { amount: "150000", currency: "USD" } })).toBe("$50,000 – $150,000");
    expect(formatAwardRange({ maxAwardAmount: { amount: "10000", currency: "USD" } })).toBe("Up to $10,000");
    expect(formatAwardRange({})).toBe("—");
    expect(formatDate("2027-04-30")).toBe("Apr 30, 2027");
    expect(formatDate(null)).toBe("—");
    expect(daysUntil("2027-04-30", new Date("2027-04-16T12:00:00Z"))).toBe(14);
  });

  it("parses dollars typed by a person and rejects anything else", () => {
    expect(parseDollars("1,200,000")).toBe(120_000_000);
    expect(parseDollars("$50,000.50")).toBe(5_000_050);
    expect(parseDollars("1.2m")).toBeNull();
    expect(parseDollars("")).toBeNull();
  });
});

describe("status vocabulary", () => {
  it.each([
    ["application", APPLICATION_STATUSES],
    ["award", AWARD_STATUSES],
    ["agreement", AGREEMENT_STATUSES],
    ["tranche", TRANCHE_STATUSES],
    ["requirement", REQUIREMENT_STATUSES],
    ["submission", SUBMISSION_STATUSES],
  ] as const)("has an icon, a label and a tone for every %s status", (kind, statuses) => {
    expect(Object.keys(STATUS[kind]).sort()).toEqual([...statuses].sort());
    for (const s of statuses) {
      const look = statusLook(kind, s);
      expect(look.label).not.toBe("");
      expect(look.icon).toBeTruthy();
    }
  });

  it("shows an unknown status as written instead of dropping it", () => {
    expect(statusLook("award", "on_hold")).toMatchObject({ label: "on hold", tone: "neutral" });
  });
});

describe("eligibility rows", () => {
  const rows: RuleRow[] = [
    { id: "a", fact: "orgType", values: ["non_profit_with_501c3", "government_tribal"] },
    { id: "b", fact: "state", values: ["OR", "WA"] },
    { id: "c", fact: "level", level: "L2" },
    { id: "d", fact: "orgActive" },
    { id: "e", fact: "revenueUnder", amount: 5_000_000 },
  ];

  it("compiles rows to a valid rules document with plain-language labels", () => {
    const rules = rowsToRules(rows);
    expect(parseRules(rules).ok).toBe(true);
    expect(rules).toEqual({
      all: [
        { path: "org.orgType.code", op: "in", value: ["non_profit_with_501c3", "government_tribal"], label: "Organization type is 501(c)(3) or Tribal government" },
        { path: "org.addresses.primary.stateCode", op: "in", value: ["OR", "WA"], label: "Located in Oregon or Washington" },
        { path: "org.customFields.verificationLevel.value", op: "gte", value: "L2", order: ["L0", "L1", "L2", "L3"], label: "Verified in Passport at L2 or higher" },
        { path: "org.status.value", op: "eq", value: "active", label: "Organization is active" },
        { path: "profile.financials.annualRevenue", op: "lt", value: 5_000_000, missing: "unknown", label: "Annual revenue under $5,000,000" },
      ],
    });
    expect(rowsToRules([])).toEqual({ all: [] });
    expect(parseRules(rowsToRules([])).ok).toBe(true);
  });

  it("round-trips through the stored document and keeps rules it does not model", () => {
    const custom = { any: [{ path: "form.x.fiscalSponsor", op: "eq" as const, value: true }], label: "Has a fiscal sponsor" };
    const back = rulesToRows({ all: [...(rowsToRules(rows) as { all: never[] }).all, custom] });
    expect(back.map((r) => r.fact)).toEqual(["orgType", "state", "level", "orgActive", "revenueUnder", "custom"]);
    expect(describeRow(back[5]!)).toBe("Has a fiscal sponsor");
    expect(rowsToRules(back)).toEqual({ all: [...(rowsToRules(rows) as { all: never[] }).all, custom] });
  });

  it("evaluates to unknown, not fail, when revenue was not shared", () => {
    const org = { orgType: { code: "non_profit_with_501c3" }, status: { value: "active" }, addresses: { primary: { stateCode: "OR" } }, customFields: { verificationLevel: { value: "L3" } } };
    expect(evaluate(rowsToRules(rows), { org, profile: {} }).eligible).toBe("unknown");
    expect(evaluate(rowsToRules(rows), { org, profile: { financials: { annualRevenue: 1_000_000 } } }).eligible).toBe(true);
    expect(evaluate(rowsToRules(rows), { org: { ...org, addresses: { primary: { stateCode: "NV" } } }, profile: {} }).eligible).toBe(false);
  });
});

describe("form model", () => {
  const parts = { jsonSchema: LOI_FORM.jsonSchema, uiSchema: LOI_FORM.uiSchema, mappingFromCommonGrants: LOI_FORM.mappingFromCommonGrants ?? {}, mappingToCommonGrants: LOI_FORM.mappingToCommonGrants ?? {} };

  it("reads a stored form into sections and fields", () => {
    const model = parseForm(parts);
    expect(model.sections.map((s) => s.label)).toEqual(["Organization", "Project", "Budget and attachments"]);
    const fields = Object.fromEntries(model.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(fields.legalName).toMatchObject({ kind: "passportField", prefill: "name", required: true });
    expect(fields.requestedAmount).toMatchObject({ kind: "money", mapsTo: "requestedAmount" });
    expect(fields.fiscalSponsorName!.showWhen).toEqual({ field: "fiscalSponsor", equals: true });
    expect(fields.need).toMatchObject({ kind: "longText", wordMax: 60 });
    expect(fields.contactEmail).toMatchObject({ kind: "email", pii: true });
    expect(fields.keyStaff).toMatchObject({ kind: "other", reviewerVisible: false });
    expect(fields.projectType!.choices).toEqual(["Direct service", "Capacity building", "Capital"]);
  });

  it("compiles back to a definition the form engine accepts, keeping mappings and conditions", () => {
    const compiled = compileForm(parseForm(parts));
    expect(validateFormDefinition(compiled)).toEqual([]);
    expect(compiled.mappingFromCommonGrants).toEqual({ legalName: { field: "name" } });
    expect(compiled.mappingToCommonGrants).toEqual({ requestedAmount: { field: "requestedAmount" }, title: { field: "projectTitle" } });
    expect([...compiled.jsonSchema.required!].sort()).toEqual([...LOI_FORM.jsonSchema.required!].sort());
    expect(compiled.jsonSchema.properties!.keyStaff).toEqual({ ...LOI_FORM.jsonSchema.properties!.keyStaff });
    expect(JSON.stringify(compiled.uiSchema)).toContain('"rule":{"effect":"SHOW","condition":{"scope":"#/properties/fiscalSponsor","schema":{"const":true}}}');
  });

  it("adds a field with a unique key and writes the prefill mapping when one is chosen", () => {
    let model = addSection({ sections: [] }, "s1");
    const first = newField(model, "text");
    model = addField(model, "s1", first);
    const second = newField(model, "text");
    expect(second.key).not.toBe(first.key);
    model = addField(model, "s1", second);
    model = updateField(model, second.key, { label: "EIN", prefill: "identifiers.org:us:ein", required: true });
    const compiled = compileForm(model);
    expect(compiled.mappingFromCommonGrants).toEqual({ [second.key]: { field: "identifiers.org:us:ein" } });
    expect(compiled.jsonSchema.required).toEqual([second.key]);
    expect(validateFormDefinition(compiled)).toEqual([]);
  });

  it("keeps one source per CommonGrants property", () => {
    let model = addSection({ sections: [] }, "s1");
    const a = newField(model, "money");
    model = addField(model, "s1", a);
    const b = newField(model, "money");
    model = addField(model, "s1", b);
    model = updateField(model, a.key, { mapsTo: "requestedAmount" });
    model = updateField(model, b.key, { mapsTo: "requestedAmount" });
    expect(compileForm(model).mappingToCommonGrants).toEqual({ requestedAmount: { field: b.key } });
  });

  it("moves fields within and across sections, and drops conditions on a removed field", () => {
    let model = parseForm(parts);
    const keys = () => model.sections.map((s) => s.fields.map((f) => f.key));
    const before = keys();
    model = moveField(model, "mailingAddress", -1);
    expect(keys()[0]!.slice(0, 2)).toEqual(["mailingAddress", "legalName"]);
    model = moveField(model, "mailingAddress", -1);
    expect(keys()[0]![0]).toBe("mailingAddress");
    const lastOfFirst = before[0]![before[0]!.length - 1]!;
    model = moveField(model, lastOfFirst, 1);
    expect(keys()[1]![0]).toBe(lastOfFirst);

    expect(conditionSources(model, "fiscalSponsorName").map((f) => f.key)).toContain("fiscalSponsor");
    model = removeField(model, "fiscalSponsor");
    expect(model.sections.flatMap((s) => s.fields).find((f) => f.key === "fiscalSponsorName")!.showWhen).toBeNull();
  });

  it("names problems before the server does", () => {
    let model = addSection({ sections: [] }, "s1");
    const select = newField(model, "select");
    model = addField(model, "s1", select);
    model = updateField(model, select.key, { choices: ["Only one"] });
    const passport = newField(model, "passportField");
    model = addField(model, "s1", passport);
    model = updateField(model, passport.key, { prefill: null });
    expect(localProblems(model)).toEqual({ [select.key]: "Add at least two choices", [passport.key]: "Choose the Passport field this shows" });
  });
});
