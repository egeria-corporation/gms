// SPDX-License-Identifier: AGPL-3.0-only
// Launch preparation: the facilitated-payments switch, the signer check against Passport's verified
// representatives, and the data behind the screens that were partial (budget categories, program
// owners and outcomes, sessions, member activity, contacts, signature addresses, interviews).
import { encryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { reconcileStuckReleases } from "../src/jobs.ts";
import { displayNameOf } from "../src/routes/gms.ts";
import type { BaseContext } from "../src/services/context.ts";
import { normalizeName } from "../src/services/organization.ts";
import { describeDevice } from "../src/services/sessions.ts";
import { BASE, PASSPORT, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

const FINANCE = "70000000-0000-4000-8000-000000000001";
const SESSION_A = "5e550000-0000-4000-8000-00000000000a";
const SESSION_B = "5e550000-0000-4000-8000-00000000000b";
const SESSION_OTHER = "5e550000-0000-4000-8000-00000000000c";

let h: Harness;
let s: Scenario;
let admin: Record<string, string>;
let finance: Record<string, string>;
let programId: string;
let appId: string; // app_<uuid>
let awardId: string; // awd_<uuid>
let agreementId: string;
let documentSha256: string;
let reportFormId: string;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" || method === "DELETE" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const fail = async (who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<{ errors: { code: string }[] }>(who, method, path, method === "GET" || method === "DELETE" ? undefined : (body ?? {}));
  return { status: r.status, code: r.body?.errors?.[0]?.code };
};
const ledger = (type: string) => h.ledger.events.filter((e) => e.eventType === type);

const CONSENT_TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-consented-token-for-tests", refresh_token: "rt-next", token_type: "Bearer", expires_in: 600, scope: "org:read" } };
const REPS_PATH = `/passport/orgs/${ORG_ALDER}/verified-representatives`;
const rep = (id: string, fullName: string, title: string, level: "L2" | "L3") => ({ id, fullName, title, role: level === "L3" ? "control_officer" : "second_representative", isControlOfficer: level === "L3", matchedTo: null, verificationLevel: level, verifiedAt: "2027-01-12T17:00:00Z", identityVerifiedAt: level === "L3" ? "2027-01-12T17:00:00Z" : null });
const REPS = (items: unknown[], status = 200): Fixture => ({ method: "GET", path: REPS_PATH, status, body: status === 200 ? { status: 200, message: "Success", items, paginationInfo: { page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 } } : { status, message: "Forbidden", errors: [{ code: "insufficient_scope" }] } });
const TWO_REPS = [rep("rep_maria", "María  Santos-López", "Executive Director", "L3"), rep("rep_jamal", "Jamal Reed", "Board Treasurer", "L2")];

async function linkApplicant() {
  await h.repos.table("passport_links").insert({ workspace_id: WS_APPLICANT, mode: "applicant_consent", client_id: "gms-test-client", refresh_token_enc: await encryptSecret("rt-first", TEST_CREDENTIALS_KEY), scopes: ["org:read"], linked_by_user_id: USER_APPLICANT, linked_at: "2027-02-03T00:00:00Z", last_ok_at: "2027-02-03T00:00:00Z" });
}
const passport = (...fixtures: Fixture[]) => {
  h.passport.fetch = fixtureFetch([CONSENT_TOKEN, ...fixtures]).fetch;
};

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: FINANCE, role: "finance" });
  finance = await headers(FINANCE, WS_FUNDER);

  // A report form with two outcome metrics: one flagged in fieldMeta, one on the control.
  const form = await data<{ id: string }>(s.funder, "POST", "/gms/forms", {
    title: "Interim report",
    purpose: "report",
    jsonSchema: { type: "object", properties: { progress: { type: "string", minLength: 5 }, peopleServed: { type: "number" }, clinicsHeld: { type: "number" }, staffCount: { type: "number" } }, required: ["progress"] },
    uiSchema: {
      type: "VerticalLayout",
      elements: [
        { type: "Control", scope: "#/properties/progress" },
        { type: "Control", scope: "#/properties/peopleServed", label: "People served" },
        { type: "Control", scope: "#/properties/clinicsHeld", label: "Clinics held", options: { outcome: true, unit: "clinics" } },
        { type: "Control", scope: "#/properties/staffCount" },
      ],
    },
    fieldMeta: { "/peopleServed": { outcome: true, unit: "people" } },
  });
  await data(s.funder, "POST", `/gms/forms/${form.id}/publish`);
  reportFormId = form.id;
  const program = await data<{ id: string }>(s.funder, "POST", "/gms/programs", {
    name: "Community Health 2027",
    budgetAmountMinor: 120_000_000,
    defaults: {
      awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" },
      schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }],
      requirements: [{ key: "interim", type: "report", title: "Interim report", formId: form.id.slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }],
    },
  });
  programId = program.id;
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });

  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const app = started.body.data.id;
  appId = `app_${app}`;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`)).status).toBe(200);
});

/** Decide and send the agreement: the award is offered and waiting for the grantee. */
async function offer() {
  const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: appId, outcome: "approve", amountMinor: 15_000_000 }] });
  const res = await data<{ results: { awardId: string; agreementId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
  awardId = res.results[0]!.awardId;
  agreementId = res.results[0]!.agreementId;
  documentSha256 = (await data<{ documentSha256: string }>(s.funder, "POST", `/gms/agreements/${agreementId}/send`)).documentSha256;
}
/** Through to an active award, signed under the admin-role rule (no Passport consent on file). */
async function activate() {
  await offer();
  await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
  await data(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256 });
  await data(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });
}

describe("launching without facilitated payments", () => {
  let t1: string;
  beforeEach(async () => {
    await activate();
    t1 = `trn_${(await h.repos.table("tranches").find({ award_id: awardId.slice(4) }, { orderBy: "seq" }))[0]!.id}`;
    h.env.PAYMENTS_FACILITATED = "false";
  });

  it("tells the web app, signed in or not, which switches are on", async () => {
    const res = await h.request("/gms/config");
    const first = ((await res.json()) as { data: { available: Record<string, boolean> } }).data;
    expect(first).toMatchObject({ facilitatedPayments: false, assistantEnabled: false });
    // Which optional connections can work here: every entry is a plain yes or no, and the
    // assistant is never offered while it is switched off.
    expect(Object.keys(first.available).sort()).toEqual(["assistant", "customMcp", "googleWorkspace", "mercury", "openGrants"]);
    expect(Object.values(first.available).every((v) => typeof v === "boolean")).toBe(true);
    expect(first.available.assistant).toBe(false);
    // No OpenGrants key on this server: funding search is not offered.
    expect(first.available.openGrants).toBe(false);
    const me = (await (await h.request("/gms/me", bearer(await h.session(USER_ADMIN)))).json()) as { data: { features: unknown; displayName: string | null; signInMethod: string } };
    expect(me.data.features).toMatchObject({ facilitatedPayments: false, assistantEnabled: false });
    // Someone with no name on their account is called by the first part of their address.
    expect(typeof me.data.displayName).toBe("string");
    expect(me.data.signInMethod).toBe("email");
    h.env.PAYMENTS_FACILITATED = "true";
    h.env.ASSISTANT_ENABLED = "true";
    expect(((await (await h.request("/gms/config")).json()) as { data: unknown }).data).toMatchObject({ facilitatedPayments: true, assistantEnabled: true });
  });

  it("calls someone by the name on their account, else by the first part of their address", () => {
    expect(displayNameOf("Maria Santos", "maria@aldercreek.example")).toBe("Maria Santos");
    expect(displayNameOf(null, "sedale@opengrants.example")).toBe("Sedale");
    expect(displayNameOf("  ", "dana.ortiz@riverbendcf.example")).toBe("Dana Ortiz");
    expect(displayNameOf(undefined, null)).toBeNull();
  });

  it("says Google Workspace is not configured when this server has no Composio connection", async () => {
    // No Connect button should be offered where connecting can only fail.
    h.withoutPorts.add("workspaceApps");
    expect(((await (await h.request("/gms/config")).json()) as { data: { available: { googleWorkspace: boolean } } }).data.available.googleWorkspace).toBe(false);
    expect(await data<{ status: string; connected: boolean }>(admin, "GET", "/gms/connectors/google_workspace")).toMatchObject({ status: "not_configured", connected: false });
  });

  it("refuses a release with a clear 409, and readiness says the payment is recorded after the fact", async () => {
    expect(await fail(finance, "POST", `/gms/tranches/${t1}/release`, { rail: "standard" })).toEqual({ status: 409, code: "facilitated_payments_disabled" });
    const r = await data<{ mode: string; modeNote: string | null; releasable: boolean }>(finance, "GET", `/gms/tranches/${t1}/readiness`);
    expect(r).toMatchObject({ mode: "resolve", releasable: false });
    expect(r.modeNote).toMatch(/outside the GMS/);
    expect(await data<{ facilitatedPayments: boolean }>(finance, "GET", "/gms/payments/readiness")).toMatchObject({ facilitatedPayments: false });
    expect((await h.repos.table("tranches").one({ id: t1.slice(4) }))!.status).toBe("due");
  });

  it("leaves recording a payment made elsewhere open", async () => {
    // The switch does not stand in the way: the request reaches the usual check for a Passport mirror.
    expect(await fail(finance, "POST", `/gms/tranches/${t1}/record-external`, { paidAt: "2027-07-02", reference: "CHK-1042", destinationLast4: "4821" })).toEqual({ status: 409, code: "not_mirrored" });
  });

  it("does nothing in the reconcile job", async () => {
    await h.repos.table("tranches").update({ id: t1.slice(4) }, { status: "releasing" });
    const base: BaseContext = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => new Date(h.clock.now.getTime() + 3_600_000), ports: {}, config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: PASSPORT, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: null, facilitatedPayments: false } };
    expect(await reconcileStuckReleases(base)).toMatchObject({ stuck: 0 });
    expect((await h.repos.table("tranches").one({ id: t1.slice(4) }))!.status).toBe("releasing");
  });
});

describe("who may sign for the grantee", () => {
  beforeEach(offer);

  it("compares names without case, accents, punctuation or spacing", () => {
    expect(normalizeName("  MARIA   santos lopez ")).toBe(normalizeName("María Santos-López"));
    expect(normalizeName("Maria Santos")).not.toBe(normalizeName("Mario Santos"));
  });

  it("falls back to the admin role when there is no Passport consent, and records that", async () => {
    const accepted = await data<{ signerAuthority: { rule: string; reason: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    expect(accepted.signerAuthority).toMatchObject({ rule: "admin_role", reason: "passport_not_linked" });
    const signed = await data<{ signerAuthority: { rule: string } }>(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Anyone At All", attest: true, documentSha256 });
    expect(signed.signerAuthority.rule).toBe("admin_role");
    expect(ledger("agreement.signer_checked").at(-1)!.data).toMatchObject({ rule: "admin_role", reason: "passport_not_linked" });
    expect(ledger("award.acceptance_signer_checked").at(-1)!.data).toMatchObject({ rule: "admin_role" });
    const row = await h.repos.table("agreements").one({ id: agreementId.slice(4) });
    expect((row!.grantee_signature as { authority: unknown }).authority).toMatchObject({ rule: "admin_role", reason: "passport_not_linked" });
  });

  it("requires a verified representative's name when Passport lists them", async () => {
    await linkApplicant();
    passport(REPS(TWO_REPS));
    expect(await fail(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`)).toEqual({ status: 422, code: "signer_name_required" });
    expect(await fail(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`, { name: "Priya Shah" })).toEqual({ status: 403, code: "not_a_representative" });
    expect((await h.repos.table("awards").one({ id: awardId.slice(4) }))!.status).toBe("offered");

    const accepted = await data<{ status: string; signerAuthority: { rule: string; representativeId: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`, { name: "jamal  REED" });
    expect(accepted.signerAuthority).toMatchObject({ rule: "passport_representative", representativeId: "rep_jamal", verificationLevel: "L2" });

    expect(await fail(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Priya Shah", attest: true, documentSha256 })).toEqual({ status: 403, code: "not_a_representative" });
    expect((await h.repos.table("agreements").one({ id: agreementId.slice(4) }))!.grantee_signature).toBeNull();
    const signed = await data<{ signerAuthority: { rule: string } }>(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "maria santos lopez", attest: true, documentSha256 });
    expect(signed.signerAuthority).toMatchObject({ rule: "passport_representative", representativeId: "rep_maria" });
    expect(ledger("agreement.signer_checked").at(-1)!.data).toMatchObject({ rule: "passport_representative", representativeId: "rep_maria", reason: null });
  });

  it("falls back when the consent does not cover representatives, Passport is down, or nobody is verified yet", async () => {
    await linkApplicant();
    passport(REPS([], 403));
    expect((await data<{ signerAuthority: { reason: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`)).signerAuthority).toMatchObject({ rule: "admin_role", reason: "representatives_not_shared" });
    h.passport.fetch = async () => {
      throw new TypeError("network down");
    };
    const signed = await data<{ signerAuthority: { rule: string; reason: string } }>(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256 });
    expect(signed.signerAuthority).toMatchObject({ rule: "admin_role", reason: "passport_unavailable" });
  });

  it("shows the organization its representatives, without contact details", async () => {
    expect(await data<{ state: string; items: unknown[] }>(s.applicant, "GET", "/gms/me/representatives")).toMatchObject({ state: "not_linked", items: [] });
    await linkApplicant();
    passport(REPS(TWO_REPS));
    const reps = await data<{ state: string; items: Record<string, unknown>[]; manageUrl: string }>(s.applicant, "GET", "/gms/me/representatives");
    expect(reps.state).toBe("ok");
    expect(reps.items).toEqual([
      { id: "rep_maria", name: "María  Santos-López", title: "Executive Director", role: "control_officer", isControlOfficer: true, verified: true, verificationLevel: "L3", verifiedAt: "2027-01-12T17:00:00Z" },
      { id: "rep_jamal", name: "Jamal Reed", title: "Board Treasurer", role: "second_representative", isControlOfficer: false, verified: true, verificationLevel: "L2", verifiedAt: "2027-01-12T17:00:00Z" },
    ]);
    // A link a person opens goes to Passport's web app, never to its API (which answers 404 to a browser).
    expect(reps.manageUrl).toBe(`${PASSPORT.replace("//passport.", "//app.passport.")}/orgs/${ORG_ALDER}`);
    expect(reps.manageUrl).not.toContain(`${PASSPORT}/`);
    const org = await data<{ representatives: { state: string; items: unknown[] } }>(s.applicant, "GET", "/gms/me/organization");
    expect(org.representatives).toMatchObject({ state: "ok" });
    expect(org.representatives.items).toHaveLength(2);
  });

  it("returns a signer's network address only to funder admins and finance, and to the signer's own admins", async () => {
    await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    await data(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256 });
    await data(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });
    type Sig = { party: string; name: string; ip: string | null; ipVisible: boolean; signerRule: string | null };
    const forFinance = await data<Sig[]>(finance, "GET", `/gms/awards/${awardId}/signatures`);
    expect(forFinance.map((x) => [x.party, x.ip !== null, x.ipVisible])).toEqual([["grantee", true, true], ["funder", true, true]]);
    expect(forFinance[0]!.signerRule).toBe("admin_role");
    expect((await data<Sig[]>(admin, "GET", `/gms/awards/${awardId}/signatures`)).every((x) => x.ip !== null)).toBe(true);
    // A program officer sees who signed and when, not from where.
    expect((await data<Sig[]>(s.funder, "GET", `/gms/awards/${awardId}/signatures`)).map((x) => [x.name, x.ip])).toEqual([["Maria Santos", null], ["Dana Ortiz", null]]);
    // The grantee's admin sees their own signer's address, never the funder's.
    expect((await data<Sig[]>(s.applicant, "GET", `/gms/my/awards/${awardId}/signatures`)).map((x) => [x.party, x.ip !== null])).toEqual([["grantee", true], ["funder", false]]);
    expect((await data<Sig[]>(s.editor, "GET", `/gms/my/awards/${awardId}/signatures`)).every((x) => x.ip === null)).toBe(true);
    expect((await fail(s.funder, "GET", `/gms/my/awards/${awardId}/signatures`)).status).toBe(403);
  });
});

describe("budget categories and their mapping", () => {
  beforeEach(activate);

  it("lets the funder define categories on the program", async () => {
    expect(await data<{ categories: string[] }>(s.funder, "GET", `/gms/programs/${programId}/budget-categories`)).toMatchObject({ categories: [] });
    const saved = await data<{ categories: string[] }>(s.funder, "PUT", `/gms/programs/${programId}/budget-categories`, { categories: ["Personnel", "Travel", "Supplies"] });
    expect(saved.categories).toEqual(["Personnel", "Travel", "Supplies"]);
    const program = await data<{ budgetCategories: string[]; defaults: { budgetCategories: string[]; schedule: unknown[] } }>(s.funder, "GET", `/gms/programs/${programId}`);
    expect(program.budgetCategories).toEqual(["Personnel", "Travel", "Supplies"]);
    expect(program.defaults.schedule).toHaveLength(2);
    expect((await fail(s.funder, "PUT", `/gms/programs/${programId}/budget-categories`, { categories: ["Travel", "travel"] })).status).toBe(400);
    expect(await fail(s.funder, "PATCH", `/gms/programs/${programId}`, { defaults: { budgetCategories: [1, 2] } })).toEqual({ status: 422, code: "invalid_budget_categories" });
    expect((await fail(s.applicant, "PUT", `/gms/programs/${programId}/budget-categories`, { categories: [] })).status).toBe(403);
  });

  it("lets the grantee map its own categories, and variance compares by the funder's", async () => {
    await data(s.funder, "PUT", `/gms/programs/${programId}/budget-categories`, { categories: ["Personnel", "Travel"] });
    await data(s.funder, "PUT", `/gms/awards/${awardId}/budget`, { kind: "approved", lines: [{ category: "Personnel", label: "Navigators", amountMinor: 10_000_000 }, { category: "Travel", label: "Mileage", amountMinor: 5_000_000 }] });
    await data(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget`, { kind: "actual", periodStart: "2027-07-01", periodEnd: "2027-09-30", lines: [{ category: "Salaries", label: "Staff", amountMinor: 2_000_000 }, { category: "Benefits", label: "Health", amountMinor: 500_000 }, { category: "Fuel", label: "Fuel", amountMinor: 300_000 }] });

    type Variance = { categories: { category: string; actualMinor: number; approvedMinor: number }[]; unmappedCategories: string[] };
    const before = await data<Variance>(s.funder, "GET", `/gms/awards/${awardId}/variance`);
    expect(before.unmappedCategories).toEqual(["Benefits", "Fuel", "Salaries"]);

    expect(await fail(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget-mapping`, { mapping: [{ category: "Equipment", ownCategory: "Salaries" }] })).toEqual({ status: 422, code: "unknown_budget_category" });
    expect((await fail(s.funder, "PUT", `/gms/my/awards/${awardId}/budget-mapping`, { mapping: [] })).status).toBe(403);
    const saved = await data<{ categories: string[]; mapping: { category: string; ownCategory: string }[] }>(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget-mapping`, {
      mapping: [{ category: "Personnel", ownCategory: "Salaries" }, { category: "Personnel", ownCategory: "Benefits" }, { category: "Travel", ownCategory: "Fuel" }],
    });
    expect(saved.categories).toEqual(["Personnel", "Travel"]);
    expect(saved.mapping).toEqual([{ category: "Personnel", ownCategory: "Benefits" }, { category: "Personnel", ownCategory: "Salaries" }, { category: "Travel", ownCategory: "Fuel" }]);
    expect((await data<{ mapping: unknown[] }>(s.funder, "GET", `/gms/awards/${awardId}/budget-mapping`)).mapping).toHaveLength(3);

    const after = await data<Variance>(s.applicant, "GET", `/gms/my/awards/${awardId}/variance`);
    expect(after.unmappedCategories).toEqual([]);
    expect(after.categories.map((c) => [c.category, c.approvedMinor, c.actualMinor])).toEqual([["Personnel", 10_000_000, 2_500_000], ["Travel", 5_000_000, 300_000]]);
    expect(ledger("budget.categories_mapped")).toHaveLength(1);
  });
});

describe("programs: owner and outcome totals", () => {
  it("names the owner in the list and the detail, and only takes a member of the workspace", async () => {
    expect(await fail(s.funder, "PATCH", `/gms/programs/${programId}`, { ownerUserId: USER_APPLICANT })).toEqual({ status: 422, code: "owner_not_a_member" });
    const saved = await data<{ ownerUserId: string; owner: { userId: string; name: string }; ownerName: string }>(s.funder, "PATCH", `/gms/programs/${programId}`, { ownerUserId: USER_ADMIN });
    expect(saved).toMatchObject({ ownerUserId: USER_ADMIN, ownerName: "Helen Ortiz", owner: { userId: USER_ADMIN, name: "Helen Ortiz" } });
    const list = await s.call<{ items: { id: string; owner: { name: string } | null }[] }>(s.funder, "GET", "/gms/programs?pageSize=100");
    expect(list.body.items.find((p) => p.id === programId)!.owner).toEqual({ userId: USER_ADMIN, name: "Helen Ortiz" });
    expect((await data<{ owner: unknown }>(s.funder, "GET", `/gms/programs/${programId}/rollup`)).owner).toEqual({ userId: USER_ADMIN, name: "Helen Ortiz" });
    expect((await data<{ owner: unknown }>(s.funder, "PATCH", `/gms/programs/${programId}`, { ownerUserId: null })).owner).toBeNull();
  });

  it("adds up outcome fields from accepted reports only", async () => {
    await activate();
    type Rollup = { outcomes: { reportsAccepted: number; totals: { key: string; label: string; unit: string | null; total: number; reports: number }[] } };
    expect((await data<Rollup>(s.funder, "GET", `/gms/programs/${programId}/rollup`)).outcomes).toEqual({ reportsAccepted: 0, totals: [] });

    const req = (await h.repos.table("requirements").find({ award_id: awardId.slice(4) }))[0]!;
    const report = async (status: string, response: Record<string, unknown>) => {
      const sub = await h.repos.table("submissions").insert({ workspace_id: WS_FUNDER, requirement_id: req.id, award_id: req.award_id, status, submitted_at: h.clock.now.toISOString(), submitted_by: USER_APPLICANT });
      await h.repos.table("form_responses").insert({ workspace_id: WS_FUNDER, submission_id: sub.id, form_id: reportFormId.slice(4), form_version: 1, response: response as never, status: "complete" });
    };
    await report("accepted", { progress: "Two clinics a week", peopleServed: 120, clinicsHeld: 8, staffCount: 4 });
    await report("accepted", { progress: "Three clinics a week", peopleServed: 80, clinicsHeld: "many" });
    await report("submitted", { progress: "Not reviewed yet", peopleServed: 1000, clinicsHeld: 50 });

    const out = (await data<Rollup>(s.funder, "GET", `/gms/programs/${programId}/rollup`)).outcomes;
    expect(out.reportsAccepted).toBe(2);
    expect(out.totals).toEqual([
      { key: "clinicsHeld", label: "Clinics held", unit: "clinics", total: 8, reports: 1 },
      { key: "peopleServed", label: "People served", unit: "people", total: 200, reports: 2 },
    ]);
  });
});

describe("a person's own sessions", () => {
  beforeEach(() => {
    h.sessions.rows.push(
      { userId: USER_ADMIN, id: SESSION_A, createdAt: "2027-04-01T09:00:00Z", lastActiveAt: "2027-04-20T09:00:00Z", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", ip: "203.0.113.7", aal: "aal2" },
      { userId: USER_ADMIN, id: SESSION_B, createdAt: "2027-03-01T09:00:00Z", lastActiveAt: null, userAgent: null, ip: null, aal: "aal1" },
      { userId: USER_OFFICER, id: SESSION_OTHER, createdAt: "2027-03-01T09:00:00Z", lastActiveAt: null, userAgent: null, ip: "198.51.100.9", aal: "aal2" },
    );
  });
  const as = async (user: string, sessionId?: string) => bearer(await h.session(user, sessionId ? { sessionId } : {})).headers;

  it("lists only the caller's sessions and marks the current one", async () => {
    const res = await h.request("/gms/me/sessions", { headers: await as(USER_ADMIN, SESSION_A) });
    const list = ((await res.json()) as { data: { id: string; current: boolean; device: string | null; mfa: boolean; ip: string | null }[] }).data;
    expect(list.map((x) => [x.id, x.current, x.device, x.mfa])).toEqual([[SESSION_A, true, "Chrome on macOS", true], [SESSION_B, false, null, false]]);
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect((await h.request("/gms/me/sessions")).status).toBe(401);
  });

  it("ends another of the caller's sessions, never someone else's and never the current one", async () => {
    const who = await as(USER_ADMIN, SESSION_A);
    expect((await h.request(`/gms/me/sessions/${SESSION_OTHER}`, { method: "DELETE", headers: who })).status).toBe(404);
    expect(h.sessions.rows.some((x) => x.id === SESSION_OTHER)).toBe(true);
    const current = await h.request(`/gms/me/sessions/${SESSION_A}`, { method: "DELETE", headers: who });
    expect(current.status).toBe(409);
    const ended = await h.request(`/gms/me/sessions/${SESSION_B}`, { method: "DELETE", headers: who });
    expect(((await ended.json()) as { data: unknown }).data).toEqual({ ended: true, id: SESSION_B });
    expect(h.sessions.rows.map((x) => x.id).sort()).toEqual([SESSION_A, SESSION_OTHER]);
    expect(ledger("session.ended")).toHaveLength(1);
  });
});

describe("members: last active and a consultant's organization", () => {
  const member = async (user: string) => (await h.repos.table("workspace_members").one({ workspace_id: WS_FUNDER, user_id: user }))!;

  it("notes activity at most once every 15 minutes", async () => {
    await h.repos.table("workspace_members").update({ workspace_id: WS_FUNDER, user_id: FINANCE }, { last_active_at: null });
    await data(finance, "GET", "/gms/payments/readiness");
    const first = (await member(FINANCE)).last_active_at;
    expect(first).toBe(h.clock.now.toISOString());
    h.clock.now = new Date(h.clock.now.getTime() + 14 * 60_000);
    await data(finance, "GET", "/gms/payments/readiness");
    expect((await member(FINANCE)).last_active_at).toBe(first);
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 60_000);
    await data(await headers(FINANCE, WS_FUNDER), "GET", "/gms/payments/readiness");
    expect((await member(FINANCE)).last_active_at).toBe(h.clock.now.toISOString());
    const list = (await s.call<{ items: { userId: string; lastActiveAt: string | null }[] }>(admin, "GET", `/gms/workspaces/${WS_FUNDER}/members`)).body.items;
    expect(list.find((m) => m.userId === FINANCE)!.lastActiveAt).toBe(h.clock.now.toISOString());
  });

  it("keeps the firm a consultant works for from the invitation to the member list", async () => {
    const applicantAdmin = await headers(USER_APPLICANT, WS_APPLICANT);
    expect(await fail(applicantAdmin, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: "pat@grantwell.example", role: "editor", organizationName: "Grantwell Consulting" })).toEqual({ status: 422, code: "organization_for_consultants" });
    const inv = await data<{ token: string; organization: string }>(applicantAdmin, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: "pat@grantwell.example", role: "consultant", organizationName: "Grantwell Consulting" });
    expect(inv.organization).toBe("Grantwell Consulting");
    const CONSULTANT = "c0c0c0c0-0000-4000-8000-000000000001";
    const accepted = await h.request("/gms/invitations/accept", { method: "POST", headers: { ...bearer(await h.session(CONSULTANT)).headers, "Content-Type": "application/json" }, body: JSON.stringify({ token: inv.token }) });
    expect(accepted.status).toBeLessThan(300);
    const list = (await s.call<{ items: { userId: string; organization: string | null }[] }>(applicantAdmin, "GET", `/gms/workspaces/${WS_APPLICANT}/members`)).body.items;
    expect(list.find((m) => m.userId === CONSULTANT)!.organization).toBe("Grantwell Consulting");
    expect(list.find((m) => m.userId === USER_APPLICANT_EDITOR)!.organization).toBeNull();
  });
});

describe("a funder's named contacts", () => {
  const CONTACTS = [
    { name: "Dana Ortiz", title: "Program Officer", email: "Dana.Ortiz@riverbendcf.example", public: true },
    { name: "Sam Whitfield", title: "Grants Manager", email: "sam.whitfield@riverbendcf.example", phone: "555-0100" },
  ];

  it("is edited by funder admins and shown to applicants and, when public, on the funder page", async () => {
    expect((await fail(s.funder, "PUT", "/gms/contacts", { contacts: CONTACTS })).status).toBe(403);
    expect((await fail(admin, "PUT", "/gms/contacts", { contacts: [{ name: "No Email" }] })).status).toBe(400);
    const saved = await data<{ name: string; email: string; public: boolean }[]>(admin, "PUT", "/gms/contacts", { contacts: CONTACTS });
    expect(saved.map((c) => [c.name, c.email, c.public])).toEqual([["Dana Ortiz", "dana.ortiz@riverbendcf.example", true], ["Sam Whitfield", "sam.whitfield@riverbendcf.example", false]]);
    expect(await data<unknown[]>(s.funder, "GET", "/gms/contacts")).toHaveLength(2);
    await data(admin, "PATCH", `/gms/workspaces/${WS_FUNDER}`, { settings: { contactEmail: "grants@riverbendcf.example" } });

    const handle = (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!.handle;
    const page = ((await (await h.request(`/gms/public/funders/${handle}`)).json()) as { data: { funder: { contactEmail: string; contacts: { name: string }[] } } }).data;
    expect(page.funder.contactEmail).toBe("grants@riverbendcf.example");
    expect(page.funder.contacts.map((c) => c.name)).toEqual(["Dana Ortiz"]);

    const mine = await data<{ workspaceId: string; contacts: { name: string }[]; contactEmail: string }[]>(s.applicant, "GET", "/gms/my/funders/detail");
    const funder = mine.find((f) => f.workspaceId === WS_FUNDER)!;
    expect(funder.contacts.map((c) => c.name)).toEqual(["Dana Ortiz", "Sam Whitfield"]);
    expect(funder.contactEmail).toBe("grants@riverbendcf.example");
    expect(ledger("workspace.contacts_updated")).toHaveLength(1);
  });
});

describe("interview slots", () => {
  const SLOTS = ["2027-05-04T17:00:00Z", "2027-05-05T18:30:00Z"];
  type State = { proposed: { slots: string[]; slotOptions: { id: string; at: string }[] } | null; confirmed: { slot: string; slotId: string } | null };

  it("proposes slots, lists them in the follow-ups for both sides, and confirms by slot id or time", async () => {
    const proposed = await data<State>(s.funder, "POST", `/gms/applications/${appId}/interview`, { slots: SLOTS, note: "Video call", location: "Online" });
    expect(proposed.proposed!.slotOptions).toEqual([{ id: "slot_1", at: SLOTS[0] }, { id: "slot_2", at: SLOTS[1] }]);
    const seen = await data<{ interview: State }>(s.applicant, "GET", `/gms/my/applications/${appId}/follow-ups`);
    expect(seen.interview.proposed!.slots).toEqual(SLOTS);
    expect(seen.interview.confirmed).toBeNull();

    expect(await fail(s.applicant, "POST", `/gms/my/applications/${appId}/interview/confirm`, { slotId: "slot_9" })).toEqual({ status: 422, code: "slot_not_offered" });
    expect((await fail(s.applicant, "POST", `/gms/my/applications/${appId}/interview/confirm`, {})).status).toBe(400);
    expect((await fail(s.funder, "POST", `/gms/my/applications/${appId}/interview/confirm`, { slotId: "slot_1" })).status).toBe(403);
    const byId = await data<State>(s.applicant, "POST", `/gms/my/applications/${appId}/interview/confirm`, { slotId: "slot_2" });
    expect(byId.confirmed).toMatchObject({ slot: SLOTS[1], slotId: "slot_2" });
    const byTime = await data<State>(s.applicant, "POST", `/gms/my/applications/${appId}/interview/confirm`, { slot: SLOTS[0] });
    expect(byTime.confirmed).toMatchObject({ slot: SLOTS[0], slotId: "slot_1" });
    expect((await data<{ interview: State }>(s.funder, "GET", `/gms/applications/${appId}/follow-ups`)).interview.confirmed!.slotId).toBe("slot_1");
  });
});

describe("the assistant's status", () => {
  it("reports the model, the monthly quota and what is used when on", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    const on = await data<{ enabled: boolean; model: string; monthlyQuota: number; used: number }>(s.funder, "GET", "/gms/assist/status");
    expect(on).toMatchObject({ enabled: true, used: 0 });
    expect(on.model).toMatch(/^claude-/);
    expect(on.monthlyQuota).toBeGreaterThan(0);
    h.env.ASSISTANT_MODEL = "claude-haiku-5-5";
    expect((await data<{ model: string }>(s.funder, "GET", "/gms/assist/status")).model).toBe("claude-haiku-5-5");
  });

  it("answers 404 on every drafting route when off, whatever the body", async () => {
    for (const path of ["/gms/assist/summarize", "/gms/assist/compare-rubric", "/gms/assist/draft-letter", "/gms/assist/adapt-answer"]) {
      expect(await fail(s.funder, "POST", path, { nonsense: true })).toEqual({ status: 404, code: "assistant_disabled" });
    }
    expect(await data<{ enabled: boolean }>(s.funder, "GET", "/gms/assist/status")).toMatchObject({ enabled: false, model: null, monthlyQuota: null, used: null });
  });
});
