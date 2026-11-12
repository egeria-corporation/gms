// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of the funder working routes (api/funder.ts). The seed is the Community
// Health Grants 2027 cycle from the design canvas: applications at both stages, reviews under way,
// one award waiting for the funder's countersignature, and one agent proposal awaiting approval.
// It follows the Worker's rules where a screen depends on them: a reviewer declares conflicts
// before scoring, the allocator refuses over-allocation without an override, and an agreement is
// countersigned only after the grantee has signed.
import type {
  Agreement,
  Allocation,
  Amendment,
  ApplicationEvent,
  Approval,
  AwardDetail,
  ConsentRequest,
  Decision,
  FunderApi,
  InboxApplication,
  InboxFormResponse,
  Ranking,
  RankingRow,
  Review,
  ReviewAssignment,
  SentCommunication,
  Task,
  Template,
  Thread,
} from "../api/funder.ts";
import type { Rubric } from "../api/types.ts";
import { MOCK_USER } from "./fixtures.ts";
import { LOI_PROVENANCE, LOI_RESPONSE } from "./forms.ts";
import { IDS, type WorkspaceData } from "./store.ts";
import { verificationOf, withVerification } from "../lib/profile.ts";

export const USERS = {
  dana: MOCK_USER.userId,
  marcus: "10000000-0000-4000-8000-000000000002",
  priya: "10000000-0000-4000-8000-000000000003",
  hollis: "10000000-0000-4000-8000-000000000004",
} as const;
export const USER_NAMES: Record<string, string> = {
  [USERS.dana]: "Dana Ortiz",
  [USERS.marcus]: "Marcus Lee",
  [USERS.priya]: "Priya Natarajan",
  [USERS.hollis]: "Dr. Hollis Grant",
};

const appId = (n: number) => `app_a0000000-0000-7000-8000-00000000000${n}`;
const uid = (prefix: string, n: number) => `${prefix}0000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
export const MOCK_IDS = {
  alder: appId(1),
  harbor: appId(2),
  copper: appId(3),
  northgate: appId(4),
  lakeside: appId(5),
  pineRidge: appId(6),
  meadowbrook: appId(7),
  award: "awd_b0000000-0000-7000-8000-000000000001",
  agreement: "agr_c0000000-0000-7000-8000-000000000001",
  approval: "apr_d0000000-0000-7000-8000-000000000001",
  danaAssignment: uid("e", 7),
  danaScoring: uid("e", 8),
} as const;

const at = (d: string) => `${d}:00Z`;
const clone = <T>(v: T): T => structuredClone(v);

interface MockError extends Error {
  status: number;
}
export interface MockFunderCtx {
  /** The funder workspace the caller is acting in. */
  ws: () => Promise<WorkspaceData>;
  now: () => string;
  fail: (status: number, message: string, errors?: unknown[]) => Error;
}

interface State {
  applications: InboxApplication[];
  assignments: ReviewAssignment[];
  reviews: { assignmentId: string; scores: Record<string, number | string>; narrative: string | null; recommendation: string | null; submittedAt: string | null }[];
  decisions: Decision[];
  awards: AwardDetail[];
  agreements: Agreement[];
  templates: Template[];
  communications: SentCommunication[];
  approvals: Approval[];
  threads: Thread[];
  tasks: Task[];
}

function application(n: number, name: string, handle: string, title: string, stage: string, status: InboxApplication["status"], eligibility: boolean | "unknown", level: "L0" | "L1" | "L2" | "L3", dollars: number, more: Partial<InboxApplication> = {}): InboxApplication {
  return {
    id: appId(n),
    title,
    competitionId: IDS.compHealth27,
    opportunityId: IDS.oppHealth27,
    stage,
    status,
    eligibility,
    requestedAmountMinor: dollars * 100,
    currency: "USD",
    tags: [],
    assignedToUserId: null,
    submittedAt: at(stage === "loi" ? "2027-02-21T17:10" : "2027-04-16T16:42"),
    verificationLevelAtSubmit: level,
    // One fixture applicant has no Passport record: its details are its own, and funders see "Not verified".
    applicant: withVerification({ workspaceId: uid("2", 10 + n), name, handle, level }, handle === "meadowbrook" ? { source: "self_declared", level: null } : { source: "passport", level }),
    updatedAt: at("2027-04-18T09:00"),
    ...more,
  };
}

const TEMPLATE_DECLINE = `Dear {{recipient.name}},

Thank you for submitting “{{application.title}}” to {{opportunity.title}}. After review, {{funder.name}} will not be advancing this application to the next stage.

{{decision.message}}

We encourage you to review eligibility for our other open opportunities and to apply again in a future cycle. You can see this application and its status at {{links.application}}.

Sincerely,
Dana Ortiz
Program Officer, {{funder.name}}`;

const fieldsOf = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
const template = (id: string, kind: Template["kind"], name: string, subject: string | null, body: string, builtIn: boolean): Template => ({ id, kind, name, version: builtIn ? 1 : 3, subject, body, fields: fieldsOf(`${subject ?? ""}\n${body}`), shared: builtIn, builtIn, createdAt: at("2027-01-06T10:00") });

function seed(): State {
  const applications = [
    application(1, "Alder Creek Family Services", "alder-creek", "Mobile Health Navigation for Rural Families", "full", "accepted", true, "L3", 150_000, { tags: ["rural", "returning grantee"], assignedToUserId: USERS.dana }),
    application(2, "Harbor Light Shelter", "harbor-light", "Shelter Health Liaison", "full", "under_review", true, "L3", 120_000, { assignedToUserId: USERS.dana }),
    application(3, "Copper Valley Clinic", "copper-valley", "Telehealth Access Rooms", "full", "screening", "unknown", "L1", 90_000, { tags: ["needs screening"] }),
    application(4, "Northgate Housing Trust", "northgate", "Healthy Homes Visits", "full", "under_review", true, "L2", 110_000),
    application(5, "Lakeside Senior Center", "lakeside-senior", "Senior Wellness Navigators", "full", "submitted", true, "L2", 85_000, { tags: ["needs screening"] }),
    application(6, "Pine Ridge Youth Alliance", "pine-ridge", "After-School Clinic Shuttle", "loi", "submitted", false, "L0", 60_000),
    application(7, "Meadowbrook Food Bank", "meadowbrook", "Nutrition Counseling Pilot", "loi", "submitted", false, "L1", 45_000),
    application(8, "Riverside Arts Collective", "riverside-arts", "Arts for Wellness", "loi", "declined", false, "L1", 30_000),
    application(9, "Willow Bend Community Clinic", "willow-bend", "Community Health Worker Corps", "loi", "submitted", true, "L3", 95_000, { tags: ["rural"] }),
  ];
  const assignment = (n: number, app: string, title: string, reviewer: string, status: ReviewAssignment["status"], overall: number | null): ReviewAssignment => ({
    id: uid("e", n),
    applicationId: app,
    applicationTitle: title,
    competitionId: IDS.compHealth27,
    stage: "full",
    reviewerUserId: reviewer,
    rubricId: IDS.rubricFull,
    rubricVersion: 2,
    dueAt: at("2027-04-23T23:59"),
    status,
    coi: { declared: status === "assigned" ? null : false, reason: null },
    review: overall === null ? null : { id: `rev_${uid("f", n)}`, submittedAt: at("2027-04-19T15:30"), overall, complete: true },
    createdAt: at("2027-04-17T10:00"),
  });
  const title = (id: string) => applications.find((a) => a.id === id)!.title;
  const assignments = [
    assignment(1, MOCK_IDS.alder, title(MOCK_IDS.alder), USERS.priya, "submitted", 87.5),
    assignment(2, MOCK_IDS.alder, title(MOCK_IDS.alder), USERS.marcus, "submitted", 78.75),
    assignment(3, MOCK_IDS.harbor, title(MOCK_IDS.harbor), USERS.priya, "submitted", 75),
    assignment(4, MOCK_IDS.harbor, title(MOCK_IDS.harbor), USERS.marcus, "in_progress", null),
    assignment(5, MOCK_IDS.northgate, title(MOCK_IDS.northgate), USERS.priya, "submitted", 81.25),
    assignment(6, MOCK_IDS.northgate, title(MOCK_IDS.northgate), USERS.marcus, "submitted", 50),
    assignment(7, MOCK_IDS.lakeside, title(MOCK_IDS.lakeside), USERS.dana, "assigned", null),
    assignment(8, MOCK_IDS.harbor, title(MOCK_IDS.harbor), USERS.dana, "coi_declared", null),
  ];
  const scores = (impact: number, feasibility: number, budget: number, equity: number) => ({ impact, feasibility, budget, equity });
  const review = (n: number, s: Record<string, number>, narrative: string, recommendation: string) => ({ assignmentId: uid("e", n), scores: s, narrative, recommendation, submittedAt: at("2027-04-19T15:30") });
  const reviews = [
    review(1, scores(5, 4, 4, 5), "Strong evidence of need and a credible route plan. The evaluation section could name its data source.", "Fund"),
    review(2, scores(4, 4, 4, 5), "Budget is reasonable. Indirect is at the cap.", "Fund"),
    review(3, scores(4, 4, 4, 4), "Good partnership with the county clinic.", "Fund with conditions"),
    review(5, scores(5, 4, 4, 4), "Well-targeted home visits.", "Fund"),
    review(6, scores(3, 3, 3, 3), "Staffing plan depends on two hires that are not yet funded.", "Do not fund"),
  ];
  const decisions: Decision[] = [
    { id: uid("9", 1), competitionId: IDS.compHealth27, applicationId: MOCK_IDS.alder, stage: "full", outcome: "approve", amountMinor: 15_000_000, currency: "USD", conditions: [], rationale: "Top-ranked; full request.", letterTemplateId: null, proposedBy: `user:${USERS.dana}`, decidedBy: USERS.dana, committedAt: at("2027-05-18T17:00"), createdAt: at("2027-05-18T16:40") },
  ];
  const agreements: Agreement[] = [
    { id: MOCK_IDS.agreement, version: 1, status: "signed_by_grantee", documentSha256: "7e2b6c1d9f0a4b3e8c5d2a1f6e7b9c0d3a4f5e6b7c8d9e0f1a2b3c4d5e6f40af", granteeSignedAt: at("2027-05-21T18:12"), funderSignedAt: null, executedAt: null, awardId: MOCK_IDS.award, templateId: null, granteeSignature: { name: "Maria Santos", at: at("2027-05-21T18:12") }, funderSignature: null, hasStoredPdf: true, createdAt: at("2027-05-19T09:00") },
  ];
  const awards: AwardDetail[] = [
    {
      id: MOCK_IDS.award,
      title: "Mobile Health Navigation for Rural Families",
      description: "Community Health Grants 2027",
      status: "accepted",
      currency: "USD",
      requestedAmountMinor: 15_000_000,
      awardedAmountMinor: 15_000_000,
      disbursedAmountMinor: 0,
      disbursedAt: null,
      keyDates: { periodOfPerformance: { startDate: "2027-07-01", endDate: "2028-06-30" } },
      conditions: [],
      applicationId: MOCK_IDS.alder,
      opportunityId: IDS.oppHealth27,
      programId: IDS.programHealth27,
      parentAwardId: null,
      funder: { workspaceId: IDS.riverbend, name: "Riverbend Community Foundation", handle: "riverbend", brand: null },
      recipient: withVerification({ workspaceId: uid("2", 11), name: "Alder Creek Family Services", handle: "alder-creek", level: "L3" }, { source: "passport", level: "L3" }),
      recipientIndividual: null,
      passport: { awardId: null, syncedAt: null, mirror: "pending" },
      createdAt: at("2027-05-18T17:00"),
      updatedAt: at("2027-05-21T18:12"),
      agreement: null,
      tranches: [
        { id: `trn_${uid("a", 1)}`, seq: 1, amountMinor: 7_500_000, currency: "USD", condition: { type: "onExecution" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
        { id: `trn_${uid("a", 2)}`, seq: 2, amountMinor: 6_000_000, currency: "USD", condition: { type: "onReportAccepted" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
        { id: `trn_${uid("a", 3)}`, seq: 3, amountMinor: 1_500_000, currency: "USD", condition: { type: "onReportAccepted" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
      ],
      requirements: [{ id: `req_${uid("a", 4)}`, type: "report", title: "Interim report", formId: null, dueAt: at("2027-12-15T23:59"), status: "scheduled", releasesTrancheId: `trn_${uid("a", 2)}` }],
      amendments: [],
    },
  ];
  const templates = [
    template("builtin:decline", "email", "Standard decline", "Your application to {{opportunity.title}}", TEMPLATE_DECLINE, true),
    template("builtin:award_letter", "letter", "Award letter", null, "Dear {{recipient.name}},\n\n{{funder.name}} is pleased to award {{award.amount}} for “{{award.title}}”.\n\nThe grant agreement follows for signature.", true),
    template("builtin:agreement", "agreement", "Standard grant agreement", null, "Grant Agreement\n\n1. Parties. {{funder.name}} and {{recipient.name}}.\n2. Purpose and amount. {{award.amount}} for {{award.title}}.\n3. Term. {{award.startDate}} to {{award.endDate}}.", true),
    // Like the real built-in reminder: it uses requirement fields, which only the built-in templates name.
    template("builtin:report_reminder", "email", "Report reminder", "{{requirement.title}} is due {{requirement.dueDate}}", "Hello {{recipient.name}},\n\n{{requirement.title}} for “{{award.title}}” is due {{requirement.dueDate}}.\n\n{{funder.name}}", true),
    template(uid("7", 3), "email", "Standard decline v3", "Your application to {{opportunity.title}}", TEMPLATE_DECLINE, false),
  ];
  const sent = (subjectId: string, templateName: string, when: string, status: "sent" | "failed" = "sent"): SentCommunication => ({ status, subjectType: "application", subjectId, template: "builtin:decline", templateName, batch: null, actor: `user:${USERS.dana}`, at: at(when) });
  const approvals: Approval[] = [
    {
      id: MOCK_IDS.approval,
      workspaceId: IDS.riverbend,
      side: "funder",
      tool: "decline_application",
      scope: "applications:write",
      description: "Decline an application and send the decline letter",
      requestedBy: { userId: USERS.dana, clientId: "Riverbend Triage Agent" },
      input: { applicationIds: [MOCK_IDS.pineRidge, MOCK_IDS.meadowbrook], letterTemplateId: uid("7", 3), rationale: "Eligibility: outside the service area." },
      status: "pending",
      createdAt: at("2027-04-20T09:02"),
    },
    { id: `apr_${uid("d", 2)}`, workspaceId: IDS.riverbend, side: "funder", tool: "send_communication", scope: "communications:write", description: "Send a templated message", requestedBy: { userId: USERS.dana, clientId: "Riverbend Triage Agent" }, input: { templateId: "builtin:decline", recipients: 3 }, status: "executed", createdAt: at("2027-04-12T11:00"), decidedBy: USERS.dana, decidedAt: at("2027-04-12T11:20"), note: "Reviewed all three." },
    { id: `apr_${uid("d", 3)}`, workspaceId: IDS.riverbend, side: "funder", tool: "commit_decisions", scope: "decisions:write", description: "Commit panel decisions", requestedBy: { userId: USERS.marcus, clientId: "Finance Agent" }, input: { competitionId: IDS.compHealth27 }, status: "rejected", createdAt: at("2027-04-08T14:00"), decidedBy: USERS.dana, decidedAt: at("2027-04-08T14:30"), note: "Decisions are committed by the panel chair." },
  ];
  const threads: Thread[] = [
    { id: uid("5", 1), subjectType: "application", subjectId: MOCK_IDS.alder, visibility: "shared", title: null, messages: [{ id: uid("6", 1), author: "Maria Santos", authorUserId: null, body: "We have attached the revised budget with indirect at the 10% cap.", createdAt: at("2027-04-17T15:20") }, { id: uid("6", 2), author: "Dana Ortiz", authorUserId: USERS.dana, body: "Thanks for the revised budget. A source for the county assessment would help the Feasibility criterion if you have it.", createdAt: at("2027-04-18T09:05") }], updatedAt: at("2027-04-18T09:05") },
    { id: uid("5", 2), subjectType: "application", subjectId: MOCK_IDS.alder, visibility: "funder_internal", title: null, messages: [{ id: uid("6", 3), author: "Marcus Lee", authorUserId: USERS.marcus, body: "FY2026 financials show a thin cash reserve. Fine for tranche 1, worth a condition on tranche 2.", createdAt: at("2027-04-18T11:40") }], updatedAt: at("2027-04-18T11:40") },
  ];
  const task = (n: number, title: string, dueAt: string | null, subjectId: string | null = null): Task => ({ id: uid("4", 20 + n), subjectType: subjectId ? "application" : null, subjectId, title, assigneeUserId: USERS.dana, dueAt, doneAt: null, createdAt: at("2027-04-15T09:00") });
  return {
    applications,
    assignments,
    reviews,
    decisions,
    awards,
    agreements,
    templates,
    communications: [sent(appId(8), "Standard decline", "2027-03-02T10:00"), sent(MOCK_IDS.alder, "Award letter", "2027-05-19T09:05")],
    approvals,
    threads,
    tasks: [
      task(1, "Screen 2 applications in “Needs screening”", at("2027-04-20T23:59")),
      task(2, "Review the Triage Agent’s proposed declines", at("2027-04-21T23:59")),
      task(3, "Assign a 2nd reviewer to Lakeside Senior Center", at("2027-04-22T23:59"), MOCK_IDS.lakeside),
      task(4, "Countersign the Alder Creek agreement (signed by grantee)", at("2027-04-23T23:59")),
      task(5, "Reply to Maria Santos on the county assessment source", null, MOCK_IDS.alder),
    ],
  };
}

/** Weighted rubric score, 0–100: numeric criteria are normalized to their scale, categorical ones use the option's score. */
/** How the mock full proposal splits its requested amount across budget categories. */
const MOCK_BUDGET_SHARES: [string, string, number][] = [
  ["personnel", "Personnel", 0.64],
  ["travel", "Travel & vehicle", 0.19],
  ["supplies", "Supplies", 0.07],
  ["indirect", "Indirect (10% cap)", 0.1],
];

export function overallOf(rubric: Rubric, scores: Record<string, unknown>): { overall: number | null; missing: string[] } {
  let total = 0;
  let weight = 0;
  const missing: string[] = [];
  for (const c of rubric.criteria) {
    const raw = scores[c.key];
    const v = raw !== null && typeof raw === "object" ? (raw as { value?: unknown }).value : raw;
    let unit: number | null = null;
    if (c.scale.type === "numeric" && typeof v === "number") unit = (v - c.scale.min) / (c.scale.max - c.scale.min || 1);
    if (c.scale.type === "categorical") unit = c.scale.options.find((o) => o.value === v)?.score ?? null;
    if (unit === null) missing.push(c.key);
    else total += unit * c.weight;
    weight += c.weight;
  }
  return { overall: missing.length || !weight ? null : Math.round((total / weight) * 10000) / 100, missing };
}

export function createMockFunderApi(ctx: MockFunderCtx): FunderApi {
  const states = new Map<string, State>();
  const empty = (): State => ({ applications: [], assignments: [], reviews: [], decisions: [], awards: [], agreements: [], templates: seed().templates.filter((t) => t.builtIn), communications: [], approvals: [], threads: [], tasks: [] });
  async function st(): Promise<{ w: WorkspaceData; s: State }> {
    const w = await ctx.ws();
    if (!states.has(w.record.id)) states.set(w.record.id, w.record.id === IDS.riverbend ? seed() : empty());
    return { w, s: states.get(w.record.id)! };
  }
  const missing = (what: string) => ctx.fail(404, `${what} not found`) as MockError;
  const find = <T extends { id: string }>(rows: T[], id: string, what: string): T => {
    const row = rows.find((r) => r.id === id || r.id.replace(/^[a-z]{3}_/, "") === id);
    if (!row) throw missing(what);
    return row;
  };
  const me = USERS.dana;
  let seq = 100;
  const newId = (prefix = "") => `${prefix}${uid("c", ++seq)}`;

  const rubricOf = (w: WorkspaceData, id: string) => w.rubrics.find((r) => r.id === id)!;
  const stageOf = (w: WorkspaceData, competitionId: string, key?: string) => {
    const comp = find(w.competitions, competitionId, "Competition");
    const stage = key ? comp.stages.find((x) => x.key === key) : comp.stages[comp.stages.length - 1];
    if (!stage) throw ctx.fail(422, "This competition has no such stage");
    return { comp, stage };
  };

  function events(a: InboxApplication): ApplicationEvent[] {
    const ev = (n: number, type: string, toStatus: string | null, when: string, actor: string, message: string | null = null): ApplicationEvent => ({ id: uid("8", n), type, fromStatus: null, toStatus, fromStage: null, toStage: null, actor, at: at(when), message });
    return [ev(1, "application.submitted", "submitted", "2027-02-21T17:10", "user:applicant", "LOI submitted"), ...(a.stage === "full" ? [ev(2, "application.advanced", "draft", "2027-03-08T09:00", `user:${USERS.dana}`, "Advanced to Full proposal"), ev(3, "application.submitted", "submitted", "2027-04-16T16:42", "user:applicant", "Full proposal submitted")] : [])];
  }
  function detail(w: WorkspaceData, s: State, a: InboxApplication): InboxApplication {
    const stage = w.competitions[0]?.stages.find((x) => x.key === a.stage);
    const formResponses: InboxFormResponse[] = Object.entries(stage?.forms ?? {}).map(([formId, formVersion]) => ({
      formId,
      formVersion,
      formTitle: w.forms.find((f) => f.id === formId && f.version === formVersion)?.title ?? null,
      stage: a.stage,
      status: "complete",
      response: formId === IDS.formLoi ? clone(LOI_RESPONSE) : { approach: "Two navigators cover a weekly route of six stops.", outcomes: "240 families connected to a primary care provider.", requestedAmount: { amount: String((a.requestedAmountMinor ?? 0) / 100), currency: "USD" }, budget: MOCK_BUDGET_SHARES.map(([category, label, share]) => ({ category, label, amount: { amount: String(Math.round(((a.requestedAmountMinor ?? 0) / 100) * share)), currency: "USD" } })), attachments: [{ passportDocumentId: "doc_mock_determination", name: "IRS determination letter.pdf", sha256: "3f9a0000000000000000000000000000000000000000000000000000000c21e" }, { documentId: "doc_mock_financials", name: "FY2026 audited financials.xlsx", sha256: "8b100000000000000000000000000000000000000000000000000000000077d4" }] },
      provenance: formId === IDS.formLoi ? { ...LOI_PROVENANCE } : {},
      validationErrors: [],
      lockedAt: a.submittedAt,
      masked: [],
    }));
    const rule = (label: string, outcome: "pass" | "fail" | "unknown", explain: string) => ({ rule: {}, label, outcome, explain });
    return {
      ...clone(a),
      attestationUrl: a.applicant.level === "L3" ? "https://passport.opengrants.io/attestations/att_example" : null,
      eligibilityResults: {
        eligible: a.eligibility ?? "unknown",
        results: [
          rule("501(c)(3) in good standing", a.eligibility === false ? "pass" : "pass", "IRS subsection 03"),
          rule("Serves Riverbend County", a.eligibility === false ? "fail" : "pass", a.eligibility === false ? "Primary address is outside the service area" : "Primary address in OR"),
          rule("Annual budget under $5M", a.eligibility === "unknown" ? "unknown" : "pass", a.eligibility === "unknown" ? "Budget is not in the Passport profile" : "$2.4M (FY2026)"),
        ],
      },
      decisionId: s.decisions.find((d) => d.applicationId === a.id)?.id ?? null,
      organization: { projection: { id: a.applicant.workspaceId, name: a.applicant.name ?? "", orgType: { term: "Nonprofit", class: "Organization types", code: "EA000000" }, addresses: { primary: { street1: "418 Mill Road", city: "Alder Creek", stateOrProvince: "OR", country: "US", postalCode: "97000" } }, identifiers: { "org:us:ein": { id: "001234567" } }, mission: "Health navigation and family support for rural households." } as never, level: a.applicant.level, verifiedAt: at("2027-01-12T17:20"), syncedAt: at("2027-04-20T08:58"), levelChangedSinceSubmit: false },
      formResponses,
      timeline: events(a),
    };
  }

  function assertRole(a: ReviewAssignment) {
    if (a.reviewerUserId !== me) throw ctx.fail(403, "Only the assigned reviewer can score this application");
  }
  function reviewView(w: WorkspaceData, s: State, a: ReviewAssignment): Review | null {
    const r = s.reviews.find((x) => x.assignmentId === a.id);
    if (!r) return null;
    const rubric = rubricOf(w, a.rubricId);
    return { id: `rev_${a.id}`, assignmentId: a.id, applicationId: a.applicationId, stage: a.stage, reviewerUserId: a.reviewerUserId, own: a.reviewerUserId === me, scores: r.scores, normalized: {}, overall: overallOf(rubric, r.scores).overall, narrative: r.narrative, recommendation: r.recommendation, visibility: "panel", submittedAt: r.submittedAt };
  }

  const committedMinor = (s: State, programId: string | null) => s.awards.filter((a) => a.programId === programId && a.status !== "cancelled").reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0);
  function allocation(w: WorkspaceData, s: State, competitionId: string): Allocation {
    const comp = find(w.competitions, competitionId, "Competition");
    const program = w.programs.find((p) => p.id === w.opportunities.find((o) => o.id === comp.opportunityId)?.programId) ?? null;
    const committed = committedMinor(s, program?.id ?? null);
    const proposed = s.decisions.filter((d) => d.competitionId === comp.id && !d.committedAt && d.outcome === "approve").reduce((n, d) => n + (d.amountMinor ?? 0), 0);
    const budget = program?.budgetAmountMinor ?? null;
    const available = budget === null ? null : budget - committed - proposed;
    return { programId: program?.id ?? null, currency: "USD", budgetMinor: budget, committedMinor: committed, proposedMinor: proposed, availableMinor: available, over: available !== null && available < 0, overByMinor: available !== null && available < 0 ? -available : 0 };
  }

  function ranking(w: WorkspaceData, s: State, competitionId: string, stageKey?: string): Ranking {
    const { comp, stage } = stageOf(w, competitionId, stageKey);
    const rubric = rubricOf(w, stage.rubricId ?? "");
    const rows: RankingRow[] = s.applications
      .filter((a) => a.competitionId === comp.id && a.stage === stage.key && a.status !== "draft" && a.status !== "withdrawn")
      .map((a) => {
        const mine = s.assignments.filter((x) => x.applicationId === a.id && x.stage === stage.key && x.status !== "recused");
        const overalls = mine.flatMap((x) => (x.status === "submitted" && x.review?.overall !== null && x.review ? [{ reviewerId: x.reviewerUserId, overall: x.review.overall! }] : []));
        const xs = overalls.map((o) => o.overall).sort((p, q) => p - q);
        const n = xs.length;
        const mean = n ? xs.reduce((p, q) => p + q, 0) / n : null;
        const median = n ? (n % 2 ? xs[(n - 1) / 2]! : (xs[n / 2 - 1]! + xs[n / 2]!) / 2) : null;
        const stdev = n > 1 && mean !== null ? Math.sqrt(xs.reduce((p, q) => p + (q - mean) ** 2, 0) / (n - 1)) : n === 1 ? 0 : null;
        const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
        const d = s.decisions.find((x) => x.applicationId === a.id);
        return { applicationId: a.id, title: a.title, applicant: a.applicant.name, status: a.status, rank: null, n, mean: round(mean), median: round(median), stdev: round(stdev), spreadFlag: stdev !== null && stdev > (rubric?.overall.spreadThreshold ?? 15), overalls, incomplete: [], requestedAmountMinor: a.requestedAmountMinor, currency: a.currency, assigned: mine.length, pending: mine.filter((x) => x.status !== "submitted").length, decision: d ? { id: d.id, outcome: d.outcome, amountMinor: d.amountMinor, committed: !!d.committedAt } : null };
      })
      .sort((p, q) => (q.mean ?? -1) - (p.mean ?? -1));
    let rank = 0;
    for (const r of rows) if (r.mean !== null) r.rank = ++rank;
    return { competitionId: comp.id, stage: stage.key, rubric: { id: rubric?.id ?? "", version: rubric?.version ?? 1, name: rubric?.name ?? "" }, items: rows };
  }

  function awardView(s: State, a: AwardDetail): AwardDetail {
    const g = s.agreements.find((x) => x.awardId === a.id && x.status !== "voided");
    return { ...clone(a), agreement: g ? { id: g.id, version: g.version, status: g.status, documentSha256: g.documentSha256, granteeSignedAt: g.granteeSignedAt, funderSignedAt: g.funderSignedAt, executedAt: g.executedAt } : null };
  }

  function render(w: WorkspaceData, s: State, t: Template, input: { applicationId?: string; awardId?: string; fields?: Record<string, unknown> }) {
    const a = input.applicationId ? find(s.applications, input.applicationId, "Application") : undefined;
    const aw = input.awardId ? find(s.awards, input.awardId, "Award") : undefined;
    const values: Record<string, unknown> = {
      "funder.name": w.record.displayName,
      "links.application": a ? `https://gms.opengrants.io/applications/${a.id}` : undefined,
      "opportunity.title": w.opportunities[0]?.title,
      "recipient.name": a?.applicant.name ?? aw?.recipient?.name,
      "application.title": a?.title,
      "award.title": aw?.title,
      "award.amount": aw ? `$${((aw.awardedAmountMinor ?? 0) / 100).toLocaleString("en-US")}` : undefined,
    };
    // Callers pass merge fields nested (`{ decision: { message } }`), as the Worker takes them.
    const flatten = (prefix: string, v: unknown) => {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x);
      else values[prefix] = v;
    };
    flatten("", input.fields ?? {});
    const missingFields: { field: string }[] = [];
    const fill = (text: string) =>
      text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
        if (values[key] === undefined || values[key] === "") {
          missingFields.push({ field: key });
          return "";
        }
        return String(values[key]);
      });
    const out = { templateId: t.id, kind: t.kind, subject: t.subject ? fill(t.subject) : null, text: fill(t.body), html: null };
    if (missingFields.length) throw ctx.fail(422, `Missing merge fields: ${[...new Set(missingFields.map((m) => m.field))].join(", ")}`, missingFields);
    return out;
  }

  function decline(s: State, a: InboxApplication, templateName: string | null) {
    if (["declined", "accepted", "withdrawn", "draft"].includes(a.status)) throw ctx.fail(409, `This application is ${a.status.replace(/_/g, " ")}`);
    a.status = "declined";
    a.updatedAt = ctx.now();
    if (templateName) s.communications.unshift({ status: "sent", subjectType: "application", subjectId: a.id, template: null, templateName, batch: null, actor: `user:${me}`, at: ctx.now() });
  }

  return {
    async listApplications(filter = {}) {
      const { s } = await st();
      const want = (a: InboxApplication) =>
        (!filter.competitionId || a.competitionId === filter.competitionId) &&
        (!filter.stage || a.stage === filter.stage) &&
        (!filter.eligibility || String(a.eligibility) === filter.eligibility) &&
        (!filter.level || a.verificationLevelAtSubmit === filter.level) &&
        (!filter.tag || a.tags.includes(filter.tag)) &&
        (!filter.assignee || (filter.assignee === "unassigned" ? !a.assignedToUserId : a.assignedToUserId === filter.assignee)) &&
        (!filter.q || `${a.title} ${a.applicant.name}`.toLowerCase().includes(filter.q.toLowerCase()));
      const scoped = s.applications.filter((a) => a.status !== "draft" && want(a));
      const counts: Record<string, number> = {};
      for (const a of scoped) counts[a.status] = (counts[a.status] ?? 0) + 1;
      const rows = scoped.filter((a) => !filter.status || a.status === filter.status);
      const key = filter.sortBy ?? "submittedAt";
      const value = (a: InboxApplication): string | number => (key === "title" ? a.title : key === "applicant" ? (a.applicant.name ?? "") : key === "requestedAmount" ? (a.requestedAmountMinor ?? 0) : key === "status" ? a.status : (a.submittedAt ?? ""));
      const dir = (filter.sortOrder ?? (key === "submittedAt" ? "desc" : "asc")) === "asc" ? 1 : -1;
      rows.sort((p, q) => (value(p) < value(q) ? -dir : value(p) > value(q) ? dir : p.id < q.id ? -1 : 1));
      const size = filter.pageSize ?? 100;
      const start = ((filter.page ?? 1) - 1) * size;
      return { items: clone(rows.slice(start, start + size)), total: rows.length, counts };
    },
    async getApplication(id) {
      const { w, s } = await st();
      return detail(w, s, find(s.applications, id, "Application"));
    },
    async advanceApplication(id, input) {
      const { w, s } = await st();
      const a = find(s.applications, id, "Application");
      const stage = w.competitions.find((c) => c.id === a.competitionId)?.stages.find((x) => x.key === input.toStage);
      if (!stage || !stage.entryFrom.includes(a.stage)) throw ctx.fail(409, `This application cannot move to ${input.toStage} from ${a.stage}`);
      a.stage = stage.key;
      a.status = stage.requiresSubmission ? "draft" : a.status;
      return { id: a.id, status: a.status, stage: a.stage };
    },
    async requestRevision(id, input) {
      const { s } = await st();
      const a = find(s.applications, id, "Application");
      if (!input.message.trim()) throw ctx.fail(422, "Say what should change", [{ field: "message", message: "Required" }]);
      if (!["submitted", "screening", "under_review"].includes(a.status)) throw ctx.fail(409, `This application is ${a.status.replace(/_/g, " ")}`);
      a.status = "revision_requested";
      return { id: a.id, status: a.status };
    },
    async declineApplication(id, input) {
      const { s } = await st();
      const a = find(s.applications, id, "Application");
      const send = input.sendLetter !== false;
      decline(s, a, send ? (s.templates.find((t) => t.id === input.letterTemplateId)?.name ?? "Standard decline") : null);
      return { id: a.id, status: a.status, letter: { sent: send } };
    },
    async tagApplication(id, input) {
      const { s } = await st();
      const a = find(s.applications, id, "Application");
      a.tags = [...new Set([...a.tags.filter((t) => !(input.remove ?? []).includes(t)), ...(input.add ?? [])])];
      return { id: a.id, tags: a.tags };
    },
    async assignApplication(id, userId) {
      const { s } = await st();
      const a = find(s.applications, id, "Application");
      a.assignedToUserId = userId;
      return { id: a.id, assignedToUserId: userId };
    },
    async bulkApplications(input) {
      const { s } = await st();
      const succeeded: string[] = [];
      const failed: { id: string; message: string }[] = [];
      const params = input.params ?? {};
      for (const id of input.applicationIds) {
        try {
          const a = find(s.applications, id, "Application");
          if (input.action === "decline") decline(s, a, params.sendLetter === false ? null : (s.templates.find((t) => t.id === params.letterTemplateId)?.name ?? "Standard decline"));
          else if (input.action === "tag") a.tags = [...new Set([...a.tags, ...((params.add as string[] | undefined) ?? [])])];
          else if (input.action === "assign") a.assignedToUserId = (params.userId as string | null | undefined) ?? null;
          else throw ctx.fail(422, "Advance applications one at a time");
          succeeded.push(a.id);
        } catch (err) {
          failed.push({ id, message: err instanceof Error ? err.message : "Failed" });
        }
      }
      return { action: input.action, requested: input.applicationIds.length, succeeded, failed, lettersSent: input.action === "decline" && params.sendLetter !== false ? succeeded.length : 0 };
    },
    async rerunEligibility(id) {
      const { w, s } = await st();
      return detail(w, s, find(s.applications, id, "Application")).eligibilityResults!;
    },

    async listThreads(applicationId) {
      const { s } = await st();
      return clone(s.threads.filter((t) => t.subjectId === find(s.applications, applicationId, "Application").id));
    },
    async openThread(applicationId, visibility) {
      const { s } = await st();
      const a = find(s.applications, applicationId, "Application");
      const v = visibility === "internal" ? "funder_internal" : "shared";
      let t = s.threads.find((x) => x.subjectId === a.id && x.visibility === v);
      if (!t) {
        t = { id: newId(), subjectType: "application", subjectId: a.id, visibility: v, title: null, messages: [], updatedAt: ctx.now() };
        s.threads.push(t);
      }
      return clone(t);
    },
    async postMessage(threadId, body) {
      const { s } = await st();
      const t = find(s.threads, threadId, "Thread");
      if (!body.trim()) throw ctx.fail(422, "Write a message first", [{ field: "body", message: "Required" }]);
      const m = { id: newId(), author: USER_NAMES[me]!, authorUserId: me, body: body.trim(), createdAt: ctx.now() };
      t.messages.push(m);
      return { id: m.id };
    },
    async listTasks(filter = {}) {
      const { s } = await st();
      return clone(s.tasks.filter((t) => (!filter.open || !t.doneAt) && (!filter.mine || t.assigneeUserId === me)));
    },
    async updateTask(id, patch) {
      const { s } = await st();
      const t = find(s.tasks, id, "Task");
      if (patch.title !== undefined) t.title = patch.title;
      if (patch.done !== undefined) t.doneAt = patch.done ? ctx.now() : null;
      return clone(t);
    },

    async listAssignments(filter = {}) {
      const { s } = await st();
      return clone(
        s.assignments.filter(
          (a) =>
            (!filter.competitionId || a.competitionId === filter.competitionId) &&
            (!filter.applicationId || a.applicationId === filter.applicationId) &&
            (!filter.reviewerUserId || a.reviewerUserId === filter.reviewerUserId) &&
            (!filter.stage || a.stage === filter.stage) &&
            (!filter.status || a.status === filter.status),
        ),
      );
    },
    async createAssignment(input) {
      const { w, s } = await st();
      const app = find(s.applications, input.applicationId, "Application");
      const stage = input.stage ?? app.stage;
      if (s.assignments.some((a) => a.applicationId === app.id && a.stage === stage && a.reviewerUserId === input.reviewerUserId && a.status !== "recused")) throw ctx.fail(409, "This reviewer is already assigned to the application");
      const { stage: def } = stageOf(w, app.competitionId, stage);
      const rubric = rubricOf(w, def.rubricId ?? "");
      if (!rubric) throw ctx.fail(422, "This stage has no rubric");
      const a: ReviewAssignment = { id: newId(), applicationId: app.id, applicationTitle: app.title, competitionId: app.competitionId, stage, reviewerUserId: input.reviewerUserId, rubricId: rubric.id, rubricVersion: rubric.version, dueAt: input.dueAt ?? null, status: "assigned", coi: { declared: null, reason: null }, review: null, createdAt: ctx.now() };
      s.assignments.push(a);
      if (app.status === "submitted" || app.status === "screening") app.status = "under_review";
      return clone(a);
    },
    async autoAssign(input) {
      const { w, s } = await st();
      const { comp, stage } = stageOf(w, input.competitionId, input.stage);
      const pool = input.reviewers ?? w.members.filter((m) => ["reviewer", "program_officer", "admin", "finance"].includes(m.role)).map((m) => ({ userId: m.userId, capacity: undefined }));
      const load = new Map(pool.map((r) => [r.userId, s.assignments.filter((a) => a.reviewerUserId === r.userId && a.stage === stage.key && a.status !== "recused").length]));
      const created: { applicationId: string; reviewerUserId: string; matchedTags: string[] }[] = [];
      const unfilled: { applicationId: string; missing: number }[] = [];
      for (const app of s.applications.filter((a) => a.competitionId === comp.id && a.stage === stage.key && !["draft", "declined", "withdrawn", "accepted"].includes(a.status))) {
        const have = s.assignments.filter((a) => a.applicationId === app.id && a.stage === stage.key && a.status !== "recused").map((a) => a.reviewerUserId);
        let need = input.reviewersPerApplication - have.length;
        for (const r of [...pool].sort((p, q) => (load.get(p.userId) ?? 0) - (load.get(q.userId) ?? 0))) {
          if (need <= 0) break;
          if (have.includes(r.userId) || (r.capacity !== undefined && (load.get(r.userId) ?? 0) >= r.capacity)) continue;
          created.push({ applicationId: app.id, reviewerUserId: r.userId, matchedTags: [] });
          load.set(r.userId, (load.get(r.userId) ?? 0) + 1);
          have.push(r.userId);
          need--;
        }
        if (need > 0) unfilled.push({ applicationId: app.id, missing: need });
      }
      if (!input.dryRun) {
        const rubric = rubricOf(w, stage.rubricId ?? "");
        for (const c of created) s.assignments.push({ id: newId(), applicationId: c.applicationId, applicationTitle: find(s.applications, c.applicationId, "Application").title, competitionId: comp.id, stage: stage.key, reviewerUserId: c.reviewerUserId, rubricId: rubric.id, rubricVersion: rubric.version, dueAt: null, status: "assigned", coi: { declared: null, reason: null }, review: null, createdAt: ctx.now() });
      }
      return { stage: stage.key, dryRun: !!input.dryRun, created: input.dryRun ? 0 : created.length, assignments: created, unfilled, coiFlags: [] };
    },
    async inviteReviewer(input) {
      const { w } = await st();
      const comp = find(w.competitions, input.competitionId, "Competition");
      if (!/^\S+@\S+\.\S+$/.test(input.email)) throw ctx.fail(422, "Enter an email address", [{ field: "email", message: "Not an email address" }]);
      return { id: newId(), email: input.email.toLowerCase(), role: "external_reviewer", competitionId: comp.id, expiresAt: at("2027-05-30T00:00"), token: "mock-invitation", acceptUrl: "/signin?invite=mock-invitation", emailed: true };
    },
    async getAssignment(id) {
      const { w, s } = await st();
      const a = find(s.assignments, id, "Review assignment");
      const rubric = rubricOf(w, a.rubricId);
      const r = s.reviews.find((x) => x.assignmentId === a.id);
      const own = a.reviewerUserId === me;
      return { ...clone(a), rubric: { id: rubric.id, version: rubric.version, name: rubric.name, criteria: rubric.criteria as never, overall: rubric.overall }, myReview: r && own ? { scores: r.scores, narrative: r.narrative, recommendation: r.recommendation, submittedAt: r.submittedAt } : null, application: a.status === "recused" ? null : (detail(w, s, find(s.applications, a.applicationId, "Application")) as never) };
    },
    async updateAssignment(id, patch) {
      const { w, s } = await st();
      const a = find(s.assignments, id, "Review assignment");
      const conflict = () => ctx.fail(409, `This assignment is ${a.status.replace(/_/g, " ")}`);
      if (patch.action === "reschedule") {
        a.dueAt = patch.dueAt ?? null;
        return clone(a);
      }
      if (patch.action === "recuse") {
        a.status = "recused";
        a.coi = { declared: a.coi.declared ?? false, reason: patch.reason ?? null };
        return clone(a);
      }
      assertRole(a);
      if (patch.action === "declare_coi") {
        if (a.status !== "assigned") throw conflict();
        a.coi = { declared: !!patch.hasConflict, reason: patch.reason ?? null };
        a.status = patch.hasConflict ? "recused" : "coi_declared";
        return clone(a);
      }
      if (!["coi_declared", "in_progress"].includes(a.status)) throw ctx.fail(409, a.status === "assigned" ? "Declare any conflict of interest before scoring" : `This assignment is ${a.status.replace(/_/g, " ")}`);
      let r = s.reviews.find((x) => x.assignmentId === a.id);
      if (!r) {
        r = { assignmentId: a.id, scores: {}, narrative: null, recommendation: null, submittedAt: null };
        s.reviews.push(r);
      }
      if (patch.scores) r.scores = { ...r.scores, ...(patch.scores as Record<string, number | string>) };
      if (patch.narrative !== undefined) r.narrative = patch.narrative;
      if (patch.recommendation !== undefined) r.recommendation = patch.recommendation;
      const { overall, missing: gaps } = overallOf(rubricOf(w, a.rubricId), r.scores);
      if (patch.action === "submit") {
        if (gaps.length) throw ctx.fail(422, "Score every criterion before submitting", gaps.map((field) => ({ field: `scores.${field}`, message: "Required" })));
        r.submittedAt = ctx.now();
        a.status = "submitted";
      } else a.status = "in_progress";
      a.review = { id: `rev_${a.id}`, submittedAt: r.submittedAt, overall, complete: !gaps.length };
      return clone(a);
    },
    async listReviews(applicationId, stage) {
      const { w, s } = await st();
      const app = find(s.applications, applicationId, "Application");
      return s.assignments.filter((a) => a.applicationId === app.id && (!stage || a.stage === stage) && a.status === "submitted").flatMap((a) => reviewView(w, s, a) ?? []);
    },
    async getRanking(competitionId, stage) {
      const { w, s } = await st();
      return ranking(w, s, competitionId, stage);
    },

    async getAllocation(competitionId) {
      const { w, s } = await st();
      return allocation(w, s, competitionId);
    },
    async listDecisions(filter = {}) {
      const { s } = await st();
      return clone(s.decisions.filter((d) => (!filter.competitionId || d.competitionId === filter.competitionId) && (!filter.applicationId || d.applicationId === filter.applicationId) && (filter.committed === undefined || !!d.committedAt === filter.committed)));
    },
    async proposeDecisions(competitionId, decisions) {
      const { w, s } = await st();
      const comp = find(w.competitions, competitionId, "Competition");
      const out: Decision[] = [];
      for (const d of decisions) {
        const app = find(s.applications, d.applicationId, "Application");
        if (s.decisions.some((x) => x.applicationId === app.id && x.committedAt)) throw ctx.fail(409, `${app.title} already has a committed decision`);
        if (d.outcome === "approve" && !d.amountMinor) throw ctx.fail(422, "An approval needs an amount", [{ field: "amountMinor", message: "Required" }]);
        s.decisions = s.decisions.filter((x) => x.applicationId !== app.id);
        const row: Decision = { id: newId(), competitionId: comp.id, applicationId: app.id, stage: app.stage, outcome: d.outcome, amountMinor: d.outcome === "approve" ? (d.amountMinor ?? null) : null, currency: "USD", conditions: d.conditions ?? [], rationale: d.rationale ?? null, letterTemplateId: d.letterTemplateId ?? null, proposedBy: `user:${me}`, decidedBy: null, committedAt: null, createdAt: ctx.now() };
        s.decisions.push(row);
        out.push(row);
      }
      return { decisions: clone(out), allocation: allocation(w, s, comp.id) };
    },
    async commitDecisions(input) {
      const { w, s } = await st();
      const comp = find(w.competitions, input.competitionId, "Competition");
      const meter = allocation(w, s, comp.id);
      if (meter.over && !input.override?.reason.trim()) throw ctx.fail(422, `These decisions exceed the program budget by $${(meter.overByMinor / 100).toLocaleString("en-US")}`, [{ code: "over_allocation", field: "override" }]);
      const results: Awaited<ReturnType<FunderApi["commitDecisions"]>>["results"] = [];
      for (const id of input.decisionIds) {
        const d = find(s.decisions, id, "Decision");
        const app = find(s.applications, d.applicationId, "Application");
        d.committedAt = ctx.now();
        d.decidedBy = me;
        if (d.outcome === "approve") {
          const awardId = newId("awd_");
          const agreementId = newId("agr_");
          app.status = "accepted";
          s.awards.push({ ...clone(seed().awards[0]!), id: awardId, title: app.title, status: "offered", requestedAmountMinor: app.requestedAmountMinor, awardedAmountMinor: d.amountMinor, applicationId: app.id, programId: meter.programId, recipient: withVerification({ workspaceId: app.applicant.workspaceId, name: app.applicant.name, handle: app.applicant.handle, level: app.applicant.level }, verificationOf(app.applicant) ?? { source: "none", level: null }), createdAt: ctx.now(), updatedAt: ctx.now(), tranches: [], requirements: [], amendments: [] });
          s.agreements.push({ id: agreementId, version: 1, status: "draft", documentSha256: null, granteeSignedAt: null, funderSignedAt: null, executedAt: null, awardId, templateId: null, granteeSignature: null, funderSignature: null, hasStoredPdf: false, createdAt: ctx.now() });
          results.push({ decisionId: d.id, applicationId: app.id, outcome: d.outcome, ok: true, awardId, agreementId, letterSent: true });
        } else {
          if (d.outcome === "decline") app.status = "declined";
          if (d.outcome === "waitlist") app.status = "waitlisted";
          results.push({ decisionId: d.id, applicationId: app.id, outcome: d.outcome, ok: true, letterSent: d.outcome === "decline" });
        }
      }
      return { committed: results.length, failed: 0, results, override: meter.over && input.override ? { by: me, reason: input.override.reason, overByMinor: meter.overByMinor } : null, allocation: allocation(w, s, comp.id) };
    },

    async listAwards(filter = {}) {
      const { s } = await st();
      return s.awards.filter((a) => !filter.status || a.status === filter.status).map((a) => {
        const { agreement: _a, tranches: _t, requirements: _r, amendments: _m, ...summary } = awardView(s, a);
        return summary;
      });
    },
    async getAward(id) {
      const { s } = await st();
      return awardView(s, find(s.awards, id, "Award"));
    },
    async decideAmendment(id, input) {
      const { s } = await st();
      const row = s.awards.flatMap((a) => a.amendments).find((m) => m.id === id);
      if (!row) throw missing("Amendment");
      Object.assign(row, { status: input.status, decidedBy: me, decidedAt: ctx.now() } satisfies Partial<Amendment>);
      return clone(row);
    },
    async createAgreement(awardId) {
      const { s } = await st();
      const award = find(s.awards, awardId, "Award");
      if (s.agreements.some((g) => g.awardId === award.id && g.status !== "voided")) throw ctx.fail(409, "This award already has an agreement");
      const g: Agreement = { id: newId("agr_"), version: 1, status: "draft", documentSha256: null, granteeSignedAt: null, funderSignedAt: null, executedAt: null, awardId: award.id, templateId: null, granteeSignature: null, funderSignature: null, hasStoredPdf: false, createdAt: ctx.now() };
      s.agreements.push(g);
      return clone(g);
    },
    async getAgreement(id) {
      const { s } = await st();
      return clone(find(s.agreements, id, "Agreement"));
    },
    async sendAgreement(id) {
      const { s } = await st();
      const g = find(s.agreements, id, "Agreement");
      if (g.status !== "draft") throw ctx.fail(409, `This agreement is ${g.status.replace(/_/g, " ")}`);
      Object.assign(g, { status: "sent", documentSha256: "3f9a51c27d8e4b60a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2c21e", hasStoredPdf: true });
      return { ...clone(g), letter: { sent: true } };
    },
    async countersignAgreement(id, input) {
      const { s } = await st();
      const g = find(s.agreements, id, "Agreement");
      if (g.status !== "signed_by_grantee") throw ctx.fail(409, "The grantee signs first");
      if (!input.name.trim() || input.attest !== true) throw ctx.fail(422, "Type your full legal name and confirm the attestation", [{ field: "name", message: "Required" }]);
      if (input.documentSha256 && input.documentSha256 !== g.documentSha256) throw ctx.fail(409, "The document changed since it was sent");
      Object.assign(g, { status: "executed", funderSignedAt: ctx.now(), executedAt: ctx.now(), funderSignature: { name: input.name.trim(), at: ctx.now() } });
      const award = find(s.awards, g.awardId, "Award");
      award.status = "active";
      const due = award.tranches.filter((t) => t.condition.type === "onExecution");
      for (const t of due) t.status = "due";
      return { ...clone(g), executedPdfSha256: "c41e0b7a9d2f4e6c8a1b3d5f7e9c0a2b4d6f8e0c1a3b5d7f9e1c3a5b7d9f9ab2", awardStatus: award.status, tranchesDue: due.map((t) => t.id) };
    },
    async agreementPdf(id) {
      const { s } = await st();
      find(s.agreements, id, "Agreement");
      return new Blob(["%PDF-1.4\n% mock agreement\n"], { type: "application/pdf" });
    },

    async listTemplates(kind) {
      const { s } = await st();
      const of = (builtIn: boolean) => clone(s.templates.filter((t) => !!t.builtIn === builtIn && (!kind || t.kind === kind)));
      return { items: of(false), builtIn: of(true) };
    },
    async createTemplate(input) {
      const { s } = await st();
      if (!input.name.trim() || !input.body.trim()) throw ctx.fail(422, "A template needs a name and a body", [{ field: !input.name.trim() ? "name" : "body", message: "Required" }]);
      if (input.kind === "email" && !input.subject?.trim()) throw ctx.fail(422, "An email template needs a subject", [{ field: "subject", message: "An email template needs a subject" }]);
      const prior = s.templates.filter((t) => !t.builtIn && t.name === input.name.trim() && t.kind === input.kind);
      const t = template(newId(), input.kind, input.name.trim(), input.subject ?? null, input.body, false);
      t.version = prior.length + 1;
      t.createdAt = ctx.now();
      s.templates.push(t);
      return clone(t);
    },
    async renderTemplate(id, input = {}) {
      const { w, s } = await st();
      return render(w, s, find(s.templates, id, "Template"), input);
    },
    async listCommunications() {
      const { s } = await st();
      return clone(s.communications);
    },

    async listApprovals(status) {
      const { s } = await st();
      return clone(s.approvals.filter((a) => !status || a.status === status));
    },
    async decideApproval(id, input) {
      const { s } = await st();
      const a = find(s.approvals, id, "Approval");
      if (a.status !== "pending") throw ctx.fail(409, `This request was already ${a.status}`);
      Object.assign(a, { status: input.approve ? "executed" : "rejected", decidedBy: me, decidedAt: ctx.now(), ...(input.note ? { note: input.note } : {}) });
      if (input.approve && a.tool === "decline_application") {
        const ids = (a.input as { applicationIds?: string[] }).applicationIds ?? [];
        for (const appId of ids) decline(s, find(s.applications, appId, "Application"), "Standard decline v3");
        a.result = { declined: ids.length, lettersSent: ids.length };
      }
      return clone(a);
    },

    async consentRequest(req) {
      if (!req) throw ctx.fail(400, "This authorization request is missing or has expired");
      return {
        client: { id: "claude-mcp", name: "Claude", dynamicallyRegistered: true, redirectHost: "claude.ai" },
        scopes: [
          { scope: "applications:read", description: "Read applications and their responses" },
          { scope: "applications:write", description: "Advance, tag and propose declines" },
          { scope: "reviews:read", description: "Read scores and rankings" },
          { scope: "communications:write", description: "Draft letters and messages" },
        ],
        gatedActions: ["commit_decisions", "release_tranche", "submit_application", "sign_agreement", "accept_award", "send_communication", "decline_application"],
        workspaces: [{ id: IDS.riverbend, name: "Riverbend Community Foundation", kind: "funder", role: "admin", grantableScopes: ["applications:read", "applications:write", "reviews:read", "communications:write"], requiresMfa: false }],
      } satisfies ConsentRequest;
    },
    async decideConsent(input) {
      const state = "mock-state";
      return { redirectTo: input.approve ? `https://claude.ai/api/mcp/auth_callback?code=mock-code&state=${state}` : `https://claude.ai/api/mcp/auth_callback?error=access_denied&state=${state}` };
    },
  };
}
