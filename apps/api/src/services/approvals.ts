// SPDX-License-Identifier: AGPL-3.0-only
// Reading approvals (build spec §10.9). An approval carries the agent's full request (a decline
// rationale, a letter, an amount), so who may read one is decided here, like every other read:
// the person or agent that asked for it, a person who holds the scope of the gated tool (the
// people who could approve it), and the workspace's admins and auditors. Resolving an approval
// stays with the dispatcher in `@gms/mcp`, which applies the same scope rule before it runs anything.
import type { Approval } from "@gms/mcp";
import { ApiError, notFound } from "../lib/errors.ts";
import { authorize, type ServiceContext } from "./context.ts";
import { approvalFromRow, approvalUuid } from "./mcp-layer.ts";
import type { PageRequest } from "./programs.ts";

const READ_ALL_ROLES: readonly string[] = ["admin", "auditor"];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "executed", "failed", "expired"] as const;

/** The scope of the tool an approval is for; null when the tool is no longer registered. */
export type ScopeOfTool = (side: Approval["side"], tool: string) => string | null;

function canRead(ctx: ServiceContext, a: Approval, scopeOf: ScopeOfTool): boolean {
  const mine = a.requestedBy.userId === (ctx.actor.userId ?? "") && (ctx.actor.kind === "user" || a.requestedBy.clientId === ctx.actor.clientId);
  if (mine) return true;
  // Everything else is for people: an agent sees only what it asked for.
  if (ctx.actor.kind !== "user") return false;
  if (ctx.workspace?.role && READ_ALL_ROLES.includes(ctx.workspace.role)) return true;
  const scope = scopeOf(a.side, a.tool);
  return !!scope && ctx.scopes.includes(scope);
}

async function inWorkspace(ctx: ServiceContext) {
  const ws = ctx.workspace;
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  // A person-level check when there is a person; a client token is bound to its workspace by its claims.
  if (ctx.actor.userId) await authorize(ctx, { person: true, owner: ws.id, what: "Workspace" });
  return ws;
}

export async function listApprovals(ctx: ServiceContext, page: PageRequest, f: { status?: string | undefined }, scopeOf: ScopeOfTool) {
  const ws = await inWorkspace(ctx);
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "Approvals are listed and resolved by people in the workspace");
  if (f.status && !(APPROVAL_STATUSES as readonly string[]).includes(f.status)) throw new ApiError(400, "bad_request", `status must be one of ${APPROVAL_STATUSES.join(", ")}`);
  const rows = await ctx.repos.table("approvals").find({ workspace_id: ws.id, ...(f.status ? { status: f.status } : {}) }, { orderBy: "created_at", ascending: false, limit: 2000 });
  const visible = rows.map(approvalFromRow).filter((a) => canRead(ctx, a, scopeOf));
  return { items: visible.slice(page.offset, page.offset + page.pageSize), total: visible.length };
}

/** One approval. An approval the caller may not read answers 404, like any record outside its reach. */
export async function getApproval(ctx: ServiceContext, id: string, scopeOf: ScopeOfTool): Promise<Approval> {
  const ws = await inWorkspace(ctx);
  const uuid = approvalUuid(id);
  const row = uuid ? await ctx.repos.table("approvals").one({ id: uuid, workspace_id: ws.id }) : null;
  const approval = row ? approvalFromRow(row) : null;
  if (!approval || !canRead(ctx, approval, scopeOf)) throw notFound("Approval");
  return approval;
}
