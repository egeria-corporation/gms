// SPDX-License-Identifier: AGPL-3.0-or-later
// MCP server at /mcp — stateless Streamable HTTP, hand-rolled JSON-RPC with the SDK's types.
//
// Why hand-rolled: the installed @modelcontextprotocol/sdk (1.30.1) implements protocol revisions up to
// 2025-11-25 and its transports keep per-connection Server state. The 2026-07-28 revision targets stateless
// servers (no Mcp-Session-Id, no required initialize handshake, protocol version carried on every request), so
// every POST here is self-contained: authenticate → build the caller's tool set → answer → done.
//
// Conformance notes:
//   - POST only (GET/DELETE → 405: no server-initiated streams, no sessions). No Mcp-Session-Id is ever issued.
//   - JSON response by default; a single-event SSE stream when the client only accepts text/event-stream.
//   - Notifications and responses from the client → 202 Accepted with no body. JSON-RPC batches → -32600.
//   - MCP-Protocol-Version is validated when present; initialize negotiates one of SUPPORTED_PROTOCOL_VERSIONS.
//   - Auth (MCP authorization spec): invalid token → HTTP 401 + WWW-Authenticate resource_metadata; missing scope
//     → HTTP 403 insufficient_scope; anonymous callers get the public tools only.
import type { CallToolResult, InitializeResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ActionContext } from '@gms/actions';
import { getAction } from '@gms/actions';
import { DomainError, isDomainError, toProblem, type ProblemDetails } from '@gms/domain';
import {
  authenticate,
  channelDisabled,
  channelEnabled,
  insufficientScope,
  rateLimitHeaders,
  unauthorized,
  type AgentPrincipal,
} from './auth';
import {
  capabilitySchemas,
  findCapability,
  invokeCapability,
  roleAllows,
  visibleCapabilities,
  type Capability,
} from './catalog';
import { errorResponse, HttpError, isRecord, readJson, trimOrigin, type AgentEnv } from './env';
import { UNTRUSTED_NOTICE } from './reads';

export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const SERVER_VERSION = '1.0.0';

type JsonRpcId = string | number;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
}

const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

function rpcError(id: JsonRpcId | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function hintFor(p: ProblemDetails, env: AgentEnv): string {
  switch (p.code) {
    case 'human_only':
      return `Only a person can do this. Ask them to do it themselves in GMS at ${trimOrigin(env.origin)}/console.`;
    case 'approval_required':
      return `Ask the person to confirm at ${String(p.confirmUrl ?? '')}.`;
    case 'validation_failed':
      return 'Fix the fields listed in `errors` (JSON Pointers) and call the tool again.';
    case 'insufficient_scope':
      return `Ask the person to reconnect the agent with: ${((p.requiredScopes as string[] | undefined) ?? []).join(' ')}.`;
    case 'forbidden':
      return 'The person this agent acts for is not allowed to do this. Do not retry.';
    case 'not_found':
      return 'Check the id (use a search or list tool to find it).';
    case 'deadline_passed':
      return 'Tell the person the deadline passed; they can contact the foundation about an extension.';
    case 'conflict':
      return 'Reload the current state (get_status / get_application_form) and try again.';
    case 'rate_limited':
      return 'Wait and retry later.';
    default:
      return 'Tell the person what happened; do not retry automatically.';
  }
}

function toolError(p: ProblemDetails, env: AgentEnv): CallToolResult {
  const hint = hintFor(p, env);
  return {
    isError: true,
    content: [
      { type: 'text', text: `${p.title}: ${p.detail} ${hint}` },
      { type: 'text', text: JSON.stringify({ ...p, hint }) },
    ],
  };
}

function toolFor(cap: Capability & { tier: string }): Tool {
  const { input, output } = capabilitySchemas(cap);
  return {
    name: cap.name,
    title: cap.title,
    description: cap.description,
    inputSchema: input as Tool['inputSchema'],
    ...(output ? { outputSchema: output as Tool['outputSchema'] } : {}),
    annotations: {
      title: cap.title,
      readOnlyHint: cap.tier === 'R0',
      destructiveHint: false,
      idempotentHint: cap.idempotent,
      openWorldHint: false,
    },
    _meta: {
      'gms/riskTier': cap.tier,
      'gms/scopes': [...cap.scopes],
      ...(cap.actionId ? { 'gms/actionId': cap.actionId } : {}),
      'gms/audience': cap.audience,
    },
  };
}

function instructions(env: AgentEnv): string {
  return [
    `You are connected to ${env.brandName}'s grants platform (GMS).`,
    'People always confirm consequential actions: tools marked R2 return status "approval_required" with a confirmUrl — give that link to the person and wait; never claim the action happened.',
    'People-only (R3) actions — approving payments, final decisions, signing agreements, roles, bank details — are not available to agents at all.',
    UNTRUSTED_NOTICE,
    `Guide: ${trimOrigin(env.origin)}/agents.md`,
  ].join('\n');
}

/** A tool name that maps to a people-only action (so we can refuse it explicitly instead of "unknown tool"). */
function peopleOnlyAction(name: string) {
  const a = getAction(name) ?? getAction(name.replace(/_/g, '.')) ?? getAction(name.replace('_', '.'));
  return a && a.riskTier === 'R3' ? a : undefined;
}

interface CallState {
  env: AgentEnv;
  ctx: ActionContext;
  principal: AgentPrincipal | null;
}

async function handleRpc(msg: RpcRequest, st: CallState): Promise<unknown> {
  const id = msg.id ?? null;
  const params = isRecord(msg.params) ? msg.params : {};
  switch (msg.method) {
    case 'initialize': {
      const requested =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
      const result: InitializeResult = {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gms', title: `${st.env.brandName} (GMS)`, version: SERVER_VERSION },
        instructions: instructions(st.env),
      };
      return { jsonrpc: '2.0', id, result };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': {
      const caps = await visibleCapabilities(st.env, st.ctx, st.principal);
      return { jsonrpc: '2.0', id, result: { tools: caps.map(toolFor) } };
    }
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments ?? {};
      if (!isRecord(args)) return rpcError(id, RPC.invalidParams, '`arguments` must be an object.');
      const cap = findCapability(name);
      if (!cap) {
        const r3 = peopleOnlyAction(name);
        if (r3) {
          const p = toProblem(
            new DomainError(
              'human_only',
              `"${r3.title}" can only be done by a person in GMS. Agents cannot be granted this.`,
              { riskTier: 'R3' },
            ),
          );
          return { jsonrpc: '2.0', id, result: toolError(p, st.env) };
        }
        return rpcError(id, RPC.invalidParams, `Unknown tool: ${name}`);
      }
      // HTTP-level challenges (MCP authorization): anonymous → 401, missing scope → 403 insufficient_scope.
      if (!st.principal && !roleAllows(cap, st.ctx)) throw unauthorized(st.env, 'mcp', undefined, cap.scopes);
      if (
        st.principal &&
        st.ctx.scopes !== '*' &&
        !cap.scopes.every((s) => (st.ctx.scopes as readonly string[]).includes(s))
      ) {
        throw insufficientScope(st.env, 'mcp', cap.scopes, st.ctx.scopes as readonly string[]);
      }
      try {
        const r = await invokeCapability(st.env, cap, args, st.ctx, st.principal);
        if (r.status === 'approval_required') {
          const structured = {
            status: 'approval_required',
            approvalRequestId: r.approvalRequestId,
            confirmUrl: r.confirmUrl,
            expiresAt: r.expiresAt,
            preview: r.preview,
          };
          const result: CallToolResult = {
            content: [{ type: 'text', text: r.summary }],
            structuredContent: structured,
          };
          return { jsonrpc: '2.0', id, result };
        }
        const structured = cap.read
          ? (r.output as Record<string, unknown>)
          : { status: 'ok', result: r.output };
        const result: CallToolResult = {
          content: [{ type: 'text', text: r.summary }],
          structuredContent: structured,
        };
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (!isDomainError(err)) console.error('[mcp] tool failed', name, (err as Error)?.message);
        return {
          jsonrpc: '2.0',
          id,
          result: toolError(toProblem(err, `${trimOrigin(st.env.origin)}/mcp#${name}`), st.env),
        };
      }
    }
    default:
      if (typeof msg.method === 'string' && msg.method.startsWith('notifications/')) return null;
      return rpcError(id, RPC.methodNotFound, `Method not found: ${String(msg.method)}`);
  }
}

function wantsSse(req: Request): boolean {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/event-stream') && !accept.includes('application/json');
}

function respond(req: Request, body: unknown, headers: Record<string, string>, status = 200): Response {
  if (wantsSse(req)) {
    const payload = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
    return new Response(payload, {
      status,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...headers },
    });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function originAllowed(req: Request, env: AgentEnv): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  if (trimOrigin(origin) === trimOrigin(env.origin)) return true;
  const extra = (process.env.GMS_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => trimOrigin(s.trim()))
    .filter(Boolean);
  return extra.includes(trimOrigin(origin));
}

/** POST /mcp */
export async function handleMcp(req: Request, env: AgentEnv): Promise<Response> {
  const instance = `${trimOrigin(env.origin)}/mcp`;
  try {
    if (req.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } });
    }
    if (!originAllowed(req, env))
      throw new HttpError(403, 'forbidden', 'Origin not allowed', 'This Origin may not call the MCP server.');
    if (!(await channelEnabled(env, 'mcp'))) throw channelDisabled(env, 'mcp');
    const headerVersion = req.headers.get('mcp-protocol-version');
    if (headerVersion && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)) {
      return respond(
        req,
        rpcError(
          null,
          RPC.invalidRequest,
          `Unsupported MCP-Protocol-Version ${headerVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
        ),
        {},
        400,
      );
    }
    const auth = await authenticate(req, env, 'mcp', { channel: 'mcp' });
    const headers = rateLimitHeaders(auth.rate);
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return respond(req, rpcError(null, RPC.parse, 'Parse error'), headers, 400);
    }
    if (Array.isArray(body))
      return respond(
        req,
        rpcError(null, RPC.invalidRequest, 'JSON-RPC batches are not supported.'),
        headers,
        400,
      );
    if (!isRecord(body) || body.jsonrpc !== '2.0')
      return respond(req, rpcError(null, RPC.invalidRequest, 'Invalid JSON-RPC message.'), headers, 400);
    const msg = body as unknown as RpcRequest;
    // Responses or notifications from the client: acknowledge.
    if (msg.id === undefined || msg.id === null || typeof msg.method !== 'string') {
      return new Response(null, { status: 202, headers });
    }
    const out = await handleRpc(msg, { env, ctx: auth.ctx, principal: auth.principal });
    if (out === null) return new Response(null, { status: 202, headers });
    return respond(req, out, headers);
  } catch (err) {
    return errorResponse(err, instance);
  }
}
