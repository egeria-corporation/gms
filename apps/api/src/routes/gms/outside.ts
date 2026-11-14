// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for apply anywhere (v1.5.0): outside applications, their questions and answers, the
// pipeline, funder records, the calendar feed (and its public .ics), CSV import and export, and
// consulting requests. All applicant-workspace scoped, like /gms/my/*. Each handler parses input,
// builds the ServiceContext and calls one service function.
import type { KvPort } from "@gms/mcp";
import { MemoryKv } from "@gms/mcp";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ApiError, badRequest, created, notFound, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as calendar from "../../services/calendar.ts";
import * as consulting from "../../services/consulting.ts";
import * as drafting from "../../services/drafting.ts";
import * as records from "../../services/funder-records.ts";
import * as outside from "../../services/outside.ts";
import { pipeline } from "../../services/pipeline.ts";
import { jsonBody, publicCtx, svc } from "../http.ts";

type C = Context<AppEnv>;
export const outsideRoutes = new Hono<AppEnv>();

const oaId = (c: C) => bareUuid(c.req.param("id"), "Outside application");
const qId = (c: C) => bareUuid(c.req.param("qid"), "Question");
const file = (out: { body: string | Uint8Array; contentType: string; filename: string }) =>
  new Response(out.body as BodyInit, { status: 200, headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename.replace(/["\\\r\n]/g, "")}"`, "Cache-Control": "private, no-store" } });

// ---- the public calendar feed: the link is the key ----
const fallbackKv = new MemoryKv();
/** Fixed window per link (by its hash, never the link itself). A brake on a leaked link, not a quota. */
async function feedAllowed(c: C, token: string): Promise<boolean> {
  const kv: KvPort = c.get("deps").kv?.(c.env) ?? fallbackKv;
  const hash = (await calendar.calendarTokenHash(token)).slice(0, 32);
  const hour = Math.floor(c.get("deps").now().getTime() / 3_600_000);
  const key = `cal:${hash}:${hour}`;
  const used = Number((await kv.get(key)) ?? "0");
  if (used >= calendar.CALENDAR_FEED_LIMIT.perHour) return false;
  await kv.put(key, String(used + 1), { expirationTtl: 7200 });
  return true;
}
outsideRoutes.get("/cal/:file", async (c) => {
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex");
  const name = c.req.param("file");
  if (!calendar.feedFile.safeParse(name).success) throw notFound("Calendar");
  const token = name.slice(0, -".ics".length);
  if (!(await feedAllowed(c, token))) throw new ApiError(429, "rate_limited", "This calendar was asked for too often. Try again later", [], { "Retry-After": "3600" });
  const deps = c.get("deps");
  const body = await calendar.calendarFeed({ repos: deps.repos, now: deps.now, config: publicCtx(c).config }, token);
  return new Response(body, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="grant-deadlines.ics"', "Cache-Control": "private, max-age=900" } });
});

for (const prefix of ["outside-applications", "outside-questions", "pipeline", "funder-records", "calendar-feed"]) {
  outsideRoutes.use(`/${prefix}`, authenticate());
  outsideRoutes.use(`/${prefix}/*`, authenticate());
}

// ---- pipeline ----
outsideRoutes.get("/pipeline", async (c) => c.json(ok(await pipeline(await svc(c)))));

// ---- outside applications (static paths first) ----
outsideRoutes.get("/outside-applications/export.csv", async (c) => file(await outside.exportOutsideList(await svc(c), "csv")));
outsideRoutes.get("/outside-applications/export.json", async (c) => file(await outside.exportOutsideList(await svc(c), "json")));
outsideRoutes.post("/outside-applications/import", async (c) => c.json(ok(await outside.importOutsideCsv(await svc(c), parse(outside.importInput, await jsonBody(c))))));
outsideRoutes.get("/outside-applications", async (c) => c.json(ok(await outside.listOutside(await svc(c), parse(outside.listQuery, { stage: c.req.query("stage"), q: c.req.query("q"), archived: c.req.query("archived") })))));
outsideRoutes.post("/outside-applications", async (c) => {
  const out = await outside.createOutside(await svc(c), parse(outside.createInput, await jsonBody(c)));
  return out.created ? c.json(created(out.application), 201) : c.json(ok(out.application, "Already tracked"), 200);
});
outsideRoutes.get("/outside-applications/:id", async (c) => c.json(ok(await outside.getOutside(await svc(c), oaId(c)))));
outsideRoutes.patch("/outside-applications/:id", async (c) => c.json(ok(await outside.patchOutside(await svc(c), oaId(c), parse(outside.patchInput, await jsonBody(c))))));
outsideRoutes.post("/outside-applications/:id/stage", async (c) => c.json(ok(await outside.setStage(await svc(c), oaId(c), parse(outside.stageInput, await jsonBody(c))))));
outsideRoutes.post("/outside-applications/:id/submit", async (c) => c.json(ok(await outside.recordSubmission(await svc(c), oaId(c), parse(outside.submitInput, await jsonBody(c))))));
outsideRoutes.post("/outside-applications/:id/decision", async (c) => c.json(ok(await outside.recordDecision(await svc(c), oaId(c), parse(outside.decisionInput, await jsonBody(c))))));
outsideRoutes.post("/outside-applications/:id/reopen", async (c) => c.json(ok(await outside.reopen(await svc(c), oaId(c)))));
outsideRoutes.post("/outside-applications/:id/archive", async (c) => c.json(ok(await outside.archive(await svc(c), oaId(c), true))));
outsideRoutes.post("/outside-applications/:id/unarchive", async (c) => c.json(ok(await outside.archive(await svc(c), oaId(c), false))));
outsideRoutes.get("/outside-applications/:id/export", async (c) => {
  const format = c.req.query("format") ?? "txt";
  if (format !== "txt" && format !== "md" && format !== "pdf") throw badRequest("format must be txt, md or pdf", [{ code: "invalid_parameter", field: "format" }]);
  return file(await outside.exportOutside(await svc(c), oaId(c), format));
});
outsideRoutes.get("/outside-applications/:id/snapshot.pdf", async (c) => {
  const f = await outside.outsideDocumentFile(await svc(c), oaId(c), "snapshot");
  return new Response(f.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${f.filename}"`, "Content-Length": String(f.bytes.byteLength), ETag: `"${f.sha256}"`, "X-Content-SHA256": f.sha256, "Cache-Control": "private, no-store" } });
});
outsideRoutes.get("/outside-applications/:id/documents", async (c) => c.json(ok(await outside.listOutsideDocuments(await svc(c), oaId(c)))));
outsideRoutes.post("/outside-applications/:id/documents", async (c) => c.json(created(await outside.attachOutsideDocument(await svc(c), oaId(c), parse(outside.documentInput, await jsonBody(c)))), 201));
outsideRoutes.get("/outside-applications/:id/documents/:docId/file", async (c) => {
  const f = await outside.outsideDocumentFile(await svc(c), oaId(c), bareUuid(c.req.param("docId"), "Document"));
  return new Response(f.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.filename}"`, "Content-Length": String(f.bytes.byteLength), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
});

// ---- questions and answers ----
outsideRoutes.get("/outside-applications/:id/questions", async (c) => c.json(ok(await outside.listQuestions(await svc(c), oaId(c)))));
outsideRoutes.post("/outside-applications/:id/questions", async (c) => c.json(created(await outside.addQuestions(await svc(c), oaId(c), parse(outside.questionsInput, await jsonBody(c)))), 201));
outsideRoutes.post("/outside-applications/:id/questions/parse", async (c) => {
  const input = parse(outside.parseInput, await jsonBody(c));
  if (input.mode === "ai") return c.json(ok(await drafting.parseGuidelinesText(await svc(c), oaId(c), input.text, input.phase ?? "full")));
  return c.json(ok(await outside.parseQuestionText(await svc(c), oaId(c), input)));
});
outsideRoutes.post("/outside-applications/:id/guidelines", async (c) => c.json(ok(await drafting.uploadGuidelines(await svc(c), oaId(c), parse(drafting.guidelinesInput, await jsonBody(c))))));
outsideRoutes.get("/outside-questions/:qid/library", async (c) => c.json(ok(await drafting.librarySuggestions(await svc(c), qId(c)))));
outsideRoutes.post("/outside-questions/:qid/draft", async (c) => {
  parse(drafting.draftInput, await jsonBody(c));
  return c.json(ok(await drafting.draftOutsideAnswer(await svc(c), qId(c))));
});
outsideRoutes.patch("/outside-questions/:qid", async (c) => c.json(ok(await outside.patchQuestion(await svc(c), qId(c), parse(outside.questionPatch, await jsonBody(c))))));
outsideRoutes.delete("/outside-questions/:qid", async (c) => c.json(ok(await outside.deleteQuestion(await svc(c), qId(c)))));
outsideRoutes.put("/outside-questions/:qid/answer", async (c) => c.json(ok(await outside.putAnswer(await svc(c), qId(c), parse(outside.answerInput, await jsonBody(c))))));
outsideRoutes.get("/outside-questions/:qid/answers", async (c) => c.json(ok(await outside.listAnswerVersions(await svc(c), qId(c)))));

// ---- consulting request (human only; no MCP tool) ----
outsideRoutes.post("/outside-applications/:id/consulting-request/preview", async (c) => c.json(ok(await consulting.previewConsultingRequest(await svc(c), oaId(c), parse(consulting.consultingInput, await jsonBody(c))))));
outsideRoutes.post("/outside-applications/:id/consulting-request", async (c) => c.json(ok(await consulting.sendConsultingRequest(await svc(c), oaId(c), parse(consulting.consultingInput, await jsonBody(c))))));

// ---- funder records ----
const recordId = (c: C) => bareUuid(c.req.param("id"), "Funder record");
outsideRoutes.get("/funder-records", async (c) => c.json(ok(await records.listRecords(await svc(c)))));
outsideRoutes.post("/funder-records", async (c) => c.json(created(await records.createRecord(await svc(c), parse(records.recordInput, await jsonBody(c)))), 201));
outsideRoutes.get("/funder-records/:id", async (c) => c.json(ok(await records.getRecord(await svc(c), recordId(c)))));
outsideRoutes.patch("/funder-records/:id", async (c) => c.json(ok(await records.patchRecord(await svc(c), recordId(c), parse(records.recordPatch, await jsonBody(c))))));
outsideRoutes.delete("/funder-records/:id", async (c) => c.json(ok(await records.deleteRecord(await svc(c), recordId(c)))));

// ---- calendar feed (the link is shown once) ----
outsideRoutes.get("/calendar-feed", async (c) => c.json(ok(await calendar.getFeed(await svc(c)))));
outsideRoutes.post("/calendar-feed", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(ok(await calendar.createOrRotateFeed(await svc(c))));
});
outsideRoutes.delete("/calendar-feed", async (c) => c.json(ok(await calendar.deleteFeed(await svc(c)))));
