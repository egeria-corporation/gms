// SPDX-License-Identifier: AGPL-3.0-only
// Red team: a fund advisor (a program officer whose membership scope names one fund) calls every
// workspace route in the compiled OpenAPI document and every MCP tool, with valid bodies and with
// the real ids of another fund's program, opportunity, competition, application, decision, award,
// agreement, requirement, payment, task and thread. Every one of those answers 403 or 404, no answer
// carries anything of that fund (its names, its amounts), nothing of it changes, and no approval
// request is filed for it. The advisor's own fund still opens. The route list comes from the
// document, so a new route is covered as soon as it is described; a new path parameter fails the
// test until it is given a value below. Skipped when the document has not been compiled
// (`pnpm spec:compile`); CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const ADVISOR = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
/** Written into every text of the other fund's records; no answer to the advisor may contain it. */
const MARK = "ZZOTHERFUND";
/** The other fund's award (minor units) and each of its two tranches: no total or figure may show them. */
const AWARD_MINOR = 13_579_246;
const MONEY_MARKS = ["13579246", "135792.46", "6789623", "67896.23"];
const NOWHERE = "00000000-0000-4000-8000-00000000dead";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  nullable?: boolean;
}
interface Operation {
  requestBody?: { content?: Record<string, { schema?: Schema }> };
}
interface Doc {
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, Schema> };
}

/** Every workspace route under /gms/ and the CommonGrants application and award routes. Not the public pages, which anyone may read, nor the sign-in flow. */
const inScope = (path: string) => (path.startsWith("/gms/") && !path.startsWith("/gms/public/") && !path.startsWith("/gms/passport/signin/")) || path.startsWith("/common-grants/applications") || path.startsWith("/common-grants/awards");

interface Ids {
  fundA: string;
  programA: string;
  oppA: string;
  awardA: string;
  fundB: string;
  programB: string;
  oppB: string;
  compB: string;
  appB: string;
  awardB: string;
  agreementB: string;
  trancheB: string;
  requirementB: string;
  decisionB: string;
  assignmentB: string;
  taskB: string;
  threadB: string;
}
let ids: Ids;
/** The other fund's v1.8.0 and v1.9.0 records (set in setUp). */
let extra: { docketId: string; reportViewId: string; reportFileId: string; socialPostId: string; importRunId: string; historyAppId: string; historyReviewId: string; historyReportId: string; reminderId: string };
/** Every id of the other fund's records, bare: a request naming one must be refused. */
let otherIds: string[];

const P = (prefix: string, uuid: string) => `${prefix}_${uuid}`;

/** A path parameter's value: the other fund's record of the kind the path names. */
function paramsFor(path: string): Record<string, string> {
  const id = (() => {
    if (path.startsWith("/gms/programs/")) return ids.programB;
    if (path.startsWith("/gms/funds/")) return ids.fundB;
    if (path.startsWith("/gms/opportunities/")) return P("opp", ids.oppB);
    if (path.startsWith("/gms/competitions/")) return P("cmp", ids.compB);
    if (path.startsWith("/gms/applications/") || path.startsWith("/gms/my/applications/")) return P("app", ids.appB);
    if (path.startsWith("/gms/awards/") || path.startsWith("/gms/my/awards/")) return P("awd", ids.awardB);
    if (path.startsWith("/gms/agreements/")) return P("agr", ids.agreementB);
    if (path.startsWith("/gms/tranches/")) return P("trn", ids.trancheB);
    if (path.startsWith("/gms/requirements/")) return P("req", ids.requirementB);
    if (path.startsWith("/gms/review-assignments/")) return ids.assignmentB;
    if (path.startsWith("/gms/tasks/")) return ids.taskB;
    if (path.startsWith("/gms/threads/")) return ids.threadB;
    if (path.startsWith("/gms/workspaces/")) return WS_FUNDER;
    // v1.12.0: imported history, a call's translation draft and its "Two weeks left" prompt.
    if (path.startsWith("/gms/history/applications/")) return extra?.historyAppId ?? NOWHERE;
    if (path.startsWith("/gms/history/reports/")) return extra?.historyReportId ?? NOWHERE;
    if (path.startsWith("/gms/translations/opportunities/")) return P("opp", ids.oppB);
    if (path.startsWith("/gms/social/reminders/")) return extra?.reminderId ?? NOWHERE;
    return NOWHERE;
  })();
  return {
    id,
    appId: ids.appB,
    awdId: ids.awardB,
    formId: s.uuid.loi,
    competitionId: P("cmp", ids.compB),
    applicantWorkspaceId: WS_APPLICANT,
    granteeId: WS_APPLICANT,
    userId: USER_ADMIN,
    commentId: NOWHERE,
    deliveryId: NOWHERE,
    sessionId: NOWHERE,
    clientId: NOWHERE,
    alertId: NOWHERE,
    listingId: "og-listing-1",
    provider: "google_workspace",
    file: "nothing.ics",
    docId: NOWHERE,
    qid: NOWHERE,
    oid: NOWHERE,
    sid: NOWHERE,
    // v1.8.0 and v1.9.0 paths: the other fund's docket, a gallery item, the funder's own handle.
    docketId: extra?.docketId ?? NOWHERE,
    slug: "no-such-item",
    handle: "riverbend",
    workspaceId: WS_FUNDER,
  };
}

/** Bodies that name the other fund's records where the schema's sample would name none. */
function bodyFor(key: string): unknown {
  const app = P("app", ids.appB);
  const bodies: Record<string, unknown> = {
    "post /gms/opportunities": { title: "Into the other fund", programId: ids.programB, description: "x" },
    "post /gms/competitions": { opportunityId: P("opp", ids.oppB), title: "Into the other fund" },
    "post /gms/programs": { name: "Into the other fund", fundId: ids.fundB },
    "post /gms/decisions/propose": { competitionId: P("cmp", ids.compB), decisions: [{ applicationId: app, outcome: "approve", amountMinor: 100 }] },
    "post /gms/decisions/commit": { competitionId: P("cmp", ids.compB), decisionIds: [ids.decisionB] },
    "post /gms/awards": { applicationId: app, amountMinor: 100, currency: "USD" },
    "post /gms/awards/direct": { programId: ids.programB, recipient: { organizationName: "Elm", contactEmail: "elm@example.org" }, title: "Into the other fund", amount: { value: "10.00", currency: "USD" } },
    "post /gms/applications/bulk": { applicationIds: [app], action: "tag", params: { add: ["x"] } },
    "post /gms/applications/{id}/assign": { userId: ADVISOR },
    "post /gms/applications/{id}/advance": { toStage: "full" },
    "post /gms/applications/{id}/decline": { rationale: "No.", sendLetter: false },
    "post /gms/applications/{id}/request-revision": { message: "More please." },
    "post /gms/applications/{id}/tags": { add: ["x"] },
    "post /gms/review-assignments": { applicationId: app, reviewerUserId: ADVISOR },
    "post /gms/review-assignments/auto": { competitionId: P("cmp", ids.compB) },
    "post /gms/review-assignments/invite": { competitionId: P("cmp", ids.compB), email: "reviewer@example.org" },
    "patch /gms/review-assignments/{id}": { action: "declare_coi", hasConflict: true },
    "post /gms/tasks": { title: "On the other fund", subjectType: "application", subjectId: ids.appB },
    "patch /gms/tasks/{id}": { done: true },
    "post /gms/threads": { subjectType: "application", subjectId: ids.appB, visibility: "internal" },
    "post /gms/threads/{id}/messages": { body: "Hello" },
    "post /gms/communications/send": { templateId: "builtin:decline", recipients: [{ applicationId: app }] },
    "post /gms/communications/bulk": { templateId: "builtin:decline", view: { competitionId: ids.compB }, dryRun: true },
    "post /gms/eligibility/evaluate": { opportunityId: P("opp", ids.oppB) },
    "post /gms/assist/summary": { applicationId: app },
    "post /gms/assist/summarize": { applicationId: app },
    "post /gms/assist/compare-rubric": { applicationId: app, rubricId: NOWHERE },
    "post /gms/assist/draft-letter": { applicationId: app, templateId: "decline" },
    "post /gms/templates/{id}/render": { applicationId: app, awardId: P("awd", ids.awardB), fields: {} },
    "post /gms/tranches/{id}/record-external": { reference: "CHK-1001", paidAt: "2027-01-15", destinationLast4: "1234" },
    "post /gms/tranches/{id}/hold": { reason: "Hold." },
    "post /gms/awards/{id}/suspend": { reason: "Paused." },
    "post /gms/awards/{id}/cancel": { reason: "Cancelled." },
    "post /gms/awards/{id}/messages": { body: "Hello" },
    "post /gms/awards/{id}/requirements": { type: "report", title: "More", dueAt: "2027-12-01T00:00:00Z" },
    "post /gms/awards/{id}/amendments": { type: "extension", request: { newEndDate: "2029-06-30" }, reason: "More time" },
    "put /gms/awards/{id}/schedule": { tranches: [{ percent: 100, condition: { type: "manual" } }] },
    "put /gms/awards/{id}/budget": { kind: "approved", lines: [{ category: "Personnel", label: "Staff", amountMinor: 100 }] },
    "put /common-grants/applications/{appId}/forms/{formId}": { response: { projectTitle: "Into the other fund" } },
    "post /gms/my/applications/{id}/attachments": { name: "budget.txt", mime: "text/plain", contentBase64: btoa("Budget") },
    "post /gms/my/applications/{id}/forms/{formId}/insert-answer": { answerId: NOWHERE, path: "/projectTitle" },
    "post /gms/my/applications/{id}/interview/confirm": { slotId: "slot_1" },
    "post /gms/agreements/{id}/countersign": { name: "Dana Ortiz", attest: true },
    "post /gms/agreements/{id}/sign": { name: "Dana Ortiz", attest: true, documentSha256: "0".repeat(64) },
    "post /gms/agreements/{id}/void": { reason: "x" },
    "patch /gms/requirements/{id}": { title: "Changed" },
    "post /gms/requirements/{id}/waive": { reason: "x" },
    "put /gms/competitions/{id}/forms": { forms: {} },
    "put /gms/competitions/{id}/rubric": { rubricId: NOWHERE },
    "put /gms/competitions/{id}/stages": { stages: [{ key: "loi", label: "Letter of intent", forms: {} }] },
    "post /gms/competitions/{id}/notes": { body: "A note" },
    "patch /gms/programs/{id}": { name: "Renamed" },
    "put /gms/programs/{id}/budget-categories": { categories: ["Personnel"] },
    "patch /gms/funds/{id}": { name: "Renamed" },
    "put /gms/funds/{id}/budgets": { budgets: [{ fiscalYear: 2027, amountMinor: 1 }] },
    "post /gms/funds/{id}/advisors": { email: "someone@example.org", role: "reviewer" },
    "patch /gms/opportunities/{id}": { title: "Renamed" },
    "patch /gms/competitions/{id}": { title: "Renamed" },
    "post /gms/workspaces/{id}/invitations": { email: "friend@example.org", role: "program_officer", scope: { fundIds: [ids.fundB] } },
    "patch /gms/workspaces/{id}/members/{userId}": { scope: { fundIds: [ids.fundB] } },
    // v1.8.0 and v1.9.0 routes whose sample body the document alone does not make valid.
    "put /gms/competitions/{id}/coi-policy": { required: true },
    "post /common-grants/applications/search": {},
    "post /common-grants/awards/search": {},
  };
  return bodies[key];
}

/** Fields the schema's sample gets wrong (formats the document does not state), merged onto it. */
const patchFor = (key: string): Record<string, unknown> | undefined => PATCHES[key] ?? ({ "post /gms/connectors/google_workspace/export": { subjectId: ids.awardB, folderId: "abcdefghijkl" } } as Record<string, Record<string, unknown>>)[key];
const PATCHES: Record<string, Record<string, unknown>> = {
  "post /gms/bank-transactions/{id}/match": { destinationLast4: "1234" },
  "post /gms/custom-mcp-servers": { url: "https://mcp.example.org/" },
  "post /gms/grantees/{applicantWorkspaceId}/propose-change": { patch: { name: "New name" } },
  "post /gms/webhooks": { url: "https://hooks.example.org/gms" },
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function merged(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(patch)) return base.map((b, i) => (i < patch.length ? merged(b, patch[i]) : b));
  if (isObject(base) && isObject(patch)) return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(patch)])].map((k) => [k, k in patch ? merged(base[k], patch[k]) : base[k]]));
  return patch === undefined ? base : patch;
}

/** Query strings for the routes that need one, naming the other fund's records where they can. */
function queryFor(key: string): string {
  const q: Record<string, string> = {
    "get /gms/threads": `subjectType=application&subjectId=${ids.appB}`,
    "get /gms/assist/summary": `applicationId=${P("app", ids.appB)}`,
    "get /gms/pipeline/calendar": "month=2027-05",
    "get /gms/imports/runs": "target=award_history",
    "get /gms/imports/sources": "target=award_history",
    "get /gms/applications": `competitionId=${P("cmp", ids.compB)}`,
    "get /gms/opportunities": `programId=${ids.programB}`,
    "get /gms/competitions": `opportunityId=${P("opp", ids.oppB)}`,
    "get /gms/awards": `programId=${ids.programB}`,
    "get /gms/review-assignments": `competitionId=${P("cmp", ids.compB)}`,
    "get /gms/decisions": `competitionId=${P("cmp", ids.compB)}`,
    "get /gms/tranches": `awardId=${P("awd", ids.awardB)}`,
    "get /gms/ledger": `subjectType=award&subjectId=${ids.awardB}`,
    "get /gms/draft-invitations": `kind=outside_application&id=${NOWHERE}`,
  };
  return q[key] ? `?${q[key]}` : "";
}

/** A body the document's schema accepts: required fields only, the first of each choice. */
function sample(doc: Doc, s0: Schema | undefined, depth = 0): unknown {
  if (!s0 || depth > 8) return {};
  if (s0.$ref) return sample(doc, doc.components.schemas[s0.$ref.replace("#/components/schemas/", "")], depth + 1);
  if (s0.allOf) return Object.assign({}, ...s0.allOf.map((p) => sample(doc, p, depth + 1) as object));
  const choice = s0.anyOf ?? s0.oneOf;
  if (choice) return sample(doc, choice.find((c) => !(c.enum && c.enum.length === 1 && c.enum[0] === null)) ?? choice[0], depth + 1);
  if (s0.const !== undefined) return s0.const;
  if (s0.enum) return s0.enum[0];
  const type = Array.isArray(s0.type) ? s0.type.find((t) => t !== "null") : s0.type;
  switch (type) {
    case "object":
      return Object.fromEntries((s0.required ?? []).map((k) => [k, sample(doc, s0.properties?.[k], depth + 1)]));
    case "array":
      return Array.from({ length: Math.max(s0.minItems ?? 0, 1) }, () => sample(doc, s0.items, depth + 1));
    case "string":
      if (s0.format === "uuid") return NOWHERE;
      if (s0.format === "date") return "2027-01-15";
      if (s0.format === "date-time") return "2027-01-15T00:00:00Z";
      if (s0.format === "email") return "someone@example.org";
      if (s0.format === "uri" || s0.format === "url") return "https://example.org/";
      return "Sample text".padEnd(s0.minLength ?? 0, ".");
    case "integer":
    case "number":
      return s0.minimum ?? 1;
    case "boolean":
      return true;
    default:
      return s0.properties ? sample(doc, { ...s0, type: "object" }, depth + 1) : {};
  }
}

/** In a sample body or tool input, every field that names a record names the other fund's. */
function pointAtOtherFund(v: unknown, key = ""): unknown {
  const bare: Record<string, string> = { programId: ids.programB, fundId: ids.fundB, opportunityId: ids.oppB, competitionId: ids.compB, applicationId: ids.appB, awardId: ids.awardB, agreementId: ids.agreementB, trancheId: ids.trancheB, requirementId: ids.requirementB, decisionId: ids.decisionB, assignmentId: ids.assignmentB, taskId: ids.taskB, threadId: ids.threadB };
  const prefix: Record<string, string> = { opportunityId: "opp", competitionId: "cmp", applicationId: "app", awardId: "awd", agreementId: "agr", trancheId: "trn", requirementId: "req" };
  if (Array.isArray(v)) return v.map((x) => pointAtOtherFund(x, key.replace(/s$/, "")));
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pointAtOtherFund(x, k)]));
  const k = key.replace(/Ids?$/, "Id");
  if (typeof v === "string" && bare[k]) return prefix[k] && !/^[0-9a-f-]{36}$/.test(v) ? P(prefix[k]!, bare[k]!) : bare[k];
  return v;
}

let h: Harness;
let s: Scenario;
let doc: Doc;
let me: Record<string, string>;
let advisorToken: string;

const created = async <T>(r: Promise<{ status: number; body: unknown }>): Promise<T> => {
  const res = await r;
  if (res.status >= 300) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { data: T }).data;
};

/** Two funds; the other fund with a whole cycle in it (program to paid tranche), every text marked. */
async function setUp() {
  h = await harness();
  s = await scenario(h);
  doc = parse(readFileSync(SPEC, "utf8")) as Doc;
  const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  const fundA = await created<{ id: string }>(s.call(admin, "POST", "/gms/funds", { name: "Riverside Arts Fund", slug: "riverside-arts" }));
  const fundB = await created<{ id: string }>(s.call(admin, "POST", "/gms/funds", { name: `${MARK} Elder Care Fund`, slug: "elder-care", description: `${MARK} description` }));
  await created(s.call(admin, "PUT", `/gms/funds/${fundB.id}/budgets`, { budgets: [{ fiscalYear: 2027, amountMinor: 24_681_357 }] }));

  // The other fund: the scenario's opportunity and competition move into a program of it.
  const form = await created<{ id: string }>(s.call(s.funder, "POST", "/gms/forms", { title: "Interim report", purpose: "report", jsonSchema: { type: "object", properties: { progress: { type: "string" } }, required: ["progress"] }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/progress" }] } }));
  await created(s.call(s.funder, "POST", `/gms/forms/${form.id}/publish`));
  const programB = await created<{ id: string }>(
    s.call(s.funder, "POST", "/gms/programs", {
      name: `${MARK} Home visits`,
      description: `${MARK} program`,
      fundId: fundB.id,
      fiscalYear: 2027,
      budgetAmountMinor: 97_531_864,
      defaults: { awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" }, schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }], requirements: [{ key: "interim", type: "report", title: `${MARK} interim report`, formId: form.id.slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }] },
    }),
  );
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: programB.id, title: `${MARK} Community Health Grants`, description: `${MARK} grants` });
  await h.repos.table("competitions").update({ id: s.uuid.comp }, { title: `${MARK} cycle` });
  const started = await created<{ id: string }>(s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp }));
  const appB = started.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appB}/forms/${s.uuid.loi}`, { response: { projectTitle: `${MARK} project`, requestedAmount: { amount: "150000.00", currency: "USD" }, need: `${MARK} need` } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appB}/submit`)).status).toBe(200);
  await h.repos.table("applications").update({ id: appB }, { title: `${MARK} application` });
  const proposed = await created<{ decisions: { id: string }[] }>(s.call(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appB}`, outcome: "approve", amountMinor: AWARD_MINOR }] }));
  const committed = await created<{ results: { awardId: string; agreementId: string }[] }>(s.call(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [proposed.decisions[0]!.id] }));
  const awardB = committed.results[0]!.awardId.slice(4);
  const agreementId = committed.results[0]!.agreementId;
  const sent = await created<{ documentSha256: string }>(s.call(s.funder, "POST", `/gms/agreements/${agreementId}/send`));
  await created(s.call(s.applicant, "POST", `/gms/my/awards/awd_${awardB}/accept`));
  await created(s.call(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256: sent.documentSha256 }));
  await created(s.call(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true }));
  await h.repos.table("awards").update({ id: awardB }, { title: `${MARK} award`, description: `${MARK} award description` });
  const tranches = await h.repos.table("tranches").find({ award_id: awardB }, { orderBy: "seq" });
  const requirement = (await h.repos.table("requirements").find({ award_id: awardB }))[0]!;
  const decision = (await h.repos.table("decisions").find({ application_id: appB }))[0]!;
  const rubric = (await h.repos.table("rubrics").find({ workspace_id: null }))[0] ?? (await h.repos.table("rubrics").find({}))[0]!;
  const assignment = await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appB, stage: "loi", reviewer_user_id: USER_OFFICER, rubric_id: rubric.id, rubric_version: rubric.version, status: "assigned" });
  const task = await created<{ id: string }>(s.call(s.funder, "POST", "/gms/tasks", { title: `${MARK} task`, subjectType: "application", subjectId: appB }));
  const thread = await h.repos.table("threads").insert({ workspace_id: WS_FUNDER, funder_workspace_id: WS_FUNDER, applicant_workspace_id: null, subject_type: "application", subject_id: appB, title: `${MARK} thread`, visibility: "funder_internal" });
  await h.repos.table("messages").insert({ thread_id: thread.id, author: `user:${USER_OFFICER}`, author_user_id: USER_OFFICER, body: `${MARK} message` });

  // v1.8.0 and v1.9.0 records of the other fund: a board docket, an admin's shared report view and a
  // scheduled file of it, a social post about its award, an import run, and social posting on.
  h.env.ZERNIO_API_KEY = "zk_test_made_up";
  h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
  const docket = await created<{ docketId: string }>(s.call(s.funder, "POST", `/gms/competitions/${s.compId}/dockets`, {}));
  const view = await h.repos.table("report_views").insert({ workspace_id: WS_FUNDER, name: `${MARK} board view`, data_set: "awards", definition: { dataSet: "awards", columns: ["title", "amount", "fund"], filters: [], groupBy: [], aggregates: [], sort: [] } as never, visibility: "workspace", owner_user_id: USER_ADMIN });
  const reportFile = await h.repos.table("report_files").insert({ workspace_id: WS_FUNDER, view_id: view.id, period_key: "2027-05", storage_key: `exports/${WS_FUNDER}/reports/${view.id}/2027-05.csv`, recipient_user_ids: [USER_ADMIN, ADVISOR], row_count: 1, expires_at: "2099-01-01T00:00:00Z", sent_at: "2027-05-01T13:00:00Z" } as never);
  const socialPost = await h.repos.table("social_posts").insert({ workspace_id: WS_FUNDER, subject_type: "award", subject_id: awardB, idempotency_key: crypto.randomUUID(), payload_sha256: "a".repeat(64), platforms: ["linkedin"], status: "published", created_by: USER_ADMIN } as never);
  const importRun = await h.repos.table("import_runs").insert({ workspace_id: WS_FUNDER, target: "award_history", source: "csv", source_label: `${MARK}.csv`, mapping: {} as never, rows_total: 1 } as never);
  // v1.12.0 records of the other fund: imported history on its award (a past application, its
  // review, a past report), a "Two weeks left" prompt and a Philanthropy News Digest submission on its call.
  const historyApp = await h.repos.table("history_applications").insert({ workspace_id: WS_FUNDER, title: `${MARK} past application`, organization_name: `${MARK} past organization`, outcome: "awarded", award_id: awardB, program_id: programB.id, organization_workspace_id: WS_APPLICANT, answers: [{ question: "Need", answer: `${MARK} past answer` }] } as never);
  const historyReview = await h.repos.table("history_reviews").insert({ workspace_id: WS_FUNDER, application_id: historyApp.id, application_title: `${MARK} past application`, comment: `${MARK} past review`, total_score: 4 } as never);
  const historyReport = await h.repos.table("history_reports").insert({ workspace_id: WS_FUNDER, title: `${MARK} past report`, report_state: "approved", award_id: awardB, award_title: `${MARK} award`, organization_workspace_id: WS_APPLICANT } as never);
  const reminder = await h.repos.table("social_reminder_prompts").insert({ workspace_id: WS_FUNDER, opportunity_id: s.uuid.opp, deadline: "2027-06-30" } as never);
  await h.repos.table("syndication_sends").insert({ workspace_id: WS_FUNDER, opportunity_id: s.uuid.opp, target: "pnd", digest: "b".repeat(64), reply_to_masked: "g•••@riverbend.example", sent_by: USER_ADMIN, to_address: "pndrfp@candid.org" } as never);
  extra = { docketId: docket.docketId, reportViewId: view.id, reportFileId: reportFile.id, socialPostId: socialPost.id, importRunId: importRun.id, historyAppId: historyApp.id, historyReviewId: historyReview.id, historyReportId: historyReport.id, reminderId: reminder.id };

  // The advisor's own fund: a program, an opportunity and an award in it.
  const programA = await created<{ id: string }>(s.call(s.funder, "POST", "/gms/programs", { name: "Murals", fundId: fundA.id }));
  const oppA = await created<{ id: string }>(s.call(s.funder, "POST", "/gms/opportunities", { title: "Mural grants", programId: programA.id, description: "Walls for the river towns." }));
  const awardA = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, program_id: programA.id, recipient_individual: { name: "Mural collective" } as never, title: "Mural award", status: "active", funding: { awardedAmount: { amount: "5000.00", currency: "USD" } } as never });

  // The advisor: a program officer for the first fund only, signed in.
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: ADVISOR, role: "program_officer", scope: { fundIds: [fundA.id], email: "leo@advisors.example" } as never });
  me = { ...bearer(await h.session(ADVISOR)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  advisorToken = await h.forge({ sub: ADVISOR, client_id: CLIENT_AGENT, scope: scopesForRole("funder", "program_officer").join(" "), [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-fund-advisor" });
  h.env.ASSISTANT_ENABLED = "true";

  ids = {
    fundA: fundA.id,
    programA: programA.id,
    oppA: oppA.id.replace(/^opp_/, ""),
    awardA: awardA.id,
    fundB: fundB.id,
    programB: programB.id,
    oppB: s.uuid.opp,
    compB: s.uuid.comp,
    appB,
    awardB,
    agreementB: agreementId.replace(/^agr_/, ""),
    trancheB: tranches[0]!.id,
    requirementB: requirement.id,
    decisionB: decision.id,
    assignmentB: assignment.id,
    taskB: task.id,
    threadB: thread.id,
  };
  otherIds = [ids.fundB, ids.programB, ids.oppB, ids.compB, ids.appB, ids.awardB, ids.agreementB, ids.trancheB, ids.requirementB, ids.decisionB, ids.assignmentB, ids.taskB, ids.threadB, extra.historyAppId, extra.historyReportId, extra.reminderId];
}

/** What the other fund's records look like; compared after every call has been made. */
async function snapshot() {
  const t = h.repos;
  return {
    fund: await t.table("funds").one({ id: ids.fundB }),
    program: await t.table("programs").one({ id: ids.programB }),
    opportunity: await t.table("opportunities").one({ id: ids.oppB }),
    competition: await t.table("competitions").one({ id: ids.compB }),
    application: await t.table("applications").one({ id: ids.appB }),
    decision: await t.table("decisions").one({ id: ids.decisionB }),
    award: await t.table("awards").one({ id: ids.awardB }),
    agreement: await t.table("agreements").one({ id: ids.agreementB }),
    tranches: await t.table("tranches").find({ award_id: ids.awardB }, { orderBy: "seq" }),
    requirements: await t.table("requirements").find({ award_id: ids.awardB }),
    task: await t.table("tasks").one({ id: ids.taskB }),
    opportunitiesInProgram: (await t.table("opportunities").find({ program_id: ids.programB })).length,
    programsInFund: (await t.table("programs").find({ fund_id: ids.fundB })).length,
    awardsInProgram: (await t.table("awards").find({ program_id: ids.programB })).length,
    assignments: (await t.table("review_assignments").find({ application_id: ids.appB })).length,
    threads: (await t.table("threads").find({ subject_id: ids.appB })).length,
    tasks: (await t.table("tasks").find({ subject_id: ids.appB })).length,
    invitations: (await t.table("invitations").find({ workspace_id: WS_FUNDER })).length,
    members: await t.table("workspace_members").find({ workspace_id: WS_FUNDER }),
  };
}

interface Call {
  key: string;
  url: string;
  names: boolean;
  status: number;
  text: string;
}
/** Routes whose body names a record only as a filter of a list: they answer an empty list for another fund. */
const FILTERS = new Set(["post /gms/communications/bulk"]);
const leaks = (text: string) => text.includes(MARK) || MONEY_MARKS.some((m) => text.includes(m));

describe.skipIf(!existsSync(SPEC))("a fund advisor, on every route in the document and every MCP tool", () => {
  const calls: Call[] = [];
  const tools: { name: string; names: boolean; isError: boolean; text: string }[] = [];
  let before: Awaited<ReturnType<typeof snapshot>>;
  let approvalsBefore = 0;

  beforeAll(async () => {
    await setUp();
    before = await snapshot();
    approvalsBefore = (await h.repos.table("approvals").find({ workspace_id: WS_FUNDER })).length;
    // MCP first (the REST run ends with the advisor leaving the workspace): every tool the advisor's
    // agent is offered, its input pointed at the other fund's records.
    const rpc = async (method: string, params?: unknown) => {
      const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${advisorToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }) });
      return { status: res.status, text: await res.text() };
    };
    const listed = JSON.parse((await rpc("tools/list")).text) as { result: { tools: { name: string; inputSchema: Schema }[] } };
    for (const t of listed.result.tools) {
      const args = pointAtOtherFund(sample(doc, t.inputSchema)) as Record<string, unknown>;
      const argText = JSON.stringify(args);
      const names = otherIds.some((x) => argText.includes(x) || argText.includes(x.replace(/-/g, "")));
      const res = await rpc("tools/call", { name: t.name, arguments: args });
      const out = (() => {
        try {
          return (JSON.parse(res.text) as { result?: { isError?: boolean } }).result;
        } catch {
          return undefined;
        }
      })();
      tools.push({ name: t.name, names, isError: res.status >= 400 || !out || out.isError === true, text: res.text });
    }
    const ops = Object.entries(doc.paths).flatMap(([path, item]) => METHODS.filter((m) => item[m] && inScope(path)).map((m) => ({ path, method: m, op: item[m]! })));
    // Leaving the workspace ends the membership, so it goes last.
    ops.sort((x, y) => Number(x.path.endsWith("/members/me")) - Number(y.path.endsWith("/members/me")));
    for (const { path, method, op } of ops) {
      const key = `${method} ${path}`;
      const values = paramsFor(path);
      const missing = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((p) => !(p in values));
      if (missing.length) throw new Error(`${key}: give the path parameter ${missing.join(", ")} a value in paramsFor()`);
      const url = path.replace(/\{(\w+)\}/g, (_m, p: string) => encodeURIComponent(values[p]!)) + queryFor(key);
      const content = op.requestBody?.content ?? {};
      const type = Object.keys(content)[0];
      const body = method === "get" || method === "delete" ? undefined : (bodyFor(key) ?? pointAtOtherFund(merged(sample(doc, type ? content[type]!.schema : undefined), patchFor(key))));
      // A record named in the path or the body, not a list filter in the query string (filters answer an empty list).
      const sentText = `${path.replace(/\{(\w+)\}/g, (_m, p: string) => values[p]!)} ${body === undefined ? "" : JSON.stringify(body)}`;
      const names = otherIds.some((x) => sentText.includes(x) || sentText.includes(x.replace(/-/g, "")));
      const headers = { ...me, ...(type && type !== "application/x-www-form-urlencoded" ? { "Content-Type": type } : {}) };
      const res = await h.request(url, { method: method.toUpperCase(), headers, ...(body === undefined ? {} : { body: type === "application/x-www-form-urlencoded" ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) }) });
      calls.push({ key, url, names, status: res.status, text: await res.text() });
    }

  }, 180_000);

  it("covers the routes and tools that touch a fund's records", () => {
    const keys = new Set(calls.map((c) => c.key));
    for (const k of ["get /gms/programs/{id}", "get /gms/opportunities/{id}", "get /gms/competitions/{id}", "get /gms/applications/{id}", "get /gms/awards/{id}", "get /gms/tranches/{id}/readiness", "post /gms/tranches/{id}/release", "get /gms/funds/{id}", "get /common-grants/applications/{appId}", "get /common-grants/awards/{awdId}"]) expect(keys, k).toContain(k);
    // v1.12.0 routes that name a fund's records.
    for (const k of ["get /gms/history", "get /gms/history/applications/{id}", "get /gms/history/applications/{id}/files/{docId}", "get /gms/history/reports/{id}/files/{docId}", "get /gms/opportunities/{id}/syndication", "put /gms/opportunities/{id}/syndication/feeds", "post /gms/opportunities/{id}/syndication/pnd/preview", "post /gms/opportunities/{id}/syndication/pnd", "put /gms/awards/{id}/federal-funding", "get /gms/awards/{id}/sharing/carousel.pdf", "post /gms/translations/opportunities/{id}/draft", "post /gms/social/reminders/{id}/dismiss"]) expect(keys, k).toContain(k);
    expect(calls.length).toBeGreaterThan(350);
    const names = new Set(tools.map((t) => t.name));
    for (const t of ["get_program", "get_opportunity", "get_competition", "get_application", "get_award", "release_tranche", "list_awards"]) expect(names, t).toContain(t);
  });

  it("refuses every route that names another fund's record", () => {
    // A batch route answers per item; it refuses by listing every item as failed.
    const refusedBatch = (c: Call) => c.status === 200 && /"succeeded":\[\]/.test(c.text);
    const open = calls.filter((c) => c.names && !FILTERS.has(c.key) && !refusedBatch(c) && c.status !== 403 && c.status !== 404);
    expect(open.map((c) => `${c.status} ${c.key} ${c.url} ${c.text.slice(0, c.status === 400 || c.status === 422 ? 400 : 160)}`)).toEqual([]);
  });

  it("refuses every MCP tool call that names another fund's record, and files no approval for one", async () => {
    // A batch tool answers per item; an item it could not find is refused.
    const open = tools.filter((t) => t.names && !t.isError && !/not found/i.test(t.text));
    expect(open.map((t) => `${t.name} ${t.text.slice(0, 200)}`)).toEqual([]);
    // Requests that name none of the other fund's records (a message to no one) may be filed; none that names one.
    const filed = (await h.repos.table("approvals").find({ workspace_id: WS_FUNDER })).slice(approvalsBefore).map((x) => `${x.tool} ${JSON.stringify(x.input)}`);
    expect(filed.filter((x) => otherIds.some((id) => x.includes(id) || x.includes(id.replace(/-/g, ""))))).toEqual([]);
  });

  it("never answers with anything of another fund: its names or its amounts", () => {
    expect(calls.filter((c) => leaks(c.text)).map((c) => `${c.status} ${c.key} ${c.text.slice(0, 200)}`)).toEqual([]);
    expect(tools.filter((t) => leaks(t.text)).map((t) => `${t.name} ${t.text.slice(0, 200)}`)).toEqual([]);
  });

  it("changed nothing of the other fund", async () => {
    const after = await snapshot();
    // The advisor's own leaving the workspace (the last call) is theirs to make.
    expect({ ...after, members: after.members.filter((m) => m.user_id !== ADVISOR) }).toEqual({ ...before, members: before.members.filter((m) => m.user_id !== ADVISOR) });
  });

  it("keeps the advisor's own fund open", async () => {
    // Back in the workspace (the run ended with the advisor leaving it).
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: ADVISOR, role: "program_officer", scope: { fundIds: [ids.fundA] } as never });
    const get = async (path: string) => {
      const res = await h.request(path, { headers: me });
      return { status: res.status, body: (await res.json()) as { data: unknown; items?: unknown } };
    };
    const funds = await get("/gms/funds");
    expect(funds.body.data).toMatchObject({ scoped: true, items: [{ id: ids.fundA, name: "Riverside Arts Fund" }] });
    const programs = (await get("/gms/programs?pageSize=100")).body.items as { id: string; fundId: string }[];
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.every((p) => p.fundId === ids.fundA)).toBe(true);
    expect(programs.map((p) => p.id)).toContain(ids.programA);
    expect((await get(`/gms/programs/${ids.programA}`)).status).toBe(200);
    expect((await get(`/gms/opportunities/opp_${ids.oppA}`)).status).toBe(200);
    expect((await get(`/gms/awards/awd_${ids.awardA}`)).status).toBe(200);
    const awards = (await get("/gms/awards")).body.items as { id: string }[];
    expect(awards.map((a) => a.id)).toEqual([`awd_${ids.awardA}`]);
    // Over MCP too: the advisor's agent lists the advisor's fund.
    const listedFunds = tools.find((t) => t.name === "list_funds")!;
    expect(listedFunds.isError).toBe(false);
    expect(listedFunds.text).toContain("Riverside Arts Fund");
    // An unscoped program officer still sees both funds.
    const officerFunds = (await (await h.request("/gms/funds", { headers: s.funder })).json()) as { data: { scoped: boolean; items: unknown[] } };
    expect(officerFunds.data.scoped).toBe(false);
    expect(officerFunds.data.items.length).toBe(3);
  });

  it("reaches nothing of the other fund through reports, the docket, open data, social posts, the send package, imports, imported history or digests", async () => {
    // The route run above reached every one of these areas, and none answered with the other fund.
    const AREAS: Record<string, RegExp> = {
      reports: /^\w+ \/gms\/(reports|report-views|report-files)(\/|$)/,
      docket: /^\w+ \/gms\/competitions\/\{id\}\/dockets/,
      "open data": /^\w+ \/gms\/open-data\//,
      "social posts": /^\w+ \/gms\/social(\/|$)/,
      "send package": /^\w+ \/gms\/(outside-applications\/\{id\}\/package|send-package)/,
      imports: /^\w+ \/gms\/imports\//,
      digests: /^\w+ \/gms\/digests(\/|$|\?)/,
      // v1.12.0
      "imported history": /^\w+ \/gms\/history(\/|$)/,
      "share this call": /^\w+ \/gms\/opportunities\/\{id\}\/syndication/,
      "award kit": /^\w+ \/gms\/(awards\/\{id\}\/(sharing|federal-funding)|share-kit)/,
      translations: /^\w+ \/gms\/translations\//,
      // v1.13.0
      accounting: /^\w+ \/gms\/accounting(\/|$)/,
    };
    for (const [area, re] of Object.entries(AREAS)) {
      const mine = calls.filter((c) => re.test(c.key));
      expect(mine.length, `${area}: routes in the document`).toBeGreaterThan(0);
      expect(mine.filter((c) => leaks(c.text) || c.text.includes(ids.awardB) || c.text.includes(extra.reportViewId) || c.text.includes(extra.importRunId)).map((c) => `${area}: ${c.status} ${c.key} ${c.text.slice(0, 160)}`)).toEqual([]);
    }
    const get = async (path: string) => {
      const res = await h.request(path, { headers: me });
      return { status: res.status, text: await res.text() };
    };
    // Reports: the admin's shared view and its scheduled file are not the advisor's; running a report reads their fund only.
    expect((await get("/gms/report-views")).text).not.toContain(extra.reportViewId);
    expect((await get(`/gms/report-views/${extra.reportViewId}`)).status).toBe(404);
    expect((await get("/gms/report-files")).text).not.toContain(extra.reportFileId);
    expect((await get(`/gms/report-files/${extra.reportFileId}/download`)).status).toBe(404);
    const preview = await h.request("/gms/reports/preview", { method: "POST", headers: me, body: JSON.stringify({ dataSet: "awards", columns: ["title", "amount", "fund"], filters: [], groupBy: [], aggregates: [], sort: [] }) });
    const previewText = await preview.text();
    expect(preview.status).toBe(200);
    expect(previewText).toContain("Mural award");
    expect(leaks(previewText)).toBe(false);
    // The docket of the other fund's competition, by its own id.
    expect([403, 404]).toContain((await get(`/gms/competitions/cmp_${ids.compB}/dockets/${extra.docketId}`)).status);
    // Open data: nothing of the other fund's award in the summary or either export.
    for (const path of ["/gms/open-data/summary", "/gms/open-data/360giving.json", "/gms/open-data/commongrants.json"]) {
      const r = await get(path);
      expect(leaks(r.text) || r.text.includes(ids.awardB), path).toBe(false);
    }
    // Social: the post about the other fund's award is not listed, and its award is not offered.
    const posts = await get("/gms/social/posts");
    expect(posts.status).toBe(200);
    expect(posts.text).not.toContain(extra.socialPostId);
    expect((await get(`/gms/social/posts?subjectType=award&subjectId=${ids.awardB}`)).status).toBe(404);
    expect((await get(`/gms/social/compose?subjectType=award&subjectId=${ids.awardB}`)).status).toBe(404);
    // Imports: closed to fund advisors.
    expect((await get("/gms/imports/runs?target=award_history")).text).not.toContain(extra.importRunId);
    expect([403, 404]).toContain((await get(`/gms/imports/runs/${extra.importRunId}`)).status);
    // Imported history (v1.12.0): the other fund's past application, review and report are not listed, and do not open by id.
    const past = await get(`/gms/history?organization=${WS_APPLICANT}`);
    expect(past.status).toBe(200);
    // (The workspace's admin does see them, so the check above is not empty by accident.)
    const wholeHistory = await h.request(`/gms/history?organization=${WS_APPLICANT}`, { headers: { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER } });
    expect(await wholeHistory.text()).toContain(`${MARK} past application`);
    expect(leaks(past.text) || [extra.historyAppId, extra.historyReviewId, extra.historyReportId].some((x) => past.text.includes(x))).toBe(false);
    expect([403, 404]).toContain((await get(`/gms/history/applications/${extra.historyAppId}`)).status);
    const byAward = await get(`/gms/history?award=awd_${ids.awardB}`);
    expect([403, 404]).toContain(byAward.status);
    expect(byAward.text).not.toContain(MARK);
    // Share this call and the "Two weeks left" prompt on the other fund's call.
    expect([403, 404]).toContain((await get(`/gms/opportunities/opp_${ids.oppB}/syndication`)).status);
    const dismiss = await h.request(`/gms/social/reminders/${extra.reminderId}/dismiss`, { method: "POST", headers: me });
    expect([403, 404]).toContain(dismiss.status);
    expect((await h.repos.table("social_reminder_prompts").one({ id: extra.reminderId }))!.dismissed_at).toBeNull();
    // Send package: an applicant's own, never a funder member's.
    expect([403, 404]).toContain((await get(`/gms/outside-applications/${NOWHERE}/package`)).status);
    // Digests: the advisor's activity counts their fund only (the other fund's application is new this week).
    const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER };
    const count = (text: string) => Number(/(\d+) new application/.exec(text)?.[1] ?? 0);
    const mineDigest = JSON.parse((await get("/gms/digests/preview?digest=funder_activity")).text) as { data: { text: string | null } };
    const adminDigest = (await (await h.request("/gms/digests/preview?digest=funder_activity", { headers: admin })).json()) as { data: { text: string | null } };
    expect(count(adminDigest.data.text ?? "")).toBeGreaterThan(0);
    expect(count(mineDigest.data.text ?? "")).toBe(0);
    const { buildFunderActivity, newRun } = await import("../src/services/content-digests.ts");
    const { scopeToFunds } = await import("../src/services/fund-scope.ts");
    const ws = (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!;
    const run = newRun(1);
    const scoped = { repos: h.repos, now: () => h.clock.now, workspace: { id: WS_FUNDER, kind: "funder" as const, role: "program_officer", memberScope: { fundIds: [ids.fundA] } }, actor: { kind: "user", userId: ADVISOR }, ledger: h.ledger, ports: {} } as never;
    scopeToFunds(scoped, WS_FUNDER, [ids.fundA]);
    const whole = await buildFunderActivity({ repos: h.repos, now: () => h.clock.now }, ws, run);
    const theirs = await buildFunderActivity(scoped, ws, run);
    // One run, two answers: a fund advisor's counts are never the workspace's cached ones.
    expect(whole.newApplications).toBeGreaterThan(0);
    expect(theirs.newApplications).toBe(0);
  });

  it("keeps the books closed to a fund advisor, even one in finance: the QuickBooks setting, entries and actions (v1.13.0)", async () => {
    const { FixtureQuickBooksBooks } = await import("@gms/connectors");
    Object.assign(h.extraPorts, { quickbooks: new FixtureQuickBooksBooks() });
    // The workspace's books: the sync on, and the other fund's payment posted and then changed.
    const link = await h.repos.table("accounting_links").insert({ workspace_id: WS_FUNDER, expense_ref: "61", expense_name: `${MARK} grants expense`, paid_from_ref: "35", paid_from_name: `${MARK} operating`, sync_enabled: true, sync_from: "2027-01-01T00:00:00.000Z", updated_by: USER_ADMIN } as never);
    const entry = await h.repos.table("accounting_entries").insert({ workspace_id: WS_FUNDER, tranche_id: ids.trancheB, doc_number: `GMS-${ids.trancheB.replace(/-/g, "").slice(-16)}`, status: "needs_attention", reason: "changed", external_id: "4521", amount_minor: AWARD_MINOR / 2, currency: "USD", paid_on: "2027-04-15", vendor_ref: "56", vendor_name: `${MARK} vendor`, memo: `${MARK} memo` } as never);
    const member = (await h.repos.table("workspace_members").find({ workspace_id: WS_FUNDER, user_id: ADVISOR }))[0]!;
    await h.repos.table("workspace_members").update({ id: member.id }, { role: "finance" });
    const before = { link: await h.repos.table("accounting_links").one({ id: link.id }), entry: await h.repos.table("accounting_entries").one({ id: entry.id }), events: h.ledger.events.length };
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await h.request(path, { method, headers: me, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, text: await res.text() };
    };
    for (const path of ["/gms/accounting", "/gms/accounting/options", "/gms/accounting/vendors", "/gms/accounting/entries", "/gms/accounting/entries?compare=true"]) {
      const r = await call("GET", path);
      expect(leaks(r.text) || r.text.includes(ids.trancheB) || r.text.includes(entry.id) || r.text.includes(MARK), `${path}: ${r.status} ${r.text.slice(0, 200)}`).toBe(false);
    }
    for (const [method, path, body] of [
      ["PUT", "/gms/accounting/settings", { expenseId: "61", paidFromId: "35", tracking: "class", programs: {}, vendorPolicy: "create", syncEnabled: false }],
      ["PUT", "/gms/accounting/vendors", { vendors: [{ granteeId: WS_APPLICANT, vendorId: "56" }] }],
      ["POST", `/gms/accounting/entries/${entry.id}/handled`],
      ["POST", `/gms/accounting/entries/${entry.id}/retry`],
    ] as [string, string, unknown?][]) {
      const r = await call(method, path, body);
      expect([403, 404], `${method} ${path}: ${r.status} ${r.text.slice(0, 200)}`).toContain(r.status);
    }
    expect({ link: await h.repos.table("accounting_links").one({ id: link.id }), entry: await h.repos.table("accounting_entries").one({ id: entry.id }), events: h.ledger.events.length }).toEqual(before);
    await h.repos.table("workspace_members").update({ id: member.id }, { role: "program_officer" });
  });

  it("the event digest, the workspace ledger and review assignment keep to the fund (the three cross-track leaks)", async () => {
    const { deriveFor } = await import("../src/services/notifications.ts");
    const member = (await h.repos.table("workspace_members").find({ workspace_id: WS_FUNDER, user_id: ADVISOR }))[0]!;
    const ws = (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!;
    const base = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {} } as never;
    const digest = JSON.stringify(await deriveFor(base, member, ws));
    expect(otherIds.filter((x) => digest.includes(x))).toEqual([]);
    // The officer (every fund) sees the other fund's events in the same digest.
    const officer = (await h.repos.table("workspace_members").find({ workspace_id: WS_FUNDER, user_id: USER_OFFICER }))[0]!;
    const officerDigest = JSON.stringify(await deriveFor(base, officer, ws));
    expect(otherIds.some((x) => officerDigest.includes(x))).toBe(true);
    // The ledger: a member limited to some funds is refused, even as an auditor.
    await h.repos.table("workspace_members").update({ id: member.id }, { role: "auditor" });
    const ledger = await h.request("/gms/ledger", { headers: me });
    expect(ledger.status).toBe(403);
    expect(((await ledger.json()) as { code?: string; errors?: { code: string }[] }).errors?.[0]?.code ?? "").toMatch(/fund_scope/);
    // Review assignment: a reviewer limited to the advisor's fund cannot be assigned the other fund's application.
    await h.repos.table("workspace_members").update({ id: member.id }, { role: "reviewer" });
    // An application of the other fund that is waiting for review (the scenario's one was awarded).
    const before = (await h.repos.table("applications").one({ id: ids.appB }))!;
    await h.repos.table("applications").update({ id: ids.appB }, { status: "submitted" });
    const assign = await h.request("/gms/review-assignments", { method: "POST", headers: { ...s.funder, "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: P("app", ids.appB), reviewerUserId: ADVISOR }) });
    expect(assign.status).toBe(422);
    expect(await assign.text()).toContain("reviewer_out_of_scope");
    const auto = await h.request("/gms/review-assignments/auto", { method: "POST", headers: { ...s.funder, "Content-Type": "application/json" }, body: JSON.stringify({ competitionId: P("cmp", ids.compB), dryRun: true }) });
    expect(auto.status).toBe(200);
    expect(await auto.text()).not.toContain(ADVISOR);
    await h.repos.table("applications").update({ id: ids.appB }, { status: before.status });
    await h.repos.table("workspace_members").update({ id: member.id }, { role: "program_officer" });
  });
});
