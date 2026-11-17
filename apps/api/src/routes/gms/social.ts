// SPDX-License-Identifier: AGPL-3.0-only
// /gms/social: social posting through Zernio. The service (../../services/social.ts) holds the
// rules and the authorization; these handlers only parse. When Zernio is not set up on this
// server every route answers 404 before anything else, signed in or not.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ApiError, created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as social from "../../services/social.ts";
import { config, jsonBody, svc } from "../http.ts";

export const socialRoutes = new Hono<AppEnv>();

for (const p of ["/social", "/social/*"]) {
  socialRoutes.use(p, async (c, next) => {
    if (!social.socialConfigured({ config: config(c) })) throw new ApiError(404, "social_not_configured", "Social posting is not set up on this server");
    await next();
  });
  socialRoutes.use(p, authenticate());
}

const subjectQuery = (type: string | undefined, id: string | undefined) => {
  const r = social.subjectInput.safeParse({ type, id });
  if (!r.success) throw new ApiError(400, "bad_request", "subjectType must be opportunity, award or program, and subjectId an id", [{ code: "invalid_parameter", field: "subjectType" }]);
  return r.data;
};

socialRoutes.get("/social", async (c) => c.json(ok(await social.socialSettings(await svc(c)))));
socialRoutes.post("/social/connect", async (c) => c.json(ok(await social.startConnect(await svc(c), parse(social.connectInput, await jsonBody(c)).platform))));
socialRoutes.post("/social/connect/callback", async (c) => c.json(created(await social.finishConnect(await svc(c), parse(social.callbackInput, await jsonBody(c)))), 201));
socialRoutes.delete("/social/accounts/:id", async (c) => c.json(ok(await social.disconnectAccount(await svc(c), bareUuid(c.req.param("id"), "Social account")))));
socialRoutes.get("/social/compose", async (c) => c.json(ok(await social.composerDraft(await svc(c), subjectQuery(c.req.query("subjectType"), c.req.query("subjectId"))))));
socialRoutes.post("/social/posts/preview", async (c) => c.json(ok(await social.previewPost(await svc(c), parse(social.composeInput, await jsonBody(c))))));
// Post: a signed-in person's click only (the service refuses agent and API-client tokens).
socialRoutes.post("/social/posts", async (c) => c.json(created(await social.sendPost(await svc(c), parse(social.sendInput, await jsonBody(c)), c.req.header("Idempotency-Key"))), 201));
socialRoutes.get("/social/posts", async (c) => c.json(ok(await social.reachReport(await svc(c), parse(social.reachQuery, { ...(c.req.query("subjectType") ? { subjectType: c.req.query("subjectType") } : {}), ...(c.req.query("subjectId") ? { subjectId: c.req.query("subjectId") } : {}) })))));
// "Two weeks left": a funder admin dismisses a call's prompt (a person only; there is no MCP tool).
socialRoutes.post("/social/reminders/:id/dismiss", async (c) => c.json(ok(await social.dismissReminder(await svc(c), bareUuid(c.req.param("id"), "Reminder")))));
