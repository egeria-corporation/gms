// SPDX-License-Identifier: AGPL-3.0-only
// /gms/funds: a funder's funds, their budgets and their advisors, and the public page of one fund.
// The service (../../services/funds.ts) holds the rules; who sees which fund is decided in the one
// authorization path (services/context.ts, fundScopeOf).
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as funds from "../../services/funds.ts";
import { jsonBody, publicCtx, svc } from "../http.ts";

export const fundRoutes = new Hono<AppEnv>();

for (const p of ["/funds", "/funds/*"]) fundRoutes.use(p, authenticate());
const fundId = (c: { req: { param: (k: string) => string | undefined } }) => bareUuid(c.req.param("id"), "Fund");

fundRoutes.get("/funds", async (c) => c.json(ok(await funds.listFunds(await svc(c)))));
fundRoutes.post("/funds", async (c) => c.json(created(await funds.createFund(await svc(c), parse(funds.fundInput, await jsonBody(c)))), 201));
fundRoutes.get("/funds/:id", async (c) => c.json(ok(await funds.getFund(await svc(c), fundId(c)))));
fundRoutes.patch("/funds/:id", async (c) => c.json(ok(await funds.updateFund(await svc(c), fundId(c), parse(funds.fundPatch, await jsonBody(c))))));
fundRoutes.put("/funds/:id/budgets", async (c) => c.json(ok(await funds.putFundBudgets(await svc(c), fundId(c), parse(funds.fundBudgetsInput, await jsonBody(c))))));
fundRoutes.post("/funds/:id/advisors", async (c) => c.json(created(await funds.inviteAdvisor(await svc(c), fundId(c), parse(funds.advisorInput, await jsonBody(c)))), 201));

// The public page of one fund: no token, published records only.
fundRoutes.get("/public/funders/:handle/funds/:slug", async (c) => {
  c.header("Cache-Control", "public, max-age=60, s-maxage=300");
  return c.json(ok(await funds.publicFundPage(publicCtx(c), c.req.param("handle"), c.req.param("slug"))));
});
