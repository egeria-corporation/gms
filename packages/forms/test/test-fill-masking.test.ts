// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { PII_MASK, computeBudgetTotals, fieldMetaFor, maskForReviewer, testFill, toMinor, validateResponse, type FormDefinition } from "../src/index.ts";
import { form, validResponse } from "./fixtures.ts";

describe("test-fill", () => {
  it.each([1, 2, 3, 7, 42, 2027, 99999])("seed %i produces a valid response", (seed) => {
    const response = testFill(form, { seed });
    expect(validateResponse(form, response)).toEqual({ valid: true, validationErrors: [] });
  });
  it("is deterministic per seed and varies across seeds", () => {
    expect(testFill(form, { seed: 5 })).toEqual(testFill(form, { seed: 5 }));
    expect(testFill(form, { seed: 5 })).not.toEqual(testFill(form, { seed: 6 }));
  });
  it("keeps the budget within the requested amount", () => {
    const r = testFill(form, { seed: 11 });
    const requested = toMinor((r.requestedAmount as { amount: string }).amount);
    expect(computeBudgetTotals(r.budget).totalMinor).toBeLessThanOrEqual(requested);
    expect(computeBudgetTotals(r.budget).totalMinor).toBeGreaterThan(0);
  });
  it("fills the conditional field only when its condition holds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = testFill(form, { seed });
      expect(r.hasFiscalSponsor === true).toBe(typeof r.fiscalSponsorName === "string");
      seen.add(String(r.hasFiscalSponsor));
    }
    expect(seen).toEqual(new Set(["true", "false"]));
  });
  it("can fill required fields only", () => {
    const r = testFill(form, { seed: 3, includeOptional: false });
    expect(r.website).toBeUndefined();
    expect(validateResponse(form, r).valid).toBe(true);
  });
  it("honours const, enum, numeric ranges, lengths and nested conditionals", () => {
    const f: Pick<FormDefinition, "jsonSchema" | "uiSchema"> = {
      jsonSchema: {
        type: "object",
        properties: {
          kind: { const: "report" },
          tier: { type: "string", enum: ["a", "b"] },
          score: { type: "integer", minimum: 3, maximum: 4 },
          ratio: { type: "number", minimum: 0.25, maximum: 0.5 },
          code: { type: "string", minLength: 30, maxLength: 32 },
          zip: { type: "string", pattern: "^[0-9]{5}$", examples: ["95000"] },
          when: { type: "string", format: "date-time" },
          other: { type: "string" },
        },
        required: ["kind", "tier", "score", "ratio", "code", "zip", "when"],
        if: { properties: { tier: { const: "a" } } },
        then: { properties: { other: { type: "string", minLength: 3 } }, required: ["other"] },
        else: { properties: { other: { const: "n/a" } }, required: ["other"] },
      },
      uiSchema: { type: "VerticalLayout", elements: [] },
    };
    for (let seed = 1; seed <= 12; seed++) expect(validateResponse(f, testFill(f, { seed })).validationErrors).toEqual([]);
  });
});

describe("reviewer masking", () => {
  it("merges control options with fieldMeta", () => {
    const meta = fieldMetaFor(form);
    expect(meta["/ein"]).toEqual({ reviewerVisible: true, pii: true });
    expect(meta["/internalNotes"]).toEqual({ reviewerVisible: false, pii: false });
    expect(meta["/mailingAddress"]).toEqual({ reviewerVisible: true, pii: true });
    expect(meta["/projectTitle"]).toEqual({ reviewerVisible: true, pii: false });
  });
  const response = { ...validResponse, ein: "00-0000001", internalNotes: "Board vote pending" };
  it("internal reviewers see PII but never reviewer-hidden fields", () => {
    const out = maskForReviewer(form, response, { external: false });
    expect(out.removed).toEqual(["/internalNotes"]);
    expect(out.masked).toEqual([]);
    expect(out.response.ein).toBe("00-0000001");
    expect("internalNotes" in out.response).toBe(false);
  });
  it("external reviewers get PII masked", () => {
    const out = maskForReviewer(form, response, { external: true });
    expect(out.masked).toEqual(["/contactEmail", "/contactPhone", "/ein", "/mailingAddress"]);
    expect(out.response).toMatchObject({ ein: PII_MASK, contactEmail: PII_MASK, mailingAddress: PII_MASK, projectTitle: validResponse.projectTitle });
    expect(response.ein).toBe("00-0000001");
  });
  it("fieldMeta can hide a field the UI schema shows", () => {
    const out = maskForReviewer({ ...form, fieldMeta: { "/need": { reviewerVisible: false } } }, response, { external: false });
    expect(out.removed).toEqual(["/internalNotes", "/need"]);
  });
});
