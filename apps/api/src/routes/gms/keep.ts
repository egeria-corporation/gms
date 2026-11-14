// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for write faster (v1.6.0) and win and keep it (v1.7.0) beyond the outside
// application's own routes: the document vault, an application's required documents, go/no-go,
// comments and milestones, outside awards and their obligations, the next cycle and the funding
// summary. All applicant-workspace scoped. Each handler parses input, builds the ServiceContext
// and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { badRequest, created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as summary from "../../services/funding-summary.ts";
import * as obligations from "../../services/obligations.ts";
import * as outside from "../../services/outside.ts";
import * as team from "../../services/team.ts";
import * as vault from "../../services/vault.ts";
import { jsonBody, svc } from "../http.ts";

type C = Context<AppEnv>;
export const keepRoutes = new Hono<AppEnv>();

for (const prefix of ["vault", "outside-applications", "outside-questions", "outside-obligations", "outside-obligation-series", "outside-awards", "funding-summary", "pipeline"]) {
  keepRoutes.use(`/${prefix}`, authenticate());
  keepRoutes.use(`/${prefix}/*`, authenticate());
}

const oaId = (c: C) => bareUuid(c.req.param("id"), "Outside application");

// ---- the document vault ----
const docId = (c: C) => bareUuid(c.req.param("docId"), "Document");
keepRoutes.get("/vault", async (c) => c.json(ok(await vault.listVault(await svc(c), parse(vault.vaultListQuery, { docType: c.req.query("docType") })))));
keepRoutes.post("/vault", async (c) => c.json(created(await vault.uploadVault(await svc(c), parse(vault.vaultUploadInput, await jsonBody(c)))), 201));
keepRoutes.patch("/vault/:docId", async (c) => c.json(ok(await vault.patchVault(await svc(c), docId(c), parse(vault.vaultPatch, await jsonBody(c))))));
keepRoutes.delete("/vault/:docId", async (c) => c.json(ok(await vault.deleteVault(await svc(c), docId(c)))));
keepRoutes.get("/vault/:docId/file", async (c) => {
  const f = await vault.vaultFile(await svc(c), docId(c));
  return new Response(f.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.filename}"`, "Content-Length": String(f.bytes.byteLength), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
});

// ---- required documents of an outside application ----
keepRoutes.put("/outside-applications/:id/required-documents", async (c) => c.json(ok(await vault.setRequiredDocuments(await svc(c), oaId(c), parse(vault.requiredDocumentsInput, await jsonBody(c))))));
keepRoutes.post("/outside-applications/:id/required-documents/use-from-vault", async (c) => c.json(ok(await vault.useFromVault(await svc(c), oaId(c), parse(vault.useFromVaultInput, await jsonBody(c))))));

// ---- go/no-go, comments per question, milestones, the calendar ----
const qId = (c: C) => bareUuid(c.req.param("qid"), "Question");
keepRoutes.post("/outside-applications/:id/go-no-go", async (c) => c.json(ok(await team.decideGoNoGo(await svc(c), oaId(c), parse(team.goNoGoInput, await jsonBody(c))))));
keepRoutes.get("/outside-applications/:id/comments", async (c) => c.json(ok(await team.listQuestionComments(await svc(c), oaId(c), parse(team.commentsQuery, { questionId: c.req.query("questionId") })))));
keepRoutes.post("/outside-questions/:qid/comments", async (c) => c.json(created(await team.addQuestionComment(await svc(c), qId(c), parse(team.commentInput, await jsonBody(c)))), 201));
keepRoutes.post("/outside-applications/:id/comments/:commentId/resolve", async (c) => c.json(ok(await team.resolveQuestionComment(await svc(c), oaId(c), bareUuid(c.req.param("commentId"), "Comment")))));
keepRoutes.get("/outside-applications/:id/milestones", async (c) => c.json(ok(await team.milestoneOffer(await svc(c), oaId(c)))));
keepRoutes.post("/outside-applications/:id/milestones", async (c) => c.json(created(await team.createMilestones(await svc(c), oaId(c), parse(team.milestonesInput, await jsonBody(c)))), 201));
keepRoutes.get("/pipeline/calendar", async (c) => c.json(ok(await team.pipelineCalendar(await svc(c), parse(team.calendarQuery, { month: c.req.query("month") })))));

// ---- outside awards: obligations, series, reports, payments received, closeout ----
const obId = (c: C) => bareUuid(c.req.param("oid"), "Obligation");
keepRoutes.get("/outside-applications/:id/obligations", async (c) => c.json(ok(await obligations.listObligations(await svc(c), oaId(c)))));
keepRoutes.post("/outside-applications/:id/obligations", async (c) => c.json(created(await obligations.createObligation(await svc(c), oaId(c), parse(obligations.obligationInput, await jsonBody(c)))), 201));
keepRoutes.post("/outside-applications/:id/close-out", async (c) => c.json(ok(await obligations.closeOut(await svc(c), oaId(c)))));
keepRoutes.get("/outside-awards/:id", async (c) => c.json(ok(await obligations.getOutsideAward(await svc(c), oaId(c)))));
keepRoutes.patch("/outside-obligations/:oid", async (c) => c.json(ok(await obligations.patchObligation(await svc(c), obId(c), parse(obligations.obligationPatch, await jsonBody(c))))));
keepRoutes.delete("/outside-obligations/:oid", async (c) => c.json(ok(await obligations.deleteObligation(await svc(c), obId(c)))));
keepRoutes.post("/outside-obligations/:oid/status", async (c) => c.json(ok(await obligations.setObligationStatus(await svc(c), obId(c), parse(obligations.statusInput, await jsonBody(c))))));
keepRoutes.post("/outside-obligations/:oid/submit", async (c) => c.json(ok(await obligations.submitReport(await svc(c), obId(c), parse(obligations.reportSubmitInput, await jsonBody(c))))));
keepRoutes.get("/outside-obligations/:oid/questions", async (c) => c.json(ok(await obligations.listReportQuestions(await svc(c), obId(c)))));
keepRoutes.post("/outside-obligations/:oid/questions", async (c) => c.json(created(await obligations.addReportQuestions(await svc(c), obId(c), parse(outside.questionsInput, await jsonBody(c)))), 201));
keepRoutes.get("/outside-obligations/:oid/reuse", async (c) => c.json(ok(await obligations.reuseCandidates(await svc(c), obId(c), parse(obligations.reuseQuery, { questionId: c.req.query("questionId"), q: c.req.query("q") })))));
const seriesId = (c: C) => bareUuid(c.req.param("sid"), "Series");
keepRoutes.patch("/outside-obligation-series/:sid", async (c) => c.json(ok(await obligations.updateSeries(await svc(c), seriesId(c), parse(obligations.seriesPatch, await jsonBody(c))))));
keepRoutes.delete("/outside-obligation-series/:sid", async (c) => c.json(ok(await obligations.deleteSeries(await svc(c), seriesId(c)))));
keepRoutes.get("/my/awarded-funding", async (c) => c.json(ok(await obligations.awardedFunding(await svc(c)))));

// ---- the next cycle ----
keepRoutes.post("/outside-applications/:id/next-cycle-alert", async (c) => {
  const out = await team.nextCycleAlert(await svc(c), oaId(c));
  return c.json(out.created ? created(out.alert) : ok(out.alert, "Already set"), out.created ? 201 : 200);
});

// ---- the funding summary ----
keepRoutes.get("/funding-summary", async (c) => c.json(ok(await summary.fundingSummary(await svc(c)))));
keepRoutes.get("/funding-summary/export", async (c) => {
  const format = c.req.query("format") ?? "csv";
  if (format !== "csv" && format !== "pdf") throw badRequest("format must be csv or pdf", [{ code: "invalid_parameter", field: "format" }]);
  const out = await summary.exportFundingSummary(await svc(c), format);
  return new Response(out.body as BodyInit, { status: 200, headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "private, no-store" } });
});
