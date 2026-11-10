// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { FormDefinitionError, assertEditable, clone, migrateResponses, nextDraft, pruneToSchema, publishForm, type FormDefinition } from "../src/index.ts";
import { form, validResponse } from "./fixtures.ts";

describe("versioning", () => {
  const published = publishForm(form, new Date("2027-01-15T12:00:00Z"));

  it("publishing stamps the version and leaves the draft object alone", () => {
    expect(published.publishedAt).toBe("2027-01-15T12:00:00.000Z");
    expect(form.publishedAt).toBeUndefined();
  });

  it("a published version is immutable", () => {
    expect(() => assertEditable(published)).toThrow(/immutable/);
    expect(() => publishForm(published)).toThrow(FormDefinitionError);
    expect(() => assertEditable(form)).not.toThrow();
  });

  it("refuses to publish an invalid definition and says why", () => {
    const bad: FormDefinition = { ...clone(form), uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/ghost" }] } };
    try {
      publishForm(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FormDefinitionError);
      expect((e as FormDefinitionError).errors.map((x) => x.path)).toContain("uiSchema/elements/0/scope");
    }
  });

  it("editing a published version starts a draft of the next one", () => {
    const draft = nextDraft(published);
    expect(draft).toMatchObject({ id: "frm_full", version: 2, publishedAt: null, supersedesFormVersion: 1 });
    expect(() => assertEditable(draft)).not.toThrow();
    expect(() => nextDraft(form)).toThrow(/still a draft/);
    draft.jsonSchema.properties = {};
    expect(Object.keys(published.jsonSchema.properties ?? {}).length).toBeGreaterThan(0);
  });

  it("migration re-validates in-progress responses against the new version", () => {
    const v2 = nextDraft(published);
    const props = v2.jsonSchema.properties ?? {};
    delete props.website;
    props.outcomes = { type: "string", minLength: 10 };
    props.projectTitle = { type: "string", minLength: 5, maxLength: 20 };
    v2.jsonSchema.required = [...(v2.jsonSchema.required ?? []), "outcomes"];
    const walk = (el: FormDefinition["uiSchema"]): void => {
      if (el.type === "Control") return;
      el.elements = el.elements.filter((c) => !(c.type === "Control" && c.scope === "#/properties/website"));
      el.elements.forEach(walk);
    };
    walk(v2.uiSchema);
    delete (v2.mappingFromCommonGrants as Record<string, unknown>).website;
    const target = publishForm(v2);

    const results = migrateResponses(target, [
      { id: "resp_complete", response: { ...validResponse, website: "https://aldercreek.example" } },
      { id: "resp_fixed", response: { ...validResponse, projectTitle: "Mobile Health", outcomes: "Fewer missed appointments" } },
      { id: "resp_empty", response: {} },
    ]);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId.resp_complete).toMatchObject({ formVersion: 2, status: "inProgress", dropped: ["/website"] });
    expect(byId.resp_complete?.response.website).toBeUndefined();
    expect(byId.resp_complete?.validationErrors.map((e) => `${e.field}:${e.type}`).sort()).toEqual(["/outcomes:required", "/projectTitle:maxLength"]);
    expect(byId.resp_fixed).toMatchObject({ status: "complete", validationErrors: [], dropped: [] });
    expect(byId.resp_empty?.status).toBe("notStarted");
  });

  it("pruning keeps widget objects whole and descends into declared objects", () => {
    const schema = { type: "object" as const, properties: { g: { type: "object" as const, properties: { a: { type: "string" as const } } }, addr: { type: "object" as const } } };
    expect(pruneToSchema(schema, { g: { a: "x", b: "y" }, addr: { line1: "1" }, old: 1 })).toEqual({
      response: { g: { a: "x" }, addr: { line1: "1" } },
      dropped: ["/g/b", "/old"],
    });
  });
});
