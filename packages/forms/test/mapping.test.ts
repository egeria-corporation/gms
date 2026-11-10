// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  PREFILL_PATHS,
  applyMapping,
  buildPrefillSource,
  clone,
  evaluateMappingFunction,
  extractSubmissionFields,
  getPath,
  mergeResponse,
  passportFieldPaths,
  prefill,
  projectToCommonGrants,
  validateMappings,
} from "../src/index.ts";
import { form, org, profile, validResponse } from "./fixtures.ts";

const source = buildPrefillSource(org, profile);

describe("mapping functions", () => {
  it("field reads dot paths and JSON pointers", () => {
    expect(evaluateMappingFunction({ field: "addresses.primary.city" }, source)).toBe("Alder Creek");
    expect(evaluateMappingFunction({ field: "/addresses/primary/city" }, source)).toBe("Alder Creek");
    expect(evaluateMappingFunction({ field: "identifiers.org:us:ein.id" }, source)).toBe("000000001");
    expect(evaluateMappingFunction({ field: "nope.nothing" }, source)).toBeUndefined();
  });
  it("const returns the value", () => {
    expect(evaluateMappingFunction({ const: { a: 1 } }, source)).toEqual({ a: 1 });
  });
  it("switch picks a case or the default", () => {
    const fn = { switch: { field: "profile.commonApp.irs.subsection", case: { "03": "nonprofit" }, default: "other" } };
    expect(evaluateMappingFunction(fn, source)).toBe("nonprofit");
    expect(evaluateMappingFunction(fn, { profile: { commonApp: { irs: { subsection: "06" } } } })).toBe("other");
    expect(evaluateMappingFunction({ switch: { field: "x", case: { a: 1 } } }, {})).toBeUndefined();
    expect(evaluateMappingFunction({ switch: { field: "n", case: { "2": "two" } } }, { n: 2 })).toBe("two");
  });
  it("applyMapping builds the nested output and omits unresolved leaves", () => {
    const { value, leaves } = applyMapping({ a: { field: "name" }, b: { c: { const: 1 }, d: { field: "missing" } } }, source);
    expect(value).toEqual({ a: "Alder Creek Family Services", b: { c: 1 } });
    expect(leaves.map((l) => l.path)).toEqual(["/a", "/b/c"]);
  });
  it("every picker path under the organization resolves against the fixture or is a known optional", () => {
    // The fixture is in Passport's shape, so every picker path must name something in it. The few
    // optional members the fixture leaves out are listed, so a misspelled path cannot hide here.
    const absent = PREFILL_PATHS.filter((p) => getPath(source, p.path) === undefined).map((p) => p.path);
    expect(absent).toEqual([
      "addresses.primary.street2",
      "customFields.attestation.value",
      "profile.commonApp.financials.totalExpenses",
      "profile.commonApp.financials.netAssets",
      "profile.commonApp.irs.ntee",
    ]);
    expect(getPath(source, "identifiers.org:us:ein.id")).toBe("000000001");
    expect(getPath(source, "orgType.code")).toBe("EO000000");
    expect(getPath(source, "customFields.verificationLevel.value")).toBe("L3");
    expect(getPath(source, "profile.commonApp.financials.totalRevenue")).toBe(1920000);
    // Each leaf the picker offers is a scalar a form field can hold, never a wrapper object.
    for (const p of PREFILL_PATHS) expect(typeof getPath(source, p.path)).not.toBe("object");
  });
});

describe("prefill (mappingFromCommonGrants)", () => {
  it("fills mapped fields and marks provenance", () => {
    const out = prefill(form, source);
    expect(out.response).toEqual({
      legalName: "Alder Creek Family Services",
      ein: "000000001",
      orgKind: "nonprofit",
      contactEmail: "grants@aldercreek.example",
      contactPhone: "5550104821",
      website: "https://aldercreek.example",
      staffCount: 24,
      mailingAddress: { line1: "410 Orchard Lane", city: "Alder Creek", region: "CA", postalCode: "95000", country: "US" },
    });
    expect(out.provenance["/legalName"]).toBe("passport");
    expect(out.provenance["/mailingAddress/city"]).toBe("passport");
    expect(Object.values(out.provenance).every((v) => v === "passport")).toBe(true);
    expect(out.skipped).toEqual([]);
  });

  it("without profile consent, profile fields stay empty", () => {
    const out = prefill(form, buildPrefillSource(org, null));
    expect(out.response.staffCount).toBeUndefined();
    expect(out.provenance["/staffCount"]).toBeUndefined();
  });

  it("refresh updates Passport-sourced values but never overwrites what the applicant entered", () => {
    const first = prefill(form, source);
    const edited = mergeResponse(first.response, { contactEmail: "maria@aldercreek.example", mailingAddress: { city: "Riverbend" } }, { provenance: first.provenance });
    expect(edited.provenance["/contactEmail"]).toBe("user");
    expect(edited.provenance["/mailingAddress/city"]).toBe("user");

    const changedOrg = clone(org);
    Object.assign(changedOrg, { emails: { primary: "office@aldercreek.example" }, socials: { website: "https://www.aldercreek.example" } });
    (changedOrg.addresses as { primary: { city: string } }).primary.city = "Cascade Falls";
    const refreshed = prefill(form, buildPrefillSource(changedOrg, profile), edited);

    expect(refreshed.response.contactEmail).toBe("maria@aldercreek.example");
    expect((refreshed.response.mailingAddress as { city: string }).city).toBe("Riverbend");
    expect(refreshed.response.website).toBe("https://www.aldercreek.example");
    expect(refreshed.skipped.sort()).toEqual(["/contactEmail", "/mailingAddress/city"]);
    expect(refreshed.applied).toEqual(["/website"]);
    expect(refreshed.provenance["/contactEmail"]).toBe("user");
  });

  it("treats values typed into an empty mapped field as the applicant's", () => {
    const out = prefill(form, source, { response: { website: "https://typed.example" }, provenance: {} });
    expect(out.response.website).toBe("https://typed.example");
    expect(out.skipped).toEqual(["/website"]);
  });

  it("passportField values always follow Passport and reject edits", () => {
    expect(passportFieldPaths(form)).toEqual(["/legalName"]);
    const first = prefill(form, source);
    const attempt = mergeResponse(first.response, { legalName: "Something Else", projectTitle: "A title" }, { provenance: first.provenance, lockedPaths: passportFieldPaths(form) });
    expect(attempt.rejected).toEqual(["/legalName"]);
    expect(attempt.response.legalName).toBe("Alder Creek Family Services");
    expect(attempt.changed).toEqual(["/projectTitle"]);

    const tampered = { response: { ...first.response, legalName: "Tampered" }, provenance: { ...first.provenance, "/legalName": "user" as const } };
    const refreshed = prefill(form, source, tampered);
    expect(refreshed.response.legalName).toBe("Alder Creek Family Services");
    expect(refreshed.provenance["/legalName"]).toBe("passport");
  });
});

describe("project-back (mappingToCommonGrants)", () => {
  it("projects the response and extracts the submission fields", () => {
    const projected = projectToCommonGrants(form, validResponse);
    expect(projected).toEqual({
      name: "Mobile Health Navigation for Rural Families",
      applicantType: "organization",
      customFields: {
        requestedAmount: { name: "requestedAmount", fieldType: "object", value: { amount: "150000.00", currency: "USD" } },
        fiscalSponsor: { name: "fiscalSponsor", fieldType: "string" },
      },
    });
    expect(extractSubmissionFields(projected)).toEqual({
      title: "Mobile Health Navigation for Rural Families",
      applicantType: "organization",
      requestedAmount: { amount: "150000.00", currency: "USD" },
      customFields: projected.customFields,
    });
  });
  it("returns nothing for a form without a mapping", () => {
    expect(projectToCommonGrants({}, validResponse)).toEqual({});
    expect(extractSubmissionFields({})).toEqual({});
  });
});

describe("validateMappings", () => {
  it("accepts the fixture mappings", () => {
    expect(validateMappings(form)).toEqual([]);
  });
  it("flags prefill targets and project-back sources that are not form fields", () => {
    const errors = validateMappings({
      jsonSchema: form.jsonSchema,
      mappingFromCommonGrants: { ghost: { field: "name" }, legalName: { nested: { field: "name" } } },
      mappingToCommonGrants: { name: { field: "noSuchField" }, kind: { switch: { field: "alsoMissing", case: {} } }, ok: { const: 1 } },
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "mappingFromCommonGrants/ghost",
      "mappingFromCommonGrants/legalName/nested",
      "mappingToCommonGrants/kind",
      "mappingToCommonGrants/name",
    ]);
  });
});
