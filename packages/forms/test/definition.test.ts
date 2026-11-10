// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { checkSchemaSubset, evaluateUi, scopeToPointer, validateFormDefinition, validateUiSchema, type FormSchema, type UiElement } from "../src/index.ts";
import { form } from "./fixtures.ts";

describe("schema subset", () => {
  it("accepts the fixture form", () => {
    expect(checkSchemaSubset(form.jsonSchema)).toEqual([]);
    expect(validateFormDefinition(form)).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["oneOf", { type: "object", properties: { a: { type: "string", oneOf: [{ const: "x" }] } } }, "#/properties/a/oneOf"],
    ["patternProperties", { type: "object", patternProperties: {} }, "#/patternProperties"],
    ["null type", { type: "object", properties: { a: { type: "null" } } }, "#/properties/a/type"],
    ["type arrays", { type: "object", properties: { a: { type: ["string", "null"] } } }, "#/properties/a/type"],
    ["arrays of numbers", { type: "object", properties: { a: { type: "array", items: { type: "number" } } } }, "#/properties/a/items"],
    ["arrays of free strings", { type: "object", properties: { a: { type: "array", items: { type: "string" } } } }, "#/properties/a/items"],
    ["external $ref", { type: "object", properties: { a: { $ref: "https://example.org/x.json" } } }, "#/properties/a/$ref"],
    ["dangling $ref", { type: "object", properties: { a: { $ref: "#/$defs/missing" } } }, "#/properties/a/$ref"],
    ["unknown format", { type: "object", properties: { a: { type: "string", format: "ipv4" } } }, "#/properties/a/format"],
    ["keyword on the wrong type", { type: "object", properties: { a: { type: "number", minLength: 2 } } }, "#/properties/a/minLength"],
    ["exclusiveMinimum", { type: "object", properties: { a: { type: "number", exclusiveMinimum: 0 } } }, "#/properties/a/exclusiveMinimum"],
    ["schema-valued additionalProperties", { type: "object", additionalProperties: { type: "string" } }, "#/additionalProperties"],
    ["bad pattern", { type: "object", properties: { a: { type: "string", pattern: "(" } } }, "#/properties/a/pattern"],
    ["unknown widget", { type: "object", properties: { a: { type: "string", "x-widget": "slider" } } }, "#/properties/a/x-widget"],
    ["undeclared required", { type: "object", properties: {}, required: ["ghost"] }, "#/required"],
    ["untyped property", { type: "object", properties: { a: {} } }, "#/properties/a"],
    ["non-object root", { type: "string" }, "#/type"],
  ])("rejects %s with a path", (_name, schema, path) => {
    expect(checkSchemaSubset(schema).map((e) => e.path)).toContain(path);
  });

  it("stops validateFormDefinition at schema errors and prefixes paths", () => {
    const errors = validateFormDefinition({ ...form, jsonSchema: { type: "object", properties: { a: { type: "string", format: "ipv4" } } } });
    expect(errors).toEqual([expect.objectContaining({ path: "jsonSchema/properties/a/format" })]);
  });
});

describe("UI schema", () => {
  const schema: FormSchema = { type: "object", properties: { a: { type: "string" }, b: { type: "boolean" }, g: { type: "object", properties: { c: { type: "string" } } } } };

  it("maps scopes to response pointers", () => {
    expect(scopeToPointer("#/properties/g/properties/c")).toBe("/g/c");
    expect(scopeToPointer("#")).toBe("");
  });

  it("accepts the fixture UI schema", () => {
    expect(validateUiSchema(form.uiSchema, form.jsonSchema)).toEqual([]);
  });

  it("reports unknown scopes, widgets, element types, duplicate controls and stray categories", () => {
    const ui = {
      type: "VerticalLayout",
      elements: [
        { type: "Control", scope: "#/properties/missing" },
        { type: "Control", scope: "#/properties/a", options: { widget: "slider", pii: "yes" } },
        { type: "Control", scope: "#/properties/a" },
        { type: "Tabs", elements: [] },
        { type: "Category", label: "Loose", elements: [] },
        { type: "Group", elements: [] },
        { type: "Control", scope: "#/properties/b", rule: { effect: "BLINK", condition: { scope: "#/properties/nope", schema: {} } } },
      ],
    };
    const paths = validateUiSchema(ui, schema).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "#/elements/0/scope",
        "#/elements/1/options/widget",
        "#/elements/1/options/pii",
        "#/elements/2/scope",
        "#/elements/3/type",
        "#/elements/4",
        "#/elements/5/label",
        "#/elements/6/rule/effect",
        "#/elements/6/rule/condition/scope",
      ]),
    );
  });

  const rule = (effect: "SHOW" | "HIDE" | "ENABLE" | "DISABLE") => ({ effect, condition: { scope: "#/properties/b", schema: { const: true } } });
  const ui = (effect: "SHOW" | "HIDE" | "ENABLE" | "DISABLE"): UiElement => ({
    type: "VerticalLayout",
    elements: [
      { type: "Control", scope: "#/properties/b" },
      { type: "Control", scope: "#/properties/a", rule: rule(effect) },
    ],
  });

  it.each([
    ["SHOW", true, { hidden: [], disabled: [] }],
    ["SHOW", false, { hidden: ["/a"], disabled: [] }],
    ["HIDE", true, { hidden: ["/a"], disabled: [] }],
    ["HIDE", false, { hidden: [], disabled: [] }],
    ["ENABLE", true, { hidden: [], disabled: [] }],
    ["ENABLE", false, { hidden: [], disabled: ["/a"] }],
    ["DISABLE", true, { hidden: [], disabled: ["/a"] }],
    ["DISABLE", false, { hidden: [], disabled: [] }],
  ] as const)("%s with condition %s", (effect, b, expected) => {
    const state = evaluateUi(ui(effect), { b });
    expect({ hidden: state.hidden, disabled: state.disabled }).toEqual(expected);
  });

  it("treats an unanswered condition field as not matching", () => {
    expect(evaluateUi(ui("SHOW"), {}).hidden).toEqual(["/a"]);
    expect(evaluateUi(ui("HIDE"), {}).hidden).toEqual([]);
  });

  it("cascades a layout rule to the controls inside it", () => {
    const grouped: UiElement = {
      type: "VerticalLayout",
      elements: [
        { type: "Control", scope: "#/properties/b" },
        { type: "Group", label: "Details", rule: rule("SHOW"), elements: [{ type: "Control", scope: "#/properties/a" }, { type: "Control", scope: "#/properties/g/properties/c" }] },
      ],
    };
    expect(evaluateUi(grouped, { b: false }).hidden).toEqual(["/a", "/g/c"]);
    expect(evaluateUi(grouped, { b: true }).controls.every((c) => c.visible && c.enabled)).toBe(true);
  });
});
