// SPDX-License-Identifier: AGPL-3.0-only
// Red team: a person invited into one outside draft (role consultant, scope naming that draft)
// calls every workspace route in the compiled OpenAPI document, with valid bodies and with real
// ids of the team's other records. Only that draft, its questions and its comments open; every
// other route answers 403 or 404, and no answer carries anything of the records it may not see.
// The route list comes from the document, so a new route is covered as soon as it is described;
// a new path parameter fails the test until it is given a value below. Skipped when the document
// has not been compiled (`pnpm spec:compile`); CI compiles it first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SESSION_SECRET, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";
import { STARTER_ITEMS, STARTERS_PUBLISHED_AT } from "../src/services/gallery-starters.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const COWRITER = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const COWRITER_EMAIL = "lena@fischergrants.example";
const COWRITER_SESSION = "c0c0c0c0-5e55-4c0c-8c0c-c0c0c0c0c0c0";
/** Written into every record the cowriter may not see; no answer to them may contain it. */
const MARK = "ZZHIDDEN";
const NOWHERE = "00000000-0000-4000-8000-00000000dead";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
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
  tags?: string[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
}
interface Doc {
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, Schema> };
}

/**
 * The routes in scope: every workspace route under /gms/ (the applicant's, the funder's, the
 * shared ones) and the CommonGrants application routes. Not the public pages, which anyone may
 * read, and not the sign-in flow, which runs before anyone is signed in and holds no records.
 */
const inScope = (path: string) => (path.startsWith("/gms/") && !path.startsWith("/gms/public/") && !path.startsWith("/gms/passport/signin/")) || path.startsWith("/common-grants/applications");

/** What the cowriter may do on the draft they were invited into (with that draft's ids). */
const DRAFT_ROUTES = new Set([
  "get /gms/outside-applications/{id}",
  "get /gms/outside-applications/{id}/questions",
  "get /gms/outside-applications/{id}/comments",
  "post /gms/outside-applications/{id}/comments/{commentId}/resolve",
  "put /gms/outside-questions/{qid}/answer",
  "patch /gms/outside-questions/{qid}",
  "get /gms/outside-questions/{qid}/answers",
  "post /gms/outside-questions/{qid}/comments",
  // F1: the pass to the invited draft's live channel (who is here, soft locks, "saved" nudges).
  "post /gms/presence/passes",
]);

/**
 * The person's own things, which come with any sign-in and hold none of the workspace's records:
 * who they are, their memberships and sign-in sessions, their notifications and settings, the
 * notes they dismissed, links they were sent, the agents they connected themselves, leaving the
 * workspace and starting one of their own, and what this server offers.
 */
const PERSONAL_ROUTES = new Set([
  "get /gms/me",
  "get /gms/whoami",
  "get /gms/workspaces",
  "post /gms/workspaces",
  "get /gms/me/notes",
  "post /gms/me/notes/dismiss",
  "get /gms/me/notification-preferences",
  "put /gms/me/notification-preferences",
  "get /gms/me/sessions",
  "delete /gms/me/sessions/{sessionId}",
  "put /gms/me/preferences",
  "get /gms/notifications",
  "post /gms/notifications/read",
  "post /gms/invitations/accept",
  "post /gms/award-invitations/lookup",
  "post /gms/award-invitations/accept",
  "post /gms/award-invitations/decline",
  "delete /gms/workspaces/{id}/members/me",
  "get /gms/config",
  "get /gms/mcp-connections",
  // Connecting the person's own Passport organization, to start a workspace of their own: bound to
  // them by the sealed state. Linking this workspace needs its admin (the start's workspaceId case
  // is in bodyFor and must be refused).
  "get /gms/passport/consent/callback",
  "post /gms/passport/consent/finish",
  // Joining workspaces through single sign-on is the person's own sign-in (refused without one),
  // and whether the person moderates the template gallery is about them, not the workspace.
  "post /gms/sso/join",
  "get /gms/gallery/moderation/me",
  // E4: whether the person moderates the partner directory, and counting a workspace they just
  // made for the link they came from (their own new workspace only: a sample id is refused with 422).
  "get /gms/partners/moderation/me",
  "post /gms/referrals/claim",
  // One-click unsubscribe from a digest: public, the signed link is the proof (a sample token is refused with 400).
  "post /gms/digests/unsubscribe",
  "get /gms/digests/unsubscribe",
  // F3: whether the person is one of OpenGrants' operators is about them, not the workspace.
  "get /gms/operator/me",
]);

/**
 * Routes anyone may call without signing in, so a cowriter may too: the template gallery's approved
 * items, the switch pages' free migration request, and a funder's public open data feed (404 while
 * the funder has not published it). They hold none of the workspace's records.
 */
const ANYONE_ROUTES = new Set([
  "get /gms/gallery",
  "get /gms/gallery/{slug}",
  "get /gms/migration-requests/form",
  "post /gms/migration-requests/preview",
  "post /gms/migration-requests",
  "get /gms/open-data/{handle}/360giving.json",
]);

/** The v1.8.0 areas a cowriter must never reach: reports, open data, SSO settings, gallery share and moderation, review, dockets. */
const WAVE_B_AREAS: Record<string, RegExp> = {
  reports: /^\w+ \/gms\/(reports|report-views|report-files)(\/|$)/,
  "open data": /^\w+ \/gms\/open-data\//,
  "single sign-on settings": /^\w+ \/gms\/sso\//,
  "gallery share and moderation": /^\w+ \/gms\/(workspaces\/\{workspaceId\}\/gallery|gallery\/moderation)\//,
  review: /^\w+ \/gms\/(competitions\/\{id\}\/(coi-policy|conflicts-register|review-settings)|review-assignments)/,
  docket: /^\w+ \/gms\/competitions\/\{id\}\/dockets/,
};

/** The v1.9.0 areas a cowriter must never reach: award sharing, social posting, funds, the send package, guest review, digests, importer adapters. */
const WAVE_C_AREAS: Record<string, RegExp> = {
  "award sharing": /^\w+ \/gms\/(awards\/\{id\}\/(sharing|confidential)|my\/awards\/\{id\}\/(sharing|listing)|award-sharing\/|programs\/\{id\}\/award-sharing)/,
  "social posting": /^\w+ \/gms\/social(\/|$)/,
  funds: /^\w+ \/gms\/funds(\/|$)/,
  "send package": /^\w+ \/gms\/(outside-applications\/\{id\}\/package|send-package\/)/,
  "guest review": /^\w+ \/gms\/guest-review\//,
  digests: /^\w+ \/gms\/digests(\/preview)?$/,
  "importer adapters": /^\w+ \/gms\/imports\/(connections|zengine|runs\/\{id\}\/files)/,
};

/**
 * The v1.12.0 areas a cowriter must never reach, on the invited draft too: the connected apps (the
 * Google Drive attach and save-to-Drive, Slack, the person's calendar on the team's deadlines),
 * the organization profile panel, the share kit, peer invitations and partner settings, imported
 * history, translations and Share this call.
 */
const WAVE_E_AREAS: Record<string, RegExp> = {
  "connected apps (Drive attach, Slack, Calendar)": /^\w+ \/gms\/connected-apps\//,
  "the organization profile panel": /^\w+ \/gms\/reusable-profile$/,
  "share kit": /^\w+ \/gms\/(share-kit\/|my\/awards\/\{id\}\/sharing\/carousel\.pdf)/,
  "peer invitations and partners": /^\w+ \/gms\/(peer-invitations|partner-settings)/,
  "imported history": /^\w+ \/gms\/history(\/|$)/,
  translations: /^\w+ \/gms\/translations\//,
  "share this call": /^\w+ \/gms\/opportunities\/\{id\}\/syndication/,
};

/** A report definition the report builder accepts. */
const REPORT = { dataSet: "awards", columns: ["title", "amount"], filters: [], groupBy: [], aggregates: [], sort: [] };

/** Bodies the document's schema alone does not make valid (cross-field rules, ids that must exist). */
function bodyFor(key: string, ids: Ids, own: boolean): unknown {
  const oa = own ? ids.oa : ids.otherOa;
  const bodies: Record<string, unknown> = {
    "put /gms/outside-questions/{qid}/answer": { body: "Families travel 46 miles to reach care." },
    "patch /gms/outside-questions/{qid}": { status: "draft" },
    "post /gms/outside-questions/{qid}/comments": { body: "First pass done." },
    "post /gms/outside-questions/{qid}/draft": {},
    "post /gms/outside-applications": { title: "New draft", funderName: "Elm Fund", stage: "drafting" },
    "post /gms/outside-applications/{id}/stage": { to: "submitted" },
    "post /gms/outside-applications/{id}/submit": { submittedAt: "2027-04-15", method: "portal" },
    "post /gms/outside-applications/{id}/decision": { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, grantStart: "2027-07-01", grantEnd: "2028-06-30" },
    "post /gms/outside-applications/{id}/questions": { questions: [{ prompt: "A new question" }] },
    "post /gms/outside-applications/{id}/questions/parse": { text: "1. A (100 words)\n2. B" },
    "post /gms/outside-applications/{id}/documents": { name: "budget.txt", mime: "text/plain", contentBase64: btoa("Budget") },
    "post /gms/outside-applications/{id}/obligations": { kind: "report", title: "Interim report", dueOn: "2027-03-01" },
    "post /gms/outside-applications/{id}/milestones": { tasks: [{ title: "Draft due", dueOn: "2027-05-18" }] },
    "post /gms/outside-applications/{id}/go-no-go": { eligibility: "pass", scores: { fit: 4, capacity: 3, effort: 3, relationship: 2 }, decision: "go", to: "drafting" },
    "post /gms/outside-applications/{id}/guidelines": { name: "guidelines.txt", mime: "text/plain", contentBase64: btoa("Applicants must serve rural counties.") },
    "post /gms/outside-applications/{id}/required-documents/use-from-vault": { label: "IRS determination letter", documentId: ids.vaultDoc },
    "put /gms/outside-applications/{id}/required-documents": { items: [{ label: "IRS determination letter" }] },
    "post /gms/outside-applications/{id}/consulting-request": { contactName: "Ana Ruiz", contactEmail: "ana@aldercreekfs.example", includeAnswers: true },
    "post /gms/outside-applications/{id}/consulting-request/preview": { contactName: "Ana Ruiz", contactEmail: "ana@aldercreekfs.example", includeAnswers: true },
    "post /gms/outside-applications/import": { csv: "title,funder\nImported,Elm Fund", mapping: { title: "title", funderName: "funder" } },
    "post /gms/outside-obligations/{oid}/status": { to: "done", completedOn: "2027-02-03" },
    "post /gms/outside-obligations/{oid}/submit": { submittedAt: "2027-03-02", confirmationRef: "NW-1" },
    "post /gms/outside-obligations/{oid}/questions": { prompt: "What changed?" },
    "patch /gms/outside-obligations/{oid}": { notes: "Send to Ana." },
    "patch /gms/outside-obligation-series/{sid}": { everyMonths: 12 },
    "post /gms/vault": { name: "Board list.pdf", mime: "application/pdf", contentBase64: btoa("%PDF-1.4"), docType: "board_list" },
    "patch /gms/vault/{docId}": { name: "Renamed.pdf" },
    "post /gms/funder-records": { name: "Elm Fund" },
    "patch /gms/funder-records/{id}": { notes: "Met in March." },
    "post /gms/my/answers": { title: "Need statement", body: "Families travel 46 miles." },
    "patch /gms/my/answers/{id}": { body: "Families travel 47 miles." },
    "post /gms/my/answers/{id}/adapt": { question: "Describe the need." },
    "post /gms/draft-invitations": { email: "friend@example.org", draft: { kind: "outside_application", id: oa } },
    "post /gms/presence/passes": { draft: { kind: "outside_application", id: oa } },
    "post /gms/assist/summary": { applicationId: ids.app },
    "post /gms/assist/summarize": { applicationId: ids.app },
    "post /gms/assist/compare-rubric": { applicationId: ids.app, rubricId: NOWHERE },
    "post /gms/assist/draft-letter": { applicationId: ids.app, templateId: "decline" },
    "post /gms/assist/adapt-answer": { answerId: ids.answer, question: "Describe the need." },
    "put /common-grants/applications/{appId}/forms/{formId}": { response: { projectTitle: "Mobile Health Navigation" } },
    "post /common-grants/applications/start": { competitionId: ids.comp },
    "post /gms/my/applications/{id}/comments": { body: "Looks good." },
    "post /gms/my/applications/{id}/sections/assign": { formId: ids.form, sections: { Project: COWRITER } },
    "post /gms/my/applications/{id}/forms/{formId}/insert-answer": { answerId: ids.answer, path: "/projectTitle" },
    "post /gms/my/applications/{id}/attachments": { name: "budget.txt", mime: "text/plain", contentBase64: btoa("Budget") },
    "post /gms/my/applications/{id}/interview/confirm": { slotId: "slot_1" },
    "post /gms/my/submissions/{id}/share": { funderWorkspaceId: NOWHERE },
    "post /gms/workspaces/{id}/invitations": { email: "friend@example.org", role: "editor" },
    "post /gms/workspaces/{id}/members": { userId: COWRITER, role: "admin" },
    "patch /gms/workspaces/{id}/members/{userId}": { role: "viewer" },
    "patch /gms/workspaces/{id}": { displayName: "Renamed" },
    "patch /gms/workspaces/{id}/profile": { mission: "Changed." },
    "post /gms/discover/saved": { source: "gms", externalId: ids.comp, title: "Community Health Grants 2027" },
    "post /gms/tasks": { title: "A task", subjectType: "outside_application", subjectId: ids.otherOa },
    "post /gms/imports/read": { target: "outside_applications", source: { kind: "csv", text: "Grant,Funder\nA,B" } },
    "post /gms/imports/preview": { target: "outside_applications", source: { kind: "csv", text: "Grant,Funder\nA,B" }, mapping: { title: "Grant", funderName: "Funder" } },
    "post /gms/passport/consent/start": { workspaceId: WS_APPLICANT },
    // Funder routes: refused for the workspace kind, once the body passes.
    "post /gms/applications/{id}/assign": { userId: COWRITER },
    "put /gms/competitions/{id}/forms": { forms: {} },
    "put /gms/competitions/{id}/rubric": { rubricId: NOWHERE },
    "put /gms/competitions/{id}/stages": { stages: [{ key: "loi", label: "Letter of intent", forms: {} }] },
    "put /gms/contacts": { contacts: [{ name: "Ana Ruiz", email: "ana@example.org" }] },
    "post /gms/eligibility/evaluate": { opportunityId: NOWHERE },
    "patch /gms/review-assignments/{id}": { action: "declare_coi", hasConflict: true },
    "post /gms/rubrics": { name: "Screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] },
    "post /gms/submissions/{id}/return": { note: "Please add the budget." },
    "put /gms/awards/{id}/schedule": { tranches: [{ percent: 100, condition: { type: "manual" } }] },
    // v1.8.0 funder routes: valid bodies, so the refusal is the workspace's and not the body's.
    "put /gms/competitions/{id}/coi-policy": { text: "Tell us about any organization you work for, advise or give to." },
    "post /gms/reports/preview": REPORT,
    "post /gms/reports/export": { definition: REPORT },
    "post /gms/report-views": { name: "Awards", definition: REPORT },
    "put /gms/report-views/{id}/schedule": { cadence: "weekly", weekday: 1, recipientUserIds: [COWRITER] },
  };
  return bodies[key];
}

/** Fields the schema's sample gets wrong (formats the document does not state), merged onto it. */
const PATCHES: Record<string, Record<string, unknown>> = {
  "post /gms/awards/direct": { recipient: { contactEmail: "ana@example.org" }, amount: { value: "25000.00" } },
  "post /gms/bank-transactions/{id}/match": { destinationLast4: "1234" },
  "post /gms/connectors/google_workspace/export": { subjectId: NOWHERE, folderId: "abcdefghijkl" },
  "post /gms/custom-mcp-servers": { url: "https://mcp.example.org/" },
  "post /gms/grantees/{applicantWorkspaceId}/propose-change": { patch: { name: "New name" } },
  "post /gms/review-assignments/invite": { email: "reviewer@example.org" },
  "post /gms/tranches/{id}/record-external": { paidAt: "2027-01-15", destinationLast4: "1234" },
  "post /gms/webhooks": { url: "https://hooks.example.org/gms" },
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function merged(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(patch)) return base.map((b, i) => (i < patch.length ? merged(b, patch[i]) : b));
  if (isObject(base) && isObject(patch)) return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(patch)])].map((k) => [k, k in patch ? merged(base[k], patch[k]) : base[k]]));
  return patch === undefined ? base : patch;
}

/** Query strings for the routes that need one. */
function queryFor(key: string, ids: Ids): string {
  const q: Record<string, string> = {
    "get /gms/draft-invitations": `kind=outside_application&id=${ids.oa}`,
    "get /gms/pipeline/calendar": "month=2027-05",
    "get /gms/threads": `subjectType=application&subjectId=${ids.app}`,
    "get /gms/assist/summary": `applicationId=${ids.app}`,
    "get /gms/imports/runs": "target=outside_applications",
    "get /gms/imports/sources": "target=outside_applications",
  };
  return q[key] ? `?${q[key]}` : "";
}

interface Ids {
  oa: string;
  q1: string;
  q2: string;
  comment: string;
  otherOa: string;
  otherQ: string;
  otherComment: string;
  awardedOa: string;
  obligation: string;
  series: string;
  ownDoc: string;
  otherDoc: string;
  vaultDoc: string;
  funderRecord: string;
  answer: string;
  app: string;
  appUuid: string;
  form: string;
  comp: string;
  task: string;
  importRun: string;
}

/** The values a path parameter takes: the draft's own ids (`own`) or the team's other records'. */
function paramsFor(path: string, ids: Ids): { own: boolean; values: Record<string, string> }[] {
  const outside = path.startsWith("/gms/outside-applications/{id}") || path.startsWith("/gms/outside-awards/{id}");
  const shared: Record<string, string> = {
    oid: ids.obligation,
    sid: ids.series,
    appId: ids.appUuid,
    formId: ids.form,
    userId: USER_APPLICANT,
    sessionId: NOWHERE,
    file: "nothing.ics",
    listingId: "og-listing-1",
    competitionId: ids.comp,
    clientId: NOWHERE,
    provider: "google_workspace",
    alertId: NOWHERE,
    applicantWorkspaceId: WS_APPLICANT,
    granteeId: NOWHERE,
    deliveryId: NOWHERE,
    docketId: NOWHERE,
    slug: STARTER_ITEMS[0]!.slug,
    handle: "riverbend",
    workspaceId: WS_APPLICANT,
  };
  const idFor = (own: boolean) => {
    if (outside) return own ? ids.oa : path.startsWith("/gms/outside-awards/") ? ids.awardedOa : ids.otherOa;
    if (path.startsWith("/gms/workspaces/{id}")) return WS_APPLICANT;
    if (path.startsWith("/gms/vault/")) return ids.vaultDoc;
    if (path.startsWith("/gms/funder-records/")) return ids.funderRecord;
    if (path.startsWith("/gms/my/answers/")) return ids.answer;
    if (path.startsWith("/gms/my/applications/") || path.startsWith("/gms/applications/")) return ids.app;
    if (path.startsWith("/gms/tasks/")) return ids.task;
    if (path.startsWith("/gms/imports/runs/")) return ids.importRun;
    return NOWHERE;
  };
  const variant = (own: boolean) => ({
    own,
    values: { ...shared, id: idFor(own), qid: own ? ids.q1 : ids.otherQ, commentId: own ? ids.comment : ids.otherComment, docId: path.startsWith("/gms/vault/") ? ids.vaultDoc : own ? ids.ownDoc : ids.otherDoc },
  });
  const ownable = outside || path.startsWith("/gms/outside-questions/") || path === "/gms/presence/passes";
  return ownable ? [variant(true), variant(false)] : [variant(false)];
}

/** A body the document's schema accepts: required fields only, the first of each choice. */
function sample(doc: Doc, s: Schema | undefined, depth = 0): unknown {
  if (!s || depth > 8) return {};
  if (s.$ref) return sample(doc, doc.components.schemas[s.$ref.replace("#/components/schemas/", "")], depth + 1);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((p) => sample(doc, p, depth + 1) as object));
  const choice = s.anyOf ?? s.oneOf;
  if (choice) return sample(doc, choice.find((c) => !(c.enum && c.enum.length === 1 && c.enum[0] === null)) ?? choice[0], depth + 1);
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case "object":
      return Object.fromEntries((s.required ?? []).map((k) => [k, sample(doc, s.properties?.[k], depth + 1)]));
    case "array":
      return Array.from({ length: Math.max(s.minItems ?? 0, 1) }, () => sample(doc, s.items, depth + 1));
    case "string":
      if (s.format === "uuid") return NOWHERE;
      if (s.format === "date") return "2027-01-15";
      if (s.format === "date-time") return "2027-01-15T00:00:00Z";
      if (s.format === "email") return "someone@example.org";
      if (s.format === "uri" || s.format === "url") return "https://example.org/";
      return "Sample text".padEnd(s.minLength ?? 0, ".");
    case "integer":
    case "number":
      return s.minimum ?? 1;
    case "boolean":
      return true;
    default:
      return s.properties ? sample(doc, { ...s, type: "object" }, depth + 1) : {};
  }
}

let h: Harness;
let s: Scenario;
let doc: Doc;
let ids: Ids;
let me: Record<string, string>;

async function sessionAs(userId: string, email: string) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  // A session id, as Supabase puts in every session: a draft's live-channel pass is bound to one.
  const token = await new SignJWT({ aal: "aal2", email, role: "authenticated", session_id: COWRITER_SESSION }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
  return { ...bearer(token).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
}
const created = async <T>(r: Promise<{ status: number; body: unknown }>): Promise<T> => {
  const res = await r;
  if (res.status >= 300) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { data: T }).data;
};

/** The team's records around the invited draft, every one marked; and the cowriter, signed in. */
async function setUp() {
  h = await harness();
  s = await scenario(h);
  // The starter library, as migration 0036 ships it, so the gallery's routes have an item to name.
  for (const g of STARTER_ITEMS) await h.repos.table("gallery_items").insert({ id: g.id, slug: g.slug, kind: g.kind, title: g.title, summary: g.summary, tags: g.tags as never, author_workspace_id: null, licence: "CC-BY-4.0", status: "approved", version: 1, snapshot: g.snapshot as never, uses_count: 0, published_at: STARTERS_PUBLISHED_AT, withdrawn_at: null });
  doc = parse(readFileSync(SPEC, "utf8")) as Doc;
  const a = s.applicant;
  const oa = await created<{ id: string }>(s.call(a, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", stage: "drafting" }));
  const [q1, q2] = await created<{ id: string }[]>(s.call(a, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Describe the need your project addresses." }, { prompt: "How will you measure success?" }] }));
  const comment = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-questions/${q1!.id}/comments`, { body: "Start with the county numbers." }));
  await created(s.call(a, "PUT", `/gms/outside-questions/${q1!.id}/answer`, { body: "A first line from the team." }));
  const other = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-applications`, { title: `${MARK} other draft`, funderName: `${MARK} Elm Fund`, stage: "drafting" }));
  const [otherQ] = await created<{ id: string }[]>(s.call(a, "POST", `/gms/outside-applications/${other.id}/questions`, { questions: [{ prompt: `${MARK} question` }] }));
  await s.call(a, "PUT", `/gms/outside-questions/${otherQ!.id}/answer`, { body: `${MARK} answer` });
  const otherComment = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-questions/${otherQ!.id}/comments`, { body: `${MARK} comment` }));
  const awarded = await created<{ id: string }>(s.call(a, "POST", "/gms/outside-applications", { title: `${MARK} awarded grant`, funderName: `${MARK} Oak Trust` }));
  await created(s.call(a, "POST", `/gms/outside-applications/${awarded.id}/submit`, { submittedAt: "2027-01-10", method: "portal" }));
  await created(s.call(a, "POST", `/gms/outside-applications/${awarded.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "60000.00", currency: "USD" }, grantStart: "2027-01-01", grantEnd: "2028-12-31" }));
  const obligation = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-applications/${awarded.id}/obligations`, { kind: "report", title: `${MARK} interim report`, dueOn: "2027-03-01" }));
  const series = await created<{ series: { id: string } }>(s.call(a, "POST", `/gms/outside-applications/${awarded.id}/obligations`, { kind: "report", title: `${MARK} progress report`, series: { everyMonths: 6, startOn: "2027-07-01" } }));
  const ownDoc = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-applications/${oa.id}/documents`, { name: `${MARK}-budget.txt`, mime: "text/plain", contentBase64: btoa(MARK) }));
  const otherDoc = await created<{ id: string }>(s.call(a, "POST", `/gms/outside-applications/${other.id}/documents`, { name: `${MARK}-letter.txt`, mime: "text/plain", contentBase64: btoa(MARK) }));
  const vaultDoc = await created<{ id: string }>(s.call(a, "POST", "/gms/vault", { name: `${MARK} IRS letter.pdf`, mime: "application/pdf", contentBase64: btoa("%PDF-1.4"), docType: "irs_letter", expiresOn: "2028-01-01" }));
  const funderRecord = await created<{ id: string }>(s.call(a, "POST", "/gms/funder-records", { name: `${MARK} Northwind`, notes: `${MARK} notes` }));
  const answer = await created<{ id: string }>(s.call(a, "POST", "/gms/my/answers", { title: `${MARK} need statement`, body: `${MARK} families travel 46 miles.` }));
  const started = await created<{ id: string }>(s.call(a, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp }));
  await h.repos.table("applications").update({ id: started.id }, { title: `${MARK} built-in application` });
  await s.call(a, "PUT", `/common-grants/applications/${started.id}/forms/${s.uuid.loi}`, { response: { projectTitle: `${MARK} project` } });
  await s.call(a, "POST", `/gms/outside-applications/${other.id}/milestones`, { tasks: [{ title: `${MARK} draft due`, dueOn: "2027-05-18" }] });
  const tasks = await created<{ id: string }[]>(s.call(a, "GET", "/gms/tasks"));
  const importRun = await created<{ run: { id: string } }>(s.call(a, "POST", "/gms/imports/preview", { target: "outside_applications", source: { kind: "csv", text: `Grant,Funder\n${MARK} imported grant,${MARK} Birch Fund`, fileName: `${MARK}.csv` }, mapping: { title: "Grant", funderName: "Funder" } }));

  // The admin invites the cowriter into the first draft's first question; they accept.
  await created(s.call(a, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oa.id, questionId: q1!.id } }));
  const link = [...h.mailer.sent].reverse().find((m) => m.to.includes(COWRITER_EMAIL))!.text.match(/https:\/\/\S+/)![0];
  me = await sessionAs(COWRITER, COWRITER_EMAIL);
  const accepted = await s.call<{ data: { role: string } }>(me, "POST", "/gms/invitations/accept", { token: new URL(link).searchParams.get("token") });
  expect(accepted.status).toBe(200);
  expect(accepted.body.data.role).toBe("consultant");
  h.env.ASSISTANT_ENABLED = "true";

  ids = {
    oa: oa.id,
    q1: q1!.id,
    q2: q2!.id,
    comment: comment.id,
    otherOa: other.id,
    otherQ: otherQ!.id,
    otherComment: otherComment.id,
    awardedOa: awarded.id,
    obligation: obligation.id,
    series: series.series.id,
    ownDoc: ownDoc.id,
    otherDoc: otherDoc.id,
    vaultDoc: vaultDoc.id,
    funderRecord: funderRecord.id,
    answer: answer.id,
    app: `app_${started.id}`,
    appUuid: started.id,
    form: s.uuid.loi,
    comp: s.uuid.comp,
    task: tasks[0]?.id ?? NOWHERE,
    importRun: importRun.run.id,
  };
}

interface Call {
  key: string;
  own: boolean;
  url: string;
  status: number;
  text: string;
}

describe.skipIf(!existsSync(SPEC))("a cowriter invited into one outside draft, on every route in the document", () => {
  const calls: Call[] = [];

  beforeAll(async () => {
    await setUp();
    const ops = Object.entries(doc.paths).flatMap(([path, item]) => METHODS.filter((m) => item[m] && inScope(path)).map((m) => ({ path, method: m, op: item[m]! })));
    // Leaving the workspace ends the membership, so it goes last.
    ops.sort((x, y) => Number(x.path.endsWith("/members/me")) - Number(y.path.endsWith("/members/me")));
    for (const { path, method, op } of ops) {
      const key = `${method} ${path}`;
      for (const { own, values } of paramsFor(path, ids)) {
        const missing = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((p) => !(p in values));
        if (missing.length) throw new Error(`${key}: give the path parameter ${missing.join(", ")} a value in paramsFor()`);
        const url = path.replace(/\{(\w+)\}/g, (_m, p: string) => encodeURIComponent(values[p]!)) + queryFor(key, ids);
        const content = op.requestBody?.content ?? {};
        const type = Object.keys(content)[0];
        const body = method === "get" || method === "delete" ? undefined : (bodyFor(key, ids, own) ?? merged(sample(doc, type ? content[type]!.schema : undefined), PATCHES[key]));
        const headers = { ...me, ...(type && type !== "application/x-www-form-urlencoded" ? { "Content-Type": type } : {}) };
        const res = await h.request(url, { method: method.toUpperCase(), headers, ...(body === undefined ? {} : { body: type === "application/x-www-form-urlencoded" ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) }) });
        calls.push({ key, own, url, status: res.status, text: await res.text() });
      }
    }
  }, 120_000);

  it("covers the routes the brief names", () => {
    const keys = new Set(calls.map((c) => c.key));
    for (const k of ["get /gms/my/applications", "get /gms/outside-applications", "get /gms/vault", "patch /gms/workspaces/{id}/profile", "get /gms/funder-records", "get /gms/pipeline", "get /gms/pipeline/calendar", "get /gms/workspaces/{id}/members", "post /gms/assist/summarize", "get /common-grants/applications/{appId}"]) expect(keys, k).toContain(k);
    expect(calls.length).toBeGreaterThan(300);
  });

  it("opens the invited draft, its questions and its comments", () => {
    const ok = (key: string) => calls.find((c) => c.key === key && c.own)!;
    for (const key of ["get /gms/outside-applications/{id}", "get /gms/outside-applications/{id}/questions", "get /gms/outside-applications/{id}/comments", "put /gms/outside-questions/{qid}/answer", "patch /gms/outside-questions/{qid}", "get /gms/outside-questions/{qid}/answers", "post /gms/outside-questions/{qid}/comments"]) {
      const c = ok(key);
      expect(c.status, `${key} ${c.text.slice(0, 200)}`).toBeLessThan(300);
    }
  });

  it("keeps the person's own things working", () => {
    for (const key of ["get /gms/me", "get /gms/whoami", "get /gms/workspaces", "get /gms/me/notes", "get /gms/me/notification-preferences", "get /gms/notifications", "get /gms/me/sessions", "get /gms/config", "get /gms/mcp-connections"]) {
      const c = calls.find((x) => x.key === key)!;
      expect(c.status, `${key} ${c.text.slice(0, 200)}`).toBe(200);
    }
  });

  it("answers 403 or 404 to everything else", () => {
    const open = calls.filter((c) => !(c.own && DRAFT_ROUTES.has(c.key)) && !PERSONAL_ROUTES.has(c.key) && !ANYONE_ROUTES.has(c.key) && c.status !== 403 && c.status !== 404);
    expect(open.map((c) => `${c.status} ${c.key}${c.own ? " (the invited draft)" : ""} ${c.text.slice(0, c.status === 400 ? 600 : 160)}`)).toEqual([]);
  });

  it("reaches none of reports, open data, SSO settings, gallery share, review or dockets", () => {
    for (const [area, re] of Object.entries(WAVE_B_AREAS)) {
      const mine = calls.filter((c) => re.test(c.key) && !PERSONAL_ROUTES.has(c.key) && !ANYONE_ROUTES.has(c.key));
      expect(mine.length, `${area}: routes in the document`).toBeGreaterThan(0);
      expect(mine.filter((c) => c.status !== 403 && c.status !== 404).map((c) => `${area}: ${c.status} ${c.key} ${c.text.slice(0, 160)}`)).toEqual([]);
    }
  });

  it("reaches none of award sharing, social posting, funds, the send package, guest review, digests or importer adapters", () => {
    for (const [area, re] of Object.entries(WAVE_C_AREAS)) {
      const mine = calls.filter((c) => re.test(c.key) && !PERSONAL_ROUTES.has(c.key) && !ANYONE_ROUTES.has(c.key));
      expect(mine.length, `${area}: routes in the document`).toBeGreaterThan(0);
      // Even on the invited draft: its package is the team's to send, not a cowriter's.
      expect(mine.filter((c) => c.status !== 403 && c.status !== 404).map((c) => `${area}: ${c.status} ${c.key}${c.own ? " (the invited draft)" : ""} ${c.text.slice(0, 160)}`)).toEqual([]);
    }
  });

  it("reaches none of the connected apps, the profile panel, the share kit, partners, imported history, translations or Share this call", () => {
    const keys = new Set(calls.map((c) => c.key));
    for (const k of ["post /gms/connected-apps/google-drive/fetch", "post /gms/connected-apps/google-drive/save", "get /gms/reusable-profile", "get /gms/connected-apps/calendar", "put /gms/connected-apps/slack"]) expect(keys, k).toContain(k);
    for (const [area, re] of Object.entries(WAVE_E_AREAS)) {
      const mine = calls.filter((c) => re.test(c.key) && !PERSONAL_ROUTES.has(c.key) && !ANYONE_ROUTES.has(c.key));
      expect(mine.length, `${area}: routes in the document`).toBeGreaterThan(0);
      expect(mine.filter((c) => c.status !== 403 && c.status !== 404).map((c) => `${area}: ${c.status} ${c.key}${c.own ? " (the invited draft)" : ""} ${c.text.slice(0, 160)}`)).toEqual([]);
    }
  });

  it("joins the invited draft's live channel only: no pass for another draft or the team's applications (v1.13.0)", async () => {
    const own = calls.find((c) => c.key === "post /gms/presence/passes" && c.own)!;
    expect(own.status, own.text.slice(0, 200)).toBe(200);
    expect((JSON.parse(own.text) as { data: { topic: string } }).data.topic).toBe(`draft:outside:${ids.oa}`);
    const other = calls.find((c) => c.key === "post /gms/presence/passes" && !c.own)!;
    expect(other.status, other.text.slice(0, 200)).toBe(404);
    const res = await h.request("/gms/presence/passes", { method: "POST", headers: me, body: JSON.stringify({ draft: { kind: "application", id: ids.app } }) });
    const refusal = await res.text();
    expect([403, 404], refusal.slice(0, 200)).toContain(res.status);
    expect(refusal).not.toContain(MARK);
    // The only pass written is the invited draft's, for this session. Soft locks and "saved" nudges
    // travel on that channel, which Realtime opens only to a session holding a live pass for it
    // (migration 0050; supabase/tests/database/50_co_editing.test.sql): there is no lock route.
    expect((await h.repos.table("presence_passes").find({ user_id: COWRITER })).map((p) => p.topic)).toEqual([`draft:outside:${ids.oa}`]);
    expect(Object.keys(doc.paths).filter((p) => /lock/i.test(p))).toEqual([]);
  });

  it("never answers with anything of the records it may not see", () => {
    const leaks = calls.filter((c) => c.text.includes(MARK));
    expect(leaks.map((c) => `${c.status} ${c.key}${c.own ? " (the invited draft)" : ""} ${c.text.slice(0, 160)}`)).toEqual([]);
  });

  it("changed none of them", async () => {
    expect((await h.repos.table("outside_applications").one({ id: ids.otherOa }))).toMatchObject({ title: `${MARK} other draft`, stage: "drafting", archived_at: null });
    expect(await h.repos.table("documents").one({ id: ids.vaultDoc })).toMatchObject({ name: `${MARK} IRS letter.pdf` });
    expect(await h.repos.table("funder_records").one({ id: ids.funderRecord })).toMatchObject({ name: `${MARK} Northwind` });
    expect((await h.repos.table("workspace_members").find({ workspace_id: WS_APPLICANT })).find((m) => m.user_id === USER_APPLICANT)!.role).toBe("admin");
    expect((await h.repos.table("invitations").find({ workspace_id: WS_APPLICANT })).filter((i) => i.email !== COWRITER_EMAIL)).toEqual([]);
  });
});
