// SPDX-License-Identifier: AGPL-3.0-only
// A library form used by mock mode, the styleguide and the renderer tests. It exercises every
// widget, a conditional rule, Passport prefill and a budget table capped by the requested amount.
import type { FormDefinition, JsonObject } from "@gms/forms";

export const LOI_FORM: FormDefinition = {
  id: "frm_loi_library",
  version: 2,
  title: "Letter of intent",
  description: "Shared library form: organization, project summary, budget and attestation.",
  jsonSchema: {
    type: "object",
    required: ["legalName", "projectTitle", "requestedAmount", "need", "projectType", "budget", "signature"],
    properties: {
      legalName: { type: "string", title: "Legal name" },
      mailingAddress: { type: "object", title: "Mailing address" },
      contactEmail: { type: "string", format: "email", title: "Contact email" },
      contactPhone: { type: "string", title: "Contact phone" },
      projectTitle: { type: "string", title: "Project title", maxLength: 120 },
      requestedAmount: { type: "object", title: "Requested amount" },
      startDate: { type: "string", format: "date", title: "Planned start date" },
      projectType: { type: "string", title: "Project type", enum: ["Direct service", "Capacity building", "Capital"] },
      populations: {
        type: "array",
        title: "Populations served",
        items: { type: "string", enum: ["Children", "Older adults", "Rural residents", "Veterans"] },
        uniqueItems: true,
      },
      familiesServed: { type: "integer", title: "Families served per year", minimum: 0 },
      fiscalSponsor: { type: "boolean", title: "We apply through a fiscal sponsor" },
      fiscalSponsorName: { type: "string", title: "Fiscal sponsor name" },
      need: { type: "string", title: "What need does this project address?", "x-wordCount": { max: 60 } },
      activities: { type: "string", title: "Describe the main activities" },
      keyStaff: {
        type: "array",
        title: "Key staff",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            name: { type: "string", title: "Name" },
            role: { type: "string", title: "Role on project" },
            fte: { type: "number", title: "FTE" },
          },
        },
      },
      budget: { type: "array", title: "Budget", items: { type: "object" } },
      supportLetter: { type: "object", title: "Letter of support" },
      signature: { type: "object", title: "Attestation" },
    },
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      {
        type: "Group",
        label: "Organization",
        elements: [
          { type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } },
          { type: "Control", scope: "#/properties/mailingAddress", options: { widget: "address", pii: true } },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/contactEmail", options: { pii: true } },
              { type: "Control", scope: "#/properties/contactPhone", options: { widget: "phone", pii: true } },
            ],
          },
          { type: "Control", scope: "#/properties/fiscalSponsor" },
          {
            type: "Control",
            scope: "#/properties/fiscalSponsorName",
            rule: { effect: "SHOW", condition: { scope: "#/properties/fiscalSponsor", schema: { const: true } } },
          },
        ],
      },
      {
        type: "Group",
        label: "Project",
        elements: [
          { type: "Control", scope: "#/properties/projectTitle" },
          {
            type: "HorizontalLayout",
            elements: [
              {
                type: "Control",
                scope: "#/properties/requestedAmount",
                options: { widget: "money", widgetOptions: { currency: "USD" }, help: "Range for this opportunity: $50,000 – $150,000" },
              },
              { type: "Control", scope: "#/properties/startDate" },
            ],
          },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/projectType" },
              { type: "Control", scope: "#/properties/familiesServed" },
            ],
          },
          { type: "Control", scope: "#/properties/populations" },
          {
            type: "Control",
            scope: "#/properties/need",
            options: { help: "Reviewers see this field. Avoid personal health details about named individuals." },
          },
          { type: "Control", scope: "#/properties/activities", options: { widget: "richText" } },
          { type: "Control", scope: "#/properties/keyStaff", options: { reviewerVisible: false } },
        ],
      },
      {
        type: "Group",
        label: "Budget and attachments",
        elements: [
          {
            type: "Control",
            scope: "#/properties/budget",
            options: {
              widget: "budgetTable",
              widgetOptions: {
                currency: "USD",
                categories: ["Personnel", "Travel & vehicle", "Supplies", "Indirect"],
                maxTotalPath: "/requestedAmount",
              },
            },
          },
          { type: "Control", scope: "#/properties/supportLetter", options: { widget: "fileRef", help: "PDF, up to 10 MB." } },
          { type: "Control", scope: "#/properties/signature", options: { widget: "signature" } },
        ],
      },
    ],
  },
  mappingFromCommonGrants: { legalName: { field: "name" } },
  mappingToCommonGrants: { requestedAmount: { field: "requestedAmount" }, title: { field: "projectTitle" } },
  publishedAt: "2027-01-15T00:00:00Z",
};

export const LOI_RESPONSE: JsonObject = {
  legalName: "Alder Creek Family Services",
  mailingAddress: { line1: "418 Mill Road", city: "Alder Creek", region: "OR", postalCode: "97000", country: "US" },
  contactEmail: "maria.santos@aldercreek.example",
  contactPhone: "+1 541 555 0142",
  projectTitle: "Mobile Health Navigation for Rural Families",
  requestedAmount: { amount: "150000.00", currency: "USD" },
  startDate: "2027-07-01",
  projectType: "Direct service",
  populations: ["Children", "Rural residents"],
  familiesServed: 240,
  fiscalSponsor: false,
  need: "Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four households has no reliable vehicle.",
  activities:
    "<p>Two navigators cover a weekly route of six stops. Each stop offers <strong>scheduling</strong>, transport vouchers and warm hand-offs.</p>",
  keyStaff: [
    { name: "Maria Santos", role: "Project director", fte: 0.15 },
    { name: "To be hired", role: "Community health navigator", fte: 2 },
  ],
  budget: [
    { category: "Personnel", amount: { amount: "96000.00", currency: "USD" } },
    { category: "Travel & vehicle", amount: { amount: "28000.00", currency: "USD" } },
    { category: "Supplies", amount: { amount: "11000.00", currency: "USD" } },
    { category: "Indirect", amount: { amount: "15000.00", currency: "USD" }, notes: "10% cap" },
  ],
  supportLetter: { documentId: "doc_support_letter", name: "Copper Valley Clinic — letter of support.pdf" },
  signature: { name: "Maria Santos", attested: true },
};

export const LOI_PROVENANCE: Record<string, string> = {
  "/legalName": "passport",
  "/mailingAddress": "passport",
  "/need": "library",
  "/requestedAmount": "user",
  "/activities": "agent:claude",
};
