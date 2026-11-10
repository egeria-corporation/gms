// SPDX-License-Identifier: AGPL-3.0-only
// Applying through the CommonGrants routes: start with Passport prefill, merge edits, submit.
import { beforeEach, describe, expect, it } from "vitest";
import { WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, scenario, type Scenario } from "./scenario.ts";

interface App {
  id: string;
  title: string;
  status: { value: string; customValue?: string };
  submittedAt: string | null;
  formResponses: Record<string, { response: Record<string, unknown>; status: { value: string }; validationErrors: unknown[]; customFields: { gms: { value: { provenance: Record<string, string>; lockedAt?: string } }; gmsRejected?: { value: string[] } } }>;
  customFields: Record<string, { value: unknown }>;
}
const gms = (a: App) => a.customFields.gms!.value as { status: string; stage: string; eligibility: { eligible: unknown; preview?: boolean; results: { outcome: string }[] }; requestedAmount?: { amount: string } };

let h: Harness;
let s: Scenario;
beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

const start = async () => (await s.call<{ data: App }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).body.data;
const fill = (appId: string, formId: string, response: unknown, who = s.applicant) => s.call<{ data: App["formResponses"][string] }>(who, "PUT", `/common-grants/applications/${appId}/forms/${formId}`, { response });
const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };

describe("start", () => {
  it("creates a draft with the first stage's form prefilled from Passport and marked", async () => {
    const res = await s.call<{ data: App }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    expect(res.status).toBe(201);
    const app = res.body.data;
    expect(app.status).toEqual({ value: "inProgress" });
    expect(gms(app).stage).toBe("loi");
    expect(Object.keys(app.formResponses)).toEqual([s.uuid.loi]);
    const loi = app.formResponses[s.uuid.loi]!;
    expect(loi.response).toEqual({ legalName: "Alder Creek Family Services", annualBudget: 2_400_000 });
    expect(loi.customFields.gms.value.provenance).toEqual({ "/legalName": "passport", "/annualBudget": "passport" });
    // Nothing has been entered beyond prefill.
    expect(loi.status.value).toBe("notStarted");
  });

  it("returns an eligibility preview that uses the organization and its profile", async () => {
    const e = gms(await start()).eligibility;
    expect(e.preview).toBe(true);
    expect(e.eligible).toBe(true);
    expect(e.results.map((r) => r.outcome)).toEqual(["pass", "pass", "pass"]);
  });

  it("reports unknown, not ineligible, when the profile has not been shared", async () => {
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { profile_projection: null });
    expect(gms(await start()).eligibility.eligible).toBe("unknown");
  });

  it("is idempotent: starting again returns the same application", async () => {
    const first = await start();
    const again = await s.call<{ data: App }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.id);
  });

  it("refuses another organization, a funder workspace and an unknown competition", async () => {
    expect((await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp, organizationId: "0193a1c0-0000-7000-8000-00000000dead" })).status).toBe(403);
    expect((await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp, organizationId: ORG_ALDER })).status).toBe(201);
    expect((await s.call(s.funder, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).status).toBe(403);
    expect((await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: "0193a1c0-0000-7000-8000-00000000ffff" })).status).toBe(404);
  });
});

describe("form responses", () => {
  it("merges partial updates, keeps earlier answers and records who entered what", async () => {
    const app = await start();
    await fill(app.id, s.uuid.loi, { projectTitle: "Mobile Health Navigation" });
    const second = await fill(app.id, s.uuid.loi, { need: "Families travel 46 miles." }, s.editor);
    expect(second.status).toBe(200);
    expect(second.body.data.response).toMatchObject({ legalName: "Alder Creek Family Services", projectTitle: "Mobile Health Navigation", need: "Families travel 46 miles." });
    expect(second.body.data.customFields.gms.value.provenance).toMatchObject({ "/projectTitle": "user", "/need": "user", "/legalName": "passport" });
    expect(second.body.data.status.value).toBe("inProgress");
  });

  it("returns validation errors without failing the save", async () => {
    const app = await start();
    const r = await fill(app.id, s.uuid.loi, { projectTitle: "X" });
    expect(r.status).toBe(200);
    expect(r.body.data.validationErrors.length).toBeGreaterThan(0);
  });

  it("never lets a Passport-owned field be edited here", async () => {
    const app = await start();
    const r = await fill(app.id, s.uuid.loi, { legalName: "Someone Else Inc.", projectTitle: "Mobile Health Navigation" });
    expect(r.body.data.response.legalName).toBe("Alder Creek Family Services");
    expect(r.body.data.customFields.gmsRejected?.value).toEqual(["/legalName"]);
  });

  it("hides a draft from the funder and from other applicants", async () => {
    const app = await start();
    expect((await s.call(s.funder, "GET", `/common-grants/applications/${app.id}`)).status).toBe(404);
    expect((await s.call(s.funder, "PUT", `/common-grants/applications/${app.id}/forms/${s.uuid.loi}`, { response: {} })).status).toBe(404);
  });
});

describe("submit", () => {
  it("refuses an incomplete application and lists what is missing", async () => {
    const app = await start();
    const r = await s.call<{ errors: { code: string; field?: string }[] }>(s.applicant, "PUT", `/common-grants/applications/${app.id}/submit`);
    expect(r.status).toBe(422);
    expect(r.body.errors[0]!.code).toBe("validation_failed");
    expect(r.body.errors.some((e) => e.field?.includes("projectTitle"))).toBe(true);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("submits: stamps level and attestation, locks responses, consents, acknowledges, emits", async () => {
    const app = await start();
    await fill(app.id, s.uuid.loi, COMPLETE);
    h.webhooks.subscriptions.push({ id: "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b", workspaceId: WS_FUNDER, url: "https://hooks.riverbendcf.example/gms", eventTypes: [], secretEnc: "x", active: true });
    const r = await s.call<{ data: App }>(s.applicant, "PUT", `/common-grants/applications/${app.id}/submit`);
    expect(r.status).toBe(200);
    const done = r.body.data;
    expect(done.status).toEqual({ value: "submitted" });
    expect(done.title).toBe("Mobile Health Navigation for Rural Families");
    expect(done.submittedAt).toBe("2027-04-16T17:00:00.000Z");
    expect(done.customFields.verificationLevel!.value).toBe("L3");
    expect(done.customFields.attestation!.value).toBe(`https://passport.test/passport/orgs/${ORG_ALDER}/attestation`);
    expect(gms(done).requestedAmount).toMatchObject({ amount: "150000.00" });
    expect(gms(done).eligibility.eligible).toBe(true);
    expect(done.formResponses[s.uuid.loi]!.customFields.gms.value.lockedAt).toBeTruthy();

    const consent = await h.repos.table("consents").one({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER });
    expect(consent).toMatchObject({ basis: "application", revoked_at: null });
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]).toMatchObject({ to: ["info@aldercreekfs.example"], subject: "We received your application: Mobile Health Navigation for Rural Families" });
    const events = (await h.ledger.list({ workspaceId: WS_FUNDER, subjectId: app.id })).map((e) => e.eventType);
    expect(events).toEqual(expect.arrayContaining(["application.started", "application.submit", "communication.sent"]));
    // The funder's subscribers hear about it, even though the applicant acted.
    expect(h.webhooks.deliveries.map((d) => d.eventType)).toEqual(["application.submitted", "application.status.changed"]);

    // Locked: no more edits, and the funder can now read it.
    expect((await fill(app.id, s.uuid.loi, { need: "changed" })).status).toBe(409);
    expect((await s.call(s.funder, "GET", `/common-grants/applications/${app.id}`)).status).toBe(200);
  });

  it("needs the submit scope: an editor can fill but not submit", async () => {
    const app = await start();
    await fill(app.id, s.uuid.loi, COMPLETE, s.editor);
    const r = await s.call<{ errors: { code: string }[] }>(s.editor, "PUT", `/common-grants/applications/${app.id}/submit`);
    expect(r.status).toBe(403);
    expect(r.body.errors[0]!.code).toBe("insufficient_scope");
  });

  it("refuses after the stage has closed", async () => {
    const app = await start();
    await fill(app.id, s.uuid.loi, COMPLETE);
    h.clock.now = new Date("2027-05-02T00:00:00Z");
    const fresh = await scenarioHeaders();
    const r = await s.call<{ message: string }>(fresh, "PUT", `/common-grants/applications/${app.id}/submit`);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("This stage is closed to submissions.");
  });
});

/** Session tokens are minted against the test clock, so a clock jump needs a new one. */
async function scenarioHeaders() {
  const { USER_APPLICANT } = await import("./scenario.ts");
  return { Authorization: `Bearer ${await h.session(USER_APPLICANT)}`, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
}

describe("search", () => {
  it("lists the caller's own applications, filtered by status", async () => {
    const app = await start();
    const mine = await s.call<{ items: App[]; paginationInfo: { totalItems: number } }>(s.applicant, "POST", "/common-grants/applications/search", { filters: { status: { operator: "in", value: ["inProgress"] } } });
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((a) => a.id)).toEqual([app.id]);
    // A draft is not in the funder's inbox.
    const theirs = await s.call<{ items: App[] }>(s.funder, "POST", "/common-grants/applications/search", {});
    expect(theirs.body.items).toEqual([]);
  });
});
