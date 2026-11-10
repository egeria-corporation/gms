// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for integrations, analytics, exports and imports (build spec §9.2).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ApiError, created, ok } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as analytics from "../../services/analytics.ts";
import * as integrations from "../../services/integrations.ts";
import { jsonBody, svc } from "../http.ts";

export const adminRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;
for (const prefix of ["webhooks", "api-clients", "mcp-connections", "custom-mcp-servers", "connectors", "analytics", "exports", "imports", "directory"]) {
  adminRoutes.use(`/${prefix}`, authenticate());
  adminRoutes.use(`/${prefix}/*`, authenticate());
}
const id = (c: C, what: string) => bareUuid(c.req.param("id"), what);

// ---- outbound webhooks ----
adminRoutes.get("/webhooks", async (c) => c.json(ok(await integrations.listWebhooks(await svc(c)))));
adminRoutes.post("/webhooks", async (c) => c.json(created(await integrations.createWebhook(await svc(c), parse(integrations.webhookInput, await jsonBody(c)))), 201));
adminRoutes.delete("/webhooks/:id", async (c) => c.json(ok(await integrations.deleteWebhook(await svc(c), id(c, "Webhook")))));
adminRoutes.get("/webhooks/:id/deliveries", async (c) => c.json(ok(await integrations.listWebhookDeliveries(await svc(c), id(c, "Webhook")))));

// ---- API clients ----
adminRoutes.get("/api-clients", async (c) => c.json(ok(await integrations.listApiClients(await svc(c)))));
adminRoutes.post("/api-clients", async (c) => c.json(created(await integrations.createApiClient(await svc(c), parse(integrations.apiClientInput, await jsonBody(c)))), 201));
adminRoutes.delete("/api-clients/:id", async (c) => c.json(ok(await integrations.revokeApiClient(await svc(c), id(c, "API client")))));

// ---- MCP connections and funder-registered MCP servers ----
adminRoutes.get("/mcp-connections", async (c) => c.json(ok(await integrations.listMcpConnections(await svc(c)))));
adminRoutes.delete("/mcp-connections/:id", async (c) => c.json(ok(await integrations.revokeMcpConnection(await svc(c), id(c, "MCP connection")))));
adminRoutes.get("/custom-mcp-servers", async (c) => c.json(ok(await integrations.listMcpServers(await svc(c)))));
adminRoutes.post("/custom-mcp-servers", async (c) => c.json(created(await integrations.registerMcpServer(await svc(c), parse(integrations.mcpServerInput, await jsonBody(c)))), 201));
adminRoutes.get("/custom-mcp-servers/:id/tools", async (c) => c.json(ok(await integrations.listMcpServerTools(await svc(c), id(c, "MCP server")))));
adminRoutes.patch("/custom-mcp-servers/:id", async (c) => c.json(ok(await integrations.updateMcpServer(await svc(c), id(c, "MCP server"), parse(integrations.mcpServerPatch, await jsonBody(c))))));
adminRoutes.delete("/custom-mcp-servers/:id", async (c) => c.json(ok(await integrations.removeMcpServer(await svc(c), id(c, "MCP server")))));

// ---- connectors (Mercury read-only, Google Workspace through Composio) ----
adminRoutes.get("/connectors/:provider", async (c) => c.json(ok(await integrations.getConnector(await svc(c), integrations.providerOf(c.req.param("provider"))))));
adminRoutes.post("/connectors/:provider", async (c) => c.json(ok(await integrations.connect(await svc(c), integrations.providerOf(c.req.param("provider")), parse(integrations.connectorInput, await jsonBody(c))))));
adminRoutes.delete("/connectors/:provider", async (c) => c.json(ok(await integrations.disconnect(await svc(c), integrations.providerOf(c.req.param("provider"))))));
adminRoutes.post("/connectors/:provider/sync", async (c) => c.json(ok(await integrations.syncConnector(await svc(c), integrations.providerOf(c.req.param("provider"))))));
adminRoutes.get("/directory/suggest", async (c) => c.json(ok(await integrations.suggestMembers(await svc(c), c.req.query("q") ?? ""))));

// ---- analytics, exports, imports ----
adminRoutes.get("/analytics/portfolio", async (c) => {
  const fy = c.req.query("fy");
  if (fy !== undefined && !/^\d{4}$/.test(fy)) throw new ApiError(400, "bad_request", "fy must be a four-digit year");
  return c.json(ok(await analytics.portfolio(await svc(c), fy ? { fiscalYear: Number(fy) } : {})));
});
adminRoutes.get("/analytics/cycle/:competitionId", async (c) => c.json(ok(await analytics.cycleMetrics(await svc(c), uuidOf("competition", c.req.param("competitionId"), "Competition")))));
adminRoutes.get("/exports/990pf", async (c) => {
  const year = c.req.query("year") ?? String(new Date().getUTCFullYear());
  if (!/^\d{4}$/.test(year)) throw new ApiError(400, "bad_request", "year must be a four-digit year");
  const out = await analytics.grantList990pf(await svc(c), Number(year));
  if (c.req.query("format") === "csv") return new Response(out.csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="990pf-part-xv-${year}.csv"`, "Cache-Control": "private, no-store" } });
  const { csv: _csv, ...json } = out;
  return c.json(ok(json));
});
adminRoutes.post("/exports/bundle", async (c) => c.json(ok(await analytics.exportBundle(await svc(c), { inline: c.req.query("inline") === "true" }))));
adminRoutes.post("/imports/csv", async (c) => c.json(ok(await analytics.importAwardsCsv(await svc(c), parse(analytics.importInput, await jsonBody(c))))));
