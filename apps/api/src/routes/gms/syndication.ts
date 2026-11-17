// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for the "Share this call" panel (docs/syndication.md): what feeds and indexes a call
// is in, taking it out of the open-call feeds, and the Philanthropy News Digest preview and send
// (a person only: the service refuses agent and API-client tokens before reading the body).
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as syn from "../../services/syndication.ts";
import { jsonBody, svc } from "../http.ts";

export const syndicationRoutes = new Hono<AppEnv>();

// Authenticated once, whichever router's middleware ran first for the same path.
const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
syndicationRoutes.use("/opportunities/:id/syndication", signedIn);
syndicationRoutes.use("/opportunities/:id/syndication/*", signedIn);

const oppId = (id: string | undefined) => uuidOf("opportunity", id, "Opportunity");

syndicationRoutes.get("/opportunities/:id/syndication", async (c) => c.json(ok(await syn.syndicationOf(await svc(c), oppId(c.req.param("id"))))));
syndicationRoutes.put("/opportunities/:id/syndication/feeds", async (c) => c.json(ok(await syn.setFeeds(await svc(c), oppId(c.req.param("id")), parse(syn.feedsInput, await jsonBody(c))))));
syndicationRoutes.post("/opportunities/:id/syndication/pnd/preview", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(ok(await syn.previewPnd(await svc(c), oppId(c.req.param("id")))));
});
syndicationRoutes.post("/opportunities/:id/syndication/pnd", async (c) => {
  const ctx = await svc(c);
  const id = oppId(c.req.param("id"));
  // Who may send is checked before the body is read, so a caller who may not learns nothing from validation.
  await syn.assertMaySendPnd(ctx, id);
  return c.json(ok(await syn.sendPnd(ctx, id, parse(syn.pndSendInput, await jsonBody(c)))));
});
