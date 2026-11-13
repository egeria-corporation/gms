// SPDX-License-Identifier: AGPL-3.0-only
// Context, ports and result shapes for the transport-independent MCP core.
import type { z } from "zod";
import type { Scope } from "./scopes.ts";

export type Side = "funder" | "applicant";

/** What the transport hands the dispatcher after it has verified the Bearer token. */
export interface CallContext {
  userId: string;
  /** OAuth client the token was issued to; `null` for a human acting in the UI. */
  clientId: string | null;
  workspaceId: string;
  workspaceKind: Side;
  scopes: readonly string[];
  /** Explicit `approvals:bypass` grant on the token. Never lifts the non-bypassable gates. */
  approvalsBypass: boolean;
  /** Token id (`jti`); the rate-limit bucket. Falls back to client + user. */
  tokenId?: string;
}

/** Who the service layer sees. The same shape reaches it from REST routes. */
export interface Actor {
  /** `user:<id>` or `user:<id>/client:<id>` — the ledger actor string. */
  actor: string;
  userId: string;
  clientId: string | null;
  workspaceId: string;
  workspaceKind: Side;
  scopes: readonly string[];
  /** Set when a human approved an agent's gated call: the agent that asked. */
  requestedBy?: { userId: string; clientId: string | null };
}

export interface ToolSpec<S extends string = string, I extends z.ZodObject = z.ZodObject> {
  /** Name of the ServiceLayer method this tool calls. */
  service: S;
  scope: Scope;
  description: string;
  input: I;
  /** Gated by default (human approval required for agents). */
  gated: boolean;
  /** How the input is written to the ledger, when it holds something the ledger must not (an email address). The approval keeps the full input to run. */
  ledgerInput?: (input: Record<string, unknown>) => Record<string, unknown>;
}

export interface ToolDefinition extends ToolSpec {
  name: string;
  side: Side;
  /** JSON Schema (2020-12) of `input`, as served in `tools/list`. */
  inputSchema: Record<string, unknown>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface Approval {
  id: string;
  workspaceId: string;
  side: Side;
  tool: string;
  input: unknown;
  requestedBy: { userId: string; clientId: string | null };
  status: ApprovalStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  result?: unknown;
  error?: string;
}

export interface ApprovalStore {
  create(approval: Approval): Promise<void>;
  get(id: string): Promise<Approval | null>;
  /** Atomic compare-and-set on `status`. Returns false when the approval was not in `from`. */
  transition(id: string, from: ApprovalStatus, patch: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean>;
}

/** Cloudflare KV-shaped port used for rate limiting. */
export interface KvPort {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface LedgerEvent {
  workspaceId: string;
  actor: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
  occurredAt: string;
}
export interface LedgerPort {
  append(event: LedgerEvent): Promise<void>;
}

/** Outbound notification of gate events (`approval.requested`, `approval.resolved`). */
export interface EventPort {
  emit(event: { type: "approval.requested" | "approval.resolved"; workspaceId: string; data: Record<string, unknown> }): Promise<void>;
}

export type ToolErrorCode =
  | "unknown_tool"
  | "wrong_side"
  | "insufficient_scope"
  | "invalid_input"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "service_error";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  issues?: { field: string; message: string }[];
  retryAfterSeconds?: number;
}

export interface PendingApproval {
  status: "pending_approval";
  approvalId: string;
  url: string;
}

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: true; pending: PendingApproval }
  | { ok: false; error: ToolError };
