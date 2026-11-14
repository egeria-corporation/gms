// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes around applications: the applicant's Passport link and workspace (`/passport`, `/me`,
// `/my`, `/discover`), the funder's inbox (`/applications`), and threads and tasks for both sides.
// Each handler parses input, builds the ServiceContext and calls one service function.
import { MemoryKv, type KvPort } from "@gms/mcp";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate, requireUser } from "../../auth/middleware.ts";
import { created, notFound, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as notifications from "../../services/notifications.ts";
import * as applicant from "../../services/applicant.ts";
import * as collab from "../../services/collaboration.ts";
import * as inbox from "../../services/inbox.ts";
import * as org from "../../services/organization.ts";
import * as passportSignIn from "../../services/passport-signin.ts";
import type { OpenGrantsTool } from "../../services/ports.ts";
import { jsonBody, page, publicCtx, svc, userSvc } from "../http.ts";

export const applicationRoutes = new Hono<AppEnv>();

type P = { req: { param(name: string): string | undefined } };
const appId = (c: P) => uuidOf("application", c.req.param("id"), "Application");

// ---- Passport consent (applicant) ----
applicationRoutes.post("/passport/consent/start", requireUser(), async (c) => c.json(ok(await org.startConsent(userSvc(c), parse(org.consentStartInput, await jsonBody(c))))));
// Passport redirects the browser here: no bearer, so nothing is linked and nothing is redeemed. The
// code goes back to the web app in the fragment, and the person who started the flow finishes it
// with their own session below.
applicationRoutes.get("/passport/consent/callback", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const outcome = await org.completeConsent(publicCtx(c), { code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") });
  return c.redirect(outcome.redirect, 302);
});
applicationRoutes.post("/passport/consent/finish", requireUser(), async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(ok(await org.finishConsent(userSvc(c), parse(org.consentFinishInput, await jsonBody(c)))));
});

// ---- Sign in with Passport (public: the person has no GMS session yet) ----
const SIGNIN_LIMIT = { limit: 30, windowSeconds: 600 };
/** With no network address to count against, one shared counter, sized so it cannot lock everyone out at a person's limit. */
const SIGNIN_LIMIT_SHARED = 600;
const fallbackSignInKv = new MemoryKv();
/**
 * Fixed-window counter per network address and per route, so neither route can be used to hammer
 * Passport and a burst on one does not use up the other. Cloudflare always sets
 * `CF-Connecting-IP`; behind another proxy the first forwarded address is used. KV has no atomic
 * increment, so two requests at once can count as one: the limit is a brake, not a quota.
 */
async function signInAllowed(c: Context<AppEnv>, route: "start" | "callback"): Promise<boolean> {
  const kv: KvPort = c.get("deps").kv?.(c.env) ?? fallbackSignInKv;
  const address = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? c.req.header("X-Real-IP");
  const who = address && /^[0-9A-Fa-f:.]{2,64}$/.test(address) ? address : null;
  const window = Math.floor(c.get("deps").now().getTime() / 1000 / SIGNIN_LIMIT.windowSeconds);
  const key = `passport-signin:${route}:${who ?? "no-address"}:${window}`;
  const used = Number((await kv.get(key)) ?? "0");
  if (used >= (who ? SIGNIN_LIMIT.limit : SIGNIN_LIMIT_SHARED)) return false;
  await kv.put(key, String(used + 1), { expirationTtl: SIGNIN_LIMIT.windowSeconds * 2 });
  return true;
}
const signInCtx = (c: Context<AppEnv>) => {
  const deps = c.get("deps");
  return { ...publicCtx(c), ledger: deps.ledger, webhooks: deps.webhooks, ports: deps.ports?.(c.env) ?? {} };
};
const signInCookie = (value: string, maxAge: number) => `${passportSignIn.SIGNIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const readSignInCookie = (header: string | undefined) =>
  (header ?? "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${passportSignIn.SIGNIN_COOKIE}=`))
    ?.slice(passportSignIn.SIGNIN_COOKIE.length + 1);
const noStore = (c: Context<AppEnv>) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
};

applicationRoutes.get("/passport/signin/start", async (c) => {
  noStore(c);
  const ctx = signInCtx(c);
  if (!(await signInAllowed(c, "start"))) return c.redirect(passportSignIn.signInErrorRedirect(ctx, "unavailable"), 302);
  const start = await passportSignIn.startSignIn(ctx, { returnTo: c.req.query("returnTo"), hop: c.req.query("hop") });
  if (start.ok) c.header("Set-Cookie", signInCookie(start.binding, start.maxAgeSeconds));
  return c.redirect(start.redirect, 302);
});
// Passport redirects the browser here: no bearer. The sealed `state` and the cookie it is bound to carry the flow.
applicationRoutes.get("/passport/signin/callback", async (c) => {
  noStore(c);
  const ctx = signInCtx(c);
  // The binding is single-use: it is cleared whatever the outcome.
  c.header("Set-Cookie", signInCookie("", 0));
  if (!(await signInAllowed(c, "callback"))) return c.redirect(passportSignIn.signInErrorRedirect(ctx, "unavailable"), 302);
  const outcome = await passportSignIn.completeSignIn(ctx, { code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") }, readSignInCookie(c.req.header("Cookie")));
  return c.redirect(outcome.redirect, 302);
});

// The web app, holding the session it just redeemed, presents the same one-time token so that
// Passport's authenticator counts as this session's second step. A wrong or used token is not an
// error: the answer is simply "not verified" and the app asks for its own second step.
applicationRoutes.post("/passport/signin/second-step", requireUser(), async (c) => {
  noStore(c);
  const body = parse(z.object({ tokenHash: z.string().min(1).max(512) }).strict(), await jsonBody(c));
  const user = c.get("user");
  const result = await passportSignIn.claimSecondStep(userSvc(c), { tokenHash: body.tokenHash, sessionId: user.sessionId ?? null });
  return c.json(ok({ verified: result.verified, validUntil: result.validUntil }));
});

for (const prefix of ["me/representatives", "me/organization", "me/documents", "me/readiness", "me/notification-preferences", "notifications", "my", "discover", "applications", "threads", "tasks"]) {
  applicationRoutes.use(`/${prefix}`, authenticate());
  applicationRoutes.use(`/${prefix}/*`, authenticate());
}

// ---- the applicant's organization, as cached from Passport ----
applicationRoutes.get("/me/organization", async (c) => c.json(ok(await org.getMyOrganization(await svc(c)))));
applicationRoutes.get("/me/representatives", async (c) => c.json(ok(await org.getMyRepresentatives(await svc(c)))));
applicationRoutes.post("/me/organization/refresh", async (c) => c.json(ok(await org.refreshMyOrganization(await svc(c)))));
// The Passport locker, as references the editor can attach. Never bytes.
applicationRoutes.get("/me/documents", async (c) => c.json(ok(await org.listMyDocuments(await svc(c)))));
applicationRoutes.get("/me/readiness", async (c) => c.json(ok(await org.getMyReadiness(await svc(c)))));
applicationRoutes.get("/my/consents", async (c) => c.json(ok(await org.listMyConsents(await svc(c)))));
applicationRoutes.delete("/my/consents/:consentId", async (c) => c.json(ok(await org.revokeMyConsent(await svc(c), bareUuid(c.req.param("consentId"), "Consent")))));
applicationRoutes.get("/my/funders", async (c) => c.json(ok(await org.listMyFunders(await svc(c)))));

// ---- notifications (both sides) ----
applicationRoutes.get("/notifications", async (c) => c.json(ok(await notifications.listNotifications(await svc(c), { unread: c.req.query("unread") === "true" }))));
applicationRoutes.post("/notifications/read", async (c) => c.json(ok(await notifications.markRead(await svc(c), parse(notifications.readInput, await jsonBody(c))))));
applicationRoutes.get("/me/notification-preferences", async (c) => c.json(ok(await notifications.getPreferences(await svc(c)))));
applicationRoutes.put("/me/notification-preferences", async (c) => c.json(ok(await notifications.putPreferences(await svc(c), parse(notifications.preferencesInput, await jsonBody(c))))));

// ---- the applicant's applications ----
applicationRoutes.get("/my/applications", async (c) => c.json(ok(await applicant.listMyApplications(await svc(c)))));
applicationRoutes.get("/my/applications/:id/status", async (c) => c.json(ok(await applicant.getMyApplicationStatus(await svc(c), appId(c)))));
applicationRoutes.post("/my/applications/:id/withdraw", async (c) => c.json(ok(await applicant.withdrawApplication(await svc(c), appId(c)))));
applicationRoutes.get("/my/applications/:id/sections", async (c) => c.json(ok(await applicant.listSectionAssignments(await svc(c), appId(c)))));
applicationRoutes.get("/applications/:id/sections", async (c) => c.json(ok(await applicant.listSectionAssignments(await svc(c), appId(c)))));
applicationRoutes.post("/my/applications/:id/forms/:formId/insert-answer", async (c) =>
  c.json(ok(await applicant.insertAnswer(await svc(c), appId(c), uuidOf("form", c.req.param("formId"), "Form"), parse(applicant.insertAnswerInput, await jsonBody(c))))),
);
applicationRoutes.post("/my/applications/:id/sections/assign", async (c) => {
  const input = parse(applicant.sectionAssignInput, await jsonBody(c));
  return c.json(ok(await applicant.assignSection(await svc(c), appId(c), uuidOf("form", input.formId, "Form"), input)));
});
applicationRoutes.get("/my/applications/:id/comments", async (c) => c.json(ok(await applicant.listComments(await svc(c), appId(c)))));
applicationRoutes.post("/my/applications/:id/comments", async (c) => {
  const input = parse(applicant.commentInput, await jsonBody(c));
  return c.json(created(await applicant.addComment(await svc(c), appId(c), input, input.formId ? uuidOf("form", input.formId, "Form") : undefined)), 201);
});
applicationRoutes.post("/my/applications/:id/comments/:commentId/resolve", async (c) => c.json(ok(await applicant.resolveComment(await svc(c), appId(c), bareUuid(c.req.param("commentId"), "Comment")))));
applicationRoutes.get("/my/applications/:id/attachments", async (c) => c.json(ok(await applicant.listAttachments(await svc(c), appId(c)))));
applicationRoutes.post("/my/applications/:id/attachments", async (c) => c.json(created(await applicant.attachDocument(await svc(c), appId(c), parse(applicant.attachmentInput, await jsonBody(c)))), 201));

// ---- answer library ----
applicationRoutes.get("/my/answers", async (c) => c.json(ok(await applicant.listAnswers(await svc(c), parse(applicant.answerListQuery, { tag: c.req.query("tag"), stale: c.req.query("stale") })))));
applicationRoutes.post("/my/answers/:answerId/verify", async (c) => c.json(ok(await applicant.verifyAnswer(await svc(c), bareUuid(c.req.param("answerId"), "Answer")))));
applicationRoutes.post("/my/answers", async (c) => c.json(created(await applicant.createAnswer(await svc(c), parse(applicant.answerInput, await jsonBody(c)))), 201));
applicationRoutes.patch("/my/answers/:answerId", async (c) => c.json(ok(await applicant.updateAnswer(await svc(c), bareUuid(c.req.param("answerId"), "Answer"), parse(applicant.answerPatch, await jsonBody(c))))));

// ---- discovery ----
applicationRoutes.get("/discover/competitions", async (c) => c.json(ok(await applicant.discoverCompetitions(await svc(c)))));
applicationRoutes.get("/discover/saved", async (c) => c.json(ok(await applicant.listSaved(await svc(c)))));
applicationRoutes.post("/discover/saved", async (c) => c.json(created(await applicant.saveListing(await svc(c), parse(applicant.saveListingInput, await jsonBody(c)))), 201));
applicationRoutes.get("/discover/opengrants/:listingId", async (c) => {
  const id = c.req.param("listingId");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || ["search", "match", "eligibility", "alerts"].includes(id)) throw notFound("Listing");
  return c.json(ok(await applicant.openGrantsListing(await svc(c), id)));
});
for (const tool of ["search", "match", "eligibility", "alerts"] as OpenGrantsTool[]) {
  applicationRoutes.post(`/discover/opengrants/${tool}`, async (c) => c.json(ok(await applicant.openGrants(await svc(c), tool, parse(applicant.openGrantsInput, await jsonBody(c))))));
}

// ---- the funder's inbox ----
applicationRoutes.get("/applications", async (c) => {
  const p = page(c);
  const q = (k: string) => c.req.query(k) || undefined;
  const competition = q("competitionId");
  const assignee = q("assignee");
  const { items, total, counts } = await inbox.listApplications(await svc(c), p, {
    ...(competition ? { competitionId: uuidOf("competition", competition, "Competition") } : {}),
    stage: q("stage"),
    status: q("status"),
    eligibility: q("eligibility"),
    level: q("level"),
    tag: q("tag"),
    ...(assignee ? { assignee: assignee === "unassigned" ? assignee : bareUuid(assignee, "Member") } : {}),
    q: q("q"),
    view: q("view"),
    sortBy: q("sortBy"),
    sortOrder: q("sortOrder"),
  });
  return c.json({ ...paginated(items, pageInfo(p.page, p.pageSize, total)), counts });
});
applicationRoutes.post("/applications/bulk", async (c) => {
  const input = parse(inbox.bulkInput, await jsonBody(c));
  return c.json(ok(await inbox.bulkApplications(await svc(c), input, input.applicationIds.map((id) => uuidOf("application", id, "Application")))));
});
applicationRoutes.get("/applications/:id", async (c) => c.json(ok(await inbox.getApplicationDetail(await svc(c), appId(c)))));
applicationRoutes.post("/applications/:id/eligibility", async (c) => c.json(ok(await inbox.rerunEligibility(await svc(c), appId(c)))));
applicationRoutes.post("/applications/:id/advance", async (c) => c.json(ok(await inbox.advanceApplication(await svc(c), appId(c), parse(inbox.advanceInput, await jsonBody(c))))));
applicationRoutes.post("/applications/:id/request-revision", async (c) => c.json(ok(await inbox.requestRevision(await svc(c), appId(c), parse(inbox.revisionInput, await jsonBody(c))))));
applicationRoutes.post("/applications/:id/decline", async (c) => c.json(ok(await inbox.declineApplication(await svc(c), appId(c), parse(inbox.declineInput, await jsonBody(c))))));
applicationRoutes.post("/applications/:id/tags", async (c) => c.json(ok(await inbox.tagApplication(await svc(c), appId(c), parse(inbox.tagsInput, await jsonBody(c))))));
applicationRoutes.post("/applications/:id/assign", async (c) => c.json(ok(await inbox.assignApplication(await svc(c), appId(c), parse(inbox.assignInput, await jsonBody(c))))));

// ---- threads and tasks ----
applicationRoutes.get("/threads", async (c) => {
  const subject = c.req.query("subjectId");
  const q = parse(collab.threadQuery, { subjectType: c.req.query("subjectType") ?? "application", subjectId: subject ? uuidOf("application", subject, "Application") : undefined });
  return c.json(ok(await collab.listThreads(await svc(c), q)));
});
applicationRoutes.post("/threads", async (c) => {
  const body = z.object({ subjectType: z.literal("application").default("application"), subjectId: z.string(), visibility: z.enum(["shared", "internal"]).default("shared") }).strict();
  const input = parse(body, await jsonBody(c));
  return c.json(ok(await collab.openThread(await svc(c), { ...input, subjectId: uuidOf("application", input.subjectId, "Application") })));
});
applicationRoutes.post("/threads/:threadId/messages", async (c) => c.json(created(await collab.postMessage(await svc(c), bareUuid(c.req.param("threadId"), "Thread"), parse(collab.messageInput, await jsonBody(c)))), 201));
applicationRoutes.get("/tasks", async (c) => c.json(ok(await collab.listTasks(await svc(c), { open: c.req.query("open") === "true", mine: c.req.query("mine") === "true" }))));
applicationRoutes.post("/tasks", async (c) => c.json(created(await collab.createTask(await svc(c), parse(collab.taskInput, await jsonBody(c)))), 201));
applicationRoutes.patch("/tasks/:taskId", async (c) => c.json(ok(await collab.updateTask(await svc(c), bareUuid(c.req.param("taskId"), "Task"), parse(collab.taskPatch, await jsonBody(c))))));
