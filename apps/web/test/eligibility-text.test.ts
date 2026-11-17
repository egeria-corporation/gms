// SPDX-License-Identifier: AGPL-3.0-only
// Eligibility results in the page's language (lib/eligibilityText.ts): in English exactly the
// sentence @gms/rules writes, for every reason a result can read as it does; in Spanish the same
// sentence from the catalog; a funder's own explanation as written.
import { afterEach, describe, expect, it } from "vitest";
import { evaluate, type Rule } from "@gms/rules";
import { changeLocale } from "../src/i18n/current.ts";
import { explainResult } from "../src/lib/eligibilityText.ts";

const org = { name: "Alder Creek", customFields: { level: { value: "L2" } }, status: { value: "active" }, budget: 250000, state: "WA", tags: ["health", "rural"] };
const RULES: Rule[] = [
  { path: "org.state", op: "eq", value: "WA", label: "Based in Washington" },
  { path: "org.state", op: "neq", value: "WA", label: "Outside Washington" },
  { path: "org.state", op: "in", value: ["WA", "OR"], label: "Pacific Northwest" },
  { path: "org.state", op: "nin", value: ["CA"], label: "Not California" },
  { path: "org.budget", op: "gt", value: 100000, label: "Budget over $100k" },
  { path: "org.budget", op: "gte", value: 500000, label: "Budget at least $500k" },
  { path: "org.budget", op: "lt", value: 1000, label: "Tiny budget" },
  { path: "org.budget", op: "lte", value: 300000, label: "Budget at most $300k" },
  { path: "org.name", op: "exists", label: "Has a name" },
  { path: "org.ein", op: "exists", value: false, label: "No EIN on file", missing: "pass" },
  { path: "org.name", op: "matches", value: "^Alder", label: "Name starts with Alder" },
  { path: "org.ein", op: "exists", label: "Has an EIN" },
  { path: "org.name", op: "gt", value: 5, label: "Odd comparison" },
  { path: "org.uei", op: "eq", value: "ABC123", label: "UEI on file" },
  { path: "org.state", op: "eq", value: "WA", label: "Custom words", explain: "{{label}} — we fund Washington only." },
];

afterEach(async () => {
  await changeLocale("en");
});

describe("eligibility results in the page's language", () => {
  it("are, in English, exactly the sentence @gms/rules writes, for every kind of result", () => {
    const results = evaluate({ all: RULES }, { org }).results;
    const kinds = new Set(results.map((r) => r.because));
    for (const k of ["met", "not_met", "unavailable", "incomparable", "custom"]) expect(kinds).toContain(k);
    for (const r of results) expect(explainResult(r), r.label).toBe(r.explain);
    // Without Passport, and on what the organization entered itself.
    const noPassport = evaluate({ all: [{ path: "org.customFields.level.value", op: "gte", value: "L2", order: ["L0", "L1", "L2", "L3"], label: "Level 2" }, { path: "org.state", op: "eq", value: "WA", label: "Based in Washington" }] }, { org }, { passportFacts: false, selfReported: ["org"] }).results;
    expect(noPassport.map((r) => r.because)).toEqual(["passport_only", "self_reported"]);
    for (const r of noPassport) expect(explainResult(r)).toBe(r.explain);
    // The outcome alone, as the API answers for another organization's record.
    expect(explainResult({ rule: {}, label: "Has an EIN", outcome: "fail", explain: "Has an EIN: Not met.", because: "outcome_only" })).toBe("Has an EIN: Not met.");
  });

  it("are worded in Spanish from the catalog, and a funder's own words stay as written", async () => {
    const results = evaluate({ all: RULES }, { org }).results;
    await changeLocale("es");
    const said = (label: string) => explainResult(results.find((r) => r.label === label)!);
    expect(said("Budget at least $500k")).toBe("Budget at least $500k: no se cumple. Exige que sea al menos 500000; se encontró 250000.");
    expect(said("Pacific Northwest")).toBe("Pacific Northwest: se cumple. Exige que sea uno de estos: WA, OR; se encontró WA.");
    expect(said("UEI on file")).toBe("UEI on file: no se pudo verificar porque org.uei no está disponible.");
    expect(said("Has an EIN")).toBe("Has an EIN: no se cumple. Exige que esté indicado; no se encontró el dato.");
    expect(said("Custom words")).toBe("Custom words — we fund Washington only.");
    expect(explainResult({ rule: {}, label: "Has an EIN", outcome: "unknown", explain: "Has an EIN: Could not be checked.", because: "outcome_only" })).toBe("Has an EIN: no se pudo verificar.");
    // A result stored without a reason shows as it came.
    expect(explainResult({ rule: {}, label: "Old", outcome: "pass", explain: "Old: Met." })).toBe("Old: Met.");
  });
});
