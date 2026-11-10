// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { ajvErrorsToValidationErrors, createAjv } from "../src/ajv.ts";
import { clone, effectiveSchema, validateAgainstSchema, validateResponse, type JsonObject } from "../src/index.ts";
import { form, validResponse } from "./fixtures.ts";

const keys = (errors: { field: string; type: string }[]) => errors.map((e) => `${e.field}:${e.type}`).sort();
const withChange = (change: (r: JsonObject) => void) => {
  const r = clone(validResponse);
  change(r);
  return r;
};

describe("validateResponse", () => {
  it("passes the valid fixture", () => {
    expect(validateResponse(form, validResponse)).toEqual({ valid: true, validationErrors: [] });
  });

  it("returns CommonGrants validationErrors", () => {
    const { valid, validationErrors } = validateResponse(form, {});
    expect(valid).toBe(false);
    expect(validationErrors[0]).toEqual({ field: "/legalName", message: "is required", type: "required" });
    expect(keys(validationErrors)).toEqual(
      ["/budget:required", "/hasFiscalSponsor:required", "/legalName:required", "/need:required", "/projectTitle:required", "/requestedAmount:required", "/signature:required"].sort(),
    );
  });

  it("applies widgets declared on UI controls", () => {
    expect(effectiveSchema(form).properties?.budget?.["x-widget"]).toBe("budgetTable");
    const r = withChange((x) => {
      x.requestedAmount = { amount: "100000.00", currency: "USD" };
      x.approach = "<p>fine</p><script>x</script>";
      x.signature = { name: "", attested: true };
      x.mailingAddress = { city: "Alder Creek", country: "US" };
      x.determinationLetter = {};
    });
    expect(keys(validateResponse(form, r).validationErrors)).toEqual(
      ["/approach:richText", "/budget:budgetTotal", "/determinationLetter:fileRef", "/mailingAddress/line1:address", "/signature/name:signature"].sort(),
    );
  });

  it("checks formats, lengths, word counts, enums, ranges and arrays", () => {
    const r = withChange((x) => {
      x.contactEmail = "not-an-email";
      x.contactPhone = "x";
      x.website = "aldercreek";
      x.startDate = "2027-02-30";
      x.projectTitle = "Hi";
      x.need = "Too short";
      x.orgKind = "club";
      x.staffCount = -1;
      x.focusAreas = ["health", "health", "sports"];
      x.partners = [{ email: "a@b.example" }];
    });
    expect(keys(validateResponse(form, r).validationErrors)).toEqual(
      [
        "/contactEmail:format",
        "/contactPhone:format",
        "/website:format",
        "/startDate:format",
        "/projectTitle:minLength",
        "/need:wordCount",
        "/orgKind:enum",
        "/staffCount:minimum",
        "/focusAreas:uniqueItems",
        "/focusAreas/2:enum",
        "/partners/0/name:required",
      ].sort(),
    );
  });

  it("requires the conditional field only when the condition holds", () => {
    const yes = withChange((x) => void (x.hasFiscalSponsor = true));
    expect(keys(validateResponse(form, yes).validationErrors)).toEqual(["/fiscalSponsorName:required"]);
    yes.fiscalSponsorName = "Maple Hollow Food Bank";
    expect(validateResponse(form, yes).valid).toBe(true);
  });

  it("neither requires nor validates fields hidden by a UI rule", () => {
    // fiscalSponsorName is invalid (too short) but hidden because hasFiscalSponsor is false.
    const r = withChange((x) => void (x.fiscalSponsorName = "x"));
    expect(validateAgainstSchema(effectiveSchema(form), r).map((e) => e.field)).toEqual(["/fiscalSponsorName"]);
    expect(validateResponse(form, r).valid).toBe(true);

    const hiddenRequired = {
      jsonSchema: { type: "object" as const, properties: { show: { type: "boolean" as const }, detail: { type: "string" as const } }, required: ["detail"] },
      uiSchema: {
        type: "VerticalLayout" as const,
        elements: [
          { type: "Control" as const, scope: "#/properties/show" },
          { type: "Control" as const, scope: "#/properties/detail", rule: { effect: "SHOW" as const, condition: { scope: "#/properties/show", schema: { const: true } } } },
        ],
      },
    };
    expect(validateResponse(hiddenRequired, { show: false }).valid).toBe(true);
    expect(keys(validateResponse(hiddenRequired, { show: true }).validationErrors)).toEqual(["/detail:required"]);
  });

  it("reports type mismatches once and treats a non-object response as empty", () => {
    expect(keys(validateResponse(form, withChange((x) => void (x.staffCount = "many"))).validationErrors)).toEqual(["/staffCount:type"]);
    expect(validateResponse(form, null).valid).toBe(false);
  });
});

describe("conformance with Ajv 2020", () => {
  const schema = effectiveSchema(form);
  const validate = createAjv().compile(schema);
  const cases: [string, JsonObject][] = [
    ["valid", validResponse],
    ["empty", {}],
    ["sponsor without name", withChange((x) => void (x.hasFiscalSponsor = true))],
    ["bad formats", withChange((x) => Object.assign(x, { contactEmail: "nope", website: "nope", startDate: "2027-13-01", contactPhone: "1" }))],
    ["lengths and ranges", withChange((x) => Object.assign(x, { projectTitle: "abc", staffCount: 100001, need: "one two" }))],
    ["arrays", withChange((x) => Object.assign(x, { focusAreas: [], partners: [{ name: "A" }, { name: "Bo", email: "x" }] }))],
    ["widgets", withChange((x) => Object.assign(x, { requestedAmount: { amount: "1.00", currency: "EUR" }, signature: { name: "M", attested: false }, determinationLetter: { documentId: "" } }))],
    ["over budget", withChange((x) => void (x.requestedAmount = { amount: "10.00", currency: "USD" }))],
    ["wrong types", withChange((x) => Object.assign(x, { legalName: 4, hasFiscalSponsor: "no", budget: {}, partners: "none" }))],
  ];

  it.each(cases)("%s", (_name, response) => {
    const mine = validateAgainstSchema(schema, response);
    const ajvValid = validate(response);
    const theirs = keys(ajvErrorsToValidationErrors(validate.errors));
    expect(mine.length === 0).toBe(ajvValid);
    for (const k of keys(mine)) expect(theirs).toContain(k);
  });
});
