// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// One scenario, two backends, for the rest of the applicant port: (a) the web HTTP client against
// the real API Worker in-process, with an active grant that has a schedule and a report due, and
// (b) the in-browser mock. The same assertions run on both, on the fields the screens read.
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpApplicantApi, type AppForm, type ApplicantApi } from "../src/api/applicant.ts";
import { createHttpApplicantMoreApi, type ApplicantMoreApi, type SectionAssignments } from "../src/api/applicantMore.ts";
import { ApiError } from "../src/api/client.ts";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantMoreApi, MORE_IDS, seedMoreStore } from "../src/mocks/applicantMore.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  api: ApplicantApi;
  more: ApplicantMoreApi;
  awardId: string;
  requirementId: string;
  /** Top-level field of the report form that a person fills in. */
  field: { key: string; value: string };
  /** A funder other than the one the grant is from. */
  otherFunder: string;
  /** The funder accepts a submitted report. */
  accept(submissionId: string): Promise<void>;
  /** What came back when a library answer was inserted into a draft application. */
  inserted: { form: AppForm; body: string; sections: SectionAssignments[]; formId: string };
}

const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const id = (prefix: string) => new RegExp(`^${prefix}_${HEX}$`);
const TRANCHE = ["scheduled", "due", "ready", "held", "releasing", "initiated", "settled", "failed", "returned", "cancelled"];

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h: ApiHarness = await helpers.harness();
  const scn = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as {
    scenario(h: ApiHarness): Promise<{
      funder: Record<string, string>;
      applicant: Record<string, string>;
      compId: string;
      uuid: { opp: string; comp: string; loi: string };
      call<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
    }>;
    USER_APPLICANT: string;
  };
  const s = await scn.scenario(h);
  const ws = (helpers as unknown as { WS_APPLICANT: string }).WS_APPLICANT;
  const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
    const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const opts = { baseUrl: helpers.BASE, token: () => h.session(scn.USER_APPLICANT, { aal: "aal2" }), workspaceId: () => ws, fetch: fetchInProcess };
  const api = createHttpApplicantApi(opts);
  const more = createHttpApplicantMoreApi(opts);

  // A report form, and a program whose defaults give every award two tranches and one report.
  const form = await data<{ id: string }>(s.funder, "POST", "/gms/forms", {
    title: "Interim report",
    purpose: "report",
    jsonSchema: { type: "object", properties: { legalName: { type: "string" }, progress: { type: "string", minLength: 5 }, peopleServed: { type: "number" } }, required: ["progress"] },
    uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/progress" }, { type: "Control", scope: "#/properties/peopleServed" }] },
    mappingFromCommonGrants: { legalName: { field: "name" } },
  });
  await data(s.funder, "POST", `/gms/forms/${form.id}/publish`);
  const program = await data<{ id: string }>(s.funder, "POST", "/gms/programs", {
    name: "Community Health 2027",
    budgetAmountMinor: 120_000_000,
    fiscalYear: 2027,
    defaults: {
      awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" },
      schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }],
      requirements: [{ key: "interim", type: "report", title: "Interim report", formId: form.id.slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }],
    },
  });
  await (h.repos.table("opportunities") as unknown as { update(where: object, patch: object): Promise<unknown> }).update({ id: s.uuid.opp }, { program_id: program.id });

  // A draft application: insert a library answer into it and read the section assignments back.
  const app = await api.startApplication(s.uuid.comp);
  const answer = await api.createAnswer({ title: "Need", body: "Families travel 46 miles to reach primary care." });
  const insertedForm = await more.insertAnswer(app.id, s.uuid.loi, { answerId: answer.id, path: "/need" });
  await api.assignSections(app.id, `frm_${s.uuid.loi}`, { Project: scn.USER_APPLICANT });
  const sections = await more.sectionAssignments(app.id);

  // Apply, decide, accept, sign, countersign: the award is active.
  await api.saveForm(app.id, s.uuid.loi, { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" } });
  await api.submit(app.id);
  const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: app.id, outcome: "approve", amountMinor: 15_000_000 }] });
  const res = await data<{ results: { awardId: string; agreementId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
  const { awardId, agreementId } = res.results[0]!;
  const sent = await data<{ documentSha256: string }>(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
  await api.acceptAward(awardId);
  await api.signAgreement(agreementId, { name: "Maria Santos", attest: true, documentSha256: sent.documentSha256 });
  await data(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });
  const requirement = (await more.requirements())[0]!;

  return {
    api,
    more,
    awardId,
    requirementId: requirement.id,
    field: { key: "progress", value: "Two navigators hired; the van route is running." },
    otherFunder: "cascade-county",
    accept: async (submissionId) => void (await data(s.funder, "POST", `/gms/submissions/${submissionId}/accept`, {})),
    inserted: { form: insertedForm, body: answer.body, sections, formId: s.uuid.loi },
  };
}

async function mockBackend(): Promise<Backend> {
  const store = seedApplicantStore();
  const moreStore = seedMoreStore(store);
  const session = async () => demoSession();
  const api = createMockApplicantApi({ session, store });
  const more = createMockApplicantMoreApi({ session, store, more: moreStore });
  const answer = store.answers.find((a) => (a.usedIn ?? []).length === 0)!;
  const app = `app_${APPLICANT_IDS.appHealth}`;
  const insertedForm = await more.insertAnswer(app, `frm_${APPLICANT_IDS.formFull}`, { answerId: answer.id, path: "/need" });
  return {
    api,
    more,
    awardId: `awd_${APPLICANT_IDS.awardClinic}`,
    requirementId: `req_${MORE_IDS.reqFinal}`,
    field: { key: "progress", value: "Two navigators hired; the van route is running across six stops." },
    otherFunder: "riverbend",
    accept: async (submissionId) => {
      const s = moreStore.submissions.find((x) => `sub_${x.uuid}` === submissionId)!;
      s.status = "accepted";
      moreStore.requirements.find((r) => r.uuid === s.requirementUuid)!.status = "accepted";
    },
    inserted: { form: insertedForm, body: answer.body, sections: await more.sectionAssignments(app), formId: APPLICANT_IDS.formFull },
  };
}

describe.each([
  ["real API", realBackend],
  ["mock", mockBackend],
])("the rest of the applicant port against the %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("inserts a library answer as `library` and reads section assignments back", () => {
    expect(b.inserted.form.response.need).toBe(b.inserted.body);
    expect(b.inserted.form.provenance["/need"]).toBe("library");
    const row = b.inserted.sections.find((r) => r.formId === b.inserted.formId);
    expect(row).toBeDefined();
    expect(Object.keys(row!.sections).length).toBeGreaterThan(0);
    for (const owner of Object.values(row!.sections)) expect(owner).toMatch(new RegExp(`^${HEX}$`));
  });

  it("reads a grant's schedule, payee status and budget", async () => {
    const schedule = await b.more.schedule(b.awardId);
    expect(schedule.length).toBe(2);
    for (const t of schedule) {
      expect(t.id).toMatch(id("trn"));
      expect(typeof t.seq).toBe("number");
      expect(Number.isInteger(t.amountMinor)).toBe(true);
      expect(t.currency).toBe("USD");
      expect(["onExecution", "onReportAccepted", "onDate", "manual"]).toContain(t.condition.type);
      expect(TRANCHE).toContain(t.status);
      // Bank facts are a name and four digits at most.
      if (t.last4) expect(t.last4).toMatch(/^\d{4}$/);
    }
    const payee = await b.more.payee();
    expect(["active", "pending_change", "none", "unknown"]).toContain(payee.status);
    expect(payee.level).toBe("L3");
    if (payee.last4) expect(payee.last4).toMatch(/^\d{4}$/);

    const book = await b.more.budget(b.awardId);
    expect(book.awardId).toBe(b.awardId);
    expect(book.currency).toBe("USD");
    expect(typeof book.awardedAmountMinor).toBe("number");
    expect(Array.isArray(book.actuals)).toBe(true);
  });

  it("reports actuals for a period and requests an amendment", async () => {
    const before = (await b.more.budget(b.awardId)).actuals.length;
    const saved = await b.more.reportActuals(b.awardId, { periodStart: "2027-07-01", periodEnd: "2027-09-30", lines: [{ category: "Personnel", label: "Q1 salaries", amountMinor: 2_400_000 }] });
    expect(saved.kind).toBe("actual");
    expect(saved.totalMinor).toBe(2_400_000);
    expect(saved.periodStart).toBe("2027-07-01");
    // The same period again replaces what was reported for it.
    await b.more.reportActuals(b.awardId, { periodStart: "2027-07-01", periodEnd: "2027-09-30", lines: [{ category: "Personnel", label: "Q1 salaries", amountMinor: 2_500_000 }] });
    const after = (await b.more.budget(b.awardId)).actuals;
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.totalMinor).toBe(2_500_000);
    await expect(b.more.reportActuals(b.awardId, { periodStart: "", periodEnd: "", lines: [{ category: "Personnel", label: "x", amountMinor: 1 }] })).rejects.toBeInstanceOf(ApiError);

    const amendment = await b.more.requestAmendment(b.awardId, { type: "extension", reason: "The van was out of service for nine days.", request: { newEndDate: "2028-09-30" } });
    expect(amendment.status).toBe("requested");
    expect(amendment.type).toBe("extension");
    expect(amendment.awardId).toBe(b.awardId);
    expect((await b.api.award(b.awardId)).amendments.length).toBeGreaterThan(0);
  });

  let submissionId = "";
  let formId = "";

  it("lists requirements and starts a report prefilled from Passport", async () => {
    const list = await b.more.requirements();
    const r = list.find((x) => x.id === b.requirementId)!;
    expect(r).toBeDefined();
    expect(r.id).toMatch(id("req"));
    expect(r.awardId).toBe(b.awardId);
    expect(r.title).toBeTruthy();
    expect(r.funder?.name).toBeTruthy();
    expect(r.funder?.handle).toBeTruthy();
    expect(r.award?.title).toBeTruthy();
    expect(r.releasesTrancheId).toMatch(id("trn"));
    expect(["scheduled", "due", "overdue"]).toContain(r.status);
    expect(r.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const sub = await b.more.startReport(b.requirementId);
    expect(sub.id).toMatch(id("sub"));
    expect(sub.status).toBe("draft");
    expect(sub.requirement?.title).toBe(r.title);
    const f = sub.formResponses[0]!;
    expect(f.formId).toMatch(id("frm"));
    expect(f.formVersion).toBeGreaterThan(0);
    expect(f.response.legalName).toBe("Alder Creek Family Services");
    expect(f.provenance["/legalName"]).toBe("passport");
    submissionId = sub.id;
    formId = f.formId;
    // Opening it again returns the same draft, and the requirement now points at it.
    expect((await b.more.startReport(b.requirementId)).id).toBe(submissionId);
    expect((await b.more.submission(submissionId)).id).toBe(submissionId);
    expect((await b.more.requirements()).find((x) => x.id === b.requirementId)!.submissionId).toBe(submissionId);
  });

  it("refuses an incomplete report, merges saves by field, submits once, then locks", async () => {
    await expect(b.more.submitReport(submissionId)).rejects.toMatchObject({ status: 422 });
    const saved = await b.more.saveReportForm(submissionId, formId, { [b.field.key]: b.field.value, ...(b.field.key === "progress" ? {} : {}) });
    expect(saved.response[b.field.key]).toBe(b.field.value);
    expect(saved.response.legalName).toBe("Alder Creek Family Services");
    expect(saved.provenance[`/${b.field.key}`]).toBe("user");
    expect(Array.isArray(saved.rejected)).toBe(true);
    // Whatever else the form still needs, fill it the way a person would.
    const pending = await b.more.submitReport(submissionId).then(
      () => null,
      (e: unknown) => e,
    );
    if (pending) {
      await b.more.saveReportForm(submissionId, formId, { familiesServed: 240, spentToDate: { amount: "31000.00", currency: "USD" }, certified: true });
    }
    const sent = pending ? await b.more.submitReport(submissionId) : await b.more.submission(submissionId);
    expect(sent.status).toBe("submitted");
    expect(sent.submittedAt).toMatch(/^\d{4}-/);
    expect(sent.formResponses[0]!.lockedAt).toBeTruthy();
    await expect(b.more.saveReportForm(submissionId, formId, { [b.field.key]: "edited after submit" })).rejects.toMatchObject({ status: 409 });
    expect((await b.more.requirements()).find((x) => x.id === b.requirementId)!.status).toBe("submitted");
  });

  it("shares a report with another funder only once it is accepted", async () => {
    await expect(b.more.shareReport(submissionId, { funderHandle: b.otherFunder })).rejects.toMatchObject({ status: 409 });
    await b.accept(submissionId);
    const shared = await b.more.shareReport(submissionId, { funderHandle: b.otherFunder, fields: [b.field.key] });
    expect(shared.sharedSubmissionId).toMatch(id("sub"));
    expect(shared.funder.name).toBeTruthy();
    expect(shared.funder.handle).toBe(b.otherFunder);
    await expect(b.more.shareReport(submissionId, { funderHandle: b.otherFunder })).rejects.toMatchObject({ status: 409 });
    // Sharing is the organization's consent, and it is on record.
    expect((await b.api.consents()).some((c) => c.basis === "shared_submission" && c.funder.handle === b.otherFunder)).toBe(true);
  });

  it("serves notifications, preferences and connected agents for the member", async () => {
    const list = await b.more.notifications();
    expect(typeof list.unread).toBe("number");
    expect(Array.isArray(list.items)).toBe(true);
    for (const n of list.items) {
      expect(n.id).toMatch(new RegExp(`^${HEX}$`));
      expect(n.title).toBeTruthy();
      expect(n.category).toBeTruthy();
      expect(n.at).toMatch(/^\d{4}-/);
      expect(typeof n.read).toBe("boolean");
    }
    expect((await b.more.markRead({ all: true })).unread).toBe(0);
    expect((await b.more.notifications({ unread: true })).items).toEqual([]);

    const prefs = await b.more.notificationPreferences();
    expect(["immediate", "daily", "weekly", "off"]).toContain(prefs.digest);
    expect(prefs.channels.payment).toMatchObject({ inApp: expect.any(Boolean), email: expect.any(Boolean) });
    const next = await b.more.saveNotificationPreferences({ digest: "weekly", channels: { ...prefs.channels, payment: { inApp: true, email: false } } });
    expect(next.digest).toBe("weekly");
    expect(next.channels.payment).toEqual({ inApp: true, email: false });
    expect((await b.more.notificationPreferences()).channels.payment).toEqual({ inApp: true, email: false });

    const connections = await b.more.connections();
    expect(Array.isArray(connections)).toBe(true);
    for (const c of connections) {
      expect(c.clientId).toBeTruthy();
      expect(Array.isArray(c.scopes)).toBe(true);
      expect(typeof c.mine).toBe("boolean");
    }
  });
});
