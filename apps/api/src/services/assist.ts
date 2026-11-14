// SPDX-License-Identifier: AGPL-3.0-only
// The drafting assistant (build spec §10.11): summarize, compare-to-rubric, draft-letter,
// adapt-answer. Each is one structured model call that returns a draft. Nothing here saves a
// draft into a record, submits, sends or commits; a person takes the draft from there.
//
// Off unless ASSISTANT_ENABLED is true and a model is configured: every function then answers 404,
// and `assistStatus` tells the web app to hide its panels. Calls count against a per-workspace
// monthly quota and each is logged in `assist_calls` (who, which tool, token counts, the subject).
import {
  adaptAnswer as adapt,
  AssistDeclinedError,
  AssistUnavailableError,
  compareToRubric as compare,
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_MONTHLY_QUOTA,
  draftLetter as letter,
  monthStart,
  quotaState,
  summarize as summarizeApp,
  type ApplicationMaterial,
  type AssistUsage,
  type ExternalContext,
  type LlmClient,
} from "@gms/assist";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { getApplicationDetail } from "./inbox.ts";
import { authHeaderOf } from "./integrations.ts";
import { getTemplate } from "./templates.ts";

type Tool = "summarize" | "compare_rubric" | "draft_letter" | "adapt_answer" | "draft_answer" | "parse_guidelines";

const disabled = () => new ApiError(404, "assistant_disabled", "The drafting assistant is not enabled on this server");

/** ASSISTANT_MONTHLY_QUOTA as a whole number of calls, or null (then the default applies). */
export function monthlyQuotaOf(raw: string | undefined | null): number | null {
  const t = raw?.trim();
  if (!t || !/^\d{1,7}$/.test(t)) return null;
  return Number(t);
}

/** A workspace's own limit (`settings.assistMonthlyQuota`, server-set), else the server's, else the default. */
function limitOf(settings: unknown, server: number | null | undefined): number {
  const n = (settings as { assistMonthlyQuota?: unknown } | null)?.assistMonthlyQuota;
  if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n;
  return typeof server === "number" && Number.isInteger(server) && server >= 0 ? server : DEFAULT_MONTHLY_QUOTA;
}

export async function quota(ctx: ServiceContext, ws: ServiceWorkspace) {
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const limit = limitOf(row.settings, ctx.config.assistantMonthlyQuota);
  const since = monthStart(ctx.now()).toISOString();
  // Newest first, one more than the limit: enough to know whether the month is spent.
  const recent = await ctx.repos.table("assist_calls").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false, limit: limit + 1 });
  return quotaState(recent.filter((c) => c.created_at >= since).length, limit, ctx.now());
}

/** On only when the server switched it on and has a model to call. */
export const assistantOn = (ctx: Pick<ServiceContext, "config" | "ports">): boolean => !!ctx.config.assistantEnabled && !!ctx.ports.llm;
export const assistantDisabled = disabled;

/** Whether the assistant is on for this caller, and how much of the month's quota is left. */
export async function assistStatus(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "assist" });
  const enabled = assistantOn(ctx);
  const q = enabled ? await quota(ctx, ws) : null;
  return { enabled, model: enabled ? (ctx.config.assistantModel ?? DEFAULT_ASSISTANT_MODEL) : null, monthlyQuota: q?.limit ?? null, used: q?.used ?? null, quota: q };
}

/**
 * Flag, quota, the model call(s), log: one `assist_calls` row per model call, so a draft that took
 * a second call to fit its limit counts twice (the quota is of calls, owner decision D4). The
 * caller has already been authorized for the material; `remaining` tells it how many calls the
 * month still allows.
 */
export async function runAssist<T>(
  ctx: ServiceContext,
  ws: ServiceWorkspace,
  tool: Tool,
  subject: string | null,
  call: (llm: LlmClient, remaining: number) => Promise<{ draft: true; output: T; usage: AssistUsage; calls?: AssistUsage[] }>,
) {
  const llm = ctx.config.assistantEnabled ? ctx.ports.llm : undefined;
  if (!llm) throw disabled();
  const before = await quota(ctx, ws);
  if (before.remaining <= 0) throw new ApiError(429, "assist_quota_exhausted", `This workspace has used the assistant ${before.limit} times this month, its monthly limit. The count resets on ${before.resetsAt.slice(0, 10)}`);
  let result;
  try {
    result = await call(llm, before.remaining);
  } catch (e) {
    if (e instanceof AssistDeclinedError) throw new ApiError(422, "assistant_declined", "The assistant declined to draft this. Nothing was changed");
    if (e instanceof AssistUnavailableError) throw new ApiError(e.retryable ? 503 : 502, "assistant_unavailable", e.message);
    throw e;
  }
  const calls = result.calls?.length ? result.calls : [result.usage];
  for (const u of calls) await ctx.repos.table("assist_calls").insert({ workspace_id: ws.id, user_id: ctx.actor.userId, tool, tokens_in: u.tokensIn, tokens_out: u.tokensOut, subject });
  return { output: result.output, model: result.usage.model, calls: calls.length, quota: quotaState(before.used + calls.length, before.limit, ctx.now()) };
}

/** One call whose output fields sit beside `draft: true`, as the first four tools answer. */
async function run<T>(ctx: ServiceContext, ws: ServiceWorkspace, tool: Tool, subject: string | null, call: (llm: LlmClient) => Promise<{ draft: true; output: T; usage: AssistUsage }>) {
  const r = await runAssist(ctx, ws, tool, subject, (llm) => call(llm));
  return { draft: true as const, tool, ...r.output, model: r.model, quota: r.quota };
}

// ------------------------------------------------------------------------------------ material

const money = (minor: number | null, currency: string | null) => (minor === null || !currency ? null : `${currency} ${(minor / 100).toFixed(2)}`);

/**
 * What the funder's own systems say about the organization: one call per allow-listed read tool,
 * with the organization's name and EIN as the only context. A server that fails is skipped; a
 * draft never waits on, or fails because of, a third-party system.
 */
async function externalContext(ctx: ServiceContext, ws: ServiceWorkspace, org: { name: string | null; ein: string | null } | null): Promise<ExternalContext[]> {
  const dir = ctx.ports.mcpDirectory;
  if (!org?.name || !dir?.callTool) return [];
  const servers = await ctx.repos.table("custom_mcp_servers").find({ workspace_id: ws.id, read_only: true }, { orderBy: "created_at" });
  const out: ExternalContext[] = [];
  for (const s of servers) {
    for (const tool of s.allowed_tools.slice(0, 3)) {
      if (out.length >= 6) return out;
      try {
        const result = await dir.callTool({ url: s.url, authHeader: await authHeaderOf(ctx, s) }, tool, { organizationName: org.name, ...(org.ein ? { ein: org.ein } : {}) });
        out.push({ server: s.name, tool, result });
      } catch {
        // Skipped: the draft says nothing about this server.
      }
    }
  }
  return out;
}

/** The application as the caller may see it: reviewers get the masked responses, like everywhere else. */
async function applicationMaterial(ctx: ServiceContext, ws: ServiceWorkspace, appUuid: string): Promise<ApplicationMaterial> {
  const d = await getApplicationDetail(ctx, appUuid);
  const projection = d.organization?.projection as { name?: unknown; identifiers?: Record<string, { id?: unknown } | undefined> } | undefined;
  const orgName = typeof projection?.name === "string" ? projection.name : null;
  const ein = projection?.identifiers?.["org:us:ein"]?.id;
  const opp = await ctx.repos.table("opportunities").one({ id: d.opportunityId.replace(/^opp_/, "") });
  const results = (d.eligibilityResults as { results?: { rule?: { label?: string }; label?: string; outcome?: unknown }[] } | null)?.results ?? [];
  return {
    title: d.title,
    opportunity: opp?.title ?? "",
    stage: d.stage,
    organizationName: orgName,
    requestedAmount: money(d.requestedAmountMinor, d.currency),
    responses: d.formResponses.map((r) => ({ form: r.formTitle ?? r.formId, fields: r.response as Record<string, unknown> })),
    eligibility: results.map((r) => ({ label: r.label ?? r.rule?.label ?? "Rule", outcome: String(r.outcome) })),
    external: await externalContext(ctx, ws, orgName ? { name: orgName, ein: typeof ein === "string" ? ein : null } : null),
  };
}

// ------------------------------------------------------------------------------------ the four calls

export async function summarize(ctx: ServiceContext, appUuid: string) {
  const ws = await authorize(ctx, { scope: "assist", kind: "funder" });
  const material = await applicationMaterial(ctx, ws, appUuid);
  const r = await run(ctx, ws, "summarize", apiId("application", appUuid), (llm) => summarizeApp(llm, material));
  return { ...r, applicationId: apiId("application", appUuid), externalServers: [...new Set((material.external ?? []).map((e) => e.server))] };
}

export async function compareToRubric(ctx: ServiceContext, appUuid: string, rubricUuid: string) {
  const ws = await authorize(ctx, { scope: "assist", kind: "funder" });
  const rubric = required(await ctx.repos.table("rubrics").one({ id: rubricUuid, workspace_id: ws.id }), "Rubric");
  const material = await applicationMaterial(ctx, ws, appUuid);
  const criteria = (Array.isArray(rubric.criteria) ? rubric.criteria : []) as { key?: string; label?: string; description?: string; guidance?: string }[];
  const r = await run(ctx, ws, "compare_rubric", apiId("application", appUuid), (llm) =>
    compare(llm, material, { name: rubric.name, criteria: criteria.filter((c) => typeof c.key === "string").map((c) => ({ key: c.key!, label: c.label ?? c.key!, ...(c.description ? { description: c.description } : {}), ...(c.guidance ? { guidance: c.guidance } : {}) })) }),
  );
  return { ...r, applicationId: apiId("application", appUuid), rubricId: rubric.id };
}

export const draftLetterInput = z
  .object({
    templateId: z.string().min(1).max(100),
    purpose: z.string().trim().min(1).max(120).default("decision"),
    applicationId: z.string().max(100).optional(),
    context: z.record(z.string(), z.unknown()).default({}),
    tone: z.string().trim().max(120).optional(),
  })
  .strict();

export async function draftLetter(ctx: ServiceContext, input: Omit<z.output<typeof draftLetterInput>, "applicationId">, appUuid?: string) {
  const ws = await authorize(ctx, { scope: "assist", kind: "funder" });
  const template = await getTemplate(ctx, input.templateId);
  const app = appUuid ? await getApplicationDetail(ctx, appUuid) : null;
  const orgName = (app?.organization?.projection as { name?: unknown } | undefined)?.name;
  const r = await run(ctx, ws, "draft_letter", appUuid ? apiId("application", appUuid) : `template:${template.id}`, (llm) =>
    letter(llm, {
      purpose: input.purpose,
      template: template.subject ? `Subject: ${template.subject}\n\n${template.body}` : template.body,
      context: input.context,
      ...(app ? { applicantSupplied: { applicationTitle: app.title, ...(typeof orgName === "string" ? { organizationName: orgName } : {}) } } : {}),
      ...(input.tone ? { tone: input.tone } : {}),
    }),
  );
  return { ...r, templateId: template.id };
}

export const adaptAnswerInput = z
  .object({
    answerId: z.uuid(),
    question: z.string().trim().min(1).max(2000),
    guidance: z.string().trim().max(4000).optional(),
    limits: z.object({ maxWords: z.number().int().min(1).max(10_000).optional(), maxCharacters: z.number().int().min(1).max(100_000).optional() }).strict().default({}),
  })
  .strict();

export async function adaptAnswer(ctx: ServiceContext, input: z.output<typeof adaptAnswerInput>) {
  const ws = await authorize(ctx, { scope: "assist", kind: "applicant" });
  await authorize(ctx, { scope: "library:read", kind: "applicant" });
  const answer = required(await ctx.repos.table("answers").one({ id: input.answerId, workspace_id: ws.id }), "Answer");
  const r = await run(ctx, ws, "adapt_answer", `answer:${answer.id}`, (llm) => adapt(llm, { answer: answer.body, question: input.question, limits: input.limits, ...(input.guidance ? { guidance: input.guidance } : {}) }));
  return { ...r, answerId: answer.id, answerVersion: answer.version };
}
