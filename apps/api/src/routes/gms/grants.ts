// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes from review to award (build spec §9.2): review assignments and scores, decisions and
// the allocator, awards and amendments, agreements and click-to-sign, templates and sends.
// Each handler parses input, builds the ServiceContext and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as agreements from "../../services/agreements.ts";
import * as awards from "../../services/awards.ts";
import * as decisions from "../../services/decisions.ts";
import * as reviews from "../../services/reviews.ts";
import * as templates from "../../services/templates.ts";
import { jsonBody, page, svc } from "../http.ts";

export const grantRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;
const q = (c: C, k: string) => c.req.query(k) || undefined;
const awardId = (c: C) => uuidOf("award", c.req.param("id"), "Award");
const agreementId = (c: C) => uuidOf("agreement", c.req.param("id"), "Agreement");
const competitionId = (v: string | undefined) => uuidOf("competition", v, "Competition");
const applicationId = (v: string | undefined) => uuidOf("application", v, "Application");
/** The network address a signature records. Cloudflare sets CF-Connecting-IP; the fallback is for local runs. */
const clientIp = (c: C) => c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
const pdf = (file: { bytes: Uint8Array; sha256: string; filename: string }) =>
  new Response(file.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.filename}"`, "Content-Length": String(file.bytes.byteLength), ETag: `"${file.sha256}"`, "X-Content-SHA256": file.sha256, "Cache-Control": "private, no-store" } });

for (const prefix of ["review-assignments", "reviews", "decisions", "awards", "agreements", "amendments", "templates", "communications"]) {
  grantRoutes.use(`/${prefix}`, authenticate());
  grantRoutes.use(`/${prefix}/*`, authenticate());
}

// ---- reviews ----
grantRoutes.get("/review-assignments", async (c) => {
  const competition = q(c, "competitionId");
  const application = q(c, "applicationId");
  const reviewer = q(c, "reviewerUserId");
  return c.json(ok(await reviews.listAssignments(await svc(c), { ...(competition ? { competitionId: competitionId(competition) } : {}), ...(application ? { applicationId: applicationId(application) } : {}), ...(reviewer ? { reviewerUserId: bareUuid(reviewer, "Reviewer") } : {}), stage: q(c, "stage"), status: q(c, "status") })));
});
grantRoutes.post("/review-assignments", async (c) => {
  const { applicationId: app, ...input } = parse(reviews.assignInput, await jsonBody(c));
  return c.json(created(await reviews.createAssignment(await svc(c), applicationId(app), input)), 201);
});
grantRoutes.post("/review-assignments/auto", async (c) => {
  const { competitionId: comp, ...input } = parse(reviews.autoAssignInput, await jsonBody(c));
  return c.json(ok(await reviews.autoAssignReviewers(await svc(c), competitionId(comp), input)));
});
grantRoutes.post("/review-assignments/invite", async (c) => {
  const { competitionId: comp, ...input } = parse(reviews.inviteReviewerInput, await jsonBody(c));
  return c.json(created(await reviews.inviteExternalReviewer(await svc(c), competitionId(comp), input)), 201);
});
grantRoutes.get("/review-assignments/:assignmentId", async (c) => c.json(ok(await reviews.getAssignment(await svc(c), bareUuid(c.req.param("assignmentId"), "Review assignment")))));
grantRoutes.patch("/review-assignments/:assignmentId", async (c) => c.json(ok(await reviews.updateAssignment(await svc(c), bareUuid(c.req.param("assignmentId"), "Review assignment"), parse(reviews.assignmentPatch, await jsonBody(c))))));
grantRoutes.get("/reviews", async (c) => c.json(ok(await reviews.listReviews(await svc(c), applicationId(q(c, "applicationId")), q(c, "stage")))));
grantRoutes.get("/competitions/:id/ranking", async (c) => c.json(ok(await reviews.getRanking(await svc(c), competitionId(c.req.param("id")), q(c, "stage")))));

// ---- decisions ----
grantRoutes.get("/competitions/:id/allocation", async (c) => c.json(ok(await decisions.getAllocation(await svc(c), competitionId(c.req.param("id"))))));
grantRoutes.get("/decisions", async (c) => {
  const competition = q(c, "competitionId");
  const application = q(c, "applicationId");
  const committed = q(c, "committed");
  return c.json(ok(await decisions.listDecisions(await svc(c), { ...(competition ? { competitionId: competitionId(competition) } : {}), ...(application ? { applicationId: applicationId(application) } : {}), ...(committed ? { committed: committed === "true" } : {}) })));
});
grantRoutes.post("/decisions/propose", async (c) => {
  const input = parse(decisions.proposeInput, await jsonBody(c));
  return c.json(ok(await decisions.proposeDecisions(await svc(c), competitionId(input.competitionId), input.decisions.map(({ applicationId: app, ...d }) => ({ ...d, applicationUuid: applicationId(app) })))));
});
grantRoutes.post("/decisions/commit", async (c) => {
  const input = parse(decisions.commitInput, await jsonBody(c));
  return c.json(ok(await decisions.commitDecisions(await svc(c), competitionId(input.competitionId), { decisionIds: input.decisionIds, ...(input.override ? { override: input.override } : {}) })));
});

// ---- awards ----
const awardFilter = (c: C) => {
  const recipient = q(c, "recipientWorkspaceId");
  const program = q(c, "programId");
  return { status: q(c, "status"), ...(program ? { programId: bareUuid(program, "Program") } : {}), ...(recipient ? { recipientWorkspaceId: bareUuid(recipient, "Workspace") } : {}) };
};
grantRoutes.get("/awards", async (c) => {
  const p = page(c);
  const { items, total } = await awards.listAwards(await svc(c), p, awardFilter(c));
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
grantRoutes.post("/awards", async (c) => {
  const { applicationId: app, ...input } = parse(decisions.awardFromApplicationInput, await jsonBody(c));
  return c.json(created(await decisions.createAwardFromApplication(await svc(c), applicationId(app), input)), 201);
});
grantRoutes.get("/awards/:id", async (c) => c.json(ok(await awards.getAward(await svc(c), awardId(c), "funder"))));
grantRoutes.get("/awards/:id/letter.pdf", async (c) => pdf(await agreements.awardLetterPdf(await svc(c), awardId(c))));
grantRoutes.post("/awards/:id/accept-offer", async (c) => c.json(ok(await awards.acceptOffer(await svc(c), awardId(c)))));
grantRoutes.post("/awards/:id/activate", async (c) => c.json(ok(await awards.activateAward(await svc(c), awardId(c)))));
grantRoutes.post("/awards/:id/suspend", async (c) => c.json(ok(await awards.suspendAward(await svc(c), awardId(c), parse(awards.reasonInput, await jsonBody(c))))));
grantRoutes.post("/awards/:id/resume", async (c) => c.json(ok(await awards.resumeAward(await svc(c), awardId(c)))));
grantRoutes.post("/awards/:id/complete", async (c) => c.json(ok(await awards.completeAward(await svc(c), awardId(c)))));
grantRoutes.post("/awards/:id/cancel", async (c) => c.json(ok(await awards.cancelAward(await svc(c), awardId(c), parse(awards.reasonInput, await jsonBody(c))))));
grantRoutes.get("/awards/:id/amendments", async (c) => c.json(ok(await awards.listAmendments(await svc(c), awardId(c)))));
grantRoutes.post("/awards/:id/amendments", async (c) => c.json(created(await awards.requestAmendment(await svc(c), awardId(c), parse(awards.amendmentInput, await jsonBody(c)))), 201));
grantRoutes.patch("/amendments/:amendmentId", async (c) => c.json(ok(await awards.decideAmendment(await svc(c), bareUuid(c.req.param("amendmentId"), "Amendment"), parse(awards.amendmentDecision, await jsonBody(c))))));

// ---- the recipient's awards (`/my` is authenticated by the applicant routes) ----
grantRoutes.get("/my/awards", async (c) => {
  const p = page(c);
  const { items, total } = await awards.listMyAwards(await svc(c), p, { status: q(c, "status") });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
grantRoutes.get("/my/awards/:id", async (c) => c.json(ok(await awards.getMyAward(await svc(c), awardId(c)))));
grantRoutes.get("/my/awards/:id/schedule", async (c) => c.json(ok((await awards.getAward(await svc(c), awardId(c), "recipient")).tranches)));
// Where Passport would pay this grant: bank name and last four digits, read live, never stored.
grantRoutes.get("/my/awards/:id/payout-destination", async (c) => c.json(ok(await awards.getMyPayoutDestinationForAward(await svc(c), awardId(c)))));
grantRoutes.post("/my/awards/:id/accept", async (c) => c.json(ok(await awards.acceptOffer(await svc(c), awardId(c)))));
grantRoutes.post("/my/awards/:id/amendments", async (c) => c.json(created(await awards.requestAmendment(await svc(c), awardId(c), parse(awards.amendmentInput, await jsonBody(c)))), 201));

// ---- agreements ----
grantRoutes.post("/awards/:id/agreements", async (c) => c.json(created(await agreements.createAgreement(await svc(c), awardId(c), parse(agreements.createAgreementInput, await jsonBody(c)))), 201));
grantRoutes.get("/agreements/:id", async (c) => c.json(ok(await agreements.getAgreement(await svc(c), agreementId(c)))));
grantRoutes.get("/agreements/:id/pdf", async (c) => pdf(await agreements.agreementPdf(await svc(c), agreementId(c))));
grantRoutes.post("/agreements/:id/send", async (c) => c.json(ok(await agreements.sendAgreement(await svc(c), agreementId(c), parse(agreements.sendAgreementInput, await jsonBody(c))))));
grantRoutes.post("/agreements/:id/sign", async (c) => c.json(ok(await agreements.signAgreement(await svc(c), agreementId(c), parse(agreements.signInput, await jsonBody(c)), clientIp(c)))));
grantRoutes.post("/agreements/:id/countersign", async (c) => c.json(ok(await agreements.countersignAgreement(await svc(c), agreementId(c), parse(agreements.signInput, await jsonBody(c)), clientIp(c)))));
grantRoutes.post("/agreements/:id/void", async (c) => c.json(ok(await agreements.voidAgreement(await svc(c), agreementId(c), parse(agreements.voidInput, await jsonBody(c))))));

// ---- templates and sends ----
grantRoutes.get("/templates", async (c) => c.json(ok(await templates.listTemplates(await svc(c), { kind: q(c, "kind") }))));
grantRoutes.post("/templates", async (c) => c.json(created(await templates.createTemplate(await svc(c), parse(templates.templateInput, await jsonBody(c)))), 201));
grantRoutes.get("/templates/:templateId", async (c) => c.json(ok(await templates.getTemplate(await svc(c), c.req.param("templateId")))));
grantRoutes.post("/templates/:templateId/render", async (c) => {
  const input = parse(templates.renderInput, await jsonBody(c));
  return c.json(ok(await templates.renderTemplate(await svc(c), c.req.param("templateId"), { fields: input.fields, ...(input.applicationId ? { applicationUuid: applicationId(input.applicationId) } : {}), ...(input.awardId ? { awardUuid: uuidOf("award", input.awardId, "Award") } : {}) })));
});
grantRoutes.get("/communications", async (c) => {
  const p = page(c);
  const { items, total } = await templates.listCommunications(await svc(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
grantRoutes.post("/communications/send", async (c) => {
  const input = parse(templates.sendInput, await jsonBody(c));
  const recipients = input.recipients.map((r) => ({ ...(r.applicationId ? { applicationUuid: applicationId(r.applicationId) } : {}), ...(r.awardId ? { awardUuid: uuidOf("award", r.awardId, "Award") } : {}), ...(r.applicantWorkspaceId ? { applicantWorkspaceId: r.applicantWorkspaceId } : {}) }));
  return c.json(ok(await templates.sendCommunication(await svc(c), input, recipients)));
});
