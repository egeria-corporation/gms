// SPDX-License-Identifier: AGPL-3.0-only
import { AwardBaseSchema, OpportunityBaseSchema, OpportunityDetailsSchema } from "@common-grants/sdk/schemas";
import { describe, expect, it } from "vitest";
import {
  AppFormResponseSchema,
  ApplicationBaseSchema,
  CompetitionBaseSchema,
  FormBaseSchema,
  GMS_REGISTRY,
  OrganizationBaseSchema,
  ProjectionError,
  projectApplication,
  projectAward,
  projectCompetition,
  projectForm,
  projectFormResponse,
  projectOpportunity,
  projectOpportunityDetails,
  projectOrganization,
  readPassportFields,
  unionStageForms,
} from "../src/index.ts";
import { application, award, competition, fullForm, funder, ids, loiForm, loiResponse, opportunity, organization, recipient } from "./fixtures.ts";

const opts = { baseUrl: "https://gms.opengrants.io/" };
const oppRef = { id: opportunity.id, title: opportunity.title };

function projectionError(fn: () => unknown): ProjectionError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectionError) return e;
    throw e;
  }
  throw new Error("expected a ProjectionError");
}

describe("opportunity", () => {
  it("projects to a valid OpportunityBase", () => {
    const cg = projectOpportunity({ opportunity, funder }, opts);
    expect(OpportunityBaseSchema.safeParse(cg).success).toBe(true);
    expect(cg.status).toEqual({ value: "open" });
    expect(cg.source).toBe("https://gms.opengrants.io/f/riverbend/o/rural-health-access-2027");
    expect(cg.funders?.primary).toEqual({ id: ids.funderOrg, name: "Riverbend Community Foundation Inc.", identifiers: { "org:us:ein": { id: "123456789" } } });
    expect(cg.identifiers?.systemId).toEqual({ registry: { code: GMS_REGISTRY }, id: opportunity.id });
    expect(cg.createdAt).toBe("2027-01-05T17:00:00.000Z");
    expect(cg.customFields?.gms?.value).toMatchObject({ id: `opp_${opportunity.id}`, slug: opportunity.slug, funderHandle: "riverbend" });
  });

  it("omits funders when the workspace has no Passport organization", () => {
    const cg = projectOpportunity({ opportunity, funder: { ...funder, passport_org_id: null } }, opts);
    expect(cg.funders).toBeUndefined();
  });

  it("projects OpportunityDetails with competitions and award refs", () => {
    const cg = projectOpportunityDetails(
      { opportunity, funder, competitions: [{ competition, forms: [loiForm, fullForm] }], awards: [{ id: award.id, title: award.title }] },
      opts,
    );
    expect(OpportunityDetailsSchema.safeParse(cg).success).toBe(true);
    expect(cg.competitions).toHaveLength(1);
    expect(CompetitionBaseSchema.safeParse(cg.competitions?.[0]).success).toBe(true);
    expect(cg.awards).toEqual([{ id: award.id, title: award.title }]);
  });

  it("rejects a row whose funding is not CommonGrants money", () => {
    const err = projectionError(() => projectOpportunity({ opportunity: { ...opportunity, funding: { maxAwardAmount: { amount: "a lot", currency: "USD" } } }, funder }, opts));
    expect(err.model).toBe("OpportunityBase");
    expect(err.issues[0]?.path).toBe("funding.maxAwardAmount.amount");
  });

  it("rejects a status the protocol does not have", () => {
    const err = projectionError(() => projectOpportunity({ opportunity: { ...opportunity, status: "draft" as never }, funder }, opts));
    expect(err.issues.some((i) => i.path === "status.value")).toBe(true);
  });
});

describe("form", () => {
  it("projects to a valid FormBase with schema, UI schema and both mappings", () => {
    const cg = projectForm(loiForm);
    expect(FormBaseSchema.safeParse(cg).success).toBe(true);
    expect(cg.version).toBe("3");
    expect(cg.jsonSchema).toEqual(loiForm.json_schema);
    expect(cg.uiSchema).toEqual(loiForm.ui_schema);
    expect(cg.mappingFromCommonGrants).toEqual(loiForm.mapping_from_cg);
    expect(cg.mappingToCommonGrants).toEqual(loiForm.mapping_to_cg);
    expect(cg.customFields?.gms?.value).toMatchObject({ purpose: "loi" });
  });

  it("accepts field, const and switch mapping functions", () => {
    expect(FormBaseSchema.safeParse(projectForm(fullForm)).success).toBe(true);
  });

  it("rejects a mapping leaf that is not a mapping function", () => {
    const err = projectionError(() => projectForm({ ...loiForm, mapping_from_cg: { legalName: "name" } }));
    expect(err.model).toBe("FormBase");
    expect(err.issues[0]?.path).toContain("mappingFromCommonGrants");
  });
});

describe("competition", () => {
  it("projects stages into customFields.gms and forms into their union", () => {
    const cg = projectCompetition({ competition, opportunity: oppRef, forms: [loiForm, fullForm] });
    expect(CompetitionBaseSchema.safeParse(cg).success).toBe(true);
    expect(cg.opportunity).toEqual(oppRef);
    expect(Object.keys(cg.forms.forms).sort()).toEqual([ids.loiForm, ids.fullForm].sort());
    expect(cg.forms.validation).toEqual({ stages: { loi: { required: [ids.loiForm] }, full: { required: [ids.fullForm] } } });
    const gms = cg.customFields?.gms;
    expect(gms?.fieldType).toBe("object");
    expect((gms?.value as { stages: { key: string }[] }).stages.map((s) => s.key)).toEqual(["loi", "full", "interview"]);
  });

  it("maps draft to custom, never to an invented protocol value", () => {
    const cg = projectCompetition({ competition: { ...competition, status: "draft" }, opportunity: oppRef, forms: [loiForm, fullForm] });
    expect(cg.status).toEqual({ value: "custom", customValue: "draft" });
  });

  it("handles the common single-stage case without stages", () => {
    const cg = projectCompetition({ competition: { ...competition, stages: null, forms: { [ids.loiForm]: 3 } }, opportunity: oppRef, forms: [loiForm] });
    expect(Object.keys(cg.forms.forms)).toEqual([ids.loiForm]);
    expect(cg.forms.validation).toEqual({ required: [ids.loiForm] });
  });

  it("fails when a pinned form version is missing", () => {
    const err = projectionError(() => projectCompetition({ competition, opportunity: oppRef, forms: [loiForm] }));
    expect(err.issues[0]).toEqual({ path: `forms.forms.${ids.fullForm}`, message: "pinned form version 1 was not supplied" });
  });

  it("fails when two stages pin different versions of one form", () => {
    const stages = [competition.stages![0]!, { ...competition.stages![1]!, forms: { [ids.loiForm]: 4 } }];
    expect(() => unionStageForms(stages)).toThrow(ProjectionError);
  });
});

describe("application and form responses", () => {
  it("projects a form response with provenance", () => {
    const cg = projectFormResponse(loiResponse);
    expect(AppFormResponseSchema.safeParse(cg).success).toBe(true);
    expect(cg.status).toEqual({ value: "complete" });
    expect(cg.customFields?.gms?.value).toMatchObject({ formVersion: 3, provenance: { legalName: "passport", summary: "user" } });
  });

  it("projects to a valid ApplicationBase stamped with level and attestation", () => {
    const cg = projectApplication({ application, formResponses: [loiResponse] });
    expect(ApplicationBaseSchema.safeParse(cg).success).toBe(true);
    expect(cg.status).toEqual({ value: "submitted" });
    expect(cg.submittedAt).toBe("2027-02-21T18:04:00.000Z");
    expect(Object.keys(cg.formResponses)).toEqual([ids.loiForm]);
    expect(cg.customFields?.verificationLevel?.value).toBe("L3");
    expect(cg.customFields?.attestation?.value).toBe(application.attestation_url);
    expect(cg.customFields?.gms?.value).toMatchObject({ status: "submitted", stage: "loi", requestedAmount: { amount: "150000.00", currency: "USD" } });
  });

  it("keeps submittedAt null and omits Passport fields on a draft", () => {
    const cg = projectApplication({
      application: { ...application, status: "draft", submitted_at: null, verification_level_at_submit: null, attestation_url: null },
      formResponses: [{ ...loiResponse, status: "inProgress", validation_errors: [{ field: "summary", message: "Required", type: "required" }] }],
    });
    expect(cg.status).toEqual({ value: "inProgress" });
    expect(cg.submittedAt).toBeNull();
    expect(cg.customFields?.verificationLevel).toBeUndefined();
    expect(cg.validationErrors).toEqual([{ formId: ids.loiForm, field: "summary", message: "Required", type: "required" }]);
  });

  it("refuses a response from another application, an unknown status and an unknown level", () => {
    expect(() => projectApplication({ application, formResponses: [{ ...loiResponse, application_id: ids.award }] })).toThrow(ProjectionError);
    expect(() => projectApplication({ application: { ...application, status: "approved" as never }, formResponses: [] })).toThrow(RangeError);
    expect(() => projectApplication({ application: { ...application, verification_level_at_submit: "L9" }, formResponses: [] })).toThrow(ProjectionError);
  });

  it("rejects an id that is not a UUID", () => {
    const err = projectionError(() => projectApplication({ application: { ...application, competition_id: "cmp_1" }, formResponses: [] }));
    expect(err.issues[0]?.path).toBe("competitionId");
  });
});

describe("award", () => {
  const input = { award, funder, recipient, opportunity: oppRef, application: { id: application.id, title: application.title } };

  it("projects to a valid AwardBase without customFields", () => {
    const cg = projectAward(input, opts);
    expect(AwardBaseSchema.safeParse(cg).success).toBe(true);
    expect("customFields" in cg).toBe(false);
    expect(cg.status).toEqual({ value: "awarded", customValue: "active" });
    expect(cg.funding?.disbursedAmount).toEqual({ amount: "75000.00", currency: "USD" });
    expect(cg.identifiers?.systemId).toEqual({ registry: { code: GMS_REGISTRY }, id: award.id });
    expect(cg.identifiers?.otherIds?.gms?.id).toBe(`awd_${award.id}`);
    expect(cg.recipientOrganizations?.primary.id).toBe(ids.recipientOrg);
    expect(cg.source).toBe(`https://gms.opengrants.io/common-grants/awards/${award.id}`);
  });

  it("supports an individual recipient and a parent award", () => {
    const cg = projectAward(
      { award: { ...award, recipient_individual: { name: { firstName: "Rosa", lastName: "Quintero" } }, parent_award_id: ids.parentAward }, funder, parent: { id: ids.parentAward, title: "Original award" } },
      opts,
    );
    expect(cg.recipientOrganizations).toBeUndefined();
    expect(cg.recipientIndividual?.name?.firstName).toBe("Rosa");
    expect(cg.parent).toEqual({ id: ids.parentAward, title: "Original award" });
  });

  it("refuses both recipient kinds, and anything outside the model", () => {
    expect(() => projectAward({ ...input, award: { ...award, recipient_individual: { name: { firstName: "Rosa", lastName: "Quintero" } } } }, opts)).toThrow(ProjectionError);
    const err = projectionError(() => projectAward({ ...input, award: { ...award, funding: { ...award.funding, heldAmount: { amount: "1", currency: "USD" } } as never } }, opts));
    expect(err.model).toBe("AwardBase");
    expect(err.issues[0]?.path).toBe("funding");
  });
});

describe("organization cache", () => {
  it("passes a valid cached projection through unchanged", () => {
    const cg = projectOrganization(organization);
    expect(cg).toBe(organization);
    expect(OrganizationBaseSchema.safeParse(cg).success).toBe(true);
  });

  it("refuses a cache entry with members outside OrganizationBase", () => {
    const err = projectionError(() => projectOrganization({ ...organization, bank: { name: "River City Credit Union" } }));
    expect(err.model).toBe("OrganizationBase");
  });

  it("reads the Passport custom fields, tolerating absent and malformed ones", () => {
    expect(readPassportFields(organization)).toEqual({
      verificationLevel: "L3",
      verifiedAt: "2027-01-12T19:00:00Z",
      attestation: "https://passport.opengrants.io/attestations/pp_7Hk2m9.jws",
    });
    expect(readPassportFields({})).toEqual({ verificationLevel: "L0", verifiedAt: null, attestation: null });
    expect(readPassportFields({ customFields: { verificationLevel: { value: "L7" }, attestation: { value: "not a url" } } }).verificationLevel).toBe("L0");
    expect(readPassportFields(null).attestation).toBeNull();
  });
});
