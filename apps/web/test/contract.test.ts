// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// One scenario, two backends. Every method of the `GmsApi` port runs against (a) the web HTTP client
// talking to the real API Worker in-process and (b) the in-browser mock, with the same assertions on
// the fields the screens read. A path, verb, body field or response shape that drifts on either side
// fails here.
import { beforeAll, describe, expect, it } from "vitest";
import type { GmsApi } from "../src/api/client.ts";
import { ApiError } from "../src/api/client.ts";
import type { Competition, FormRecord, Opportunity, Program, Rubric, Stage } from "../src/api/types.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi } from "./api-harness.ts";

interface Backend {
  /** Signed in as a funder admin of Riverbend. */
  api: GmsApi;
  /** No session: public pages only. */
  anonymous: GmsApi;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A bare UUID: workspaces, people, programs, rubrics, and every id on public and protocol routes. */
const UUID = new RegExp(`^${HEX}$`);
/** `/gms` routes prefix the ids of protocol-visible records. */
const prefixed = (prefix: string) => new RegExp(`^${prefix}_${HEX}$`);
const bare = (id: string) => id.replace(/^[a-z]{3}_/, "");

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h = await helpers.harness();
  // Passport, as the funder link check sees it: a token, then the funder's funding sources.
  h.passport.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname === "/oauth/token") {
      return Response.json({ access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read" });
    }
    if (method === "GET" && url.pathname === `/passport/funders/${helpers.ORG_RIVERBEND}/sources`) {
      return Response.json({
        status: 200,
        message: "Success",
        items: [{ id: "src_1", orgId: helpers.ORG_RIVERBEND, provider: "stripe", status: "verified", statusReason: null, bankName: "River City Credit Union", last4: "5520", canDebit: true, verifiedAt: "2027-01-12T00:00:00Z", createdAt: "2027-01-10T00:00:00Z" }],
        paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
      });
    }
    return Response.json({ status: 501, message: `No fixture for ${method} ${url.pathname}`, errors: [] }, { status: 501 });
  };
  return { api: httpApiFor(helpers, h, helpers.USER_ADMIN), anonymous: httpApiFor(helpers, h, null) };
}

async function mockBackend(): Promise<Backend> {
  const store = seedStore();
  return { api: createMockApi({ session: async () => demoSession(), store }), anonymous: createMockApi({ session: async () => null, store }) };
}

const LOI_SCHEMA = {
  type: "object" as const,
  properties: {
    legalName: { type: "string" as const, title: "Legal name" },
    summary: { type: "string" as const, title: "Summary of intent", maxLength: 2000 },
    requestedAmount: { type: "number" as const, title: "Requested amount", minimum: 0 },
  },
  required: ["legalName", "summary"],
};
const LOI_UI = {
  type: "VerticalLayout" as const,
  elements: [
    { type: "Control" as const, scope: "#/properties/legalName" },
    { type: "Control" as const, scope: "#/properties/summary" },
    { type: "Control" as const, scope: "#/properties/requestedAmount" },
  ],
};

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("GmsApi contract: %s", (_name, make) => {
  let api: GmsApi;
  let anonymous: GmsApi;
  let workspaceId: string;
  let program: Program;
  let rubric: Rubric;
  let form: FormRecord;
  let opportunity: Opportunity;
  let competition: Competition;
  const suffix = Math.random().toString(36).slice(2, 8);
  const slug = `contract-${suffix}`;

  beforeAll(async () => {
    ({ api, anonymous } = await make());
  });

  it("me() lists memberships with the handle the router uses", async () => {
    const me = await api.me();
    expect(me.userId).toMatch(UUID);
    expect(typeof me.email).toBe("string");
    expect(typeof me.mfaVerified).toBe("boolean");
    const riverbend = me.workspaces.find((w) => w.handle === "riverbend");
    expect(riverbend).toMatchObject({ kind: "funder", role: "admin", name: "Riverbend Community Foundation" });
    expect(riverbend!.id).toMatch(UUID);
    expect(typeof riverbend!.requiresMfa).toBe("boolean");
  });

  it("me() rejects with 401 when signed out", async () => {
    await expect(anonymous.me()).rejects.toMatchObject({ status: 401 });
  });

  it("workspace() opens a workspace by handle for the shells", async () => {
    const ws = await api.workspace("riverbend");
    workspaceId = ws.id;
    expect(ws).toMatchObject({ handle: "riverbend", kind: "funder", name: "Riverbend Community Foundation" });
    expect(ws.brand.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ws.brand.onAccent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ws.member.initials.length).toBeGreaterThan(0);
    expect(typeof ws.member.title).toBe("string");
    expect(typeof ws.sub).toBe("string");
    await expect(api.workspace("no-such-workspace")).rejects.toBeInstanceOf(ApiError);
  });

  it("workspaceRecord() and updateWorkspace() round-trip the brand", async () => {
    const before = await api.workspaceRecord(workspaceId);
    expect(before).toMatchObject({ id: workspaceId, kind: "funder", handle: "riverbend", displayName: "Riverbend Community Foundation" });
    expect(before.brand).toBeTypeOf("object");
    expect(before.settings).toBeTypeOf("object");

    const written = await api.updateWorkspace(workspaceId, { brand: { accent: "#145450", onAccent: "#FFFFFF" } });
    expect(written.workspace.brand).toMatchObject({ accent: "#145450", onAccent: "#FFFFFF" });
    expect(Array.isArray(written.warnings)).toBe(true);
    expect((await api.workspaceRecord(workspaceId)).brand.accent).toBe("#145450");

    // An accent that fails contrast is not refused: the write succeeds and says so.
    const low = await api.updateWorkspace(workspaceId, { brand: { accent: "#FFF8D6", onAccent: "#FFFFFF" } });
    expect(low.warnings.length).toBeGreaterThan(0);
    await api.updateWorkspace(workspaceId, { brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" } });
  });

  it("listMembers() and createInvitation()", async () => {
    const members = await api.listMembers(workspaceId);
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]!.userId).toMatch(UUID);
    expect(members.some((m) => m.role === "admin")).toBe(true);

    const invitation = await api.createInvitation(workspaceId, { email: `new.officer.${suffix}@riverbendcf.example`, role: "program_officer" });
    expect(invitation).toMatchObject({ email: `new.officer.${suffix}@riverbendcf.example`, role: "program_officer" });
    expect(invitation.expiresAt).toMatch(ISO);
    expect(invitation.acceptUrl).toContain("/");
  });

  it("passportStatus(), linkPassport() and unlinkPassport()", async () => {
    await api.unlinkPassport(workspaceId).catch(() => undefined);
    const before = await api.passportStatus(workspaceId);
    expect(before.linked).toBe(false);
    expect(["pass", "fail", "unknown"]).toContain(before.check.state);
    expect(typeof before.check.reason).toBe("string");

    const linked = await api.linkPassport(workspaceId, { clientId: "pc_riverbend_gms", clientSecret: "passport-client-secret-for-tests" });
    expect(linked).toMatchObject({ linked: true, clientId: "pc_riverbend_gms", check: { state: "pass" } });
    expect(linked.canDebit).toBe(true);
    expect(JSON.stringify(linked)).not.toContain("passport-client-secret-for-tests");

    expect(await api.unlinkPassport(workspaceId)).toMatchObject({ linked: false });
    expect((await api.passportStatus(workspaceId)).linked).toBe(false);
  });

  it("programs: create, list, update", async () => {
    program = await api.createProgram({ name: `Contract program ${suffix}`, description: "For the contract test", fiscalYear: 2027, budgetAmountMinor: 120_000_000, currency: "USD" });
    expect(program).toMatchObject({ name: `Contract program ${suffix}`, fiscalYear: 2027, budgetAmountMinor: 120_000_000, currency: "USD" });
    expect(program.id).toMatch(UUID);
    expect(program.createdAt).toMatch(ISO);
    expect(program.defaults).toBeTypeOf("object");

    expect((await api.listPrograms()).map((p) => p.id)).toContain(program.id);
    const updated = await api.updateProgram(program.id, { budgetAmountMinor: 150_000_000 });
    expect(updated.budgetAmountMinor).toBe(150_000_000);
    expect(updated.name).toBe(program.name);
  });

  it("rubrics: create and list", async () => {
    rubric = await api.createRubric({
      name: `Contract rubric ${suffix}`,
      criteria: [
        { key: "need", label: "Need", weight: 60, scale: { type: "numeric", min: 1, max: 5 } },
        { key: "feasibility", label: "Feasibility", weight: 40, scale: { type: "numeric", min: 1, max: 5 } },
      ],
    });
    expect(rubric).toMatchObject({ name: `Contract rubric ${suffix}`, version: 1 });
    expect(rubric.criteria).toHaveLength(2);
    expect(rubric.criteria[0]).toMatchObject({ key: "need", weight: 60, scale: { type: "numeric", min: 1, max: 5 } });
    expect((await api.listRubrics()).map((r) => r.id)).toContain(rubric.id);
  });

  it("forms: create, edit the draft, read, publish, next version, list, library, test-fill", async () => {
    const created = await api.createForm({ title: `Contract LOI ${suffix}`, purpose: "loi" });
    expect(created).toMatchObject({ title: `Contract LOI ${suffix}`, purpose: "loi", version: 1, status: "draft", publishedAt: null });
    expect(created.id).toMatch(prefixed("frm"));
    expect(created.jsonSchema).toMatchObject({ type: "object" });
    expect(created.uiSchema).toBeTypeOf("object");
    expect(created.fieldMeta).toBeTypeOf("object");

    const edited = await api.updateForm(created.id, {
      jsonSchema: LOI_SCHEMA,
      uiSchema: LOI_UI,
      mappingFromCommonGrants: { legalName: { field: "name" } },
      fieldMeta: { summary: { reviewerVisible: true } },
    });
    expect(Object.keys(edited.jsonSchema.properties ?? {})).toEqual(["legalName", "summary", "requestedAmount"]);
    expect(edited.mappingFromCommonGrants).toEqual({ legalName: { field: "name" } });

    // A definition the engine rejects comes back as a 422 with the problems listed.
    const bad = await api.updateForm(created.id, { jsonSchema: { type: "object", properties: { x: { type: "null" } } } as never }).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).status).toBe(422);
    expect((bad as ApiError).errors.length).toBeGreaterThan(0);

    expect((await api.getForm(created.id)).version).toBe(1);
    const published = await api.publishForm(created.id);
    expect(published).toMatchObject({ version: 1, status: "published" });
    expect(published.publishedAt).toMatch(ISO);

    // Published versions are immutable.
    await expect(api.updateForm(created.id, { title: "Changed after publishing" })).rejects.toMatchObject({ status: 409 });

    const draft2 = await api.createFormVersion(created.id);
    expect(draft2).toMatchObject({ version: 2, status: "draft", supersedesFormVersion: 1 });
    expect((await api.getForm(created.id)).version).toBe(2);
    expect((await api.getForm(created.id, 1)).status).toBe("published");

    const mine = await api.listForms();
    const row = mine.find((f) => f.id === created.id);
    expect(row).toBeDefined();
    expect(row).toHaveProperty("purpose", "loi");
    expect(row).toHaveProperty("updatedAt");
    expect(row).not.toHaveProperty("jsonSchema");

    const library = await api.listFormLibrary();
    expect(Array.isArray(library)).toBe(true);
    for (const f of library) expect(f.shared).toBe(true);

    const filled = await api.testFillForm(created.id, { version: 1, seed: 7 });
    expect(typeof filled.response.legalName).toBe("string");
    expect(typeof filled.response.summary).toBe("string");
    form = await api.getForm(created.id, 1);
  });

  it("opportunities: create, update with rules, read, list, preview, publish", async () => {
    const created = await api.createOpportunity({ title: `Contract Health Grants ${suffix}`, slug, programId: program.id, description: "Mobile health navigation for rural families." });
    expect(created).toMatchObject({ title: `Contract Health Grants ${suffix}`, slug, programId: program.id, published: false, publishedAt: null });
    expect(created.id).toMatch(prefixed("opp"));
    expect(created.eligibilityRules).toEqual({ all: [] });
    expect(created.funding).toBeTypeOf("object");
    expect(created.keyDates).toBeTypeOf("object");
    expect(created.publish).toBeTypeOf("object");

    const rules = {
      all: [
        { path: "profile.commonApp.irs.subsection", op: "in" as const, value: ["03"], missing: "unknown" as const, label: "Tax-exempt under 501(c)(3)" },
        { path: "org.addresses.primary.stateOrProvince", op: "in" as const, value: ["OR", "WA"], label: "Located in Oregon or Washington" },
      ],
    };
    const updated = await api.updateOpportunity(created.id, {
      funding: { totalAmountAvailable: { amount: "1200000.00", currency: "USD" }, minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" }, estimatedAwardCount: 10 },
      keyDates: { closeDate: { name: "Applications close", eventType: "singleDate", date: "2027-04-30" } },
      acceptedApplicantTypes: ["organization"],
      eligibilityRules: rules,
    });
    expect(updated.funding.maxAwardAmount).toEqual({ amount: "150000.00", currency: "USD" });
    expect(updated.keyDates.closeDate).toMatchObject({ eventType: "singleDate", date: "2027-04-30" });
    expect(updated.acceptedApplicantTypes).toEqual(["organization"]);
    expect(updated.eligibilityRules).toEqual(rules);

    // Rules that do not parse are refused with the problems listed.
    await expect(api.updateOpportunity(created.id, { eligibilityRules: { all: [{ path: "org.name", op: "nope" }] } as never })).rejects.toMatchObject({ status: 422 });

    expect((await api.getOpportunity(created.id)).title).toBe(created.title);
    expect((await api.listOpportunities()).map((o) => o.id)).toContain(created.id);
    expect((await api.listOpportunities({ programId: program.id })).map((o) => o.id)).toEqual([created.id]);

    const preview = await api.previewOpportunity(created.id);
    expect(preview.publicUrl).toContain(`/f/riverbend/o/${slug}`);
    expect(preview.commonGrants).toMatchObject({ title: created.title });
    expect(preview.brand).toBeTypeOf("object");

    // Publishing needs a description: the public page and the CommonGrants record both show one.
    const blank = await api.createOpportunity({ title: `Contract blank ${suffix}` });
    await expect(api.publishOpportunity(blank.id, "open")).rejects.toMatchObject({ status: 409 });

    opportunity = await api.publishOpportunity(created.id, "open");
    expect(opportunity).toMatchObject({ status: "open", published: true });
    expect(opportunity.publishedAt).toMatch(ISO);
    expect((await api.listOpportunities({ status: "open" })).map((o) => o.id)).toContain(created.id);
  });

  it("competitions: create, update, stages, launch check, open, close", async () => {
    const created = await api.createCompetition({ opportunityId: opportunity.id, title: `Contract cycle ${suffix}`, instructions: "Submit a letter of intent." });
    expect(created).toMatchObject({ opportunityId: opportunity.id, title: `Contract cycle ${suffix}`, status: "draft", instructions: "Submit a letter of intent." });
    expect(created.id).toMatch(prefixed("cmp"));
    expect(Array.isArray(created.stages)).toBe(true);
    expect(created.forms).toBeTypeOf("object");

    // Nothing is staged yet, so the checklist has failing lines and opening is refused.
    const notReady = await api.launchCheck(created.id);
    expect(notReady.ready).toBe(false);
    expect(notReady.summary.fail).toBeGreaterThan(0);
    for (const item of notReady.items) {
      expect(["pass", "fail", "unknown"]).toContain(item.state);
      expect(typeof item.key).toBe("string");
      expect(typeof item.label).toBe("string");
      expect(typeof item.reason).toBe("string");
      expect(item.fixHref === null || typeof item.fixHref === "string").toBe(true);
    }
    await expect(api.openCompetition(created.id)).rejects.toMatchObject({ status: 409 });

    const stages: Stage[] = [
      { key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T23:59:00Z", rubricId: rubric.id, entryFrom: [], requiresSubmission: true, decisionRequired: true },
    ];
    const staged = await api.putStages(created.id, stages);
    expect(staged.stages).toHaveLength(1);
    expect(staged.stages[0]).toMatchObject({ key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, rubricId: rubric.id, entryFrom: [], requiresSubmission: true, decisionRequired: true });
    expect(staged.forms).toEqual({ [form.id]: 1 });

    expect((await api.updateCompetition(created.id, { description: "LOI round" })).description).toBe("LOI round");
    expect((await api.getCompetition(created.id)).stages[0]!.key).toBe("loi");
    expect((await api.listCompetitions({ opportunityId: opportunity.id })).map((c) => c.id)).toEqual([created.id]);

    const ready = await api.launchCheck(created.id);
    expect(ready.items.filter((i) => i.state === "fail")).toEqual([]);
    expect(ready.ready).toBe(true);

    competition = await api.openCompetition(created.id);
    expect(competition.status).toBe("open");
  });

  it("public pages read published fields without a sign-in", async () => {
    const page = await anonymous.publicFunder("riverbend");
    expect(page.funder).toMatchObject({ handle: "riverbend", name: "Riverbend Community Foundation" });
    expect(page.funder.brand).toHaveProperty("accent");
    const card = page.opportunities.find((o) => o.slug === slug);
    // Public and protocol routes speak bare UUIDs.
    expect(card).toMatchObject({ id: bare(opportunity.id), title: opportunity.title, status: "open", acceptedApplicantTypes: ["organization"] });
    expect(card!.funding.maxAwardAmount).toEqual({ amount: "150000.00", currency: "USD" });
    expect(card!.keyDates.closeDate).toMatchObject({ date: "2027-04-30" });
    expect(card).not.toHaveProperty("eligibilityRules");

    const detail = await anonymous.publicOpportunity("riverbend", slug);
    expect(detail.funder.handle).toBe("riverbend");
    expect(detail.opportunity).toMatchObject({ slug, title: opportunity.title });
    expect(detail.opportunity.eligibility).toEqual(["Tax-exempt under 501(c)(3)", "Located in Oregon or Washington"]);
    expect(detail.competitions).toHaveLength(1);
    expect(detail.competitions[0]).toMatchObject({ id: bare(competition.id), status: "open" });
    expect(detail.competitions[0]!.stages[0]).toMatchObject({ key: "loi", label: "Letter of intent", requiresSubmission: true });
    expect(detail.competitions[0]!.stages[0]).not.toHaveProperty("rubricId");
    expect(detail.commonGrants).toMatchObject({ title: opportunity.title });
    expect(detail.links.json).toMatch(new RegExp(`/common-grants/opportunities/${bare(opportunity.id)}$`));
    expect(detail.links.page).toMatch(new RegExp(`/f/riverbend/o/${slug}$`));

    const cg = await anonymous.publicCompetition(detail.competitions[0]!.id);
    expect(cg).toMatchObject({ id: bare(competition.id), title: competition.title });
    const pinned = cg.forms.forms[bare(form.id)];
    expect(pinned).toMatchObject({ title: form.title });
    expect(pinned!.jsonSchema).toMatchObject({ type: "object" });
    expect(pinned!.uiSchema).toBeTypeOf("object");

    await expect(anonymous.publicFunder("no-such-funder")).rejects.toMatchObject({ status: 404 });
    await expect(anonymous.publicOpportunity("riverbend", "no-such-opportunity")).rejects.toMatchObject({ status: 404 });
  });

  it("evaluateEligibility() dry-runs rules, by value and by opportunity", async () => {
    // Facts in the shapes Passport serves: CommonGrants `OrganizationBase` and the Common App profile.
    const org = { addresses: { primary: { stateOrProvince: "OR" } } };
    const profile = { commonApp: { irs: { subsection: "03" } } };
    const pass = await api.evaluateEligibility({ opportunityId: opportunity.id, org, profile });
    expect(pass.eligible).toBe(true);
    expect(pass.results).toHaveLength(2);
    expect(pass.results[0]).toHaveProperty("outcome");
    expect(typeof pass.results[0]!.explain).toBe("string");

    const fail = await api.evaluateEligibility({ opportunityId: opportunity.id, org: { ...org, addresses: { primary: { stateOrProvince: "TX" } } }, profile });
    expect(fail.eligible).toBe(false);

    // An organization that has not shared its tax status is unknown, not ineligible.
    const unshared = await api.evaluateEligibility({ opportunityId: opportunity.id, org, profile: {} });
    expect(unshared.eligible).toBe("unknown");

    // A fact Passport has not supplied is unknown, never a decline.
    const unknown = await api.evaluateEligibility({ rules: { all: [{ path: "profile.commonApp.financials.budget", op: "lt", value: 5_000_000 }] }, org, profile: {} });
    expect(unknown.eligible).toBe("unknown");
  });

  it("closing: competition, then opportunity", async () => {
    expect((await api.closeCompetition(competition.id)).status).toBe("closed");
    expect((await api.closeOpportunity(opportunity.id)).status).toBe("closed");
  });

  it("createWorkspace() starts a funder workspace and makes its creator the admin", async () => {
    const handle = `contract-funder-${suffix}`;
    const written = await api.createWorkspace({ kind: "funder", handle, displayName: "Contract Test Fund", brand: { accent: "#145450", onAccent: "#FFFFFF" } });
    expect(written.workspace).toMatchObject({ kind: "funder", handle, displayName: "Contract Test Fund" });
    expect(written.workspace.id).toMatch(UUID);
    expect(Array.isArray(written.warnings)).toBe(true);
    const me = await api.me();
    expect(me.workspaces.find((w) => w.handle === handle)).toMatchObject({ kind: "funder", role: "admin", name: "Contract Test Fund" });
    // A handle is unique.
    await expect(api.createWorkspace({ kind: "funder", handle, displayName: "Duplicate" })).rejects.toMatchObject({ status: 409 });
  });
});
