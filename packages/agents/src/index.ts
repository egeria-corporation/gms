// SPDX-License-Identifier: AGPL-3.0-only
// @gms/agents — framework-agnostic (Request → Response) handlers for the agent surfaces. The Next app mounts
// them in route handlers and builds an AgentEnv per request (tenant from the host, runtime from getRuntime()).
import type { ActionContext, Executor } from '@gms/actions';
import type { RequestClaims } from '@gms/db';
import { ANON_CLAIMS, withRls } from '@gms/db';
import { agentCard } from './a2a';
import { authenticate, type AgentPrincipal } from './auth';
import { agentsMd, llmsFullTxt, llmsTxt, opportunityMarkdown } from './discovery';
import { errorResponse, json, text, trimOrigin, type AgentEnv, type ResourceKind } from './env';
import { authorizationServerMetadata, protectedResourceMetadata } from './oauth';

export type { AgentEnv, ResourceKind, ClientMetadataFetcher } from './env';
export { handleMcp, MCP_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './mcp';
export {
  handleA2a,
  agentCard,
  SKILLS as A2A_SKILLS,
  A2A_PROTOCOL_VERSION,
  type A2aTask,
  type TaskState,
} from './a2a';
export { handleApiV1, API_ALIASES } from './api';
export { openApiDocument, arazzoDocument, arazzoYaml } from './openapi';
export {
  handleOAuth,
  completeAuthorization,
  denyAuthorization,
  getPendingAuthorization,
  protectedResourceMetadata,
  authorizationServerMetadata,
  type OAuthRoute,
  type PendingAuthorization,
} from './oauth';
export {
  llmsTxt,
  llmsFullTxt,
  agentsMd,
  opportunityMarkdown,
  type OpportunityForMarkdown,
  type TenantForMarkdown,
} from './discovery';
export {
  authenticate,
  resolvePrincipal,
  anonymousContext,
  contextFor,
  bearerToken,
  bearerChallenge,
  unauthorized,
  insufficientScope,
  consumeRateLimit,
  rateLimitHeaders,
  channelEnabled,
  type AgentPrincipal,
  type AuthResult,
  type RateInfo,
} from './auth';
export {
  allCapabilities,
  visibleCapabilities,
  invokeCapability,
  callAction,
  agentCallable,
  CURATED_ACTIONS,
  type Capability,
  type InvokeResult,
} from './catalog';
export { wrapApplicant, UNTRUSTED_NOTICE } from './reads';
export {
  isPrivateAddress,
  validateClientIdUrl,
  fetchClientMetadataSafely,
  parseClientMetadataDocument,
} from './cimd';

const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' };
const MARKDOWN = 'text/markdown; charset=utf-8';

/** True when the client asked for markdown (`Accept: text/markdown` preferred over HTML) — serve opportunityMarkdownBySlug. */
export function prefersMarkdown(req: Request): boolean {
  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  const q = (type: string) => {
    const part = accept.split(',').find((p) => p.trim().startsWith(type));
    if (!part) return -1;
    const m = /;\s*q=([0-9.]+)/.exec(part);
    return m ? Number(m[1]) : 1;
  };
  return q('text/markdown') >= q('text/html');
}

/** Markdown for one published opportunity by slug (null when not public). For /opportunities/{slug}.md. */
export async function opportunityMarkdownBySlug(env: AgentEnv, slug: string): Promise<string | null> {
  const found = await withRls(
    ANON_CLAIMS,
    async (trx) => {
      const opp = await trx
        .selectFrom('opportunities')
        .selectAll()
        .where('workspace_id', '=', env.workspace.id)
        .where('slug', '=', slug)
        .where('status', 'in', ['open', 'forecasted', 'closed'])
        .executeTakeFirst();
      if (!opp) return null;
      const competitions = await trx
        .selectFrom('competitions')
        .select(['name', 'opens_at', 'closes_at', 'access', 'status'])
        .where('opportunity_id', '=', opp.id)
        .where('status', '<>', 'draft')
        .orderBy('stage_order')
        .execute();
      return { ...opp, competitions };
    },
    env.runtime.db,
  );
  return found
    ? opportunityMarkdown(found, {
        name: env.brandName,
        timezone: env.workspace.timezone,
        origin: env.origin,
      })
    : null;
}

/**
 * One-stop dispatcher for the public discovery routes. Returns null when the path is not one of them.
 *   /.well-known/oauth-protected-resource[/mcp|/a2a|/api/v1]   GET  RFC 9728
 *   /.well-known/oauth-authorization-server                    GET  RFC 8414
 *   /.well-known/agent-card.json                               GET  A2A Agent Card
 *   /llms.txt, /llms-full.txt, /agents.md                      GET
 *   /opportunities/{slug}.md                                   GET
 */
export async function handleDiscovery(req: Request, env: AgentEnv): Promise<Response | null> {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  try {
    const prm = /^\/\.well-known\/oauth-protected-resource(\/mcp|\/a2a|\/api\/v1)?$/.exec(path);
    if (prm) {
      const kind: ResourceKind | null =
        prm[1] === '/mcp' ? 'mcp' : prm[1] === '/a2a' ? 'a2a' : prm[1] === '/api/v1' ? 'api' : null;
      return json(protectedResourceMetadata(env, kind), 200, CORS);
    }
    if (path === '/.well-known/oauth-authorization-server')
      return json(authorizationServerMetadata(env), 200, CORS);
    if (path === '/.well-known/agent-card.json' || path === '/.well-known/agent.json')
      return json(agentCard(env), 200, CORS);
    if (path === '/llms.txt') return text(await llmsTxt(env), 'text/plain; charset=utf-8', 200, CORS);
    if (path === '/llms-full.txt')
      return text(await llmsFullTxt(env), 'text/plain; charset=utf-8', 200, CORS);
    if (path === '/agents.md') return text(await agentsMd(env), MARKDOWN, 200, CORS);
    const md = /^\/opportunities\/([a-z0-9-]{1,80})\.md$/.exec(path);
    if (md) {
      const body = await opportunityMarkdownBySlug(env, md[1]!);
      return body ? text(body, MARKDOWN, 200, CORS) : text('Not found\n', 'text/plain; charset=utf-8', 404);
    }
    return null;
  } catch (err) {
    return errorResponse(err, `${trimOrigin(env.origin)}${path}`);
  }
}

/**
 * Context for the CommonGrants write routes (`handleCommonGrants(req, { claims, executor, actionContext })`):
 * resolves the bearer token exactly like /api/v1 (audience: the Platform API). Returns null without a token so
 * the caller can fall back to the browser session.
 */
export async function commonGrantsAgentContext(
  req: Request,
  env: AgentEnv,
): Promise<{
  claims: RequestClaims;
  executor: Executor;
  actionContext: ActionContext;
  principal: AgentPrincipal;
} | null> {
  if (!req.headers.get('authorization')) return null;
  const auth = await authenticate(req, env, 'api', { channel: 'cg', required: true });
  return {
    claims: auth.ctx.claims,
    executor: env.runtime.executor,
    actionContext: auth.ctx,
    principal: auth.principal!,
  };
}
