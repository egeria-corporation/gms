// SPDX-License-Identifier: AGPL-3.0-or-later
// Scripted (no LLM) MCP / A2A / REST clients that drive the framework-agnostic handlers with real HTTP requests.
import { handleA2a, handleApiV1, handleMcp, handleOAuth, type AgentEnv, type OAuthRoute } from '@gms/agents';
import { ORIGIN } from './world';

export interface RpcReply<T = Record<string, unknown>> {
  res: Response;
  status: number;
  body: {
    jsonrpc?: string;
    id?: unknown;
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  } | null;
}

let seq = 0;

function headersFor(token?: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function parse(res: Response): Promise<RpcReply['body']> {
  const text = await res.text();
  if (!text) return null;
  const sse = /^data: (.*)$/m.exec(text);
  return JSON.parse(sse ? sse[1]! : text) as RpcReply['body'];
}

/** One JSON-RPC request to /mcp. */
export async function mcpRequest<T = Record<string, unknown>>(
  env: AgentEnv,
  method: string,
  params: Record<string, unknown> = {},
  token?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<RpcReply<T>> {
  const res = await handleMcp(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: headersFor(token, { 'mcp-protocol-version': '2026-07-28', ...extraHeaders }),
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    }),
    env,
  );
  return { res, status: res.status, body: (await parse(res)) as RpcReply<T>['body'] };
}

export interface ToolReply {
  status: number;
  isError: boolean;
  text: string;
  structured: Record<string, unknown> | null;
  /** The RFC 9457 problem + hint, for tool errors. */
  problem: Record<string, unknown> | null;
  res: Response;
}

/** tools/call and unpack the result. */
export async function callTool(
  env: AgentEnv,
  name: string,
  args: Record<string, unknown>,
  token?: string | null,
): Promise<ToolReply> {
  const r = await mcpRequest<{
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
  }>(env, 'tools/call', { name, arguments: args }, token);
  const result = r.body?.result;
  const texts = result?.content?.map((c) => c.text) ?? [];
  let problem: Record<string, unknown> | null = null;
  if (result?.isError && texts[1]) problem = JSON.parse(texts[1]) as Record<string, unknown>;
  return {
    status: r.status,
    isError: Boolean(result?.isError),
    text: texts[0] ?? '',
    structured: result?.structuredContent ?? null,
    problem,
    res: r.res,
  };
}

/** One JSON-RPC request to /a2a. */
export async function a2aRequest<T = Record<string, unknown>>(
  env: AgentEnv,
  method: string,
  params: Record<string, unknown>,
  token?: string | null,
): Promise<RpcReply<T>> {
  const res = await handleA2a(
    new Request(`${ORIGIN}/a2a`, {
      method: 'POST',
      headers: headersFor(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    }),
    env,
  );
  return { res, status: res.status, body: (await parse(res)) as RpcReply<T>['body'] };
}

export function userMessage(
  parts: ({ text: string } | { data: Record<string, unknown> })[],
  extra: Record<string, unknown> = {},
) {
  return {
    message: {
      kind: 'message',
      messageId: `m-${++seq}`,
      role: 'ROLE_USER',
      parts: parts.map((p) =>
        'text' in p ? { kind: 'text', text: p.text } : { kind: 'data', data: p.data },
      ),
      ...extra,
    },
  };
}

/** A /api/v1 request. */
export async function api(
  env: AgentEnv,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await handleApiV1(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, status: res.status, body: body as Record<string, unknown> };
}

/** A request to one of the built-in OAuth endpoints. */
export async function oauth(
  env: AgentEnv,
  route: OAuthRoute,
  init: {
    method: string;
    query?: Record<string, string>;
    form?: Record<string, string>;
    json?: unknown;
    headers?: Record<string, string>;
  },
) {
  const url = new URL(`${ORIGIN}/oauth/${route}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await handleOAuth(
    new Request(url, {
      method: init.method,
      headers: {
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.form
        ? new URLSearchParams(init.form).toString()
        : init.json !== undefined
          ? JSON.stringify(init.json)
          : undefined,
      redirect: 'manual',
    }),
    env,
    route,
  );
  const text = await res.text();
  return {
    res,
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    location: res.headers.get('location'),
  };
}
