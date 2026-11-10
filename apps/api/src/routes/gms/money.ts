// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for money and reporting (build spec §9.2): payment schedules, tranches and the
// Payments center, requirements and submissions, budgets, and the grantee directory.
// Each handler parses input, builds the ServiceContext and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as budgets from "../../services/budgets.ts";
import * as grantees from "../../services/grantees.ts";
import * as payments from "../../services/payments.ts";
import * as requirements from "../../services/requirements.ts";
import { jsonBody, page, svc } from "../http.ts";

export const moneyRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;
const q = (c: C, k: string) => c.req.query(k) || undefined;
const awardId = (c: C) => uuidOf("award", c.req.param("id"), "Award");
const trancheId = (c: C) => uuidOf("tranche", c.req.param("id"), "Tranche");
const requirementId = (c: C) => uuidOf("requirement", c.req.param("id"), "Requirement");
const submissionId = (c: C) => uuidOf("submission", c.req.param("id"), "Submission");
const list = async <T>(c: C, run: (p: ReturnType<typeof page>) => Promise<{ items: T[]; total: number }>) => {
  const p = page(c);
  const { items, total } = await run(p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
};

for (const prefix of ["tranches", "payments", "bank-transactions", "requirements", "submissions", "grantees", "org-changes"]) {
  moneyRoutes.use(`/${prefix}`, authenticate());
  moneyRoutes.use(`/${prefix}/*`, authenticate());
}

// ---- schedules and tranches (`/awards` is authenticated by the grant routes) ----
moneyRoutes.get("/awards/:id/schedule", async (c) => c.json(ok(await payments.getSchedule(await svc(c), awardId(c)))));
moneyRoutes.put("/awards/:id/schedule", async (c) => c.json(ok(await payments.putSchedule(await svc(c), awardId(c), parse(payments.scheduleInput, await jsonBody(c))))));
moneyRoutes.get("/tranches", async (c) => {
  const award = q(c, "awardId");
  return list(c, async (p) => payments.listTranches(await svc(c), p, { status: q(c, "status"), view: q(c, "view"), ...(award ? { awardId: uuidOf("award", award, "Award") } : {}) }));
});
moneyRoutes.get("/tranches/:id/readiness", async (c) => c.json(ok(await payments.getTrancheReadiness(await svc(c), trancheId(c)))));
moneyRoutes.post("/tranches/:id/release", async (c) => c.json(ok(await payments.releaseTranche(await svc(c), trancheId(c), parse(payments.releaseInput, await jsonBody(c))))));
moneyRoutes.post("/tranches/:id/reconcile", async (c) => c.json(ok(await payments.reconcileTranche(await svc(c), trancheId(c)))));
moneyRoutes.post("/tranches/:id/record-external", async (c) => c.json(ok(await payments.recordExternalPayment(await svc(c), trancheId(c), parse(payments.externalInput, await jsonBody(c))))));
moneyRoutes.post("/tranches/:id/hold", async (c) => c.json(ok(await payments.holdTranche(await svc(c), trancheId(c), parse(payments.holdInput, await jsonBody(c))))));
moneyRoutes.post("/tranches/:id/release-hold", async (c) => c.json(ok(await payments.unholdTranche(await svc(c), trancheId(c)))));
moneyRoutes.post("/tranches/:id/cancel", async (c) => c.json(ok(await payments.cancelTranche(await svc(c), trancheId(c), parse(payments.holdInput, await jsonBody(c))))));

// ---- payments center ----
moneyRoutes.get("/payments/readiness", async (c) => c.json(ok(await payments.paymentsReadiness(await svc(c)))));
moneyRoutes.get("/payments/alerts", async (c) => c.json(ok(await payments.paymentAlerts(await svc(c)))));
moneyRoutes.get("/bank-transactions", async (c) => {
  const matched = q(c, "matched");
  return list(c, async (p) => payments.listBankTransactions(await svc(c), p, matched === undefined ? {} : { matched: matched === "true" }));
});
moneyRoutes.post("/bank-transactions/:txnId/match", async (c) => {
  const input = parse(payments.matchInput, await jsonBody(c));
  return c.json(ok(await payments.matchBankTransaction(await svc(c), bareUuid(c.req.param("txnId"), "Bank transaction"), uuidOf("tranche", input.trancheId, "Tranche"), input.destinationLast4)));
});

// ---- requirements and submissions ----
moneyRoutes.get("/awards/:id/requirements", async (c) => c.json(ok(await requirements.listRequirements(await svc(c), awardId(c)))));
moneyRoutes.post("/awards/:id/requirements", async (c) => c.json(created(await requirements.createRequirement(await svc(c), awardId(c), parse(requirements.requirementInput, await jsonBody(c)))), 201));
moneyRoutes.get("/requirements/due", async (c) => list(c, async (p) => requirements.listDueRequirements(await svc(c), p, { status: q(c, "status") })));
moneyRoutes.patch("/requirements/:id", async (c) => c.json(ok(await requirements.updateRequirement(await svc(c), requirementId(c), parse(requirements.requirementPatch, await jsonBody(c))))));
moneyRoutes.post("/requirements/:id/waive", async (c) => c.json(ok(await requirements.waiveRequirement(await svc(c), requirementId(c), parse(requirements.waiveInput, await jsonBody(c))))));
moneyRoutes.post("/requirements/:id/remind", async (c) => c.json(ok(await requirements.remindNow(await svc(c), requirementId(c)))));
moneyRoutes.get("/submissions", async (c) => {
  const shared = q(c, "shared");
  return list(c, async (p) => requirements.listReceivedSubmissions(await svc(c), p, { status: q(c, "status"), ...(shared === undefined ? {} : { shared: shared === "true" }) }));
});
moneyRoutes.get("/submissions/:id", async (c) => c.json(ok(await requirements.getSubmission(await svc(c), submissionId(c)))));
moneyRoutes.post("/submissions/:id/accept", async (c) => c.json(ok(await requirements.acceptSubmission(await svc(c), submissionId(c), parse(requirements.reviewInput, await jsonBody(c))))));
moneyRoutes.post("/submissions/:id/return", async (c) => c.json(ok(await requirements.returnSubmission(await svc(c), submissionId(c), parse(requirements.returnInput, await jsonBody(c))))));

// ---- the grantee's reports (`/my` is authenticated by the applicant routes) ----
moneyRoutes.get("/my/requirements", async (c) => c.json(ok(await requirements.listMyRequirements(await svc(c)))));
moneyRoutes.post("/my/requirements/:id/start", async (c) => c.json(ok(await requirements.startSubmission(await svc(c), requirementId(c)))));
moneyRoutes.get("/my/submissions/:id", async (c) => c.json(ok(await requirements.getSubmission(await svc(c), submissionId(c)))));
moneyRoutes.put("/my/submissions/:id/forms/:formId", async (c) => c.json(ok(await requirements.putSubmissionForm(await svc(c), submissionId(c), uuidOf("form", c.req.param("formId"), "Form"), parse(requirements.submissionFormInput, await jsonBody(c))))));
moneyRoutes.post("/my/submissions/:id/submit", async (c) => c.json(ok(await requirements.submitSubmission(await svc(c), submissionId(c)))));
moneyRoutes.post("/my/submissions/:id/share", async (c) => c.json(created(await requirements.shareSubmission(await svc(c), submissionId(c), parse(requirements.shareInput, await jsonBody(c)))), 201));

// ---- budgets ----
moneyRoutes.get("/awards/:id/budget", async (c) => c.json(ok(await budgets.getBudget(await svc(c), awardId(c)))));
moneyRoutes.put("/awards/:id/budget", async (c) => c.json(ok(await budgets.putBudget(await svc(c), awardId(c), parse(budgets.budgetInput, await jsonBody(c))))));
moneyRoutes.get("/awards/:id/variance", async (c) => c.json(ok(await budgets.getVariance(await svc(c), awardId(c)))));
moneyRoutes.get("/my/awards/:id/budget", async (c) => c.json(ok(await budgets.getBudget(await svc(c), awardId(c)))));
moneyRoutes.put("/my/awards/:id/budget", async (c) => c.json(ok(await budgets.putBudget(await svc(c), awardId(c), parse(budgets.budgetInput, await jsonBody(c))))));

// ---- grantee directory and organization changes ----
const grantee = (c: C) => bareUuid(c.req.param("workspaceId"), "Grantee");
moneyRoutes.get("/grantees", async (c) => list(c, async (p) => grantees.listGrantees(await svc(c), p, { q: q(c, "q"), tag: q(c, "tag") })));
moneyRoutes.get("/grantees/:workspaceId", async (c) => c.json(ok(await grantees.getGrantee(await svc(c), grantee(c)))));
moneyRoutes.patch("/grantees/:workspaceId", async (c) => c.json(ok(await grantees.updateGrantee(await svc(c), grantee(c), parse(grantees.granteePatch, await jsonBody(c))))));
moneyRoutes.post("/grantees/:workspaceId/propose-change", async (c) => c.json(ok(await grantees.proposeOrgChange(await svc(c), grantee(c), parse(grantees.proposeChangeInput, await jsonBody(c))), "Proposed"), 202));
moneyRoutes.get("/org-changes", async (c) => list(c, async (p) => grantees.listOrgChanges(await svc(c), p, { status: q(c, "status") })));
moneyRoutes.post("/org-changes/:changeId/accept", async (c) => c.json(ok(await grantees.acceptOrgChange(await svc(c), bareUuid(c.req.param("changeId"), "Organization change")))));
moneyRoutes.post("/org-changes/:changeId/dismiss", async (c) => c.json(ok(await grantees.dismissOrgChange(await svc(c), bareUuid(c.req.param("changeId"), "Organization change")))));
