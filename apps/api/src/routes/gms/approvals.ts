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
import { approvalFromRow, approvalUuid } from "../../services/mcp-layer.ts";
import { jsonBody, page } from "../http.ts";
import { dispatcherFor, registry } from "../mcp.ts";

export const approvalRoutes = new Hono<AppEnv>();
approvalRoutes.use("/approvals", authenticate());
approvalRoutes.use("/approvals/*", authenticate());

const STATUSES = ["pending", "approved", "rejected", "executed", "failed", "expired"];
const view = (a: ReturnType<typeof approvalFromRow>, webBaseUrl: string) => {
  const tool = registry.get(a.side, a.tool);
  return { ...a, scope: tool?.scope ?? null, description: tool?.description ?? null, url: `${webBaseUrl.replace(/\/$/, "")}/approvals/${a.id}` };
};

approvalRoutes.get("/approvals", async (c) => {
  const p = c.get("principal");
  if (!p.role) throw new ApiError(403, "person_required", "Approvals are listed and resolved by people in the workspace");
  const status = c.req.query("status");
  if (status && !STATUSES.includes(status)) throw new ApiError(400, "bad_request", `status must be one of ${STATUSES.join(", ")}`);
  const pg = page(c);
  const repo = c.get("deps").repos.table("approvals");
  const where = { workspace_id: p.workspaceId, ...(status ? { status } : {}) };
  const [rows, total] = await Promise.all([repo.find(where, { orderBy: "created_at", ascending: false, limit: pg.pageSize, offset: pg.offset }), repo.count(where)]);
  return c.json(paginated(rows.map((r) => view(approvalFromRow(r), c.env.WEB_BASE_URL)), pageInfo(pg.page, pg.pageSize, total)));
});

approvalRoutes.get("/approvals/:id", async (c) => {
  const p = c.get("principal");
  const uuid = approvalUuid(c.req.param("id"));
  const row = uuid ? await c.get("deps").repos.table("approvals").one({ id: uuid, workspace_id: p.workspaceId }) : null;
  if (!row) throw notFound("Approval");
  return c.json(ok(view(approvalFromRow(row), c.env.WEB_BASE_URL)));
});

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
