// SPDX-License-Identifier: AGPL-3.0-only
// Read models and small actions the workspace screens need beyond the core records: rollups,
// panel detail, award activity and closeout, upcoming payments, breakdowns, who-has-access, a
// grant's documents and messages, interviews and funding alerts. Mounted before the other /gms
// routers; every route authenticates itself and calls one service function.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as mine from "../../services/applicant-insights.ts";
import * as insights from "../../services/insights.ts";
import { jsonBody, page, svc } from "../http.ts";

export const insightRoutes = new Hono<AppEnv>();
const auth = authenticate();

type P = { req: { param(name: string): string | undefined } };
const app = (c: P) => uuidOf("application", c.req.param("id"), "Application");
const award = (c: P) => uuidOf("award", c.req.param("id"), "Award");
const competition = (c: P) => uuidOf("competition", c.req.param("id"), "Competition");

// ---- funder: applications ----
insightRoutes.get("/applications/:id/budget", auth, async (c) => c.json(ok(await insights.applicationBudgetAndDocuments(await svc(c), app(c)))));
insightRoutes.get("/applications/:id/documents", auth, async (c) => c.json(ok((await insights.applicationBudgetAndDocuments(await svc(c), app(c))).documents)));
insightRoutes.get("/applications/:id/follow-ups", auth, async (c) => c.json(ok(await insights.applicationFollowUps(await svc(c), app(c)))));
insightRoutes.post("/applications/:id/interview", auth, async (c) => c.json(created(await insights.proposeInterview(await svc(c), app(c), parse(insights.interviewInput, await jsonBody(c)))), 201));

// ---- funder: programs, competitions, panel ----
insightRoutes.get("/programs/:id/rollup", auth, async (c) => c.json(ok(await insights.programRollup(await svc(c), bareUuid(c.req.param("id"), "Program")))));
insightRoutes.get("/competitions/:id/reviewers", auth, async (c) => c.json(ok(await insights.competitionReviewers(await svc(c), competition(c)))));
insightRoutes.get("/competitions/:id/panel-summary", auth, async (c) => c.json(ok(await insights.panelSummary(await svc(c), competition(c), c.req.query("stage")))));
insightRoutes.get("/competitions/:id/notes", auth, async (c) => c.json(ok(await insights.listPanelNotes(await svc(c), competition(c)))));
insightRoutes.post("/competitions/:id/notes", auth, async (c) => c.json(created(await insights.addPanelNote(await svc(c), competition(c), parse(insights.noteInput, await jsonBody(c)))), 201));

// ---- funder: awards ----
insightRoutes.get("/awards/:id/activity", auth, async (c) => c.json(ok(await insights.awardActivity(await svc(c), award(c)))));
insightRoutes.get("/awards/:id/signatures", auth, async (c) => c.json(ok(await insights.awardSignatures(await svc(c), award(c)))));
insightRoutes.get("/awards/:id/closeout", auth, async (c) => c.json(ok(await insights.awardCloseout(await svc(c), award(c)))));
insightRoutes.get("/awards/:id/closeout.pdf", auth, async (c) => {
  const file = await insights.awardCloseoutPdf(await svc(c), award(c));
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.filename}"`, "Content-Length": String(file.bytes.byteLength), ETag: `"${file.sha256}"` } });
});
// Either party to the award.
insightRoutes.get("/awards/:id/documents", auth, async (c) => c.json(ok(await mine.awardDocuments(await svc(c), award(c)))));
insightRoutes.get("/awards/:id/messages", auth, async (c) => c.json(ok(await mine.listAwardMessages(await svc(c), award(c)))));
insightRoutes.post("/awards/:id/messages", auth, async (c) => c.json(created(await mine.postAwardMessage(await svc(c), award(c), parse(mine.awardMessageInput, await jsonBody(c)))), 201));

// ---- funder: payments, grantees, analytics, communications, dashboard ----
insightRoutes.get("/payments/upcoming", auth, async (c) => {
  const days = Number(c.req.query("days") ?? 30);
  return c.json(ok(await insights.upcomingPayments(await svc(c), Number.isInteger(days) && days > 0 && days <= 365 ? days : 30)));
});
insightRoutes.get("/payments/ledger", auth, async (c) => {
  const p = page(c);
  const { items, total } = await insights.paymentsLedger(await svc(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
// `:granteeId`, not `:workspaceId`: the bearer check reads a `workspaceId` path parameter as the caller's workspace.
insightRoutes.get("/grantees/:granteeId/reports", auth, async (c) => c.json(ok(await insights.granteeReports(await svc(c), bareUuid(c.req.param("granteeId"), "Grantee")))));
insightRoutes.get("/analytics/breakdowns", auth, async (c) => c.json(ok(await insights.breakdowns(await svc(c)))));
insightRoutes.get("/templates/usage", auth, async (c) => c.json(ok(await insights.templateUsage(await svc(c)))));
insightRoutes.post("/communications/bulk", auth, async (c) => c.json(ok(await insights.bulkSend(await svc(c), parse(insights.bulkSendInput, await jsonBody(c))))));
insightRoutes.get("/activity", auth, async (c) => {
  const limit = Number(c.req.query("limit") ?? 20);
  return c.json(ok(await insights.recentActivity(await svc(c), Number.isInteger(limit) && limit > 0 ? limit : 20)));
});

// ---- applicant ----
insightRoutes.get("/me/access", auth, async (c) => c.json(ok(await mine.whoHasAccess(await svc(c)))));
insightRoutes.get("/my/funders/detail", auth, async (c) => c.json(ok(await mine.myFundersDetail(await svc(c)))));
insightRoutes.get("/my/applications/:id/follow-ups", auth, async (c) => c.json(ok(await insights.applicationFollowUps(await svc(c), app(c)))));
insightRoutes.post("/my/applications/:id/interview/confirm", auth, async (c) => c.json(ok(await insights.confirmInterview(await svc(c), app(c), parse(insights.interviewConfirmInput, await jsonBody(c))))));
insightRoutes.get("/my/awards/:id/documents", auth, async (c) => c.json(ok(await mine.awardDocuments(await svc(c), award(c)))));
insightRoutes.get("/my/awards/:id/messages", auth, async (c) => c.json(ok(await mine.listAwardMessages(await svc(c), award(c)))));
insightRoutes.post("/my/awards/:id/messages", auth, async (c) => c.json(created(await mine.postAwardMessage(await svc(c), award(c), parse(mine.awardMessageInput, await jsonBody(c)))), 201));
insightRoutes.get("/discover/alerts", auth, async (c) => c.json(ok(await mine.listAlerts(await svc(c)))));
insightRoutes.post("/discover/alerts", auth, async (c) => c.json(created(await mine.createAlert(await svc(c), parse(mine.alertInput, await jsonBody(c)))), 201));
insightRoutes.delete("/discover/alerts/:alertId", auth, async (c) => c.json(ok(await mine.deleteAlert(await svc(c), bareUuid(c.req.param("alertId"), "Alert")))));
