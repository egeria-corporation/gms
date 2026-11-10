// SPDX-License-Identifier: AGPL-3.0-only
// Dispatch: rate limit → resolve tool → side → scope → validate → gate → service → ledger.
// Transport-independent; the Streamable HTTP mount in apps/api turns ToolResult into MCP content.
import { requiresApproval, type GatePolicy } from "./gates.ts";
import { GET_APPROVAL, getApprovalInput, type ToolRegistry } from "./registry.ts";
import { hasScope } from "./scopes.ts";
import { ServiceError, type ServiceLayer } from "./service.ts";
import type { Actor, Approval, ApprovalStore, CallContext, EventPort, KvPort, LedgerPort, ToolDefinition, ToolError, ToolResult } from "./types.ts";

export interface RateLimit {
  /** Calls allowed per window per token. */
  limit: number;
  windowSeconds: number;
}
export const DEFAULT_RATE_LIMIT: RateLimit = { limit: 120, windowSeconds: 60 };

export interface DispatcherDeps {
  registry: ToolRegistry;
  services: ServiceLayer;
  approvals: ApprovalStore;
  ledger: LedgerPort;
  kv: KvPort;
  events?: EventPort;
  /** Web origin; approval URLs are `${webBaseUrl}/approvals/${id}`. */
  webBaseUrl: string;
  /** Workspace and API-client gate overrides. */
  gatePolicy?: (ctx: { workspaceId: string; clientId: string | null }) => Promise<GatePolicy> | GatePolicy;
  rateLimit?: RateLimit;
  now?: () => Date;
  newId?: () => string;
}

type ServiceFn = (actor: Actor, input: unknown) => Promise<unknown>;

export function actorString(userId: string, clientId: string | null): string {
  return clientId ? `user:${userId}/client:${clientId}` : `user:${userId}`;
}

function toActor(ctx: CallContext): Actor {
  return { actor: actorString(ctx.userId, ctx.clientId), userId: ctx.userId, clientId: ctx.clientId, workspaceId: ctx.workspaceId, workspaceKind: ctx.workspaceKind, scopes: ctx.scopes };
}

const fail = (error: ToolError): ToolResult => ({ ok: false, error });

function serviceFailure(e: unknown): ToolError {
  if (e instanceof ServiceError) return { code: e.code, message: e.message, issues: e.issues };
  // Never leak internals (stack traces, SQL) to an agent.
  return { code: "service_error", message: "The request could not be completed." };
}

export class Dispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
  private newId(): string {
    return this.deps.newId ? this.deps.newId() : `apr_${crypto.randomUUID()}`;
  }

  private async overLimit(ctx: CallContext): Promise<number | null> {
    const { limit, windowSeconds } = this.deps.rateLimit ?? DEFAULT_RATE_LIMIT;
    const nowSec = Math.floor(this.now().getTime() / 1000);
    const window = Math.floor(nowSec / windowSeconds);
    const bucket = ctx.tokenId ?? `${ctx.clientId ?? "ui"}:${ctx.userId}`;
    const key = `mcp:rl:${bucket}:${window}`;
    const used = Number((await this.deps.kv.get(key)) ?? "0");
    if (used >= limit) return (window + 1) * windowSeconds - nowSec;
    await this.deps.kv.put(key, String(used + 1), { expirationTtl: windowSeconds * 2 });
    return null;
  }

  private async run(tool: ToolDefinition, actor: Actor, input: unknown): Promise<unknown> {
    const fn = (this.deps.services as unknown as Record<string, ServiceFn | undefined>)[tool.service];
    if (!fn) throw new Error(`ServiceLayer is missing ${tool.service}`);
    return fn.call(this.deps.services, actor, input);
  }

  async call(ctx: CallContext, name: string, rawInput: unknown): Promise<ToolResult> {
    const retryAfter = await this.overLimit(ctx);
    if (retryAfter !== null) return fail({ code: "rate_limited", message: "Rate limit exceeded for this token.", retryAfterSeconds: retryAfter });

    const tool = this.deps.registry.get(ctx.workspaceKind, name);
    if (!tool) {
      const elsewhere = this.deps.registry.find(name);
      if (elsewhere.length > 0) return fail({ code: "wrong_side", message: `${name} is a ${elsewhere[0]!.side} tool; this token is bound to a${ctx.workspaceKind === "applicant" ? "n" : ""} ${ctx.workspaceKind} workspace.` });
      return fail({ code: "unknown_tool", message: `No tool named ${name}.` });
    }

    if (name === GET_APPROVAL) return this.getApproval(ctx, rawInput);

    if (!hasScope(ctx.scopes, tool.scope)) return fail({ code: "insufficient_scope", message: `${name} requires the ${tool.scope} scope.` });

    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return fail({ code: "invalid_input", message: "Input failed validation.", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    const input = parsed.data;

    const policy = (await this.deps.gatePolicy?.({ workspaceId: ctx.workspaceId, clientId: ctx.clientId })) ?? {};
    const occurredAt = this.now().toISOString();
    const actor = toActor(ctx);

    if (requiresApproval(name, ctx, policy)) {
      const approval: Approval = {
        id: this.newId(),
        workspaceId: ctx.workspaceId,
        side: ctx.workspaceKind,
        tool: name,
        input,
        requestedBy: { userId: ctx.userId, clientId: ctx.clientId },
        status: "pending",
        createdAt: occurredAt,
      };
      await this.deps.approvals.create(approval);
      await this.deps.ledger.append({ workspaceId: ctx.workspaceId, actor: actor.actor, eventType: "approval.requested", subjectType: "approval", subjectId: approval.id, data: { tool: name, input }, occurredAt });
      await this.deps.events?.emit({ type: "approval.requested", workspaceId: ctx.workspaceId, data: { approvalId: approval.id, tool: name, requestedBy: approval.requestedBy } });
      return { ok: true, pending: { status: "pending_approval", approvalId: approval.id, url: this.approvalUrl(approval.id) } };
    }

    try {
      const result = await this.run(tool, actor, input);
      await this.deps.ledger.append({ workspaceId: ctx.workspaceId, actor: actor.actor, eventType: "mcp.tool.called", subjectType: "tool", subjectId: name, data: { input, outcome: "ok" }, occurredAt });
      return { ok: true, result };
    } catch (e) {
      const error = serviceFailure(e);
      await this.deps.ledger.append({ workspaceId: ctx.workspaceId, actor: actor.actor, eventType: "mcp.tool.called", subjectType: "tool", subjectId: name, data: { input, outcome: "error", code: error.code }, occurredAt });
      return fail(error);
    }
  }

  approvalUrl(id: string): string {
    return `${this.deps.webBaseUrl.replace(/\/$/, "")}/approvals/${id}`;
  }

  private async getApproval(ctx: CallContext, rawInput: unknown): Promise<ToolResult> {
    const parsed = getApprovalInput.safeParse(rawInput ?? {});
    if (!parsed.success) return fail({ code: "invalid_input", message: "approvalId is required." });
    const approval = await this.deps.approvals.get(parsed.data.approvalId);
    // Same answer for "missing" and "another workspace's": ids are not an oracle.
    if (!approval || approval.workspaceId !== ctx.workspaceId) return fail({ code: "not_found", message: "No such approval." });
    return {
      ok: true,
      result: {
        approvalId: approval.id,
        tool: approval.tool,
        status: approval.status,
        url: this.approvalUrl(approval.id),
        decidedAt: approval.decidedAt ?? null,
        note: approval.note ?? null,
        result: approval.status === "executed" ? (approval.result ?? null) : null,
        error: approval.status === "failed" ? (approval.error ?? null) : null,
      },
    };
  }

  /** A person resolves a pending approval from the UI. Approve runs the original call exactly once,
   * with the approver as the actor and the requesting agent recorded alongside. */
  async resolveApproval(
    approver: { userId: string; workspaceId: string; workspaceKind: CallContext["workspaceKind"]; scopes: readonly string[]; clientId?: string | null },
    approvalId: string,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<{ ok: true; approval: Approval } | { ok: false; error: ToolError }> {
    if (approver.clientId) return { ok: false, error: { code: "forbidden", message: "Approvals are resolved by a person in the GMS, never by an API client or agent." } };
    const approval = await this.deps.approvals.get(approvalId);
    if (!approval || approval.workspaceId !== approver.workspaceId) return { ok: false, error: { code: "not_found", message: "No such approval." } };
    const tool = this.deps.registry.get(approval.side, approval.tool);
    if (!tool) return { ok: false, error: { code: "unknown_tool", message: `No tool named ${approval.tool}.` } };
    if (!hasScope(approver.scopes, tool.scope)) return { ok: false, error: { code: "insufficient_scope", message: `Approving ${approval.tool} requires the ${tool.scope} scope.` } };

    const decidedAt = this.now().toISOString();
    const actor: Actor = { actor: actorString(approver.userId, null), userId: approver.userId, clientId: null, workspaceId: approver.workspaceId, workspaceKind: approver.workspaceKind, scopes: approver.scopes, requestedBy: approval.requestedBy };
    const ledger = (status: string, extra: Record<string, unknown> = {}) =>
      this.deps.ledger.append({ workspaceId: approval.workspaceId, actor: actor.actor, eventType: "approval.resolved", subjectType: "approval", subjectId: approval.id, data: { tool: approval.tool, status, requestedBy: actorString(approval.requestedBy.userId, approval.requestedBy.clientId), note: note ?? null, ...extra }, occurredAt: decidedAt });
    const emit = (status: string) => this.deps.events?.emit({ type: "approval.resolved", workspaceId: approval.workspaceId, data: { approvalId: approval.id, tool: approval.tool, status, decidedBy: approver.userId } });
    const conflict = { ok: false as const, error: { code: "conflict" as const, message: "This approval has already been resolved." } };

    if (decision === "reject") {
      if (!(await this.deps.approvals.transition(approvalId, "pending", { status: "rejected", decidedBy: approver.userId, decidedAt, note }))) return conflict;
      await ledger("rejected");
      await emit("rejected");
      return { ok: true, approval: { ...approval, status: "rejected", decidedBy: approver.userId, decidedAt, note } };
    }

    // Claim first: only one caller moves pending → approved, so the service call runs once.
    if (!(await this.deps.approvals.transition(approvalId, "pending", { status: "approved", decidedBy: approver.userId, decidedAt, note }))) return conflict;
    let final: Approval;
    try {
      const result = await this.run(tool, actor, approval.input);
      await this.deps.approvals.transition(approvalId, "approved", { status: "executed", result });
      final = { ...approval, status: "executed", decidedBy: approver.userId, decidedAt, note, result };
      await ledger("executed");
    } catch (e) {
      const error = serviceFailure(e);
      await this.deps.approvals.transition(approvalId, "approved", { status: "failed", error: error.message });
      final = { ...approval, status: "failed", decidedBy: approver.userId, decidedAt, note, error: error.message };
      await ledger("failed", { code: error.code });
    }
    await emit(final.status);
    return { ok: true, approval: final };
  }
}
