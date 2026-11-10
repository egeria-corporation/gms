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
import { uuidOf } from "../../lib/ids.ts";
import * as approvals from "../../services/approvals.ts";
import * as inbox from "../../services/inbox.ts";
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

/**
 * What approving would do, for the approvals screen: the applications a request touches and, for a
 * decline, the letter each would receive. Reads through the same rules as the approval itself.
 */
approvalRoutes.get("/approvals/:id/preview", async (c) => {
  const ctx = await svc(c);
  const approval = await approvals.getApproval(ctx, c.req.param("id"), scopeOf);
  const input = (approval.input ?? {}) as { applicationId?: unknown; applicationIds?: unknown; rationale?: unknown; params?: { rationale?: unknown } };
  const ids = [...(typeof input.applicationId === "string" ? [input.applicationId] : []), ...(Array.isArray(input.applicationIds) ? input.applicationIds.filter((x): x is string => typeof x === "string") : [])];
  const rationale = typeof input.rationale === "string" ? input.rationale : typeof input.params?.rationale === "string" ? input.params.rationale : undefined;
  const letters = [];
  if (approval.tool === "decline_application") {
    for (const id of ids.slice(0, 50)) {
      try {
        letters.push(await inbox.declineLetterPreview(ctx, uuidOf("application", id, "Application"), rationale));
      } catch {
        // An application the reader cannot see, or that no longer exists, is left out of the preview.
      }
    }
  }
  return c.json(ok({ approval: view(approval, c.env.WEB_BASE_URL), affected: ids.length, letters }));
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
