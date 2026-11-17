// SPDX-License-Identifier: AGPL-3.0-only
// /gms/presence/passes: a pass to a draft's live channel, for the signed-in person's session
// (docs/co-editing.md). The handler builds the context and calls the one service function; the
// service checks the person may open the draft before anything is written.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { issuePresencePass } from "../../services/presence.ts";
import { jsonBody, svc } from "../http.ts";

export const presenceRoutes = new Hono<AppEnv>();

presenceRoutes.use("/presence/*", authenticate());
presenceRoutes.post("/presence/passes", async (c) => {
  c.header("Cache-Control", "no-store");
  // `user` is set for a person's session only; a token has none and is refused in the service.
  const sessionId = c.get("principal").kind === "user" ? c.get("user")?.sessionId : null;
  return c.json(ok(await issuePresencePass(await svc(c), { sessionId }, await jsonBody(c))));
});
