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
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@gms/i18n";
import { emailDate, emailT, type EmailKey, type EmailT } from "@gms/notify";
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

// The docket's fixed words are in the `email` catalog (documents' fixed text, docs/i18n.md), in the
// language of the person who asks for it. What reviewers and applicants wrote stays as written.
const OUTCOME: Record<string, EmailKey> = { approve: "pdf.docket.outcome.approve", decline: "pdf.docket.outcome.decline", waitlist: "pdf.docket.outcome.waitlist", defer: "pdf.docket.outcome.defer" };
const RECOMMENDATION: Record<string, EmailKey> = { fund: "pdf.docket.recommend.fund", fund_with_conditions: "pdf.docket.recommend.fund_with_conditions", do_not_fund: "pdf.docket.recommend.do_not_fund", decline: "pdf.docket.recommend.do_not_fund", waitlist: "pdf.docket.recommend.waitlist" };
const money = (minor: number | null | undefined, currency: string) => {
  if (minor === null || minor === undefined) return "—";
  const m = toMoney(minor, currency);
  const [whole, cents] = m.amount.split(".");
  return `${currency === "USD" ? "$" : `${currency} `}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents && cents !== "00" ? `.${cents}` : ""}`;
};
const one = (x: number | null | undefined) => (x === null || x === undefined ? "—" : (Math.round(x * 10) / 10).toFixed(1));
const human = (t: EmailT, s: string) => (RECOMMENDATION[s] ? t(RECOMMENDATION[s]) : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

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
  /** The mean score out of 100 ("72.5"); null when no review is scored. */
  averageScore: string | null;
  reviews: number;
  budgetTotal: string;
  summary: string | null;
  criteria: { label: string; weight: number; mean: string; scored: number }[];
  reviewerRecommendations: string[];
  comments: DocketComment[];
}

export interface DocketModel {
  /** The language the docket's fixed words are in. */
  locale: Locale;
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
  const locale = ctx.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
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
      const who = t("pdf.docket.reviewer", { number: String(reviewerNo.get(a.reviewer_user_id) ?? "?") });
      if (review.recommendation) reviewerRecommendations.push(`${who}: ${human(t, review.recommendation)}${funderOnly ? ` ${t("pdf.docket.funderOnly")}` : ""}`);
      if (review.narrative?.trim()) comments.push({ reviewer: who, funderOnly, about: t("pdf.docket.narrative"), text: scrubNumbers(review.narrative.trim()) });
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
      title: app.title || t("pdf.docket.untitled"),
      applicant: applicant?.display_name ?? t("pdf.docket.unknownApplicant"),
      requested: money(app.requested_amount_minor, app.currency),
      recommendedAmount: money(recommended, latest?.currency ?? app.currency),
      recommendation: latest ? t(latest.committed_at ? "pdf.docket.committed" : "pdf.docket.proposed", { outcome: OUTCOME[latest.outcome] ? t(OUTCOME[latest.outcome]!) : latest.outcome }) : t("pdf.docket.undecided"),
      averageScore: rank?.mean !== null && rank?.mean !== undefined ? one(rank.mean) : null,
      reviews: rank?.n ?? 0,
      budgetTotal: proposed ? money(lines.reduce((s, l) => s + (l.amountMinor ?? l.amount_minor ?? 0), 0), proposed.currency) : t("pdf.docket.noBudget"),
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
    locale,
    title: t("pdf.docket.title", { competition: competition.title }),
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

/** The docket as PDF blocks: cover, summary table, a page per application, in the model's language. */
export function docketBlocks(m: DocketModel): Block[] {
  const locale = m.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const score = (a: DocketApplication) => (a.averageScore === null ? t("pdf.docket.notScored") : t("pdf.docket.scoreOf100", { score: a.averageScore }));
  const blocks: Block[] = [
    { type: "heading", level: 1, text: t("pdf.docket.heading") },
    { type: "paragraph", text: m.competition },
    { type: "fields", rows: [[t("pdf.docket.funder"), m.funder], [t("pdf.docket.opportunity"), m.opportunity], [t("pdf.docket.stage"), m.stage], [t("pdf.docket.prepared"), emailDate(locale, m.generatedAt.slice(0, 10))], [t("pdf.docket.applications"), String(m.totals.applications)], [t("pdf.docket.totalRequested"), m.totals.requested], [t("pdf.docket.totalRecommended"), m.totals.recommended]] },
    { type: "paragraph", text: t("pdf.docket.confidential") },
    { type: "paragraph", text: t(m.includeFunderOnlyComments ? "pdf.docket.withFunderOnly" : "pdf.docket.withoutFunderOnly") },
    { type: "pageBreak" },
    { type: "heading", level: 2, text: t("pdf.docket.summary") },
    {
      type: "table",
      columns: [{ label: t("pdf.docket.applicant"), width: 3 }, { label: t("pdf.docket.request"), width: 1.6, align: "right" }, { label: t("pdf.docket.recommended"), width: 1.6, align: "right" }, { label: t("pdf.docket.averageScore"), width: 1.4, align: "right" }, { label: t("pdf.docket.recommendation"), width: 2 }],
      rows: m.applications.map((a) => [`${a.applicant} · ${a.title}`, a.requested, a.recommendedAmount, a.averageScore ?? t("pdf.docket.notScored"), a.recommendation]),
    },
  ];
  for (const a of m.applications) {
    blocks.push({ type: "pageBreak" }, { type: "heading", level: 2, text: a.title }, { type: "fields", rows: [[t("pdf.docket.applicant"), a.applicant], [t("pdf.docket.request"), a.requested], [t("pdf.docket.budgetTotal"), a.budgetTotal], [t("pdf.docket.averageScore"), t("pdf.docket.averageWithReviews", { score: score(a), count: a.reviews })], [t("pdf.docket.recommendedAmount"), a.recommendedAmount], [t("pdf.docket.recommendation"), a.recommendation]] });
    blocks.push({ type: "heading", level: 3, text: t("pdf.docket.summary") }, { type: "paragraph", text: a.summary ?? t("pdf.docket.noSummary") });
    if (a.criteria.length) blocks.push({ type: "heading", level: 3, text: t("pdf.docket.scores") }, { type: "table", columns: [{ label: t("pdf.docket.criterion"), width: 4 }, { label: t("pdf.docket.weight"), width: 1, align: "right" }, { label: t("pdf.docket.mean"), width: 1.6, align: "right" }, { label: t("pdf.docket.reviews"), width: 1, align: "right" }], rows: a.criteria.map((c) => [c.label, String(c.weight), c.mean, String(c.scored)]) });
    if (a.reviewerRecommendations.length) blocks.push({ type: "heading", level: 3, text: t("pdf.docket.reviewerRecommendations") }, { type: "list", ordered: false, items: a.reviewerRecommendations });
    blocks.push({ type: "heading", level: 3, text: t("pdf.docket.comments") });
    if (a.comments.length) blocks.push({ type: "list", ordered: false, items: a.comments.map((c) => `${c.reviewer}${c.funderOnly ? ` ${t("pdf.docket.funderOnly")}` : ""}, ${c.about}: ${c.text}`) });
    else blocks.push({ type: "paragraph", text: t("pdf.docket.noComments") });
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
  const t = emailT(model.locale);
  const bytes = await renderPdf({ title: model.title, header: t("pdf.docket.header", { funder: model.funder }), footer: t("pdf.docket.footer", { competition: model.competition }), ...(typeof accent === "string" ? { accent } : {}), blocks: docketBlocks(model), createdAt: model.generatedAt, lang: INTL_LOCALE[model.locale], pageLabel: (page, total) => t("pdf.page", { page, total }) });
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
