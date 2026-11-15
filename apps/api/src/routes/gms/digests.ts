// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for the opt-in content digests (v1.8.0): a person's choices in a workspace, the
// preview of next Monday's email, and the one-click unsubscribe, which needs no sign-in (the signed
// link is the proof). Each handler parses input, builds the context and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { badRequest, ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as digests from "../../services/content-digests.ts";
import { config, jsonBody, svc } from "../http.ts";

type C = Context<AppEnv>;
export const digestRoutes = new Hono<AppEnv>();

// ---- one-click unsubscribe: public ----
/** The token from the query (the List-Unsubscribe address) or a JSON body (the web page). */
async function tokenOf(c: C): Promise<string> {
  const fromQuery = c.req.query("token");
  if (fromQuery) return parse(digests.unsubscribeInput, { token: fromQuery }).token;
  // Mail apps POST `List-Unsubscribe=One-Click` as a form (RFC 8058); the token is then in the address.
  if ((c.req.header("content-type") ?? "").includes("application/x-www-form-urlencoded")) throw badRequest("The unsubscribe link is missing its token");
  return parse(digests.unsubscribeInput, await jsonBody(c)).token;
}
digestRoutes.post("/digests/unsubscribe", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const deps = c.get("deps");
  return c.json(ok(await digests.unsubscribe({ repos: deps.repos, now: deps.now, config: config(c) }, await tokenOf(c))));
});
/** Opening the List-Unsubscribe address in a browser changes nothing: it leads to the page that asks the API. */
digestRoutes.get("/digests/unsubscribe", (c) => {
  const token = c.req.query("token") ?? "";
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(`${config(c).webBaseUrl}/digests/unsubscribe${token ? `#token=${encodeURIComponent(token)}` : ""}`, 303);
});

// ---- a person's choices and the preview ----
digestRoutes.use("/digests", authenticate());
digestRoutes.use("/digests/preview", authenticate());

digestRoutes.get("/digests", async (c) => c.json(ok(await digests.getDigestSettings(await svc(c)))));
digestRoutes.put("/digests", async (c) => c.json(ok(await digests.saveDigestSettings(await svc(c), parse(digests.digestSettingsInput, await jsonBody(c))))));
digestRoutes.get("/digests/preview", async (c) => c.json(ok(await digests.previewDigest(await svc(c), parse(digests.previewQuery, { digest: c.req.query("digest") }).digest))));
