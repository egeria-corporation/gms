// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the rest of the applicant port (api/applicantMore.ts). It shares the
// applicant mock's store, so a grant, its schedule and its reports are one story, and it follows the
// Worker's rules: reports prefill from Passport and the last accepted report, saves merge by field,
// a returned report reopens on the first edit, only an accepted report can be shared.
import { computeResponseStatus, mergeResponse, passportFieldPaths, validateResponse, type FormDefinition, type JsonObject, type Provenance } from "@gms/forms";
import type { AppForm } from "../api/applicant.ts";
import type {
  ActualsInput,
  Amendment,
  ApplicantMoreApi,
  BudgetBook,
  BudgetView,
  McpConnection,
  MemberNotification,
  MyRequirement,
  NotificationPreferences,
  PayeeSummary,
  ScheduleTranche,
  Submission,
  SubmissionForm,
} from "../api/applicantMore.ts";
import { ApiError } from "../api/client.ts";
import type { Session } from "../auth/types.ts";
import { APPLICANT_IDS, seedApplicantStore, type ApplicantStore } from "./applicant.ts";

const I = APPLICANT_IDS;
const clone = <T>(v: T): T => structuredClone(v);
const notFound = (what: string) => new ApiError(404, `${what} not found`);

export const MORE_IDS = {
  reportForm: "70000000-0000-7000-8000-000000000021",
  reqInterim: "d0000000-0000-7000-8000-000000000001",
  reqFinal: "d0000000-0000-7000-8000-000000000002",
  reqMidYear: "d0000000-0000-7000-8000-000000000003",
  reqSiteData: "d0000000-0000-7000-8000-000000000004",
  subMidYear: "e0000000-0000-7000-8000-000000000003",
  subSiteData: "e0000000-0000-7000-8000-000000000004",
  trancheClinic1: "f0000000-0000-7000-8000-000000000001",
  trancheClinic2: "f0000000-0000-7000-8000-000000000002",
  connClaude: "14000000-0000-7000-8000-000000000001",
  connSheets: "14000000-0000-7000-8000-000000000002",
} as const;
const M = MORE_IDS;

/** The progress report both funders in the fixtures ask for. */
export const REPORT_FORM: FormDefinition = {
  id: M.reportForm,
  version: 1,
  title: "Progress report",
  description: "Narrative progress, outcomes to date and spending for the reporting period.",
  jsonSchema: {
    type: "object",
    required: ["progress", "familiesServed", "spentToDate", "certified"],
    properties: {
      legalName: { type: "string", title: "Legal name" },
      progress: { type: "string", title: "What happened this period?", minLength: 20, "x-wordCount": { max: 300 } },
      challenges: { type: "string", title: "What got in the way, and what changed?" },
      familiesServed: { type: "integer", title: "Families served to date", minimum: 0 },
      appointmentsKept: { type: "integer", title: "Appointments kept", minimum: 0 },
      routeStops: { type: "integer", title: "Route stops active", minimum: 0 },
      navigators: { type: "number", title: "Navigators employed", minimum: 0 },
      spentToDate: { type: "object", title: "Grant funds spent to date" },
      spendingNotes: { type: "string", title: "Notes on spending against the approved budget" },
      certified: { type: "boolean", title: "I certify that this report is accurate and complete", const: true },
    },
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      {
        type: "Group",
        label: "Narrative progress",
        elements: [
          { type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } },
          { type: "Control", scope: "#/properties/progress", options: { multi: true, help: "Reviewers see this field. Avoid personal health details about named individuals." } },
          { type: "Control", scope: "#/properties/challenges", options: { multi: true } },
        ],
      },
      {
        type: "Group",
        label: "Outcomes to date",
        elements: [
          { type: "HorizontalLayout", elements: [{ type: "Control", scope: "#/properties/familiesServed" }, { type: "Control", scope: "#/properties/appointmentsKept" }] },
          { type: "HorizontalLayout", elements: [{ type: "Control", scope: "#/properties/routeStops" }, { type: "Control", scope: "#/properties/navigators" }] },
        ],
      },
      {
        type: "Group",
        label: "Spending",
        elements: [
          { type: "Control", scope: "#/properties/spentToDate", options: { widget: "money", widgetOptions: { currency: "USD" } } },
          { type: "Control", scope: "#/properties/spendingNotes", options: { multi: true } },
        ],
      },
      { type: "Group", label: "Certification", elements: [{ type: "Control", scope: "#/properties/certified" }] },
    ],
  },
  mappingFromCommonGrants: { legalName: { field: "name" } },
};

interface ReqRecord {
  uuid: string;
  awardUuid: string;
  type: string;
  title: string;
  dueAt: string | null;
  status: MyRequirement["status"];
  releasesTrancheId: string | null;
}

interface SubRecord {
  uuid: string;
  requirementUuid: string;
  status: Submission["status"];
  submittedAt: string | null;
  reviewNote: string | null;
  form: SubmissionForm;
  sharedWith: string[];
}

export interface MoreStore {
  payee: PayeeSummary;
  /** Bank name and last four per settled or in-flight tranche id; never more than that. */
  budgets: Record<string, BudgetBook>;
  requirements: ReqRecord[];
  submissions: SubRecord[];
  notifications: MemberNotification[];
  /** Notifications in the member's other workspaces, by workspace id. */
  otherNotifications: Record<string, MemberNotification[]>;
  preferences: NotificationPreferences;
  connections: McpConnection[];
}

const line = (category: string, amountMinor: number, label = category) => ({ category, label, amountMinor });
const budgetView = (id: string, kind: BudgetView["kind"], lines: BudgetView["lines"], period?: [string, string]): BudgetView => ({
  id,
  kind,
  currency: "USD",
  categories: [...new Set(lines.map((l) => l.category))],
  lines,
  totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0),
  source: "user",
  periodStart: period?.[0] ?? null,
  periodEnd: period?.[1] ?? null,
  updatedAt: "2027-05-26T00:00:00Z",
});

const PRIOR_RESPONSE: JsonObject = {
  legalName: "Alder Creek Family Services",
  progress: "Two navigators cover a weekly route of six stops across the valley. Families book visits at each stop, and navigators arrange rides and follow up on referrals.",
  challenges: "The van was out of service for nine days in March; we borrowed a county vehicle and kept every scheduled stop.",
  familiesServed: 212,
  appointmentsKept: 611,
  routeStops: 6,
  navigators: 2,
  spentToDate: { amount: "24800.00", currency: "USD" },
  certified: true,
};

export const CATEGORIES = ["application", "decision", "award", "agreement", "payment", "requirement", "submission", "organization", "approval", "review", "agent"] as const;

/**
 * Seeds the reporting and payment side of the fixtures into the shared applicant store (the
 * Cascade County grant gets a schedule and three more requirements) and returns the rest.
 */
export function seedMoreStore(store: ApplicantStore): MoreStore {
  const clinic = store.awards.find((a) => a.id === `awd_${I.awardClinic}`);
  if (clinic && clinic.tranches.length === 0) {
    clinic.disbursedAmountMinor = 2500000;
    clinic.tranches = [
      { id: `trn_${M.trancheClinic1}`, seq: 1, amountMinor: 2500000, currency: "USD", condition: { type: "onExecution" }, status: "settled", dueAt: "2026-09-01T00:00:00Z", holdReason: null, mode: "facilitated", passportStatus: "settled", releasedAt: "2026-09-02T16:58:00Z" },
      { id: `trn_${M.trancheClinic2}`, seq: 2, amountMinor: 1500000, currency: "USD", condition: { type: "onReportAccepted" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
    ];
    clinic.requirements = [
      { id: `req_${M.reqFinal}`, type: "report", title: "Final report", formId: `frm_${M.reportForm}`, dueAt: "2027-06-30T00:00:00Z", status: "due", releasesTrancheId: `trn_${M.trancheClinic2}` },
      { id: `req_${M.reqSiteData}`, type: "report", title: "Site data report", formId: `frm_${M.reportForm}`, dueAt: "2027-04-30T00:00:00Z", status: "returned", releasesTrancheId: null },
      { id: `req_${M.reqMidYear}`, type: "report", title: "Mid-year progress report", formId: `frm_${M.reportForm}`, dueAt: "2027-01-31T00:00:00Z", status: "accepted", releasesTrancheId: null },
    ];
  }
  const health = store.awards.find((a) => a.id === `awd_${I.awardHealth}`);
  if (health) health.requirements = [{ id: `req_${M.reqInterim}`, type: "report", title: "Interim report", formId: `frm_${M.reportForm}`, dueAt: "2027-12-15T00:00:00Z", status: "scheduled", releasesTrancheId: health.tranches[1]?.id ?? null }];
  if (!store.forms.some((f) => f.id === M.reportForm)) store.forms.push(clone(REPORT_FORM));
  // A revision round on the submitted LOI, so the status screen has a request and a response to show.
  const clinicApp = store.applications.find((a) => a.uuid === I.appClinic);
  if (clinicApp && !clinicApp.events.some((e) => e.type === "request_revision")) {
    clinicApp.events.push(
      { id: "17000000-0000-7000-8000-000000000001", type: "request_revision", fromStatus: "submitted", toStatus: "revision_requested", fromStage: null, toStage: null, at: "2027-04-05T17:00:00Z", message: "Please name the county assessment you cite and give its year." },
      {
        id: "17000000-0000-7000-8000-000000000002",
        type: "submit",
        fromStatus: "revision_requested",
        toStatus: "submitted",
        fromStage: null,
        toStage: null,
        at: "2027-04-08T19:30:00Z",
        message: null,
        revision: {
          requestedAt: "2027-04-05T17:00:00Z",
          message: "Please name the county assessment you cite and give its year.",
          changes: [
            {
              formId: `frm_${I.formLoi}`,
              path: "/need",
              before: "Families in the valley travel an average of 46 miles to reach primary care, according to the county assessment.",
              after: "Families in the valley travel an average of 46 miles to reach primary care, according to the 2026 Cascade County Community Health Needs Assessment.",
              wordsBefore: 19,
              wordsAfter: 24,
              wordDelta: 5,
            },
          ],
        },
      },
    );
  }

  const sub = (uuid: string, requirementUuid: string, status: Submission["status"], response: JsonObject, reviewNote: string | null, submittedAt: string): SubRecord => ({
    uuid,
    requirementUuid,
    status,
    submittedAt,
    reviewNote,
    sharedWith: [],
    form: { formId: `frm_${M.reportForm}`, formVersion: 1, response, status: "complete", validationErrors: [], provenance: { "/legalName": "passport" }, lockedAt: status === "returned" ? null : submittedAt },
  });

  return {
    payee: { status: "active", level: "L3", bankName: "River City Credit Union", last4: "4821", manageUrl: store.organization.editUrl },
    budgets: {
      [I.awardHealth]: {
        awardId: `awd_${I.awardHealth}`,
        currency: "USD",
        awardedAmountMinor: 15000000,
        proposed: null,
        approved: budgetView("15000000-0000-7000-8000-000000000001", "approved", [line("Personnel", 9600000), line("Travel & vehicle", 2800000), line("Supplies", 1100000), line("Indirect", 1500000)]),
        actuals: [],
      },
      [I.awardClinic]: {
        awardId: `awd_${I.awardClinic}`,
        currency: "USD",
        awardedAmountMinor: 4000000,
        proposed: null,
        approved: budgetView("15000000-0000-7000-8000-000000000002", "approved", [line("Personnel", 2600000), line("Travel & vehicle", 900000), line("Supplies", 500000)]),
        actuals: [budgetView("15000000-0000-7000-8000-000000000003", "actual", [line("Personnel", 1480000), line("Travel & vehicle", 972000), line("Supplies", 28000)], ["2026-07-01", "2026-12-31"])],
      },
    },
    requirements: [
      { uuid: M.reqInterim, awardUuid: I.awardHealth, type: "report", title: "Interim report", dueAt: "2027-12-15T00:00:00Z", status: "scheduled", releasesTrancheId: health?.tranches[1]?.id ?? null },
      { uuid: M.reqFinal, awardUuid: I.awardClinic, type: "report", title: "Final report", dueAt: "2027-06-30T00:00:00Z", status: "due", releasesTrancheId: `trn_${M.trancheClinic2}` },
      { uuid: M.reqSiteData, awardUuid: I.awardClinic, type: "report", title: "Site data report", dueAt: "2027-04-30T00:00:00Z", status: "returned", releasesTrancheId: null },
      { uuid: M.reqMidYear, awardUuid: I.awardClinic, type: "report", title: "Mid-year progress report", dueAt: "2027-01-31T00:00:00Z", status: "accepted", releasesTrancheId: null },
    ],
    submissions: [
      sub(M.subMidYear, M.reqMidYear, "accepted", clone(PRIOR_RESPONSE), "Accepted. Thank you for the route detail.", "2027-01-28T18:00:00Z"),
      sub(M.subSiteData, M.reqSiteData, "returned", { ...clone(PRIOR_RESPONSE), familiesServed: 198, appointmentsKept: 0 }, "Appointments kept reads 0, which does not match the narrative. Please correct the figure and resubmit.", "2027-04-20T18:00:00Z"),
    ],
    notifications: [
      { id: "16000000-0000-7000-8000-000000000001", type: "submission.returned", category: "submission", title: "Site data report returned with comments", subjectType: "submission", subjectId: `sub_${M.subSiteData}`, message: "Cascade County Health Department asked for a correction.", at: "2027-04-22T16:10:00Z", read: false },
      { id: "16000000-0000-7000-8000-000000000002", type: "award.offered", category: "award", title: "Award offered · $150,000", subjectType: "award", subjectId: `awd_${I.awardHealth}`, message: "Riverbend Community Foundation offered an award for Mobile Health Navigation for Rural Families.", at: "2027-05-18T17:00:00Z", read: false },
      { id: "16000000-0000-7000-8000-000000000003", type: "application.submitted", category: "application", title: "LOI submitted", subjectType: "application", subjectId: `app_${I.appClinic}`, message: "Community Clinic Capacity was submitted to Cascade County Health Department.", at: "2027-04-02T15:00:00Z", read: true },
      { id: "16000000-0000-7000-8000-000000000004", type: "tranche.settled", category: "payment", title: "Payment settled · $25,000", subjectType: "award", subjectId: `awd_${I.awardClinic}`, message: "Tranche 1 from Cascade County Health Department reached River City Credit Union •••• 4821.", at: "2026-09-02T17:14:00Z", read: true },
    ],
    otherNotifications: {
      [I.riverbend]: [
        { id: "16000000-0000-7000-8000-000000000011", type: "approval.requested", category: "approval", title: "Riverbend Triage Agent proposes declining 14 applications", subjectType: "approval", subjectId: null, message: "Needs your approval before any letter is sent.", at: "2027-04-20T16:58:00Z", read: false },
        { id: "16000000-0000-7000-8000-000000000012", type: "payee.destination.change_pending", category: "payment", title: "Harbor Light Shelter has a destination change pending", subjectType: "award", subjectId: null, message: "Tranche 2 ($38,000) is held until the change clears in Passport.", at: "2027-04-20T16:00:00Z", read: false },
        { id: "16000000-0000-7000-8000-000000000013", type: "submission.received", category: "submission", title: "Interim report received from Lakeside Senior Center", subjectType: "submission", subjectId: null, message: null, at: "2027-04-19T21:30:00Z", read: true },
      ],
    },
    preferences: { digest: "daily", channels: Object.fromEntries(CATEGORIES.map((c) => [c, { inApp: true, email: c !== "agent" }])) },
    connections: [
      { id: M.connClaude, clientId: "claude-mcp", clientName: "Claude", clientUri: "https://claude.ai", userId: I.maria, mine: true, scopes: ["applications:read", "applications:write", "library:read"], lastUsedAt: "2027-04-19T22:10:00Z", revokedAt: null, createdAt: "2027-03-02T18:00:00Z" },
      { id: M.connSheets, clientId: "board-dashboard", clientName: "Board dashboard sync", clientUri: null, userId: I.jamal, mine: false, scopes: ["awards:read", "requirements:read"], lastUsedAt: "2027-04-18T06:10:00Z", revokedAt: null, createdAt: "2027-01-09T18:00:00Z" },
    ],
  };
}

export interface MockApplicantMoreOptions {
  session: () => Promise<Session | null>;
  /** The applicant mock's store; pass the same instance to both mocks. */
  store?: ApplicantStore;
  more?: MoreStore;
  now?: () => Date;
}

export function createMockApplicantMoreApi(opts: MockApplicantMoreOptions): ApplicantMoreApi {
  const store = opts.store ?? seedApplicantStore();
  const more = opts.more ?? seedMoreStore(store);
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  // Short ids from the design canvas still open the seeded records they stand for.
  const ALIASES: Record<string, string> = { "01HZX4": I.appHealth, "01J2Q7": I.awardHealth };
  const bare = (id: string) => {
    const raw = id.replace(/^[a-z]{3}_/, "");
    return ALIASES[raw] ?? raw;
  };
  async function signedIn() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
  }
  const awardOf = (id: string) => {
    const a = store.awards.find((x) => x.id === `awd_${bare(id)}`);
    if (!a) throw notFound("Award");
    return a;
  };
  const reportForm = (): FormDefinition => store.forms.find((f) => f.id === M.reportForm) ?? REPORT_FORM;
  const latest = (requirementUuid: string) => more.submissions.filter((s) => s.requirementUuid === requirementUuid).at(-1) ?? null;
  const reqOf = (id: string) => {
    const r = more.requirements.find((x) => x.uuid === bare(id));
    if (!r) throw notFound("Requirement");
    return r;
  };
  const subOf = (id: string) => {
    const s = more.submissions.find((x) => x.uuid === bare(id));
    if (!s) throw notFound("Submission");
    return s;
  };
  const checked = (response: JsonObject, provenance: Provenance): Pick<SubmissionForm, "status" | "validationErrors"> => ({
    status: computeResponseStatus(reportForm(), response, provenance),
    validationErrors: validateResponse(reportForm(), response).validationErrors,
  });
  const reqView = (r: ReqRecord): MyRequirement => {
    const award = store.awards.find((a) => a.id === `awd_${r.awardUuid}`);
    const s = latest(r.uuid);
    return {
      id: `req_${r.uuid}`,
      awardId: `awd_${r.awardUuid}`,
      type: r.type,
      title: r.title,
      formId: `frm_${M.reportForm}`,
      formVersion: 1,
      dueAt: r.dueAt,
      status: r.status,
      releasesTrancheId: r.releasesTrancheId,
      submissionId: s ? `sub_${s.uuid}` : null,
      submissionStatus: s?.status ?? null,
      award: award ? { id: award.id, title: award.title } : null,
      funder: award ? { workspaceId: award.funder.workspaceId, name: award.funder.name ?? "Funder", handle: award.funder.handle ?? "", brand: award.funder.brand } : null,
    };
  };
  const subView = (s: SubRecord): Submission => {
    const r = reqOf(s.requirementUuid);
    return clone({
      id: `sub_${s.uuid}`,
      requirementId: `req_${r.uuid}`,
      awardId: `awd_${r.awardUuid}`,
      status: s.status,
      submittedAt: s.submittedAt,
      reviewNote: s.reviewNote,
      requirement: { title: r.title, type: r.type, dueAt: r.dueAt, status: r.status },
      formResponses: [s.form],
    });
  };
  /** Keeps the award's own requirement list (the dashboard reads it) in step. */
  const syncAward = (r: ReqRecord) => {
    const row = store.awards.find((a) => a.id === `awd_${r.awardUuid}`)?.requirements.find((x) => x.id === `req_${r.uuid}`);
    if (row) row.status = r.status;
  };

  return {
    async schedule(awardId) {
      await signedIn();
      const settledWith = (t: { status: string }) => (["settled", "initiated", "releasing"].includes(t.status) ? { bankName: more.payee.bankName, last4: more.payee.last4 } : {});
      return clone(awardOf(awardId).tranches.map((t): ScheduleTranche => ({ ...(t as ScheduleTranche), ...settledWith(t) })));
    },
    async payee() {
      await signedIn();
      return clone(more.payee);
    },
    async budget(awardId) {
      await signedIn();
      const a = awardOf(awardId);
      return clone(more.budgets[bare(a.id)] ?? { awardId: a.id, currency: a.currency, awardedAmountMinor: a.awardedAmountMinor, proposed: null, approved: null, actuals: [] });
    },
    async reportActuals(awardId, input: ActualsInput) {
      await signedIn();
      const a = awardOf(awardId);
      if (!input.periodStart || !input.periodEnd || input.periodStart > input.periodEnd) throw new ApiError(400, "Actuals need a reporting period");
      if (!input.lines.length) throw new ApiError(400, "Add at least one line");
      const book = (more.budgets[bare(a.id)] ??= { awardId: a.id, currency: a.currency, awardedAmountMinor: a.awardedAmountMinor, proposed: null, approved: null, actuals: [] });
      const same = book.actuals.findIndex((b) => b.periodStart === input.periodStart && b.periodEnd === input.periodEnd);
      const saved = { ...budgetView(same >= 0 ? book.actuals[same]!.id : crypto.randomUUID(), "actual", input.lines, [input.periodStart, input.periodEnd]), updatedAt: now() };
      if (same >= 0) book.actuals[same] = saved;
      else book.actuals.push(saved);
      return clone(saved);
    },
    async requestAmendment(awardId, input) {
      await signedIn();
      const a = awardOf(awardId);
      if (!input.reason.trim()) throw new ApiError(400, "Say why the change is needed");
      const amendment: Amendment = { id: crypto.randomUUID(), awardId: a.id, type: input.type, request: { ...(input.request ?? {}), reason: input.reason }, status: "requested", requestedBy: I.maria, decidedBy: null, decidedAt: null, childAwardId: null, createdAt: now() };
      (a.amendments as Amendment[]).push(amendment);
      return clone(amendment);
    },

    async requirements() {
      await signedIn();
      return more.requirements.map(reqView).sort((x, y) => (x.dueAt ?? "").localeCompare(y.dueAt ?? ""));
    },
    async startReport(requirementId) {
      await signedIn();
      const r = reqOf(requirementId);
      if (r.status === "accepted" || r.status === "waived") throw new ApiError(409, `This requirement is ${r.status}`);
      const existing = latest(r.uuid);
      if (existing && existing.status !== "accepted") return subView(existing);
      // Passport first, then the last accepted report on the same grant, each marked with its source.
      const response: JsonObject = { legalName: store.organization.displayName };
      const provenance: Record<string, string> = { "/legalName": "passport" };
      const prior = more.submissions.filter((s) => s.status === "accepted" && reqOf(s.requirementUuid).awardUuid === r.awardUuid).at(-1);
      for (const [key, value] of Object.entries(prior?.form.response ?? {})) {
        if (key in response || key === "certified") continue;
        response[key] = value;
        provenance[`/${key}`] = "prior_submission";
      }
      const s: SubRecord = { uuid: crypto.randomUUID(), requirementUuid: r.uuid, status: "draft", submittedAt: null, reviewNote: null, sharedWith: [], form: { formId: `frm_${M.reportForm}`, formVersion: 1, response, provenance, lockedAt: null, ...checked(response, provenance as Provenance) } };
      more.submissions.push(s);
      return subView(s);
    },
    async submission(id) {
      await signedIn();
      return subView(subOf(id));
    },
    async saveReportForm(submissionId, formId, patch) {
      await signedIn();
      const s = subOf(submissionId);
      if (bare(formId) !== M.reportForm) throw notFound("Form");
      if (s.status === "returned") s.status = "draft";
      if (s.status !== "draft") throw new ApiError(409, `This report is ${s.status.replace(/_/g, " ")} and can no longer be edited`);
      const merged = mergeResponse(s.form.response, patch, { provenance: s.form.provenance as Provenance, actor: "user", lockedPaths: passportFieldPaths(reportForm()) });
      s.form = { ...s.form, response: merged.response, provenance: merged.provenance as Record<string, string>, lockedAt: null, ...checked(merged.response, merged.provenance) };
      return clone({ ...s.form, rejected: merged.rejected });
    },
    async submitReport(submissionId) {
      await signedIn();
      const s = subOf(submissionId);
      if (s.status === "returned") s.status = "draft";
      if (s.status !== "draft") throw new ApiError(409, "This report was already submitted");
      const errors = validateResponse(reportForm(), s.form.response).validationErrors;
      if (errors.length) throw new ApiError(422, "The report is not complete", errors.map((e) => ({ path: `${s.form.formId}${e.field}`, field: e.field, message: e.message, detail: e.message })));
      s.status = "submitted";
      s.submittedAt = now();
      s.form.lockedAt = s.submittedAt;
      const r = reqOf(s.requirementUuid);
      r.status = "submitted";
      syncAward(r);
      return subView(s);
    },
    async shareReport(submissionId, input) {
      await signedIn();
      const s = subOf(submissionId);
      if (s.status !== "accepted") throw new ApiError(409, "Only an accepted report can be shared");
      if (!!input.funderWorkspaceId === !!input.funderHandle) throw new ApiError(400, "Name the funder by workspace id or by handle");
      const entry = Object.entries(store.funders).find(([id, f]) => id === input.funderWorkspaceId || f.handle === input.funderHandle);
      if (!entry) throw notFound("Funder");
      const [workspaceId, funder] = entry;
      const award = awardOf(reqOf(s.requirementUuid).awardUuid);
      if (award.funder.workspaceId === workspaceId) throw new ApiError(409, "This funder already has the report");
      if (s.sharedWith.includes(workspaceId)) throw new ApiError(409, "This report is already shared with that funder");
      s.sharedWith.push(workspaceId);
      if (!store.consents.some((c) => c.funder.workspaceId === workspaceId && c.basis === "shared_submission" && !c.revokedAt)) {
        store.consents.push({ id: crypto.randomUUID(), funder: { workspaceId, name: funder.name, handle: funder.handle }, basis: "shared_submission", scopes: ["submission:read"], grantedAt: now(), revokedAt: null });
      }
      return { sharedSubmissionId: `sub_${crypto.randomUUID()}`, funder: { workspaceId, name: funder.name, handle: funder.handle }, fields: input.fields ?? "all" };
    },

    async sectionAssignments(applicationId) {
      await signedIn();
      const a = store.applications.find((x) => x.uuid === bare(applicationId));
      if (!a) throw notFound("Application");
      return clone(a.forms.map((f) => ({ formId: f.formId, sections: a.sections[f.formId] ?? {} })));
    },
    async insertAnswer(applicationId, formId, input) {
      await signedIn();
      const a = store.applications.find((x) => x.uuid === bare(applicationId));
      if (!a) throw notFound("Application");
      const f = a.forms.find((x) => x.formId === bare(formId));
      const answer = store.answers.find((x) => x.id === input.answerId);
      if (!f) throw notFound("Form");
      if (!answer) throw notFound("Answer");
      if (f.lockedAt) throw new ApiError(409, "This form is locked");
      const key = input.path.replace(/^\//, "");
      if (!key || key.includes("/")) throw new ApiError(400, "Name a top-level field");
      f.response = { ...f.response, [key]: answer.body };
      f.provenance = { ...f.provenance, [input.path]: "library" };
      f.lastModifiedAt = now();
      const def = store.forms.find((x) => x.id === f.formId && x.version === f.version);
      if (def) {
        f.status = computeResponseStatus(def, f.response, f.provenance as Provenance) as AppForm["status"];
        f.validationErrors = validateResponse(def, f.response).validationErrors;
      }
      const used = (answer.usedIn ??= []) as { applicationId: string; formId: string; path: string; version: number; insertedAt: string; title?: string }[];
      if (!used.some((u) => u.applicationId === `app_${a.uuid}` && u.path === input.path)) used.push({ applicationId: `app_${a.uuid}`, formId: `frm_${f.formId}`, path: input.path, version: answer.version, insertedAt: now(), title: a.title });
      return clone(f);
    },

    async notifications(o = {}) {
      await signedIn();
      const all = o.workspaceId && o.workspaceId !== I.workspace ? (more.otherNotifications[o.workspaceId] ?? []) : more.notifications;
      const visible = all.filter((n) => more.preferences.channels[n.category]?.inApp !== false).sort((x, y) => y.at.localeCompare(x.at));
      return clone({ unread: visible.filter((n) => !n.read).length, items: o.unread ? visible.filter((n) => !n.read) : visible });
    },
    async markRead(input, workspaceId) {
      await signedIn();
      const all = workspaceId && workspaceId !== I.workspace ? (more.otherNotifications[workspaceId] ?? []) : more.notifications;
      for (const n of all) if ("all" in input || input.ids.includes(n.id)) n.read = true;
      return { unread: all.filter((n) => !n.read && more.preferences.channels[n.category]?.inApp !== false).length };
    },
    async notificationPreferences() {
      await signedIn();
      return clone(more.preferences);
    },
    async saveNotificationPreferences(prefs) {
      await signedIn();
      more.preferences = { digest: prefs.digest, channels: { ...more.preferences.channels, ...clone(prefs.channels) } };
      return clone(more.preferences);
    },
    async connections(workspaceId) {
      await signedIn();
      if (workspaceId && workspaceId !== I.workspace) return [];
      return clone(more.connections.filter((c) => !c.revokedAt));
    },
    async revokeConnection(id) {
      await signedIn();
      const c = more.connections.find((x) => x.id === id && !x.revokedAt);
      if (!c) throw notFound("MCP connection");
      c.revokedAt = now();
      return { revoked: true };
    },
  };
}
