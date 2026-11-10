// SPDX-License-Identifier: AGPL-3.0-only
// Fictional fixtures: a full-proposal form with conditionals, a budget table and Passport prefill,
// and a fictional organization as Passport serves it: CommonGrants v0.5.0 `OrganizationBase`, plus
// the Common App profile folded from Passport's `/commonApp/...` field pointers.
import type { FormDefinition, JsonObject } from "../src/index.ts";

export const org: JsonObject = {
  id: "0193a4f2-5b7e-7c11-9d2a-3f1c2b4d5e6f",
  name: "Alder Creek Family Services",
  orgType: { term: "Hospital", class: "Organization types", code: "EO000000" },
  status: { value: "active" },
  identifiers: { "org:us:ein": { id: "000000001" } },
  addresses: { primary: { street1: "410 Orchard Lane", city: "Alder Creek", stateOrProvince: "CA", postalCode: "95000", country: "US" } },
  phones: { primary: { countryCode: "+1", number: "5550104821" } },
  emails: { primary: "grants@aldercreek.example" },
  mission: "Health navigation and family support for rural households.",
  yearFounded: "2009",
  socials: { website: "https://aldercreek.example" },
  customFields: {
    verificationLevel: { name: "verificationLevel", fieldType: "string", value: "L3" },
    verifiedAt: { name: "verifiedAt", fieldType: "string", value: "2027-01-12T00:00:00Z" },
  },
};

export const profile: JsonObject = {
  commonApp: { staffCount: 24, fiscalYearEnd: "06-30", financials: { budget: 1850000, totalRevenue: 1920000 }, irs: { subsection: "03" } },
};

export const form: FormDefinition = {
  id: "frm_full",
  version: 1,
  title: "Full proposal",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    $defs: {
      partner: {
        type: "object",
        properties: { name: { type: "string", minLength: 2 }, email: { type: "string", format: "email" } },
        required: ["name"],
      },
    },
    properties: {
      legalName: { type: "string" },
      ein: { type: "string" },
      orgKind: { type: "string", enum: ["nonprofit", "government", "other"] },
      contactEmail: { type: "string", format: "email" },
      contactPhone: { type: "string", format: "phone" },
      website: { type: "string", format: "uri" },
      startDate: { type: "string", format: "date" },
      projectTitle: { type: "string", minLength: 5, maxLength: 120 },
      need: { type: "string", "x-wordCount": { min: 5, max: 50 } },
      approach: { type: "string" },
      staffCount: { type: "integer", minimum: 0, maximum: 100000 },
      focusAreas: { type: "array", items: { type: "string", enum: ["health", "housing", "education"] }, minItems: 1, uniqueItems: true },
      partners: { type: "array", items: { $ref: "#/$defs/partner" }, maxItems: 5 },
      hasFiscalSponsor: { type: "boolean" },
      fiscalSponsorName: { type: "string", minLength: 2 },
      requestedAmount: { type: "object" },
      budget: { type: "array", items: { type: "object" } },
      mailingAddress: { type: "object" },
      determinationLetter: { type: "object" },
      signature: { type: "object" },
      internalNotes: { type: "string" },
    },
    required: ["legalName", "projectTitle", "need", "requestedAmount", "budget", "hasFiscalSponsor", "signature"],
    if: { properties: { hasFiscalSponsor: { const: true } }, required: ["hasFiscalSponsor"] },
    then: { required: ["fiscalSponsorName"] },
  },
  uiSchema: {
    type: "Categorization",
    elements: [
      {
        type: "Category",
        label: "Organization",
        elements: [
          { type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } },
          { type: "Control", scope: "#/properties/ein", options: { pii: true } },
          { type: "Control", scope: "#/properties/orgKind" },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/contactEmail", options: { pii: true } },
              { type: "Control", scope: "#/properties/contactPhone", options: { pii: true } },
            ],
          },
          { type: "Control", scope: "#/properties/website" },
          { type: "Control", scope: "#/properties/staffCount" },
          { type: "Control", scope: "#/properties/mailingAddress", options: { widget: "address" } },
          { type: "Control", scope: "#/properties/hasFiscalSponsor" },
          {
            type: "Control",
            scope: "#/properties/fiscalSponsorName",
            rule: { effect: "SHOW", condition: { scope: "#/properties/hasFiscalSponsor", schema: { const: true } } },
          },
        ],
      },
      {
        type: "Category",
        label: "Project",
        elements: [
          { type: "Control", scope: "#/properties/projectTitle" },
          { type: "Control", scope: "#/properties/startDate" },
          { type: "Control", scope: "#/properties/need" },
          { type: "Control", scope: "#/properties/approach", options: { widget: "richText" } },
          { type: "Control", scope: "#/properties/focusAreas" },
          { type: "Control", scope: "#/properties/partners" },
        ],
      },
      {
        type: "Category",
        label: "Budget",
        elements: [
          { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } },
          {
            type: "Control",
            scope: "#/properties/budget",
            options: {
              widget: "budgetTable",
              widgetOptions: { currency: "USD", categories: ["Personnel", "Program costs", "Indirect"], maxTotalPath: "/requestedAmount" },
            },
          },
          { type: "Control", scope: "#/properties/determinationLetter", options: { widget: "fileRef" } },
        ],
      },
      {
        type: "Category",
        label: "Sign",
        elements: [
          { type: "Control", scope: "#/properties/signature", options: { widget: "signature" } },
          { type: "Control", scope: "#/properties/internalNotes", options: { reviewerVisible: false } },
        ],
      },
    ],
  },
  mappingFromCommonGrants: {
    legalName: { field: "name" },
    ein: { field: "identifiers.org:us:ein.id" },
    orgKind: { switch: { field: "profile.commonApp.irs.subsection", case: { "03": "nonprofit", "04": "nonprofit" }, default: "other" } },
    contactEmail: { field: "emails.primary" },
    contactPhone: { field: "phones.primary.number" },
    website: { field: "socials.website" },
    staffCount: { field: "profile.commonApp.staffCount" },
    mailingAddress: {
      line1: { field: "addresses.primary.street1" },
      city: { field: "addresses.primary.city" },
      region: { field: "addresses.primary.stateOrProvince" },
      postalCode: { field: "addresses.primary.postalCode" },
      country: { field: "/addresses/primary/country" },
    },
  },
  mappingToCommonGrants: {
    name: { field: "projectTitle" },
    applicantType: { const: "organization" },
    customFields: {
      requestedAmount: { name: { const: "requestedAmount" }, fieldType: { const: "object" }, value: { field: "requestedAmount" } },
      fiscalSponsor: { name: { const: "fiscalSponsor" }, fieldType: { const: "string" }, value: { field: "fiscalSponsorName" } },
    },
  },
  fieldMeta: { "/mailingAddress": { pii: true } },
};

export const validResponse: JsonObject = {
  legalName: "Alder Creek Family Services",
  projectTitle: "Mobile Health Navigation for Rural Families",
  need: "Rural families travel far for basic care today.",
  approach: "<p>Two navigators ride with the <strong>mobile clinic</strong>.</p>",
  contactEmail: "grants@aldercreek.example",
  contactPhone: "+1 555 010 4821",
  focusAreas: ["health"],
  partners: [{ name: "Harbor Light Community Clinic", email: "hello@harborlight.example" }],
  hasFiscalSponsor: false,
  requestedAmount: { amount: "150000.00", currency: "USD" },
  budget: [
    { category: "Personnel", amount: { amount: "110000.00", currency: "USD" }, notes: "Two navigators" },
    { category: "Program costs", amount: { amount: "30000.00", currency: "USD" } },
    { category: "Indirect", amount: { amount: "10000.00", currency: "USD" } },
  ],
  mailingAddress: { line1: "410 Orchard Lane", city: "Alder Creek", region: "CA", postalCode: "95000", country: "US" },
  determinationLetter: { passportDocumentId: "pdoc_7f3a" },
  signature: { name: "Maria Santos", attested: true },
};
