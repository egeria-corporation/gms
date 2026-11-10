// SPDX-License-Identifier: AGPL-3.0-only
// Competitions and their stages (build spec §10.4). CommonGrants sees one competition whose forms
// are the union of the stage forms; the stages themselves travel in `customFields.gms`.
import { ProjectionError, projectCompetition, unionStageForms, type CompetitionRow, type FormRow, type StageJson } from "@gms/protocol";
import { parseRules } from "@gms/rules";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId, uuidOf } from "../lib/ids.ts";
import { unprocessable } from "../lib/input.ts";
import { audit, authorize, changeStatus, required, type ServiceContext } from "./context.ts";
import { APPLICANT_TYPES } from "./opportunities.ts";
import type { Row } from "./repos/types.ts";

type Comp = Row<"competitions">;
type J = Comp["stages"];
const json = z.record(z.string(), z.unknown());

const stageInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "Use a short lowercase key such as loi or full"),
    label: z.string().trim().min(1).max(120),
    /** form id → pinned published version. */
    forms: z.record(z.string(), z.number().int().min(1)).default({}),
    opens: z.iso.datetime().nullable().optional(),
    closes: z.iso.datetime().nullable().optional(),
    rubricId: z.uuid().nullable().optional(),
    reviewers: z.string().max(200).nullable().optional(),
    entryFrom: z.array(z.string()).default([]),
    requiresSubmission: z.boolean().default(true),
    decisionRequired: z.boolean().default(true),
  })
  .strict();

export const stagesInput = z.object({ stages: z.array(stageInput).min(1).max(12) }).strict();
export const formsInput = z.object({ forms: z.record(z.string(), z.number().int().min(1)), migrate: z.boolean().optional() }).strict();
export const rubricAssignInput = z.object({ rubricId: z.uuid().nullable(), stage: z.string().optional() }).strict();

export const competitionInput = z
  .object({
    opportunityId: z.string(),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20_000).nullable().optional(),
    instructions: z.string().max(20_000).nullable().optional(),
    keyDates: json.optional(),
    acceptedApplicantTypes: z.array(z.enum(APPLICANT_TYPES)).optional(),
  })
  .strict();
export const competitionPatch = competitionInput.omit({ opportunityId: true }).partial();

const stagesOf = (c: Comp): StageJson[] => (Array.isArray(c.stages) ? (c.stages as unknown as StageJson[]) : []);
const pinnedOf = (c: Comp): Record<string, number> => unionStageForms(stagesOf(c), c.forms as Record<string, number>);

const view = (c: Comp) => ({
  id: apiId("competition", c.id),
  opportunityId: apiId("opportunity", c.opportunity_id),
  title: c.title,
  description: c.description,
  instructions: c.instructions,
  status: c.status,
  keyDates: c.key_dates,
  stages: stagesOf(c).map((s) => ({ ...s, forms: Object.fromEntries(Object.entries(s.forms ?? {}).map(([id, v]) => [apiId("form", id), v])) })),
  forms: Object.fromEntries(Object.entries(pinnedOf(c)).map(([id, v]) => [apiId("form", id), v])),
  validation: c.validation,
  acceptedApplicantTypes: c.accepted_applicant_types,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

/** form id (any accepted spelling) → UUID keys, as stored. */
const formKeys = (forms: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(forms).map(([id, v]) => [uuidOf("form", id, "Form"), v]));

async function own(ctx: ServiceContext, workspaceId: string, id: string): Promise<Comp> {
  return required(await ctx.repos.table("competitions").one({ id, workspace_id: workspaceId }), "Competition");
}

/** The pinned form rows a competition uses; a missing or unpublished pin is reported, not thrown. */
async function pinnedForms(ctx: ServiceContext, workspaceId: string, pinned: Record<string, number>) {
  const rows: Row<"forms">[] = [];
  const problems: { formId: string; version: number; problem: "missing" | "draft" }[] = [];
  for (const [id, version] of Object.entries(pinned)) {
    const row = await ctx.repos.table("forms").one({ id, version });
    if (!row || (row.workspace_id !== null && row.workspace_id !== workspaceId)) problems.push({ formId: id, version, problem: "missing" });
    else if (!row.published_at) problems.push({ formId: id, version, problem: "draft" });
    else rows.push(row);
  }
  return { rows, problems };
}

export async function listCompetitions(ctx: ServiceContext, filter: { opportunityId?: string } = {}) {
  const ws = await authorize(ctx, { scope: "competitions:read", kind: "funder" });
  const rows = await ctx.repos.table("competitions").find({ workspace_id: ws.id, ...(filter.opportunityId ? { opportunity_id: filter.opportunityId } : {}) }, { orderBy: "created_at", ascending: false });
  return rows.map(view);
}

export async function getCompetition(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "competitions:read", kind: "funder" });
  return view(await own(ctx, ws.id, id));
}

export async function createCompetition(ctx: ServiceContext, input: z.output<typeof competitionInput>, opportunityUuid: string) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  required(await ctx.repos.table("opportunities").one({ id: opportunityUuid, workspace_id: ws.id }), "Opportunity");
  const row = await ctx.repos.table("competitions").insert({
    workspace_id: ws.id,
    opportunity_id: opportunityUuid,
    title: input.title,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    ...(input.keyDates ? { key_dates: input.keyDates as J } : {}),
    ...(input.acceptedApplicantTypes ? { accepted_applicant_types: input.acceptedApplicantTypes } : {}),
  });
  await audit(ctx, "competition.created", "competition", row.id, { title: row.title, opportunityId: opportunityUuid });
  return view(row);
}

export async function updateCompetition(ctx: ServiceContext, id: string, input: z.output<typeof competitionPatch>) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  await own(ctx, ws.id, id);
  const [row] = await ctx.repos.table("competitions").update(
    { id, workspace_id: ws.id },
    {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.keyDates !== undefined ? { key_dates: input.keyDates as J } : {}),
      ...(input.acceptedApplicantTypes !== undefined ? { accepted_applicant_types: input.acceptedApplicantTypes } : {}),
    },
  );
  await audit(ctx, "competition.updated", "competition", id, { fields: Object.keys(input) });
  return view(row!);
}

/** Replace the stages. Keys are unique, `entryFrom` names earlier stages, and every pinned form is a published version. */
export async function putStages(ctx: ServiceContext, id: string, input: z.output<typeof stagesInput>) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  const current = await own(ctx, ws.id, id);
  if (current.status !== "draft") throw new ApiError(409, "competition_not_draft", "Stages can change only while the competition is a draft. Use the forms route to move an open competition to a new form version");
  const problems: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  const stages: StageJson[] = input.stages.map((s, i) => {
    if (seen.has(s.key)) problems.push({ path: `stages.${i}.key`, message: `Stage key "${s.key}" is used twice` });
    for (const from of s.entryFrom) if (!seen.has(from)) problems.push({ path: `stages.${i}.entryFrom`, message: `"${from}" is not an earlier stage` });
    if (s.opens && s.closes && Date.parse(s.opens) >= Date.parse(s.closes)) problems.push({ path: `stages.${i}.closes`, message: "A stage must close after it opens" });
    seen.add(s.key);
    return { ...s, forms: formKeys(s.forms), opens: s.opens ?? null, closes: s.closes ?? null, rubricId: s.rubricId ?? null, reviewers: s.reviewers ?? null };
  });
  const pinned = unionStageForms(stages);
  for (const p of (await pinnedForms(ctx, ws.id, pinned)).problems) {
    problems.push({ path: "stages", message: p.problem === "missing" ? `Form ${apiId("form", p.formId)} version ${p.version} does not exist in this workspace or the library` : `Form ${apiId("form", p.formId)} version ${p.version} is a draft; publish it before pinning it` });
  }
  for (const s of stages) if (s.rubricId) await assertRubric(ctx, ws.id, s.rubricId);
  if (problems.length) throw unprocessable("These stages are not valid", problems);
  const [row] = await ctx.repos.table("competitions").update({ id, workspace_id: ws.id }, { stages: stages as unknown as J, forms: pinned as unknown as J });
  await audit(ctx, "competition.stages_set", "competition", id, { stages: stages.map((s) => s.key), forms: pinned });
  return view(row!);
}

async function assertRubric(ctx: ServiceContext, workspaceId: string, rubricId: string) {
  const rows = await ctx.repos.table("rubrics").find({ id: rubricId });
  if (!rows.some((r) => r.workspace_id === workspaceId || r.workspace_id === null)) required(null, "Rubric");
}

/**
 * Change the pinned form versions. On an open competition this needs `migrate: true`, because
 * in-progress responses are re-validated against the new version.
 */
export async function putForms(ctx: ServiceContext, id: string, input: z.output<typeof formsInput>) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  const current = await own(ctx, ws.id, id);
  if (current.status === "closed") throw new ApiError(409, "competition_closed", "A closed competition keeps the form versions it ran with");
  if (current.status === "open" && !input.migrate) throw new ApiError(409, "migrate_required", "This competition is open. Send migrate: true to move in-progress applications to the new form versions");
  const next = formKeys(input.forms);
  const { problems } = await pinnedForms(ctx, ws.id, next);
  if (problems.length) throw unprocessable("These form versions cannot be pinned", problems.map((p) => ({ path: `forms.${apiId("form", p.formId)}`, message: p.problem === "missing" ? "This form version does not exist" : "This version is a draft; publish it first" })));
  // Stages keep the forms they had; a form they pin moves to its new version.
  const stages = stagesOf(current).map((s) => ({ ...s, forms: Object.fromEntries(Object.keys(s.forms ?? {}).map((f) => [f, next[f] ?? s.forms[f]!])) }));
  const pinned = stages.length ? { ...unionStageForms(stages) } : next;
  const [row] = await ctx.repos.table("competitions").update({ id, workspace_id: ws.id }, { forms: pinned as unknown as J, stages: stages as unknown as J });
  await audit(ctx, "competition.forms_set", "competition", id, { from: pinnedOf(current), to: pinned, migrate: input.migrate === true });
  return view(row!);
}

/** Set the rubric for one stage (or for every stage that needs a decision when no stage is named). */
export async function putRubric(ctx: ServiceContext, id: string, input: z.output<typeof rubricAssignInput>) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  const current = await own(ctx, ws.id, id);
  if (input.rubricId) await assertRubric(ctx, ws.id, input.rubricId);
  const stages = stagesOf(current);
  if (!stages.length) throw new ApiError(409, "no_stages", "Add at least one stage before choosing a rubric");
  if (input.stage && !stages.some((s) => s.key === input.stage)) throw unprocessable("These stages are not valid", [{ path: "stage", message: `There is no stage "${input.stage}"` }]);
  const next = stages.map((s) => (input.stage ? s.key === input.stage : s.decisionRequired) ? { ...s, rubricId: input.rubricId } : s);
  const [row] = await ctx.repos.table("competitions").update({ id, workspace_id: ws.id }, { stages: next as unknown as J });
  await audit(ctx, "competition.rubric_set", "competition", id, { stage: input.stage ?? null, rubricId: input.rubricId });
  return view(row!);
}

export interface ChecklistItem {
  key: string;
  state: "pass" | "fail" | "unknown";
  label: string;
  reason: string;
  fixHref: string | null;
}

/**
 * The launch checklist: the same shape as payment readiness and application submit. A primary
 * action is disabled while any line fails; `unknown` is its own state and never counts as a pass.
 */
export async function launchCheck(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "competitions:read", kind: "funder" });
  const comp = await own(ctx, ws.id, id);
  return buildChecklist(ctx, ws.id, comp);
}

async function buildChecklist(ctx: ServiceContext, workspaceId: string, comp: Comp) {
  const opp = required(await ctx.repos.table("opportunities").one({ id: comp.opportunity_id, workspace_id: workspaceId }), "Opportunity");
  const funder = required(await ctx.repos.table("workspaces").one({ id: workspaceId }), "Workspace");
  const base = `/w/${funder.handle}`;
  const compHref = `${base}/competitions/${apiId("competition", comp.id)}`;
  const stages = stagesOf(comp);
  const item = (key: string, ok: boolean | "unknown", label: string, pass: string, fail: string, fixHref: string | null): ChecklistItem => ({ key, state: ok === "unknown" ? "unknown" : ok ? "pass" : "fail", label, reason: ok === true ? pass : fail, fixHref: ok === true ? null : fixHref });

  const { rows: formRows, problems } = await pinnedForms(ctx, workspaceId, pinnedOf(comp));
  const stagesMissingForms = stages.filter((s) => s.requiresSubmission && !Object.keys(s.forms ?? {}).length);
  const badDates = stages.filter((s) => s.opens && s.closes && Date.parse(s.opens) >= Date.parse(s.closes));
  const undated = stages.filter((s) => s.requiresSubmission && !s.closes);
  const noRubric = stages.filter((s) => s.decisionRequired && !s.rubricId);
  const rules = parseRules(opp.eligibility_rules);
  let projection: true | string = true;
  try {
    projectCompetition({ competition: comp as unknown as CompetitionRow, opportunity: { id: opp.id, title: opp.title }, forms: formRows as unknown as FormRow[] });
  } catch (e) {
    projection = e instanceof ProjectionError ? e.issues.map((i) => i.message).join("; ") : "The competition could not be projected";
  }
  const names = (xs: StageJson[]) => xs.map((s) => s.label).join(", ");

  const items: ChecklistItem[] = [
    item("opportunity_published", opp.published_at !== null && opp.status !== "closed", "Opportunity is published", `${opp.title} is live`, opp.status === "closed" ? "The opportunity is closed" : "Publish the opportunity so applicants can find this competition", `${base}/opportunities/${apiId("opportunity", opp.id)}/edit`),
    item("stages", stages.length > 0, "At least one stage", `${stages.length} stage${stages.length === 1 ? "" : "s"}: ${names(stages)}`, "Add a stage; a single stage is the common case", compHref),
    item("stage_forms", stages.length > 0 && stagesMissingForms.length === 0, "Every submission stage has a form", "Each stage that takes a submission pins a form", stagesMissingForms.length ? `No form on: ${names(stagesMissingForms)}` : "Stages need forms", compHref),
    item("forms_published", stages.length > 0 && problems.length === 0, "Pinned form versions are published", `${formRows.length} form version${formRows.length === 1 ? "" : "s"} pinned`, problems.length ? `${problems.length} pinned form version${problems.length === 1 ? " is" : "s are"} missing or still a draft` : "No forms pinned yet", `${base}/forms`),
    item("stage_dates", stages.length > 0 && badDates.length === 0 && undated.length === 0, "Stage dates are set", "Every submission stage has a closing date after its opening date", badDates.length ? `Closes before it opens: ${names(badDates)}` : `No closing date on: ${names(undated)}`, compHref),
    item("rubrics", stages.length > 0 && noRubric.length === 0, "Decision stages have a rubric", "Reviewers will score against a rubric", `No rubric on: ${names(noRubric)}`, compHref),
    item("eligibility_rules", rules.ok, "Eligibility rules are valid", "Rules run at submit and never auto-decline an unknown", rules.ok ? "" : `${rules.errors.length} problem${rules.errors.length === 1 ? "" : "s"} in the rules`, `${base}/opportunities/${apiId("opportunity", opp.id)}/edit#who`),
    item("commongrants", projection === true, "Valid CommonGrants competition", "The competition and its forms validate against CommonGrants v0.5.0", projection === true ? "" : projection, compHref),
  ];
  const count = (state: ChecklistItem["state"]) => items.filter((i) => i.state === state).length;
  return { ready: count("fail") === 0 && count("unknown") === 0, summary: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") }, items };
}

export async function openCompetition(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  const comp = await own(ctx, ws.id, id);
  let saved: Comp | undefined;
  await changeStatus(ctx, {
    event: "competition.opened",
    subjectType: "competition",
    subjectId: id,
    current: comp.status,
    from: ["draft"],
    to: "open",
    guard: async () => {
      const check = await buildChecklist(ctx, ws.id, comp);
      const first = check.items.find((i) => i.state !== "pass");
      return first ? `The launch checklist has not passed: ${first.label.toLowerCase()} (${first.reason})` : null;
    },
    write: async () => {
      const opp = required(await ctx.repos.table("opportunities").one({ id: comp.opportunity_id, workspace_id: ws.id }), "Opportunity");
      const { rows } = await pinnedForms(ctx, ws.id, pinnedOf(comp));
      const at = ctx.now().toISOString();
      const cg = projectCompetition({ competition: { ...comp, status: "open", updated_at: at } as unknown as CompetitionRow, opportunity: { id: opp.id, title: opp.title }, forms: rows as unknown as FormRow[] });
      [saved] = await ctx.repos.table("competitions").update({ id, workspace_id: ws.id }, { status: "open", cg: cg as unknown as J });
    },
    data: { stages: stagesOf(comp).map((s) => s.key) },
  });
  return view(saved!);
}

export async function closeCompetition(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  const comp = await own(ctx, ws.id, id);
  let saved: Comp | undefined;
  await changeStatus(ctx, {
    event: "competition.closed",
    subjectType: "competition",
    subjectId: id,
    current: comp.status,
    from: ["open"],
    to: "closed",
    write: async () => {
      [saved] = await ctx.repos.table("competitions").update({ id, workspace_id: ws.id }, { status: "closed" });
    },
  });
  return view(saved!);
}
