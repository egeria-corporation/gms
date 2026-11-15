// SPDX-License-Identifier: AGPL-3.0-only
// Reviews (build spec §10.5): assignment (manual and automatic, with conflict-of-interest
// exclusion), COI declaration, rubric scoring, blind mode, external reviewers, and the ranking the
// panel reads. Scores are computed by `@gms/review`; nothing derived is stored.
import { autoAssign, canSeeOtherReviews, DEFAULT_COI_POLICY, declaredMatches, detectCoi, emailDomain, matchDeclaredOrgs, rankApplications, redactText, scoreReview, type AssignableApplication, type Criterion, type DeclaredOrg, type ReviewerProfile, type Rubric, type Scores, type ViewerRole } from "@gms/review";
import { toCsv } from "@gms/importers";
import { z } from "zod";
import { randomToken, sha256b64url } from "../auth/crypto.ts";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { stagesOf, transitionApp, type App } from "./apply.ts";
import { orgFacts } from "./profile.ts";
import { STAFF_ROLES, emitFor } from "./awards.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { getApplicationDetail } from "./inbox.ts";
import type { Row } from "./repos/types.ts";
import { anonymityFor, candidateOf, currentPolicy, declaredAtSigning, isReviewerRole, redactFor, reviewStagesOf, signedCompetitions, type ReviewStage } from "./review-privacy.ts";

type Assignment = Row<"review_assignments">;
type Review = Row<"reviews">;
type Member = Row<"workspace_members">;
type Comp = Row<"competitions">;
type Stage = ReviewStage;

const REVIEWER_ROLES: readonly string[] = ["reviewer", "external_reviewer"];
/** Who may be assigned a review: reviewers, and staff reviewing alongside them. */
const ASSIGNABLE: readonly string[] = ["admin", "program_officer", "reviewer", "external_reviewer"];
const PANEL_ROLES = [...STAFF_ROLES, "observer", "auditor"] as const;
const REVIEWABLE: readonly string[] = ["submitted", "screening", "under_review", "interview", "recommended"];

const isReviewer = (ws: ServiceWorkspace) => !!ws.role && REVIEWER_ROLES.includes(ws.role);
const stageOf = (c: Comp, key: string): Stage | undefined => (stagesOf(c) as Stage[]).find((s) => s.key === key);
const coiOf = (a: Assignment) => (a.coi as { declared?: boolean; reason?: string; at?: string; source?: string } | null) ?? {};
/** Recused because the reviewer declared the organization when signing the competition's policy. */
const recusedAtSigning = (a: Assignment) => a.status === "recused" && coiOf(a).source === "policy";
const UNSIGNED = "Sign the conflict-of-interest policy first";
const unsigned = (competitionId: string) => new ApiError(409, "coi_policy_unsigned", `${UNSIGNED}. Applications in this competition open once you have signed it`, [{ code: "coi_policy_unsigned", field: "competitionId", detail: apiId("competition", competitionId) }]);

async function rubricRow(ctx: ServiceContext, id: string, version?: number): Promise<Row<"rubrics">> {
  const rows = await ctx.repos.table("rubrics").find(version ? { id, version } : { id }, { orderBy: "version", ascending: false, limit: 1 });
  return required(rows[0], "Rubric");
}

export const toRubric = (r: Row<"rubrics">): Rubric => ({ id: r.id, version: r.version, criteria: (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[], ...(typeof (r.overall as { spreadThreshold?: unknown } | null)?.spreadThreshold === "number" ? { spreadThreshold: (r.overall as { spreadThreshold: number }).spreadThreshold } : {}) });

/**
 * The applicant's email and web domains, by where they come from. Only Passport's record excludes a
 * reviewer automatically (review F-05): a self-declared profile is the organization's own word, so
 * using it would let an applicant choose which reviewers count as conflicted, or hide its real
 * domain. Self-declared domains are only a hint shown to staff; they never exclude or include.
 */
function domainsOf(applicant: Row<"workspaces"> | null | undefined): { verified: string[]; selfDeclared: string[] } {
  if (!applicant) return { verified: [], selfDeclared: [] };
  const facts = orgFacts(applicant);
  const org = facts.org as { emails?: Record<string, unknown>; socials?: { website?: unknown } };
  const out = new Set<string>();
  for (const v of Object.values(org.emails ?? {})) if (typeof v === "string" && v.includes("@")) out.add(emailDomain(v));
  if (typeof org.socials?.website === "string") {
    try {
      out.add(new URL(org.socials.website).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      // Not a URL: no domain to compare.
    }
  }
  return facts.source === "passport" ? { verified: [...out], selfDeclared: [] } : { verified: [], selfDeclared: [...out] };
}

/**
 * A hint for staff when the reviewer's email domain matches a domain the applicant gave in its own,
 * unverified profile. The same domain rule as the automatic check (shared mailbox providers never
 * match), but it changes no assignment.
 */
function selfDeclaredDomainHint(reviewerId: string, reviewerEmail: string, app: App, applicant: Row<"workspaces"> | null | undefined) {
  const flag = detectCoi({ id: reviewerId, email: reviewerEmail, capacity: 0 }, { id: app.id, applicantDomains: domainsOf(applicant).selfDeclared });
  if (flag?.reason !== "same_email_domain") return null;
  return { applicationId: apiId("application", app.id), reviewerUserId: reviewerId, reason: "self_declared_domain" as const, detail: `The applicant's own profile, which is not verified, gives the reviewer's email domain (${emailDomain(reviewerEmail)}). Check for a conflict of interest before the review starts.` };
}

const memberEmail = (m: Member): string => (typeof (m.scope as { email?: unknown } | null)?.email === "string" ? (m.scope as { email: string }).email : "");
const scopedCompetitions = (m: Member): string[] | null => (Array.isArray((m.scope as { competitionIds?: unknown } | null)?.competitionIds) ? ((m.scope as { competitionIds: string[] }).competitionIds) : null);

/**
 * Applicant workspaces this reviewer has a declared conflict with: in any earlier assignment, and
 * at signing a competition's conflict-of-interest policy (the workspaces matched then, and any of
 * `applicants` the organizations they typed name now).
 */
async function declaredConflicts(ctx: ServiceContext, wsId: string, reviewerId: string, applicants: readonly Row<"workspaces">[] = []): Promise<string[]> {
  const mine = (await ctx.repos.table("review_assignments").find({ workspace_id: wsId, reviewer_user_id: reviewerId })).filter((a) => coiOf(a).declared === true);
  const apps = mine.length ? await ctx.repos.table("applications").find({ id: [...new Set(mine.map((a) => a.application_id))] }) : [];
  const signed = await declaredAtSigning(ctx, wsId, reviewerId);
  const named = signed.declared.length ? applicants.filter((w) => signed.declared.some((d) => declaredMatches(d, candidateOf(w)))).map((w) => w.id) : [];
  return [...new Set([...apps.map((a) => a.applicant_workspace_id), ...signed.orgIds, ...named])];
}

async function assignable(ctx: ServiceContext, app: App, applicant: Row<"workspaces"> | null | undefined, programId: string | null, assigned: string[]): Promise<AssignableApplication> {
  return { id: app.id, applicantOrgId: app.applicant_workspace_id, applicantDomains: domainsOf(applicant).verified, programId, tags: app.tags, assignedReviewerIds: assigned };
}

function view(a: Assignment, app: App | undefined, review: Review | undefined, rubric?: Rubric) {
  const scored = review && rubric ? scoreReview(rubric, review.scores as Scores) : null;
  return {
    id: a.id,
    applicationId: apiId("application", a.application_id),
    applicationTitle: app?.title ?? null,
    competitionId: app ? apiId("competition", app.competition_id) : null,
    stage: a.stage,
    reviewerUserId: a.reviewer_user_id,
    rubricId: a.rubric_id,
    rubricVersion: a.rubric_version,
    dueAt: a.due_at,
    status: a.status,
    coi: { declared: coiOf(a).declared ?? null, reason: coiOf(a).reason ?? null },
    review: review ? { id: apiId("review", review.id), submittedAt: review.submitted_at, overall: scored?.overall ?? null, complete: scored?.complete ?? false } : null,
    createdAt: a.created_at,
  };
}

/**
 * An assignment as this caller may read it. A reviewer who has not signed the competition's policy
 * gets only that it is waiting (no title, no review); in a stage with anonymized review, the title
 * without the organization's names and the application's short code.
 */
async function asSeen(ctx: ServiceContext, v: ReturnType<typeof view>, app: App | undefined, signed: Set<string> | null) {
  if (!app) return { ...v, applicantCode: null, anonymized: false, policyRequired: false };
  if (signed && !signed.has(app.competition_id)) return { ...v, applicationTitle: null, review: null, applicantCode: null, anonymized: false, policyRequired: true };
  const anon = await anonymityFor(ctx, app.id);
  return { ...v, applicationTitle: anon && v.applicationTitle !== null ? redactText(v.applicationTitle, anon.terms) : v.applicationTitle, applicantCode: anon?.code ?? null, anonymized: !!anon, policyRequired: false };
}

/** The competitions whose policy a reviewer has signed, or null for staff (who are not gated). */
async function signedFor(ctx: ServiceContext, ws: ServiceWorkspace, apps: readonly App[]): Promise<Set<string> | null> {
  if (!isReviewerRole(ws) || !ctx.actor.userId) return null;
  return signedCompetitions(ctx, ws.id, ctx.actor.userId, apps.map((a) => a.competition_id));
}

/** The assigned person must have signed the competition's policy before the application opens or is scored. */
async function requireSigned(ctx: ServiceContext, ws: ServiceWorkspace, app: App): Promise<void> {
  if (!ctx.actor.userId) return;
  if (!(await signedCompetitions(ctx, ws.id, ctx.actor.userId, [app.competition_id])).has(app.competition_id)) throw unsigned(app.competition_id);
}

async function stageRubric(ctx: ServiceContext, competition: Comp, stageKey: string): Promise<Row<"rubrics">> {
  const stage = stageOf(competition, stageKey);
  if (!stage) throw new ApiError(422, "unknown_stage", `This competition has no stage "${stageKey}"`);
  if (!stage.rubricId) throw new ApiError(409, "no_rubric", `Choose a rubric for the ${stage.label ?? stage.key} stage before assigning reviewers`);
  return rubricRow(ctx, stage.rubricId);
}

/** Reviews starting means the application is under review. */
async function markUnderReview(ctx: ServiceContext, app: App): Promise<void> {
  if (app.status === "submitted" || app.status === "screening") await transitionApp(ctx, app, "start_review", "funder", {});
}

export const assignInput = z.object({ applicationId: z.string(), stage: z.string().min(1).max(60).optional(), reviewerUserId: z.uuid(), reviewerEmail: z.email().max(320).optional(), dueAt: z.iso.datetime({ offset: true }).optional() }).strict();

export async function createAssignment(ctx: ServiceContext, applicationUuid: string, input: Omit<z.output<typeof assignInput>, "applicationId">) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: STAFF_ROLES });
  const app = required(await ctx.repos.table("applications").one({ id: applicationUuid, workspace_id: ws.id }), "Application");
  if (!app.submitted_at) required(null, "Application");
  if (!REVIEWABLE.includes(app.status)) throw new ApiError(409, "invalid_status", `An application that is ${app.status.replace(/_/g, " ")} cannot be assigned for review`);
  const competition = required(await ctx.repos.table("competitions").one({ id: app.competition_id }), "Competition");
  const stage = input.stage ?? app.stage;
  const rubric = await stageRubric(ctx, competition, stage);
  const member = await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: input.reviewerUserId });
  if (!member || !ASSIGNABLE.includes(member.role)) throw new ApiError(422, "not_a_reviewer", "That person is not a reviewer in this workspace. Invite them as a reviewer first");
  const scoped = scopedCompetitions(member);
  if (member.role === "external_reviewer" && scoped && !scoped.includes(competition.id)) throw new ApiError(422, "reviewer_out_of_scope", "That external reviewer was invited to a different competition");
  if (await ctx.repos.table("review_assignments").one({ application_id: app.id, stage, reviewer_user_id: input.reviewerUserId })) throw new ApiError(409, "conflict", "That reviewer is already assigned to this application for this stage");

  const applicant = await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id });
  const opp = await ctx.repos.table("opportunities").one({ id: app.opportunity_id });
  const profile: ReviewerProfile = { id: input.reviewerUserId, email: input.reviewerEmail ?? memberEmail(member), capacity: Number.MAX_SAFE_INTEGER, conflicts: { orgIds: await declaredConflicts(ctx, ws.id, input.reviewerUserId, applicant ? [applicant] : []) } };
  const coi = detectCoi(profile, await assignable(ctx, app, applicant, opp?.program_id ?? null, []));
  if (coi) throw new ApiError(409, "conflict_of_interest", coi.detail, [{ code: coi.reason, field: "reviewerUserId", detail: coi.detail }]);

  const row = await ctx.repos.table("review_assignments").insert({ workspace_id: ws.id, application_id: app.id, stage, reviewer_user_id: input.reviewerUserId, rubric_id: rubric.id, rubric_version: rubric.version, due_at: input.dueAt ?? null, status: "assigned", coi: {} });
  await audit(ctx, "review.assigned", "application", app.id, { assignmentId: row.id, stage, reviewerUserId: input.reviewerUserId });
  await markUnderReview(ctx, app);
  return { ...view(row, app, undefined), coiHint: selfDeclaredDomainHint(input.reviewerUserId, profile.email, app, applicant) };
}

export const autoAssignInput = z
  .object({
    competitionId: z.string(),
    stage: z.string().min(1).max(60).optional(),
    reviewersPerApplication: z.number().int().min(1).max(10).default(2),
    /** Limit the pool, or override capacity and expertise tags per reviewer. Defaults to every reviewer in the workspace. */
    reviewers: z.array(z.object({ userId: z.uuid(), email: z.email().optional(), capacity: z.number().int().min(0).max(500).optional(), tags: z.array(z.string().max(60)).max(30).optional() }).strict()).max(200).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    /** Compute and return the plan without creating assignments. */
    dryRun: z.boolean().default(false),
  })
  .strict();

const DEFAULT_CAPACITY = 10;

export async function autoAssignReviewers(ctx: ServiceContext, competitionUuid: string, input: Omit<z.output<typeof autoAssignInput>, "competitionId">) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: STAFF_ROLES });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: ws.id }), "Competition");
  const stages = stagesOf(competition);
  const stage = input.stage ?? stages[0]?.key ?? "application";
  const rubric = await stageRubric(ctx, competition, stage);
  const opp = await ctx.repos.table("opportunities").one({ id: competition.opportunity_id });
  const apps = (await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id, stage }, { notNull: ["submitted_at"], limit: 5000 })).filter((a) => REVIEWABLE.includes(a.status));
  const existing = await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, stage, application_id: apps.map((a) => a.id) });
  const live = existing.filter((a) => a.status !== "recused");

  const members = (await ctx.repos.table("workspace_members").find({ workspace_id: ws.id })).filter((m) => (input.reviewers ? input.reviewers.some((r) => r.userId === m.user_id) && ASSIGNABLE.includes(m.role) : REVIEWER_ROLES.includes(m.role)) && (m.role !== "external_reviewer" || !scopedCompetitions(m) || scopedCompetitions(m)!.includes(competition.id)));
  const applicants = apps.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.applicant_workspace_id))] }) : [];
  const reviewers: ReviewerProfile[] = [];
  for (const m of members) {
    const o = input.reviewers?.find((r) => r.userId === m.user_id);
    const scope = (m.scope as { capacity?: unknown; tags?: unknown } | null) ?? {};
    reviewers.push({ id: m.user_id, email: o?.email ?? memberEmail(m), capacity: o?.capacity ?? (typeof scope.capacity === "number" ? scope.capacity : DEFAULT_CAPACITY), load: live.filter((a) => a.reviewer_user_id === m.user_id).length, tags: o?.tags ?? (Array.isArray(scope.tags) ? (scope.tags as string[]) : []), conflicts: { orgIds: await declaredConflicts(ctx, ws.id, m.user_id, applicants) } });
  }
  const pool: AssignableApplication[] = [];
  for (const a of apps) pool.push(await assignable(ctx, a, applicants.find((w) => w.id === a.applicant_workspace_id), opp?.program_id ?? null, existing.filter((x) => x.application_id === a.id).map((x) => x.reviewer_user_id)));
  // An application that already has reviewers needs only the difference.
  const plan = autoAssign({ applications: pool, reviewers, reviewersPerApplication: input.reviewersPerApplication });
  const need = new Map(apps.map((a) => [a.id, Math.max(0, input.reviewersPerApplication - live.filter((x) => x.application_id === a.id).length)]));
  const wanted = plan.assignments.filter((x) => {
    const left = need.get(x.applicationId) ?? 0;
    if (left <= 0) return false;
    need.set(x.applicationId, left - 1);
    return true;
  });
  const unfilled = [...need.entries()].filter(([, missing]) => missing > 0).map(([applicationId, missing]) => ({ applicationId: apiId("application", applicationId), missing }));
  const assignments = wanted.map((x) => ({ applicationId: apiId("application", x.applicationId), reviewerUserId: x.reviewerId, matchedTags: x.matchedTags }));
  const coiFlags = plan.coiFlags.map((f) => ({ applicationId: apiId("application", f.applicationId), reviewerUserId: f.reviewerId, reason: f.reason, detail: f.detail }));
  // Planned pairs the applicant's own, unverified profile would have flagged: shown, not acted on.
  const coiHints = wanted.flatMap((x) => {
    const app = apps.find((a) => a.id === x.applicationId)!;
    const hint = selfDeclaredDomainHint(x.reviewerId, reviewers.find((r) => r.id === x.reviewerId)?.email ?? "", app, applicants.find((w) => w.id === app.applicant_workspace_id));
    return hint ? [hint] : [];
  });
  if (input.dryRun) return { stage, dryRun: true, created: 0, assignments, unfilled, coiFlags, coiHints };
  for (const x of wanted) await ctx.repos.table("review_assignments").insert({ workspace_id: ws.id, application_id: x.applicationId, stage, reviewer_user_id: x.reviewerId, rubric_id: rubric.id, rubric_version: rubric.version, due_at: input.dueAt ?? null, status: "assigned", coi: {} });
  for (const a of apps) if (wanted.some((x) => x.applicationId === a.id)) await markUnderReview(ctx, a);
  await audit(ctx, "reviews.auto_assigned", "competition", competition.id, { stage, created: wanted.length, unfilled: unfilled.length, coiExcluded: coiFlags.length });
  return { stage, dryRun: false, created: wanted.length, assignments, unfilled, coiFlags, coiHints };
}

export interface AssignmentFilter {
  competitionId?: string;
  applicationId?: string;
  stage?: string;
  reviewerUserId?: string;
  status?: string;
}

export async function listAssignments(ctx: ServiceContext, f: AssignmentFilter = {}) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder" });
  // Reviewers see their own assignments; staff see the matrix.
  const mineOnly = isReviewer(ws);
  let rows = await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, ...(mineOnly ? { reviewer_user_id: ctx.actor.userId! } : f.reviewerUserId ? { reviewer_user_id: f.reviewerUserId } : {}), ...(f.applicationId ? { application_id: f.applicationId } : {}), ...(f.stage ? { stage: f.stage } : {}) }, { orderBy: "created_at", limit: 5000 });
  if (f.status) rows = rows.filter((a) => f.status!.split(",").includes(a.status));
  const apps = rows.length ? await ctx.repos.table("applications").find({ id: [...new Set(rows.map((a) => a.application_id))] }) : [];
  if (f.competitionId) rows = rows.filter((a) => apps.find((x) => x.id === a.application_id)?.competition_id === f.competitionId);
  // A reviewer's own list leaves out what they were recused from by declaring the organization at signing.
  if (mineOnly) rows = rows.filter((a) => !recusedAtSigning(a));
  const reviews = rows.length ? await ctx.repos.table("reviews").find({ assignment_id: rows.map((a) => a.id) }) : [];
  const signed = await signedFor(ctx, ws, apps);
  const rubrics = new Map<string, Rubric>();
  const out = [];
  for (const a of rows) {
    const key = `${a.rubric_id}:${a.rubric_version}`;
    if (!rubrics.has(key)) rubrics.set(key, toRubric(await rubricRow(ctx, a.rubric_id, a.rubric_version)));
    const review = reviews.find((r) => r.assignment_id === a.id);
    const app = apps.find((x) => x.id === a.application_id);
    // In the matrix, staff see that a review exists and its overall; the scores themselves are read through /reviews.
    out.push(await asSeen(ctx, view(a, app, review, rubrics.get(key)), app, signed));
  }
  return out;
}

async function ownOrStaff(ctx: ServiceContext, assignmentId: string, scope: "reviews:read" | "reviews:write") {
  const ws = await authorize(ctx, { scope, kind: "funder" });
  const a = required(await ctx.repos.table("review_assignments").one({ id: assignmentId, workspace_id: ws.id }), "Review assignment");
  const own = a.reviewer_user_id === ctx.actor.userId;
  const staff = !!ws.role && (STAFF_ROLES as readonly string[]).includes(ws.role);
  // A token without a person (API client) holds the scope and acts as staff.
  if (!own && !staff && ws.role !== null) required(null, "Review assignment");
  return { a, ws, own, staff: staff || ws.role === null };
}

/** The reviewer's working view: the assignment, the rubric, their own review, and the application as a reviewer may see it. */
export async function getAssignment(ctx: ServiceContext, assignmentId: string) {
  const { a, ws, own } = await ownOrStaff(ctx, assignmentId, "reviews:read");
  const app = required(await ctx.repos.table("applications").one({ id: a.application_id }), "Application");
  // Until the reviewer has signed the competition's policy, all an assignment read says is that.
  if (own) await requireSigned(ctx, ws, app);
  const rubricRecord = await rubricRow(ctx, a.rubric_id, a.rubric_version);
  const rubric = toRubric(rubricRecord);
  const review = await ctx.repos.table("reviews").one({ assignment_id: a.id });
  // A recused reviewer keeps the record of the assignment but loses the application.
  const recused = a.status === "recused" && own && isReviewer(ws);
  return {
    ...(await asSeen(ctx, view(a, app, review ?? undefined, rubric), app, null)),
    rubric: { id: rubricRecord.id, version: rubricRecord.version, name: rubricRecord.name, criteria: rubricRecord.criteria, overall: rubricRecord.overall },
    myReview: review && own ? { scores: review.scores, narrative: review.narrative, recommendation: review.recommendation, visibility: review.visibility, submittedAt: review.submitted_at } : null,
    application: recused ? null : await getApplicationDetail(ctx, app.id),
  };
}

const scoresInput = z.record(z.string().max(80), z.union([z.number(), z.string().max(200), z.object({ value: z.union([z.number(), z.string().max(200)]), comment: z.string().max(5000).optional() }).strict()]));
export const assignmentPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("declare_coi"), hasConflict: z.boolean(), reason: z.string().trim().max(2000).optional() }).strict(),
  // `visibility`: whether the narrative and comments are for the panel (default) or for program staff only.
  z.object({ action: z.literal("save"), scores: scoresInput, narrative: z.string().max(20_000).optional(), recommendation: z.string().max(200).optional(), visibility: z.enum(["panel", "funder_only"]).optional() }).strict(),
  z.object({ action: z.literal("submit"), scores: scoresInput.optional(), narrative: z.string().max(20_000).optional(), recommendation: z.string().max(200).optional(), visibility: z.enum(["panel", "funder_only"]).optional() }).strict(),
  z.object({ action: z.literal("recuse"), reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("reschedule"), dueAt: z.iso.datetime({ offset: true }).nullable() }).strict(),
]);

export async function updateAssignment(ctx: ServiceContext, assignmentId: string, input: z.output<typeof assignmentPatch>) {
  const { a, ws, own, staff } = await ownOrStaff(ctx, assignmentId, "reviews:write");
  const app = required(await ctx.repos.table("applications").one({ id: a.application_id }), "Application");
  const rubric = toRubric(await rubricRow(ctx, a.rubric_id, a.rubric_version));
  const at = ctx.now().toISOString();
  const set = async (patch: Partial<Assignment>, from: readonly string[]) => {
    if (!from.includes(a.status)) throw new ApiError(409, "invalid_transition", `This assignment is ${a.status.replace(/_/g, " ")}`);
    const [row] = await ctx.repos.table("review_assignments").update({ id: a.id, status: a.status }, patch);
    if (!row) throw new ApiError(409, "conflict", "This assignment changed while you were working. Reload and try again");
    return row;
  };

  if (input.action === "reschedule" || input.action === "recuse") {
    if (!staff && !(own && input.action === "recuse")) throw new ApiError(403, "insufficient_role", "Only program staff can change an assignment");
    if (input.action === "reschedule") return view(await set({ due_at: input.dueAt }, ["assigned", "coi_declared", "in_progress"]), app, undefined);
    const row = await set({ status: "recused", coi: { ...coiOf(a), declared: coiOf(a).declared ?? false, reason: input.reason, at } }, ["assigned", "coi_declared", "in_progress"]);
    await audit(ctx, "review.recused", "application", app.id, { assignmentId: a.id, by: own ? "reviewer" : "staff" });
    return view(row, app, undefined);
  }

  // Everything below is the reviewer's own work, and starts with the competition's signed policy.
  if (!own) throw new ApiError(403, "not_your_assignment", "Only the assigned reviewer can declare conflicts and score");
  await requireSigned(ctx, ws, app);
  if (input.action === "declare_coi") {
    if (input.hasConflict) {
      const row = await set({ status: "recused", coi: { declared: true, reason: input.reason ?? null, at } }, ["assigned", "coi_declared", "in_progress"]);
      await audit(ctx, "review.coi_declared", "application", app.id, { assignmentId: a.id, conflict: true });
      return view(row, app, undefined);
    }
    const row = await set({ status: a.status === "assigned" ? "coi_declared" : a.status, coi: { declared: false, at } }, ["assigned", "coi_declared", "in_progress"]);
    await audit(ctx, "review.coi_declared", "application", app.id, { assignmentId: a.id, conflict: false });
    return view(row, app, (await ctx.repos.table("reviews").one({ assignment_id: a.id })) ?? undefined, rubric);
  }

  if (a.status === "assigned") throw new ApiError(409, "coi_required", "Declare whether you have a conflict of interest before scoring");
  if (!["coi_declared", "in_progress"].includes(a.status)) throw new ApiError(409, "invalid_transition", `This assignment is ${a.status.replace(/_/g, " ")}`);
  const existing = await ctx.repos.table("reviews").one({ assignment_id: a.id });
  const scores = (input.scores ?? (existing?.scores as Scores | undefined) ?? {}) as Scores;
  const fields = { scores: scores as Review["scores"], ...(input.narrative !== undefined ? { narrative: input.narrative } : {}), ...(input.recommendation !== undefined ? { recommendation: input.recommendation } : {}), ...(input.visibility !== undefined ? { visibility: input.visibility } : {}) };
  if (input.action === "submit") {
    const scored = scoreReview(rubric, scores);
    if (!scored.complete) throw new ApiError(422, "incomplete_review", "Score every criterion before submitting", scored.issues.map((i) => ({ code: "invalid_score", field: `scores.${i.criterion}`, detail: i.message })));
  }
  const review = existing ? (await ctx.repos.table("reviews").update({ id: existing.id }, { ...fields, ...(input.action === "submit" ? { submitted_at: at } : {}) }))[0]! : await ctx.repos.table("reviews").insert({ workspace_id: ws.id, assignment_id: a.id, ...fields, submitted_at: input.action === "submit" ? at : null });
  const row = await set({ status: input.action === "submit" ? "submitted" : "in_progress" }, ["coi_declared", "in_progress"]);
  if (input.action === "submit") {
    await audit(ctx, "review.submitted", "application", app.id, { assignmentId: a.id, reviewId: review.id, stage: a.stage });
    await emitFor(ctx, ws.id, "review.submitted", { reviewId: review.id, assignmentId: a.id, applicationId: app.id, stage: a.stage });
  }
  return view(row, app, review, rubric);
}

/** Submitted reviews of an application, as this viewer may see them (blind mode, §10.5). */
export async function listReviews(ctx: ServiceContext, applicationUuid: string, stageKey?: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder" });
  const app = required(await ctx.repos.table("applications").one({ id: applicationUuid, workspace_id: ws.id }), "Application");
  const competition = required(await ctx.repos.table("competitions").one({ id: app.competition_id }), "Competition");
  const assignments = (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, application_id: app.id, ...(stageKey ? { stage: stageKey } : {}) })).filter((a) => a.status !== "recused" || a.reviewer_user_id === ctx.actor.userId);
  const mine = assignments.filter((a) => a.reviewer_user_id === ctx.actor.userId);
  // A reviewer with no assignment on this application has no business with its reviews.
  if (isReviewer(ws) && !mine.length) required(null, "Application");
  if (isReviewer(ws)) await requireSigned(ctx, ws, app);
  const reviews = assignments.length ? await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) }) : [];
  const out = [];
  for (const a of assignments) {
    const review = reviews.find((r) => r.assignment_id === a.id);
    if (!review?.submitted_at && a.reviewer_user_id !== ctx.actor.userId) continue;
    if (!review) continue;
    const own = a.reviewer_user_id === ctx.actor.userId;
    const stage = stageOf(competition, a.stage);
    const myInStage = mine.find((m) => m.stage === a.stage);
    const visible = own || canSeeOtherReviews({ mode: stage?.reviewMode ?? "blind", viewerRole: (ws.role ?? "admin") as ViewerRole, viewerHasSubmitted: myInStage?.status === "submitted", panelOpen: stage?.panelOpen === true, viewerRecused: myInStage?.status === "recused", reviewVisibility: review.visibility as "panel" | "funder_only" });
    if (!visible) continue;
    const rubric = toRubric(await rubricRow(ctx, a.rubric_id, a.rubric_version));
    const scored = scoreReview(rubric, review.scores as Scores);
    // Another reviewer may have named the organization; an anonymized reviewer reads "[applicant]" instead.
    const scores = own ? review.scores : ((await redactFor(ctx, app.id, review.scores)) as Review["scores"]);
    const narrative = own || review.narrative === null ? review.narrative : ((await redactFor(ctx, app.id, review.narrative)) as string);
    out.push({ id: apiId("review", review.id), assignmentId: a.id, applicationId: apiId("application", app.id), stage: a.stage, reviewerUserId: a.reviewer_user_id, own, scores, normalized: scored.normalized, overall: scored.overall, narrative, recommendation: review.recommendation, visibility: review.visibility, submittedAt: review.submitted_at });
  }
  return out;
}

/** The panel's ranking for one stage: mean, median, spread and reviewer count per application. Recomputed on read. */
export async function getRanking(ctx: ServiceContext, competitionUuid: string, stageKey?: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: PANEL_ROLES });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: ws.id }), "Competition");
  const stage = stageKey ?? stagesOf(competition)[0]?.key ?? "application";
  const rubricRecord = await stageRubric(ctx, competition, stage);
  const rubric = toRubric(rubricRecord);
  const all = await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id }, { notNull: ["submitted_at"], limit: 5000 });
  const assignments = (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, stage, application_id: all.map((a) => a.id) })).filter((a) => a.status !== "recused");
  const apps = all.filter((a) => a.stage === stage || assignments.some((x) => x.application_id === a.id));
  const reviews = assignments.length ? (await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) })).filter((r) => r.submitted_at) : [];
  const submitted = reviews.map((r) => {
    const a = assignments.find((x) => x.id === r.assignment_id)!;
    return { applicationId: a.application_id, reviewerId: a.reviewer_user_id, scores: r.scores as Scores };
  });
  const rows = rankApplications(rubric, apps.map((a) => a.id), submitted);
  const applicants = apps.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.applicant_workspace_id))] }) : [];
  const proposals = await ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id, application_id: apps.map((a) => a.id) });
  return {
    competitionId: apiId("competition", competition.id),
    stage,
    rubric: { id: rubricRecord.id, version: rubricRecord.version, name: rubricRecord.name },
    items: rows.map((r) => {
      const app = apps.find((a) => a.id === r.applicationId)!;
      const assigned = assignments.filter((a) => a.application_id === app.id);
      const d = proposals.filter((p) => p.application_id === app.id && p.stage === stage).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
      return {
        ...r,
        applicationId: apiId("application", app.id),
        title: app.title,
        applicant: applicants.find((w) => w.id === app.applicant_workspace_id)?.display_name ?? null,
        status: app.status,
        requestedAmountMinor: app.requested_amount_minor,
        currency: app.currency,
        assigned: assigned.length,
        pending: assigned.filter((a) => a.status !== "submitted").length,
        decision: d ? { id: d.id, outcome: d.outcome, amountMinor: d.amount_minor, committed: d.committed_at !== null } : null,
      };
    }),
  };
}

export const inviteReviewerInput = z.object({ email: z.email().max(320), competitionId: z.string(), expiresInDays: z.number().int().min(1).max(90).default(14) }).strict();

/** Invite an external reviewer by email. Accepting creates an `external_reviewer` member scoped to this competition. */
export async function inviteExternalReviewer(ctx: ServiceContext, competitionUuid: string, input: Omit<z.output<typeof inviteReviewerInput>, "competitionId">) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: STAFF_ROLES, person: true });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: ws.id }), "Competition");
  const email = input.email.toLowerCase();
  const token = randomToken("gms_inv_");
  const expiresAt = new Date(ctx.now().getTime() + input.expiresInDays * 86_400_000).toISOString();
  const row = await ctx.repos.table("invitations").insert({ workspace_id: ws.id, email, role: "external_reviewer", scope: { competitionIds: [competition.id], email }, token_hash: await sha256b64url(token), invited_by: ctx.actor.userId, expires_at: expiresAt });
  await audit(ctx, "review.external_reviewer_invited", "competition", competition.id, { invitationId: row.id });
  const acceptUrl = `${ctx.config.webBaseUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
  let emailed = false;
  if (ctx.ports.mailer && ctx.config.mailFrom) {
    const funder = await ctx.repos.table("workspaces").one({ id: ws.id });
    const who = funder?.display_name ?? "A funder";
    try {
      await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [email], subject: `${who} invited you to review applications`, text: `${who} invited you to review applications for ${competition.title} on OpenGrants GMS.\n\nAccept the invitation: ${acceptUrl}\n\nThe link expires on ${expiresAt.slice(0, 10)}.`, html: `<p>${escape(who)} invited you to review applications for ${escape(competition.title)} on OpenGrants GMS.</p><p><a href="${acceptUrl}">Accept the invitation</a></p><p>The link expires on ${expiresAt.slice(0, 10)}.</p>`, idempotencyKey: `invite:${row.id}` });
      emailed = true;
    } catch {
      // The invitation stands; the link is returned so staff can pass it on.
    }
  }
  return { id: row.id, email, role: "external_reviewer", competitionId: apiId("competition", competition.id), expiresAt, token, acceptUrl, emailed };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ------------------------------------------------------------------------------------ review parity (v1.8.0)
//
// The competition's conflict-of-interest policy, signed once per competition by each reviewer
// before any application in it opens for them; the conflicts register; and the per-stage review
// settings (anonymized review, blind mode, the panel). See docs/reviews.md.

/** Who may read the conflicts register and the policy as staff: program staff, observers and auditors. */
const REGISTER_ROLES = PANEL_ROLES;

async function competitionOf(ctx: ServiceContext, wsId: string, competitionUuid: string): Promise<Comp> {
  return required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: wsId }), "Competition");
}

/** A reviewer reads a competition's policy only where they review: an assignment in it, or an invitation to it. */
async function reviewerMayRead(ctx: ServiceContext, ws: ServiceWorkspace, competition: Comp): Promise<boolean> {
  const scoped = (ws.memberScope as { competitionIds?: unknown } | null | undefined)?.competitionIds;
  if (Array.isArray(scoped) && scoped.includes(competition.id)) return true;
  if (ws.role === "external_reviewer") return false;
  if (!ctx.actor.userId) return false;
  const mine = await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, reviewer_user_id: ctx.actor.userId });
  if (!mine.length) return ws.role === "reviewer";
  const apps = await ctx.repos.table("applications").find({ id: [...new Set(mine.map((a) => a.application_id))], competition_id: competition.id });
  return apps.length > 0 || ws.role === "reviewer";
}

const declaredView = (d: unknown): DeclaredOrg[] => (Array.isArray(d) ? (d as DeclaredOrg[]).map((x) => ({ name: x.name, ...(x.website ? { website: x.website } : {}) })) : []);
const signatureView = (r: Row<"coi_signatures">, currentVersion: number) => ({ policyVersion: r.policy_version, signedName: r.signed_name, signedAt: r.signed_at, current: r.policy_version === currentVersion, declared: declaredView(r.declared_orgs) });

/** The policy reviewers sign for a competition, and (for the caller) their own signature. */
export async function getCoiPolicy(ctx: ServiceContext, competitionUuid: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder" });
  const competition = await competitionOf(ctx, ws.id, competitionUuid);
  if (isReviewerRole(ws) && !(await reviewerMayRead(ctx, ws, competition))) required(null, "Competition");
  else if (!isReviewerRole(ws) && ws.role !== null && !(REGISTER_ROLES as readonly string[]).includes(ws.role) && !ASSIGNABLE.includes(ws.role)) throw new ApiError(403, "insufficient_role", "Only program staff and reviewers read the conflict-of-interest policy");
  const policy = await currentPolicy(ctx, competition.id);
  const mine = ctx.actor.userId ? await ctx.repos.table("coi_signatures").find({ competition_id: competition.id, reviewer_user_id: ctx.actor.userId }, { orderBy: "policy_version", ascending: false }) : [];
  const latest = mine[0];
  return {
    competitionId: apiId("competition", competition.id),
    competitionTitle: competition.title,
    version: policy.version,
    text: policy.text,
    isDefault: policy.isDefault,
    updatedAt: policy.updatedAt,
    signed: mine.some((r) => r.policy_version === policy.version),
    mySignature: latest ? signatureView(latest, policy.version) : null,
  };
}

export const coiPolicyInput = z.union([z.object({ text: z.string().trim().min(20).max(20_000) }).strict(), z.object({ useDefault: z.literal(true) }).strict()]);

/** Write the competition's policy (or go back to the default). A change is a new version: reviewers who signed an earlier one sign again. */
export async function putCoiPolicy(ctx: ServiceContext, competitionUuid: string, input: z.output<typeof coiPolicyInput>) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: STAFF_ROLES });
  const competition = await competitionOf(ctx, ws.id, competitionUuid);
  const current = await currentPolicy(ctx, competition.id);
  const text = "text" in input ? input.text.replace(/\r\n?/g, "\n") : DEFAULT_COI_POLICY;
  const isDefault = !("text" in input);
  if (current.text === text && current.isDefault === isDefault) return getCoiPolicy(ctx, competitionUuid);
  const version = current.stored ? current.version + 1 : 1;
  await ctx.repos.table("coi_policies").insert({ workspace_id: ws.id, competition_id: competition.id, version, policy_text: text, is_default: isDefault, created_by: ctx.actor.userId });
  const resign = (await ctx.repos.table("coi_signatures").find({ competition_id: competition.id })).length > 0;
  await audit(ctx, "competition.coi_policy_set", "competition", competition.id, { version, isDefault, reviewersSignAgain: resign });
  return getCoiPolicy(ctx, competitionUuid);
}

export const signInput = z
  .object({
    /** The version the reviewer read; signing fails if the policy changed meanwhile. */
    policyVersion: z.number().int().min(1),
    signedName: z.string().trim().min(2).max(200),
    /** Must be true: the reviewer agrees to the policy. */
    agree: z.literal(true),
    /** Organizations the reviewer has a conflict with, as they name them. Matched to applicants by name or website. */
    conflicts: z.array(z.object({ name: z.string().trim().min(1).max(200), website: z.string().trim().max(300).optional() }).strict()).max(50).default([]),
  })
  .strict();

/**
 * A reviewer signs the competition's policy: the name they type, when, and the organizations they
 * declare a conflict with. Only the person themselves, signed in: an agent or API client cannot
 * sign for anyone. Declared organizations feed the assignment exclusion, and an assignment the
 * reviewer already has on a declared applicant is recused. The answer never says whether a declared
 * organization applied.
 */
export async function signCoiPolicy(ctx: ServiceContext, competitionUuid: string, input: z.output<typeof signInput>) {
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "A reviewer signs the conflict-of-interest policy themselves, signed in. An agent or API client cannot sign it");
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", person: true });
  if (!ws.role || !ASSIGNABLE.includes(ws.role)) throw new ApiError(403, "insufficient_role", "Only reviewers sign the conflict-of-interest policy");
  const competition = await competitionOf(ctx, ws.id, competitionUuid);
  if (isReviewerRole(ws) && !(await reviewerMayRead(ctx, ws, competition))) required(null, "Competition");
  let policy = await currentPolicy(ctx, competition.id);
  if (input.policyVersion !== policy.version) throw new ApiError(409, "policy_changed", "The policy changed since you opened it. Read the current version and sign that");
  const userId = ctx.actor.userId!;
  const existing = await ctx.repos.table("coi_signatures").one({ competition_id: competition.id, reviewer_user_id: userId, policy_version: policy.version });
  if (existing) return { ...signatureView(existing, policy.version), competitionId: apiId("competition", competition.id), alreadySigned: true };
  // The default is written down the first time someone signs it, so the text signed stays on record.
  if (!policy.stored) {
    try {
      await ctx.repos.table("coi_policies").insert({ workspace_id: ws.id, competition_id: competition.id, version: 1, policy_text: policy.text, is_default: true, created_by: null });
    } catch {
      // Another signature wrote it first; the version is the same.
    }
    policy = await currentPolicy(ctx, competition.id);
    if (policy.version !== input.policyVersion) throw new ApiError(409, "policy_changed", "The policy changed since you opened it. Read the current version and sign that");
  }
  // Match what the reviewer typed against the organizations that applied to this funder.
  const apps = input.conflicts.length ? await ctx.repos.table("applications").find({ workspace_id: ws.id }, { notNull: ["submitted_at"], limit: 5000 }) : [];
  const applicants = apps.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.applicant_workspace_id))] }) : [];
  const matched = matchDeclaredOrgs(input.conflicts, applicants.map(candidateOf));
  const at = ctx.now().toISOString();
  const row = await ctx.repos.table("coi_signatures").insert({ workspace_id: ws.id, competition_id: competition.id, reviewer_user_id: userId, policy_version: policy.version, signed_name: input.signedName, signed_at: at, declared_org_ids: matched, declared_orgs: input.conflicts as unknown as Row<"coi_signatures">["declared_orgs"] });
  // Recuse the reviewer from what they already hold on a declared organization in this competition.
  let recused = 0;
  if (matched.length) {
    const mine = (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, reviewer_user_id: userId })).filter((a) => ["assigned", "coi_declared", "in_progress"].includes(a.status));
    for (const a of mine) {
      const app = apps.find((x) => x.id === a.application_id);
      if (!app || app.competition_id !== competition.id || !matched.includes(app.applicant_workspace_id)) continue;
      const [done] = await ctx.repos.table("review_assignments").update({ id: a.id, status: a.status }, { status: "recused", coi: { declared: true, reason: "Declared when signing the conflict-of-interest policy", at, source: "policy" } });
      if (done) {
        recused += 1;
        await audit(ctx, "review.recused", "application", app.id, { assignmentId: a.id, by: "reviewer", source: "policy" });
      }
    }
  }
  await audit(ctx, "review.coi_policy_signed", "competition", competition.id, { policyVersion: policy.version, declared: input.conflicts.length, recused });
  return { ...signatureView(row, policy.version), competitionId: apiId("competition", competition.id), alreadySigned: false };
}

/**
 * The conflicts register for a competition: who signed which policy version and when, the conflicts
 * each declared (with the applicants they matched), and every recusal with its reason.
 */
export async function getConflictsRegister(ctx: ServiceContext, competitionUuid: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: REGISTER_ROLES });
  const competition = await competitionOf(ctx, ws.id, competitionUuid);
  const policy = await currentPolicy(ctx, competition.id);
  const apps = await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id }, { notNull: ["submitted_at"], limit: 5000 });
  const [signatures, assignments, members] = await Promise.all([
    ctx.repos.table("coi_signatures").find({ competition_id: competition.id }, { orderBy: "signed_at" }),
    apps.length ? ctx.repos.table("review_assignments").find({ workspace_id: ws.id, application_id: apps.map((a) => a.id) }) : Promise.resolve([] as Assignment[]),
    ctx.repos.table("workspace_members").find({ workspace_id: ws.id }),
  ]);
  const matchedIds = [...new Set(signatures.flatMap((s) => s.declared_org_ids))];
  const applicants = await ctx.repos.table("workspaces").find({ id: [...new Set([...apps.map((a) => a.applicant_workspace_id), ...matchedIds])] });
  const nameOf = (id: string) => applicants.find((w) => w.id === id)?.display_name ?? null;
  // Everyone who reviews here: assigned, signed, or a reviewer of the workspace (external: invited to this competition).
  const people = new Set<string>([...assignments.map((a) => a.reviewer_user_id), ...signatures.map((s) => s.reviewer_user_id), ...members.filter((m) => m.role === "reviewer" || (m.role === "external_reviewer" && (scopedCompetitions(m)?.includes(competition.id) ?? true))).map((m) => m.user_id)]);
  const directory = (await ctx.ports.directory?.lookup([...people])) ?? new Map<string, { email: string | null; name: string | null }>();
  const reviewers = [...people].map((userId) => {
    const mine = signatures.filter((s) => s.reviewer_user_id === userId).sort((a, b) => b.policy_version - a.policy_version);
    const latest = mine[0];
    const m = members.find((x) => x.user_id === userId);
    return {
      userId,
      name: directory.get(userId)?.name ?? null,
      email: directory.get(userId)?.email ?? (m ? memberEmail(m) || null : null),
      role: m?.role ?? null,
      signed: mine.some((s) => s.policy_version === policy.version),
      signature: latest ? { ...signatureView(latest, policy.version), declared: declaredView(latest.declared_orgs).map((d) => ({ ...d, matches: applicants.filter((w) => latest.declared_org_ids.includes(w.id) && declaredMatches(d, candidateOf(w))).map((w) => ({ workspaceId: w.id, name: w.display_name })) })) } : null,
      assigned: assignments.filter((a) => a.reviewer_user_id === userId).length,
    };
  }).sort((a, b) => Number(a.signed) - Number(b.signed) || (a.name ?? a.email ?? a.userId).localeCompare(b.name ?? b.email ?? b.userId));
  const recusals = assignments
    .filter((a) => a.status === "recused")
    .map((a) => {
      const app = apps.find((x) => x.id === a.application_id)!;
      const coi = coiOf(a);
      return {
        assignmentId: a.id,
        reviewerUserId: a.reviewer_user_id,
        reviewerName: directory.get(a.reviewer_user_id)?.name ?? directory.get(a.reviewer_user_id)?.email ?? null,
        applicationId: apiId("application", app.id),
        applicationTitle: app.title,
        applicant: nameOf(app.applicant_workspace_id),
        stage: a.stage,
        // How it came about: declared on the assignment, declared at signing, or recused (by the reviewer or staff).
        source: coi.source === "policy" ? ("declared_at_signing" as const) : coi.declared === true ? ("declared_conflict" as const) : ("recused" as const),
        reason: coi.reason ?? null,
        at: coi.at ?? a.updated_at,
      };
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return {
    competitionId: apiId("competition", competition.id),
    competitionTitle: competition.title,
    policy: { version: policy.version, isDefault: policy.isDefault, updatedAt: policy.updatedAt },
    counts: { reviewers: reviewers.length, signed: reviewers.filter((r) => r.signed).length, declared: reviewers.reduce((n, r) => n + (r.signature?.declared.length ?? 0), 0), recusals: recusals.length },
    reviewers,
    recusals,
  };
}

const REGISTER_HEADER = ["Entry", "Reviewer", "Email", "Signed name", "Signed at", "Policy version", "Current policy", "Organization declared", "Website declared", "Matched applicant", "Application", "Stage", "Reason", "At"];

/** The conflicts register as CSV: one line per signature, per declared organization and per recusal. */
export async function conflictsRegisterCsv(ctx: ServiceContext, competitionUuid: string) {
  const reg = await getConflictsRegister(ctx, competitionUuid);
  const rows: unknown[][] = [];
  for (const r of reg.reviewers) {
    const who = r.name ?? r.email ?? r.userId;
    const sig = r.signature;
    rows.push(["Signature", who, r.email, sig?.signedName ?? "", sig?.signedAt ?? "", sig?.policyVersion ?? "", sig ? (sig.current ? "yes" : "no, an earlier version") : "not signed", "", "", "", "", "", "", sig?.signedAt ?? ""]);
    for (const d of sig?.declared ?? []) rows.push(["Declared conflict", who, r.email, sig!.signedName, sig!.signedAt, sig!.policyVersion, sig!.current ? "yes" : "no, an earlier version", d.name, d.website ?? "", d.matches.map((m) => m.name).join("; ") || "no applicant matched", "", "", "", sig!.signedAt]);
  }
  for (const x of reg.recusals) rows.push([x.source === "declared_at_signing" ? "Recusal (declared at signing)" : x.source === "declared_conflict" ? "Recusal (declared conflict)" : "Recusal", x.reviewerName ?? x.reviewerUserId, "", "", "", "", "", "", "", x.applicant ?? "", x.applicationTitle, x.stage, x.reason ?? "", x.at]);
  const slug = reg.competitionTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "competition";
  return { body: toCsv(REGISTER_HEADER, rows), contentType: "text/csv; charset=utf-8", filename: `conflicts-register-${slug}.csv` };
}

export const reviewSettingsInput = z
  .object({
    stage: z.string().min(1).max(60),
    /** Reviewers in the stage do not see who applied. Off by default. */
    anonymized: z.boolean().optional(),
    /** Whether reviewers see each other's scores: never before the panel (blind), after submitting their own, or always. */
    reviewMode: z.enum(["blind", "see_after_submit", "open"]).optional(),
    /** The panel for the stage is open: reviewers see the panel's reviews. */
    panelOpen: z.boolean().optional(),
  })
  .strict();

/** The review settings of one stage. Allowed at any time; turning anonymized review off shows reviewers who applied from then on. */
export async function putReviewSettings(ctx: ServiceContext, competitionUuid: string, input: z.output<typeof reviewSettingsInput>) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: STAFF_ROLES });
  const competition = await competitionOf(ctx, ws.id, competitionUuid);
  const stages = reviewStagesOf(competition);
  if (!stages.some((s) => s.key === input.stage)) throw new ApiError(422, "unknown_stage", `This competition has no stage "${input.stage}"`);
  const { stage: key, ...patch } = input;
  const next = stages.map((s) => (s.key === key ? { ...s, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } : s));
  const [row] = await ctx.repos.table("competitions").update({ id: competition.id, workspace_id: ws.id }, { stages: next as unknown as Comp["stages"] });
  await audit(ctx, "competition.review_settings_set", "competition", competition.id, { stage: key, ...patch });
  return reviewSettingsOf(row ?? competition);
}

/** Each stage's review settings, with their defaults filled in. */
export function reviewSettingsOf(c: Comp) {
  return {
    competitionId: apiId("competition", c.id),
    stages: reviewStagesOf(c).map((s) => ({ key: s.key, label: s.label, anonymized: s.anonymized === true, reviewMode: s.reviewMode ?? "blind", panelOpen: s.panelOpen === true, rubricId: s.rubricId ?? null })),
  };
}

export async function getReviewSettings(ctx: ServiceContext, competitionUuid: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: REGISTER_ROLES });
  return reviewSettingsOf(await competitionOf(ctx, ws.id, competitionUuid));
}
