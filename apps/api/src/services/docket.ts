// SPDX-License-Identifier: AGPL-3.0-only
// The board docket (review parity, v1.8.0): one PDF for the decision meeting. A cover page, a
// summary table (applicant, request, recommended amount, average score, recommendation), then one
// page per application: a short summary, the budget total, scores by criterion, the reviewers'
// comments marked for the panel, and the recommendation.
//
// Funder staff only. The PDF is stored in the EXPORTS bucket under the workspace and read back by
// its download route; it is never public. It carries no bank or identity data (no EIN, address,
// contact, payee or payment detail, and no field the form marks identifying or personal), and
// reviewers' comments marked funder-only only when the person asks for them. Reviewers are named
// "Reviewer 1", "Reviewer 2", ... in the order they were assigned.
import { identifyingFields, fieldMetaFor, type JsonObject } from "@gms/forms";
import { renderPdf, sha256Hex, type Block } from "@gms/documents";
import { toMoney } from "@gms/protocol";
import { rankApplications, scoreReview, type Rubric, type Scores } from "@gms/review";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId, uuidOf } from "../lib/ids.ts";
import { stagesOf } from "./apply.ts";
import { STAFF_ROLES } from "./awards.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { toDefinition } from "./forms.ts";
import type { Row } from "./repos/types.ts";
import { reviewStagesOf } from "./review-privacy.ts";
import { toRubric } from "./reviews.ts";

type App = Row<"applications">;

/** Who builds and downloads dockets: program staff. The one list to widen (say, to observers). */
export const DOCKET_ROLES = STAFF_ROLES;
/** Most applications one docket holds. */
export const MAX_DOCKET_APPLICATIONS = 200;
/** How much of an application's summary answer the docket prints. */
const SUMMARY_CHARS = 1200;

export const docketInput = z
  .object({
    /** A picked set of applications; the whole stage when absent. */
    applicationIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_DOCKET_APPLICATIONS).optional(),
    stage: z.string().min(1).max(60).optional(),
    /** Reviewers' comments marked funder-only are left out unless this is ticked. */
    includeFunderOnlyComments: z.boolean().default(false),
  })
  .strict();

const OUTCOME: Record<string, string> = { approve: "Approve", decline: "Decline", waitlist: "Waitlist", defer: "Defer" };
const RECOMMENDATION: Record<string, string> = { fund: "Fund", fund_with_conditions: "Fund with conditions", do_not_fund: "Do not fund", decline: "Do not fund", waitlist: "Waitlist" };
const money = (minor: number | null | undefined, currency: string) => {
  if (minor === null || minor === undefined) return "—";
  const m = toMoney(minor, currency);
  const [whole, cents] = m.amount.split(".");
  return `${currency === "USD" ? "$" : `${currency} `}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents && cents !== "00" ? `.${cents}` : ""}`;
};
const one = (x: number | null | undefined) => (x === null || x === undefined ? "—" : (Math.round(x * 10) / 10).toFixed(1));
const human = (s: string) => RECOMMENDATION[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Free text printed in the docket (summaries, comments) with every run of digits shaped like a tax,
 * bank or personal identity number removed: the docket never carries one, whatever someone typed.
 */
export const scrubNumbers = (text: string): string =>
  text
    .replace(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, "[number removed]")
    .replace(/(?<!\d)\d{2}-\d{7}(?!\d)/g, "[number removed]")
    .replace(/(?<![\d.,])\d{9,17}(?![\d.,])/g, "[number removed]");

/** Words that mark a form field as the application's summary, in order of preference. */
const SUMMARY_KEYS = [/summary/i, /abstract/i, /overview/i, /description/i, /need/i, /purpose/i];

/**
 * A short summary from the application's own answers: the first text answer whose field name reads
 * like a summary, else the longest text answer. Never a field the form marks identifying or
 * personal, or one hidden from reviewers.
 */
function summaryOf(responses: { response: JsonObject; skip: Set<string> }[]): string | null {
  const texts: { key: string; text: string }[] = [];
  for (const r of responses) for (const [key, v] of Object.entries(r.response ?? {})) if (typeof v === "string" && v.trim().length >= 20 && !r.skip.has(`/${key}`)) texts.push({ key, text: v.trim() });
  if (!texts.length) return null;
  const pick = SUMMARY_KEYS.map((re) => texts.find((t) => re.test(t.key))).find(Boolean) ?? [...texts].sort((a, b) => b.text.length - a.text.length)[0]!;
  const plain = pick.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = scrubNumbers(plain);
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")}…` : text;
}

export interface DocketComment {
  reviewer: string;
  funderOnly: boolean;
  /** "Narrative", or the criterion's label. */
  about: string;
  text: string;
}

export interface DocketApplication {
  applicationId: string;
  title: string;
  applicant: string;
  requested: string;
  recommendedAmount: string;
  recommendation: string;
  averageScore: string;
  reviews: number;
  budgetTotal: string;
  summary: string | null;
  criteria: { label: string; weight: number; mean: string; scored: number }[];
  reviewerRecommendations: string[];
  comments: DocketComment[];
}

export interface DocketModel {
  title: string;
  funder: string;
  opportunity: string;
  competition: string;
  stage: string;
  generatedAt: string;
  includeFunderOnlyComments: boolean;
  totals: { applications: number; requested: string; recommended: string };
  applications: DocketApplication[];
}

/** Everything the docket says, before it becomes a PDF. */
export async function docketModel(ctx: ServiceContext, competitionUuid: string, input: z.output<typeof docketInput>): Promise<DocketModel> {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: DOCKET_ROLES });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: ws.id }), "Competition");
  const stages = reviewStagesOf(competition);
  const stage = input.stage ?? stagesOf(competition)[0]?.key ?? "application";
  const stageDef = stages.find((s) => s.key === stage);
  if (stages.length && !stageDef) throw new ApiError(422, "unknown_stage", `This competition has no stage "${stage}"`);
  const [funder, opportunity] = await Promise.all([ctx.repos.table("workspaces").one({ id: ws.id }), ctx.repos.table("opportunities").one({ id: competition.opportunity_id })]);
  const submitted = await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id }, { notNull: ["submitted_at"], limit: 5000 });
  const allAssignments = submitted.length ? (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, stage, application_id: submitted.map((a) => a.id) }, { orderBy: "created_at" })).filter((a) => a.status !== "recused") : [];
  let apps: App[];
  if (input.applicationIds) {
    const wanted = input.applicationIds.map((id) => uuidOf("application", id, "Application"));
    apps = wanted.map((id) => required(submitted.find((a) => a.id === id), "Application"));
  } else apps = submitted.filter((a) => a.stage === stage || allAssignments.some((x) => x.application_id === a.id));
  if (!apps.length) throw new ApiError(409, "nothing_to_print", "No submitted applications in this stage yet");

  const rubricRow = stageDef?.rubricId ? (await ctx.repos.table("rubrics").find({ id: stageDef.rubricId }, { orderBy: "version", ascending: false, limit: 1 }))[0] : undefined;
  const rubric: Rubric | null = rubricRow ? toRubric(rubricRow) : null;
  const assignments = allAssignments.filter((a) => apps.some((x) => x.id === a.application_id));
  const reviews = assignments.length ? (await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) })).filter((r) => r.submitted_at) : [];
  const rubrics = new Map<string, Rubric>();
  const rubricOf = async (a: Row<"review_assignments">) => {
    const k = `${a.rubric_id}:${a.rubric_version}`;
    if (!rubrics.has(k)) {
      const row = await ctx.repos.table("rubrics").one({ id: a.rubric_id, version: a.rubric_version });
      if (row) rubrics.set(k, toRubric(row));
    }
    return rubrics.get(k) ?? null;
  };
  const ranking = rubric ? rankApplications(rubric, apps.map((a) => a.id), reviews.map((r) => ({ applicationId: assignments.find((a) => a.id === r.assignment_id)!.application_id, reviewerId: assignments.find((a) => a.id === r.assignment_id)!.reviewer_user_id, scores: r.scores as Scores }))) : [];
  const [applicants, decisions, budgets] = await Promise.all([
    ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.applicant_workspace_id))] }),
    ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id, application_id: apps.map((a) => a.id) }),
    ctx.repos.table("budgets").find({ application_id: apps.map((a) => a.id) }),
  ]);
  // Reviewers by the order they were first assigned in this stage: "Reviewer 1", "Reviewer 2", ...
  const reviewerNo = new Map<string, number>();
  for (const a of assignments) if (!reviewerNo.has(a.reviewer_user_id)) reviewerNo.set(a.reviewer_user_id, reviewerNo.size + 1);

  const out: DocketApplication[] = [];
  let requestedTotal = 0;
  let recommendedTotal = 0;
  for (const app of apps) {
    const applicant = applicants.find((w) => w.id === app.applicant_workspace_id);
    const latest = decisions.filter((d) => d.application_id === app.id && (d.stage ?? stage) === stage).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
    const recommended = latest?.outcome === "approve" ? (latest.amount_minor ?? null) : null;
    requestedTotal += app.requested_amount_minor ?? 0;
    recommendedTotal += recommended ?? 0;
    const proposed = budgets.find((b) => b.application_id === app.id && b.kind === "proposed");
    const lines = (Array.isArray(proposed?.lines) ? proposed.lines : []) as { amount_minor?: number; amountMinor?: number }[];
    const rank = ranking.find((r) => r.applicationId === app.id);

    const mine = assignments.filter((a) => a.application_id === app.id);
    const perCriterion = new Map<string, number[]>();
    const comments: DocketComment[] = [];
    const reviewerRecommendations: string[] = [];
    for (const a of mine) {
      const review = reviews.find((r) => r.assignment_id === a.id);
      if (!review) continue;
      const r = await rubricOf(a);
      if (r) for (const [k, v] of Object.entries(scoreReview(r, review.scores as Scores).normalized)) perCriterion.set(k, [...(perCriterion.get(k) ?? []), v * 100]);
      const funderOnly = review.visibility === "funder_only";
      if (funderOnly && !input.includeFunderOnlyComments) continue;
      const who = `Reviewer ${reviewerNo.get(a.reviewer_user_id) ?? "?"}`;
      if (review.recommendation) reviewerRecommendations.push(`${who}: ${human(review.recommendation)}${funderOnly ? " (funder only)" : ""}`);
      if (review.narrative?.trim()) comments.push({ reviewer: who, funderOnly, about: "Narrative", text: scrubNumbers(review.narrative.trim()) });
      for (const c of r?.criteria ?? []) {
        const v = (review.scores as Record<string, unknown>)[c.key];
        const comment = v && typeof v === "object" ? (v as { comment?: unknown }).comment : undefined;
        if (typeof comment === "string" && comment.trim()) comments.push({ reviewer: who, funderOnly, about: c.label, text: scrubNumbers(comment.trim()) });
      }
    }
    // The summary comes from answers a reviewer could read, never from identifying or personal fields.
    const responses = [];
    for (const r of await ctx.repos.table("form_responses").find({ application_id: app.id }, { orderBy: "created_at" })) {
      const form = await ctx.repos.table("forms").one({ id: r.form_id, version: r.form_version });
      if (!form) continue;
      const def = toDefinition(form);
      const meta = fieldMetaFor(def);
      const skip = new Set([...identifyingFields(def), ...Object.entries(meta).filter(([, m]) => m.pii || !m.reviewerVisible).map(([p]) => p)]);
      responses.push({ response: r.response as JsonObject, skip });
    }
    out.push({
      applicationId: apiId("application", app.id),
      title: app.title || "Untitled application",
      applicant: applicant?.display_name ?? "Unknown applicant",
      requested: money(app.requested_amount_minor, app.currency),
      recommendedAmount: money(recommended, latest?.currency ?? app.currency),
      recommendation: latest ? `${OUTCOME[latest.outcome] ?? latest.outcome}${latest.committed_at ? " (committed)" : " (proposed)"}` : "Undecided",
      averageScore: rank?.mean !== null && rank?.mean !== undefined ? `${one(rank.mean)} of 100` : "Not scored",
      reviews: rank?.n ?? 0,
      budgetTotal: proposed ? money(lines.reduce((s, l) => s + (l.amountMinor ?? l.amount_minor ?? 0), 0), proposed.currency) : "No budget submitted",
      summary: summaryOf(responses),
      criteria: (rubric?.criteria ?? []).map((c) => {
        const xs = perCriterion.get(c.key) ?? [];
        return { label: c.label, weight: c.weight, mean: xs.length ? one(xs.reduce((s, x) => s + x, 0) / xs.length) : "—", scored: xs.length };
      }),
      reviewerRecommendations,
      comments,
    });
  }
  const currency = apps[0]?.currency ?? "USD";
  return {
    title: `Board docket: ${competition.title}`,
    funder: funder?.display_name ?? "",
    opportunity: opportunity?.title ?? "",
    competition: competition.title,
    stage: stageDef?.label ?? stage,
    generatedAt: ctx.now().toISOString(),
    includeFunderOnlyComments: input.includeFunderOnlyComments,
    totals: { applications: out.length, requested: money(requestedTotal, currency), recommended: money(recommendedTotal, currency) },
    applications: out,
  };
}

/** The docket as PDF blocks: cover, summary table, a page per application. */
export function docketBlocks(m: DocketModel): Block[] {
  const blocks: Block[] = [
    { type: "heading", level: 1, text: "Board docket" },
    { type: "paragraph", text: m.competition },
    { type: "fields", rows: [["Funder", m.funder], ["Opportunity", m.opportunity], ["Stage", m.stage], ["Prepared", m.generatedAt.slice(0, 10)], ["Applications", String(m.totals.applications)], ["Total requested", m.totals.requested], ["Total recommended", m.totals.recommended]] },
    { type: "paragraph", text: "Confidential: prepared for the decision meeting. Recommended amounts and recommendations are the panel's proposals until the decisions are committed." },
    { type: "paragraph", text: m.includeFunderOnlyComments ? "This docket includes reviewers' comments marked for program staff only. Do not share it beyond them." : "Reviewers' comments marked for program staff only are not included." },
    { type: "pageBreak" },
    { type: "heading", level: 2, text: "Summary" },
    {
      type: "table",
      columns: [{ label: "Applicant", width: 3 }, { label: "Request", width: 1.6, align: "right" }, { label: "Recommended", width: 1.6, align: "right" }, { label: "Average score", width: 1.4, align: "right" }, { label: "Recommendation", width: 2 }],
      rows: m.applications.map((a) => [`${a.applicant} · ${a.title}`, a.requested, a.recommendedAmount, a.averageScore.replace(" of 100", ""), a.recommendation]),
    },
  ];
  for (const a of m.applications) {
    blocks.push({ type: "pageBreak" }, { type: "heading", level: 2, text: a.title }, { type: "fields", rows: [["Applicant", a.applicant], ["Request", a.requested], ["Budget total", a.budgetTotal], ["Average score", `${a.averageScore} (${a.reviews} ${a.reviews === 1 ? "review" : "reviews"})`], ["Recommended amount", a.recommendedAmount], ["Recommendation", a.recommendation]] });
    blocks.push({ type: "heading", level: 3, text: "Summary" }, { type: "paragraph", text: a.summary ?? "The application has no summary answer." });
    if (a.criteria.length) blocks.push({ type: "heading", level: 3, text: "Scores by criterion" }, { type: "table", columns: [{ label: "Criterion", width: 4 }, { label: "Weight", width: 1, align: "right" }, { label: "Mean (0 to 100)", width: 1.6, align: "right" }, { label: "Reviews", width: 1, align: "right" }], rows: a.criteria.map((c) => [c.label, String(c.weight), c.mean, String(c.scored)]) });
    if (a.reviewerRecommendations.length) blocks.push({ type: "heading", level: 3, text: "Reviewers' recommendations" }, { type: "list", ordered: false, items: a.reviewerRecommendations });
    blocks.push({ type: "heading", level: 3, text: "Reviewer comments for the panel" });
    if (a.comments.length) blocks.push({ type: "list", ordered: false, items: a.comments.map((c) => `${c.reviewer}${c.funderOnly ? " (funder only)" : ""}, ${c.about}: ${c.text}`) });
    else blocks.push({ type: "paragraph", text: "No comments." });
  }
  return blocks;
}

const docketKey = (workspaceId: string, competitionId: string, docketId: string) => `exports/${workspaceId}/dockets/${competitionId}/${docketId}.pdf`;

/** Build the docket, store it in the EXPORTS bucket under the workspace, and say where to download it. */
export async function createDocket(ctx: ServiceContext, competitionUuid: string, input: z.output<typeof docketInput>) {
  if (!ctx.ports.exportFiles) throw new ApiError(503, "exports_unavailable", "Export storage is not configured on this server, so a docket cannot be kept");
  const model = await docketModel(ctx, competitionUuid, input);
  const ws = ctx.workspace!;
  const funder = await ctx.repos.table("workspaces").one({ id: ws.id });
  const accent = (funder?.brand as { accent?: unknown } | null)?.accent;
  const bytes = await renderPdf({ title: model.title, header: `${model.funder} · Board docket`, footer: `${model.competition} · Confidential`, ...(typeof accent === "string" ? { accent } : {}), blocks: docketBlocks(model), createdAt: model.generatedAt, lang: "en-US" });
  const sha256 = await sha256Hex(bytes);
  const docketId = crypto.randomUUID();
  await ctx.ports.exportFiles.put(docketKey(ws.id, competitionUuid, docketId), bytes, "application/pdf");
  await audit(ctx, "competition.docket_created", "competition", competitionUuid, { docketId, applications: model.applications.length, includeFunderOnlyComments: model.includeFunderOnlyComments, sha256 });
  return {
    docketId,
    competitionId: apiId("competition", competitionUuid),
    applications: model.applications.length,
    includeFunderOnlyComments: model.includeFunderOnlyComments,
    bytes: bytes.byteLength,
    sha256,
    createdAt: model.generatedAt,
    downloadPath: `/gms/competitions/${apiId("competition", competitionUuid)}/dockets/${docketId}`,
  };
}

/** A stored docket's bytes, for the workspace's program staff. */
export async function getDocket(ctx: ServiceContext, competitionUuid: string, docketId: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: DOCKET_ROLES });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionUuid, workspace_id: ws.id }), "Competition");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(docketId)) required(null, "Docket");
  const bytes = ctx.ports.exportFiles ? await ctx.ports.exportFiles.get({ storage: "r2", path: docketKey(ws.id, competition.id, docketId) }) : null;
  const file = required(bytes, "Docket");
  const slug = competition.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "competition";
  return { bytes: file, sha256: await sha256Hex(file), filename: `board-docket-${slug}.pdf` };
}
