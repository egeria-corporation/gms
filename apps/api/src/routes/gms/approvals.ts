// SPDX-License-Identifier: AGPL-3.0-only
// /gms/approvals: the human side of the gate (build spec §10.9). An agent's gated call parks as an
// approval; a person in the same workspace who holds the tool's scope approves or rejects it here.
// Approving runs the original call once, as the approver, with the agent recorded alongside.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import type { WorkspaceKind } from "../../auth/scopes.ts";
import { ApiError, notFound, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as approvals from "../../services/approvals.ts";
import type { approvalFromRow } from "../../services/mcp-layer.ts";
import { jsonBody, page, svc } from "../http.ts";
import { dispatcherFor, registry } from "../mcp.ts";

export const approvalRoutes = new Hono<AppEnv>();
approvalRoutes.use("/approvals", authenticate());
approvalRoutes.use("/approvals/*", authenticate());

const view = (a: ReturnType<typeof approvalFromRow>, webBaseUrl: string) => {
  const tool = registry.get(a.side, a.tool);
  return { ...a, scope: tool?.scope ?? null, description: tool?.description ?? null, url: `${webBaseUrl.replace(/\/$/, "")}/approvals/${a.id}` };
};

const scopeOf: approvals.ScopeOfTool = (side, tool) => registry.get(side, tool)?.scope ?? null;

approvalRoutes.get("/approvals", async (c) => {
  const pg = page(c);
  const { items, total } = await approvals.listApprovals(await svc(c), pg, { status: c.req.query("status") }, scopeOf);
  return c.json(paginated(items.map((a) => view(a, c.env.WEB_BASE_URL)), pageInfo(pg.page, pg.pageSize, total)));
});

approvalRoutes.get("/approvals/:id", async (c) => c.json(ok(view(await approvals.getApproval(await svc(c), c.req.param("id"), scopeOf), c.env.WEB_BASE_URL))));

const decisionInput = z.object({ approve: z.boolean(), note: z.string().trim().max(2000).optional() }).strict();

approvalRoutes.post("/approvals/:id/decision", async (c) => {
  const p = c.get("principal");
  const { approve, note } = parse(decisionInput, await jsonBody(c));
  const ws = await c.get("deps").repos.table("workspaces").one({ id: p.workspaceId });
  if (!ws) throw notFound("Workspace");
  // The dispatcher refuses any caller with a client id: a gate is resolved by a person, in the app.
  const approver = { userId: p.userId ?? "", workspaceId: p.workspaceId, workspaceKind: ws.kind as WorkspaceKind, scopes: p.scopes, clientId: p.kind === "user" ? null : (p.clientId ?? "client") };
  const r = await dispatcherFor(c).resolveApproval(approver, c.req.param("id"), approve ? "approve" : "reject", note);
  if (!r.ok) throw new ApiError(r.error.code === "not_found" ? 404 : r.error.code === "conflict" ? 409 : 403, r.error.code, r.error.message);
  return c.json(ok(view(r.approval, c.env.WEB_BASE_URL)));
});
