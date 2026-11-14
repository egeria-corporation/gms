// SPDX-License-Identifier: AGPL-3.0-only
// Quick setup: one action that takes a published opportunity to the point where it can open for
// applications. It makes editable drafts through the same service functions the screens call, so
// every rule holds (scopes, same-workspace checks, form definition and CommonGrants validation):
//   - a one-stage competition dated from the opportunity's open and close dates;
//   - a starter application form, published and pinned to the stage;
//   - a starter rubric (four criteria, each scored 1 to 5) on the stage.
// It never overwrites what the funder set: an existing draft competition keeps its stages, and only
// a missing form, rubric or date on its first stage is filled in. Run twice, it reuses what it made.
// Opening stays a separate step (`openCompetition`), behind the unchanged launch checklist.
import type { StageJson } from "@gms/protocol";
import type { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { createCompetition, getCompetition, launchCheck, putStages, type stagesInput } from "./competitions.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { createForm, publishFormVersion } from "./forms.ts";
import { createRubric, type rubricInput } from "./programs.ts";
import type { Row } from "./repos/types.ts";

type Comp = Row<"competitions">;
type FormRow = Row<"forms">;

/** The opportunity title as it appears in the names of what quick setup makes. */
const short = (title: string) => (title.length > 250 ? `${title.slice(0, 249)}…` : title);
export const starterFormTitle = (oppTitle: string) => `${short(oppTitle)} application`;
export const starterRubricName = (oppTitle: string) => `${short(oppTitle)} rubric`;
export const STARTER_STAGE = { key: "application", label: "Application" } as const;

/** The starter application form. Every field can be changed in the form builder before opening. */
export const STARTER_FORM = {
  description: "Starter application form made by quick setup. Edit it in the form builder before you open applications.",
  purpose: "application" as const,
  jsonSchema: {
    type: "object",
    required: ["projectTitle", "summary", "requestedAmount", "useOfFunds", "outcomes", "budget", "contactName", "contactEmail"],
    properties: {
      projectTitle: { type: "string", title: "Project title", maxLength: 200 },
      summary: { type: "string", title: "Project summary", "x-wordCount": { max: 300 } },
      requestedAmount: { type: "object", title: "Amount requested" },
      useOfFunds: { type: "string", title: "How the funds will be used", "x-wordCount": { max: 300 } },
      outcomes: { type: "string", title: "Expected outcomes", "x-wordCount": { max: 300 } },
      budget: { type: "object", title: "Budget" },
      contactName: { type: "string", title: "Contact name", maxLength: 200 },
      contactEmail: { type: "string", format: "email", title: "Contact email" },
      contactPhone: { type: "string", title: "Contact phone" },
    },
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      {
        type: "Group",
        label: "Project",
        elements: [
          { type: "Control", scope: "#/properties/projectTitle" },
          { type: "Control", scope: "#/properties/summary", options: { help: "What the project is and who it serves." } },
          { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } },
          { type: "Control", scope: "#/properties/useOfFunds" },
          { type: "Control", scope: "#/properties/outcomes", options: { help: "What will change, and how you will know." } },
        ],
      },
      {
        type: "Group",
        label: "Budget",
        elements: [{ type: "Control", scope: "#/properties/budget", options: { widget: "fileRef", help: "Upload your project budget as a PDF or spreadsheet." } }],
      },
      {
        type: "Group",
        label: "Contact",
        elements: [
          { type: "Control", scope: "#/properties/contactName" },
          {
            type: "HorizontalLayout",
            elements: [
              { type: "Control", scope: "#/properties/contactEmail", options: { pii: true } },
              { type: "Control", scope: "#/properties/contactPhone", options: { widget: "phone", pii: true } },
            ],
          },
        ],
      },
    ],
  },
  mappingFromCommonGrants: {},
  mappingToCommonGrants: { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } },
};

/** The starter rubric: four criteria, equal weight, each scored 1 to 5. */
export const STARTER_RUBRIC: Omit<z.output<typeof rubricInput>, "name"> = {
  criteria: [
    { key: "alignment", label: "Alignment with the opportunity", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "feasibility", label: "Feasibility", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "budget", label: "Budget", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "impact", label: "Community impact", weight: 1, scale: { type: "numeric", min: 1, max: 5 } },
  ],
  overall: { recommendations: ["Fund", "Fund with conditions", "Do not fund"] },
};

const stagesOf = (c: Comp): StageJson[] => (Array.isArray(c.stages) ? (c.stages as unknown as StageJson[]) : []);

/** The calendar date of an opportunity key date (`singleDate`, or the end of a `dateRange`). */
function dayOf(keyDates: unknown, which: "postDate" | "closeDate"): string | null {
  const d = (keyDates as Record<string, { date?: unknown; startDate?: unknown; endDate?: unknown } | undefined> | null)?.[which];
  const v = which === "postDate" ? (d?.date ?? d?.startDate) : (d?.date ?? d?.endDate);
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** A stage as `putStages` takes it, from what is stored. */
const stageInputOf = (s: StageJson): z.output<typeof stagesInput>["stages"][number] => ({
  key: s.key,
  label: s.label,
  forms: { ...(s.forms ?? {}) },
  opens: s.opens ?? null,
  closes: s.closes ?? null,
  rubricId: s.rubricId ?? null,
  reviewers: s.reviewers ?? null,
  entryFrom: [...(s.entryFrom ?? [])],
  requiresSubmission: s.requiresSubmission !== false,
  decisionRequired: s.decisionRequired !== false,
});

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The starter form this opportunity already has: one quick setup made earlier (found by its title),
 * at its latest published version, or an untouched first draft of it. Null when there is none.
 */
async function existingStarterForm(ctx: ServiceContext, workspaceId: string, title: string): Promise<{ id: string; version: number; draft: boolean } | null> {
  const rows = await ctx.repos.table("forms").find({ workspace_id: workspaceId, title });
  const byId = new Map<string, FormRow[]>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  for (const versions of byId.values()) {
    versions.sort((a, b) => a.version - b.version);
    const published = versions.filter((v) => v.published_at);
    if (published.length) return { id: published[published.length - 1]!.id, version: published[published.length - 1]!.version, draft: false };
    const [only] = versions;
    if (versions.length === 1 && only && sameJson(only.json_schema, STARTER_FORM.jsonSchema)) return { id: only.id, version: only.version, draft: true };
  }
  return null;
}

export interface QuickSetupResult {
  competition: Awaited<ReturnType<typeof getCompetition>>;
  form: { id: string; version: number; title: string } | null;
  rubric: { id: string; version: number; name: string } | null;
  /** What this run made; false means it was there already and was reused. */
  created: { competition: boolean; form: boolean; rubric: boolean };
  checklist: Awaited<ReturnType<typeof launchCheck>>;
}

export async function quickSetupCompetition(ctx: ServiceContext, opportunityUuid: string): Promise<QuickSetupResult> {
  // Every write below re-runs its own check; asking for all three scopes first means a caller
  // missing one is refused before anything is made.
  const ws = await authorize(ctx, { scope: "competitions:write", kind: "funder" });
  for (const scope of ["competitions:read", "forms:write", "reviews:write"] as const) await authorize(ctx, { scope, kind: "funder" });
  const opp = required(await ctx.repos.table("opportunities").one({ id: opportunityUuid, workspace_id: ws.id }), "Opportunity");
  if (opp.status === "closed") throw new ApiError(409, "opportunity_closed", "This opportunity is closed, so it cannot take applications");

  const created = { competition: false, form: false, rubric: false };
  let changed = false;
  // An open competition is already taking applications; otherwise reuse the newest draft.
  const comps = (await ctx.repos.table("competitions").find({ workspace_id: ws.id, opportunity_id: opp.id }, { orderBy: "created_at", ascending: false })) as Comp[];
  let comp = comps.find((c) => c.status === "open") ?? comps.find((c) => c.status === "draft") ?? null;
  if (!comp) {
    const made = await createCompetition(ctx, { opportunityId: apiId("opportunity", opp.id), title: opp.title }, opp.id);
    created.competition = true;
    comp = required(await ctx.repos.table("competitions").one({ id: made.id.replace(/^cmp_/, ""), workspace_id: ws.id }), "Competition");
  }

  const stages = stagesOf(comp).map(stageInputOf);
  let first = stages[0];
  let form: QuickSetupResult["form"] = null;
  let rubric: QuickSetupResult["rubric"] = null;

  if (comp.status === "draft") {
    const before = JSON.stringify(stages);
    if (!first) {
      first = { ...STARTER_STAGE, forms: {}, opens: null, closes: null, rubricId: null, reviewers: null, entryFrom: [], requiresSubmission: true, decisionRequired: true };
      stages.push(first);
    }
    const opens = dayOf(opp.key_dates, "postDate");
    const closes = dayOf(opp.key_dates, "closeDate");
    // A date is filled in only where it is missing, and never so that the stage closes before it opens.
    const inOrder = (a: string | null | undefined, b: string | null | undefined) => !a || !b || Date.parse(a) < Date.parse(b);
    if (!first.opens && opens && inOrder(`${opens}T00:00:00Z`, first.closes)) first.opens = `${opens}T00:00:00Z`;
    if (!first.closes && closes && inOrder(first.opens, `${closes}T23:59:59Z`)) first.closes = `${closes}T23:59:59Z`;

    if (first.requiresSubmission && !Object.keys(first.forms).length) {
      const title = starterFormTitle(opp.title);
      let found = await existingStarterForm(ctx, ws.id, title);
      if (!found) {
        const made = await createForm(ctx, { title, ...STARTER_FORM, jsonSchema: STARTER_FORM.jsonSchema as Record<string, unknown>, uiSchema: STARTER_FORM.uiSchema as Record<string, unknown> });
        found = { id: made.id.replace(/^frm_/, ""), version: made.version, draft: true };
        created.form = true;
      }
      if (found.draft) await publishFormVersion(ctx, found.id);
      first.forms = { [found.id]: found.version };
    }

    if (first.decisionRequired && !first.rubricId) {
      const name = starterRubricName(opp.title);
      const [existing] = await ctx.repos.table("rubrics").find({ workspace_id: ws.id, name }, { orderBy: "created_at", ascending: false });
      if (existing) first.rubricId = existing.id;
      else {
        first.rubricId = (await createRubric(ctx, { name, ...STARTER_RUBRIC })).id;
        created.rubric = true;
      }
    }

    if (JSON.stringify(stages) !== before) {
      await putStages(ctx, comp.id, { stages });
      changed = true;
    }
  }

  const after = await getCompetition(ctx, comp.id);
  const pinned = Object.entries(stagesOf(required(await ctx.repos.table("competitions").one({ id: comp.id, workspace_id: ws.id }), "Competition"))[0]?.forms ?? {})[0];
  if (pinned) {
    const row = await ctx.repos.table("forms").one({ id: pinned[0], version: pinned[1] });
    form = { id: apiId("form", pinned[0]), version: pinned[1], title: row?.title ?? "" };
  }
  const rubricId = after.stages[0]?.rubricId;
  if (rubricId) {
    const row = (await ctx.repos.table("rubrics").find({ id: rubricId })).find((r) => r.workspace_id === ws.id || r.workspace_id === null);
    if (row) rubric = { id: row.id, version: row.version, name: row.name };
  }
  // A run that only reused what was there changes nothing, so it records nothing.
  if (changed || created.competition) await audit(ctx, "competition.quick_setup", "competition", comp.id, { opportunityId: opp.id, created, formId: form?.id ?? null, rubricId: rubric?.id ?? null });
  return { competition: after, form, rubric, created, checklist: await launchCheck(ctx, comp.id) };
}
