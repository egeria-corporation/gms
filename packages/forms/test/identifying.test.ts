// SPDX-License-Identifier: AGPL-3.0-only
// The per-field "identifying" flag (anonymized review): which fields say who applied.
import { describe, expect, it } from "vitest";
import { IDENTIFYING_WIDGETS, identifyingFields, validateUiSchema, type FormSchema, type UiElement } from "../src/index.ts";

const jsonSchema: FormSchema = {
  type: "object",
  properties: {
    orgName: { type: "string", "x-widget": "passportField" },
    projectTitle: { type: "string" },
    founderStory: { type: "string" },
    contactEmail: { type: "string", format: "email" },
    mailing: { type: "object", properties: { street: { type: "string" } } },
    phone: { type: "string" },
    need: { type: "string" },
    signoff: { type: "object", properties: { name: { type: "string" } } },
  },
};
const uiSchema: UiElement = {
  type: "VerticalLayout",
  elements: [
    { type: "Control", scope: "#/properties/orgName" },
    { type: "Control", scope: "#/properties/projectTitle" },
    { type: "Control", scope: "#/properties/founderStory", options: { identifying: true } },
    { type: "Control", scope: "#/properties/contactEmail" },
    { type: "Control", scope: "#/properties/mailing", options: { widget: "address" } },
    { type: "Control", scope: "#/properties/phone", options: { widget: "phone" } },
    { type: "Control", scope: "#/properties/need" },
    { type: "Control", scope: "#/properties/signoff", options: { widget: "signature" } },
  ],
};

describe("identifying fields", () => {
  it("lists flagged controls, identity-bearing widgets and email fields", () => {
    expect(identifyingFields({ jsonSchema, uiSchema })).toEqual(["/contactEmail", "/founderStory", "/mailing", "/orgName", "/phone", "/signoff"]);
  });

  it("adds fields flagged in fieldMeta, and a false there does not unmark an identity-bearing widget", () => {
    const out = identifyingFields({ jsonSchema, uiSchema, fieldMeta: { "/need": { identifying: true }, "/orgName": { identifying: false } } });
    expect(out).toContain("/need");
    expect(out).toContain("/orgName");
    expect(out).not.toContain("/projectTitle");
  });

  it("names the widgets that always carry identity", () => {
    expect([...IDENTIFYING_WIDGETS].sort()).toEqual(["address", "passportField", "phone", "signature"]);
  });

  it("accepts identifying as a boolean control option and refuses anything else", () => {
    expect(validateUiSchema(uiSchema, jsonSchema)).toEqual([]);
    const bad = { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/need", options: { identifying: "yes" } }] };
    expect(validateUiSchema(bad, jsonSchema)).toEqual([{ path: "#/elements/0/options/identifying", message: "must be true or false" }]);
  });
});
