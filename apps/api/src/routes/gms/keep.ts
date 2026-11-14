// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for write faster (v1.6.0) and win and keep it (v1.7.0) beyond the outside
// application's own routes: the document vault, an application's required documents, go/no-go,
// comments and milestones, outside awards and their obligations, the next cycle and the funding
// summary. All applicant-workspace scoped. Each handler parses input, builds the ServiceContext
// and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as team from "../../services/team.ts";
import * as vault from "../../services/vault.ts";
import { jsonBody, svc } from "../http.ts";

type C = Context<AppEnv>;
export const keepRoutes = new Hono<AppEnv>();

for (const prefix of ["vault", "outside-applications", "outside-questions", "outside-obligations", "outside-awards", "funding-summary", "pipeline"]) {
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
