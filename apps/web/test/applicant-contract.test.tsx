// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// One scenario, two backends, for the applicant port: (a) the web HTTP client against the real API
// Worker in-process, with an applicant already linked to Passport and a funder's open competition,
// and (b) the in-browser mock. The same assertions run on both, on the fields the screens read.
import { passportFieldPaths, testFill, type JsonObject } from "@gms/forms";
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpApplicantApi, type ApplicantApi } from "../src/api/applicant.ts";
import { ApiError } from "../src/api/client.ts";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  api: ApplicantApi;
  /** A competition the applicant has not started yet. */
  competitionId: string;
  /** True when OpenGrants answers on this backend. */
  openGrants: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`^${HEX}$`);
const APP_ID = new RegExp(`^app_${HEX}$`);

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h: ApiHarness = await helpers.harness();
  const scn = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as {
    scenario(h: ApiHarness): Promise<{ uuid: { comp: string } }>;
    USER_APPLICANT: string;
  };
  const s = await scn.scenario(h);
  const ws = (helpers as unknown as { WS_APPLICANT: string }).WS_APPLICANT;
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const api = createHttpApplicantApi({ baseUrl: helpers.BASE, token: () => h.session(scn.USER_APPLICANT, { aal: "aal2" }), workspaceId: () => ws, fetch: fetchInProcess });
  return { api, competitionId: s.uuid.comp, openGrants: true };
}

async function mockBackend(): Promise<Backend> {
  const api = createMockApplicantApi({ session: async () => demoSession(), store: seedApplicantStore() });
  return { api, competitionId: APPLICANT_IDS.compHousing, openGrants: true };
}

describe.each([
  ["real API", realBackend],
  ["mock", mockBackend],
])("applicant port against the %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("reads the Passport record and readiness", async () => {
    const org = await b.api.organization();
    expect(org.linked === true || org.passportOrgId !== null).toBe(true);
    expect(org.displayName).toBe("Alder Creek Family Services");
    expect(org.level).toBe("L3");
    expect(org.organization?.name).toBe("Alder Creek Family Services");
    expect(org.profile).toBeTruthy();

    const r = await b.api.readiness();
    expect(r.level).toBe("L3");
    expect(r.checks.length).toBeGreaterThan(2);
    for (const c of r.checks) {
      expect(["pass", "fail", "unknown"]).toContain(c.state);
      expect(c.label).toBeTruthy();
      expect(c.reason).toBeTruthy();
    }
    expect(r.summary.pass + r.summary.fail + r.summary.unknown).toBe(r.checks.length);
  });

  it("lists open competitions with this organization's eligibility", async () => {
    const list = await b.api.discover();
    const c = list.find((x) => x.competitionId === b.competitionId);
    expect(c).toBeDefined();
    expect(c!.opportunity.title).toBeTruthy();
    expect(c!.funder.name).toBeTruthy();
    expect(c!.funder.handle).toBeTruthy();
    // An open competition is taking applications and carries this organization's eligibility.
    expect(c!.acceptingApplications).toBe(true);
    expect(c!.eligibility).not.toBeNull();
    expect([true, false, "unknown"]).toContain(c!.eligibility!.eligible);
    expect(Array.isArray(c!.eligibility!.results)).toBe(true);
    expect(c!.application).toBeNull();
    expect(c!.stage?.label).toBeTruthy();
  });

  let appId = "";
  let formId = "";
  let version = 0;

  it("starts an application with Passport prefill and an eligibility preview", async () => {
    const app = await b.api.startApplication(b.competitionId);
    expect(app.id).toMatch(APP_ID);
    expect(app.uuid).toMatch(UUID);
    expect(app.status).toBe("draft");
    expect(app.stage).toBeTruthy();
    expect(app.eligibility).not.toBeNull();
    expect(app.forms.length).toBeGreaterThan(0);
    const f = app.forms[0]!;
    expect(f.formId).toMatch(UUID);
    expect(f.version).toBeGreaterThan(0);
    // Something arrived from the Passport record, and says so.
    expect(Object.values(f.provenance)).toContain("passport");
    appId = app.id;
    formId = f.formId;
    version = f.version;

    // Starting again returns the same application.
    expect((await b.api.startApplication(b.competitionId)).id).toBe(appId);
    expect((await b.api.application(appId)).id).toBe(appId);
    const mine = await b.api.applications();
    const row = mine.find((m) => m.id === appId)!;
    expect(row.status).toBe("draft");
    expect(row.stage.label).toBeTruthy();
    expect(row.funder.name).toBeTruthy();
    expect(row.forms.total).toBeGreaterThan(0);
  });

  it("serves the pinned form and merges saves by field", async () => {
    const form = await b.api.form(formId, version);
    expect(form.jsonSchema.type).toBe("object");
    expect(form.uiSchema.type).toBeTruthy();
    const keys = Object.keys(form.jsonSchema.properties ?? {});
    expect(keys.length).toBeGreaterThan(1);

    const locked = passportFieldPaths(form);
    const filled = testFill(form, { seed: 7 });
    const editable = Object.fromEntries(Object.entries(filled).filter(([k]) => !locked.includes(`/${k}`))) as JsonObject;
    const [first, ...rest] = Object.keys(editable);
    // Two saves that touch different fields: both survive.
    const one = await b.api.saveForm(appId, formId, { [first!]: editable[first!]! });
    expect(one.response[first!]).toEqual(editable[first!]);
    const restPatch = Object.fromEntries(rest.map((k) => [k, editable[k]!])) as JsonObject;
    const two = await b.api.saveForm(appId, formId, restPatch);
    expect(two.response[first!]).toEqual(editable[first!]);
    for (const k of rest) expect(two.response[k]).toEqual(editable[k]);
    expect(two.provenance[`/${first!}`]).toBe("user");
    expect(Array.isArray(two.validationErrors)).toBe(true);

    // A Passport-owned field cannot be overwritten here; the server says which write it ignored.
    if (locked.length) {
      const key = locked[0]!.slice(1);
      const before = two.response[key];
      const tried = await b.api.saveForm(appId, formId, { [key]: "Somebody Else Inc." });
      expect(tried.rejected).toContain(locked[0]);
      expect(tried.response[key]).toEqual(before);
    }
  });

  it("keeps comments, section owners and attachments with the application", async () => {
    const c = await b.api.addComment(appId, { body: "Cite the county assessment here.", formId: `frm_${formId}`, fieldPath: "/need" });
    expect(c.body).toBe("Cite the county assessment here.");
    expect(c.fieldPath).toBe("/need");
    expect(c.resolvedAt).toBeNull();
    expect((await b.api.comments(appId)).some((x) => x.id === c.id)).toBe(true);
    expect((await b.api.resolveComment(appId, c.id)).resolvedAt).toMatch(ISO);

    const members = await b.api.members();
    expect(members.length).toBeGreaterThan(0);
    const owner = members[0]!.userId;
    const assigned = await b.api.assignSections(appId, `frm_${formId}`, { Budget: owner });
    expect(assigned.sections.Budget).toBe(owner);

    const doc = await b.api.attach(appId, { name: "letter.pdf", mime: "application/pdf", contentBase64: btoa("%PDF-1.4 test") });
    expect(doc.name).toBe("letter.pdf");
    expect(doc.source).toBe("upload");
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await b.api.attachments(appId)).some((d) => d.id === doc.id)).toBe(true);
  });

  it("refuses to submit an incomplete application, then submits a complete one", async () => {
    const form = await b.api.form(formId, version);
    const required = (form.jsonSchema.required ?? []).filter((k) => !passportFieldPaths(form).includes(`/${k}`));
    if (required.length) {
      await b.api.saveForm(appId, formId, { [required[0]!]: null });
      const refused = await b.api.submit(appId).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ApiError);
      expect((refused as ApiError).status).toBe(422);
      const problems = ((refused as ApiError).errors as { field?: string; detail?: string }[]).filter((e) => e.field);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems[0]!.field).toContain(formId);
      expect(problems[0]!.detail).toBeTruthy();
      const filled = testFill(form, { seed: 7 });
      await b.api.saveForm(appId, formId, { [required[0]!]: filled[required[0]!]! });
    }
    const submitted = await b.api.submit(appId);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).toMatch(ISO);
    expect(submitted.verificationLevel).toBe("L3");
    expect(submitted.forms.find((f) => f.formId === formId)!.lockedAt).toMatch(ISO);

    const locked = await b.api.saveForm(appId, formId, { anything: "late edit" }).catch((e: unknown) => e);
    expect(locked).toBeInstanceOf(ApiError);
    expect((locked as ApiError).status).toBe(409);

    const status = await b.api.applicationStatus(appId);
    expect(status.status).toBe("submitted");
    expect(status.stages.some((s) => s.state === "current")).toBe(true);
    expect(status.timeline.some((e) => e.toStatus === "submitted")).toBe(true);

    // Applying is the consent that lets this funder read the record.
    const consents = await b.api.consents();
    expect(consents.some((c) => c.basis === "application" && !c.revokedAt && c.funder.name)).toBe(true);
    const funders = await b.api.funders();
    expect(funders.some((f) => f.applications > 0 && f.name && f.handle)).toBe(true);
  });

  it("carries the shared thread with the funder", async () => {
    const t = await b.api.openThread(appId);
    expect(t.visibility).toBe("shared");
    const m = await b.api.postMessage(t.id, "Thank you. When should we expect a decision?");
    expect(m.body).toContain("decision");
    expect(m.createdAt).toMatch(ISO);
    const again = (await b.api.threads(appId)).find((x) => x.id === t.id)!;
    expect(again.messages.some((x) => x.id === m.id)).toBe(true);
  });

  it("keeps an answer library with versions", async () => {
    const a = await b.api.createAnswer({ title: "Theory of change", body: "Navigation reduces missed appointments." });
    expect(a.version).toBe(1);
    expect(a.words).toBe(4);
    const edited = await b.api.updateAnswer(a.id, { body: "Navigation reduces missed appointments and late referrals." });
    expect(edited.version).toBe(2);
    // A new version replaces the old one in the list, under the same key.
    expect(edited.key).toBe(a.key);
    const listed = (await b.api.answers()).filter((x) => x.key === a.key);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(edited.id);
    expect(listed[0]!.version).toBe(2);
  });

  it("saves listings and reads OpenGrants results", async () => {
    const saved = await b.api.save({ source: "opengrants", externalId: "og_test_1", title: "Rural Health Network Planning", url: "https://opengrants.io/grants/rural-health" });
    expect(saved.title).toBe("Rural Health Network Planning");
    expect((await b.api.saved()).some((s) => s.id === saved.id)).toBe(true);
    if (b.openGrants) {
      const r = await b.api.openGrants("search", { query: "health" });
      expect(Array.isArray(r.results)).toBe(true);
      for (const l of r.results) {
        expect(l.title).toBeTruthy();
        expect("gms" in l).toBe(true);
      }
    }
  });

  it("lists tasks, awards and approvals for the workspace", async () => {
    expect(Array.isArray(await b.api.tasks())).toBe(true);
    const awards = await b.api.awards();
    expect(Array.isArray(awards)).toBe(true);
    for (const w of awards) {
      expect(w.id).toMatch(/^awd_/);
      expect(w.funder.name).toBeTruthy();
    }
    expect(Array.isArray(await b.api.approvals())).toBe(true);
  });
});
