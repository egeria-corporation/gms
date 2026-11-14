// SPDX-License-Identifier: AGPL-3.0-only
// What quick setup makes in mock mode: the same starter form and rubric as the Worker
// (apps/api/src/services/quick-setup.ts). test/quick-setup-contract.test.ts runs both and holds
// them to the same questions and criteria.
import type { FormInput, RubricInput } from "../api/types.ts";

const short = (title: string) => (title.length > 250 ? `${title.slice(0, 249)}…` : title);
export const starterFormTitle = (oppTitle: string) => `${short(oppTitle)} application`;
export const starterRubricName = (oppTitle: string) => `${short(oppTitle)} rubric`;
export const STARTER_STAGE = { key: "application", label: "Application" } as const;

export const STARTER_FORM: Omit<FormInput, "title" | "copyFrom"> = {
  description: "Starter application form made by quick setup. Edit it in the form builder before you open applications.",
  purpose: "application",
  jsonSchema: {
    type: "object",
    required: ["projectTitle", "summary", "requestedAmount", "useOfFunds", "outcomes", "budget", "contactName", "contactEmail"],
    properties: {
      projectTitle: { type: "string", title: "Project title", maxLength: 200 },
      summary: { type: "string", title: "Project summary", "x-wordCount": { max: 300 } },
      requestedAmount: { type: "object", title: "Amount requested" },
      useOfFunds: { type: "string", title: "How the funds will be used", "x-wordCount": { max: 300 } },
      outcomes: { type: "string", title: "Expected outcomes", "x-wordCount": { max: 300 } },
      budget: { type: "object", title: "Budget" },
      contactName: { type: "string", title: "Contact name", maxLength: 200 },
      contactEmail: { type: "string", format: "email", title: "Contact email" },
      contactPhone: { type: "string", title: "Contact phone" },
    },
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      {
        type: "Group",
        label: "Project",
        elements: [
          { type: "Control", scope: "#/properties/projectTitle" },
          { type: "Control", scope: "#/properties/summary", options: { help: "What the project is and who it serves." } },
          { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } },
          { type: "Control", scope: "#/properties/useOfFunds" },
          { type: "Control", scope: "#/properties/outcomes", options: { help: "What will change, and how you will know." } },
        ],
      },
      {
        type: "Group",
        label: "Budget",
        elements: [{ type: "Control", scope: "#/properties/budget", options: { widget: "fileRef", help: "Upload your project budget as a PDF or spreadsheet." } }],
      },
      {
        type: "Group",
        label: "Contact",
        elements: [
          { type: "Control", scope: "#/properties/contactName" },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/contactEmail", options: { pii: true } },
              { type: "Control", scope: "#/properties/contactPhone", options: { widget: "phone", pii: true } },
            ],
          },
        ],
      },
    ],
  },
  mappingFromCommonGrants: {},
  mappingToCommonGrants: { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } },
};

export const STARTER_RUBRIC: Omit<RubricInput, "name"> = {
  criteria: [
    { key: "alignment", label: "Alignment with the opportunity", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "feasibility", label: "Feasibility", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "budget", label: "Budget", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "impact", label: "Community impact", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
  ],
  overall: { recommendations: ["Fund", "Fund with conditions", "Do not fund"] },
};
