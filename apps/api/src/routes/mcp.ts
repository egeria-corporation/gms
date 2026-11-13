// SPDX-License-Identifier: AGPL-3.0-only
// The MCP server at /mcp: Streamable HTTP, stateless. Every request is one JSON-RPC message (or a
// batch) answered as JSON; there is no session and no server-initiated stream, so GET answers 405.
// Auth is the same bearer check as every other route; a 401 points the client at the protected
// resource metadata (MCP authorization, RFC 9728). Tools run through the `@gms/mcp` dispatcher,
// which applies scopes, human gates, rate limits and ledger attribution.
import { parseActor, record } from "@gms/ledger";
import { Dispatcher, MemoryKv, createRegistry, getPrompt, listPrompts, listResourceTemplates, readResource, wwwAuthenticate, type CallContext, type GatePolicy, type KvPort, type ToolResult } from "@gms/mcp";
import { fanOut, isWebhookEventType } from "@gms/webhooks";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate } from "../auth/middleware.ts";
import { workspaceGates } from "../auth/rest-gates.ts";
import type { WorkspaceKind } from "../auth/scopes.ts";
import { trimSlash } from "../env.ts";
import { ApiError } from "../lib/errors.ts";
import { RepoApprovalStore, createResourceReader, createServiceLayer, type ContextBase } from "../services/mcp-layer.ts";
import { FACILITATED_OFF } from "../services/payments.ts";
import { config } from "./http.ts";

type C = Context<AppEnv>;

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const registry = createRegistry();
/** Used when the Worker has no KV binding (tests, a self-host without one): limits hold per isolate. */
const fallbackKv = new MemoryKv();

export function contextBase(c: C): ContextBase {
  const deps = c.get("deps");
  return { repos: deps.repos, ledger: deps.ledger, webhooks: deps.webhooks, now: deps.now, config: config(c), ports: deps.ports?.(c.env) ?? {} };
}

/** One dispatcher per request, over the request's stores. Shared by /mcp and /gms/approvals. */
export function dispatcherFor(c: C): Dispatcher {
  const deps = c.get("deps");
  const base = contextBase(c);
  const kv: KvPort = deps.kv?.(c.env) ?? fallbackKv;
  return new Dispatcher({
    registry,
    services: createServiceLayer(base),
    approvals: new RepoApprovalStore(deps.repos),
    kv,
    webBaseUrl: trimSlash(c.env.WEB_BASE_URL),
    now: deps.now,
    ledger: {
      append: async (e) => {
        const actor = parseActor(e.actor);
        if (actor) await record(deps.ledger, { workspaceId: e.workspaceId, actor, eventType: e.eventType, subjectType: e.subjectType, subjectId: e.subjectId, data: e.data }, { now: deps.now });
      },
    },
    events: {
      emit: async (e) => {
        if (isWebhookEventType(e.type)) await fanOut({ id: crypto.randomUUID(), type: e.type, workspaceId: e.workspaceId, occurredAt: deps.now().toISOString(), data: e.data }, { store: deps.webhooks, now: deps.now });
      },
    },
    // A workspace's settings and an API client's `gated_tools` can add gates; nothing removes one.
    gatePolicy: async ({ workspaceId }): Promise<GatePolicy> => {
      const ws = await deps.repos.table("workspaces").one({ id: workspaceId });
      return { additionalGatedTools: workspaceGates(ws?.settings) };
    },
  });
}

async function callContext(c: C): Promise<CallContext> {
  const p = c.get("principal");
  // Tools act for a person in a workspace. A client-credentials token has no person behind it.
  if (!p.userId) throw new ApiError(403, "person_required", "MCP tools act for a person. Connect with the authorization code flow; client-credentials tokens use the REST API");
  const ws = await c.get("deps").repos.table("workspaces").one({ id: p.workspaceId });
  if (!ws) throw new ApiError(404, "not_found", "Workspace not found");
  return { userId: p.userId, clientId: p.clientId, workspaceId: p.workspaceId, workspaceKind: ws.kind as WorkspaceKind, scopes: p.scopes, approvalsBypass: p.scopes.includes("approvals:bypass"), ...(p.jti ? { tokenId: p.jti } : {}) };
}

interface RpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
}
const rpcError = (id: RpcRequest["id"], code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });

/** A tool result as MCP content. Tool failures are results with `isError`, not protocol errors, so the model can read them. */
function toolContent(r: ToolResult) {
  if (!r.ok) return { content: [{ type: "text", text: JSON.stringify({ error: r.error }) }], structuredContent: { error: r.error }, isError: true };
  const payload = "pending" in r ? r.pending : r.result;
  const structured = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : { result: payload };
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null) }], structuredContent: structured, isError: false };
}

async function handle(c: C, ctx: CallContext, req: RpcRequest): Promise<unknown | null> {
  const isNotification = req.id === undefined;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(req.id, -32600, "Invalid Request");
  const params = req.params ?? {};
  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return rpcResult(req.id, {
        protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "opengrants-gms", title: "OpenGrants GMS", version: "1.3.0" },
        instructions: `You are connected to a ${ctx.workspaceKind} workspace on OpenGrants GMS. Some tools need a person's approval: they return { status: "pending_approval", approvalId, url }; poll get_approval. The GMS never shows bank or identity numbers.`,
      });
    }
    case "ping":
      return rpcResult(req.id, {});
    case "tools/list": {
      const policy = { additionalGatedTools: [] as string[] };
      return rpcResult(req.id, { tools: registry.describe(ctx.workspaceKind, policy).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.name.replace(/_/g, " "), readOnlyHint: t.annotations.scope.endsWith(":read"), destructiveHint: false }, _meta: { "gms/scope": t.annotations.scope, "gms/gated": t.annotations.gated, "gms/alwaysHuman": t.annotations.alwaysHuman } })) });
    }
    case "tools/call": {
      if (typeof params.name !== "string") return rpcError(req.id, -32602, "params.name is required");
      // With payments through Passport switched off there is nothing for a person to approve: say so
      // now, as the REST route does, instead of filing an approval request that can only fail.
      if (params.name === "release_tranche" && c.env.PAYMENTS_FACILITATED !== "true") {
        return rpcResult(req.id, toolContent({ ok: false, error: { code: "conflict", message: `${FACILITATED_OFF} (facilitated_payments_disabled).` } }));
      }
      return rpcResult(req.id, toolContent(await dispatcherFor(c).call(ctx, params.name, params.arguments ?? {})));
    }
    case "resources/list":
      return rpcResult(req.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(req.id, { resourceTemplates: listResourceTemplates() });
    case "resources/read": {
      if (typeof params.uri !== "string") return rpcError(req.id, -32602, "params.uri is required");
      const r = await readResource(ctx, createResourceReader(contextBase(c)), params.uri);
      return r.ok ? rpcResult(req.id, { contents: [r.contents] }) : rpcError(req.id, r.error.code === "not_found" ? -32002 : -32602, r.error.message);
    }
    case "prompts/list":
      return rpcResult(req.id, { prompts: listPrompts(ctx.workspaceKind) });
    case "prompts/get": {
      if (typeof params.name !== "string") return rpcError(req.id, -32602, "params.name is required");
      try {
        return rpcResult(req.id, getPrompt(ctx.workspaceKind, params.name, (params.arguments ?? {}) as Record<string, string>));
      } catch (e) {
        return rpcError(req.id, -32602, e instanceof Error ? e.message : "Unknown prompt");
      }
    }
    default:
      // Notifications (initialized, cancelled, …) get no response body.
      return isNotification ? null : rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export const mcp = new Hono<AppEnv>();

mcp.all("/", async (c) => {
  const base = trimSlash(c.env.GMS_BASE_URL);
  if (c.req.method === "GET" || c.req.method === "DELETE") return c.json(rpcError(null, -32000, "This server is stateless: POST one JSON-RPC message per request"), 405, { Allow: "POST" });
  if (c.req.method !== "POST") return c.json(rpcError(null, -32000, "Method not allowed"), 405, { Allow: "POST" });

  try {
    await authenticate()(c, async () => {});
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // MCP authorization: tell the client where the resource metadata lives.
      return c.json({ status: 401, message: e.message, errors: [{ code: e.code }] }, 401, { "WWW-Authenticate": wwwAuthenticate(base) });
    }
    throw e;
  }
  const ctx = await callContext(c);

  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return c.json(rpcError(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return c.json(rpcError(null, -32600, "A batch holds 1 to 20 messages"), 400);
    const out = [];
    for (const m of body) {
      const r = await handle(c, ctx, m as RpcRequest);
      if (r !== null) out.push(r);
    }
    return out.length ? c.json(out) : c.body(null, 202);
  }
  if (!body || typeof body !== "object") return c.json(rpcError(null, -32600, "Invalid Request"), 400);
  const r = await handle(c, ctx, body as RpcRequest);
  return r === null ? c.body(null, 202) : c.json(r as Record<string, unknown>);
});
