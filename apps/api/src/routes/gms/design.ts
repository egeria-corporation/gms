// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for what a funder designs before anyone applies: programs, opportunities,
// competitions, forms, rubrics and eligibility dry-runs (build spec §9.2).
import { gateNamesFor } from "@gms/mcp";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { workspaceGates } from "../../auth/rest-gates.ts";
import { forbidden } from "../../auth/verify.ts";
import { created, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as competitions from "../../services/competitions.ts";
import * as eligibility from "../../services/eligibility.ts";
import * as forms from "../../services/forms.ts";
import * as opportunities from "../../services/opportunities.ts";
import * as programs from "../../services/programs.ts";
import * as quickSetup from "../../services/quick-setup.ts";
import { jsonBody, page, svc, versionQuery } from "../http.ts";

export const designRoutes = new Hono<AppEnv>();
for (const prefix of ["programs", "opportunities", "competitions", "forms", "rubrics", "eligibility"]) {
  designRoutes.use(`/${prefix}`, authenticate());
  designRoutes.use(`/${prefix}/*`, authenticate());
}

type P = { req: { param(name: string): string | undefined } };
const programId = (c: P) => bareUuid(c.req.param("id"), "Program");
const oppId = (c: P) => uuidOf("opportunity", c.req.param("id"), "Opportunity");
const compId = (c: P) => uuidOf("competition", c.req.param("id"), "Competition");
const formId = (c: P) => uuidOf("form", c.req.param("id"), "Form");

// ---- programs ----
designRoutes.get("/programs", async (c) => {
  const p = page(c);
  const { items, total } = await programs.listPrograms(await svc(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
designRoutes.post("/programs", async (c) => c.json(created(await programs.createProgram(await svc(c), parse(programs.programInput, await jsonBody(c)))), 201));
designRoutes.get("/programs/:id", async (c) => c.json(ok(await programs.getProgram(await svc(c), programId(c)))));
designRoutes.get("/programs/:id/budget-categories", async (c) => c.json(ok(await programs.getBudgetCategories(await svc(c), programId(c)))));
designRoutes.put("/programs/:id/budget-categories", async (c) => c.json(ok(await programs.putBudgetCategories(await svc(c), programId(c), parse(programs.budgetCategoriesInput, await jsonBody(c))))));
designRoutes.patch("/programs/:id", async (c) => c.json(ok(await programs.updateProgram(await svc(c), programId(c), parse(programs.programPatch, await jsonBody(c))))));

// ---- rubrics ----
designRoutes.get("/rubrics", async (c) => {
  const items = await programs.listRubrics(await svc(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
designRoutes.post("/rubrics", async (c) => c.json(created(await programs.createRubric(await svc(c), parse(programs.rubricInput, await jsonBody(c)))), 201));

// ---- opportunities ----
designRoutes.get("/opportunities", async (c) => {
  const p = page(c);
  const program = c.req.query("programId");
  const { items, total } = await opportunities.listOpportunities(await svc(c), p, { status: c.req.query("status"), ...(program ? { programId: bareUuid(program, "Program") } : {}) });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
designRoutes.post("/opportunities", async (c) => c.json(created(await opportunities.createOpportunity(await svc(c), parse(opportunities.opportunityInput, await jsonBody(c)))), 201));
designRoutes.get("/opportunities/:id", async (c) => c.json(ok(await opportunities.getOpportunity(await svc(c), oppId(c)))));
designRoutes.patch("/opportunities/:id", async (c) => c.json(ok(await opportunities.updateOpportunity(await svc(c), oppId(c), parse(opportunities.opportunityPatch, await jsonBody(c))))));
designRoutes.post("/opportunities/:id/publish", async (c) => c.json(ok(await opportunities.publishOpportunity(await svc(c), oppId(c), parse(opportunities.publishInput, await jsonBody(c))))));
designRoutes.post("/opportunities/:id/close", async (c) => c.json(ok(await opportunities.closeOpportunity(await svc(c), oppId(c)))));
designRoutes.post("/opportunities/:id/preview", async (c) => c.json(ok(await opportunities.previewOpportunity(await svc(c), oppId(c)))));
/**
 * A gate on a composite tool's parts holds it over REST too (`svc()` checks only the route's own
 * tool): an agent or API-client token cannot make, through quick setup, what a gate would hold.
 */
async function refuseGated(c: Context<AppEnv>, tool: string) {
  const p = c.get("principal");
  if (p.kind === "user" || p.scopes.includes("approvals:bypass")) return;
  const ws = await c.get("deps").repos.table("workspaces").one({ id: p.workspaceId });
  const client = p.clientId ? await c.get("deps").auth.getClient(p.clientId) : null;
  const gated = new Set([...workspaceGates(ws?.settings), ...(client?.gatedTools ?? [])]);
  const held = gateNamesFor(tool).find((t) => gated.has(t));
  if (held) throw forbidden("approval_required", `This workspace requires a person's approval for ${held}. Call the MCP tool ${tool}, which files the approval request, or do it in the GMS`);
}

/** Quick setup: a one-stage draft competition with a starter form and rubric, ready for the launch checklist. */
designRoutes.post("/opportunities/:id/quick-setup", async (c) => {
  parse(z.object({}).strict(), await jsonBody(c));
  await refuseGated(c, "quick_setup_competition");
  return c.json(ok(await quickSetup.quickSetupCompetition(await svc(c), oppId(c))));
});

// ---- competitions ----
designRoutes.get("/competitions", async (c) => {
  const opp = c.req.query("opportunityId");
  const items = await competitions.listCompetitions(await svc(c), opp ? { opportunityId: uuidOf("opportunity", opp, "Opportunity") } : {});
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
designRoutes.post("/competitions", async (c) => {
  const input = parse(competitions.competitionInput, await jsonBody(c));
  return c.json(created(await competitions.createCompetition(await svc(c), input, uuidOf("opportunity", input.opportunityId, "Opportunity"))), 201);
});
designRoutes.get("/competitions/:id", async (c) => c.json(ok(await competitions.getCompetition(await svc(c), compId(c)))));
designRoutes.patch("/competitions/:id", async (c) => c.json(ok(await competitions.updateCompetition(await svc(c), compId(c), parse(competitions.competitionPatch, await jsonBody(c))))));
designRoutes.put("/competitions/:id/stages", async (c) => c.json(ok(await competitions.putStages(await svc(c), compId(c), parse(competitions.stagesInput, await jsonBody(c))))));
designRoutes.put("/competitions/:id/forms", async (c) => c.json(ok(await competitions.putForms(await svc(c), compId(c), parse(competitions.formsInput, await jsonBody(c))))));
designRoutes.put("/competitions/:id/rubric", async (c) => c.json(ok(await competitions.putRubric(await svc(c), compId(c), parse(competitions.rubricAssignInput, await jsonBody(c))))));
designRoutes.post("/competitions/:id/launch-check", async (c) => c.json(ok(await competitions.launchCheck(await svc(c), compId(c)))));
designRoutes.post("/competitions/:id/open", async (c) => c.json(ok(await competitions.openCompetition(await svc(c), compId(c)))));
designRoutes.post("/competitions/:id/close", async (c) => c.json(ok(await competitions.closeCompetition(await svc(c), compId(c)))));

// ---- forms ----
designRoutes.get("/forms", async (c) => {
  const p = page(c);
  const { items, total } = await forms.listForms(await svc(c), p, { purpose: c.req.query("purpose") });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
designRoutes.get("/forms/library", async (c) => {
  const p = page(c);
  const { items, total } = await forms.listLibrary(await svc(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
designRoutes.post("/forms", async (c) => {
  const input = parse(forms.formInput, await jsonBody(c));
  return c.json(created(await forms.createForm(await svc(c), input, input.copyFrom ? uuidOf("form", input.copyFrom.id, "Form to copy") : undefined)), 201);
});
designRoutes.get("/forms/:id", async (c) => c.json(ok(await forms.getForm(await svc(c), formId(c), versionQuery(c)))));
designRoutes.patch("/forms/:id", async (c) => c.json(ok(await forms.updateForm(await svc(c), formId(c), parse(forms.formPatch, await jsonBody(c))))));
designRoutes.post("/forms/:id/versions", async (c) => c.json(created(await forms.createFormVersion(await svc(c), formId(c))), 201));
designRoutes.post("/forms/:id/publish", async (c) => c.json(ok(await forms.publishFormVersion(await svc(c), formId(c)))));
designRoutes.post("/forms/:id/test-fill", async (c) => {
  const input = parse(z.object({ version: z.number().int().min(1).optional(), seed: z.number().int().optional() }).strict(), await jsonBody(c));
  return c.json(ok(await forms.testFillForm(await svc(c), formId(c), input)));
});

// ---- eligibility ----
designRoutes.post("/eligibility/evaluate", async (c) => {
  const input = parse(eligibility.evaluateInput, await jsonBody(c));
  return c.json(ok(await eligibility.evaluateEligibility(await svc(c), input, input.opportunityId ? uuidOf("opportunity", input.opportunityId, "Opportunity") : undefined)));
});
