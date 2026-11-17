// SPDX-License-Identifier: AGPL-3.0-only
// /gms/operator: the growth measures for OpenGrants' operators (F3, docs/measures.md).
//   GET    /gms/operator/me                          is the signed-in person an operator
//   GET    /gms/operator/measures                    the nine measures, counts only
//   POST   /gms/operator/lost-deals                  record a deal lost, by stated reason
//   GET    /gms/operator/search-console              set up, connected, the chosen property
//   POST   /gms/operator/search-console/connect      a Composio-hosted Google sign-in
//   DELETE /gms/operator/search-console              disconnect
//   PUT    /gms/operator/search-console/site         choose the GMS's property
//   GET    /gms/operator/search-console/report       clicks and impressions, by kind of page
// A signed-in person's session only (requireUser): agents and API clients get 401 session_required.
// Who is an operator is checked before any body is read, so a caller who is not learns nothing.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { requireUser } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as measures from "../../services/measures.ts";
import { jsonBody, userSvc } from "../http.ts";

type C = Context<AppEnv>;
export const measureRoutes = new Hono<AppEnv>();

const operator = (c: C): measures.Operator => {
  const u = c.get("user");
  return { userId: u.userId, email: u.email ?? null, viaSso: (u.ssoProviderIds ?? []).length > 0 };
};
/** The context of an operator, or 403 before anything else happens. */
const operatorSvc = (c: C) => {
  const ctx = userSvc(c);
  measures.assertOperator(ctx, measures.operatorsOf(c.env), operator(c));
  return ctx;
};
const noStore = (c: C) => c.header("Cache-Control", "no-store");

measureRoutes.use("/operator/*", requireUser());

measureRoutes.get("/operator/me", (c) => {
  noStore(c);
  return c.json(ok({ operator: measures.isOperator(measures.operatorsOf(c.env), operator(c)) }));
});
measureRoutes.get("/operator/measures", async (c) => {
  const ctx = operatorSvc(c);
  noStore(c);
  return c.json(ok(await measures.getMeasures(ctx)));
});
measureRoutes.post("/operator/lost-deals", async (c) => {
  const ctx = operatorSvc(c);
  return c.json(created(await measures.recordLostDeal(ctx, parse(measures.lostDealInput, await jsonBody(c)))), 201);
});
measureRoutes.get("/operator/search-console", async (c) => {
  const ctx = operatorSvc(c);
  noStore(c);
  return c.json(ok(await measures.searchConsoleState(ctx)));
});
measureRoutes.post("/operator/search-console/connect", async (c) => {
  const ctx = operatorSvc(c);
  return c.json(ok(await measures.connectSearchConsole(ctx)));
});
measureRoutes.delete("/operator/search-console", async (c) => {
  const ctx = operatorSvc(c);
  return c.json(ok(await measures.disconnectSearchConsole(ctx)));
});
measureRoutes.put("/operator/search-console/site", async (c) => {
  const ctx = operatorSvc(c);
  return c.json(ok(await measures.chooseSearchConsoleSite(ctx, parse(measures.siteInput, await jsonBody(c)))));
});
measureRoutes.get("/operator/search-console/report", async (c) => {
  const ctx = operatorSvc(c);
  noStore(c);
  return c.json(ok(await measures.getSearchConsoleReport(ctx)));
});
