// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildPrefillSource, computeResponseStatus, deepMerge, mergeResponse, prefill } from "../src/index.ts";
import { form, org, profile, validResponse } from "./fixtures.ts";

describe("merge semantics", () => {
  it("merges objects, replaces arrays and scalars, removes on null", () => {
    const current = { a: { b: 1, c: 2 }, list: [1, 2, 3], gone: "x", keep: true };
    expect(deepMerge(current, { a: { c: 3, d: 4 }, list: [9], gone: null })).toEqual({ a: { b: 1, c: 3, d: 4 }, list: [9], keep: true });
    expect(current.list).toEqual([1, 2, 3]);
  });
  it("ignores prototype-polluting keys", () => {
    const out = deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}, "a": 1}'));
    expect(out).toEqual({ a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("reports what changed and stamps provenance with the actor", () => {
    const out = mergeResponse({ a: 1, g: { x: "old" } }, { a: 1, g: { x: "new", y: "added" }, z: null }, { actor: "agent:claude-desktop" });
    expect(out.changed).toEqual(["/g/x", "/g/y"]);
    expect(out.response).toEqual({ a: 1, g: { x: "new", y: "added" } });
    expect(out.provenance).toEqual({ "/g/x": "agent:claude-desktop", "/g/y": "agent:claude-desktop" });
  });
  it("a prefilled object edited in part becomes the editor's", () => {
    const out = mergeResponse({ addr: { city: "A", country: "US" } }, { addr: { city: "B" } }, { provenance: { "/addr": "passport" } });
    expect(out.provenance).toEqual({ "/addr": "user" });
  });
  it("replacing a whole object clears provenance beneath it", () => {
    const out = mergeResponse({ list: [{ n: 1 }] }, { list: [{ n: 2 }] }, { provenance: { "/list/0/n": "library" } });
    expect(out.provenance).toEqual({ "/list": "user" });
  });
});

describe("response status", () => {
  it("notStarted when empty", () => {
    expect(computeResponseStatus(form, {})).toBe("notStarted");
    expect(computeResponseStatus(form, null)).toBe("notStarted");
    expect(computeResponseStatus(form, { projectTitle: "", partners: [] })).toBe("notStarted");
  });
  it("still notStarted when only Passport prefill is present", () => {
    const p = prefill(form, buildPrefillSource(org, profile));
    expect(computeResponseStatus(form, p.response, p.provenance)).toBe("notStarted");
  });
  it("inProgress once the applicant has entered something", () => {
    const p = prefill(form, buildPrefillSource(org, profile));
    const m = mergeResponse(p.response, { projectTitle: "Mobile Health Navigation" }, { provenance: p.provenance });
    expect(computeResponseStatus(form, m.response, m.provenance)).toBe("inProgress");
    expect(computeResponseStatus(form, { projectTitle: "Mobile Health Navigation" })).toBe("inProgress");
  });
  it("complete when the response validates", () => {
    expect(computeResponseStatus(form, validResponse)).toBe("complete");
  });
});
