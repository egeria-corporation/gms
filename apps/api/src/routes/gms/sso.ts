// SPDX-License-Identifier: AGPL-3.0-only
// /gms/sso: single sign-on for funder workspaces (docs/sso.md). The settings and the domain
// actions act in the workspace the request names; `join` is the signed-in person's own, after an
// SSO sign-in, with no workspace. Each handler parses input and calls one service function.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate, requireUser } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as sso from "../../services/sso.ts";
import { jsonBody, svc, userSvc } from "../http.ts";

type C = Context<AppEnv>;
export const ssoRoutes = new Hono<AppEnv>();

// The person's own step after an SSO sign-in: registered before the workspace-bound routes.
ssoRoutes.post("/sso/join", requireUser(), async (c) => c.json(ok(await sso.joinThroughSso(userSvc(c), sso.sessionSsoOf(c.get("user"))))));

ssoRoutes.use("/sso/settings", authenticate());
ssoRoutes.use("/sso/domains", authenticate());
ssoRoutes.use("/sso/domains/*", authenticate());
ssoRoutes.use("/sso/requirement", authenticate());

/** A person's session facts; API clients and agents have none (`user` is set only for sessions). */
const session = (c: C) => sso.sessionSsoOf(c.get("principal").kind === "user" ? c.get("user") : null);
const domainId = (c: C) => bareUuid(c.req.param("id"), "Domain");

ssoRoutes.get("/sso/settings", async (c) => c.json(ok(await sso.getSsoSettings(await svc(c), { supabaseUrl: c.env.SUPABASE_URL }, session(c)))));
ssoRoutes.post("/sso/domains", async (c) => c.json(created(await sso.addSsoDomain(await svc(c), parse(sso.domainInput, await jsonBody(c)))), 201));
ssoRoutes.post("/sso/domains/:id/check", async (c) => c.json(ok(await sso.checkSsoDomain(await svc(c), domainId(c), sso.dohResolver()))));
ssoRoutes.delete("/sso/domains/:id", async (c) => c.json(ok(await sso.removeSsoDomain(await svc(c), domainId(c)))));
ssoRoutes.put("/sso/requirement", async (c) => c.json(ok(await sso.setSsoRequirement(await svc(c), parse(sso.requirementInput, await jsonBody(c)), session(c)))));
